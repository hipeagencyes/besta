-- =========================================================
-- BESTA · suite → finanzas → categorías configurables
-- =========================================================

create table if not exists public.finance_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

insert into public.finance_categories (name)
values
  ('traslado'),
  ('local'),
  ('instrumentos'),
  ('material'),
  ('comida'),
  ('directo'),
  ('otros')
on conflict (name) do nothing;

create index if not exists finance_categories_name_idx
  on public.finance_categories (name asc);

create trigger finance_categories_touch
  before update on public.finance_categories
  for each row execute function public.besta_finance_touch();

alter table public.finance_categories enable row level security;

drop policy if exists "finance_categories_authed" on public.finance_categories;
create policy "finance_categories_authed" on public.finance_categories
  for all to authenticated using (true) with check (true);
