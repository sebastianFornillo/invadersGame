-- Tests del esquema del ranking. Se corren con: npm run test:db
-- (necesita DATABASE_URL apuntando a un Postgres vacío)
\set ON_ERROR_STOP on
set client_min_messages = warning;

-- Arranca limpio
truncate public.scores, public.runs, public.leagues restart identity cascade;

-- Espera un error cuyo mensaje contenga p_like
create or replace function pg_temp.expect_error(p_sql text, p_like text)
returns void
language plpgsql
as $$
begin
  execute p_sql;
  raise exception 'NO_ERROR: se esperaba un error con "%"', p_like;
exception when others then
  if sqlerrm like 'NO_ERROR:%' then
    raise;
  end if;
  if sqlerrm not ilike '%' || p_like || '%' then
    raise exception 'error distinto: "%" (se esperaba "%")', sqlerrm, p_like;
  end if;
end;
$$;

-- Crea una partida y la "atrasa" para que el control de duración la acepte
create or replace function pg_temp.run_for(p_device uuid, p_mode text default 'classic', p_age interval default '10 minutes')
returns uuid
language plpgsql
as $$
declare
  v_run uuid;
begin
  select s.run_id into v_run from public.start_run(p_device, p_mode) s;
  update public.runs set started_at = now() - p_age where id = v_run;
  return v_run;
end;
$$;

-- 1. Partida válida: queda primera y es récord personal
do $$
declare
  a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  r record;
begin
  select * into r from public.submit_score(pg_temp.run_for(a), a, '  Seba  ', 45670, 5, 120);
  assert r.world_rank = 1, format('rank esperado 1, vino %s', r.world_rank);
  assert r.players = 1;
  assert r.personal_best;
  assert r.league_rank is null;
  assert (select player from public.scores where device_id = a) = 'Seba', 'el nombre se guarda sin espacios extra';
end;
$$;

-- 2. Segundo jugador con menos puntos queda segundo; un peor intento propio no es récord
do $$
declare
  a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  b uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  r record;
begin
  select * into r from public.submit_score(pg_temp.run_for(b), b, 'Lea', 12000, 3, 40);
  assert r.world_rank = 2 and r.players = 2;
  select * into r from public.submit_score(pg_temp.run_for(a), a, 'Seba', 1000, 1, 10);
  assert not r.personal_best, 'un puntaje menor no es récord personal';
  assert r.world_rank = 1, 'el ranking usa el mejor puntaje de cada jugador';
end;
$$;

-- 3. Ranking: un renglón por jugador, ordenado, con is_me
do $$
declare
  a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  rows_ int;
  first_ record;
begin
  select count(*) into rows_ from public.get_leaderboard('global', null, a, 20);
  assert rows_ = 2, format('esperaba 2 filas, vinieron %s', rows_);
  select * into first_ from public.get_leaderboard('global', null, a, 20) order by pos limit 1;
  assert first_.player = 'Seba' and first_.score = 45670 and first_.is_me;
end;
$$;

-- 4. Validaciones y antitrampas
do $$
declare
  c uuid := 'cccccccc-0000-0000-0000-000000000003';
  v_run uuid;
begin
  v_run := pg_temp.run_for(c);
  perform pg_temp.expect_error(format('select * from public.submit_score(%L, %L, %L, 1000, 1)', v_run, c, '<script>'), 'nombre inválido');
  perform pg_temp.expect_error(format('select * from public.submit_score(%L, %L, %L, 1000, 1)', v_run, c, 'x'), 'nombre inválido');
  perform pg_temp.expect_error(format('select * from public.submit_score(%L, %L, %L, 1005, 1)', v_run, c, 'Pepe'), 'antitrampas');
  perform pg_temp.expect_error(format('select * from public.submit_score(%L, %L, %L, 999990, 1)', v_run, c, 'Pepe'), 'antitrampas');
  perform pg_temp.expect_error(format('select * from public.submit_score(%L, %L, %L, 1000, 1, 999)', v_run, c, 'Pepe'), 'antitrampas');
  perform pg_temp.expect_error(format('select * from public.submit_score(%L, %L, %L, 1000, 1)', v_run, 'dddddddd-0000-0000-0000-000000000004', 'Pepe'), 'partida inválida');
  perform pg_temp.expect_error(format('select * from public.submit_score(%L, %L, %L, 1000, 1)', gen_random_uuid(), c, 'Pepe'), 'partida inválida');
  -- Oleada 30 en 30 segundos: imposible
  v_run := pg_temp.run_for(c, 'classic', '30 seconds');
  perform pg_temp.expect_error(format('select * from public.submit_score(%L, %L, %L, 9000, 30)', v_run, c, 'Pepe'), 'antitrampas');
  -- Partida vencida
  v_run := pg_temp.run_for(c, 'classic', '7 hours');
  perform pg_temp.expect_error(format('select * from public.submit_score(%L, %L, %L, 1000, 1)', v_run, c, 'Pepe'), 'venció');
  -- Una partida se guarda una sola vez
  v_run := pg_temp.run_for(c);
  perform public.submit_score(v_run, c, 'Pepe', 2000, 1);
  perform pg_temp.expect_error(format('select * from public.submit_score(%L, %L, %L, 2000, 1)', v_run, c, 'Pepe'), 'ya se guardó');
  -- Nombres con tildes y ñ son válidos
  perform public.submit_score(pg_temp.run_for(c), c, 'Ñandú Pérez', 2100, 1);
end;
$$;

-- 5. Tu fila aparece aunque estés fuera del top
do $$
declare
  me uuid := 'eeeeeeee-0000-0000-0000-000000000005';
  i int;
  d uuid;
  cnt int;
  mine record;
begin
  for i in 1..25 loop
    d := gen_random_uuid();
    perform public.submit_score(pg_temp.run_for(d), d, 'Bot' || i, 50000 + i * 100, 5);
  end loop;
  perform public.submit_score(pg_temp.run_for(me), me, 'Yo', 100, 1);
  select count(*) into cnt from public.get_leaderboard('global', null, me, 20);
  assert cnt = 21, format('top 20 + mi fila = 21, vinieron %s', cnt);
  select * into mine from public.get_leaderboard('global', null, me, 20) where is_me;
  assert mine.pos > 20 and mine.player = 'Yo';
end;
$$;

-- 6. Ligas privadas
do $$
declare
  a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  f uuid := 'ffffffff-0000-0000-0000-000000000006';
  lg record;
  r record;
  cnt int;
begin
  select * into lg from public.create_league(a, '  Los del   Barrio ');
  assert lg.code ~ '^[A-Z2-9]{6}$', 'código de 6 caracteres sin I/O/0/1';
  assert lg.name = 'Los del Barrio';
  select * into r from public.get_league(lower(lg.code));
  assert r.name = 'Los del Barrio' and r.players = 0, 'se encuentra aunque el código venga en minúsculas';
  select * into r from public.submit_score(pg_temp.run_for(f), f, 'Fede', 3000, 2, 0, lg.code);
  assert r.league_rank = 1;
  select * into r from public.submit_score(pg_temp.run_for(a), a, 'Seba', 2000, 2, 0, lg.code);
  assert r.league_rank = 2, 'en la liga sólo cuentan los puntajes jugados en la liga';
  select count(*) into cnt from public.get_leaderboard('league', lg.code, a, 20);
  assert cnt = 2;
  assert (select players from public.get_league(lg.code)) = 2;
  perform pg_temp.expect_error(format('select * from public.submit_score(%L, %L, %L, 1000, 1, 0, %L)', pg_temp.run_for(f), f, 'Fede', 'ZZZZZZ'), 'la liga no existe');
  perform pg_temp.expect_error(format('select * from public.create_league(%L, %L)', a, 'ab'), 'nombre de liga inválido');
  assert not exists (select 1 from public.get_league('NOEXIS'));
end;
$$;

-- 7. Máximo 5 ligas por dispositivo por día
do $$
declare
  g uuid := '99999999-0000-0000-0000-000000000007';
  i int;
begin
  for i in 1..5 loop
    perform public.create_league(g, 'Liga numero ' || i);
  end loop;
  perform pg_temp.expect_error(format('select * from public.create_league(%L, %L)', g, 'Una mas'), '5 ligas');
end;
$$;

-- 8. Desafío diario: un intento por día y ranking propio
do $$
declare
  h uuid := '88888888-0000-0000-0000-000000000008';
  s record;
  r record;
  v_run uuid;
begin
  select * into s from public.start_run(h, 'daily');
  assert s.day = (now() at time zone 'utc')::date, 'el día lo decide el servidor (UTC)';
  update public.runs set started_at = now() - interval '5 minutes' where id = s.run_id;
  select * into r from public.submit_score(s.run_id, h, 'Diario', 7000, 3);
  assert r.world_rank = 1 and r.players = 1, 'el diario tiene su propio ranking';
  v_run := pg_temp.run_for(h, 'daily');
  perform pg_temp.expect_error(format('select * from public.submit_score(%L, %L, %L, 9000, 3)', v_run, h, 'Diario'), 'ya jugaste');
  assert (select count(*) from public.get_leaderboard('daily', null, h, 20)) = 1;
  assert not exists (select 1 from public.get_leaderboard('global', null, h, 20) where is_me), 'el diario no se mezcla con el mundial';
end;
$$;

-- 9. Ranking semanal: no incluye puntajes de semanas anteriores
do $$
declare
  w uuid := '77777777-0000-0000-0000-000000000009';
begin
  perform public.submit_score(pg_temp.run_for(w), w, 'Viejo', 200000, 10);
  update public.scores set created_at = now() - interval '8 days' where device_id = w;
  assert exists (select 1 from public.get_leaderboard('global', null, w, 100) where is_me);
  assert not exists (select 1 from public.get_leaderboard('week', null, w, 100) where is_me);
  assert (select count(*) from public.get_leaderboard('nada', null, w, 100)) = 0, 'ámbito desconocido no devuelve nada';
end;
$$;

-- 10. Límite de partidas por hora
do $$
declare
  z uuid := '66666666-0000-0000-0000-000000000010';
  i int;
begin
  for i in 1..60 loop
    perform public.start_run(z, 'classic');
  end loop;
  perform pg_temp.expect_error(format('select * from public.start_run(%L)', z), 'demasiadas partidas');
  perform pg_temp.expect_error(format('select * from public.start_run(%L, %L)', gen_random_uuid(), 'trampa'), 'modo de juego inválido');
end;
$$;

-- 11. Permisos: la clave pública (rol anon) no toca las tablas, sólo las funciones
set role anon;
select pg_temp.expect_error('select count(*) from public.scores', 'permission denied');
select pg_temp.expect_error('insert into public.scores (run_id, device_id, player, score, wave, duration_s) values (gen_random_uuid(), gen_random_uuid(), ''hack'', 999999, 1, 1)', 'permission denied');
select pg_temp.expect_error('update public.runs set submitted = false', 'permission denied');
select pg_temp.expect_error('select public._client_ip_hash()', 'permission denied');
do $$
begin
  assert (select count(*) from public.get_leaderboard('global', null, null, 5)) = 5, 'anon puede leer el ranking por la función';
end;
$$;
reset role;

\echo 'OK: todos los tests de la base pasaron'
