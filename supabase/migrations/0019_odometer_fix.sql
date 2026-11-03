-- 0019: correção de odômetro e leitura fora do normal.
-- Em produção um Transfer foi lançado com 1.010.000 → 10.102.500 (km 9.092.500) dentro de um turno
-- 57.876 → 57.877, foi conferido, entrou no extrato e travou o carro (ODOMETER_BELOW_LAST no próximo
-- início). Ninguém foi avisado e o admin não tinha como corrigir. Agora:
--  * unreview_item: o admin desfaz a conferência (o item volta para a fila);
--  * admin_fix_transfer_odometer: o admin corrige as leituras de um Transfer não conferido;
--  * odometer_suspect (turno e Transfer): leitura fora do normal vira pendência 🟠 (não bloqueia);
--  * end_shift: a leitura final não pode ficar abaixo das leituras dos Transfers do turno.

-- ===== Desfazer conferência =====
-- transfer: checked → completed (despesas aprovadas voltam a pendentes, as recusadas ficam);
-- shift: approved|rejected → pending; fueling/expense: approved|rejected → pending.
-- Motivo da recusa é limpo. Item não conferido → NOT_REVIEWED. Quinzena fechada → PERIOD_CLOSED
-- (gatilho block_closed_period). Despesa de Transfer conferido: desfazer o Transfer (USE_TRANSFER_REVIEW).
create function unreview_item(p_kind text, p_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_status text;
  v_parent text;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('fueling', 'expense', 'shift', 'transfer') then
    raise exception 'INVALID_KIND' using errcode = 'P0001';
  end if;

  if p_kind = 'transfer' then
    select transfer_status into v_status from rides
     where id = p_id and platform = 'transfer' for update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_status <> 'checked' then
      raise exception 'NOT_REVIEWED' using errcode = 'P0001';
    end if;
    update rides set transfer_status = 'completed', reject_reason = null where id = p_id;
    update ride_expenses set review_status = 'pending', reject_reason = null
     where ride_id = p_id and review_status = 'approved';
  elsif p_kind = 'shift' then
    select review_status into v_status from shifts where id = p_id for update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_status not in ('approved', 'rejected') then
      raise exception 'NOT_REVIEWED' using errcode = 'P0001';
    end if;
    update shifts set review_status = 'pending', reject_reason = null where id = p_id;
  elsif p_kind = 'fueling' then
    select review_status into v_status from fuelings where id = p_id for update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_status not in ('approved', 'rejected') then
      raise exception 'NOT_REVIEWED' using errcode = 'P0001';
    end if;
    update fuelings set review_status = 'pending', reject_reason = null where id = p_id;
  else
    select e.review_status, r.transfer_status into v_status, v_parent
      from ride_expenses e join rides r on r.id = e.ride_id
     where e.id = p_id
       for update of e;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_status not in ('approved', 'rejected') then
      raise exception 'NOT_REVIEWED' using errcode = 'P0001';
    end if;
    if v_parent = 'checked' then
      raise exception 'USE_TRANSFER_REVIEW' using errcode = 'P0001';
    end if;
    update ride_expenses set review_status = 'pending', reject_reason = null where id = p_id;
  end if;
end $$;

revoke execute on function unreview_item(text, uuid) from public, anon;
grant execute on function unreview_item(text, uuid) to authenticated;
