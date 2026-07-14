-- Supabase instala pgcrypto en el esquema extensions. La calificación explícita
-- evita que las funciones SECURITY DEFINER dependan del search_path de sesión.

begin;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

create or replace function public.th_payload_hash(p_payload jsonb)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select pg_catalog.encode(
    extensions.digest(coalesce(p_payload, '{}'::jsonb)::text, 'sha256'::text),
    'hex'::text
  );
$$;

commit;
