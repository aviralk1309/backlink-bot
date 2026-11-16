-- A timed-out or unusable 200 response may have consumed a provider credit.
-- Count a conservative reservation against the existing budget without calling
-- it confirmed spend. Reconciliation can later release the reservation.
alter table public.job_queries
  add column credit_spend_uncertain boolean not null default false;

alter table public.job_stats
  add column credits_uncertain integer not null default 0
    check (credits_uncertain >= 0 and credits_uncertain <= credits_used);

grant update (credit_spend_uncertain) on public.job_queries to worker;
