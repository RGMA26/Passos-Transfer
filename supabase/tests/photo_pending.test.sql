begin;
select plan(52);

-- 0015: foto do odômetro / print da Uber não bloqueiam turno nem Transfer; chegam depois por
-- attach_photo e, até lá, o admin vê a pendência 📷 (categoria 'photo').
-- Personas do seed: admin ad01, João d001 (company_car, carro c001), Maria d002 (own_car, c002).
-- Fixtures próprias: uuids 15xx.
alter table rides
  alter column origin_street set default 'Rua A, 1', alter column origin_district set default 'Centro',
  alter column origin_city set default 'Passos', alter column origin_state set default 'MG',
  alter column dest_street set default 'Av. B, 2', alter column dest_district set default 'Centro',
  alter column dest_city set default 'Franca', alter column dest_state set default 'SP';

insert into rides (id, driver_id, platform, ride_date, amount, client_name, transfer_status) values
  ('00000000-0000-0000-0000-0000000015a1','00000000-0000-0000-0000-00000000d001','transfer',
   (now() at time zone 'America/Sao_Paulo')::date,200,'Cli 1','assigned');

-- Turno antigo, sem foto, numa quinzena que será fechada (não vira pendência; anexar → PERIOD_CLOSED)
insert into shifts (id, driver_id, car_id, start_date, started_at, ended_at, odometer_start, odometer_end, review_status)
values ('00000000-0000-0000-0000-0000000015c9','00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-00000000c001',
        '2026-01-05','2026-01-05 10:00-03','2026-01-05 18:00-03',100,200,'approved');
insert into driver_periods (driver_id, start_date, end_date)
  select '00000000-0000-0000-0000-00000000d001','2026-01-01','2026-01-15'
  where not exists (select 1 from driver_periods where driver_id = '00000000-0000-0000-0000-00000000d001'
                      and start_date = '2026-01-01');
update driver_periods set status = 'closed', closed_at = now()
 where driver_id = '00000000-0000-0000-0000-00000000d001' and start_date = '2026-01-01';

create temp table pend as select * from admin_pendencies() limit 0;
grant all on pend to authenticated;
create function pg_temp.photo_labels(p_id uuid) returns text language sql as $$
  select coalesce(string_agg(label, ' | ' order by label), '') from pend where category = 'photo' and item_id = p_id
$$;
create function pg_temp.refresh_pend() returns void language plpgsql as $$
begin
  delete from pend;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
  insert into pend select * from admin_pendencies();
  reset role;
end $$;

-- ===== Privilégios =====
select has_function('public', 'attach_photo', array['text','uuid','text'], 'attach_photo existe');
select ok(not has_function_privilege('anon', 'attach_photo(text,uuid,text)', 'execute'), 'anon não executa attach_photo');
select ok(has_function_privilege('authenticated', 'attach_photo(text,uuid,text)', 'execute'), 'authenticated executa attach_photo');

-- ===== Turno sem foto =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
select lives_ok(
  $$select start_shift('00000000-0000-0000-0000-0000000015b1','00000000-0000-0000-0000-00000000c001',1000,null)$$,
  'inicia turno sem a foto do odômetro');
select is((select odometer_start_photo from shifts where id = '00000000-0000-0000-0000-0000000015b1'), null, 'foto inicial vazia');
select lives_ok(
  $$insert into rides (id, driver_id, platform, ride_date, amount, km, receipt_path)
    values ('00000000-0000-0000-0000-0000000015d1','00000000-0000-0000-0000-00000000d001','uber',
            (now() at time zone 'America/Sao_Paulo')::date,30,10,'00000000-0000-0000-0000-00000000d001/r.jpg')$$,
  'corrida Uber no turno');
reset role;

select pg_temp.refresh_pend();
select is(pg_temp.photo_labels('00000000-0000-0000-0000-0000000015b1'), 'Turno sem foto do odômetro (início)',
  'pendência 📷: início do turno');
select is((select item_type from pend where category = 'photo' and item_id = '00000000-0000-0000-0000-0000000015b1'),
  'shift', 'pendência 📷 é do tipo shift (abre a conferência)');
select is(pg_temp.photo_labels('00000000-0000-0000-0000-0000000015c9'), '', 'turno de quinzena fechada não é pendência');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
-- ===== Encerrar sem foto e sem print da Uber =====
select lives_ok(
  $$select end_shift('00000000-0000-0000-0000-0000000015b1',1200,null,null)$$,
  'encerra turno sem foto final e sem print da Uber');
select isnt((select ended_at from shifts where id = '00000000-0000-0000-0000-0000000015b1'), null, 'turno encerrado');
reset role;

select pg_temp.refresh_pend();
select is(pg_temp.photo_labels('00000000-0000-0000-0000-0000000015b1'),
  'Turno sem foto do odômetro (início), foto do odômetro (fim), print da Uber', 'pendência 📷 lista o que falta');

-- ===== attach_photo =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
select throws_ok(
  $$select attach_photo('shift_start','00000000-0000-0000-0000-0000000015b1','00000000-0000-0000-0000-00000000d002/aaaaaaaa-0000-0000-0000-000000000001.jpg')$$,
  'P0001', 'INVALID_PATH', 'path de outro motorista');
select throws_ok(
  $$select attach_photo('shift_start','00000000-0000-0000-0000-0000000015b1','00000000-0000-0000-0000-00000000d001/../x.jpg')$$,
  'P0001', 'INVALID_PATH', 'path fora do formato');
select throws_ok(
  $$select attach_photo('banana','00000000-0000-0000-0000-0000000015b1','00000000-0000-0000-0000-00000000d001/aaaaaaaa-0000-0000-0000-000000000001.jpg')$$,
  'P0001', 'INVALID_TARGET', 'alvo inválido');
select lives_ok(
  $$select attach_photo('shift_start','00000000-0000-0000-0000-0000000015b1','00000000-0000-0000-0000-00000000d001/aaaaaaaa-0000-0000-0000-000000000001.jpg')$$,
  'anexa a foto inicial');
select is((select odometer_start_photo from shifts where id = '00000000-0000-0000-0000-0000000015b1'),
  '00000000-0000-0000-0000-00000000d001/aaaaaaaa-0000-0000-0000-000000000001.jpg', 'foto inicial gravada');
select lives_ok(
  $$select attach_photo('shift_start','00000000-0000-0000-0000-0000000015b1','00000000-0000-0000-0000-00000000d001/aaaaaaaa-0000-0000-0000-000000000009.jpg')$$,
  'repetir o anexo não dá erro');
select is((select odometer_start_photo from shifts where id = '00000000-0000-0000-0000-0000000015b1'),
  '00000000-0000-0000-0000-00000000d001/aaaaaaaa-0000-0000-0000-000000000001.jpg', 'foto já preenchida não é trocada');
select lives_ok(
  $$select attach_photo('shift_end','00000000-0000-0000-0000-0000000015b1','00000000-0000-0000-0000-00000000d001/aaaaaaaa-0000-0000-0000-000000000002.jpg')$$,
  'anexa a foto final');
select lives_ok(
  $$select attach_photo('shift_uber','00000000-0000-0000-0000-0000000015b1','00000000-0000-0000-0000-00000000d001/aaaaaaaa-0000-0000-0000-000000000003.jpg')$$,
  'anexa o print da Uber');
select is((select odometer_end_photo || ' ' || uber_earnings_photo from shifts where id = '00000000-0000-0000-0000-0000000015b1'),
  '00000000-0000-0000-0000-00000000d001/aaaaaaaa-0000-0000-0000-000000000002.jpg 00000000-0000-0000-0000-00000000d001/aaaaaaaa-0000-0000-0000-000000000003.jpg',
  'foto final e print gravados');
select throws_ok(
  $$select attach_photo('shift_start','00000000-0000-0000-0000-0000000015c9','00000000-0000-0000-0000-00000000d001/aaaaaaaa-0000-0000-0000-000000000004.jpg')$$,
  'P0001', 'PERIOD_CLOSED', 'quinzena fechada: não anexa');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d002","role":"authenticated"}';
select throws_ok(
  $$select attach_photo('shift_end','00000000-0000-0000-0000-0000000015b1','00000000-0000-0000-0000-00000000d002/aaaaaaaa-0000-0000-0000-000000000005.jpg')$$,
  'P0001', 'NOT_FOUND', 'Maria não anexa no turno do João');
reset role;

select pg_temp.refresh_pend();
select is(pg_temp.photo_labels('00000000-0000-0000-0000-0000000015b1'), '', 'com as fotos anexadas a pendência some');

-- ===== Transfer sem foto =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
select lives_ok(
  $$select start_shift('00000000-0000-0000-0000-0000000015b2','00000000-0000-0000-0000-00000000c001',1200,'00000000-0000-0000-0000-00000000d001/s.jpg')$$,
  'novo turno (com foto)');
select is((select transfer_status from start_transfer('00000000-0000-0000-0000-0000000015a1', 1210, null)),
  'in_progress', 'inicia Transfer sem foto');
select is((select odometer_start_photo from rides where id = '00000000-0000-0000-0000-0000000015a1'), null, 'foto inicial vazia');
select is((select transfer_status from start_transfer('00000000-0000-0000-0000-0000000015a1', 1210, null)),
  'in_progress', 'repetição sem foto é idempotente');
reset role;

select pg_temp.refresh_pend();
select is(pg_temp.photo_labels('00000000-0000-0000-0000-0000000015a1'), 'Transfer sem foto do odômetro (início)',
  'pendência 📷: início do Transfer');
select is((select item_type from pend where category = 'photo' and item_id = '00000000-0000-0000-0000-0000000015a1'),
  'transfer', 'pendência 📷 do Transfer');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
select is((select transfer_status || '/' || km from complete_transfer('00000000-0000-0000-0000-0000000015a1', 1250, '  ')),
  'completed/40.0', 'conclui Transfer sem foto');
select is((select odometer_end_photo from rides where id = '00000000-0000-0000-0000-0000000015a1'), null, 'foto final vazia (branco vira nulo)');
reset role;

select pg_temp.refresh_pend();
select is(pg_temp.photo_labels('00000000-0000-0000-0000-0000000015a1'),
  'Transfer sem foto do odômetro (início), foto do odômetro (fim)', 'pendência 📷: início e fim');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
select lives_ok(
  $$select attach_photo('transfer_start','00000000-0000-0000-0000-0000000015a1','00000000-0000-0000-0000-00000000d001/aaaaaaaa-0000-0000-0000-000000000006.jpg')$$,
  'anexa foto inicial do Transfer (passa pelo guarda de campos do Transfer)');
select lives_ok(
  $$select attach_photo('transfer_end','00000000-0000-0000-0000-0000000015a1','00000000-0000-0000-0000-00000000d001/aaaaaaaa-0000-0000-0000-000000000007.jpg')$$,
  'anexa foto final do Transfer');
select is((select odometer_start_photo || ' ' || odometer_end_photo || ' ' || transfer_status || ' ' || km
             from rides where id = '00000000-0000-0000-0000-0000000015a1'),
  '00000000-0000-0000-0000-00000000d001/aaaaaaaa-0000-0000-0000-000000000006.jpg 00000000-0000-0000-0000-00000000d001/aaaaaaaa-0000-0000-0000-000000000007.jpg completed 40.0',
  'fotos do Transfer gravadas, resto intacto');
select throws_ok(
  $$select attach_photo('transfer_start','00000000-0000-0000-0000-0000000015d1','00000000-0000-0000-0000-00000000d001/aaaaaaaa-0000-0000-0000-000000000008.jpg')$$,
  'P0001', 'NOT_FOUND', 'corrida Uber não é Transfer');
reset role;

select pg_temp.refresh_pend();
select is(pg_temp.photo_labels('00000000-0000-0000-0000-0000000015a1'), '', 'pendência do Transfer some');

-- ===== Quem chama =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
select throws_ok(
  $$select attach_photo('shift_start','00000000-0000-0000-0000-0000000015b2','00000000-0000-0000-0000-00000000ad01/aaaaaaaa-0000-0000-0000-000000000001.jpg')$$,
  'P0001', 'FORBIDDEN', 'admin não usa attach_photo');
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$select attach_photo('shift_start','00000000-0000-0000-0000-0000000015b2','x/y.jpg')$$,
  '42501', null, 'anon barrado');
reset role;

-- turno sem Uber, encerrado sem foto: só o fim falta
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
select lives_ok($$select end_shift('00000000-0000-0000-0000-0000000015b2',1300,'',null)$$, 'encerra turno sem Uber, sem foto final');
reset role;
select pg_temp.refresh_pend();
select is(pg_temp.photo_labels('00000000-0000-0000-0000-0000000015b2'), 'Turno sem foto do odômetro (fim)',
  'sem Uber no turno não cobra print');
select is((select count(*)::int from pend where category = 'photo'), 1, 'só essa pendência 📷 sobra');

-- ===== Repetição (offline) com a foto: preenche só a coluna vazia =====
insert into rides (id, driver_id, platform, ride_date, amount, client_name, transfer_status) values
  ('00000000-0000-0000-0000-0000000015a2','00000000-0000-0000-0000-00000000d001','transfer',
   (now() at time zone 'America/Sao_Paulo')::date,200,'Cli 2','assigned');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
select start_shift('00000000-0000-0000-0000-0000000015b3','00000000-0000-0000-0000-00000000c001',1300,null);
select is((select odometer_start_photo from start_shift('00000000-0000-0000-0000-0000000015b3','00000000-0000-0000-0000-00000000c001',1300,'d001/s1.jpg')),
  'd001/s1.jpg', 'start_shift repetido com foto preenche a foto vazia');
select is((select odometer_start_photo from start_shift('00000000-0000-0000-0000-0000000015b3','00000000-0000-0000-0000-00000000c001',1300,'d001/s2.jpg')),
  'd001/s1.jpg', 'start_shift repetido não troca foto já preenchida');

select start_transfer('00000000-0000-0000-0000-0000000015a2', 1310, null);
select is((select odometer_start_photo from start_transfer('00000000-0000-0000-0000-0000000015a2', 1310, 'd001/t1.jpg')),
  'd001/t1.jpg', 'start_transfer repetido com foto preenche a foto vazia');
select is((select odometer_start_photo from start_transfer('00000000-0000-0000-0000-0000000015a2', 1310, 'd001/t2.jpg')),
  'd001/t1.jpg', 'start_transfer repetido não troca foto já preenchida');

select complete_transfer('00000000-0000-0000-0000-0000000015a2', 1320, null);
select is((select odometer_end_photo from complete_transfer('00000000-0000-0000-0000-0000000015a2', 1320, 'd001/c1.jpg')),
  'd001/c1.jpg', 'complete_transfer repetido com foto preenche a foto vazia');
select is((select odometer_end_photo from complete_transfer('00000000-0000-0000-0000-0000000015a2', 1320, 'd001/c2.jpg')),
  'd001/c1.jpg', 'complete_transfer repetido não troca foto já preenchida');

select end_shift('00000000-0000-0000-0000-0000000015b3', 1400, null, null);
select end_shift('00000000-0000-0000-0000-0000000015b3', 1400, 'd001/e1.jpg', 'd001/u1.jpg');
select is((select odometer_end_photo || ' ' || uber_earnings_photo from shifts where id = '00000000-0000-0000-0000-0000000015b3'),
  'd001/e1.jpg d001/u1.jpg', 'end_shift repetido com fotos preenche foto final e print vazios');
select end_shift('00000000-0000-0000-0000-0000000015b3', 1400, 'd001/e2.jpg', 'd001/u2.jpg');
select is((select odometer_end_photo || ' ' || uber_earnings_photo from shifts where id = '00000000-0000-0000-0000-0000000015b3'),
  'd001/e1.jpg d001/u1.jpg', 'end_shift repetido não troca fotos já preenchidas');
reset role;

select * from finish();
rollback;
