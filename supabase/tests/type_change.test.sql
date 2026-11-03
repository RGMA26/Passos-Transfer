begin;
select plan(8);
-- Mudar o tipo do motorista no meio da quinzena não reescreve o extrato aberto:
-- reembolso de abastecimento segue o carro abastecido (empresa) e a gasolina do Transfer
-- segue o carro usado no Transfer (próprio). Fixtures próprias (uuids 7Axx). Admin do seed: ad01.
alter table rides
  alter column origin_street set default 'Rua A, 1', alter column origin_district set default 'Centro',
  alter column origin_city set default 'Passos', alter column origin_state set default 'MG',
  alter column dest_street set default 'Av. B, 2', alter column dest_district set default 'Centro',
  alter column dest_city set default 'Franca', alter column dest_state set default 'SP';

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000007a1'), ('00000000-0000-0000-0000-0000000007a2');
insert into cars (id, model, plate, fuel_type, km_per_l_gasolina, ownership) values
  ('00000000-0000-0000-0000-0000000007c1','Onix','TYP0A01','flex',10.0,'company'),
  ('00000000-0000-0000-0000-0000000007c2','HB20','TYP0A02','flex',12.5,'own');
insert into profiles (id, role, login_code, seq_number, name, driver_type, uber_pct, transfer_pct, current_car_id, active, cpf, cycle_start_date) values
  ('00000000-0000-0000-0000-0000000007a1','driver','typ-1',9771,'TA','company_car',40,30,'00000000-0000-0000-0000-0000000007c1',true,'61000000168','2026-04-01'),
  ('00000000-0000-0000-0000-0000000007a2','driver','typ-2',9772,'TB','own_car',null,30,'00000000-0000-0000-0000-0000000007c2',true,'61000000249','2026-04-01');
insert into driver_periods (id, driver_id, start_date, end_date) values
  ('00000000-0000-0000-0000-0000000007e1','00000000-0000-0000-0000-0000000007a1','2026-04-01','2026-04-15'),
  ('00000000-0000-0000-0000-0000000007e2','00000000-0000-0000-0000-0000000007a2','2026-04-01','2026-04-15');

-- TA (carro da empresa): turno 1000→1100 com Uber de 50 km, nota aprovada no Onix, Transfer no Onix
insert into shifts (id, driver_id, car_id, start_date, odometer_start) values
  ('00000000-0000-0000-0000-0000000007b1','00000000-0000-0000-0000-0000000007a1','00000000-0000-0000-0000-0000000007c1','2026-04-05',1000);
insert into rides (driver_id, platform, ride_date, amount, km) values
  ('00000000-0000-0000-0000-0000000007a1','uber','2026-04-05',100,50);
update shifts set ended_at = '2026-04-05 20:00-03', odometer_end = 1100, review_status = 'approved'
 where id = '00000000-0000-0000-0000-0000000007b1';
insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path, review_status) values
  ('00000000-0000-0000-0000-0000000007a1','00000000-0000-0000-0000-0000000007c1','2026-04-05','gasolina',100,16,6.25,'x','approved');
insert into rides (driver_id, platform, ride_date, amount, km, client_name, transfer_status, car_id) values
  ('00000000-0000-0000-0000-0000000007a1','transfer','2026-04-06',200,40,'Cli','completed','00000000-0000-0000-0000-0000000007c1');

-- TB (carro próprio): Transfer de 50 km no HB20 e nota no HB20 (não reembolsada)
insert into rides (driver_id, platform, ride_date, amount, km, client_name, transfer_status, car_id) values
  ('00000000-0000-0000-0000-0000000007a2','transfer','2026-04-06',200,50,'Cli','completed','00000000-0000-0000-0000-0000000007c2');
insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path, review_status) values
  ('00000000-0000-0000-0000-0000000007a2','00000000-0000-0000-0000-0000000007c2','2026-04-06','gasolina',100,16,6.25,'x','approved');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
create temp table before_a as select compute_statement('00000000-0000-0000-0000-0000000007a1','00000000-0000-0000-0000-0000000007e1') as j;
create temp table before_b as select compute_statement('00000000-0000-0000-0000-0000000007a2','00000000-0000-0000-0000-0000000007e2') as j;
create temp table before_d as select driver_name, kind, driver_amount from monthly_detail('2026-04-01') where driver_name in ('TA','TB');
select is((select (j->>'fuel_reimbursement')::numeric from before_a), 100.00, 'TA: nota do carro da empresa reembolsada');
select is((select (j->>'transfer_fuel_reimbursement')::numeric from before_a), 0::numeric, 'TA: Transfer no carro da empresa sem gasolina');
select is((select (j->>'transfer_fuel_reimbursement')::numeric from before_b), 25.00, 'TB: Transfer no carro próprio 50 km × 0,50 (nota do HB20: 100 / 200 km)');
select is((select (j->>'fuel_reimbursement')::numeric from before_b), 0::numeric, 'TB: nota do carro próprio não reembolsa');
reset role;

-- troca os tipos no meio da quinzena (como o admin faz pelo cadastro)
update profiles set driver_type = 'own_car', current_car_id = null where id = '00000000-0000-0000-0000-0000000007a1';
update profiles set driver_type = 'company_car', uber_pct = 40, current_car_id = null where id = '00000000-0000-0000-0000-0000000007a2';

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
select is(compute_statement('00000000-0000-0000-0000-0000000007a1','00000000-0000-0000-0000-0000000007e1'),
          (select j from before_a), 'TA virou carro próprio: extrato aberto igual');
select is(compute_statement('00000000-0000-0000-0000-0000000007a2','00000000-0000-0000-0000-0000000007e2'),
          (select j from before_b), 'TB virou carro da empresa: extrato aberto igual');
select results_eq(
  $$select driver_name, kind, driver_amount from monthly_detail('2026-04-01') where driver_name in ('TA','TB') order by 1, 2, 3$$,
  $$select driver_name, kind, driver_amount from before_d order by 1, 2, 3$$,
  'planilha do contador igual depois da troca');
select is((monthly_balance('2026-04-01')#>>'{result,owed,fuel_reimbursement}')::numeric >= 100, true,
  'balanço mantém o reembolso da nota do carro da empresa');
reset role;

select * from finish();
rollback;
