begin;
select plan(17);

-- 0016: número do código de login = menor número livre (perfil apagado libera; desativado mantém)
-- e delete_driver (exclusão só de motorista sem lançamentos). Seed: João seq 1, Maria seq 2.

create function pg_temp.new_driver(p_id uuid, p_seq int, p_name text, p_cpf text) returns void language plpgsql as $$
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
          'passos' || lpad(p_seq::text, 2, '0') || lower(p_name) || '@login.passostransfer.app', '', now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now());
  insert into profiles (id, role, login_code, seq_number, name, driver_type, transfer_pct, cpf, cycle_start_date)
  values (p_id, 'driver', 'PASSOS' || lpad(p_seq::text, 2, '0') || upper(p_name), p_seq, p_name, 'own_car', 30,
          p_cpf, '2026-01-01');
end $$;

select ok(not has_function_privilege('authenticated', 'generate_login_code(text)', 'execute'), 'authenticated não gera código');
select ok(not has_function_privilege('authenticated', 'delete_driver(uuid)', 'execute'), 'authenticated não exclui motorista');
select ok(has_function_privilege('service_role', 'delete_driver(uuid)', 'execute'), 'service_role exclui motorista');

select is(generate_login_code('Ana Lima'), 'PASSOS03ANA', 'sem buracos: próximo número');

-- 3 e 5 ocupados, 4 livre (buraco no meio é reaproveitado)
select pg_temp.new_driver('00000000-0000-0000-0000-0000000016a3', 3, 'Caio', '11144477735');
select pg_temp.new_driver('00000000-0000-0000-0000-0000000016a5', 5, 'Bia', '39053344705');
select is(generate_login_code('Ana'), 'PASSOS04ANA', 'buraco no meio (4) é reaproveitado');

-- desativado mantém o número
select pg_temp.new_driver('00000000-0000-0000-0000-0000000016a4', 4, 'Davi', '15350946056');
update profiles set active = false where id = '00000000-0000-0000-0000-0000000016a4';
select is(generate_login_code('Ana'), 'PASSOS06ANA', 'desativado continua com o número 4');

-- excluir libera o número
select is(delete_driver('00000000-0000-0000-0000-0000000016a4'), 'PASSOS04DAVI', 'exclui motorista sem lançamentos e devolve o código');
select is((select count(*)::int from profiles where id = '00000000-0000-0000-0000-0000000016a4'), 0, 'perfil apagado');
select is((select count(*)::int from auth.users where id = '00000000-0000-0000-0000-0000000016a4'), 0, 'usuário de login apagado');
select is(generate_login_code('Ana'), 'PASSOS04ANA', 'número 4 livre de novo');

-- o 01 apagado volta a ser usado (como PASSOS02KAIQUE em produção: o 01 tinha sido queimado)
update profiles set seq_number = 90 where id = '00000000-0000-0000-0000-00000000d001';
select is(generate_login_code('Kaique'), 'PASSOS01KAIQUE', '01 livre é reaproveitado');
update profiles set seq_number = 1 where id = '00000000-0000-0000-0000-00000000d001';

-- vínculo de carro é desfeito; quinzena aberta vazia não conta como lançamento
update cars set current_driver_id = '00000000-0000-0000-0000-0000000016a5' where id = '00000000-0000-0000-0000-00000000c002';
insert into driver_periods (driver_id, start_date, end_date) values ('00000000-0000-0000-0000-0000000016a5', '2026-01-01', '2026-01-15');
select lives_ok($$select delete_driver('00000000-0000-0000-0000-0000000016a5')$$, 'exclui com carro vinculado e quinzena aberta vazia');
select is((select current_driver_id from cars where id = '00000000-0000-0000-0000-00000000c002'), null, 'carro desvinculado');

-- com lançamentos: HAS_ENTRIES
insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path)
values ('00000000-0000-0000-0000-0000000016a3', '00000000-0000-0000-0000-00000000c002', '2026-01-05', 'gasolina', 100, 20, 5, 'x');
select throws_ok($$select delete_driver('00000000-0000-0000-0000-0000000016a3')$$, 'P0001', 'HAS_ENTRIES', 'com abastecimento não exclui');
select throws_ok($$select delete_driver('00000000-0000-0000-0000-00000000ad01')$$, 'P0001', 'NOT_FOUND', 'admin não é motorista');

-- números ≥ 100 sem zero à esquerda
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('00000000-0000-0000-0000-0000001600' || lpad(n::text, 2, '0'))::uuid,
       'authenticated', 'authenticated', 'fill' || n || '@x.test', '', now(), now()
  from generate_series(4, 99) n where n <> 5;
insert into profiles (id, role, seq_number, name)
select ('00000000-0000-0000-0000-0000001600' || lpad(n::text, 2, '0'))::uuid, 'admin', n, 'fill'
  from generate_series(4, 99) n where n <> 5;
select is(generate_login_code('Ana'), 'PASSOS05ANA', 'ainda reaproveita o 5 livre');
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000160005', 'authenticated', 'authenticated', 'fill5@x.test', '', now(), now());
insert into profiles (id, role, seq_number, name) values ('00000000-0000-0000-0000-000000160005', 'admin', 5, 'fill');
select is(generate_login_code('Ana'), 'PASSOS100ANA', '100 sem zero à esquerda');

select * from finish();
rollback;
