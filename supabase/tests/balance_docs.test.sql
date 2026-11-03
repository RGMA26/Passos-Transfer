begin;
select plan(108);
-- Endereço padrão dos Transfers destas fixtures (check de origem/destino da 0012; revertido no rollback).
alter table rides
  alter column origin_street set default 'Rua A, 1', alter column origin_district set default 'Centro',
  alter column origin_city set default 'Passos', alter column origin_state set default 'MG',
  alter column dest_street set default 'Av. B, 2', alter column dest_district set default 'Centro',
  alter column dest_city set default 'Franca', alter column dest_state set default 'SP';

-- Fixtures próprias (uuids 5xxx). Admin do seed: ad01.
-- X (5a01): carro da empresa C1, Uber 40% / Transfer 30%, ciclo 16/09 → quinzena 16/09–30/09
-- Y (5a02): carro próprio C2, Transfer 30%, ciclo 25/09 → quinzena 25/09–09/10 (atravessa o mês)
-- W (5a03), R (5a04), V (5a05): pendências (datas relativas a hoje, SP)
-- C3 (5c03): carro da empresa só para os gastos de 2027; C4 (5c04): carro de W
create temp table td as select (now() at time zone 'America/Sao_Paulo')::date as d;
grant select on td to authenticated;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000005a01'), ('00000000-0000-0000-0000-000000005a02'),
  ('00000000-0000-0000-0000-000000005a03'), ('00000000-0000-0000-0000-000000005a04'),
  ('00000000-0000-0000-0000-000000005a05');

insert into cars (id, model, plate, fuel_type, km_per_l_gasolina, ownership) values
  ('00000000-0000-0000-0000-000000005c01','Onix','BAL0C01','flex',10.0,'company'),
  ('00000000-0000-0000-0000-000000005c02','HB20','BAL0C02','flex',12.5,'own'),
  ('00000000-0000-0000-0000-000000005c03','Argo','BAL0C03','flex',11.0,'company'),
  ('00000000-0000-0000-0000-000000005c04','Kwid','BAL0C04','flex',14.0,'company');

insert into profiles (id, role, login_code, seq_number, name, driver_type, uber_pct, transfer_pct, current_car_id, active, cpf, cycle_start_date) values
  ('00000000-0000-0000-0000-000000005a01','driver','bal-01',9501,'X','company_car',40,30,'00000000-0000-0000-0000-000000005c01',true,'50000005959','2026-09-16'),
  ('00000000-0000-0000-0000-000000005a02','driver','bal-02',9502,'Y','own_car',null,30,'00000000-0000-0000-0000-000000005c02',true,'50000018180','2026-09-25'),
  ('00000000-0000-0000-0000-000000005a03','driver','bal-03',9503,'W','company_car',40,30,'00000000-0000-0000-0000-000000005c04',true,'50000021210',(select d from td) - 2),
  ('00000000-0000-0000-0000-000000005a04','driver','bal-04',9504,'R','own_car',null,30,'00000000-0000-0000-0000-000000005c02',true,'50000030805',(select d from td) - 15),
  ('00000000-0000-0000-0000-000000005a05','driver','bal-05',9505,'V','own_car',null,30,'00000000-0000-0000-0000-000000005c02',true,'50000034037',(select d from td) - 9);

-- ===== X: quinzena 16/09–30/09 =====
-- turno 16/09 (odômetro 1000 → 1150): 5 Uber de 100 (20 km cada, 16–20/09) + BlaBlaCar 80 → 50 km por fora
insert into shifts (id, driver_id, car_id, start_date, odometer_start, odometer_start_photo) values
  ('00000000-0000-0000-0000-000000005e01','00000000-0000-0000-0000-000000005a01','00000000-0000-0000-0000-000000005c01','2026-09-16',1000,'a.jpg');
insert into rides (driver_id, platform, ride_date, amount, km, shift_id)
select '00000000-0000-0000-0000-000000005a01', 'uber', d::date, 100, 20, '00000000-0000-0000-0000-000000005e01'
  from generate_series('2026-09-16'::date, '2026-09-20'::date, interval '1 day') d;
insert into rides (driver_id, platform, ride_date, amount, shift_id) values
  ('00000000-0000-0000-0000-000000005a01','blablacar','2026-09-17',80,'00000000-0000-0000-0000-000000005e01');
update shifts set ended_at = '2026-09-20 20:00-03', odometer_end = 1150, odometer_end_photo = 'b.jpg', review_status = 'approved'
 where id = '00000000-0000-0000-0000-000000005e01';
-- Transfer conferido 19/09 (300, 30 km) com pedágio aprovado de 15
insert into rides (id, driver_id, platform, ride_date, amount, km, client_name, transfer_status) values
  ('00000000-0000-0000-0000-000000005b01','00000000-0000-0000-0000-000000005a01','transfer','2026-09-19',300,30,'Cli X','checked');
insert into ride_expenses (ride_id, kind, amount, photo_path, review_status) values
  ('00000000-0000-0000-0000-000000005b01','toll',15,'p.jpg','approved');
-- nota aprovada 18/09: 40 L × 6,00 = 240 no Onix (10 km/L) → custo 0,60/km
insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path, review_status) values
  ('00000000-0000-0000-0000-000000005a01','00000000-0000-0000-0000-000000005c01','2026-09-18','gasolina',240,40,6.000,'n.jpg','approved');
insert into adjustments (driver_id, kind, amount, description, effective_date) values
  ('00000000-0000-0000-0000-000000005a01','bonus',10,'Bônus','2026-09-20');

-- ===== Y: quinzena 25/09–09/10 =====
insert into rides (id, driver_id, platform, ride_date, amount, km, client_name, transfer_status, car_id) values
  ('00000000-0000-0000-0000-000000005b02','00000000-0000-0000-0000-000000005a02','transfer','2026-09-28',200,50,'Cli Y1','checked','00000000-0000-0000-0000-000000005c02'),
  ('00000000-0000-0000-0000-000000005b03','00000000-0000-0000-0000-000000005a02','transfer','2026-10-05',100,25,'Cli Y2','checked','00000000-0000-0000-0000-000000005c02');
-- nota aprovada 02/10: 25 L × 6,00 = 150 no HB20 (12,5 km/L) → custo 0,48/km (não reembolsada: carro próprio)
insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path, review_status) values
  ('00000000-0000-0000-0000-000000005a02','00000000-0000-0000-0000-000000005c02','2026-10-02','gasolina',150,25,6.000,'n.jpg','approved');
insert into adjustments (driver_id, kind, amount, description, effective_date) values
  ('00000000-0000-0000-0000-000000005a02','advance',-20,'Vale','2026-10-03');

-- ===== Gastos do Onix (C1) =====
insert into car_expenses (car_id, kind, description, mode, amount, installments, start_date) values
  ('00000000-0000-0000-0000-000000005c01','maintenance',null,'single',400,null,'2026-09-10'),
  ('00000000-0000-0000-0000-000000005c01','maintenance','Motor','installments',1000,3,'2026-09-05');

-- ===== Funções, tabelas e privilégios =====
select has_table('public', 'car_expenses', 'car_expenses existe');
select has_table('public', 'admin_documents', 'admin_documents existe');
select has_column('public', 'car_expenses', 'deleted_on', 'car_expenses.deleted_on');
select ok(not has_function_privilege('anon', 'monthly_balance(date)', 'execute'), 'anon não vê balanço');
select ok(has_function_privilege('authenticated', 'monthly_balance(date)', 'execute'), 'authenticated chama monthly_balance');
select ok(not has_function_privilege('anon', 'monthly_detail(date)', 'execute'), 'anon não vê planilha');
select ok(not has_function_privilege('anon', 'car_expenses_for_month(date)', 'execute'), 'anon não vê gastos do mês');
select ok(not has_function_privilege('anon', 'admin_pendencies()', 'execute'), 'anon não vê pendências');
select ok(not has_function_privilege('authenticated', 'statement_lines(uuid,uuid,date,date,jsonb)', 'execute'), 'statement_lines é interna');
select results_eq($$select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'admin-docs'$$,
  $$values (false, 10485760::bigint, array['image/jpeg','image/png','application/pdf']::text[])$$, 'bucket admin-docs privado, 10 MB, jpg/png/pdf');

-- ===== Gastos: validações =====
select throws_ok($$insert into car_expenses (car_id, kind, mode, amount, start_date)
  values ('00000000-0000-0000-0000-000000005c03','tax','single',100,'2027-01-01')$$, '23514', null, 'imposto sem descrição');
select throws_ok($$insert into car_expenses (car_id, kind, description, mode, amount, start_date)
  values ('00000000-0000-0000-0000-000000005c03','other','  ','single',100,'2027-01-01')$$, '23514', null, 'outro sem descrição');
select lives_ok($$insert into car_expenses (car_id, kind, description, mode, amount, start_date)
  values ('00000000-0000-0000-0000-000000005c03','other','Lavagem','single',30,'2030-01-01')$$, 'outro com descrição');
select throws_ok($$insert into car_expenses (car_id, kind, mode, amount, start_date)
  values ('00000000-0000-0000-0000-000000005c03','maintenance','installments',100,'2027-01-01')$$, '23514', null, 'parcelado sem nº de parcelas');
select throws_ok($$insert into car_expenses (car_id, kind, mode, amount, installments, start_date)
  values ('00000000-0000-0000-0000-000000005c03','maintenance','installments',100,1,'2027-01-01')$$, '23514', null, 'parcelado com 1 parcela');
select throws_ok($$insert into car_expenses (car_id, kind, mode, amount, installments, start_date)
  values ('00000000-0000-0000-0000-000000005c03','maintenance','single',100,3,'2027-01-01')$$, '23514', null, 'pontual com parcelas');
select throws_ok($$insert into car_expenses (car_id, kind, mode, amount, start_date)
  values ('00000000-0000-0000-0000-000000005c03','maintenance','single',0,'2027-01-01')$$, '23514', null, 'valor zero');
select throws_ok($$insert into car_expenses (car_id, kind, mode, amount, installments, start_date)
  values ('00000000-0000-0000-0000-000000005c03','maintenance','installments',0.05,10,'2027-01-01')$$, '23514', null,
  'parcelado: 0,05 em 10× daria última parcela negativa');
select lives_ok($$insert into car_expenses (car_id, kind, mode, amount, installments, start_date)
  values ('00000000-0000-0000-0000-000000005c03','maintenance','installments',0.10,10,'2031-01-01')$$,
  'parcelado: 0,10 em 10× (1 centavo cada) é aceito');
select throws_ok($$insert into car_expenses (car_id, kind, mode, amount, start_date)
  values ('00000000-0000-0000-0000-000000005c02','maintenance','single',100,'2027-01-01')$$, 'P0001', 'CAR_NOT_COMPANY', 'carro próprio não tem gasto');

-- ===== Gastos de 2027 no Argo (C3) =====
insert into car_expenses (id, car_id, kind, description, mode, amount, installments, start_date, end_date, finished, deleted_on) values
  ('00000000-0000-0000-0000-000000005f01','00000000-0000-0000-0000-000000005c03','maintenance',null,'single',1800,null,'2027-03-15',null,false,null),
  ('00000000-0000-0000-0000-000000005f02','00000000-0000-0000-0000-000000005c03','insurance',null,'installments',1000,3,'2027-01-20',null,false,null),
  ('00000000-0000-0000-0000-000000005f03','00000000-0000-0000-0000-000000005c03','other','Rastreador','recurring',89,null,'2027-01-05','2027-03-01',true,null),
  ('00000000-0000-0000-0000-000000005f04','00000000-0000-0000-0000-000000005c03','tax','Licenciamento','recurring',50,null,'2027-01-01',null,false,'2027-04-10');

-- ===== Motorista não lê nada disso =====
insert into storage.objects (bucket_id, name) values ('admin-docs', '00000000-0000-0000-0000-000000005a01/doc.pdf');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000005a01","role":"authenticated"}';
select is((select count(*)::int from car_expenses), 0, 'motorista não lê car_expenses');
select is((select count(*)::int from admin_documents), 0, 'motorista não lê admin_documents');
select is((select count(*)::int from storage.objects where bucket_id = 'admin-docs'), 0, 'motorista não lê objetos de admin-docs');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('admin-docs', auth.uid()::text || '/x.pdf')$$,
  '42501', null, 'motorista não envia para admin-docs (nem na própria pasta)');
select is_empty($$update storage.objects set name = auth.uid()::text || '/hack.pdf' where bucket_id = 'admin-docs' returning id$$,
  'motorista não altera objetos de admin-docs');
-- a Storage API liga storage.allow_delete_query; com ela ligada, quem barra é a RLS
select set_config('storage.allow_delete_query', 'true', true);
select is_empty($$delete from storage.objects where bucket_id = 'admin-docs' returning id$$,
  'motorista não exclui objetos de admin-docs');
select set_config('storage.allow_delete_query', '', true);
select throws_ok($$insert into car_expenses (car_id, kind, mode, amount, start_date)
  values ('00000000-0000-0000-0000-000000005c01','maintenance','single',10,'2027-01-01')$$, '42501', null, 'motorista não cria gasto');
select throws_ok($$insert into admin_documents (driver_id, kind, description, file_path, mime_type, size_bytes)
  values (auth.uid(),'other','x','a/b.pdf','application/pdf',10)$$, '42501', null, 'motorista não cria documento');
select throws_ok($$select monthly_balance('2026-09-01')$$, 'P0001', 'FORBIDDEN', 'motorista não vê balanço');
select throws_ok($$select * from monthly_detail('2026-09-01')$$, 'P0001', 'FORBIDDEN', 'motorista não vê planilha');
select throws_ok($$select * from car_expenses_for_month('2026-09-01')$$, 'P0001', 'FORBIDDEN', 'motorista não vê gastos do mês');
select throws_ok($$select * from admin_pendencies()$$, 'P0001', 'FORBIDDEN', 'motorista não vê pendências');

-- ===== Admin =====
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
select is((select count(*)::int from storage.objects where bucket_id = 'admin-docs'), 1, 'admin lê admin-docs');
select is((select name from storage.objects where bucket_id = 'admin-docs'), '00000000-0000-0000-0000-000000005a01/doc.pdf',
  'objeto de admin-docs intacto após tentativas do motorista');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('admin-docs', '00000000-0000-0000-0000-000000005a01/r.pdf')$$,
  'admin envia para admin-docs');
select ok((select count(*) from car_expenses) >= 7, 'admin lê car_expenses');

-- gastos por mês (só o Argo)
select results_eq($$select kind, mode, installment_no, installments, amount from car_expenses_for_month('2027-01-17')
   where car_id = '00000000-0000-0000-0000-000000005c03' order by kind, amount$$,
  $$values ('insurance'::text,'installments'::text,1,3,333.33::numeric),
           ('other','recurring',null,null,89.00),
           ('tax','recurring',null,null,50.00)$$, 'jan/2027: parcela 1/3, recorrentes');
select results_eq($$select kind, installment_no, amount from car_expenses_for_month('2027-02-01')
   where car_id = '00000000-0000-0000-0000-000000005c03' order by kind, amount$$,
  $$values ('insurance'::text,2,333.33::numeric), ('other',null,89.00), ('tax',null,50.00)$$, 'fev/2027: parcela 2/3');
select results_eq($$select kind, installment_no, amount from car_expenses_for_month('2027-03-31')
   where car_id = '00000000-0000-0000-0000-000000005c03' order by kind, amount$$,
  $$values ('insurance'::text,3,333.34::numeric), ('maintenance',null,1800.00), ('other',null,89.00), ('tax',null,50.00)$$,
  'mar/2027: pontual, última parcela com os centavos, recorrente finalizado no mês, excluído depois');
select is((select sum(amount) from (
    select amount from car_expenses_for_month('2027-01-01') where expense_id = '00000000-0000-0000-0000-000000005f02'
    union all select amount from car_expenses_for_month('2027-02-01') where expense_id = '00000000-0000-0000-0000-000000005f02'
    union all select amount from car_expenses_for_month('2027-03-01') where expense_id = '00000000-0000-0000-0000-000000005f02'
    union all select amount from car_expenses_for_month('2027-04-01') where expense_id = '00000000-0000-0000-0000-000000005f02') x),
  1000.00::numeric, 'parcelas somam o valor cheio');
select is((select count(*)::int from car_expenses_for_month('2027-04-01') where car_id = '00000000-0000-0000-0000-000000005c03'), 0,
  'abr/2027: finalizado em mar e excluído em abr não contam');
select is((select count(*)::int from car_expenses_for_month('2026-12-01') where car_id = '00000000-0000-0000-0000-000000005c03'), 0,
  'dez/2026: nada antes da data de início');
select is((select count(*)::int from car_expenses_for_month('2027-02-01') where expense_id = '00000000-0000-0000-0000-000000005f01'), 0,
  'pontual só no mês dele');
select results_eq($$select plate, model, description from car_expenses_for_month('2027-01-01') where expense_id = '00000000-0000-0000-0000-000000005f04'$$,
  $$values ('BAL0C03'::text, 'Argo'::text, 'Licenciamento'::text)$$, 'linha traz placa, modelo e descrição');
-- excluir um pontual futuro: some; excluir no mês do início: some também
select lives_ok($$update car_expenses set deleted_on = '2027-03-01' where id = '00000000-0000-0000-0000-000000005f01'$$, 'exclui o pontual em 01/03');
select is((select count(*)::int from car_expenses_for_month('2027-03-01') where expense_id = '00000000-0000-0000-0000-000000005f01'), 0,
  'excluído no mês: deixa de contar a partir do mês da exclusão');
select lives_ok($$update car_expenses set deleted_on = '2027-02-15' where id = '00000000-0000-0000-0000-000000005f02'$$, 'exclui o parcelado em fev');
select results_eq($$select installment_no from car_expenses_for_month('2027-01-01') where expense_id = '00000000-0000-0000-0000-000000005f02'$$,
  $$values (1)$$, 'parcela anterior à exclusão continua');
select is((select count(*)::int from car_expenses_for_month('2027-02-01') where expense_id = '00000000-0000-0000-0000-000000005f02'), 0,
  'parcelas a partir do mês da exclusão somem');

-- ===== Balanço: setembro e outubro com as quinzenas abertas =====
create temp table b9 as select monthly_balance('2026-09-15') as j;
create temp table b10 as select monthly_balance('2026-10-01') as j;
select is((select j->>'month' from b9), '2026-09-01', 'mês normalizado');
select is((select (j->>'estimated')::boolean from b9), true, 'setembro estimado (quinzenas abertas)');
select is((select (j->>'estimated')::boolean from b10), true, 'outubro estimado (quinzena de Y aberta)');
select results_eq($$select (j#>>'{result,revenue,uber}')::numeric, (j#>>'{result,revenue,transfer}')::numeric,
                          (j#>>'{result,revenue,blablacar}')::numeric, (j#>>'{result,revenue,total}')::numeric from b9$$,
  $$values (500.00::numeric, 500.00::numeric, 80.00::numeric, 1080.00::numeric)$$, 'faturamento de setembro');
select results_eq($$select (j#>>'{result,owed,uber_share}')::numeric, (j#>>'{result,owed,transfer_share}')::numeric,
                          (j#>>'{result,owed,fuel_reimbursement}')::numeric, (j#>>'{result,owed,transfer_fuel}')::numeric,
                          (j#>>'{result,owed,expense_reimbursement}')::numeric, (j#>>'{result,owed,off_duty_discount}')::numeric,
                          (j#>>'{result,owed,adjustments}')::numeric, (j#>>'{result,owed,total}')::numeric from b9$$,
  $$values (200.00::numeric, 150.00::numeric, 240.00::numeric, 24.00::numeric, 15.00::numeric, 30.00::numeric, 10.00::numeric, 609.00::numeric)$$,
  'devido de setembro por linha');
select results_eq($$select (x->>'driver_id')::uuid, x->>'name', (x->>'total')::numeric
                     from b9, jsonb_array_elements(j#>'{result,owed,by_driver}') x order by x->>'name'$$,
  $$values ('00000000-0000-0000-0000-000000005a01'::uuid, 'X'::text, 525.00::numeric),
           ('00000000-0000-0000-0000-000000005a02'::uuid, 'Y'::text, 84.00::numeric)$$, 'devido de setembro por motorista');
select results_eq($$select (j#>>'{result,car_expenses,total}')::numeric, (j#>>'{result,car_expenses,by_kind,maintenance}')::numeric,
                          (j#>>'{result,car_expenses,by_kind,other}')::numeric, jsonb_array_length(j#>'{result,car_expenses,items}') from b9$$,
  $$values (733.33::numeric, 733.33::numeric, 0::numeric, 2)$$, 'gastos dos carros em setembro');
select is((select (j#>>'{result,company_result}')::numeric from b9), -262.33::numeric, 'resultado = 1080 − 609 − 733,33');
select results_eq($$select (j#>>'{result,previous_company_result}')::numeric, (j#>>'{result,diff}')::numeric, j#>'{result,diff_pct}' from b9$$,
  $$values (0::numeric, -262.33::numeric, 'null'::jsonb)$$, 'agosto zerado: diferença sem %');
select results_eq($$select (j#>>'{cash,total}')::numeric, jsonb_array_length(j#>'{cash,items}') from b9$$,
  $$values (0::numeric, 0)$$, 'caixa de setembro vazio');
select results_eq($$select (x->>'driver_id')::uuid, (x->>'km_off')::numeric from b9, jsonb_array_elements(j#>'{off_km_ranking,by_driver}') x$$,
  $$values ('00000000-0000-0000-0000-000000005a01'::uuid, 50::numeric)$$, 'ranking de km por fora por motorista');
select results_eq($$select (x->>'car_id')::uuid, x->>'plate', x->>'model', (x->>'km_off')::numeric
                     from b9, jsonb_array_elements(j#>'{off_km_ranking,by_car}') x$$,
  $$values ('00000000-0000-0000-0000-000000005c01'::uuid, 'BAL0C01'::text, 'Onix'::text, 50::numeric)$$, 'ranking de km por fora por carro');
select results_eq($$select (j#>>'{result,revenue,total}')::numeric, (j#>>'{result,owed,total}')::numeric,
                          (j#>>'{result,owed,transfer_fuel}')::numeric, (j#>>'{result,owed,adjustments}')::numeric,
                          (j#>>'{result,car_expenses,total}')::numeric, (j#>>'{result,company_result}')::numeric from b10$$,
  $$values (100.00::numeric, 22.00::numeric, 12.00::numeric, -20.00::numeric, 333.33::numeric, -255.33::numeric)$$,
  'outubro: receita 100, devido 22 (30 + 12 − 20), gastos 333,33');
select results_eq($$select (j#>>'{result,previous_company_result}')::numeric, (j#>>'{result,diff}')::numeric,
                          (j#>>'{result,diff_pct}')::numeric from b10$$,
  $$values (-262.33::numeric, 7.00::numeric, 2.67::numeric)$$, 'comparação com setembro');
select is((select jsonb_array_length(j#>'{off_km_ranking,by_driver}') + jsonb_array_length(j#>'{off_km_ranking,by_car}') from b10), 0,
  'ranking só com km por fora > 0');
select is((select (x->>'total')::numeric from b9, jsonb_array_elements(j#>'{result,owed,by_driver}') x where x->>'name' = 'Y')
        + (select (x->>'total')::numeric from b10, jsonb_array_elements(j#>'{result,owed,by_driver}') x where x->>'name' = 'Y'),
  (compute_statement('00000000-0000-0000-0000-000000005a02',
     driver_period_for('00000000-0000-0000-0000-000000005a02', '2026-09-25'))->>'total')::numeric,
  'setembro + outubro de Y = extrato da quinzena');
select results_eq($$select (x->>'closed_unpaid')::numeric, (x->>'open_estimate')::numeric
                     from b9, jsonb_array_elements(j#>'{payable,items}') x where x->>'driver_id' = '00000000-0000-0000-0000-000000005a02'$$,
  $$values (0::numeric, 106.00::numeric)$$, 'a pagar: Y estimado 106');
select is((select (j#>>'{payable,total}')::numeric from b9), 631.00::numeric, 'a pagar total = 525 + 106 (estimados)');

-- ===== Fechamento de X (16/09–30/09) e pagamento em 05/10 =====
create temp table sx as select close_driver_period(driver_period_for('00000000-0000-0000-0000-000000005a01', '2026-09-16')) as id;
select is((select total from statements where id = (select id from sx)), 525.00::numeric(10,2), 'extrato de X = 525');
select is((monthly_balance('2026-09-01')#>>'{result,owed,total}')::numeric, 609.00::numeric, 'devido de setembro igual após fechar');
select is((monthly_balance('2026-09-01')->>'estimated')::boolean, true, 'setembro segue estimado (Y aberta)');
select results_eq($$select (x->>'closed_unpaid')::numeric, (x->>'open_estimate')::numeric
                     from jsonb_array_elements(monthly_balance('2026-09-01')#>'{payable,items}') x
                    where x->>'driver_id' = '00000000-0000-0000-0000-000000005a01'$$,
  $$values (525.00::numeric, 0::numeric)$$, 'a pagar: X fechada e não paga');
select lives_ok($$select mark_statement_paid((select id from sx), '2026-10-05', 'pix')$$, 'paga X em 05/10');
select throws_ok($$insert into admin_documents (driver_id, statement_id, kind, file_path, mime_type, size_bytes)
  values ('00000000-0000-0000-0000-000000005a01',(select id from sx),'other','5a01/a.pdf','application/pdf',100)$$,
  '23514', null, 'documento "outro" exige descrição');
select throws_ok($$insert into admin_documents (driver_id, statement_id, kind, file_path, mime_type, size_bytes)
  values ('00000000-0000-0000-0000-000000005a02',(select id from sx),'payment_proof','5a02/a.pdf','application/pdf',100)$$,
  'P0001', 'INVALID_STATEMENT', 'extrato de outro motorista');
select throws_ok($$insert into admin_documents (driver_id, kind, description, file_path, mime_type, size_bytes)
  values ('00000000-0000-0000-0000-000000005a01','other','x','5a01/a.gif','image/gif',100)$$,
  '23514', null, 'tipo de arquivo não aceito');
select throws_ok($$insert into admin_documents (driver_id, kind, description, file_path, mime_type, size_bytes)
  values ('00000000-0000-0000-0000-000000005a01','other','x','5a01/a.pdf','application/pdf',10485761)$$,
  '23514', null, 'arquivo acima de 10 MB');
select lives_ok($$insert into admin_documents (driver_id, statement_id, kind, file_path, mime_type, size_bytes)
  values ('00000000-0000-0000-0000-000000005a01',(select id from sx),'payment_proof','00000000-0000-0000-0000-000000005a01/r.pdf','application/pdf',2048)$$,
  'anexa comprovante de pagamento');
select is((select created_by from admin_documents where statement_id = (select id from sx)),
  '00000000-0000-0000-0000-00000000ad01'::uuid, 'created_by = admin');
select results_eq($$select (j#>>'{cash,total}')::numeric, jsonb_array_length(j#>'{cash,items}') from (select monthly_balance('2026-09-01') j) b$$,
  $$values (0::numeric, 0)$$, 'caixa de setembro continua vazio');
create temp table c10 as select monthly_balance('2026-10-01') as j;
select is((select (j#>>'{cash,total}')::numeric from c10), 525.00::numeric, 'caixa de outubro = total do extrato');
select results_eq($$select (x->>'statement_id')::uuid, x->>'name', (x->>'period_start')::date, (x->>'period_end')::date,
                          (x->>'total')::numeric, (x->>'paid_at')::date, x->>'payment_method',
                          (x->>'has_payment_proof')::boolean, (x->>'has_signed_receipt')::boolean
                     from c10, jsonb_array_elements(j#>'{cash,items}') x$$,
  $$select (select id from sx), 'X'::text, '2026-09-16'::date, '2026-09-30'::date, 525.00::numeric, '2026-10-05'::date, 'pix'::text, true, false$$,
  'linha do caixa com quinzena, forma e anexos');
select is((select count(*)::int from c10, jsonb_array_elements(j#>'{payable,items}') x
            where x->>'driver_id' = '00000000-0000-0000-0000-000000005a01'), 0, 'X paga sai do a pagar');

-- ===== Fechamento de Y; extrato congelado manda =====
create temp table sy as select close_driver_period(driver_period_for('00000000-0000-0000-0000-000000005a02', '2026-09-25')) as id;
select is((select total from statements where id = (select id from sy)), 106.00::numeric(10,2), 'extrato de Y = 106');
select is((monthly_balance('2026-09-01')->>'estimated')::boolean, false, 'setembro deixa de ser estimado');
select is((monthly_balance('2026-10-01')->>'estimated')::boolean, false, 'outubro deixa de ser estimado');
select is((monthly_balance('2026-08-01')->>'estimated')::boolean, false, 'mês passado sem quinzena aberta: não estimado');
select is((monthly_balance((select d from td))->>'estimated')::boolean, true, 'mês atual (não terminou): estimado');
select is((monthly_balance('2030-06-15')->>'estimated')::boolean, true, 'mês futuro sem quinzena: estimado');
reset role;
set local request.jwt.claims = '{}';
-- consumo do HB20 muda depois do fechamento: o balanço segue o extrato congelado
update cars set km_per_l_gasolina = 10.0 where id = '00000000-0000-0000-0000-000000005c02';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
select results_eq($$select (x->>'total')::numeric from jsonb_array_elements(monthly_balance('2026-09-01')#>'{result,owed,by_driver}') x where x->>'name' = 'Y'
                    union all
                    select (x->>'total')::numeric from jsonb_array_elements(monthly_balance('2026-10-01')#>'{result,owed,by_driver}') x where x->>'name' = 'Y'$$,
  $$values (84.00::numeric), (22.00::numeric)$$, 'quinzena fechada: setembro 84 e outubro 22 pelo custo congelado');
select results_eq($$select (x->>'closed_unpaid')::numeric, (x->>'open_estimate')::numeric
                     from jsonb_array_elements(monthly_balance('2026-10-01')#>'{payable,items}') x
                    where x->>'driver_id' = '00000000-0000-0000-0000-000000005a02'$$,
  $$values (106.00::numeric, 0::numeric)$$, 'a pagar: Y fechada e não paga');
select is((select (monthly_balance('2026-10-01')#>>'{result,company_result}')::numeric), -255.33::numeric, 'resultado de outubro estável');

-- ===== Z: dois extratos pagos no mesmo dia com o mesmo valor (rótulo pela quinzena do extrato) =====
reset role;
set local request.jwt.claims = '{}';
insert into auth.users (id) values ('00000000-0000-0000-0000-000000005a06');
insert into profiles (id, role, login_code, seq_number, name, driver_type, uber_pct, transfer_pct, current_car_id, active, cpf, cycle_start_date) values
  ('00000000-0000-0000-0000-000000005a06','driver','bal-06',9506,'Z','own_car',null,30,'00000000-0000-0000-0000-000000005c02',true,'50000042218','2026-08-01');
insert into adjustments (driver_id, kind, amount, description, effective_date) values
  ('00000000-0000-0000-0000-000000005a06','bonus',10,'B1','2026-08-05'),
  ('00000000-0000-0000-0000-000000005a06','bonus',10,'B2','2026-08-20');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
create temp table sz1 as select close_driver_period(driver_period_for('00000000-0000-0000-0000-000000005a06', '2026-08-05')) as id;
create temp table sz2 as select close_driver_period(driver_period_for('00000000-0000-0000-0000-000000005a06', '2026-08-20')) as id;
select lives_ok($$select mark_statement_paid((select id from sz1), '2026-08-31', 'pix');
                  select mark_statement_paid((select id from sz2), '2026-08-31', 'pix')$$, 'Z: dois extratos de 10 pagos em 31/08');
select results_eq($$select period_label from monthly_detail('2026-08-01') where kind = 'payment' order by period_label$$,
  $$values ('01/08–15/08'::text), ('16/08–30/08'::text)$$, 'cada pagamento com a quinzena do próprio extrato');

-- ===== Planilha detalhada =====
select is((select count(*)::int from monthly_detail('2026-09-01')), 13, 'setembro: 10 itens de X, 1 de Y, 2 gastos de carro');
select results_eq($$select kind, count(*)::int from monthly_detail('2026-09-01') group by kind order by kind$$,
  $$values ('adjustment'::text, 1), ('blablacar', 1), ('car_expense', 2), ('fueling', 1), ('toll', 1), ('transfer', 2), ('uber', 5)$$,
  'setembro por tipo');
select results_eq($$select driver_name, cpf, login_code, gross, driver_amount, period_label, status
                     from monthly_detail('2026-09-01') where kind = 'transfer' and driver_name = 'X'$$,
  $$values ('X'::text, '50000005959'::text, 'bal-01'::text, 300.00::numeric, 90.00::numeric, '16/09–30/09'::text, 'checked'::text)$$,
  'linha do Transfer de X');
select results_eq($$select gross, driver_amount from monthly_detail('2026-09-01') where kind = 'fueling'$$,
  $$values (240.00::numeric, 240.00::numeric)$$, 'abastecimento reembolsado (carro da empresa)');
select results_eq($$select driver_name, gross from monthly_detail('2026-09-01') where kind = 'car_expense' order by gross$$,
  $$values (null::text, 333.33::numeric), (null::text, 400.00::numeric)$$, 'gastos de carro sem motorista');
select results_eq($$select kind, count(*)::int from monthly_detail('2026-10-01') group by kind order by kind$$,
  $$values ('adjustment'::text, 1), ('car_expense', 1), ('fueling', 1), ('payment', 1), ('transfer', 1)$$,
  'outubro por tipo (inclui o pagamento)');
select results_eq($$select occurred_on, driver_name, gross, driver_amount from monthly_detail('2026-10-01') where kind = 'payment'$$,
  $$values ('2026-10-05'::date, 'X'::text, 525.00::numeric, 525.00::numeric)$$, 'linha do pagamento');
select results_eq($$select gross, driver_amount, period_label from monthly_detail('2026-10-01') where kind = 'fueling'$$,
  $$values (150.00::numeric, 0::numeric, '25/09–09/10'::text)$$, 'abastecimento de carro próprio não reembolsado');
reset role;
set local request.jwt.claims = '{}';

-- ===== Pendências =====
-- W: abastecimento pendente sem conflito, com conflito; turno encerrado pendente; turno recusado; Transfer concluído
insert into fuelings (id, driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path) values
  ('00000000-0000-0000-0000-000000005d01','00000000-0000-0000-0000-000000005a03','00000000-0000-0000-0000-000000005c04',(select d from td) - 1,'gasolina',240,40,6.000,'n.jpg'),
  ('00000000-0000-0000-0000-000000005d02','00000000-0000-0000-0000-000000005a03','00000000-0000-0000-0000-000000005c04',(select d from td),'gasolina',274.60,40,6.190,'n.jpg'),
  ('00000000-0000-0000-0000-000000005d03','00000000-0000-0000-0000-000000005a03','00000000-0000-0000-0000-000000005c04',(select d from td),'gasolina',60,10,6.000,'n.jpg');
update fuelings set review_status = 'approved' where id = '00000000-0000-0000-0000-000000005d03';
insert into shifts (id, driver_id, car_id, start_date, odometer_start, ended_at, odometer_end, review_status, reject_reason) values
  ('00000000-0000-0000-0000-000000005e11','00000000-0000-0000-0000-000000005a03','00000000-0000-0000-0000-000000005c04',(select d from td) - 2,100,now(),150,'rejected','Foto ilegível'),
  ('00000000-0000-0000-0000-000000005e12','00000000-0000-0000-0000-000000005a03','00000000-0000-0000-0000-000000005c04',(select d from td) - 1,150,now(),200,'pending',null),
  ('00000000-0000-0000-0000-000000005e13','00000000-0000-0000-0000-000000005a03','00000000-0000-0000-0000-000000005c04',(select d from td),200,null,null,'pending',null);
insert into rides (id, driver_id, platform, ride_date, amount, km, client_name, transfer_status) values
  ('00000000-0000-0000-0000-000000005b11','00000000-0000-0000-0000-000000005a03','transfer',(select d from td) - 1,100,10,'Cli W','completed'),
  ('00000000-0000-0000-0000-000000005b12','00000000-0000-0000-0000-000000005a03','transfer',(select d from td),100,null,'Cli W2','assigned');
-- R: quinzena hoje−15 … hoje−1 aberta → 🔴; V: ciclo hoje−9 → quinzena termina em hoje+5 → 🟡
create temp table pr as select driver_period_for('00000000-0000-0000-0000-000000005a04', (select d from td) - 15) as id;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
create temp table pend as select * from admin_pendencies()
  where driver_id in ('00000000-0000-0000-0000-000000005a03','00000000-0000-0000-0000-000000005a04','00000000-0000-0000-0000-000000005a05');
reset role;
select results_eq($$select category, count(*)::int from pend group by category order by category$$,
  $$values ('orange'::text, 1), ('red', 1), ('white', 4), ('yellow', 1)$$, 'contagens por categoria');
select results_eq($$select item_type, item_id from pend where category = 'white' order by item_type, item_id$$,
  $$values ('fueling'::text, '00000000-0000-0000-0000-000000005d01'::uuid),
           ('shift', '00000000-0000-0000-0000-000000005e11'::uuid),
           ('shift', '00000000-0000-0000-0000-000000005e12'::uuid),
           ('transfer', '00000000-0000-0000-0000-000000005b11'::uuid)$$, 'brancas: abastecimento sem conflito, turnos encerrados pendente/recusado, Transfer concluído');
select results_eq($$select item_type, item_id, driver_name, occurred_on from pend where category = 'orange'$$,
  $$values ('fueling'::text, '00000000-0000-0000-0000-000000005d02'::uuid, 'W'::text, (select d from td))$$, 'laranja: abastecimento com valores conflitantes');
select results_eq($$select item_type, item_id, occurred_on from pend where category = 'red'$$,
  $$values ('period'::text, (select id from pr), (select d from td) - 1)$$, 'vermelha: quinzena terminada e aberta');
select results_eq($$select item_type, driver_id, occurred_on from pend where category = 'yellow'$$,
  $$values ('period'::text, '00000000-0000-0000-0000-000000005a05'::uuid, (select d from td) + 5)$$, 'amarela: quinzena termina em 5 dias');
select is((select item_id from pend where category = 'yellow'),
  (select id from driver_periods where driver_id = '00000000-0000-0000-0000-000000005a05' and (select d from td) between start_date and end_date),
  'amarela aponta a quinzena atual');
select ok((select bool_and(label is not null and btrim(label) <> '') from pend), 'toda pendência tem rótulo');

select * from finish();
rollback;
