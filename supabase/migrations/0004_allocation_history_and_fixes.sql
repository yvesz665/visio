-- Visio -- corrections suite a un premier usage reel :
--
--  1. `service_role` n'avait jamais ete inclus dans les GRANT (0002_grants.sql ne
--     couvrait que anon/authenticated) : toute requete du cron quotidien
--     (/api/cron/recurrences, qui utilise la cle de service) echouait silencieusement
--     avec "permission denied", y compris son propre appel a close_all_due_periods.
--     Les transactions recurrentes ne se declenchaient donc jamais automatiquement.
--
--  2. close_envelope_period/recalculate_periods_from utilisaient le montant alloue
--     ACTUEL de l'enveloppe pour calculer le report de chaque periode, y compris des
--     periodes passees. Si l'utilisateur modifie son montant alloue APRES qu'une
--     periode soit terminee mais AVANT qu'elle soit cloturee (le cas le plus courant :
--     modifier son budget est une action normale et frequente), la cloture utilisait a
--     tort le nouveau montant pour une periode qui n'a jamais eu ce montant -- d'ou des
--     reports incoherents (ex: une enveloppe tout juste creee affichant un disponible
--     trop eleve des son premier vrai cycle). Correctif : historique des montants
--     alloues avec date d'effet, et montant utilise = celui en vigueur a la fin de la
--     periode concernee, jamais le montant "au moment ou le calcul tourne".
--
--  3. Si la cloture d'une enveloppe echouait (exception), toute la transaction de
--     close_all_due_periods s'annulait -- y compris les enveloppes deja traitees avec
--     succes dans la meme boucle. Chaque enveloppe est desormais isolee.

-- ============================================================================
-- 1. GRANTS POUR service_role (oublie dans 0002_grants.sql)
-- ============================================================================

grant usage on schema public to service_role;

grant select, insert, update, delete on
  public.profiles,
  public.envelopes,
  public.recurrence_rules,
  public.pending_recurrences,
  public.transactions,
  public.transfers,
  public.attachments,
  public.journal_events,
  public.push_subscriptions,
  public.exchange_rate_log,
  public.income_sources,
  public.income_entries,
  public.envelope_periods
to service_role;

grant usage, select on all sequences in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;

-- ============================================================================
-- 2. HISTORIQUE DES MONTANTS ALLOUES (avec date d'effet)
-- ============================================================================

create table if not exists envelope_allocation_history (
  id uuid primary key default gen_random_uuid(),
  envelope_id uuid not null references envelopes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount bigint not null,
  effective_at timestamptz not null
);

create index if not exists envelope_allocation_history_idx
  on envelope_allocation_history(envelope_id, effective_at desc);

alter table envelope_allocation_history enable row level security;
create policy "envelope_allocation_history_owner_all" on envelope_allocation_history for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on envelope_allocation_history to anon, authenticated, service_role;

-- Historise automatiquement toute creation d'enveloppe ou changement de montant
-- alloue, quel que soit le chemin de code (API, onboarding en insertion directe, etc.) :
-- un trigger au niveau de la table est le seul endroit garanti de ne rien manquer.
create or replace function log_envelope_allocation_change()
returns trigger as $$
begin
  if (TG_OP = 'INSERT') or (NEW.allocated_amount is distinct from OLD.allocated_amount) then
    insert into envelope_allocation_history (envelope_id, user_id, amount, effective_at)
    values (NEW.id, NEW.user_id, NEW.allocated_amount, case when TG_OP = 'INSERT' then NEW.created_at else now() end);
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_log_envelope_allocation_change on envelopes;
create trigger trg_log_envelope_allocation_change
  after insert or update on envelopes
  for each row execute function log_envelope_allocation_change();

-- Montant qui etait alloue a une enveloppe a un instant donne (le dernier changement
-- connu a cette date ou avant). Si l'enveloppe existait deja avant ce correctif, le
-- seul historique disponible est son montant courant : la verite exacte des montants
-- passes deja modifies avant ce correctif n'est pas recuperable, c'est attendu.
create or replace function allocation_at(p_envelope_id uuid, p_at timestamptz)
returns bigint as $$
  select amount from envelope_allocation_history
  where envelope_id = p_envelope_id and effective_at <= p_at
  order by effective_at desc limit 1;
$$ language sql stable;

-- Amorce l'historique pour les enveloppes deja existantes (le trigger ne couvre que
-- les changements a partir de maintenant).
insert into envelope_allocation_history (envelope_id, user_id, amount, effective_at)
select e.id, e.user_id, e.allocated_amount, e.created_at
from envelopes e
where not exists (
  select 1 from envelope_allocation_history h where h.envelope_id = e.id
);

-- ============================================================================
-- 3. CLOTURE : utilise le montant alloue EN VIGUEUR A LA FIN DE CHAQUE PERIODE,
--    jamais le montant courant de l'enveloppe. Isole chaque enveloppe des echecs
--    des autres dans close_all_due_periods.
-- ============================================================================

create or replace function close_envelope_period(p_envelope_id uuid, p_today date)
returns void as $$
declare
  env record;
  anchor int;
  last_closed record;
  cursor_start date;
  cursor_end date;
  v_carry_in bigint;
  v_transfers record;
  v_spent bigint;
  v_carry_out bigint;
  v_allocated bigint;
  iterations int := 0;
begin
  select * into env from envelopes where id = p_envelope_id;
  if env is null or env.status <> 'active' or not env.is_recurring then
    return; -- enveloppe absente, archivee ou non recurrente : pas de report a clore
  end if;

  select coalesce(env.cycle_anchor_day, (select cycle_anchor_day from profiles where id = env.user_id))
    into anchor;
  if anchor is null then
    anchor := 1;
  end if;

  loop
    select * into last_closed from envelope_periods
      where envelope_id = p_envelope_id order by cycle_start desc limit 1;

    if last_closed is null then
      cursor_start := cycle_start_for(env.created_at::date, anchor);
      v_carry_in := 0;
    else
      cursor_start := last_closed.cycle_end;
      v_carry_in := last_closed.carry_out;
    end if;

    cursor_end := cycle_end_for(cursor_start, anchor);

    -- La periode n'est close que si elle est entierement terminee.
    exit when cursor_end > p_today;

    -- Filet de securite : ne jamais boucler indefiniment sur une anomalie de donnees.
    iterations := iterations + 1;
    exit when iterations > 1200; -- ~100 ans de cycles mensuels

    -- Montant en vigueur a la fin de CETTE periode, pas le montant actuel de
    -- l'enveloppe qui a pu changer depuis (voir commentaire en tete de fichier).
    v_allocated := coalesce(allocation_at(p_envelope_id, cursor_end::timestamptz), env.allocated_amount);

    v_spent := compute_subtree_spent(p_envelope_id, cursor_start, cursor_end);
    select * into v_transfers from compute_transfers_in_window(p_envelope_id, cursor_start, cursor_end);
    v_carry_out := v_allocated + v_carry_in + v_transfers.transfers_in
                   - v_transfers.transfers_out - v_spent;

    insert into envelope_periods (
      id, envelope_id, user_id, cycle_start, cycle_end,
      allocated_amount, carry_in, transfers_in, transfers_out, spent, carry_out
    ) values (
      gen_random_uuid(), p_envelope_id, env.user_id, cursor_start, cursor_end,
      v_allocated, v_carry_in, v_transfers.transfers_in, v_transfers.transfers_out,
      v_spent, v_carry_out
    )
    on conflict (envelope_id, cycle_start) do nothing;
  end loop;
end;
$$ language plpgsql;

create or replace function close_all_due_periods(p_user_id uuid default null)
returns void as $$
declare
  env record;
  v_today date;
begin
  for env in
    select e.id as envelope_id, p.timezone
    from envelopes e
    join profiles p on p.id = e.user_id
    where e.status = 'active' and e.is_recurring
      and (p_user_id is null or e.user_id = p_user_id)
  loop
    v_today := (now() at time zone coalesce(env.timezone, 'Africa/Ouagadougou'))::date;
    begin
      perform close_envelope_period(env.envelope_id, v_today);
    exception when others then
      -- Une enveloppe en echec ne doit jamais empecher la cloture des autres, ni
      -- annuler ce qui a deja ete fait dans cette meme boucle.
      raise warning 'close_envelope_period a echoue pour %: %', env.envelope_id, sqlerrm;
    end;
  end loop;
end;
$$ language plpgsql;

-- recalculate_periods_from relit aussi le montant historique (une periode deja close
-- avec l'ancien bug peut ainsi se corriger la prochaine fois qu'une transaction change
-- dessus) plutot que de faire confiance a allocated_amount deja stocke sur la ligne.
create or replace function recalculate_periods_from(p_envelope_id uuid, p_from_date date)
returns void as $$
declare
  per record;
  v_carry_in bigint;
  v_transfers record;
  v_spent bigint;
  v_carry_out bigint;
  v_allocated bigint;
  first_row boolean := true;
begin
  for per in
    select * from envelope_periods
    where envelope_id = p_envelope_id
      and cycle_end > p_from_date
    order by cycle_start asc
  loop
    if first_row then
      select carry_out into v_carry_in from envelope_periods
        where envelope_id = p_envelope_id and cycle_start < per.cycle_start
        order by cycle_start desc limit 1;
      v_carry_in := coalesce(v_carry_in, 0);
      first_row := false;
    else
      v_carry_in := v_carry_out;
    end if;

    v_allocated := coalesce(allocation_at(p_envelope_id, per.cycle_end::timestamptz), per.allocated_amount);
    v_spent := compute_subtree_spent(p_envelope_id, per.cycle_start, per.cycle_end);
    select * into v_transfers from compute_transfers_in_window(p_envelope_id, per.cycle_start, per.cycle_end);
    v_carry_out := v_allocated + v_carry_in + v_transfers.transfers_in
                   - v_transfers.transfers_out - v_spent;

    update envelope_periods
      set allocated_amount = v_allocated,
          carry_in = v_carry_in,
          transfers_in = v_transfers.transfers_in,
          transfers_out = v_transfers.transfers_out,
          spent = v_spent,
          carry_out = v_carry_out
      where id = per.id;
  end loop;
end;
$$ language plpgsql;

-- ============================================================================
-- Conversion de devise : etendue a l'historique des montants alloues, pour que les
-- futures clotures/recalculs restent coherents avec la nouvelle devise.
-- ============================================================================

create or replace function apply_currency_conversion(p_user_id uuid, p_rate numeric)
returns void as $$
begin
  -- Doit tourner AVANT la mise a jour des enveloppes ci-dessous : celle-ci declenche
  -- trg_log_envelope_allocation_change, qui insere une nouvelle ligne d'historique deja
  -- dans la devise convertie. La reconvertir ensuite la doublerait par erreur.
  update envelope_allocation_history
    set amount = round(amount * p_rate)::bigint
    where user_id = p_user_id;

  update envelopes
    set allocated_amount = round(allocated_amount * p_rate)::bigint
    where user_id = p_user_id;

  update transactions
    set amount = round(amount * p_rate)::bigint
    where user_id = p_user_id;

  update recurrence_rules
    set amount = round(amount * p_rate)::bigint
    where user_id = p_user_id;

  update pending_recurrences
    set amount = round(amount * p_rate)::bigint
    where user_id = p_user_id;

  update transfers
    set amount = round(amount * p_rate)::bigint
    where user_id = p_user_id;

  update income_entries
    set amount = round(amount * p_rate)::bigint
    where user_id = p_user_id;

  update envelope_periods
    set allocated_amount = round(allocated_amount * p_rate)::bigint,
        carry_in = round(carry_in * p_rate)::bigint,
        transfers_in = round(transfers_in * p_rate)::bigint,
        transfers_out = round(transfers_out * p_rate)::bigint,
        spent = round(spent * p_rate)::bigint,
        carry_out = round(carry_out * p_rate)::bigint
    where user_id = p_user_id;
end;
$$ language plpgsql;

-- ============================================================================
-- 4. RECALCUL UNIQUE DE TOUT L'EXISTANT avec la logique corrigee ci-dessus.
-- ============================================================================

do $$
declare
  env record;
begin
  for env in select distinct envelope_id from envelope_periods loop
    begin
      perform recalculate_periods_from(env.envelope_id, '1970-01-01'::date);
    exception when others then
      raise warning 'recalcul initial echoue pour %: %', env.envelope_id, sqlerrm;
    end;
  end loop;
end $$;
