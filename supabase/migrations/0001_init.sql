-- Visio -- schema initial
-- Convention : tous les identifiants sont des UUID generes cote client (pour permettre
-- la creation hors-ligne), sauf indication contraire. Chaque table porte une politique RLS
-- limitant l acces a son proprietaire (auth.uid()).

create extension if not exists "pgcrypto";

-- ============================================================================
-- PROFILES
-- ============================================================================
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  default_currency char(3) not null default 'XOF',
  cycle_anchor_day smallint not null default 1 check (cycle_anchor_day between 1 and 31),
  alert_threshold_pct numeric(5,2) not null default 80 check (alert_threshold_pct between 0 and 100),
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "profiles_self_select" on profiles for select using (id = auth.uid());
create policy "profiles_self_insert" on profiles for insert with check (id = auth.uid());
create policy "profiles_self_update" on profiles for update using (id = auth.uid());
create policy "profiles_self_delete" on profiles for delete using (id = auth.uid());

-- ============================================================================
-- ENVELOPES -- arborescence sans limite de profondeur
-- ============================================================================
create table if not exists envelopes (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid references envelopes(id) on delete restrict,
  name text not null,
  color text not null default '#22a468',
  icon text not null default 'wallet',
  allocated_amount numeric(14,2) not null default 0 check (allocated_amount >= 0),
  is_recurring boolean not null default true,
  cycle_mode text not null default 'inherit' check (cycle_mode in ('inherit', 'custom')),
  cycle_anchor_day smallint check (cycle_anchor_day between 1 and 31),
  alert_threshold_pct numeric(5,2) check (alert_threshold_pct between 0 and 100),
  status text not null default 'active' check (status in ('active', 'archived')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- un seul noeud racine (le "budget general") par utilisateur
create unique index if not exists envelopes_one_root_per_user
  on envelopes(user_id) where parent_id is null;

create index if not exists envelopes_user_idx on envelopes(user_id);
create index if not exists envelopes_parent_idx on envelopes(parent_id);

alter table envelopes enable row level security;

create policy "envelopes_owner_all" on envelopes for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Regle d allocation : la somme des enveloppes actives enfants d un noeud ne peut
-- jamais depasser le montant alloue a ce noeud parent.
create or replace function enforce_envelope_allocation() returns trigger as $$
declare
  parent_allocated numeric;
  siblings_sum numeric;
  children_sum numeric;
begin
  if NEW.parent_id is not null and NEW.status = 'active' then
    select allocated_amount into parent_allocated from envelopes where id = NEW.parent_id;
    if parent_allocated is not null then
      select coalesce(sum(allocated_amount), 0) into siblings_sum
        from envelopes
        where parent_id = NEW.parent_id and status = 'active';
      if siblings_sum > parent_allocated then
        raise exception 'allocation_exceeds_parent: la somme des enveloppes enfants (%) depasse le montant alloue au parent (%)', siblings_sum, parent_allocated
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  if TG_OP = 'UPDATE' and NEW.allocated_amount is distinct from OLD.allocated_amount then
    select coalesce(sum(allocated_amount), 0) into children_sum
      from envelopes
      where parent_id = NEW.id and status = 'active';
    if children_sum > NEW.allocated_amount then
      raise exception 'allocation_exceeds_new_amount: le nouveau montant (%) est inferieur a la somme deja repartie aux enfants (%)', NEW.allocated_amount, children_sum
        using errcode = 'check_violation';
    end if;
  end if;

  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_enforce_envelope_allocation on envelopes;
create trigger trg_enforce_envelope_allocation
  after insert or update on envelopes
  for each row execute function enforce_envelope_allocation();

-- ============================================================================
-- RECURRENCE RULES
-- ============================================================================
create table if not exists recurrence_rules (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  envelope_id uuid not null references envelopes(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  type text not null check (type in ('income', 'expense')),
  description text,
  interval_value integer not null check (interval_value > 0),
  interval_unit text not null check (interval_unit in ('day', 'week', 'month', 'year')),
  start_date date not null,
  end_date date,
  next_run_date date not null,
  status text not null default 'active' check (status in ('active', 'paused', 'ended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists recurrence_rules_user_idx on recurrence_rules(user_id);
create index if not exists recurrence_rules_due_idx on recurrence_rules(status, next_run_date);

alter table recurrence_rules enable row level security;
create policy "recurrence_rules_owner_all" on recurrence_rules for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================================
-- PENDING RECURRENCES -- occurrence en attente de confirmation manuelle
-- (budget insuffisant au moment du declenchement, cf. 4.2)
-- ============================================================================
create table if not exists pending_recurrences (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  recurrence_rule_id uuid not null references recurrence_rules(id) on delete cascade,
  envelope_id uuid not null references envelopes(id) on delete cascade,
  scheduled_date date not null,
  amount numeric(14,2) not null,
  type text not null check (type in ('income', 'expense')),
  description text,
  status text not null default 'awaiting_confirmation'
    check (status in ('awaiting_confirmation', 'confirmed', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists pending_recurrences_user_idx on pending_recurrences(user_id, status);

alter table pending_recurrences enable row level security;
create policy "pending_recurrences_owner_all" on pending_recurrences for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================================
-- TRANSACTIONS
-- ============================================================================
create table if not exists transactions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  envelope_id uuid not null references envelopes(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  type text not null check (type in ('income', 'expense')),
  occurred_at date not null,
  description text,
  recurrence_rule_id uuid references recurrence_rules(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists transactions_user_idx on transactions(user_id);
create index if not exists transactions_envelope_idx on transactions(envelope_id);
create index if not exists transactions_occurred_idx on transactions(user_id, occurred_at desc);

alter table transactions enable row level security;
create policy "transactions_owner_all" on transactions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================================
-- TRANSFERS -- deplacement d un montant alloue entre deux enveloppes
-- ============================================================================
create table if not exists transfers (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  from_envelope_id uuid not null references envelopes(id) on delete restrict,
  to_envelope_id uuid not null references envelopes(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  note text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists transfers_user_idx on transfers(user_id);

alter table transfers enable row level security;
create policy "transfers_owner_all" on transfers for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================================
-- ATTACHMENTS -- pieces jointes de transaction (photo de recu/facture)
-- ============================================================================
create table if not exists attachments (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_id uuid not null references transactions(id) on delete cascade,
  storage_path text not null,
  mime_type text not null,
  size_bytes integer not null,
  created_at timestamptz not null default now()
);

create index if not exists attachments_transaction_idx on attachments(transaction_id);

alter table attachments enable row level security;
create policy "attachments_owner_all" on attachments for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================================
-- JOURNAL EVENTS -- journal d activite + mecanisme d annulation + file de sync
-- ============================================================================
create table if not exists journal_events (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  seq bigserial,
  event_type text not null,
  entity_type text not null,
  entity_id uuid not null,
  payload jsonb not null,
  inverse_payload jsonb,
  client_created_at timestamptz not null,
  received_at timestamptz not null default now(),
  is_undone boolean not null default false,
  undoes_event_id uuid references journal_events(id),
  status text not null default 'applied' check (status in ('applied', 'rejected')),
  reject_reason text
);

create index if not exists journal_events_user_seq_idx on journal_events(user_id, seq);
create index if not exists journal_events_user_created_idx on journal_events(user_id, client_created_at desc);

alter table journal_events enable row level security;
create policy "journal_events_owner_all" on journal_events for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================================
-- PUSH SUBSCRIPTIONS -- notifications push (Web Push / VAPID)
-- ============================================================================
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on push_subscriptions(user_id);

alter table push_subscriptions enable row level security;
create policy "push_subscriptions_owner_all" on push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================================
-- EXCHANGE RATE LOG -- audit des changements de devise (9.3)
-- ============================================================================
create table if not exists exchange_rate_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  from_currency char(3) not null,
  to_currency char(3) not null,
  rate numeric(18,8) not null,
  applied_at timestamptz not null default now()
);

alter table exchange_rate_log enable row level security;
create policy "exchange_rate_log_owner_all" on exchange_rate_log for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================================
-- CONVERSION DE DEVISE (9.3) -- multiplie tous les montants d un utilisateur par un
-- taux, de facon atomique. La mise a l echelle uniforme preserve automatiquement la
-- regle d allocation (une inegalite multipliee par un meme facteur positif reste vraie),
-- donc aucun conflit possible avec le trigger enforce_envelope_allocation.
--
-- Volontairement SANS "security definer" : la fonction s execute avec les droits de
-- l appelant, donc les policies RLS ci-dessus continuent de s appliquer et bornent les
-- mises a jour aux lignes de auth.uid(), quelle que soit la valeur de p_user_id recue.
-- ============================================================================
create or replace function apply_currency_conversion(p_user_id uuid, p_rate numeric)
returns void as $$
begin
  update envelopes
    set allocated_amount = round(allocated_amount * p_rate, 2)
    where user_id = p_user_id;

  update transactions
    set amount = round(amount * p_rate, 2)
    where user_id = p_user_id;

  update recurrence_rules
    set amount = round(amount * p_rate, 2)
    where user_id = p_user_id;
end;
$$ language plpgsql;

-- ============================================================================
-- updated_at helper
-- ============================================================================
create or replace function set_updated_at() returns trigger as $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_profiles_updated_at on profiles;
create trigger trg_profiles_updated_at before update on profiles
  for each row execute function set_updated_at();

drop trigger if exists trg_envelopes_updated_at on envelopes;
create trigger trg_envelopes_updated_at before update on envelopes
  for each row execute function set_updated_at();

drop trigger if exists trg_transactions_updated_at on transactions;
create trigger trg_transactions_updated_at before update on transactions
  for each row execute function set_updated_at();

drop trigger if exists trg_recurrence_rules_updated_at on recurrence_rules;
create trigger trg_recurrence_rules_updated_at before update on recurrence_rules
  for each row execute function set_updated_at();

-- ============================================================================
-- STORAGE -- bucket prive pour les pieces jointes
-- ============================================================================
insert into storage.buckets (id, name, public)
  values ('attachments', 'attachments', false)
  on conflict (id) do nothing;

create policy "attachments_storage_owner_select" on storage.objects for select
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "attachments_storage_owner_insert" on storage.objects for insert
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "attachments_storage_owner_delete" on storage.objects for delete
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
