begin;
select plan(14);

-- Spec §5: motorista edita/apaga as próprias corridas Uber/BlaBlaCar (turno não aprovado)
-- e abastecimentos pendentes. Persona do seed: João d001 (company_car, carro c001).
insert into shifts (id, driver_id, car_id, consumption_km_l, start_date, odometer_start) values
  ('00000000-0000-0000-0000-00000000a0b1','00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-00000000c001',10,'2026-06-20',1000);
insert into rides (id, driver_id, platform, ride_date, amount, km) values
  ('00000000-0000-0000-0000-00000000a0a1','00000000-0000-0000-0000-00000000d001','uber','2026-06-20',100,30),
  ('00000000-0000-0000-0000-00000000a0a2','00000000-0000-0000-0000-00000000d001','blablacar','2026-06-20',40,20);
update shifts set ended_at = '2026-06-20 20:00-03', odometer_end = 1100
  where id = '00000000-0000-0000-0000-00000000a0b1';
insert into fuelings (id, driver_id, car_id, fueled_on, amount, liters, photo_path, review_status) values
  ('00000000-0000-0000-0000-00000000a0f1','00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-00000000c001','2026-06-20',200,40,'x','pending'),
  ('00000000-0000-0000-0000-00000000a0f2','00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-00000000c001','2026-06-20',80,16,'x','approved');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';

-- turno encerrado ainda pendente: edita e apaga
select lives_ok($$update rides set amount = 90, km = 25 where id = '00000000-0000-0000-0000-00000000a0a1'$$, 'edita corrida de turno pendente');
select is((select amount from rides where id = '00000000-0000-0000-0000-00000000a0a1'), 90.00, 'valor alterado');
select lives_ok($$delete from rides where id = '00000000-0000-0000-0000-00000000a0a2'$$, 'apaga corrida de turno pendente');
select ok(not exists (select 1 from rides where id = '00000000-0000-0000-0000-00000000a0a2'), 'corrida apagada');

-- abastecimento pendente: edita e apaga; aprovado: nada muda
select lives_ok($$update fuelings set amount = 190, liters = 38 where id = '00000000-0000-0000-0000-00000000a0f1'$$, 'edita abastecimento pendente');
select is((select liters from fuelings where id = '00000000-0000-0000-0000-00000000a0f1'), 38.000, 'litros alterados');
select lives_ok($$update fuelings set amount = 1 where id = '00000000-0000-0000-0000-00000000a0f2'$$, 'abastecimento aprovado não é editado');
select lives_ok($$delete from fuelings where id = '00000000-0000-0000-0000-00000000a0f2'$$, 'abastecimento aprovado não é apagado');
select is((select amount from fuelings where id = '00000000-0000-0000-0000-00000000a0f2'), 80.00, 'aprovado segue intacto (nem editado nem apagado)');
select lives_ok($$delete from fuelings where id = '00000000-0000-0000-0000-00000000a0f1'$$, 'apaga abastecimento pendente');
select ok(not exists (select 1 from fuelings where id = '00000000-0000-0000-0000-00000000a0f1'), 'abastecimento pendente apagado');

-- turno aprovado trava as corridas
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
select review_item('shift','00000000-0000-0000-0000-00000000a0b1', true, null);
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
select lives_ok($$update rides set amount = 1 where id = '00000000-0000-0000-0000-00000000a0a1'$$, 'corrida de turno aprovado não é editada');
select lives_ok($$delete from rides where id = '00000000-0000-0000-0000-00000000a0a1'$$, 'corrida de turno aprovado não é apagada');
select is((select amount from rides where id = '00000000-0000-0000-0000-00000000a0a1'), 90.00, 'valor segue o mesmo');

select * from finish();
rollback;
