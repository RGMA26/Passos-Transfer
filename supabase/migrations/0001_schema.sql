create extension if not exists unaccent;
create extension if not exists pgcrypto;

create sequence driver_seq;

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  role text not null check (role in ('admin','driver')),
  login_code text unique,
  seq_number int unique,
  name text,
  phone text,
  driver_type text check (driver_type in ('own_car','company_car')),
  uber_pct numeric(5,2) check (uber_pct > 0 and uber_pct <= 100),
  transfer_pct numeric(5,2) check (transfer_pct > 0 and transfer_pct <= 100),
  current_car_id uuid,
  active boolean not null default true,
  must_change_password boolean not null default true,
  check (role <> 'driver' or (driver_type is not null and transfer_pct is not null)),
  check (driver_type is distinct from 'company_car' or uber_pct is not null),
  check (role <> 'admin' or driver_type is null)
);

create table cars (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  model text not null,
  plate text not null unique,
  consumption_km_l numeric(5,2) not null check (consumption_km_l > 0),
  ownership text not null check (ownership in ('own','company')),
  current_driver_id uuid references profiles(id)
);

alter table profiles add constraint profiles_current_car_fk
  foreign key (current_car_id) references cars(id);

create table periods (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  start_date date not null unique,
  end_date date not null,
  status text not null default 'open' check (status in ('open','closed')),
  reference_fuel_price numeric(6,3),
  closed_at timestamptz,
  check (end_date >= start_date),
  check (
    end_date = (date_trunc('month', end_date) + interval '1 month - 1 day')::date
    or extract(day from end_date) = 15
  )
);

create table shifts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  driver_id uuid not null references profiles(id),
  car_id uuid not null references cars(id),
  consumption_km_l numeric(5,2) not null check (consumption_km_l > 0),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  start_date date not null,
  odometer_start int not null,
  odometer_start_photo text,
  odometer_end int,
  odometer_end_photo text,
  uber_earnings_photo text,
  review_status text not null default 'pending' check (review_status in ('pending','approved','rejected')),
  reject_reason text,
  check (odometer_end is null or odometer_end >= odometer_start)
);

create table rides (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  driver_id uuid not null references profiles(id),
  shift_id uuid references shifts(id),
  platform text not null check (platform in ('uber','transfer','blablacar')),
  ride_date date not null,
  amount numeric(10,2) not null check (amount >= 0),
  km numeric(8,1) check (km >= 0),
  driver_pct numeric(5,2),
  consumption_km_l numeric(5,2),
  client_name text,
  scheduled_at timestamptz,
  origin text,
  destination text,
  transfer_status text check (transfer_status in ('assigned','completed','checked')),
  check (platform <> 'transfer' or (client_name is not null and transfer_status is not null))
);

create table ride_expenses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  ride_id uuid not null references rides(id) on delete cascade,
  kind text not null check (kind in ('toll','parking')),
  amount numeric(10,2) not null check (amount > 0),
  photo_path text not null,
  review_status text not null default 'pending' check (review_status in ('pending','approved','rejected')),
  reject_reason text
);

create table fuelings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  driver_id uuid not null references profiles(id),
  car_id uuid not null references cars(id),
  fueled_on date not null,
  amount numeric(10,2) not null check (amount > 0),
  liters numeric(7,3) not null check (liters > 0),
  photo_path text not null,
  review_status text not null default 'pending' check (review_status in ('pending','approved','rejected')),
  reject_reason text
);

create table adjustments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  driver_id uuid not null references profiles(id),
  period_id uuid not null references periods(id),
  kind text not null check (kind in ('advance','fine','bonus','correction')),
  amount numeric(10,2) not null,
  description text not null,
  check (
    (kind in ('advance','fine') and amount < 0)
    or (kind = 'bonus' and amount > 0)
    or (kind = 'correction' and amount <> 0)
  )
);

create table statements (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  driver_id uuid not null references profiles(id),
  period_id uuid not null references periods(id),
  lines jsonb,
  total numeric(10,2),
  paid_at date,
  payment_method text,
  unique (driver_id, period_id)
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_id uuid,
  at timestamptz not null default now(),
  table_name text,
  row_id uuid,
  action text,
  old_data jsonb,
  new_data jsonb
);

create function period_for_date(d date) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  s date;
  e date;
  pid uuid;
begin
  if extract(day from d) <= 15 then
    s := date_trunc('month', d)::date;
    e := s + 14;
  else
    s := date_trunc('month', d)::date + 15;
    e := (date_trunc('month', d) + interval '1 month - 1 day')::date;
  end if;
  insert into periods (start_date, end_date) values (s, e)
    on conflict (start_date) do nothing;
  select id into pid from periods where start_date = s;
  return pid;
end $$;
