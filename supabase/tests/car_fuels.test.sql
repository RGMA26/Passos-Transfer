begin;
select plan(32);
-- 0017: cars.fuels (conjunto de combustíveis do carro). fuel_type vira legado (nulo ou rótulo derivado).

-- ===== Esquema =====
select has_column('public', 'cars', 'fuels', 'cars.fuels existe');
select col_type_is('public', 'cars', 'fuels', 'text[]', 'fuels text[]');
select col_not_null('public', 'cars', 'fuels', 'fuels obrigatório');
select col_is_null('public', 'cars', 'fuel_type', 'fuel_type agora é opcional');

select ok(not has_function_privilege('anon', 'fuels_for_type(text)', 'execute'), 'anon não executa fuels_for_type');
select ok(not has_function_privilege('anon', 'normalize_fuels(text[])', 'execute'), 'anon não executa normalize_fuels');
select ok(not has_function_privilege('anon', 'fuel_type_label(text[])', 'execute'), 'anon não executa fuel_type_label');

-- ===== Mapeamento do tipo antigo (usado no backfill e por clientes antigos) =====
select is(fuels_for_type('flex'), array['gasolina','alcool'], 'flex → gasolina + álcool');
select is(fuels_for_type('hibrido'), array['gasolina','eletrico'], 'híbrido → gasolina + elétrico');
select is(fuels_for_type('gnv'), array['gnv'], 'gnv → gnv');
select is(fuels_for_type('diesel'), array['diesel'], 'diesel → diesel');
select is(fuels_for_type('gasolina'), array['gasolina'], 'gasolina → gasolina');
select is(fuels_for_type('alcool'), array['alcool'], 'álcool → álcool');
select is(fuels_for_type('eletrico'), array['eletrico'], 'elétrico → elétrico');

-- ===== Gravação =====
insert into cars (id, model, plate, fuel_type, ownership) values
  ('00000000-0000-0000-0000-000000003c01','Polo','CFU0A01','flex','company');
select is((select fuels from cars where id = '00000000-0000-0000-0000-000000003c01'), array['gasolina','alcool'],
  'cliente antigo (só fuel_type): fuels derivado');

insert into cars (id, model, plate, fuels, km_per_l_gasolina, km_per_m3_gnv, ownership) values
  ('00000000-0000-0000-0000-000000003c02','Polo GNV','CFU0A02','{gnv,alcool,gasolina,gasolina}',10.4,13,'company');
select is((select fuels from cars where id = '00000000-0000-0000-0000-000000003c02'), array['gasolina','alcool','gnv'],
  'fuels normalizado (ordem fixa, sem repetidos)');
select is((select fuel_type from cars where id = '00000000-0000-0000-0000-000000003c02'), null,
  'combinação sem rótulo antigo: fuel_type nulo');

insert into cars (id, model, plate, fuels, ownership) values
  ('00000000-0000-0000-0000-000000003c03','Gol','CFU0A03','{alcool,gasolina}','company');
select is((select fuel_type from cars where id = '00000000-0000-0000-0000-000000003c03'), 'flex',
  'gasolina + álcool: rótulo flex');

select throws_ok(
  $$insert into cars (model, plate, fuels, ownership) values ('X','CFU9Z01','{}','company')$$,
  '23514', null, 'fuels vazio rejeitado');
select throws_ok(
  $$insert into cars (model, plate, fuels, ownership) values ('X','CFU9Z02','{gasolina,querosene}','company')$$,
  '23514', null, 'combustível desconhecido rejeitado');
select throws_ok(
  $$insert into cars (model, plate, ownership) values ('X','CFU9Z03','company')$$,
  '23502', null, 'sem fuels nem fuel_type: rejeitado');

-- ===== Abastecimento: combustível precisa estar em fuels =====
insert into auth.users (id) values ('00000000-0000-0000-0000-000000003a01');
insert into profiles (id, role, login_code, seq_number, name, driver_type, uber_pct, transfer_pct, current_car_id, cpf, cycle_start_date) values
  ('00000000-0000-0000-0000-000000003a01','driver','cf-1',9951,'P','company_car',40,30,'00000000-0000-0000-0000-000000003c02','30000000116','2026-04-01');

select lives_ok(
  $$insert into fuelings (id, driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path)
    values ('00000000-0000-0000-0000-000000003f01','00000000-0000-0000-0000-000000003a01','00000000-0000-0000-0000-000000003c02','2026-04-06','gnv',50,10,5,'x')$$,
  'GNV num flex com kit GNV');
select is((select km_equivalent from fuelings where id = '00000000-0000-0000-0000-000000003f01'), 130::numeric,
  'km_equivalent 10 m³ × 13');
select lives_ok(
  $$insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path)
    values ('00000000-0000-0000-0000-000000003a01','00000000-0000-0000-0000-000000003c02','2026-04-06','alcool',50,10,5,'x')$$,
  'álcool no mesmo carro');
select throws_ok(
  $$insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path)
    values ('00000000-0000-0000-0000-000000003a01','00000000-0000-0000-0000-000000003c02','2026-04-06','diesel',50,10,5,'x')$$,
  'P0001', 'FUEL_NOT_ALLOWED', 'diesel fora dos combustíveis do carro');
select throws_ok(
  $$insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path)
    values ('00000000-0000-0000-0000-000000003a01','00000000-0000-0000-0000-000000003c02','2026-04-06','querosene',50,10,5,'x')$$,
  'P0001', 'FUEL_NOT_ALLOWED', 'combustível desconhecido no abastecimento');

update cars set fuels = '{gasolina,alcool}' where id = '00000000-0000-0000-0000-000000003c02';
select is((select fuel_type from cars where id = '00000000-0000-0000-0000-000000003c02'), 'flex',
  'tirar o GNV: rótulo volta a flex');
select throws_ok(
  $$insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path)
    values ('00000000-0000-0000-0000-000000003a01','00000000-0000-0000-0000-000000003c02','2026-04-07','gnv',50,10,5,'x')$$,
  'P0001', 'FUEL_NOT_ALLOWED', 'GNV depois de desmarcado');
select lives_ok(
  $$update fuelings set amount = 51 where id = '00000000-0000-0000-0000-000000003f01'$$,
  'nota antiga de GNV continua editável (combustível não mudou)');

-- cliente antigo troca o tipo: fuels acompanha
update cars set fuel_type = 'diesel' where id = '00000000-0000-0000-0000-000000003c03';
select is((select fuels from cars where id = '00000000-0000-0000-0000-000000003c03'), array['diesel'],
  'cliente antigo troca fuel_type: fuels acompanha');
-- fuels e fuel_type juntos: fuels manda
update cars set fuels = '{gnv}', fuel_type = 'flex' where id = '00000000-0000-0000-0000-000000003c03';
select is((select fuels from cars where id = '00000000-0000-0000-0000-000000003c03'), array['gnv'], 'fuels manda sobre fuel_type');
select is((select fuel_type from cars where id = '00000000-0000-0000-0000-000000003c03'), 'gnv', 'rótulo derivado de fuels');

select * from finish();
rollback;
