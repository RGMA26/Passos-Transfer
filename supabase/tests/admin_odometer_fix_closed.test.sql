begin;
select plan(17);

-- 0019: correção de odômetro pelo admin em quinzena FECHADA (saída de emergência).
-- admin_fix_transfer_odometer e admin_fix_shift_odometer passam pelo block_closed_period só para as
-- colunas de leitura (+ km e marca de suspeita); o extrato congelado não muda e o carro destrava.
-- Personas do seed: admin ad01, João d001 (company_car, ciclo desde 2026-01-01). Fixtures: uuids 49xx.

insert into cars (id, model, plate, fuels, km_per_l_gasolina, ownership) values
  ('00000000-0000-0000-0000-0000000049c1','Polo','POL1A49','{gasolina,alcool}',10,'company');

insert into shifts (id, driver_id, car_id, start_date, odometer_start, odometer_start_photo, ended_at, odometer_end,
                    odometer_end_photo, review_status) values
  ('00000000-0000-0000-0000-0000000049e1','00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-0000000049c1',
   '2026-02-03',57876,'a.jpg','2026-02-03 18:00-03',57877,'b.jpg','approved');
insert into rides (id, driver_id, platform, ride_date, scheduled_at, amount, client_name, transfer_status,
    origin_street, origin_district, origin_city, origin_state, dest_street, dest_district, dest_city, dest_state,
    car_id, shift_id, odometer_start, odometer_start_photo, odometer_end, odometer_end_photo, started_at, km) values
  ('00000000-0000-0000-0000-0000000049a1','00000000-0000-0000-0000-00000000d001','transfer','2026-02-03','2026-02-03 10:00-03',200,'Cli A','checked',
   'Rua A, 1','Centro','Passos','MG','Av. B, 2','Centro','Franca','SP',
   '00000000-0000-0000-0000-0000000049c1','00000000-0000-0000-0000-0000000049e1',1010000,'c.jpg',9102500,'d.jpg','2026-02-03 10:00-03',8092500);

-- ===== Privilégios da RPC do turno =====
select has_function('public', 'admin_fix_shift_odometer', array['uuid','integer','integer'], 'admin_fix_shift_odometer existe');
select ok(not has_function_privilege('anon', 'admin_fix_shift_odometer(uuid,int,int)', 'execute'), 'anon não executa');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
select throws_ok($$select admin_fix_shift_odometer('00000000-0000-0000-0000-0000000049e1', 57876, 57900)$$,
  'P0001', 'FORBIDDEN', 'motorista não corrige turno pelo admin');

-- ===== Fecha a quinzena de fevereiro (1ª) com o Transfer errado dentro =====
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
select lives_ok($$select close_driver_period(driver_period_for('00000000-0000-0000-0000-00000000d001', '2026-02-03'), false, true)$$,
  'quinzena fechada');
reset role;
create temp table snap as
  select s.id, to_jsonb(s) as j from statements s
   where s.driver_period_id = driver_period_for('00000000-0000-0000-0000-00000000d001', '2026-02-03');
grant select on snap to authenticated;
set local role authenticated;
select is((select count(*)::int from snap), 1, 'extrato congelado existe');

-- o carro está travado pela leitura errada
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
select throws_ok(
  $$select start_shift('00000000-0000-0000-0000-0000000049e2','00000000-0000-0000-0000-0000000049c1',57900,'s.jpg')$$,
  'P0001', 'ODOMETER_BELOW_LAST', 'carro travado pela leitura errada');

-- ===== Admin corrige em quinzena fechada =====
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
select throws_ok($$select unreview_item('transfer', '00000000-0000-0000-0000-0000000049a1')$$,
  'P0001', 'PERIOD_CLOSED', 'desfazer conferência continua barrado na quinzena fechada');
select lives_ok($$select admin_fix_transfer_odometer('00000000-0000-0000-0000-0000000049a1', 57876, 57877)$$,
  'Transfer conferido em quinzena fechada: corrige o odômetro');
select is((select odometer_start || '|' || odometer_end || '|' || km::text || '|' || transfer_status || '|' || amount::text
             || '|' || odometer_suspect::text from rides where id = '00000000-0000-0000-0000-0000000049a1'),
  '57876|57877|1.0|checked|200.00|false', 'só leituras, km e marca mudam');
select is((select to_jsonb(s) from statements s join snap on snap.id = s.id), (select j from snap),
  'extrato congelado não muda');
select throws_ok($$update rides set amount = 1 where id = '00000000-0000-0000-0000-0000000049a1'$$,
  'P0001', 'PERIOD_CLOSED', 'outras colunas continuam travadas');

select throws_ok($$select admin_fix_shift_odometer('00000000-0000-0000-0000-0000000049e1', 57900, 57800)$$,
  'P0001', 'ODOMETER_BELOW_START', 'turno: final menor que o inicial');
select throws_ok($$select admin_fix_shift_odometer('00000000-0000-0000-0000-0000000049e1', 57876, 10000000)$$,
  'P0001', 'INVALID_ODOMETER', 'turno: acima de 9.999.999');
select lives_ok($$select admin_fix_shift_odometer('00000000-0000-0000-0000-0000000049e1', 57876, 57880)$$,
  'turno em quinzena fechada: corrige o odômetro');
select is((select odometer_end::text || '|' || review_status from shifts where id = '00000000-0000-0000-0000-0000000049e1'),
  '57880|approved', 'turno: só a leitura muda');
select is((select to_jsonb(s) from statements s join snap on snap.id = s.id), (select j from snap),
  'extrato congelado continua igual');

-- o carro destrava
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
select lives_ok(
  $$select start_shift('00000000-0000-0000-0000-0000000049e2','00000000-0000-0000-0000-0000000049c1',57900,'s.jpg')$$,
  'carro destravado: novo turno em 57.900');

select * from finish();
rollback;
