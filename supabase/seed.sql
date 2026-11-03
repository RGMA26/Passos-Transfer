-- Dados de desenvolvimento (db reset). Logins locais:
--   admin@passostransfer.app / admin123
--   passos01joao@login.passostransfer.app / senha123
--   passos02maria@login.passostransfer.app / senha123
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
) values
  ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-00000000ad01','authenticated','authenticated',
   'admin@passostransfer.app', crypt('admin123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-00000000d001','authenticated','authenticated',
   'passos01joao@login.passostransfer.app', crypt('senha123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-00000000d002','authenticated','authenticated',
   'passos02maria@login.passostransfer.app', crypt('senha123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id::text, u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u
where u.id in ('00000000-0000-0000-0000-00000000ad01',
               '00000000-0000-0000-0000-00000000d001',
               '00000000-0000-0000-0000-00000000d002');

insert into cars (id, model, plate, fuels, km_per_l_gasolina, ownership) values
  ('00000000-0000-0000-0000-00000000c001','Onix','PAS1A23','{gasolina,alcool}',10.0,'company'),
  ('00000000-0000-0000-0000-00000000c002','HB20','PAS2B34','{gasolina,alcool}',12.5,'own');

insert into profiles (id, role, login_code, seq_number, name, driver_type, uber_pct, transfer_pct, current_car_id, must_change_password, cpf, cycle_start_date) values
  ('00000000-0000-0000-0000-00000000ad01','admin',null,null,'Administrador',null,null,null,null,false,null,null),
  ('00000000-0000-0000-0000-00000000d001','driver','PASSOS01JOAO',1,'João Silva','company_car',40,30,'00000000-0000-0000-0000-00000000c001',false,'52998224725','2026-01-01'),
  ('00000000-0000-0000-0000-00000000d002','driver','PASSOS02MARIA',2,'Maria Souza','own_car',null,30,'00000000-0000-0000-0000-00000000c002',false,'10000001090','2026-01-01');

update cars set current_driver_id = '00000000-0000-0000-0000-00000000d001' where id = '00000000-0000-0000-0000-00000000c001';
update cars set current_driver_id = '00000000-0000-0000-0000-00000000d002' where id = '00000000-0000-0000-0000-00000000c002';

-- próximo código: 03
select setval('driver_seq', 2);
