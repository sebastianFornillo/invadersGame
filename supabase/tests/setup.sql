-- Prepara un Postgres común para parecerse a Supabase (roles anon y authenticated).
-- Sólo para tests: en Supabase estos roles ya existen.
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end;
$$;
