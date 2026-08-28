-- =========================================================
-- BESTA · merch → tallas
-- El stock deja de vivir en el producto y pasa a la talla: una
-- camiseta es UN producto con cuatro filas (S, M, L, XL), no cuatro
-- productos. Lo que no tiene tallas (un vinilo) lleva una sola fila
-- con la etiqueta vacía y la interfaz ni la menciona.
--
-- Se puede aplicar tal cual porque las tablas están vacías: no hay
-- historial que reubicar.
-- =========================================================

-- ---------- tallas ----------
create table if not exists public.merch_variants (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.merch_products(id) on delete cascade,
  label       text not null default '',          -- 'S', 'M', 'negra'… vacío = sin tallas
  price       numeric(10,2),                     -- null = hereda el precio del producto
  stock       integer not null default 0,
  position    integer not null default 0,        -- para que S vaya antes que XL
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Dos tallas iguales en el mismo producto no tienen sentido y romperían
-- el recuento de stock por partida doble.
create unique index if not exists merch_variants_label_idx
  on public.merch_variants (product_id, label);
create index if not exists merch_variants_product_idx
  on public.merch_variants (product_id, position);

-- ---------- el producto ya no guarda stock ----------
-- 'variant' era el apaño de texto que sustituye esta tabla.
alter table public.merch_products drop column if exists stock;
alter table public.merch_products drop column if exists variant;

-- ---------- los movimientos apuntan a la talla ----------
-- Por la talla se llega al producto, así que product_id sobraba y solo
-- podía desincronizarse.
alter table public.merch_movements
  add column if not exists variant_id uuid references public.merch_variants(id) on delete cascade;
alter table public.merch_movements drop column if exists product_id;
alter table public.merch_movements alter column variant_id set not null;

drop index if exists public.merch_movements_product_idx;
create index if not exists merch_movements_variant_idx
  on public.merch_movements (variant_id, created_at desc);

-- ---------- updated_at automático ----------
drop trigger if exists merch_variants_touch on public.merch_variants;
create trigger merch_variants_touch
  before update on public.merch_variants
  for each row execute function public.merch_touch();

-- ---------- permisos ----------
alter table public.merch_variants enable row level security;

drop policy if exists "merch_variants_auth" on public.merch_variants;
create policy "merch_variants_auth" on public.merch_variants
  for all to authenticated using (true) with check (true);
