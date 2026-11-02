begin;
select plan(14);

-- Personas do seed: admin ad01, João d001 (company_car, carro c001)
-- quinzena do João (ciclo desde 2026-01-01) que contém 05/06 é criada pelos gatilhos
-- TODO Task 3: close_period foi removido na 0010; as checagens de fechamento estão em skip
-- até close_driver_period existir.

insert into shifts (id, driver_id, car_id, consumption_km_l, start_date, odometer_start) values
  ('00000000-0000-0000-0000-0000000008b1','00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-00000000c001',10,'2026-06-05',1000);
insert into rides (id, driver_id, platform, ride_date, amount, km) values
  ('00000000-0000-0000-0000-0000000008a1','00000000-0000-0000-0000-00000000d001','uber','2026-06-05',100,50),
  ('00000000-0000-0000-0000-0000000008a2','00000000-0000-0000-0000-00000000d001','blablacar','2026-06-05',40,20);
update shifts set ended_at = '2026-06-05 20:00-03', odometer_end = 1070
  where id = '00000000-0000-0000-0000-0000000008b1';

-- admin recusa o turno
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
select lives_ok($$select review_item('shift','00000000-0000-0000-0000-0000000008b1', false, 'Km errado')$$, 'admin recusa o turno');
select skip('Task 3: close_driver_period — turno recusado bloqueia o fechamento (SHIFTS_NOT_APPROVED)', 1);
select is((select status from driver_periods where driver_id = '00000000-0000-0000-0000-00000000d001'
            and '2026-06-05' between start_date and end_date), 'open', 'quinzena segue aberta');

-- edição do próprio admin não reabre o turno
select lives_ok($$update rides set amount = 101 where id = '00000000-0000-0000-0000-0000000008a1'$$, 'admin edita corrida');
select is((select review_status from shifts where id = '00000000-0000-0000-0000-0000000008b1'), 'rejected',
  'edição do admin não reabre o turno');

-- motorista corrige uma corrida do turno recusado → volta para pending
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
select lives_ok($$update rides set amount = 90, km = 45 where id = '00000000-0000-0000-0000-0000000008a1'$$,
  'motorista edita corrida do turno recusado');
select is((select review_status from shifts where id = '00000000-0000-0000-0000-0000000008b1'), 'pending',
  'turno volta para pending');
select is((select reject_reason from shifts where id = '00000000-0000-0000-0000-0000000008b1'), null,
  'motivo da recusa é limpo');

-- recusa de novo; apagar uma corrida também reabre
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
select review_item('shift','00000000-0000-0000-0000-0000000008b1', false, 'Ainda errado');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
select lives_ok($$delete from rides where id = '00000000-0000-0000-0000-0000000008a2'$$, 'motorista apaga corrida do turno recusado');
select is((select review_status from shifts where id = '00000000-0000-0000-0000-0000000008b1'), 'pending',
  'apagar corrida devolve o turno para pending');

-- a exceção do guarda é estreita: com a flag, motorista ainda não aprova o próprio turno
reset role;
select set_config('passos.reopen_shift', 'on', true);
select throws_ok($$update shifts set review_status = 'approved' where id = '00000000-0000-0000-0000-0000000008b1'$$,
  'P0001', 'FORBIDDEN_FIELD', 'motorista não aprova o próprio turno nem com a flag');
select set_config('passos.reopen_shift', '', true);
set local role authenticated;

-- pendente bloqueia como PENDING_REVIEW; aprovado fecha
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
select skip('Task 3: close_driver_period — turno de volta à conferência bloqueia como pendente', 1);
select lives_ok($$select review_item('shift','00000000-0000-0000-0000-0000000008b1', true, null)$$, 'admin aprova');
select skip('Task 3: close_driver_period — quinzena fecha com o turno aprovado', 1);

select * from finish();
rollback;
