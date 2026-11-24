-- =====================================================================
-- Invaders Space · ranking online y ligas privadas (Supabase / Postgres)
--
-- Cómo instalarlo: en Supabase abrí SQL Editor → New query, pegá TODO este
-- archivo y tocá Run. Se puede volver a correr para actualizar funciones.
--
-- Seguridad:
--   * Las tablas no se pueden leer ni escribir directo con la clave pública
--     (RLS activado y sin políticas). Todo pasa por las funciones de abajo.
--   * submit_score valida nombre, partida y puntaje. Frena trampas obvias;
--     ningún juego que corre en el navegador puede impedirlas todas.
--   * No se guardan IPs: sólo un hash para limitar abusos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------
create table if not exists public.leagues (
  code        text primary key check (code ~ '^[A-Z2-9]{6}$'),
  name        text not null check (char_length(name) between 3 and 24),
  created_by  uuid not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.runs (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid not null,
  mode        text not null default 'classic' check (mode in ('classic', 'daily')),
  day         date,
  ip_hash     text,
  started_at  timestamptz not null default now(),
  submitted   boolean not null default false
);
create index if not exists runs_device_idx on public.runs (device_id, started_at desc);
create index if not exists runs_ip_idx on public.runs (ip_hash, started_at desc);

create table if not exists public.scores (
  id           bigint generated always as identity primary key,
  run_id       uuid not null unique references public.runs (id) on delete cascade,
  device_id    uuid not null,
  player       text not null,
  score        integer not null check (score >= 0),
  wave         integer not null check (wave between 1 and 500),
  kills        integer not null default 0 check (kills >= 0),
  league_code  text references public.leagues (code) on delete set null,
  mode         text not null default 'classic' check (mode in ('classic', 'daily')),
  day          date,
  duration_s   integer not null,
  created_at   timestamptz not null default now()
);
create index if not exists scores_mode_score_idx on public.scores (mode, score desc);
create index if not exists scores_league_idx on public.scores (league_code, score desc) where league_code is not null;
create index if not exists scores_daily_idx on public.scores (day, score desc) where mode = 'daily';
create index if not exists scores_created_idx on public.scores (created_at);
-- Desafío diario: un solo puntaje por dispositivo y día
create unique index if not exists scores_daily_once on public.scores (device_id, day) where mode = 'daily';

alter table public.leagues enable row level security;
alter table public.runs enable row level security;
alter table public.scores enable row level security;
revoke all on table public.leagues, public.runs, public.scores from anon, authenticated;

-- ---------------------------------------------------------------------
-- Auxiliar: hash de la IP del cliente (PostgREST pasa los headers)
-- ---------------------------------------------------------------------
create or replace function public._client_ip_hash()
returns text
language sql
stable
set search_path = ''
as $$
  select md5(nullif(btrim(split_part(coalesce(
    nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''
  ), ',', 1)), ''));
$$;

-- ---------------------------------------------------------------------
-- start_run: el juego la llama al empezar una partida
-- ---------------------------------------------------------------------
create or replace function public.start_run(p_device uuid, p_mode text default 'classic')
returns table (run_id uuid, day date)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip  text := public._client_ip_hash();
  v_day date := (now() at time zone 'utc')::date;
  v_id  uuid;
begin
  if p_device is null then
    raise exception 'falta el identificador del dispositivo';
  end if;
  if p_mode is null or p_mode not in ('classic', 'daily') then
    raise exception 'modo de juego inválido';
  end if;
  if (select count(*) from public.runs r
      where r.device_id = p_device and r.started_at > now() - interval '1 hour') >= 60 then
    raise exception 'demasiadas partidas seguidas, probá en un rato';
  end if;
  if v_ip is not null and (select count(*) from public.runs r
      where r.ip_hash = v_ip and r.started_at > now() - interval '1 hour') >= 300 then
    raise exception 'demasiadas partidas desde esta red, probá en un rato';
  end if;

  -- Limpieza ocasional de partidas que nunca se guardaron
  if random() < 0.02 then
    delete from public.runs r where not r.submitted and r.started_at < now() - interval '2 days';
  end if;

  insert into public.runs (device_id, mode, day, ip_hash)
  values (p_device, p_mode, case when p_mode = 'daily' then v_day end, v_ip)
  returning id into v_id;

  return query select v_id, case when p_mode = 'daily' then v_day end;
end;
$$;

-- ---------------------------------------------------------------------
-- submit_score: guarda el puntaje de una partida (una sola vez)
-- ---------------------------------------------------------------------
create or replace function public.submit_score(
  p_run    uuid,
  p_device uuid,
  p_player text,
  p_score  integer,
  p_wave   integer,
  p_kills  integer default 0,
  p_league text default null
)
returns table (world_rank integer, players integer, league_rank integer, personal_best boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run     public.runs%rowtype;
  v_elapsed numeric;
  v_name    text := regexp_replace(btrim(coalesce(p_player, '')), '\s+', ' ', 'g');
  v_league  text := nullif(upper(btrim(coalesce(p_league, ''))), '');
  v_kills   integer := coalesce(p_kills, 0);
  v_prev    integer;
begin
  select * into v_run from public.runs r where r.id = p_run for update;
  if not found or v_run.device_id is distinct from p_device then
    raise exception 'partida inválida';
  end if;
  if v_run.submitted then
    raise exception 'esta partida ya se guardó';
  end if;

  if v_name !~ '^[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ _.-]{2,12}$' then
    raise exception 'nombre inválido: de 2 a 12 letras, números, espacios, punto o guion';
  end if;
  if p_score is null or p_wave is null or p_score < 0 or p_wave < 1 or p_wave > 500 or v_kills < 0 then
    raise exception 'datos de la partida inválidos';
  end if;

  v_elapsed := extract(epoch from now() - v_run.started_at);
  if v_elapsed > 6 * 3600 then
    raise exception 'la partida venció';
  end if;

  -- Controles de plausibilidad: frenan trampas obvias, no todas.
  if p_score % 10 <> 0
     or p_score > p_wave * 210000
     or p_score > greatest(v_elapsed, 1) * 8000
     or v_elapsed < (p_wave - 1) * 5
     or v_kills > p_wave * 80 then
    raise exception 'puntaje rechazado por el control antitrampas';
  end if;

  if v_league is not null and not exists (select 1 from public.leagues l where l.code = v_league) then
    raise exception 'la liga no existe';
  end if;

  if v_run.mode = 'daily' and exists (
    select 1 from public.scores s
    where s.device_id = p_device and s.mode = 'daily' and s.day = v_run.day
  ) then
    raise exception 'ya jugaste el desafío de hoy';
  end if;

  select max(s.score) into v_prev
  from public.scores s
  where s.device_id = p_device
    and s.mode = v_run.mode
    and (v_run.mode <> 'daily' or s.day = v_run.day);

  insert into public.scores (run_id, device_id, player, score, wave, kills, league_code, mode, day, duration_s)
  values (p_run, p_device, v_name, p_score, p_wave, v_kills, v_league, v_run.mode, v_run.day, v_elapsed::integer);

  update public.runs r set submitted = true where r.id = p_run;

  return query
  with best as (
    select s.device_id, max(s.score) as score
    from public.scores s
    where s.mode = v_run.mode and (v_run.mode <> 'daily' or s.day = v_run.day)
    group by s.device_id
  ),
  league_best as (
    select s.device_id, max(s.score) as score
    from public.scores s
    where v_league is not null and s.league_code = v_league and s.mode = v_run.mode
      and (v_run.mode <> 'daily' or s.day = v_run.day)
    group by s.device_id
  )
  select
    (select count(*) from best b
      where b.score > (select b2.score from best b2 where b2.device_id = p_device))::integer + 1,
    (select count(*) from best)::integer,
    case when v_league is null then null else
      (select count(*) from league_best lb
        where lb.score > (select lb2.score from league_best lb2 where lb2.device_id = p_device))::integer + 1
    end,
    (v_prev is null or p_score > v_prev);
end;
$$;

-- ---------------------------------------------------------------------
-- get_leaderboard: mejor puntaje de cada jugador en un ámbito
--   p_scope: 'global' (histórico) | 'week' (semana actual, UTC)
--            | 'league' (liga privada) | 'daily' (desafío de hoy, UTC)
--   Devuelve el top p_limit y, si está más abajo, también tu fila.
-- ---------------------------------------------------------------------
create or replace function public.get_leaderboard(
  p_scope  text default 'global',
  p_league text default null,
  p_device uuid default null,
  p_limit  integer default 20
)
returns table (pos integer, player text, score integer, wave integer, created_at timestamptz, is_me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with filtered as (
    select s.device_id, s.player, s.score, s.wave, s.created_at
    from public.scores s
    where case p_scope
      when 'global' then s.mode = 'classic'
      when 'week'   then s.mode = 'classic'
                         and s.created_at >= date_trunc('week', now() at time zone 'utc') at time zone 'utc'
      when 'league' then s.mode = 'classic' and s.league_code = upper(btrim(coalesce(p_league, '')))
      when 'daily'  then s.mode = 'daily' and s.day = (now() at time zone 'utc')::date
      else false
    end
  ),
  best as (
    select distinct on (f.device_id) f.device_id, f.player, f.score, f.wave, f.created_at
    from filtered f
    order by f.device_id, f.score desc, f.created_at asc
  ),
  ranked as (
    select (row_number() over (order by b.score desc, b.created_at asc))::integer as pos, b.*
    from best b
  )
  select r.pos, r.player, r.score, r.wave, r.created_at, coalesce(r.device_id = p_device, false)
  from ranked r
  where r.pos <= least(greatest(coalesce(p_limit, 20), 1), 100) or r.device_id = p_device
  order by r.pos;
$$;

-- ---------------------------------------------------------------------
-- Ligas privadas
-- ---------------------------------------------------------------------
create or replace function public.create_league(p_device uuid, p_name text)
returns table (code text, name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name     text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_code     text;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- sin I, O, 0 ni 1
begin
  if p_device is null then
    raise exception 'falta el identificador del dispositivo';
  end if;
  if v_name !~ '^[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ _.!-]{3,24}$' then
    raise exception 'nombre de liga inválido: de 3 a 24 letras, números o espacios';
  end if;
  if (select count(*) from public.leagues l
      where l.created_by = p_device and l.created_at > now() - interval '1 day') >= 5 then
    raise exception 'ya creaste 5 ligas hoy';
  end if;

  loop
    select string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::integer, 1), '')
      into v_code
    from generate_series(1, 6);
    exit when not exists (select 1 from public.leagues l where l.code = v_code);
  end loop;

  insert into public.leagues (code, name, created_by) values (v_code, v_name, p_device);
  return query select v_code, v_name;
end;
$$;

create or replace function public.get_league(p_code text)
returns table (code text, name text, players integer)
language sql
stable
security definer
set search_path = ''
as $$
  select l.code, l.name,
         (select count(distinct s.device_id)::integer from public.scores s where s.league_code = l.code)
  from public.leagues l
  where l.code = upper(btrim(coalesce(p_code, '')));
$$;

-- ---------------------------------------------------------------------
-- Permisos: la clave pública sólo puede ejecutar estas funciones
-- ---------------------------------------------------------------------
revoke all on function public._client_ip_hash() from public, anon, authenticated;
revoke all on function public.start_run(uuid, text) from public;
revoke all on function public.submit_score(uuid, uuid, text, integer, integer, integer, text) from public;
revoke all on function public.get_leaderboard(text, text, uuid, integer) from public;
revoke all on function public.create_league(uuid, text) from public;
revoke all on function public.get_league(text) from public;

grant execute on function public.start_run(uuid, text) to anon, authenticated;
grant execute on function public.submit_score(uuid, uuid, text, integer, integer, integer, text) to anon, authenticated;
grant execute on function public.get_leaderboard(text, text, uuid, integer) to anon, authenticated;
grant execute on function public.create_league(uuid, text) to anon, authenticated;
grant execute on function public.get_league(text) to anon, authenticated;
