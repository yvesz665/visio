-- Visio -- report de periode, rentrees d'argent, depenses hors budget.
--
-- Contenu :
--  1. Montants en entiers ×100 (bigint) sur toutes les colonnes monetaires existantes.
--  2. Transferts : ne modifient plus allocated_amount (migration des transferts deja
--     existants : on restaure les montants alloues d'origine).
--  3. transactions/recurrence_rules/pending_recurrences.envelope_id devient nullable
--     (depenses/remboursements/recurrences "hors budget").
--  4. Nouvelles tables : income_sources, income_entries, envelope_periods.
--  5. Fuseau horaire utilisateur sur profiles (bornes de cycle).
--  6. Fonctions Postgres : cloture de periode (idempotente, en rattrapage) et recalcul
--     en cascade, agregation du sous-arbre, conversion de devise etendue.

-- ============================================================================
-- 1. MONTANTS EN ENTIERS ×100
-- ============================================================================

alter table envelopes
  alter column allocated_amount type bigint using round(allocated_amount * 100)::bigint;
alter table envelopes alter column allocated_amount set default 0;

alter table transactions
  alter column amount type bigint using round(amount * 100)::bigint;

alter table recurrence_rules
  alter column amount type bigint using round(amount * 100)::bigint;

alter table pending_recurrences
  alter column amount type bigint using round(amount * 100)::bigint;

alter table transfers
  alter column amount type bigint using round(amount * 100)::bigint;

-- ============================================================================
-- 2. TRANSFERTS : ne modifient plus allocated_amount
-- ============================================================================
-- Migration des transferts deja existants : on restaure les montants alloues comme si
-- ces transferts n'avaient jamais modifie allocated_amount (agregation prealable par
-- enveloppe, indispensable si une enveloppe a ete impliquee dans plusieurs transferts).

update envelopes e
set allocated_amount = allocated_amount + coalesce(rev.total, 0)
from (
  select from_envelope_id, sum(amount) as total
  from transfers
  group by from_envelope_id
) rev
where rev.from_envelope_id = e.id;

update envelopes e
set allocated_amount = allocated_amount - coalesce(fwd.total, 0)
from (
  select to_envelope_id, sum(amount) as total
  from transfers
  group by to_envelope_id
) fwd
where fwd.to_envelope_id = e.id;

-- ============================================================================
-- 3. DEPENSES / REMBOURSEMENTS / RECURRENCES HORS BUDGET
-- ============================================================================

alter table transactions alter column envelope_id drop not null;
alter table recurrence_rules alter column envelope_id drop not null;
alter table pending_recurrences alter column envelope_id drop not null;

-- ============================================================================
-- 4. FUSEAU HORAIRE UTILISATEUR (bornes de cycle, 10.2/3.4)
-- ============================================================================

alter table profiles add column if not exists timezone text not null default 'Africa/Ouagadougou';

-- ============================================================================
-- 5. RENTREES D'ARGENT -- entite distincte des enveloppes
-- ============================================================================

create table if not exists income_sources (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists income_sources_user_idx on income_sources(user_id);

alter table income_sources enable row level security;
create policy "income_sources_owner_all" on income_sources for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists income_entries (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount bigint not null check (amount > 0),
  occurred_at date not null,
  source_id uuid not null references income_sources(id) on delete restrict,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists income_entries_user_idx on income_entries(user_id, occurred_at desc);

alter table income_entries enable row level security;
create policy "income_entries_owner_all" on income_entries for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists trg_income_entries_updated_at on income_entries;
create trigger trg_income_entries_updated_at before update on income_entries
  for each row execute function set_updated_at();

-- ============================================================================
-- 6. GRAND LIVRE DES PERIODES CLOSES (report d'une periode a l'autre)
-- ============================================================================
-- Seules les periodes CLOSES sont persistees ; la periode en cours est toujours
-- recalculee a la volee (voir src/lib/domain/periods.ts + envelopes.ts).

create table if not exists envelope_periods (
  id uuid primary key default gen_random_uuid(),
  envelope_id uuid not null references envelopes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  cycle_start date not null,
  cycle_end date not null,
  allocated_amount bigint not null,
  carry_in bigint not null default 0,
  transfers_in bigint not null default 0,
  transfers_out bigint not null default 0,
  spent bigint not null default 0,
  carry_out bigint not null default 0,
  closed_at timestamptz not null default now(),
  unique (envelope_id, cycle_start)
);

create index if not exists envelope_periods_envelope_idx on envelope_periods(envelope_id, cycle_start);
create index if not exists envelope_periods_user_idx on envelope_periods(user_id);

alter table envelope_periods enable row level security;
create policy "envelope_periods_owner_all" on envelope_periods for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================================
-- Grants (voir 0002_grants.sql -- ALTER DEFAULT PRIVILEGES couvre deja les nouvelles
-- tables, on le repete ici explicitement pour ne pas en dependre implicitement).
-- ============================================================================

grant select, insert, update, delete on income_sources, income_entries, envelope_periods
  to anon, authenticated;

-- ============================================================================
-- FONCTIONS -- cycle, sous-arbre, cloture de periode, recalcul en cascade
-- ============================================================================

-- Meme logique que currentCycleStart/currentCycleEnd (src/lib/domain/recurrence.ts),
-- en SQL pur sur des `date` (pas d'ambiguite de fuseau : l'appelant a deja resolu
-- "aujourd'hui" dans le fuseau utilisateur via (now() AT TIME ZONE tz)::date).
create or replace function cycle_start_for(p_reference date, p_anchor_day int)
returns date as $$
declare
  anchor_this_month int;
  days_this_month int;
begin
  days_this_month := extract(day from (date_trunc('month', p_reference) + interval '1 month - 1 day'))::int;
  anchor_this_month := least(p_anchor_day, days_this_month);

  if extract(day from p_reference)::int >= anchor_this_month then
    return date_trunc('month', p_reference)::date + (anchor_this_month - 1);
  end if;

  return cycle_start_for((date_trunc('month', p_reference) - interval '1 day')::date, p_anchor_day);
end;
$$ language plpgsql immutable;

create or replace function cycle_end_for(p_reference date, p_anchor_day int)
returns date as $$
declare
  start_date date;
  next_month_ref date;
  days_next_month int;
  anchor_next_month int;
begin
  start_date := cycle_start_for(p_reference, p_anchor_day);
  next_month_ref := (date_trunc('month', start_date) + interval '1 month')::date;
  days_next_month := extract(day from (date_trunc('month', next_month_ref) + interval '1 month - 1 day'))::int;
  anchor_next_month := least(p_anchor_day, days_next_month);
  return date_trunc('month', next_month_ref)::date + (anchor_next_month - 1);
end;
$$ language plpgsql immutable;

-- Tous les descendants (fils, petits-fils, ...) d'une enveloppe, elle incluse.
create or replace function get_envelope_and_descendants(p_envelope_id uuid)
returns table(id uuid) as $$
  with recursive subtree as (
    select e.id from envelopes e where e.id = p_envelope_id
    union all
    select e.id from envelopes e join subtree s on e.parent_id = s.id
  )
  select id from subtree;
$$ language sql stable;

-- Depense agregee sur le sous-arbre d'une enveloppe, sur une fenetre [start, end).
-- "income" = remboursement (reduit le depense), coherent avec envelopes.ts cote client.
create or replace function compute_subtree_spent(p_envelope_id uuid, p_start date, p_end date)
returns bigint as $$
  select coalesce(sum(case when t.type = 'expense' then t.amount else -t.amount end), 0)
  from transactions t
  where t.envelope_id in (select id from get_envelope_and_descendants(p_envelope_id))
    and t.deleted_at is null
    and t.occurred_at >= p_start
    and t.occurred_at < p_end;
$$ language sql stable;

create or replace function compute_transfers_in_window(p_envelope_id uuid, p_start date, p_end date)
returns table(transfers_in bigint, transfers_out bigint) as $$
  select
    coalesce(sum(case when tr.to_envelope_id = p_envelope_id then tr.amount else 0 end), 0),
    coalesce(sum(case when tr.from_envelope_id = p_envelope_id then tr.amount else 0 end), 0)
  from transfers tr
  where (tr.to_envelope_id = p_envelope_id or tr.from_envelope_id = p_envelope_id)
    and tr.occurred_at::date >= p_start
    and tr.occurred_at::date < p_end;
$$ language sql stable;

-- Cloture (en rattrapage) de toutes les periodes echues d'une enveloppe recurrente
-- active. Idempotente : `on conflict do nothing` sur (envelope_id, cycle_start) et
-- condition d'arret stricte sur la date empechent tout double-comptage, y compris si
-- appelee plusieurs fois en parallele (cron + lecture) ou apres l'echec d'un appel
-- precedent en plein milieu du rattrapage.
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

    v_spent := compute_subtree_spent(p_envelope_id, cursor_start, cursor_end);
    select * into v_transfers from compute_transfers_in_window(p_envelope_id, cursor_start, cursor_end);
    v_carry_out := env.allocated_amount + v_carry_in + v_transfers.transfers_in
                   - v_transfers.transfers_out - v_spent;

    insert into envelope_periods (
      id, envelope_id, user_id, cycle_start, cycle_end,
      allocated_amount, carry_in, transfers_in, transfers_out, spent, carry_out
    ) values (
      gen_random_uuid(), p_envelope_id, env.user_id, cursor_start, cursor_end,
      env.allocated_amount, v_carry_in, v_transfers.transfers_in, v_transfers.transfers_out,
      v_spent, v_carry_out
    )
    on conflict (envelope_id, cycle_start) do nothing;
  end loop;
end;
$$ language plpgsql;

-- Cloture en rattrapage pour toutes les enveloppes recurrentes actives d'un utilisateur
-- (p_user_id null = tous les utilisateurs, utilise par le cron quotidien).
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
    perform close_envelope_period(env.envelope_id, v_today);
  end loop;
end;
$$ language plpgsql;

-- Recalcul en cascade : une transaction ajoutee/modifiee/supprimee dans une periode
-- deja close doit refaire son "spent"/"carry_out", puis propager le nouveau carry_out
-- comme carry_in de la periode suivante, et ainsi de suite jusqu'a la derniere periode
-- close (la periode en cours n'est jamais persistee, elle se recalcule seule a la
-- lecture). A appeler pour l'enveloppe concernee ET chacun de ses ancetres (le depense
-- agrege remonte tout l'arbre).
create or replace function recalculate_periods_from(p_envelope_id uuid, p_from_date date)
returns void as $$
declare
  per record;
  v_carry_in bigint;
  v_transfers record;
  v_spent bigint;
  v_carry_out bigint;
  first_row boolean := true;
begin
  for per in
    select * from envelope_periods
    where envelope_id = p_envelope_id
      and cycle_end > p_from_date
    order by cycle_start asc
  loop
    if first_row then
      -- Report recu de la periode precedente (inchangee, donc toujours valide) si elle
      -- existe, sinon 0 (toute premiere periode de l'enveloppe).
      select carry_out into v_carry_in from envelope_periods
        where envelope_id = p_envelope_id and cycle_start < per.cycle_start
        order by cycle_start desc limit 1;
      v_carry_in := coalesce(v_carry_in, 0);
      first_row := false;
    else
      v_carry_in := v_carry_out; -- report de l'iteration precedente de cette boucle
    end if;

    v_spent := compute_subtree_spent(p_envelope_id, per.cycle_start, per.cycle_end);
    select * into v_transfers from compute_transfers_in_window(p_envelope_id, per.cycle_start, per.cycle_end);
    v_carry_out := per.allocated_amount + v_carry_in + v_transfers.transfers_in
                   - v_transfers.transfers_out - v_spent;

    update envelope_periods
      set carry_in = v_carry_in,
          transfers_in = v_transfers.transfers_in,
          transfers_out = v_transfers.transfers_out,
          spent = v_spent,
          carry_out = v_carry_out
      where id = per.id;
  end loop;
end;
$$ language plpgsql;

-- ============================================================================
-- CONVERSION DE DEVISE -- etendue aux nouvelles tables monetaires
-- ============================================================================

create or replace function apply_currency_conversion(p_user_id uuid, p_rate numeric)
returns void as $$
begin
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
