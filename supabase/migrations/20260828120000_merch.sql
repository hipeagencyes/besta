-- =========================================================
-- BESTA · suite → merch
-- La aplica `supabase db push` (a mano, o el workflow al hacer push a main).
-- Es idempotente: se puede volver a lanzar sin romper nada.
-- =========================================================

-- ---------- productos ----------
create table if not exists public.merch_products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  variant     text default '',            -- talla, color, edición…
  price       numeric(10,2) not null default 0,
  cost        numeric(10,2) not null default 0,   -- lo que nos costó la unidad
  stock       integer not null default 0,   -- unidades físicas en la caja
  info        text default '',
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- movimientos ----------
-- Todo lo que le pasa a un producto queda aquí: es el libro de la caja.
--   restock  → entran unidades (imprenta, reposición)
--   sale     → salen unidades vendidas
--   reserve  → apartadas para alguien, aún no pagadas ni entregadas
--   gift     → regaladas (prensa, invitados)
--   adjust   → cuadre de inventario tras contar la caja
create table if not exists public.merch_movements (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.merch_products(id) on delete cascade,
  kind        text not null check (kind in ('restock','sale','reserve','gift','adjust')),
  qty         integer not null,                    -- siempre positivo
  unit_price  numeric(10,2) not null default 0,    -- precio real aplicado
  customer    text default '',
  note        text default '',
  -- Solo las reservas usan estado. 'open' aparta stock; al entregarla se
  -- convierte en venta y la reserva queda 'done'.
  status      text not null default 'done' check (status in ('open','done','cancelled')),
  event       text default '',                     -- en qué bolo pasó
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);

create index if not exists merch_movements_product_idx
  on public.merch_movements (product_id, created_at desc);
create index if not exists merch_movements_open_idx
  on public.merch_movements (status) where status = 'open';

-- ---------- updated_at automático ----------
create or replace function public.merch_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists merch_products_touch on public.merch_products;
create trigger merch_products_touch
  before update on public.merch_products
  for each row execute function public.merch_touch();

-- ---------- permisos ----------
-- Mismo criterio que en ensayos: si has entrado, eres de la banda.
alter table public.merch_products  enable row level security;
alter table public.merch_movements enable row level security;

drop policy if exists "merch_products_auth" on public.merch_products;
create policy "merch_products_auth" on public.merch_products
  for all to authenticated using (true) with check (true);

drop policy if exists "merch_movements_auth" on public.merch_movements;
create policy "merch_movements_auth" on public.merch_movements
  for all to authenticated using (true) with check (true);
