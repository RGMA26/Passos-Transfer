begin;
select plan(15);
-- Endereço padrão dos Transfers destas fixtures (check de origem/destino da 0012; revertido no rollback).
-- O check em si é testado em transfer_flow.test.sql.
alter table rides
  alter column origin_street set default 'Rua A, 1', alter column origin_district set default 'Centro',
  alter column origin_city set default 'Passos', alter column origin_state set default 'MG',
  alter column dest_street set default 'Av. B, 2', alter column dest_district set default 'Centro',
  alter column dest_city set default 'Franca', alter column dest_state set default 'SP';
-- isola dos dados do seed.sql (revertido no rollback)
update cars set current_driver_id = null;
update profiles set current_car_id = null;
delete from profiles;
delete from cars;
delete from auth.users;

select setval('driver_seq', 1, false);

select is(generate_login_code('João da Silva'), 'PASSOS01JOAO', 'primeiro código');
select is(generate_login_code('maria'), 'PASSOS02MARIA', 'segundo código');
select throws_ok($$select generate_login_code('123 ---')$$, 'P0001', 'INVALID_NAME', 'nome vazio rejeitado');
select is(generate_login_code('Zé'), 'PASSOS03ZE', 'falha não consome sequência');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000a3');

insert into profiles (id, role, login_code, seq_number, name, driver_type, transfer_pct, uber_pct, cpf, cycle_start_date) values
  ('00000000-0000-0000-0000-0000000000a1','driver','d1',1,'A','company_car',30,40,'10000000957','2026-01-01'),
  ('00000000-0000-0000-0000-0000000000a2','driver','d2',2,'B','own_car',25,null,'10000001171','2026-01-01'),
  ('00000000-0000-0000-0000-0000000000a3','driver','d3',3,'C','company_car',30,40,'10000001252','2026-01-01');

insert into cars (id, model, plate, fuel_type, km_per_l_gasolina, ownership) values
  ('00000000-0000-0000-0000-0000000000c1','Onix','AAA0A00','flex',10,'company'),
  ('00000000-0000-0000-0000-0000000000c2','HB20','BBB0B00','flex',12.5,'own');

update profiles set current_car_id = '00000000-0000-0000-0000-0000000000c2'
 where id = '00000000-0000-0000-0000-0000000000a2';

-- uber sem turno aberto
select throws_ok(
  $$insert into rides (driver_id, platform, ride_date, amount)
    values ('00000000-0000-0000-0000-0000000000a1','uber',current_date,50)$$,
  'P0001', 'NO_OPEN_SHIFT', 'uber sem turno aberto');

-- uber de own_car
select throws_ok(
  $$insert into rides (driver_id, platform, ride_date, amount)
    values ('00000000-0000-0000-0000-0000000000a2','uber',current_date,50)$$,
  'P0001', 'PLATFORM_NOT_ALLOWED', 'uber own_car recusado');

insert into shifts (id, driver_id, car_id, start_date, odometer_start)
values ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000c1',current_date,100);

-- turno de outro motorista não serve
select throws_ok(
  $$insert into rides (driver_id, shift_id, platform, ride_date, amount)
    values ('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000f1','uber',current_date,50)$$,
  'P0001', 'NO_OPEN_SHIFT', 'shift_id de outro motorista recusado');

insert into rides (id, driver_id, platform, ride_date, amount)
values ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000a1','uber',current_date,50);

select results_eq(
  $$select driver_pct, shift_id from rides where id = '00000000-0000-0000-0000-0000000000d1'$$,
  $$values (40.00::numeric, '00000000-0000-0000-0000-0000000000f1'::uuid)$$,
  'uber: pct 40 e turno preenchido');

update profiles set uber_pct = 50 where id = '00000000-0000-0000-0000-0000000000a1';

insert into rides (id, driver_id, platform, ride_date, amount)
values ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000a1','uber',current_date,50);

select results_eq(
  $$select id::text, driver_pct from rides where id in ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000d2') order by id$$,
  $$values ('00000000-0000-0000-0000-0000000000d1', 40.00::numeric), ('00000000-0000-0000-0000-0000000000d2', 50.00::numeric)$$,
  'nova corrida 50, antiga continua 40');

-- transfer reatribuído
insert into rides (id, driver_id, platform, ride_date, amount, client_name, transfer_status)
values ('00000000-0000-0000-0000-0000000000d3','00000000-0000-0000-0000-0000000000a3','transfer',current_date,200,'Cli','assigned');
update rides set driver_id = '00000000-0000-0000-0000-0000000000a2'
 where id = '00000000-0000-0000-0000-0000000000d3';

select results_eq(
  $$select driver_pct from rides where id = '00000000-0000-0000-0000-0000000000d3'$$,
  $$values (25.00::numeric)$$,
  'transfer reatribuído: pct 25');

-- edição após fim do turno
update shifts set ended_at = now(), odometer_end = 150
 where id = '00000000-0000-0000-0000-0000000000f1';
select lives_ok(
  $$update rides set amount = 75 where id = '00000000-0000-0000-0000-0000000000d1'$$,
  'editar corrida após fim do turno');
select results_eq(
  $$select amount, shift_id from rides where id = '00000000-0000-0000-0000-0000000000d1'$$,
  $$values (75.00::numeric, '00000000-0000-0000-0000-0000000000f1'::uuid)$$,
  'valor atualizado e turno inalterado');

-- audit
select results_eq(
  $$select old_data->>'uber_pct', new_data->>'uber_pct', action from audit_log
    where table_name = 'profiles' and action = 'UPDATE'
      and row_id = '00000000-0000-0000-0000-0000000000a1'$$,
  $$values ('40.00','50.00','UPDATE')$$,
  'audit_log registra old/new');

select is((select count(*)::int from audit_log where table_name='rides' and action='INSERT'), 3, 'audit de insert em rides');

select setval('driver_seq', 100, false);
select is(generate_login_code('Ana'), 'PASSOS100ANA', 'código com 3 dígitos não trunca');

select * from finish();
rollback;
