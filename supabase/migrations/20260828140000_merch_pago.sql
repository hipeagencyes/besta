-- =========================================================
-- BESTA · merch → trazabilidad de la venta
-- Dos preguntas que hasta ahora no se hacían: cómo se pagó y quién
-- estaba en el puesto.
--
-- `created_by` ya guardaba el auth.uid(), pero no vale: en un bolo el
-- móvil es uno y lo usa quien esté en ese momento, así que la cuenta
-- que ha iniciado sesión no es necesariamente quien atiende. `by_name`
-- es el nombre que se escribe, con la sesión solo como valor por defecto.
-- =========================================================

alter table public.merch_movements
  add column if not exists payment text not null default '',
  add column if not exists by_name text not null default '';

-- Lista cerrada para que «bizum», «Bizum» y «bzm» no acaben siendo tres
-- formas de pago distintas al cuadrar la caja.
alter table public.merch_movements drop constraint if exists merch_movements_payment_check;
alter table public.merch_movements
  add constraint merch_movements_payment_check
  check (payment in ('', 'efectivo', 'bizum', 'tarjeta', 'otro'));
