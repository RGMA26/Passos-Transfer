begin;
select plan(27);

-- 0019: unreview_item(p_kind, p_id) — o admin desfaz a conferência (o item volta para a fila).
-- transfer: checked → completed (despesas aprovadas voltam a pendentes); shift: approved → pending;
-- fueling/expense: approved|rejected → pending. Quinzena fechada → PERIOD_CLOSED.
-- Personas do seed: admin ad01, João d001 (Onix c001). Fixtures próprias: uuids 19xx.

insert into shifts (id, driver_id, car_id, start_date, odometer_start, ended_at, odometer_end, review_status) values
  ('00000000-0000-0000-0000-0000000019e1','00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-00000000c001',
   '2026-03-05',1000,'2026-03-05 18:00-03',1100,'approved'),
  ('00000000-0000-0000-0000-0000000019e2','00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-00000000c001',
   '2026-03-06',1100,'2026-03-06 18:00-03',1150,'pending'),
  ('00000000-0000-0000-0000-0000000019e3','00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-00000000c001',
   '2026-01-05',500,'2026-01-05 18:00-03',600,'approved');

insert into rides (id, driver_id, platform, ride_date, scheduled_at, amount, client_name, transfer_status,
    origin_street, origin_district, origin_city, origin_state, dest_street, dest_district, dest_city, dest_state,
    car_id, shift_id, odometer_start, odometer_end, started_at, km) values
  ('00000000-0000-0000-0000-0000000019a1','00000000-0000-0000-0000-00000000d001','transfer','2026-03-05','2026-03-05 10:00-03',200,'Cli A','checked',
   'Rua A, 1','Centro','Passos','MG','Av. B, 2','Centro','Franca','SP',
   '00000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-0000000019e1',1010,1050,'2026-03-05 10:00-03',40),
  ('00000000-0000-0000-0000-0000000019a2','00000000-0000-0000-0000-00000000d001','transfer','2026-03-05','2026-03-05 10:00-03',200,'Cli B','completed',
   'Rua A, 1','Centro','Passos','MG','Av. B, 2','Centro','Franca','SP',
   '00000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-0000000019e1',1050,1060,'2026-03-05 11:00-03',10),
  ('00000000-0000-0000-0000-0000000019a3','00000000-0000-0000-0000-00000000d001','transfer','2026-01-05','2026-01-05 10:00-03',200,'Cli C','checked',
   'Rua A, 1','Centro','Passos','MG','Av. B, 2','Centro','Franca','SP',
   '00000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-0000000019e3',510,520,'2026-01-05 10:00-03',10);

insert into ride_expenses (id, ride_id, kind, amount, photo_path, review_status, reject_reason) values
  ('00000000-0000-0000-0000-0000000019b1','00000000-0000-0000-0000-0000000019a1','toll',15,'p.jpg','approved',null),
  ('00000000-0000-0000-0000-0000000019b2','00000000-0000-0000-0000-0000000019a1','parking',10,'p.jpg','rejected','Ilegível'),
  ('00000000-0000-0000-0000-0000000019b3','00000000-0000-0000-0000-0000000019a2','toll',20,'p.jpg','rejected','Ilegível');

insert into fuelings (id, driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path, review_status, reject_reason) values
  ('00000000-0000-0000-0000-0000000019f1','00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-00000000c001','2026-03-05','gasolina',240,40,6,'n.jpg','approved',null),
  ('00000000-0000-0000-0000-0000000019f2','00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-00000000c001','2026-03-05','gasolina',60,10,6,'n.jpg','rejected','Nota errada'),
  ('00000000-0000-0000-0000-0000000019f3','00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-00000000c001','2026-03-05','gasolina',60,10,6,'n.jpg','pending',null);

-- quinzena 01–15/01 fechada
insert into driver_periods (driver_id, start_date, end_date)
  select '00000000-0000-0000-0000-00000000d001','2026-01-01','2026-01-15'
  where not exists (select 1 from driver_periods where driver_id = '00000000-0000-0000-0000-00000000d001'
                      and start_date = '2026-01-01');
update driver_periods set status = 'closed', closed_at = now()
 where driver_id = '00000000-0000-0000-0000-00000000d001' and start_date = '2026-01-01';

-- ===== Privilégios =====
select has_function('public', 'unreview_item', array['text','uuid'], 'unreview_item existe');
select ok(not has_function_privilege('anon', 'unreview_item(text,uuid)', 'execute'), 'anon não executa unreview_item');
select ok(has_function_privilege('authenticated', 'unreview_item(text,uuid)', 'execute'), 'authenticated executa unreview_item');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
select throws_ok(
  $$select unreview_item('shift', '00000000-0000-0000-0000-0000000019e1')$$,
  'P0001', 'FORBIDDEN', 'motorista não desfaz conferência');

-- ===== Admin =====
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';

select throws_ok($$select unreview_item('banana', '00000000-0000-0000-0000-0000000019e1')$$,
  'P0001', 'INVALID_KIND', 'tipo inválido');
select throws_ok($$select unreview_item('shift', '00000000-0000-0000-0000-0000000019ff')$$,
  'P0001', 'NOT_FOUND', 'item inexistente');

-- transfer: checked → completed; despesa aprovada volta a pendente; recusada fica
select lives_ok($$select unreview_item('transfer', '00000000-0000-0000-0000-0000000019a1')$$, 'desfaz Transfer conferido');
select is((select transfer_status from rides where id = '00000000-0000-0000-0000-0000000019a1'), 'completed', 'Transfer volta a concluído');
select is((select review_status from ride_expenses where id = '00000000-0000-0000-0000-0000000019b1'), 'pending', 'despesa aprovada volta a pendente');
select is((select review_status from ride_expenses where id = '00000000-0000-0000-0000-0000000019b2'), 'rejected', 'despesa recusada não muda');
select is((select km from rides where id = '00000000-0000-0000-0000-0000000019a1'), 40.0, 'km preservado');
select throws_ok($$select unreview_item('transfer', '00000000-0000-0000-0000-0000000019a1')$$,
  'P0001', 'NOT_REVIEWED', 'Transfer concluído (não conferido) recusa');
select throws_ok($$select unreview_item('transfer', '00000000-0000-0000-0000-0000000019e1')$$,
  'P0001', 'NOT_FOUND', 'id de turno como transfer');

-- shift: approved → pending
select lives_ok($$select unreview_item('shift', '00000000-0000-0000-0000-0000000019e1')$$, 'desfaz turno aprovado');
select is((select review_status from shifts where id = '00000000-0000-0000-0000-0000000019e1'), 'pending', 'turno volta a pendente');
select throws_ok($$select unreview_item('shift', '00000000-0000-0000-0000-0000000019e2')$$,
  'P0001', 'NOT_REVIEWED', 'turno pendente recusa');

-- fueling: approved/rejected → pending (motivo limpo)
select lives_ok($$select unreview_item('fueling', '00000000-0000-0000-0000-0000000019f1')$$, 'desfaz abastecimento aprovado');
select lives_ok($$select unreview_item('fueling', '00000000-0000-0000-0000-0000000019f2')$$, 'desfaz abastecimento recusado');
select is((select string_agg(review_status || ':' || coalesce(reject_reason, '-'), ',' order by id) from fuelings
            where id in ('00000000-0000-0000-0000-0000000019f1','00000000-0000-0000-0000-0000000019f2')),
  'pending:-,pending:-', 'abastecimentos pendentes, sem motivo');
select throws_ok($$select unreview_item('fueling', '00000000-0000-0000-0000-0000000019f3')$$,
  'P0001', 'NOT_REVIEWED', 'abastecimento pendente recusa');

-- expense: recusada → pendente (Transfer não conferido)
select lives_ok($$select unreview_item('expense', '00000000-0000-0000-0000-0000000019b3')$$, 'desfaz despesa recusada');
select is((select review_status || ':' || coalesce(reject_reason, '-') from ride_expenses where id = '00000000-0000-0000-0000-0000000019b3'),
  'pending:-', 'despesa pendente, sem motivo');

-- quinzena fechada
select throws_ok($$select unreview_item('transfer', '00000000-0000-0000-0000-0000000019a3')$$,
  'P0001', 'PERIOD_CLOSED', 'Transfer em quinzena fechada');
select throws_ok($$select unreview_item('shift', '00000000-0000-0000-0000-0000000019e3')$$,
  'P0001', 'PERIOD_CLOSED', 'turno em quinzena fechada');
select is((select transfer_status from rides where id = '00000000-0000-0000-0000-0000000019a3'), 'checked', 'nada muda na quinzena fechada');

-- auditoria (gatilho audit_row)
select ok(exists (select 1 from audit_log where table_name = 'rides' and row_id = '00000000-0000-0000-0000-0000000019a1'
                    and new_data->>'transfer_status' = 'completed' and old_data->>'transfer_status' = 'checked'),
  'desfazer fica no audit_log');

-- o Transfer desfeito pode ser conferido de novo
select lives_ok($$select review_item('transfer', '00000000-0000-0000-0000-0000000019a1', true, null)$$, 'reconfere o Transfer');

select * from finish();
rollback;
