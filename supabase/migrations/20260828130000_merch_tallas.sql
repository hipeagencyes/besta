-- =========================================================
-- BESTA · merch → tallas
-- El stock deja de vivir en el producto y pasa a la talla: una
-- camiseta es UN producto con cuatro filas (S, M, L, XL), no cuatro
-- productos. Lo que no tiene tallas (un vinilo) lleva una sola fila
-- con la etiqueta vacía y la interfaz ni la menciona.
--
-- Lo que ya hay se conserva: cada producto existente se convierte en su
-- propia talla, con su stock y con el texto que llevaba en `variant`,
-- y sus movimientos se reenganchan ahí antes de tocar nada.
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

-- ---------- traer lo que ya existe ----------
insert into public.merch_variants (product_id, label, stock, position)
select id, coalesce(variant, ''), coalesce(stock, 0), 0
from public.merch_products
on conflict (product_id, label) do nothing;

-- ---------- los movimientos apuntan a la talla ----------
alter table public.merch_movements
  add column if not exists variant_id uuid references public.merch_variants(id) on delete cascade;

-- Cada producto acaba de estrenar exactamente una talla, así que cada
-- movimiento tiene un único sitio al que ir.
update public.merch_movements m
   set variant_id = v.id
  from public.merch_variants v
 where v.product_id = m.product_id
   and m.variant_id is null;

-- Si algo se quedara sin enganchar, esto corta la migración entera y no
-- se pierde nada: mejor eso que borrar apuntes por nuestra cuenta.
alter table public.merch_movements alter column variant_id set not null;

-- Por la talla se llega al producto, así que product_id ya solo podía
-- desincronizarse.
alter table public.merch_movements drop column if exists product_id;

drop index if exists public.merch_movements_product_idx;
create index if not exists merch_movements_variant_idx
  on public.merch_movements (variant_id, created_at desc);

-- ---------- el producto ya no guarda stock ----------
-- 'variant' era el apaño de texto que sustituye esta tabla.
alter table public.merch_products drop column if exists stock;
alter table public.merch_products drop column if exists variant;

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
