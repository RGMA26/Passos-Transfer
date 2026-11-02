# Quinzena por motorista, preço pela nota, Balanço mensal e Documentos — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar as quinzenas globais por ciclos de 15 dias por motorista (com pausa/retomada e sinais 🟡/🔴), tirar o preço de referência (preço vem das notas), e criar Balanço mensal, gastos dos carros, CPF, recibo e Documentos só do admin.

**Architecture:** Migrações novas 0010–0013 sobre o banco já publicado (sem dados reais). Regras de dinheiro e de bloqueio continuam no Postgres (funções + RLS, testadas com pgTAP); o frontend só chama RPCs/tabelas. A tabela global `periods` é substituída por `driver_periods`.

**Tech Stack:** igual ao projeto (Vite + React 19 + TS, Supabase Postgres/RLS/Storage/Edge Functions, pgTAP, Vitest, Playwright).

**Spec:** `docs/superpowers/specs/2026-11-02-quinzena-por-motorista-e-balanco-design.md`

## Global Constraints
- Fuso America/Sao_Paulo; "hoje" e "mês" sempre pela data local de SP.
- Quinzena = 15 dias corridos: `start = cycle_start_date + 15n`, `end = start + 14`.
- Sinal 🟡 quando `end_date − hoje ≤ 5` (inclui o último dia); 🔴 quando existe quinzena com `end_date < hoje` aberta.
- Conflito de abastecimento: `|litros × preço − total| > max(0,10; 0,005 × total)`. Texto: "Valores conflitantes, confira a nota"; botão "Salvar mesmo assim"; cor laranja (🟠) no admin.
- Preço do litro: média das notas aprovadas na quinzena → última nota aprovada do motorista (≤ fim da quinzena) → última nota aprovada da empresa (≤ fim) → 0 com `missing_fuel_price = true`.
- Reembolso de abastecimento só para `company_car`.
- Mensagem de fechamento sem nota: "Não há nota de abastecimento aprovada para calcular a gasolina desta quinzena. A gasolina será calculada como R$ 0,00. Tem certeza que deseja fechar?"; marca ❗ "Fechada sem nota de abastecimento".
- Pausa: "Seu cadastro está pausado. Fale com a empresa." (`DRIVER_PAUSED`).
- Gasto de carro excluído deixa de contar a partir do mês da exclusão (inclusive); meses anteriores ficam.
- Documentos e gastos de carro: somente admin (RLS + Storage). Arquivos JPG/PNG/PDF ≤ 10 MB.
- Toda RPC: security definer, `set search_path = public, pg_temp`, revoke public/anon, grant authenticated; erros `raise exception '<CODE>' using errcode='P0001'`; wrappers do front sempre enviam todos os parâmetros.
- UI em pt-BR. Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Ambiente: `export PATH="/c/Users/raiss/AppData/Local/Programs/DockerDesktop/resources/bin:$PATH"`; Supabase local portas 553xx; `npx supabase db reset --local && npx supabase test db`; após migrações `npx supabase gen types typescript --local > src/lib/database.types.ts`. NUNCA aplicar em projeto remoto.

## Review Focus
1. **Quinzena que atravessa a virada de mês/ano e cadastro no dia 31** → datas corretas e cada lançamento numa única quinzena. (Task 1)
2. **Pausa no meio de uma quinzena com lançamentos offline chegando depois** → lançamento com data ≤ pausa entra na quinzena encurtada; data na pausa → `DRIVER_PAUSED`; após retomar, entra no novo ciclo. (Tasks 1 e 3)
3. **Balanço com quinzena aberta que atravessa dois meses** → cada lançamento no mês da sua data; selo "estimado"; valores somam igual ao extrato quando fechada. (Task 4)
4. **Gasto parcelado com centavos e gasto excluído no meio** → soma das parcelas = valor cheio; meses antes da exclusão continuam. (Task 4)
5. **Motorista tentando abrir documento do admin pelo caminho do arquivo** → negado por Storage e RLS. (Task 4)

---

## Arquivos
```
supabase/migrations/0010_driver_periods.sql      ciclos, CPF, pausa (colunas), trava por quinzena do motorista
supabase/migrations/0011_fuel_price.sql          preço do litro, conflito, compute_statement/fuel_price_for/end_shift
supabase/migrations/0012_driver_close.sql        fechamento individual, sinais, pausa/retomada, alertas
supabase/migrations/0013_balance_docs.sql        gastos de carro, documentos admin, balanço mensal, planilha
supabase/tests/driver_periods.test.sql, fuel_price.test.sql, driver_close.test.sql, balance_docs.test.sql
supabase/functions/create-driver/index.ts        CPF
src/lib/api.ts (+ testes), src/lib/cpf.ts, src/lib/types.ts, src/lib/database.types.ts
src/driver/LaunchTab.tsx, StatementTab.tsx, TodayEntries.tsx
src/admin/DriversPage.tsx, DriverDocuments.tsx, CarsPage.tsx, CarExpenses.tsx, PeriodsPage.tsx, ReviewPage.tsx,
          DashboardPage.tsx, BalancePage.tsx, PrintReceiptPage.tsx, PrintBalancePage.tsx, AdminLayout.tsx
src/components/StatementView.tsx, PeriodSignal.tsx
e2e/full-flow.spec.ts, docs/DEPLOY.md
```

---

### Task 1: Ciclos por motorista, CPF e trava por quinzena (0010)

**Files:** Create `supabase/migrations/0010_driver_periods.sql`, `supabase/tests/driver_periods.test.sql`; Modify tests que usam `periods`/`period_for_date` (substituir por `driver_period_for`).

**Interfaces — Produces:**
- `profiles.cycle_start_date date` (not null para motoristas; default data SP de `created_at` na inserção), `profiles.cpf text unique` (obrigatório para `role='driver'`, check `is_valid_cpf(cpf)`), `profiles.paused boolean not null default false`.
- `is_valid_cpf(p text) returns boolean` (immutable; só dígitos, 11, dígitos verificadores, rejeita todos iguais).
- `driver_periods(id uuid pk, driver_id uuid fk profiles, start_date date, end_date date, status text 'open'|'closed' default 'open', closed_at timestamptz, missing_fuel_price boolean default false, unique(driver_id,start_date), check end_date >= start_date)`.
- `driver_period_for(p_driver uuid, p_date date) returns uuid` (security definer): devolve a quinzena existente do motorista que contém a data; senão, se `p_date >= cycle_start_date`, cria `[cycle_start_date + 15k, +14]` com `k = floor((p_date − cycle_start_date)/15)` (insert … on conflict do nothing; select) e devolve; senão raise `BEFORE_CYCLE_START`.
- `statements.driver_period_id uuid fk driver_periods unique` e `adjustments.driver_period_id uuid fk` + `adjustments.effective_date date not null default (now() at time zone 'America/Sao_Paulo')::date` (check: dentro da quinzena — via trigger).
- Remove: `periods`, `period_for_date`, `period_drivers`, `period_movement_drivers`, `periods_freeze`, `period_summary`, `statements.period_id`, `adjustments.period_id` (dropar dependentes; Tasks 2–4 recriam o que precisa).
- `row_in_closed_period` / `block_closed_period` reescritas: resolvem `driver_period_for(driver, data)` do registro (OLD e NEW), leem `driver_periods` com `FOR SHARE` sem filtro de status, bloqueiam `PERIOD_CLOSED`; e bloqueiam `DRIVER_PAUSED` quando o motorista está pausado e a data do registro é posterior ao fim da última quinzena (inserções/atualizações feitas pelo próprio motorista; admin não é bloqueado por pausa).
- RLS `driver_periods`: motorista seleciona as próprias; admin tudo; ninguém escreve direto (só funções).

- [ ] **Step 1: Testes pgTAP que falham** em `driver_periods.test.sql`: cadastro 2026-11-10 → `driver_period_for(d,'2026-11-24')` = quinzena 10/11–24/11 e `'2026-11-25'` = 25/11–09/12; cadastro 2026-12-31 → `'2027-01-14'` na 1ª e `'2027-01-15'` na 2ª; mesma data duas vezes → mesmo id; `'2026-11-09'` → `BEFORE_CYCLE_START`; `is_valid_cpf('529.982.247-25')` true, `'111.111.111-11'` false, `'12345678900'` false; motorista sem CPF → 23514; CPF duplicado → 23505; fechar (update status) a quinzena de A não bloqueia insert de B na mesma data; insert de A em quinzena fechada → `PERIOD_CLOSED`; motorista B não lê `driver_periods` de A.
- [ ] **Step 2:** `npx supabase db reset --local && npx supabase test db` → FAIL.
- [ ] **Step 3:** Escrever 0010 e adaptar fixtures dos testes antigos (motoristas de teste ganham CPF válido e `cycle_start_date` antigo, ex. 2026-01-01; trocar `period_for_date` por `driver_period_for`). Funções que dependem de `periods` e serão recriadas nas Tasks 2–3 podem ser dropadas aqui; os testes delas são reescritos nessas tasks (marque com `skip` temporário apenas os arquivos `statement`, `close_alerts`, `close_force`, `period_drivers` — `period_drivers.test.sql` é removido).
- [ ] **Step 4:** `npx supabase db reset --local && npx supabase test db` → PASS (exceto os skips declarados).
- [ ] **Step 5:** Commit `feat(db): quinzenas por motorista, CPF e trava por quinzena`.

---


> **Revisão do plano (adendo §9 do spec):** as Tasks 2–11 abaixo substituem as anteriores. Onde o spec §9 conflita com §1–8, vale §9.

### Task 2: Combustível por tipo, custo por km, conflito e odômetro mínimo (0011)

**Files:** Create `supabase/migrations/0011_fuel.sql`, `supabase/tests/fuel.test.sql`; Modify `supabase/tests/statement.test.sql` (reativar e adaptar).

**Interfaces — Consumes:** Task 1. **Produces:**
- `cars.fuel_type text check in ('gnv','diesel','gasolina','alcool','flex','eletrico','hibrido')` (not null, default 'flex' para linhas existentes), consumos `cars.km_per_l_gasolina`, `km_per_l_alcool`, `km_per_l_diesel`, `km_per_m3_gnv`, `km_per_kwh` (numeric(6,2) > 0, null-áveis); `cars.consumption_km_l` e os snapshots `consumption_km_l` de shifts/rides são removidos (o custo por km já embute o consumo).
- `fuelings.fuel text check in ('gasolina','alcool','diesel','gnv','eletrico')` not null, compatível com o `fuel_type` do carro (flex → gasolina/alcool; hibrido → gasolina/eletrico; demais → o próprio) senão `FUEL_NOT_ALLOWED`; `fuelings.quantity numeric(8,3) > 0` (substitui `liters`); `fuelings.unit_price numeric(7,3) > 0`; `fuelings.values_conflict boolean` (trigger: `|quantity × unit_price − amount| > max(0,10; 0,005 × amount)`); `fuelings.km_equivalent numeric` (trigger: `quantity × car_consumption(car, fuel)`, null se faltar consumo).
- `car_consumption(p_car uuid, p_fuel text) returns numeric` (null se não cadastrado).
- `cost_per_km_for(p_driver uuid, p_period uuid) returns jsonb {cost_per_km numeric|null, source 'period'|'driver_last'|'company_last'|null, missing_consumption boolean}` — período: Σ amount ÷ Σ km_equivalent das notas aprovadas com km_equivalent; se houver nota aprovada no período mas nenhuma com consumo → `missing_consumption = true`; reservas: última nota aprovada (fueled_on ≤ fim) com km_equivalent do motorista, depois da empresa: amount ÷ km_equivalent.
- `compute_statement` recriada: troca `missing_reference_price` por `missing_fuel_price`, acrescenta `missing_consumption` e `cost_per_km`, remove `avg_fuel_price`; `fuel_reimbursement` só `company_car`; `transfer_fuel_reimbursement = round(Σ km dos Transfers do carro próprio × cost_per_km, 2)`; `off_duty_fuel_discount = round(Σ km_off × cost_per_km, 2)`.
- `end_shift` recriada (estimativa com cost_per_km). `start_shift` recriada: leitura < último odômetro do carro (maior `odometer_start/odometer_end` de shifts do carro; a Task 3 inclui rides) → `ODOMETER_BELOW_LAST`.

- [ ] **Step 1: Testes que falham**: conflito (40 × 6,19: 247,60 → false; 247,65 → false; 274,60 → true); flex com gasolina 10 km/l: nota 100,00 / 16 L → km_equivalent 160, cost_per_km 0,625; álcool num carro diesel → `FUEL_NOT_ALLOWED`; carro sem consumo → `missing_consumption = true` e desconto 0; reservas driver_last e company_last; carro próprio: reembolso 0 e Transfer 50 km × 0,625 = 31,25; cenário clássico: turno 1000→1200, serviço 180, por fora 20, nota 100/16 L, 10 km/l → desconto 12,50 e total 213,00; `start_shift` com 900 após turno encerrado em 1200 → `ODOMETER_BELOW_LAST`.
- [ ] **Step 2–4:** FAIL → implementar → `npx supabase db reset --local && npx supabase test db` PASS (statement reativado).
- [ ] **Step 5:** Commit `feat(db): combustível por tipo, custo por km e odômetro mínimo`.

---

### Task 3: Transfer iniciar/concluir, comprovantes obrigatórios e conferência única (0012)

**Files:** Create `supabase/migrations/0012_transfer_flow.sql`, `supabase/tests/transfer_flow.test.sql`; Modify `shift_transfer_review.test.sql`, `rejected_shifts.test.sql`, `driver_edits.test.sql`, `rls.test.sql` conforme necessário.

**Interfaces — Consumes:** Tasks 1–2. **Produces:**
- `rides.transfer_status` aceita `'in_progress'`; `rides` ganha `odometer_start int`, `odometer_start_photo text`, `odometer_end int`, `odometer_end_photo text`, `started_at timestamptz`, `estimated_km numeric(8,1)`, `origin_street`, `origin_district`, `origin_city`, `origin_state`, `origin_zip`, `origin_ref`, `dest_street`, `dest_district`, `dest_city`, `dest_state`, `dest_zip`, `dest_ref` (text), `receipt_path text`. Transfer exige origem e destino (rua, bairro, cidade, UF não vazios) — check. Uber/BlaBlaCar inseridos pelo motorista exigem `receipt_path` (trigger `RECEIPT_REQUIRED`).
- `start_transfer(p_ride_id uuid, p_odometer int, p_photo text) returns rides` — dono; `assigned` → `in_progress`; `PHOTO_REQUIRED`; company_car exige turno aberto (`NO_OPEN_SHIFT`) e vincula `shift_id`; leitura < último odômetro do carro → `ODOMETER_BELOW_LAST`; idempotente se já `in_progress` com a mesma leitura.
- `complete_transfer(p_ride_id uuid, p_odometer int, p_photo text) returns rides` (substitui `(uuid, numeric)`): `in_progress` → `completed`; `km = odometer_end − odometer_start` (`ODOMETER_BELOW_START` se menor); limpa `reject_reason`.
- `review_item('transfer', …)`: aprovar → `checked` e todas as `ride_expenses` pendentes do Transfer `approved` na mesma transação; recusar → `in_progress` com `reject_reason`, despesas seguem `pending`. `review_item('expense', …)` → `USE_TRANSFER_REVIEW`.
- `ride_expenses` aceita inserção com Transfer `assigned`/`in_progress`/`completed`; comprovante obrigatório. O último odômetro do carro (Task 2) passa a incluir `rides.odometer_start/end`.

- [ ] **Step 1: Testes que falham**: assigned→start 5000 (in_progress)→complete 5042 (completed, km 42)→aprovar (checked, despesa approved); complete 4990 → `ODOMETER_BELOW_START`; start sem foto → `PHOTO_REQUIRED`; company_car sem turno → `NO_OPEN_SHIFT`; start 900 após turno 1200 → `ODOMETER_BELOW_LAST`; recusa → in_progress com motivo e despesa pending; concluir de novo → completed; `review_item('expense',…)` → `USE_TRANSFER_REVIEW`; transfer sem origem → 23514; uber sem comprovante → `RECEIPT_REQUIRED`; outro motorista não inicia/conclui.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** Commit `feat(db): transfer com iniciar/concluir, comprovantes e conferência única`.

---

### Task 4: Fechamento individual, sinais, pausa e alertas (0013)

Conteúdo da antiga Task 3 (spec §2.2–2.4, §3.2, §9.1), com estes ajustes:
- Migration `0013_driver_close.sql`; testes `driver_close.test.sql` + reativar `close_alerts`, `close_force` e os skips de `rejected_shifts`.
- `close_driver_period(p_period uuid, p_force boolean default false, p_allow_missing_fuel_price boolean default false) returns uuid`; ordem de erros `NOT_FOUND`, `ALREADY_CLOSED`, `PREVIOUS_OPEN`, `PERIOD_NOT_ENDED`, `OPEN_SHIFTS`, `ASSIGNED_TRANSFERS` (Transfers `assigned` ou `in_progress`), `PENDING_REVIEW` (inclui Transfers `completed`), `SHIFTS_NOT_APPROVED`, `MISSING_FUEL_PRICE` (falta de nota **ou** de consumo, quando necessário). `driver_periods.missing_fuel_price = true` em ambos.
- `mark_statement_paid` adaptado; `driver_period_signals()`, `pause_driver`, `resume_driver` (tabela `driver_pauses`), `admin_alerts()` como no spec. `pause_driver` chama `driver_period_for(d, p_paused_on)` antes de marcar `paused`; admin nunca bloqueado por pausa; motorista pausado: `start_shift`, `start_transfer`, `complete_transfer`, inserts → `DRIVER_PAUSED`; atribuir Transfer a pausado → `DRIVER_PAUSED`.
- `cycle_start_date` só muda via `resume_driver` (trigger `CYCLE_START_LOCKED`, flag de sessão como em 0008).
- [ ] Steps: testes que falham (ordem dos erros, isolamento entre motoristas, `MISSING_FUEL_PRICE` + allow → ❗, sinais com datas relativas a `current_date` (end = hoje+5 yellow; hoje+6 null; end = hoje−1 aberta red; pausado null), pausa 15/11 encurta a quinzena 10/11–24/11, lançamento do motorista em 16/11 → `DRIVER_PAUSED`, em 15/11 ok, retomar 01/12 → quinzena 01/12–15/12, `INVALID_DATE`, `CYCLE_START_LOCKED`, FORBIDDEN para motorista) → FAIL → implementar → PASS sem nenhum skip → commit `feat(db): fechamento por motorista, sinais e pausa`.

---

### Task 5: Gastos dos carros, documentos do admin, balanço mensal e pendências (0014)

Conteúdo da antiga Task 4 (spec §4, §5, §9.5–9.6), com estes ajustes:
- Migration `0014_balance_docs.sql`; testes `balance_docs.test.sql`.
- `car_expenses.kind` aceita `'other'` (descrição obrigatória, como `tax`); `deleted_on date` conforme §4.6.
- `monthly_balance(p_month date) returns jsonb` como na antiga Task 4, sem `avg_fuel_price`, mais `off_km_ranking: {by_driver:[{driver_id,name,km_off}], by_car:[{car_id,plate,model,km_off}]}` (decrescente, só > 0).
- `admin_pendencies() returns table(category text, item_type text, item_id uuid, driver_id uuid, driver_name text, label text, occurred_on date)`: `white` = fuelings pending (sem conflito), shifts encerrados pending/rejected, Transfers `completed`; `orange` = fuelings pending com `values_conflict`; `yellow`/`red` = de `driver_period_signals` (`item_type 'period'`, `item_id` = quinzena). Admin-only.
- [ ] Steps: testes da antiga Task 4 + `other` + ranking por carro + `admin_pendencies` (contagens e itens) → FAIL → implementar → PASS → regenerar `src/lib/database.types.ts` → commit `feat(db): gastos, documentos, balanço e pendências`.

---

### Task 6: Edge Functions — CPF, edição completa do motorista e km estimado

**Files:** Modify `supabase/functions/create-driver/index.ts`; Create `supabase/functions/update-driver/index.ts`, `supabase/functions/estimate-route/index.ts`, `supabase/functions/estimate-route/route.ts`, `src/lib/cpf.ts` (+test); Modify `src/integration/accounts.test.ts`.

**Interfaces — Produces:**
- create-driver: body ganha `cpf`; erros 400 `INVALID_CPF`, `CPF_TAKEN`; grava só dígitos.
- `update-driver` (admin) body `{driver_id, name?, phone?, cpf?, driver_type?, uber_pct?, transfer_pct?, car_id?: string|null}` → `{}`; validações do create; troca de tipo exige porcentagens coerentes e desvincula carro incompatível; `car_id` mantém os dois lados consistentes.
- `estimate-route` (admin) body `{origin:{street,district,city,state,zip?}, destination:{…}}` → `{km: number|null, reason?: 'NOT_FOUND'|'ROUTE_FAILED'}`. Nominatim `https://nominatim.openstreetmap.org/search?format=json&countrycodes=br&limit=1&q=<rua, bairro, cidade, UF, CEP>` com header `User-Agent: PassosTransfer/1.0`; OSRM `https://router.project-osrm.org/route/v1/driving/{lon1},{lat1};{lon2},{lat2}?overview=false`; km = distance/1000 (1 casa); timeout 8 s; falha → `km: null`. Funções puras `buildQuery(addr)` e `parseRoute(json)` em `route.ts` (testadas com Vitest).
- `isValidCpf(s: string): boolean`, `formatCpf(digits: string): string` em `src/lib/cpf.ts`.
- [ ] Steps: testes (cpf; buildQuery/parseRoute; integração: CPF inválido/duplicado, update-driver muda nome/CPF/%/carro) → FAIL → implementar → PASS → commit `feat: CPF, edição do motorista e km estimado`.

---

### Task 7: Telas do motorista

**Files:** Modify `src/lib/api.ts`, `src/lib/offline/queue.ts`, `src/driver/LaunchTab.tsx`, `src/driver/TransfersTab.tsx`, `src/driver/TodayTab.tsx`, `src/driver/TodayEntries.tsx`, `src/driver/StatementTab.tsx`, `src/components/StatementView.tsx`, `src/components/PhotoInput.tsx` (→ `ReceiptInput` aceitando PDF), `vite.config.ts` (manifest `share_target`), service worker de compartilhamento (`injectManifest` ou `importScripts` de `public/sw-share.js`: trata `POST /share-target`, guarda o arquivo no IndexedDB e redireciona para `/m/compartilhar`); Create `src/driver/ShareTargetPage.tsx`; testes.

- [ ] **Step 1: Testes que falham**:
  - `ReceiptInput` aceita `image/*` e `application/pdf` (≤ 10 MB, senão "Envie JPG, PNG ou PDF de até 10 MB"); PDF não é comprimido; miniatura para imagem, ícone + nome para PDF.
  - Lançar: Uber/BlaBlaCar exigem comprovante ("Adicione o comprovante"); Abastecimento: combustível (opções do `fuel_type` do carro), "Valor total", "Quantidade (L/m³/kWh)", "Preço por L/m³/kWh", comprovante; conflito → "Valores conflitantes, confira a nota" + conta + "Salvar mesmo assim"; Pedágio e Estacionamento: valor, comprovante e Transfer (do motorista em `assigned`/`in_progress`/`completed`); sem Transfer → "Pedágio e estacionamento são lançados em um Transfer"; motorista de carro próprio vê Abastecimento sem turno, com o aviso "Usado para calcular a gasolina dos seus Transfers — não é reembolsado".
  - Transfers: `assigned` → "Iniciar" (odômetro + foto); `in_progress` → "Em andamento" e "Concluir" (odômetro + foto); final < inicial → "O odômetro final não pode ser menor que o inicial"; `completed` → "Aguardando conferência"; recusado mostra o motivo e volta a "Concluir"; nenhum campo de km digitado.
  - Fila: `ODOMETER_BELOW_LAST` → "Não enviado: odômetro menor que o último registrado"; `DRIVER_PAUSED` → "Não enviado: cadastro pausado"; `BEFORE_CYCLE_START` → "Não enviado: data anterior ao seu cadastro"; `RECEIPT_REQUIRED` → "Não enviado: falta o comprovante".
  - Pausado: "Seu cadastro está pausado. Fale com a empresa." e ações desabilitadas.
  - Extrato: "Quinzena dd/mm – dd/mm · faltam X dias"; avisos de falta de nota/consumo.
  - Compartilhar: `/m/compartilhar` com arquivo pendente pergunta "O que é este comprovante?" (Abastecimento, Pedágio, Estacionamento, Corrida Uber, Corrida BlaBlaCar) e abre o formulário com o arquivo anexado; manifest contém `share_target` (action `/share-target`, POST, multipart/form-data, files accept image/*, application/pdf).
- [ ] **Step 2–4:** FAIL → implementar → `npm test`, `npm run build` PASS.
- [ ] **Step 5:** Commit `feat(motorista): comprovantes, combustível, transfer iniciar/concluir e compartilhar`.

---

### Task 8: Admin — Motoristas e Carros

Conteúdo da antiga Task 7 (spec §2.4, §4.6, §5, §9.1, §9.6), com estes ajustes:
- "Editar" abre o formulário completo (nome, telefone, CPF, tipo, % Uber, % Transfer, carro) via `update-driver`; o vínculo carro↔motorista é editável também em Carros.
- Carros: tipo de combustível (GNV, Diesel, Gasolina, Álcool, Flex, Elétrico, Híbrido) e consumos conforme o tipo, todos opcionais e editáveis; salvar sem consumo → confirm "Tem certeza que quer cadastrar sem o consumo? Sem ele, a gasolina por km não pode ser calculada.".
- Gastos: Manutenção, Seguro, Imposto, Outro (descrição obrigatória em Imposto e Outro: "Descreva o gasto"); formas Pontual/Parcelado/Recorrente; Finalizar; Excluir com a mensagem do spec §4.6.
- [ ] Steps: testes (antiga Task 7 + edição completa + combustível/consumo + Outro) → FAIL → implementar → PASS → commit `feat(admin): motoristas e carros completos, pausa, documentos e gastos`.

---

### Task 9: Admin — Transfers, Conferência e Quinzenas

**Files:** Modify `src/admin/TransfersPage.tsx`, `src/admin/ReviewPage.tsx`, `src/admin/PeriodsPage.tsx`, `src/admin/PrintStatementPage.tsx`, `src/lib/api.ts`; Create `src/admin/AddressFields.tsx`, `src/admin/PrintReceiptPage.tsx` (`/admin/recibo/:statementId`), `src/lib/extenso.ts` (+test `valorPorExtenso`: 1,00 "um real"; 0,50 "cinquenta centavos"; 213,00 "duzentos e treze reais"; 1.234,56 "mil duzentos e trinta e quatro reais e cinquenta e seis centavos"); testes.
- Transfers: origem e destino com "Rua e número", "Bairro", "Cidade", "UF", "CEP (opcional)", "Referência (opcional)"; os 4 primeiros obrigatórios ("Preencha o endereço de origem" / "…de destino"); ao salvar chama `estimate-route` e grava `estimated_km`; falha → "Não foi possível calcular o km estimado" e salva; lista com status "Atribuída / Em andamento / Concluída / Conferida", km estimado e km real.
- Conferência: "Transfers concluídos" com odômetros e fotos, km real × estimado (real > estimado em 20% → laranja "Km acima do estimado"), despesas com comprovantes, Aprovar/Recusar únicos; seção de despesas avulsas removida; abastecimentos 🟠 com a conta.
- Quinzenas: lista por motorista (quinzena atual, sinal, total), quinzenas do motorista com ❗, Fechar com `PREVIOUS_OPEN` "Feche a quinzena anterior primeiro", `PERIOD_NOT_ENDED` (confirm e force), `MISSING_FUEL_PRICE` (confirm com o texto de §3.2 ou §9.1 conforme `missing_consumption`, e allow); pagamento com anexos "Comprovante de pagamento" e "Recibo assinado" (✅/⚪); "Recibo" abre a página de recibo (nome, CPF formatado, código, período, linhas, valor por extenso, data, forma, "Assinatura do motorista", `window.print()` uma vez). Sem preço de referência em nenhuma tela.
- [ ] Steps: testes → FAIL → implementar → `npm test`, `npm run build` PASS → commit `feat(admin): transfers com endereço e km estimado, conferência única e quinzenas`.

---

### Task 10: Admin — Início (pendências) e Balanço mensal

**Files:** Create `src/admin/PendenciesPage.tsx` (`/admin/pendencias?tipo=white|yellow|red|orange`), `src/admin/BalancePage.tsx` (`/admin/balanco`, menu "Balanço mensal"), `src/admin/PrintBalancePage.tsx`; Modify `src/admin/DashboardPage.tsx`, `src/admin/AdminLayout.tsx`, `src/App.tsx`, `src/lib/api.ts` (`listPendencies()`, `monthlyBalance(month)`, `monthlyDetail(month)`).
- Início: bolinhas ⚪ 🟡 🔴 🟠 com contagem; 1 item → navega direto (fueling/shift/transfer → `/admin/conferencia#item-<id>`, period → `/admin/quinzenas?motorista=<driver_id>`); mais de 1 → `/admin/pendencias?tipo=…` com lista (motorista, descrição, data) e cada linha navega ao item; cartões do mês atual; ranking de km por fora por motorista e por carro.
- Balanço: blocos Resultado/Caixa/A pagar, gastos dos carros com "parcela 2/3"/"recorrente", comparação "▲ R$ 1.250,00 (+12%)"/"▼ …", selo "estimado", ranking por motorista e por carro, "Exportar planilha detalhada" (`passos-balanco-detalhado-AAAA-MM.csv`, cabeçalho `data;motorista;cpf;codigo;tipo;descricao;valor_bruto;valor_motorista;quinzena;situacao`), "Exportar resumo" (`passos-balanco-AAAA-MM.csv`), "Imprimir / PDF".
- [ ] Steps: testes → FAIL → implementar → PASS → commit `feat(admin): central de pendências e balanço mensal`.

---

### Task 11: E2E e documentação
- E2E atualizado: cadastro com CPF; carro flex com consumo; turno; Uber com comprovante; abastecimento com conflito e "Salvar mesmo assim"; Transfer com endereço (aceitar "Não foi possível calcular o km estimado" sem internet), Iniciar/Concluir com odômetros, pedágio pelo Lançar, conferência única; fechamento com force; pagamento com anexo PDF; recibo; balanço do mês com valores derivados à mão (comentário com a conta); gasto recorrente no Resultado; bolinha do Início levando à pendência; motorista sem acesso a Documentos.
- DEPLOY.md: aplicar 0010–0014; `npx supabase functions deploy create-driver update-driver estimate-route`; apagar o motorista de teste antes (feito pelo controlador, com confirmação).
- [ ] Steps: `npx playwright test`, `npx supabase test db`, `npm test`, `npm run build` PASS → commit `test: E2E do novo fluxo`.
