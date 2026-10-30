begin;
select plan(12);

select setval('driver_seq', 1, false);

select is(generate_login_code('João da Silva'), 'PASSOS01JOAO', 'primeiro código');
select is(generate_login_code('maria'), 'PASSOS02MARIA', 'segundo código');
select throws_ok($$select generate_login_code('123 ---')$$, 'P0001', 'INVALID_NAME', 'nome vazio rejeitado');
select is(generate_login_code('Zé'), 'PASSOS03ZE', 'falha não consome sequência');

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000a3');

insert into profiles (id, role, login_code, seq_number, name, driver_type, transfer_pct, uber_pct) values
  ('00000000-0000-0000-0000-0000000000a1','driver','d1',1,'A','company_car',30,40),
  ('00000000-0000-0000-0000-0000000000a2','driver','d2',2,'B','own_car',25,null),
  ('00000000-0000-0000-0000-0000000000a3','driver','d3',3,'C','company_car',30,40);

insert into cars (id, model, plate, consumption_km_l, ownership) values
  ('00000000-0000-0000-0000-0000000000c1','Onix','AAA0A00',10,'company'),
  ('00000000-0000-0000-0000-0000000000c2','HB20','BBB0B00',12.5,'own');

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

insert into shifts (id, driver_id, car_id, consumption_km_l, start_date, odometer_start)
values ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000c1',10,current_date,100);

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
  $$select driver_pct, consumption_km_l from rides where id = '00000000-0000-0000-0000-0000000000d3'$$,
  $$values (25.00::numeric, 12.50::numeric)$$,
  'transfer reatribuído: pct 25 e consumo 12.5');

-- audit
select results_eq(
  $$select old_data->>'uber_pct', new_data->>'uber_pct', action from audit_log
    where table_name = 'profiles' and action = 'UPDATE'
      and row_id = '00000000-0000-0000-0000-0000000000a1'$$,
  $$values ('40.00','50.00','UPDATE')$$,
  'audit_log registra old/new');

select is((select count(*)::int from audit_log where table_name='rides' and action='INSERT'), 3, 'audit de insert em rides');

select * from finish();
rollback;
