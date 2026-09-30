-- Correctif : privilege de base manquant sur les tables applicatives.
--
-- En Postgres, activer RLS et ecrire des policies (fait dans 0001_init.sql) ne suffit
-- pas : le role qui execute la requete (anon ou authenticated, selon que l utilisateur
-- est connecte) doit aussi avoir le GRANT de base sur la table, sinon Postgres renvoie
-- "permission denied" avant meme d evaluer les policies RLS. Les policies RLS restent
-- le veritable garde-fou (elles restreignent aux lignes de auth.uid()) ; ce GRANT ne
-- fait qu autoriser le role a interroger la table du tout.

grant usage on schema public to anon, authenticated;

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
  public.exchange_rate_log
to anon, authenticated;

grant usage, select on all sequences in schema public to anon, authenticated;

-- Pour que les tables ajoutees par de futures migrations heritent automatiquement de
-- ces privileges, sans devoir repeter ce fichier a chaque fois.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated;
