# Decisões da implementação — quinzena por motorista, combustível pela nota, Transfer iniciar/concluir, balanço mensal (2026-11-02/03)

Registro das decisões tomadas durante a execução (com o custo caso estejam erradas) e dos pontos menores adiados.

- Ruling: compute km_equivalent live in cost_per_km_for (quantity × car_consumption) — closed periods frozen in statements anyway — column kept for display.
- Ruling: (from minor #6) driver fueling insert must use driver's current car (FUEL_CAR_NOT_ALLOWED) — prevents picking a higher-consumption car — admin unaffected.
- Ruling: end_shift raises TRANSFER_IN_PROGRESS when a linked transfer is in_progress — keeps shift km coherent.
- Ruling: address check — backfill existing transfer rows ('Não informado' / old origin-destination text) before adding the check — production has test data only.
- Ruling: also fix minors: pause date must be ≤ today (INVALID_DATE); btree_gist in schema extensions; signals loop guarded per driver.
- Task 5: review Approved (no Critical/Important). Ruling: fix minors 1–3 now (cheap, affect numbers shown): estimated true when month not over; installments amount ≥ installments×0.01; monthly_detail payment period via statement id. Minor 4 (storage update/delete tests) included.
- Ruling: T7 must leave `npm test` and `npm run build` green; admin api functions that call dropped RPCs (close_period, period_summary, periods…) may be temporarily adapted/stubbed to the new RPCs or throw 'NOT_AVAILABLE' until T8–T10 replace them.
- Ruling: also fix cheap minors now: 10MB limit only for PDFs (images checked after compression); PDF by .pdf extension when MIME empty; round quantity/unit_price to 3 decimals before conflict check.
- Ruling: I1 — add supabase/deploy/2026-11-cleanup-test-driver.sql (old 0009 schema; single txn; session_replication_role=replica; delete one driver's data by login code in dependency order, then auth user) + guard at top of 0010 raising readable errors; DEPLOY.md fixed (cleanup → db push → publish app via push main → functions deploy → check).
- Ruling: I2 — fuel reimbursement keyed on fueling car ownership='company'; transfer fuel keyed on rides.car_id car ownership='own'; UI confirm on driver type change.
- Ruling: I3 — list/signals include drivers with an open period or unpaid statement regardless of active.
- Ruling: I4 — shift review lists the shift's rides with receipt thumbnails/PDF links.
- Ruling: also fix now: receipt negative/zero total wording; Balance stale-response guard; early-close confirm text mentions blocking remaining days; accountant CSV CPF formatted + pt-BR type/status labels; driver_period_for limited to dates ≤ today for drivers; approve transfer with expected expense ids (unseen expenses stay pending).

## Pontos menores adiados

- Task 1: minor (deferred → T4): cycle_start_date guard + exclusion constraint on driver_periods (driver_id, daterange); resume test; restore rejected_shifts skips
- Task 1: minor (deferred): explicit today effective_date clamp; CPF stored digits only (table check) → T6 must strip mask; admin adjustment on paused driver w/o period → DRIVER_PAUSED (acceptable)
- Task 2: minor (deferred): partial missing consumption not flagged; ODOMETER_BELOW_LAST counts rejected shifts; driver_type read live for transfers; test gaps (fallback car different consumption, fueled_on order)
- Task 2: minor (deferred): no test for update moving fueling car; company fallback O(n)
- Task 3: minor (deferred): reassign of completed/checked keeps old readings; duplicate origin/destination columns; complete end reading not checked vs other car readings
- Task 4: minor (deferred): pause vs concurrent insert race; complete_transfer FOR SHARE comment; pause inside closed period → PERIOD_CLOSED; idle drivers create zero periods (spec)
- Task 5: minor (deferred): off_duty_discount sign in UI (T10); legacy frozen statements breakdown
- Task 6: minor (deferred → final review): update-driver old-car release non-atomic (consider SQL RPC); Nominatim not rate-spaced; estimate-route integration test gated by service key; requireAdmin outside try
- Task 7: minor (deferred): Lançar toll needs signal; editing fueling doesn't re-check conflict; stale shared file; CarsPage flex default (T8); admin Transfers create lacks address (T9)
- Task 8: minor (deferred → final): BEFORE_CYCLE_START pause/resume message; recurring edit start>end generic error; legacy driver w/o CPF hint; doc delete orphan file; no RED captured
- Task 9: minor (deferred → final): ❗ tooltip should say "Fechada sem consumo/nota"; recibo with negative/zero total wording; rejected expenses shown without status; km-not-calculated notice persists
- Task 10: minor (deferred → final): Balance stale-response guard; cleared month input; car expense driver_amount exported 0,00 (blank); empty detail CSV without header; invalid tipo lists all
- Task 11: minor (deferred → final): estimate-route branch race in E2E; DEPLOY CPF wording (delete test driver account too); hard-coded seed counts; tz near midnight
- Final fix wave: re-review all addressed. Residual minors: transfer without car_id gets no own-car fuel; auth sessions orphan after replica delete; SQL editor role and session_replication_role unverified on hosted.
