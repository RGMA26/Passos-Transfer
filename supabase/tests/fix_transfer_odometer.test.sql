begin;
select plan(22);

-- 0019: admin_fix_transfer_odometer(p_id, p_start, p_end) — o admin corrige as leituras de um Transfer
-- em andamento (só a inicial) ou concluído (as duas; km = final − inicial). Conferido: desfazer antes.
-- Personas do seed: admin ad01, João d001 (Onix c001). Fixtures próprias: uuids 29xx.

insert into rides (id, driver_id, platform, ride_date, scheduled_at, amount, client_name, transfer_status,
    origin_street, origin_district, origin_city, origin_state, dest_street, dest_district, dest_city, dest_state,
    car_id, odometer_start, odometer_end, started_at, km) values
  -- como o caso de produção: 1.010.000 → 9.102.500 (o teto é 9.999.999)
  ('00000000-0000-0000-0000-0000000029a1','00000000-0000-0000-0000-00000000d001','transfer','2026-03-05','2026-03-05 10:00-03',200,'Cli A','completed',
   'Rua A, 1','Centro','Passos','MG','Av. B, 2','Centro','Franca','SP',
   '00000000-0000-0000-0000-00000000c001',1010000,9102500,'2026-03-05 10:00-03',8092500),
  ('00000000-0000-0000-0000-0000000029a2','00000000-0000-0000-0000-00000000d001','transfer','2026-03-05','2026-03-05 10:00-03',200,'Cli B','in_progress',
   'Rua A, 1','Centro','Passos','MG','Av. B, 2','Centro','Franca','SP',
   '00000000-0000-0000-0000-00000000c001',1000000,null,'2026-03-05 10:00-03',null),
  ('00000000-0000-0000-0000-0000000029a3','00000000-0000-0000-0000-00000000d001','transfer','2026-03-05','2026-03-05 10:00-03',200,'Cli C','checked',
   'Rua A, 1','Centro','Passos','MG','Av. B, 2','Centro','Franca','SP',
   '00000000-0000-0000-0000-00000000c001',1000,1050,'2026-03-05 10:00-03',50),
  ('00000000-0000-0000-0000-0000000029a4','00000000-0000-0000-0000-00000000d001','transfer','2026-03-05','2026-03-05 10:00-03',200,'Cli D','assigned',
   'Rua A, 1','Centro','Passos','MG','Av. B, 2','Centro','Franca','SP',
   null,null,null,null,null),
  ('00000000-0000-0000-0000-0000000029a5','00000000-0000-0000-0000-00000000d001','transfer','2026-01-05','2026-01-05 10:00-03',200,'Cli E','completed',
   'Rua A, 1','Centro','Passos','MG','Av. B, 2','Centro','Franca','SP',
   '00000000-0000-0000-0000-00000000c001',500,550,'2026-01-05 10:00-03',50);

insert into driver_periods (driver_id, start_date, end_date)
  select '00000000-0000-0000-0000-00000000d001','2026-01-01','2026-01-15'
  where not exists (select 1 from driver_periods where driver_id = '00000000-0000-0000-0000-00000000d001'
                      and start_date = '2026-01-01');
update driver_periods set status = 'closed', closed_at = now()
 where driver_id = '00000000-0000-0000-0000-00000000d001' and start_date = '2026-01-01';

-- ===== Privilégios =====
select has_function('public', 'admin_fix_transfer_odometer', array['uuid','integer','integer'], 'admin_fix_transfer_odometer existe');
select ok(not has_function_privilege('anon', 'admin_fix_transfer_odometer(uuid,int,int)', 'execute'), 'anon não executa');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
select throws_ok(
  $$select admin_fix_transfer_odometer('00000000-0000-0000-0000-0000000029a1', 57876, 57900)$$,
  'P0001', 'FORBIDDEN', 'motorista não corrige pelo admin');

-- ===== Admin =====
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';

select lives_ok(
  $$select admin_fix_transfer_odometer('00000000-0000-0000-0000-0000000029a1', 57876, 57925)$$,
  'concluído: corrige as duas leituras');
select is((select odometer_start || '|' || odometer_end || '|' || km::text || '|' || transfer_status
             from rides where id = '00000000-0000-0000-0000-0000000029a1'),
  '57876|57925|49.0|completed', 'leituras e km recalculados; status mantido');
select ok(exists (select 1 from audit_log where table_name = 'rides' and row_id = '00000000-0000-0000-0000-0000000029a1'
                    and old_data->>'odometer_end' = '9102500' and new_data->>'odometer_end' = '57925'),
  'correção fica no audit_log');
select ok(coalesce((select max(v) from (
            select greatest(odometer_start, coalesce(odometer_end, odometer_start)) v from rides
             where car_id = '00000000-0000-0000-0000-00000000c001' and platform = 'transfer'
               and id = '00000000-0000-0000-0000-0000000029a1') x), 0) = 57925,
  'último odômetro do carro deixa de usar a leitura errada');

select throws_ok(
  $$select admin_fix_transfer_odometer('00000000-0000-0000-0000-0000000029a1', 57900, 57800)$$,
  'P0001', 'ODOMETER_BELOW_START', 'final menor que o inicial');
select throws_ok(
  $$select admin_fix_transfer_odometer('00000000-0000-0000-0000-0000000029a1', 57876, null)$$,
  'P0001', 'INVALID_ODOMETER', 'concluído sem leitura final');
select throws_ok(
  $$select admin_fix_transfer_odometer('00000000-0000-0000-0000-0000000029a1', -1, 10)$$,
  'P0001', 'INVALID_ODOMETER', 'leitura negativa');
select throws_ok(
  $$select admin_fix_transfer_odometer('00000000-0000-0000-0000-0000000029a1', 57876, 10000000)$$,
  'P0001', 'INVALID_ODOMETER', 'leitura acima de 9.999.999');

-- em andamento: só a inicial
select lives_ok(
  $$select admin_fix_transfer_odometer('00000000-0000-0000-0000-0000000029a2', 57900, null)$$,
  'em andamento: corrige a inicial');
select is((select odometer_start || '|' || coalesce(odometer_end::text, '-') || '|' || coalesce(km::text, '-') || '|' || transfer_status
             from rides where id = '00000000-0000-0000-0000-0000000029a2'),
  '57900|-|-|in_progress', 'em andamento: só a inicial');
select throws_ok(
  $$select admin_fix_transfer_odometer('00000000-0000-0000-0000-0000000029a2', 57900, 58000)$$,
  'P0001', 'INVALID_ODOMETER', 'em andamento não recebe leitura final');

-- conferido / atribuído / inexistente / quinzena fechada
select throws_ok(
  $$select admin_fix_transfer_odometer('00000000-0000-0000-0000-0000000029a3', 1000, 1040)$$,
  'P0001', 'NOT_CHANGEABLE', 'conferido: desfazer a conferência antes');
select throws_ok(
  $$select admin_fix_transfer_odometer('00000000-0000-0000-0000-0000000029a4', 1000, null)$$,
  'P0001', 'NOT_CHANGEABLE', 'atribuído: sem leituras');
select throws_ok(
  $$select admin_fix_transfer_odometer('00000000-0000-0000-0000-0000000029ff', 1000, 1040)$$,
  'P0001', 'NOT_FOUND', 'inexistente');
-- quinzena fechada: a correção do odômetro passa, mas só as leituras/km mudam
select lives_ok(
  $$select admin_fix_transfer_odometer('00000000-0000-0000-0000-0000000029a5', 500, 540)$$,
  'quinzena fechada: corrige só o odômetro');
select is((select odometer_start || '|' || odometer_end || '|' || km::text || '|' || amount::text || '|' || transfer_status
             from rides where id = '00000000-0000-0000-0000-0000000029a5'),
  '500|540|40.0|200.00|completed', 'quinzena fechada: leituras e km mudam, o resto não');
select throws_ok(
  $$update rides set amount = 1 where id = '00000000-0000-0000-0000-0000000029a5'$$,
  'P0001', 'PERIOD_CLOSED', 'quinzena fechada continua travada para o resto');

-- fluxo completo do caso de produção: desfazer conferência → corrigir → conferir de novo
select lives_ok($$select unreview_item('transfer', '00000000-0000-0000-0000-0000000029a3')$$, 'desfaz a conferência');
select lives_ok($$select admin_fix_transfer_odometer('00000000-0000-0000-0000-0000000029a3', 1000, 1040)$$,
  'corrige depois de desfazer');

select * from finish();
rollback;
