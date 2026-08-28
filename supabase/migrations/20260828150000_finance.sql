-- =========================================================
-- BESTA · suite → finanzas
-- Repositorio central de miembros, gastos, liquidaciones y trazabilidad.
-- =========================================================

create table if not exists public.finance_members (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  initials    text not null default '',
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.finance_expenses (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  amount           numeric(12,2) not null default 0 check (amount > 0),
  payer_id         uuid not null references public.finance_members(id) on delete restrict,
  category         text not null default 'otros',
  participant_ids  jsonb not null default '[]'::jsonb,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.finance_settlements (
  id           uuid primary key default gen_random_uuid(),
  debtor_id    uuid not null references public.finance_members(id) on delete restrict,
  creditor_id  uuid not null references public.finance_members(id) on delete restrict,
  amount       numeric(12,2) not null check (amount > 0),
  note         text not null default '',
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);

create table if not exists public.finance_audit (
  id          uuid primary key default gen_random_uuid(),
  actor       text not null default 'system',
  action      text not null,
  entity      text not null,
  entity_id   text not null default '',
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists finance_expenses_created_at_idx
  on public.finance_expenses (created_at desc);

create index if not exists finance_settlements_created_at_idx
  on public.finance_settlements (created_at desc);

create index if not exists finance_audit_created_at_idx
  on public.finance_audit (created_at desc);

create or replace function public.besta_finance_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists finance_members_touch on public.finance_members;
create trigger finance_members_touch
  before update on public.finance_members
  for each row execute function public.besta_finance_touch();

drop trigger if exists finance_expenses_touch on public.finance_expenses;
create trigger finance_expenses_touch
  before update on public.finance_expenses
  for each row execute function public.besta_finance_touch();

alter table public.finance_members enable row level security;
alter table public.finance_expenses enable row level security;
alter table public.finance_settlements enable row level security;
alter table public.finance_audit enable row level security;

drop policy if exists "finance_members_authed" on public.finance_members;
create policy "finance_members_authed" on public.finance_members
  for all to authenticated using (true) with check (true);

drop policy if exists "finance_expenses_authed" on public.finance_expenses;
create policy "finance_expenses_authed" on public.finance_expenses
  for all to authenticated using (true) with check (true);

drop policy if exists "finance_settlements_authed" on public.finance_settlements;
create policy "finance_settlements_authed" on public.finance_settlements
  for all to authenticated using (true) with check (true);

drop policy if exists "finance_audit_authed" on public.finance_audit;
create policy "finance_audit_authed" on public.finance_audit
  for all to authenticated using (true) with check (true);
