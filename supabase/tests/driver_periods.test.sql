begin;
select plan(47);
-- Endereço padrão dos Transfers destas fixtures (check de origem/destino da 0012; revertido no rollback).
-- O check em si é testado em transfer_flow.test.sql.
alter table rides
  alter column origin_street set default 'Rua A, 1', alter column origin_district set default 'Centro',
  alter column origin_city set default 'Passos', alter column origin_state set default 'MG',
  alter column dest_street set default 'Av. B, 2', alter column dest_district set default 'Centro',
  alter column dest_city set default 'Franca', alter column dest_state set default 'SP';

-- Fixtures próprias (uuids 1xxx). Admin do seed: ad01.
-- A (1a01) e B (1a02): cadastro 2026-11-10, carro próprio | C (1a03): cadastro 2026-12-31
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000001a01'), ('00000000-0000-0000-0000-000000001a02'),
  ('00000000-0000-0000-0000-000000001a03'), ('00000000-0000-0000-0000-000000001a04'),
  ('00000000-0000-0000-0000-000000001a05');

insert into cars (id, model, plate, fuel_type, km_per_l_gasolina, ownership) values
  ('00000000-0000-0000-0000-000000001c01','Gol','DPR0A01','flex',12,'own');

-- ===== Tabelas/funções removidas e criadas =====
select has_table('public', 'driver_periods', 'driver_periods existe');
select hasnt_table('public', 'periods', 'periods removida');
select hasnt_function('public', 'period_for_date', array['date'], 'period_for_date removida');
select hasnt_function('public', 'period_drivers', array['uuid'], 'period_drivers removida');
select hasnt_function('public', 'period_summary', array['uuid'], 'period_summary removida');
select hasnt_column('public', 'statements', 'period_id', 'statements.period_id removida');
select hasnt_column('public', 'adjustments', 'period_id', 'adjustments.period_id removida');
select ok(not has_function_privilege('anon', 'driver_period_for(uuid,date)', 'execute'), 'anon não executa driver_period_for');
select ok(has_function_privilege('authenticated', 'driver_period_for(uuid,date)', 'execute'), 'authenticated executa driver_period_for');

-- ===== CPF =====
select is(is_valid_cpf('529.982.247-25'), true, 'CPF válido com máscara');
select is(is_valid_cpf('52998224725'), true, 'CPF válido só dígitos');
select is(is_valid_cpf('111.111.111-11'), false, 'todos iguais rejeitado');
select is(is_valid_cpf('12345678900'), false, 'dígito verificador errado');
select is(is_valid_cpf('5299822472'), false, '10 dígitos rejeitado');

select throws_ok(
  $$insert into profiles (id, role, login_code, seq_number, name, driver_type, transfer_pct)
    values ('00000000-0000-0000-0000-000000001a01','driver','dp-01',9801,'A','own_car',30)$$,
  '23514', null, 'motorista sem CPF rejeitado');
select throws_ok(
  $$insert into profiles (id, role, login_code, seq_number, name, driver_type, transfer_pct, cpf)
    values ('00000000-0000-0000-0000-000000001a01','driver','dp-01',9801,'A','own_car',30,'12345678900')$$,
  '23514', null, 'CPF inválido rejeitado');

insert into profiles (id, role, login_code, seq_number, name, driver_type, transfer_pct, current_car_id, cpf, cycle_start_date) values
  ('00000000-0000-0000-0000-000000001a01','driver','dp-01',9801,'A','own_car',30,'00000000-0000-0000-0000-000000001c01','10000000108','2026-11-10'),
  ('00000000-0000-0000-0000-000000001a02','driver','dp-02',9802,'B','own_car',30,'00000000-0000-0000-0000-000000001c01','10000000280','2026-11-10'),
  ('00000000-0000-0000-0000-000000001a03','driver','dp-03',9803,'C','own_car',30,'00000000-0000-0000-0000-000000001c01','10000000361','2026-12-31');

select throws_ok(
  $$insert into profiles (id, role, login_code, seq_number, name, driver_type, transfer_pct, cpf)
    values ('00000000-0000-0000-0000-000000001a04','driver','dp-04',9804,'D','own_car',30,'10000000108')$$,
  '23505', null, 'CPF duplicado rejeitado');

-- cycle_start_date padrão = data de SP do created_at (01:00 UTC de 01/03 = 28/02 em SP)
insert into profiles (id, created_at, role, login_code, seq_number, name, driver_type, transfer_pct, cpf) values
  ('00000000-0000-0000-0000-000000001a05','2026-03-01 01:00+00','driver','dp-05',9805,'E','own_car',30,'10000000442');
select is((select cycle_start_date from profiles where id = '00000000-0000-0000-0000-000000001a05'), '2026-02-28'::date,
  'cycle_start_date padrão = data de SP do cadastro');
select is((select paused from profiles where id = '00000000-0000-0000-0000-000000001a05'), false, 'paused padrão false');

-- ===== Ciclo de 15 dias =====
create temp table p_a1 as select driver_period_for('00000000-0000-0000-0000-000000001a01', '2026-11-24') as id;
create temp table p_a2 as select driver_period_for('00000000-0000-0000-0000-000000001a01', '2026-11-25') as id;
create temp table p_c1 as select driver_period_for('00000000-0000-0000-0000-000000001a03', '2027-01-14') as id;
create temp table p_c2 as select driver_period_for('00000000-0000-0000-0000-000000001a03', '2027-01-15') as id;

select results_eq($$select start_date, end_date, status from driver_periods where id = (select id from p_a1)$$,
  $$values ('2026-11-10'::date, '2026-11-24'::date, 'open'::text)$$, '24/11 cai na 1ª quinzena (10/11–24/11)');
select results_eq($$select start_date, end_date from driver_periods where id = (select id from p_a2)$$,
  $$values ('2026-11-25'::date, '2026-12-09'::date)$$, '25/11 abre a 2ª quinzena (25/11–09/12, vira o mês)');
select results_eq($$select start_date, end_date from driver_periods where id = (select id from p_c1)$$,
  $$values ('2026-12-31'::date, '2027-01-14'::date)$$, 'cadastro 31/12: 14/01 na 1ª quinzena (vira o ano)');
select results_eq($$select start_date, end_date from driver_periods where id = (select id from p_c2)$$,
  $$values ('2027-01-15'::date, '2027-01-29'::date)$$, 'cadastro 31/12: 15/01 na 2ª quinzena');
select is(driver_period_for('00000000-0000-0000-0000-000000001a01', '2026-11-24'), (select id from p_a1), 'mesma data → mesmo id');
select is(driver_period_for('00000000-0000-0000-0000-000000001a01', '2026-11-10'), (select id from p_a1), 'primeiro dia → mesma quinzena');
select is((select count(*)::int from driver_periods where driver_id = '00000000-0000-0000-0000-000000001a01'), 2,
  'não cria quinzenas repetidas');
select throws_ok($$select driver_period_for('00000000-0000-0000-0000-000000001a01', '2026-11-09')$$,
  'P0001', 'BEFORE_CYCLE_START', 'data antes do cadastro');
select throws_ok(
  $$insert into rides (driver_id, platform, ride_date, amount, client_name, transfer_status)
    values ('00000000-0000-0000-0000-000000001a01','transfer','2026-11-01',100,'X','assigned')$$,
  'P0001', 'BEFORE_CYCLE_START', 'lançamento antes do cadastro recusado');

-- ===== Trava por quinzena do motorista =====
insert into rides (id, driver_id, platform, ride_date, amount, client_name, transfer_status) values
  ('00000000-0000-0000-0000-000000001b01','00000000-0000-0000-0000-000000001a01','transfer','2026-11-12',100,'X','assigned');
update driver_periods set status = 'closed', closed_at = now() where id = (select id from p_a1);

select lives_ok(
  $$insert into rides (driver_id, platform, ride_date, amount, client_name, transfer_status)
    values ('00000000-0000-0000-0000-000000001a02','transfer','2026-11-12',100,'Y','assigned')$$,
  'quinzena fechada de A não bloqueia B na mesma data');
select throws_ok(
  $$insert into rides (driver_id, platform, ride_date, amount, client_name, transfer_status)
    values ('00000000-0000-0000-0000-000000001a01','transfer','2026-11-12',100,'Z','assigned')$$,
  'P0001', 'PERIOD_CLOSED', 'insert de A em quinzena fechada');
select throws_ok(
  $$update rides set ride_date = '2026-11-26' where id = '00000000-0000-0000-0000-000000001b01'$$,
  'P0001', 'PERIOD_CLOSED', 'não move lançamento para fora da quinzena fechada');
select throws_ok(
  $$update rides set driver_id = '00000000-0000-0000-0000-000000001a02' where id = '00000000-0000-0000-0000-000000001b01'$$,
  'P0001', 'PERIOD_CLOSED', 'não reatribui lançamento de quinzena fechada');
select throws_ok(
  $$update driver_periods set status = 'open' where id = (select id from p_a1)$$,
  'P0001', 'PERIOD_CLOSED', 'quinzena fechada não reabre');

-- ===== Ajustes =====
insert into adjustments (id, driver_id, kind, amount, description, effective_date) values
  ('00000000-0000-0000-0000-000000001d01','00000000-0000-0000-0000-000000001a02','bonus',10,'x','2026-11-12');
select is((select driver_period_id from adjustments where id = '00000000-0000-0000-0000-000000001d01'),
  (select id from driver_periods where driver_id = '00000000-0000-0000-0000-000000001a02' and start_date = '2026-11-10'),
  'ajuste sem quinzena ganha a quinzena da effective_date');
select throws_ok(
  $$insert into adjustments (driver_id, driver_period_id, kind, amount, description, effective_date)
    values ('00000000-0000-0000-0000-000000001a01', (select id from p_a2), 'bonus', 10, 'x', '2026-11-12')$$,
  'P0001', 'INVALID_EFFECTIVE_DATE', 'effective_date fora da quinzena');
select throws_ok(
  $$insert into adjustments (driver_id, driver_period_id, kind, amount, description, effective_date)
    values ('00000000-0000-0000-0000-000000001a02', (select id from p_a2), 'bonus', 10, 'x', '2026-11-26')$$,
  'P0001', 'INVALID_PERIOD', 'quinzena de outro motorista');
select throws_ok(
  $$insert into adjustments (driver_id, driver_period_id, kind, amount, description, effective_date)
    values ('00000000-0000-0000-0000-000000001a01', (select id from p_a1), 'bonus', 10, 'x', '2026-11-12')$$,
  'P0001', 'PERIOD_CLOSED', 'ajuste em quinzena fechada');
insert into adjustments (id, driver_id, driver_period_id, kind, amount, description) values
  ('00000000-0000-0000-0000-000000001d02','00000000-0000-0000-0000-000000001a03',(select id from p_c1),'bonus',10,'x');
select is((select effective_date from adjustments where id = '00000000-0000-0000-0000-000000001d02'),
  least(greatest((now() at time zone 'America/Sao_Paulo')::date, '2026-12-31'::date), '2027-01-14'::date),
  'effective_date padrão (hoje) é trazida para dentro da quinzena escolhida');

-- ===== Extratos =====
insert into statements (driver_id, driver_period_id) values ('00000000-0000-0000-0000-000000001a03', (select id from p_c1));
select throws_ok(
  $$insert into statements (driver_id, driver_period_id) values ('00000000-0000-0000-0000-000000001a03', (select id from p_c1))$$,
  '23505', null, 'um extrato por quinzena');

-- ===== RLS =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000001a02","role":"authenticated"}';
select is((select count(*)::int from driver_periods where driver_id <> auth.uid()), 0, 'B não lê quinzenas de A');
select ok((select count(*) from driver_periods where driver_id = auth.uid()) > 0, 'B lê as próprias quinzenas');
select throws_ok(
  $$insert into driver_periods (driver_id, start_date, end_date) values (auth.uid(), '2027-05-01', '2027-05-15')$$,
  '42501', null, 'motorista não cria quinzena direto');
select throws_ok($$select driver_period_for('00000000-0000-0000-0000-000000001a01', '2026-11-26')$$,
  'P0001', 'FORBIDDEN', 'motorista não resolve quinzena de outro');
reset role;

-- ===== Pausa =====
select set_config('passos.pause_driver', 'on', true);  -- fixture: pausa direta (pause_driver testado em driver_close)
update profiles set paused = true where id = '00000000-0000-0000-0000-000000001a02';
select set_config('passos.pause_driver', '', true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000001a02","role":"authenticated"}';
select lives_ok(
  $$insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path)
    values (auth.uid(), '00000000-0000-0000-0000-000000001c01', '2026-11-20','gasolina',100,20,5.000,'x')$$,
  'pausado ainda lança dentro da última quinzena');
select throws_ok(
  $$insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path)
    values (auth.uid(), '00000000-0000-0000-0000-000000001c01', '2026-11-26','gasolina',100,20,5.000,'x')$$,
  'P0001', 'DRIVER_PAUSED', 'pausado não lança depois do fim da última quinzena');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
select lives_ok(
  $$insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path)
    values ('00000000-0000-0000-0000-000000001a02', '00000000-0000-0000-0000-000000001c01', '2026-11-21','gasolina',100,20,5.000,'x')$$,
  'admin não é bloqueado pela pausa na quinzena existente');
select ok((select count(*) from driver_periods where driver_id = '00000000-0000-0000-0000-000000001a01') > 0, 'admin lê todas as quinzenas');
reset role;

select * from finish();
rollback;
