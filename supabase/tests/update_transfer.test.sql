begin;
select plan(33);

-- 0018: update_transfer(p_id, p_fields) — edição do Transfer pelo admin, com guarda por status.
-- assigned/in_progress: cliente, data/hora, endereços, valor (e km estimado recalculado);
-- completed: só valor e endereços (e km estimado); checked: nada. Nunca leituras/status/motorista/km.
-- Personas do seed: admin ad01, João d001. Fixtures próprias: uuids 18xx.

insert into rides (id, driver_id, platform, ride_date, scheduled_at, amount, client_name, transfer_status, estimated_km,
    origin, origin_street, origin_district, origin_city, origin_state, destination, dest_street, dest_district, dest_city, dest_state,
    car_id, odometer_start, odometer_end, started_at, km) values
  ('00000000-0000-0000-0000-0000000018a1','00000000-0000-0000-0000-00000000d001','transfer','2026-03-05','2026-03-05 10:00-03',200,'Cli A','assigned',40,
   'Rua A, 1, Centro, Passos/MG','Rua A, 1','Centro','Passos','MG','Av. B, 2, Centro, Franca/SP','Av. B, 2','Centro','Franca','SP',
   null,null,null,null,null),
  ('00000000-0000-0000-0000-0000000018a2','00000000-0000-0000-0000-00000000d001','transfer','2026-03-05','2026-03-05 10:00-03',200,'Cli B','in_progress',40,
   'Rua A, 1, Centro, Passos/MG','Rua A, 1','Centro','Passos','MG','Av. B, 2, Centro, Franca/SP','Av. B, 2','Centro','Franca','SP',
   '00000000-0000-0000-0000-00000000c001',1000,null,'2026-03-05 10:00-03',null),
  ('00000000-0000-0000-0000-0000000018a3','00000000-0000-0000-0000-00000000d001','transfer','2026-03-05','2026-03-05 10:00-03',200,'Cli C','completed',40,
   'Rua A, 1, Centro, Passos/MG','Rua A, 1','Centro','Passos','MG','Av. B, 2, Centro, Franca/SP','Av. B, 2','Centro','Franca','SP',
   '00000000-0000-0000-0000-00000000c001',1000,1050,'2026-03-05 10:00-03',50),
  ('00000000-0000-0000-0000-0000000018a4','00000000-0000-0000-0000-00000000d001','transfer','2026-03-05','2026-03-05 10:00-03',200,'Cli D','checked',40,
   'Rua A, 1, Centro, Passos/MG','Rua A, 1','Centro','Passos','MG','Av. B, 2, Centro, Franca/SP','Av. B, 2','Centro','Franca','SP',
   '00000000-0000-0000-0000-00000000c001',1000,1050,'2026-03-05 10:00-03',50),
  ('00000000-0000-0000-0000-0000000018a5','00000000-0000-0000-0000-00000000d001','transfer','2026-01-05','2026-01-05 10:00-03',200,'Cli E','assigned',40,
   'Rua A, 1, Centro, Passos/MG','Rua A, 1','Centro','Passos','MG','Av. B, 2, Centro, Franca/SP','Av. B, 2','Centro','Franca','SP',
   null,null,null,null,null);

insert into driver_periods (driver_id, start_date, end_date)
  select '00000000-0000-0000-0000-00000000d001','2026-01-01','2026-01-15'
  where not exists (select 1 from driver_periods where driver_id = '00000000-0000-0000-0000-00000000d001'
                      and start_date = '2026-01-01');
update driver_periods set status = 'closed', closed_at = now()
 where driver_id = '00000000-0000-0000-0000-00000000d001' and start_date = '2026-01-01';

-- ===== Privilégios =====
select has_function('public', 'update_transfer', array['uuid','jsonb'], 'update_transfer existe');
select ok(not has_function_privilege('anon', 'update_transfer(uuid,jsonb)', 'execute'), 'anon não executa update_transfer');

-- motorista não usa
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
select throws_ok(
  $$select update_transfer('00000000-0000-0000-0000-0000000018a1', '{"amount": 1}')$$,
  'P0001', 'FORBIDDEN', 'motorista não edita');

-- ===== Admin =====
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';

-- assigned: tudo o que é permitido
select lives_ok(
  $$select update_transfer('00000000-0000-0000-0000-0000000018a1', jsonb_build_object(
      'client_name', 'Cli A2', 'scheduled_at', '2026-03-06T14:30:00-03:00', 'ride_date', '2026-03-06',
      'amount', 250, 'origin_street', 'Rua Nova, 9', 'origin', 'Rua Nova, 9, Centro, Passos/MG',
      'origin_zip', '37900-000', 'origin_ref', null, 'estimated_km', null))$$,
  'assigned: cliente, data/hora, endereço e valor');
select is((select client_name from rides where id = '00000000-0000-0000-0000-0000000018a1'), 'Cli A2', 'cliente alterado');
select is((select ride_date from rides where id = '00000000-0000-0000-0000-0000000018a1'), '2026-03-06'::date, 'ride_date alterada');
select is((select scheduled_at from rides where id = '00000000-0000-0000-0000-0000000018a1'), '2026-03-06 14:30-03'::timestamptz, 'horário alterado');
select is((select amount from rides where id = '00000000-0000-0000-0000-0000000018a1'), 250.00::numeric, 'valor alterado');
select is((select origin_street || '|' || origin_zip from rides where id = '00000000-0000-0000-0000-0000000018a1'),
  'Rua Nova, 9|37900-000', 'origem alterada');
select is((select estimated_km from rides where id = '00000000-0000-0000-0000-0000000018a1'), null, 'km estimado nulo (não calculado)');
select is((select dest_street from rides where id = '00000000-0000-0000-0000-0000000018a1'), 'Av. B, 2', 'destino intacto');

-- campos proibidos em qualquer status
select throws_ok(
  $$select update_transfer('00000000-0000-0000-0000-0000000018a1', '{"driver_id": "00000000-0000-0000-0000-00000000d002"}')$$,
  'P0001', 'FORBIDDEN_FIELD', 'motorista não muda por aqui');
select throws_ok(
  $$select update_transfer('00000000-0000-0000-0000-0000000018a2', '{"odometer_start": 1}')$$,
  'P0001', 'FORBIDDEN_FIELD', 'leitura não muda');
select throws_ok(
  $$select update_transfer('00000000-0000-0000-0000-0000000018a2', '{"transfer_status": "assigned"}')$$,
  'P0001', 'FORBIDDEN_FIELD', 'status não muda');
select throws_ok(
  $$select update_transfer('00000000-0000-0000-0000-0000000018a3', '{"km": 1}')$$,
  'P0001', 'FORBIDDEN_FIELD', 'km real não muda');
select throws_ok(
  $$select update_transfer('00000000-0000-0000-0000-0000000018a1', '{"amount": 1, "platform": "uber"}')$$,
  'P0001', 'FORBIDDEN_FIELD', 'plataforma não muda (nem junto com campo válido)');
select is((select amount from rides where id = '00000000-0000-0000-0000-0000000018a1'), 250.00::numeric, 'nada gravado na recusa');

-- in_progress: cliente e destino; leituras intactas
select lives_ok(
  $$select update_transfer('00000000-0000-0000-0000-0000000018a2', '{"client_name": "Cli B2", "dest_city": "Ribeirão Preto", "estimated_km": 120.5}')$$,
  'in_progress: cliente e destino');
select is((select client_name || '|' || dest_city || '|' || estimated_km::text || '|' || odometer_start::text || '|' || transfer_status
             from rides where id = '00000000-0000-0000-0000-0000000018a2'),
  'Cli B2|Ribeirão Preto|120.5|1000|in_progress', 'in_progress: alterado sem tocar leituras/status');

-- completed: só valor e endereços
select lives_ok(
  $$select update_transfer('00000000-0000-0000-0000-0000000018a3', '{"amount": 300, "dest_street": "Av. C, 3"}')$$,
  'completed: valor e endereço');
select is((select amount::text || '|' || dest_street || '|' || km::text || '|' || odometer_end::text || '|' || transfer_status
             from rides where id = '00000000-0000-0000-0000-0000000018a3'),
  '300.00|Av. C, 3|50.0|1050|completed', 'completed: alterado sem tocar km/leituras/status');
select throws_ok(
  $$select update_transfer('00000000-0000-0000-0000-0000000018a3', '{"client_name": "X"}')$$,
  'P0001', 'FORBIDDEN_FIELD', 'completed: cliente não muda');
select throws_ok(
  $$select update_transfer('00000000-0000-0000-0000-0000000018a3', '{"scheduled_at": "2026-03-07T10:00:00-03:00"}')$$,
  'P0001', 'FORBIDDEN_FIELD', 'completed: horário não muda');

-- checked: nada
select throws_ok(
  $$select update_transfer('00000000-0000-0000-0000-0000000018a4', '{"amount": 1}')$$,
  'P0001', 'NOT_CHANGEABLE', 'checked não muda');

-- quinzena fechada
select throws_ok(
  $$select update_transfer('00000000-0000-0000-0000-0000000018a5', '{"amount": 1}')$$,
  'P0001', 'PERIOD_CLOSED', 'quinzena fechada');
select throws_ok(
  $$select update_transfer('00000000-0000-0000-0000-0000000018a1', '{"ride_date": "2026-01-06", "scheduled_at": "2026-01-06T10:00:00-03:00"}')$$,
  'P0001', 'PERIOD_CLOSED', 'mudar a data para uma quinzena fechada');

-- ride_date derivada no servidor (Brasília); ride_date enviada é ignorada
select lives_ok(
  $$select update_transfer('00000000-0000-0000-0000-0000000018a2', '{"scheduled_at": "2026-11-03T02:30:00Z", "ride_date": "2030-01-01"}')$$,
  'scheduled_at com ride_date enviada (ignorada)');
select is((select ride_date from rides where id = '00000000-0000-0000-0000-0000000018a2'), '2026-11-02'::date,
  '23:30 de 02/11 em Brasília → ride_date 2026-11-02');
select lives_ok(
  $$select update_transfer('00000000-0000-0000-0000-0000000018a2', '{"ride_date": "2030-01-01"}')$$,
  'só ride_date: ignorada, sem erro');
select is((select ride_date from rides where id = '00000000-0000-0000-0000-0000000018a2'), '2026-11-02'::date,
  'ride_date não muda sozinha');

-- validações
select throws_ok(
  $$select update_transfer('00000000-0000-0000-0000-0000000018a1', '{"origin_city": "  "}')$$,
  '23514', null, 'endereço em branco recusado pelo check');
select throws_ok(
  $$select update_transfer('00000000-0000-0000-0000-0000000018a1', '{"client_name": " "}')$$,
  'P0001', 'INVALID_FIELD', 'cliente em branco');
select throws_ok(
  $$select update_transfer('00000000-0000-0000-0000-000000001899', '{"amount": 1}')$$,
  'P0001', 'NOT_FOUND', 'transfer inexistente');

select * from finish();
rollback;
