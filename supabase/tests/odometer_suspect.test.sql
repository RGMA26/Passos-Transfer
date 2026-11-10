begin;
select plan(24);

-- 0019: leitura fora do normal (odometer_suspect, não bloqueia) e end_shift × leituras dos Transfers.
-- Suspeito quando (a) a leitura inicial passa mais de 1.000 km da última leitura do carro, (b) o Transfer
-- rodou mais de 1.000 km ou (c) o turno rodou mais de 1.500 km. Vira pendência 🟠 "Odômetro fora do normal".
-- Personas do seed: admin ad01, João d001 (company_car). Fixtures próprias: uuids 39xx, carros próprios.

insert into cars (id, model, plate, fuels, km_per_l_gasolina, ownership) values
  ('00000000-0000-0000-0000-0000000039c1','Polo','POL1A19','{gasolina,alcool}',10,'company'),
  ('00000000-0000-0000-0000-0000000039c2','Gol','GOL2A19','{gasolina,alcool}',10,'company'),
  ('00000000-0000-0000-0000-0000000039c3','Uno','UNO3A19','{gasolina,alcool}',10,'company'),
  ('00000000-0000-0000-0000-0000000039c4','Ka','KAA4A19','{gasolina,alcool}',10,'company'),
  ('00000000-0000-0000-0000-0000000039c5','Fox','FOX5A19','{gasolina,alcool}',10,'company');

-- ===== Esquema =====
select has_column('public', 'shifts', 'odometer_suspect', 'shifts.odometer_suspect');
select has_column('public', 'rides', 'odometer_suspect', 'rides.odometer_suspect');

-- Carro 1 (o caso de produção): turno 57.876 → 57.877 e Transfer 1.010.000 → 10.102.500 dentro dele
insert into shifts (id, driver_id, car_id, start_date, odometer_start, ended_at, odometer_end) values
  ('00000000-0000-0000-0000-0000000039e1','00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-0000000039c1',
   '2026-03-05',57876,'2026-03-05 18:00-03',57877);
insert into rides (id, driver_id, platform, ride_date, scheduled_at, amount, client_name, transfer_status,
    origin_street, origin_district, origin_city, origin_state, dest_street, dest_district, dest_city, dest_state,
    car_id, shift_id, odometer_start, odometer_end, started_at, km) values
  ('00000000-0000-0000-0000-0000000039a1','00000000-0000-0000-0000-00000000d001','transfer','2026-03-05','2026-03-05 10:00-03',200,'Cli A','completed',
   'Rua A, 1','Centro','Passos','MG','Av. B, 2','Centro','Franca','SP',
   '00000000-0000-0000-0000-0000000039c1','00000000-0000-0000-0000-0000000039e1',1010000,10102500,'2026-03-05 10:00-03',9092500);
select is((select odometer_suspect from shifts where id = '00000000-0000-0000-0000-0000000039e1'), false, 'turno normal não é suspeito');
select is((select odometer_suspect from rides where id = '00000000-0000-0000-0000-0000000039a1'), true, 'Transfer 1.010.000 → 10.102.500 é suspeito');

-- Carro 2: (a) início de turno mais de 1.000 km acima da última leitura; 1.000 exatos não
insert into shifts (id, driver_id, car_id, start_date, odometer_start, ended_at, odometer_end) values
  ('00000000-0000-0000-0000-0000000039e2','00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-0000000039c2',
   '2026-03-06',1000,'2026-03-06 18:00-03',1100);
insert into shifts (id, driver_id, car_id, start_date, odometer_start, ended_at, odometer_end) values
  ('00000000-0000-0000-0000-0000000039e3','00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-0000000039c2',
   '2026-03-07',2100,'2026-03-07 18:00-03',2150);
insert into shifts (id, driver_id, car_id, start_date, odometer_start, ended_at, odometer_end) values
  ('00000000-0000-0000-0000-0000000039e4','00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-0000000039c2',
   '2026-03-08',5000,'2026-03-08 18:00-03',5050);
select is((select odometer_suspect from shifts where id = '00000000-0000-0000-0000-0000000039e3'), false, '1.000 km acima da última: normal');
select is((select odometer_suspect from shifts where id = '00000000-0000-0000-0000-0000000039e4'), true, '(a) início 2.850 km acima da última: suspeito');

-- Carro 3: (c) turno com mais de 1.500 km; 1.500 exatos não
insert into shifts (id, driver_id, car_id, start_date, odometer_start, ended_at, odometer_end) values
  ('00000000-0000-0000-0000-0000000039e5','00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-0000000039c3',
   '2026-03-06',1000,'2026-03-06 18:00-03',2500),
  ('00000000-0000-0000-0000-0000000039e6','00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-0000000039c3',
   '2026-03-07',2500,'2026-03-07 18:00-03',4001);
select is((select odometer_suspect from shifts where id = '00000000-0000-0000-0000-0000000039e5'), false, 'turno de 1.500 km: normal');
select is((select odometer_suspect from shifts where id = '00000000-0000-0000-0000-0000000039e6'), true, '(c) turno de 1.501 km: suspeito');

-- Carro 4: (b) Transfer com mais de 1.000 km; 1.000 exatos não
insert into rides (id, driver_id, platform, ride_date, scheduled_at, amount, client_name, transfer_status,
    origin_street, origin_district, origin_city, origin_state, dest_street, dest_district, dest_city, dest_state,
    car_id, odometer_start, odometer_end, started_at, km) values
  ('00000000-0000-0000-0000-0000000039a2','00000000-0000-0000-0000-00000000d001','transfer','2026-03-06','2026-03-06 10:00-03',200,'Cli B','completed',
   'Rua A, 1','Centro','Passos','MG','Av. B, 2','Centro','Franca','SP',
   '00000000-0000-0000-0000-0000000039c4',100,1100,'2026-03-06 10:00-03',1000),
  ('00000000-0000-0000-0000-0000000039a3','00000000-0000-0000-0000-00000000d001','transfer','2026-03-07','2026-03-07 10:00-03',200,'Cli C','completed',
   'Rua A, 1','Centro','Passos','MG','Av. B, 2','Centro','Franca','SP',
   '00000000-0000-0000-0000-0000000039c4',1100,2101,'2026-03-07 10:00-03',1001);
select is((select odometer_suspect from rides where id = '00000000-0000-0000-0000-0000000039a2'), false, 'Transfer de 1.000 km: normal');
select is((select odometer_suspect from rides where id = '00000000-0000-0000-0000-0000000039a3'), true, '(b) Transfer de 1.001 km: suspeito');

-- a marca é do servidor: não dá para gravar à mão
update shifts set odometer_suspect = true where id = '00000000-0000-0000-0000-0000000039e2';
select is((select odometer_suspect from shifts where id = '00000000-0000-0000-0000-0000000039e2'), false, 'marca não é gravada à mão');

-- quinzena fechada (01–15/01) com turno suspeito: fora da central de pendências
insert into shifts (id, driver_id, car_id, start_date, odometer_start, ended_at, odometer_end) values
  ('00000000-0000-0000-0000-0000000039e7','00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-0000000039c5',
   '2026-01-05',1000,'2026-01-05 18:00-03',9000);
insert into driver_periods (driver_id, start_date, end_date)
  select '00000000-0000-0000-0000-00000000d001','2026-01-01','2026-01-15'
  where not exists (select 1 from driver_periods where driver_id = '00000000-0000-0000-0000-00000000d001'
                      and start_date = '2026-01-01');
update driver_periods set status = 'closed', closed_at = now()
 where driver_id = '00000000-0000-0000-0000-00000000d001' and start_date = '2026-01-01';

-- ===== Central de pendências (admin) =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';

select ok(exists (select 1 from admin_pendencies() p where p.category = 'orange' and p.item_type = 'transfer'
                    and p.item_id = '00000000-0000-0000-0000-0000000039a1' and p.label = 'Odômetro fora do normal'),
  'Transfer suspeito vira pendência 🟠');
select ok(exists (select 1 from admin_pendencies() p where p.category = 'orange' and p.item_type = 'shift'
                    and p.item_id = '00000000-0000-0000-0000-0000000039e6' and p.label = 'Odômetro fora do normal'),
  'turno suspeito vira pendência 🟠');
select ok(not exists (select 1 from admin_pendencies() p where p.category = 'orange'
                        and p.item_id = '00000000-0000-0000-0000-0000000039e5'),
  'turno normal não vira pendência 🟠');
select ok(not exists (select 1 from admin_pendencies() p where p.category = 'orange'
                        and p.item_id = '00000000-0000-0000-0000-0000000039e7'),
  'quinzena fechada fica fora');

-- correção pelo admin recalcula a marca
select lives_ok($$select admin_fix_transfer_odometer('00000000-0000-0000-0000-0000000039a1', 57876, 57877)$$,
  'admin corrige o Transfer do caso de produção');
select is((select odometer_suspect from rides where id = '00000000-0000-0000-0000-0000000039a1'), false, 'corrigido deixa de ser suspeito');
select ok(not exists (select 1 from admin_pendencies() p where p.category = 'orange'
                        and p.item_id = '00000000-0000-0000-0000-0000000039a1'),
  'corrigido sai da central de pendências');

-- ===== end_shift × leituras dos Transfers do turno (motorista, pelas RPCs) =====
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
select lives_ok(
  $$select start_shift('00000000-0000-0000-0000-0000000039e8','00000000-0000-0000-0000-0000000039c5',20000,'s.jpg')$$,
  'inicia turno');
reset role;
insert into rides (id, driver_id, platform, ride_date, scheduled_at, amount, client_name, transfer_status,
    origin_street, origin_district, origin_city, origin_state, dest_street, dest_district, dest_city, dest_state) values
  ('00000000-0000-0000-0000-0000000039a4','00000000-0000-0000-0000-00000000d001','transfer',
   (now() at time zone 'America/Sao_Paulo')::date, now(),200,'Cli D','assigned',
   'Rua A, 1','Centro','Passos','MG','Av. B, 2','Centro','Franca','SP');
set local role authenticated;
select lives_ok(
  $$select start_transfer('00000000-0000-0000-0000-0000000039a4', 20010, 't.jpg')$$, 'inicia Transfer no turno');
select lives_ok(
  $$select complete_transfer('00000000-0000-0000-0000-0000000039a4', 20100, 't.jpg')$$, 'conclui Transfer em 20.100');
select throws_ok(
  $$select end_shift('00000000-0000-0000-0000-0000000039e8', 20050, 'e.jpg', null)$$,
  'P0001', 'ODOMETER_BELOW_LAST', 'final do turno abaixo da leitura do Transfer');
select lives_ok(
  $$select end_shift('00000000-0000-0000-0000-0000000039e8', 20100, 'e.jpg', null)$$,
  'final igual à maior leitura do Transfer');
select is((select odometer_end from shifts where id = '00000000-0000-0000-0000-0000000039e8'), 20100, 'turno encerrado');

select * from finish();
rollback;
