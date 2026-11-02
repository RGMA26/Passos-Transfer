-- Gastos dos carros da empresa, documentos do admin, balanço mensal, planilha detalhada e
-- central de pendências (spec §4, §5, §9.5, §9.6). Tudo somente admin.
--  * statement_lines: as regras do extrato (compute_statement) num intervalo de datas da quinzena;
--    compute_statement passa a ser o intervalo inteiro. O balanço usa o mesmo cálculo por mês.
--  * Mês = mês civil de America/Sao_Paulo; p_month = qualquer data do mês.

-- ===== Linhas do extrato num intervalo da quinzena (interno) =====
-- p_from/p_to nulos = quinzena inteira. Lançamentos pela data (corrida, abastecimento, início do
-- turno; ajuste pela effective_date). O custo por km é sempre o da quinzena inteira; com p_frozen
-- (linhas de um extrato congelado que tenham cost_per_km) usa o custo congelado.
create function statement_lines(p_driver uuid, p_period uuid, p_from date, p_to date,
                                p_frozen jsonb default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  per driver_periods%rowtype;
  v_from date;
  v_to date;
  v_type text;
  v_cpk jsonb;
  v_cost numeric;
  v_uber numeric;
  v_transfer numeric;
  v_fuel numeric;
  v_transfer_fuel numeric;
  v_own_km numeric;
  v_expense numeric;
  v_pending_exp numeric;
  v_pending_fuel numeric;
  v_km_total numeric;
  v_km_service numeric;
  v_km_off numeric;
  v_discount numeric;
  v_adjust numeric;
  v_needed boolean;
begin
  select * into per from driver_periods where id = p_period and driver_id = p_driver;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  v_from := greatest(per.start_date, coalesce(p_from, per.start_date));
  v_to := least(per.end_date, coalesce(p_to, per.end_date));

  select driver_type into v_type from profiles where id = p_driver;
  v_cpk := cost_per_km_for(p_driver, p_period);
  if p_frozen is not null and p_frozen ? 'cost_per_km' then
    v_cost := (p_frozen->>'cost_per_km')::numeric;
  else
    v_cost := (v_cpk->>'cost_per_km')::numeric;
  end if;

  select round(coalesce(sum(amount * driver_pct / 100), 0), 2) into v_uber
    from rides
   where driver_id = p_driver and platform = 'uber'
     and ride_date between v_from and v_to;

  select round(coalesce(sum(amount * driver_pct / 100), 0), 2),
         coalesce(sum(km), 0)
    into v_transfer, v_own_km
    from rides
   where driver_id = p_driver and platform = 'transfer'
     and transfer_status in ('completed', 'checked')
     and ride_date between v_from and v_to;
  if v_type is distinct from 'own_car' then
    v_own_km := 0;
  end if;
  v_transfer_fuel := round(v_own_km * coalesce(v_cost, 0), 2);

  select coalesce(sum(amount) filter (where review_status = 'approved'), 0),
         coalesce(sum(amount) filter (where review_status = 'pending'), 0)
    into v_fuel, v_pending_fuel
    from fuelings
   where driver_id = p_driver
     and fueled_on between v_from and v_to;
  if v_type is distinct from 'company_car' then
    v_fuel := 0;
  end if;

  select coalesce(sum(e.amount) filter (where e.review_status = 'approved'), 0),
         coalesce(sum(e.amount) filter (where e.review_status = 'pending'), 0)
    into v_expense, v_pending_exp
    from ride_expenses e
    join rides r on r.id = e.ride_id
   where r.driver_id = p_driver and r.platform = 'transfer'
     and r.transfer_status in ('completed', 'checked')
     and r.ride_date between v_from and v_to;

  select coalesce(sum(t.km_total), 0),
         coalesce(sum(t.km_service), 0),
         coalesce(sum(t.km_off), 0)
    into v_km_total, v_km_service, v_km_off
    from (
      select s.odometer_end - s.odometer_start as km_total,
             coalesce(rs.km, 0) as km_service,
             greatest(0, s.odometer_end - s.odometer_start - coalesce(rs.km, 0)) as km_off
        from shifts s
        left join lateral (
          select sum(r.km) as km from rides r
           where r.shift_id = s.id and r.driver_id = s.driver_id
             and (r.platform <> 'transfer' or r.transfer_status in ('completed', 'checked'))
        ) rs on true
       where s.driver_id = p_driver
         and s.ended_at is not null
         and s.start_date between v_from and v_to
    ) t;
  v_discount := round(v_km_off * coalesce(v_cost, 0), 2);

  select coalesce(sum(amount), 0) into v_adjust
    from adjustments
   where driver_id = p_driver and driver_period_id = p_period
     and (p_from is null or effective_date >= p_from)
     and (p_to is null or effective_date <= p_to);

  v_needed := v_own_km > 0 or v_km_off > 0;

  return jsonb_build_object(
    'uber_share', v_uber,
    'transfer_share', v_transfer,
    'fuel_reimbursement', v_fuel,
    'transfer_fuel_reimbursement', v_transfer_fuel,
    'expense_reimbursement', v_expense,
    'off_duty_fuel_discount', v_discount,
    'adjustments', v_adjust,
    'total', v_uber + v_transfer + v_fuel + v_transfer_fuel + v_expense - v_discount + v_adjust,
    'cost_per_km', round(v_cost, 4),
    'missing_consumption', v_needed and (v_cpk->>'missing_consumption')::boolean,
    'missing_fuel_price', v_needed and v_cost is null
                          and not (v_cpk->>'missing_consumption')::boolean,
    'km', jsonb_build_object('total', v_km_total, 'service', v_km_service, 'off', v_km_off),
    'pending', jsonb_build_object('fuelings', v_pending_fuel, 'expenses', v_pending_exp));
end $$;

revoke execute on function statement_lines(uuid, uuid, date, date, jsonb) from public, anon, authenticated;

-- compute_statement: mesma saída da 0011, agora sobre statement_lines (quinzena inteira)
create or replace function compute_statement(p_driver uuid, p_period uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (is_admin() or (auth.uid() = p_driver and is_active_driver())) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return statement_lines(p_driver, p_period, null, null);
end $$;

revoke execute on function compute_statement(uuid, uuid) from public, anon;
grant execute on function compute_statement(uuid, uuid) to authenticated;

-- ===== Parte de uma quinzena que cai num mês (interno) =====
-- Telescópica: parte(M) = L(início … fim de M) − L(início … véspera de M), em que L(início … fim da
-- quinzena) é o extrato inteiro — o congelado, se fechada (o custo por km dos pedaços também é o
-- congelado). Assim as partes de todos os meses somam exatamente o extrato, centavo a centavo.
create function period_month_owed(p_period uuid, p_month_start date, p_month_end date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  per driver_periods%rowtype;
  v_frozen jsonb;
  v_full jsonb;
  a jsonb;
  b jsonb;
  k text;
  r jsonb := '{}'::jsonb;
begin
  select * into per from driver_periods where id = p_period;
  if not found or per.end_date < p_month_start or per.start_date > p_month_end then
    return null;
  end if;
  if per.status = 'closed' then
    select lines into v_frozen from statements where driver_period_id = per.id;
  end if;
  v_full := statement_lines(per.driver_id, per.id, null, null, v_frozen);
  if v_frozen is not null then
    -- linhas congeladas prevalecem (chave ausente num extrato antigo → valor recalculado)
    v_full := v_full || jsonb_strip_nulls(v_frozen);
  end if;

  a := case when per.end_date <= p_month_end then v_full
            else statement_lines(per.driver_id, per.id, null, p_month_end, v_frozen) end;
  b := case when per.start_date >= p_month_start then null
            else statement_lines(per.driver_id, per.id, null, p_month_start - 1, v_frozen) end;

  foreach k in array array['uber_share', 'transfer_share', 'fuel_reimbursement',
                           'transfer_fuel_reimbursement', 'expense_reimbursement',
                           'off_duty_fuel_discount', 'adjustments', 'total']
  loop
    r := r || jsonb_build_object(k, coalesce((a->>k)::numeric, 0) - coalesce((b->>k)::numeric, 0));
  end loop;
  return r;
end $$;

revoke execute on function period_month_owed(uuid, date, date) from public, anon, authenticated;

-- ===== Gastos dos carros da empresa =====
create table car_expenses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  car_id uuid not null references cars(id),
  kind text not null check (kind in ('maintenance','insurance','tax','other')),
  description text,
  mode text not null check (mode in ('single','installments','recurring')),
  amount numeric(10,2) not null check (amount > 0),
  installments int,
  start_date date not null,
  end_date date,
  finished boolean not null default false,
  deleted_on date,
  check (kind not in ('tax','other') or btrim(coalesce(description, '')) <> ''),
  check ((mode = 'installments') = (installments is not null)),
  check (installments is null or installments >= 2),
  -- parcela mínima de 1 centavo (a última nunca fica negativa)
  check (mode <> 'installments' or amount >= installments * 0.01),
  -- só o recorrente é finalizado; finalizado tem último mês, não anterior ao início
  check (mode = 'recurring' or (end_date is null and not finished)),
  check (finished = (end_date is not null)),
  check (end_date is null or end_date >= date_trunc('month', start_date)::date)
);

create index car_expenses_car_idx on car_expenses (car_id);

create function car_expenses_company_car() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' or new.car_id is distinct from old.car_id then
    if not exists (select 1 from cars where id = new.car_id and ownership = 'company') then
      raise exception 'CAR_NOT_COMPANY' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

revoke execute on function car_expenses_company_car() from public, anon, authenticated;

create trigger car_expenses_company_car before insert or update on car_expenses
  for each row execute function car_expenses_company_car();
create trigger audit_car_expenses after insert or update or delete on car_expenses
  for each row execute function audit_row();

alter table car_expenses enable row level security;
create policy admin_all on car_expenses for all to authenticated using (is_admin()) with check (is_admin());
revoke all on car_expenses from anon;

-- Gastos que contam no mês M (§4.6): pontual no mês do início; parcela k (0 ≤ k < N) quando
-- mês(início) + k = M (round(valor/N, 2), a última absorve os centavos); recorrente de mês(início)
-- até mês(end_date) se finalizado; sempre só se deleted_on nulo ou M < mês(deleted_on).
create function car_expenses_for_month(p_month date)
returns table(expense_id uuid, car_id uuid, plate text, model text, kind text, description text,
              mode text, installment_no int, installments int, amount numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_month date := date_trunc('month', p_month)::date;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_month is null then
    raise exception 'INVALID_DATE' using errcode = 'P0001';
  end if;

  return query
  select e.id, e.car_id, c.plate, c.model, e.kind, e.description, e.mode,
         case when e.mode = 'installments' then x.k + 1 end,
         e.installments,
         case e.mode
           when 'installments' then
             case when x.k = e.installments - 1
                  then e.amount - (e.installments - 1) * round(e.amount / e.installments, 2)
                  else round(e.amount / e.installments, 2) end
           else e.amount
         end::numeric
    from car_expenses e
    join cars c on c.id = e.car_id
    cross join lateral (
      select ((extract(year from v_month) - extract(year from e.start_date)) * 12
              + extract(month from v_month) - extract(month from e.start_date))::int as k
    ) x
   where (e.deleted_on is null or v_month < date_trunc('month', e.deleted_on)::date)
     and case e.mode
           when 'single' then x.k = 0
           when 'installments' then x.k between 0 and e.installments - 1
           else x.k >= 0 and (e.end_date is null or v_month <= date_trunc('month', e.end_date)::date)
         end
   order by c.plate, e.start_date, e.id;
end $$;

-- ===== Documentos do admin =====
create table admin_documents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  driver_id uuid not null references profiles(id),
  statement_id uuid references statements(id),
  kind text not null check (kind in ('payment_proof','signed_receipt','other')),
  description text,
  file_path text not null check (btrim(file_path) <> ''),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','application/pdf')),
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 10485760),
  check (kind <> 'other' or btrim(coalesce(description, '')) <> '')
);

create index admin_documents_driver_idx on admin_documents (driver_id);
create index admin_documents_statement_idx on admin_documents (statement_id) where statement_id is not null;

-- extrato precisa ser do mesmo motorista
create function admin_documents_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.statement_id is not null
     and not exists (select 1 from statements where id = new.statement_id and driver_id = new.driver_id) then
    raise exception 'INVALID_STATEMENT' using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke execute on function admin_documents_check() from public, anon, authenticated;

create trigger admin_documents_check before insert or update on admin_documents
  for each row execute function admin_documents_check();
create trigger audit_admin_documents after insert or update or delete on admin_documents
  for each row execute function audit_row();

alter table admin_documents enable row level security;
create policy admin_all on admin_documents for all to authenticated using (is_admin()) with check (is_admin());
revoke all on admin_documents from anon;

-- Bucket privado admin-docs: só admin (motoristas não têm política alguma)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('admin-docs', 'admin-docs', false, 10485760, array['image/jpeg','image/png','application/pdf'])
  on conflict do nothing;

create policy admin_docs_select on storage.objects for select to authenticated
  using (bucket_id = 'admin-docs' and is_admin());
create policy admin_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'admin-docs' and is_admin());
create policy admin_docs_update on storage.objects for update to authenticated
  using (bucket_id = 'admin-docs' and is_admin())
  with check (bucket_id = 'admin-docs' and is_admin());
create policy admin_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'admin-docs' and is_admin());

-- ===== Resultado do mês (interno) =====
create function month_result(p_month date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_revenue jsonb;
  v_owed jsonb;
  v_by_driver jsonb;
  v_exp jsonb;
begin
  select jsonb_build_object(
           'uber', coalesce(sum(amount) filter (where platform = 'uber'), 0),
           'transfer', coalesce(sum(amount) filter (where platform = 'transfer'
                                                    and transfer_status in ('completed', 'checked')), 0),
           'blablacar', coalesce(sum(amount) filter (where platform = 'blablacar'), 0),
           'total', coalesce(sum(amount) filter (where platform <> 'transfer'
                                                 or transfer_status in ('completed', 'checked')), 0))
    into v_revenue
    from rides
   where ride_date between v_start and v_end;

  with seg as (
    select p.driver_id, period_month_owed(p.id, v_start, v_end) as o
      from driver_periods p
     where p.start_date <= v_end and p.end_date >= v_start
  ), drv as (
    select s.driver_id,
           sum((o->>'uber_share')::numeric) as uber_share,
           sum((o->>'transfer_share')::numeric) as transfer_share,
           sum((o->>'fuel_reimbursement')::numeric) as fuel_reimbursement,
           sum((o->>'transfer_fuel_reimbursement')::numeric) as transfer_fuel,
           sum((o->>'expense_reimbursement')::numeric) as expense_reimbursement,
           sum((o->>'off_duty_fuel_discount')::numeric) as off_duty_discount,
           sum((o->>'adjustments')::numeric) as adjustments,
           sum((o->>'total')::numeric) as total
      from seg s
     group by s.driver_id
  )
  select jsonb_build_object(
           'total', coalesce(sum(d.total), 0),
           'uber_share', coalesce(sum(d.uber_share), 0),
           'transfer_share', coalesce(sum(d.transfer_share), 0),
           'fuel_reimbursement', coalesce(sum(d.fuel_reimbursement), 0),
           'transfer_fuel', coalesce(sum(d.transfer_fuel), 0),
           'expense_reimbursement', coalesce(sum(d.expense_reimbursement), 0),
           'off_duty_discount', coalesce(sum(d.off_duty_discount), 0),
           'adjustments', coalesce(sum(d.adjustments), 0),
           'by_driver', coalesce(jsonb_agg(jsonb_build_object('driver_id', d.driver_id, 'name', pr.name,
                                                              'total', d.total)
                                           order by pr.name, d.driver_id)
                                   filter (where d.uber_share <> 0 or d.transfer_share <> 0
                                           or d.fuel_reimbursement <> 0 or d.transfer_fuel <> 0
                                           or d.expense_reimbursement <> 0 or d.off_duty_discount <> 0
                                           or d.adjustments <> 0), '[]'::jsonb))
    into v_owed
    from drv d
    join profiles pr on pr.id = d.driver_id;

  select jsonb_build_object(
           'total', coalesce(sum(e.amount), 0),
           'by_kind', jsonb_build_object(
             'maintenance', coalesce(sum(e.amount) filter (where e.kind = 'maintenance'), 0),
             'insurance', coalesce(sum(e.amount) filter (where e.kind = 'insurance'), 0),
             'tax', coalesce(sum(e.amount) filter (where e.kind = 'tax'), 0),
             'other', coalesce(sum(e.amount) filter (where e.kind = 'other'), 0)),
           'items', coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb))
    into v_exp
    from car_expenses_for_month(v_start) e;

  return jsonb_build_object(
    'revenue', v_revenue,
    'owed', v_owed,
    'car_expenses', v_exp,
    'company_result', (v_revenue->>'total')::numeric - (v_owed->>'total')::numeric
                      - (v_exp->>'total')::numeric);
end $$;

revoke execute on function month_result(date) from public, anon, authenticated;

-- ===== Balanço mensal =====
create function monthly_balance(p_month date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_start date;
  v_end date;
  v_result jsonb;
  v_prev numeric;
  v_cur numeric;
  v_cash jsonb;
  v_payable jsonb;
  v_ranking jsonb;
  v_estimated boolean;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_month is null then
    raise exception 'INVALID_DATE' using errcode = 'P0001';
  end if;
  v_start := date_trunc('month', p_month)::date;
  v_end := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;

  v_result := month_result(v_start);
  v_cur := (v_result->>'company_result')::numeric;
  v_prev := (month_result((v_start - interval '1 month')::date)->>'company_result')::numeric;
  v_result := v_result || jsonb_build_object(
    'previous_company_result', v_prev,
    'diff', v_cur - v_prev,
    'diff_pct', case when v_prev <> 0 then round((v_cur - v_prev) / abs(v_prev) * 100, 2) end);

  -- estimado: o mês ainda não acabou (SP) ou alguma quinzena com dias no mês está aberta
  v_estimated := v_end >= (now() at time zone 'America/Sao_Paulo')::date
                 or exists (select 1 from driver_periods
                             where status = 'open' and start_date <= v_end and end_date >= v_start);

  -- Caixa: repasses pagos no mês
  select jsonb_build_object(
           'total', coalesce(sum(s.total), 0),
           'items', coalesce(jsonb_agg(jsonb_build_object(
             'statement_id', s.id, 'driver_id', s.driver_id, 'name', pr.name,
             'period_start', dp.start_date, 'period_end', dp.end_date, 'total', s.total,
             'paid_at', s.paid_at, 'payment_method', s.payment_method,
             'has_payment_proof', exists (select 1 from admin_documents d
                                           where d.statement_id = s.id and d.kind = 'payment_proof'),
             'has_signed_receipt', exists (select 1 from admin_documents d
                                            where d.statement_id = s.id and d.kind = 'signed_receipt'))
             order by s.paid_at, pr.name, s.id), '[]'::jsonb))
    into v_cash
    from statements s
    join driver_periods dp on dp.id = s.driver_period_id
    join profiles pr on pr.id = s.driver_id
   where s.paid_at between v_start and v_end;

  -- A pagar (hoje): extratos fechados e não pagos + quinzenas abertas (estimado)
  with x as (
    select s.driver_id, s.total as closed_unpaid, 0::numeric as open_estimate
      from statements s where s.paid_at is null
    union all
    select p.driver_id, 0, (statement_lines(p.driver_id, p.id, null, null)->>'total')::numeric
      from driver_periods p where p.status = 'open'
  ), d as (
    select x.driver_id, sum(x.closed_unpaid) as closed_unpaid, sum(x.open_estimate) as open_estimate
      from x group by x.driver_id
  )
  select jsonb_build_object(
           'total', coalesce(sum(d.closed_unpaid + d.open_estimate), 0),
           'items', coalesce(jsonb_agg(jsonb_build_object(
             'driver_id', d.driver_id, 'name', pr.name,
             'closed_unpaid', d.closed_unpaid, 'open_estimate', d.open_estimate)
             order by pr.name, d.driver_id)
             filter (where d.closed_unpaid <> 0 or d.open_estimate <> 0), '[]'::jsonb))
    into v_payable
    from d join profiles pr on pr.id = d.driver_id;

  -- Ranking de km por fora (turnos encerrados iniciados no mês), só > 0
  with t as (
    select s.driver_id, s.car_id,
           greatest(0, s.odometer_end - s.odometer_start - coalesce((
             select sum(r.km) from rides r
              where r.shift_id = s.id and r.driver_id = s.driver_id
                and (r.platform <> 'transfer' or r.transfer_status in ('completed', 'checked'))), 0)) as km_off
      from shifts s
     where s.ended_at is not null and s.start_date between v_start and v_end
  )
  select jsonb_build_object(
    'by_driver', coalesce((
      select jsonb_agg(jsonb_build_object('driver_id', y.driver_id, 'name', y.name, 'km_off', y.km_off)
                       order by y.km_off desc, y.name)
        from (select t.driver_id, pr.name, sum(t.km_off) as km_off
                from t join profiles pr on pr.id = t.driver_id
               group by t.driver_id, pr.name having sum(t.km_off) > 0) y), '[]'::jsonb),
    'by_car', coalesce((
      select jsonb_agg(jsonb_build_object('car_id', y.car_id, 'plate', y.plate, 'model', y.model,
                                          'km_off', y.km_off)
                       order by y.km_off desc, y.plate)
        from (select t.car_id, c.plate, c.model, sum(t.km_off) as km_off
                from t join cars c on c.id = t.car_id
               group by t.car_id, c.plate, c.model having sum(t.km_off) > 0) y), '[]'::jsonb))
    into v_ranking
    from (select 1) one;

  return jsonb_build_object(
    'month', v_start,
    'estimated', v_estimated,
    'result', v_result,
    'cash', v_cash,
    'payable', v_payable,
    'off_km_ranking', v_ranking);
end $$;

-- ===== Planilha detalhada do mês =====
-- Uma linha por corrida, abastecimento, pedágio/estacionamento, ajuste (effective_date), pagamento
-- (paid_at) e gasto de carro que conta no mês (sem motorista). driver_amount = o que entra no
-- extrato (0 quando não entra; nulo nos gastos de carro).
create function monthly_detail(p_month date)
returns table(occurred_on date, driver_name text, cpf text, login_code text, kind text,
              description text, gross numeric, driver_amount numeric, period_label text, status text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_start date;
  v_end date;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_month is null then
    raise exception 'INVALID_DATE' using errcode = 'P0001';
  end if;
  v_start := date_trunc('month', p_month)::date;
  v_end := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;

  return query
  with items as (
    -- corridas
    select r.ride_date as d, r.driver_id as drv, r.platform as k,
           case r.platform when 'transfer' then r.client_name
                           when 'uber' then 'Uber' else 'BlaBlaCar' end as descr,
           r.amount as g,
           case when r.platform = 'uber'
                  or (r.platform = 'transfer' and r.transfer_status in ('completed', 'checked'))
                then round(r.amount * r.driver_pct / 100, 2) else 0 end as amt,
           case when r.platform = 'transfer' then r.transfer_status
                else coalesce(s.review_status, 'pending') end as st,
           null::uuid as stmt
      from rides r
      left join shifts s on s.id = r.shift_id
     where r.ride_date between v_start and v_end
    union all
    -- abastecimentos (reembolso só para carro da empresa)
    select f.fueled_on, f.driver_id, 'fueling', f.fuel,
           f.amount,
           case when f.review_status = 'approved' and pr.driver_type = 'company_car' then f.amount else 0 end,
           f.review_status, null::uuid
      from fuelings f join profiles pr on pr.id = f.driver_id
     where f.fueled_on between v_start and v_end
    union all
    -- pedágios e estacionamentos (pela data do Transfer)
    select r.ride_date, r.driver_id, e.kind, r.client_name,
           e.amount,
           case when e.review_status = 'approved' and r.transfer_status in ('completed', 'checked')
                then e.amount else 0 end,
           e.review_status, null::uuid
      from ride_expenses e join rides r on r.id = e.ride_id
     where r.ride_date between v_start and v_end
    union all
    -- ajustes
    select a.effective_date, a.driver_id, 'adjustment', a.description, a.amount, a.amount, a.kind, null::uuid
      from adjustments a
     where a.effective_date between v_start and v_end
    union all
    -- pagamentos
    select s.paid_at, s.driver_id, 'payment', s.payment_method, s.total, s.total, 'paid', s.id
      from statements s
     where s.paid_at between v_start and v_end
  )
  select i.d, pr.name, pr.cpf, pr.login_code, i.k, i.descr, i.g::numeric, i.amt::numeric,
         case when i.stmt is not null then
                (select to_char(dp.start_date, 'DD/MM') || '–' || to_char(dp.end_date, 'DD/MM')
                   from statements s2 join driver_periods dp on dp.id = s2.driver_period_id
                  where s2.id = i.stmt)
              else
                (select to_char(dp.start_date, 'DD/MM') || '–' || to_char(dp.end_date, 'DD/MM')
                   from driver_periods dp
                  where dp.driver_id = i.drv and i.d between dp.start_date and dp.end_date)
         end,
         i.st
    from items i join profiles pr on pr.id = i.drv
  union all
  select v_start, null::text, null::text, null::text, 'car_expense',
         e.plate || ' ' || e.model || ' — ' || e.kind || coalesce(' — ' || e.description, ''),
         e.amount, null::numeric, null::text,
         case e.mode when 'installments' then 'installment ' || e.installment_no || '/' || e.installments
                     else e.mode end
    from car_expenses_for_month(v_start) e
  order by 1, 2 nulls last, 5;
end $$;

-- ===== Central de pendências =====
-- white: abastecimentos pendentes sem conflito, turnos encerrados pendentes/recusados, Transfers
-- concluídos; orange: abastecimentos pendentes com conflito; yellow/red: driver_period_signals
-- (item_id = quinzena: a atual no amarelo, a terminada aberta mais antiga no vermelho).
create function admin_pendencies()
returns table(category text, item_type text, item_id uuid, driver_id uuid, driver_name text,
              label text, occurred_on date)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  return query
  select case when f.values_conflict then 'orange' else 'white' end, 'fueling'::text, f.id, f.driver_id, pr.name,
         case when f.values_conflict then 'Abastecimento com valores conflitantes'
              else 'Abastecimento aguardando conferência' end,
         f.fueled_on
    from fuelings f join profiles pr on pr.id = f.driver_id
   where f.review_status = 'pending'
  union all
  select 'white', 'shift', s.id, s.driver_id, pr.name,
         case s.review_status when 'rejected' then 'Turno recusado' else 'Turno aguardando conferência' end,
         s.start_date
    from shifts s join profiles pr on pr.id = s.driver_id
   where s.ended_at is not null and s.review_status in ('pending', 'rejected')
  union all
  select 'white', 'transfer', r.id, r.driver_id, pr.name,
         'Transfer concluído aguardando conferência', r.ride_date
    from rides r join profiles pr on pr.id = r.driver_id
   where r.platform = 'transfer' and r.transfer_status = 'completed';

  return query
  with sig as (select * from driver_period_signals() x where x.signal is not null)
  select 'yellow'::text, 'period'::text, sig.current_period_id, sig.driver_id, sig.name,
         case when sig.days_left = 0 then 'Quinzena termina hoje'
              else 'Quinzena termina em ' || sig.days_left || ' dia(s)' end,
         sig.end_date
    from sig where sig.signal = 'yellow'
  union all
  select 'red', 'period', dp.id, sig.driver_id, sig.name, 'Quinzena terminada e não fechada', dp.end_date
    from sig
    cross join lateral (
      select p.id, p.end_date from driver_periods p
       where p.driver_id = sig.driver_id and p.status = 'open'
         and p.end_date < (now() at time zone 'America/Sao_Paulo')::date
       order by p.start_date limit 1) dp
   where sig.signal = 'red';
end $$;

-- ===== Privilégios =====
do $$
declare f text;
begin
  foreach f in array array['car_expenses_for_month(date)', 'monthly_balance(date)',
                           'monthly_detail(date)', 'admin_pendencies()']
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
