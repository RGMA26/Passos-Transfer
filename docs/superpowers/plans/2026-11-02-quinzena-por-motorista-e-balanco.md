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

### Task 2: Preço do litro pela nota e extrato (0011)

**Files:** Create `supabase/migrations/0011_fuel_price.sql`, `supabase/tests/fuel_price.test.sql`; Modify `supabase/tests/statement.test.sql` (reativar, adaptar).

**Interfaces — Consumes:** Task 1. **Produces:**
- `fuelings.price_per_liter numeric(6,3) not null check > 0`, `fuelings.values_conflict boolean not null default false` (trigger BEFORE INSERT/UPDATE calcula pela regra de conflito).
- `fuel_price_for(p_driver uuid, p_period uuid) returns numeric` (nulo no caso 4) com a cadeia de reservas da Global Constraint; usa `price_per_liter` das notas aprovadas para os casos 2–3, média ponderada Σvalor/Σlitros no caso 1.
- `compute_statement(p_driver uuid, p_period uuid) returns jsonb` (p_period = `driver_periods.id`; FORBIDDEN/NOT_FOUND como antes; período deve ser do motorista senão NOT_FOUND). Mesmas chaves de antes, exceto: `missing_reference_price` → **`missing_fuel_price`**; `fuel_reimbursement` só se o motorista é `company_car`; datas pelo intervalo da quinzena; ajustes pela `driver_period_id`.
- `end_shift` recriada: estimativa usa `fuel_price_for(driver, driver_period_for(driver, start_date))`.
- `start_shift`, `complete_transfer`, `insert` de corridas/abastecimentos continuam iguais (a trava vem da Task 1).

- [ ] **Step 1: Testes que falham** (`fuel_price.test.sql` + `statement.test.sql` adaptado): 40 L × 6,19 com total 247,60 → `values_conflict=false`; total 247,65 → false (dentro de 0,10/0,5%); total 274,60 → true; 4 casos de preço (média 6,25 com 100/16; sem nota na quinzena usa última do motorista 6,10; motorista sem notas usa última da empresa 5,99; empresa sem notas → `missing_fuel_price=true` e desconto 0); motorista de carro próprio com abastecimento aprovado 200,00 → `fuel_reimbursement = 0` mas preço usado no Transfer; o cenário 213,00 do teste antigo continua 213,00 com quinzena do motorista.
- [ ] **Step 2:** rodar → FAIL. **Step 3:** implementar. **Step 4:** rodar → PASS.
- [ ] **Step 5:** Commit `feat(db): preço do litro pela nota e extrato por quinzena do motorista`.

---

### Task 3: Fechamento individual, sinais, pausa e alertas (0012)

**Files:** Create `supabase/migrations/0012_driver_close.sql`, `supabase/tests/driver_close.test.sql`; Modify `close_alerts.test.sql`, `close_force.test.sql`, `rejected_shifts.test.sql` (reativar/adaptar).

**Interfaces — Consumes:** Tasks 1–2. **Produces (todas admin-only salvo indicado):**
- `close_driver_period(p_period uuid, p_force boolean default false, p_allow_missing_fuel_price boolean default false) returns uuid` (id do statement). Ordem de erros: `NOT_FOUND`, `ALREADY_CLOSED`, `PREVIOUS_OPEN`, `PERIOD_NOT_ENDED` (hoje ≤ end_date e não force), `OPEN_SHIFTS`, `ASSIGNED_TRANSFERS`, `PENDING_REVIEW`, `SHIFTS_NOT_APPROVED`, `MISSING_FUEL_PRICE` (preço necessário e ausente e não allow). Cria statement, `status='closed'`, `closed_at=now()`, `missing_fuel_price` = flag do extrato. Remove `close_period`.
- `mark_statement_paid(p_statement uuid, p_paid_at date, p_method text)` mantido (adaptar à nova FK).
- `driver_period_signals() returns table(driver_id uuid, name text, paused boolean, current_period_id uuid, start_date date, end_date date, days_left int, signal text)` — `signal` 'red'|'yellow'|null pela Global Constraint; pausado: só 'red'.
- `pause_driver(p_driver uuid, p_paused_on date, p_reason text) returns void`: erros `ALREADY_PAUSED`, `OPEN_SHIFTS`; encurta a quinzena aberta que contém `p_paused_on` (`end_date = p_paused_on`; se não houver, nada); `profiles.paused = true`; insere em `driver_pauses(id, driver_id, paused_on, resumed_on, reason, created_at)` (tabela criada aqui; RLS admin-only).
- `resume_driver(p_driver uuid, p_resume_on date) returns void`: erros `NOT_PAUSED`, `INVALID_DATE` (≤ paused_on); `cycle_start_date = p_resume_on`, `paused=false`, `resumed_on` preenchido.
- Bloqueio de pausa: transfer não pode ser atribuído/reatribuído a motorista pausado (`DRIVER_PAUSED`), RPCs de motorista (`start_shift`, `end_shift`, `complete_transfer`) e inserts de corrida/abastecimento/despesa pelo motorista pausado → `DRIVER_PAUSED`.
- `admin_alerts()` recriada usando `driver_periods` (só turnos de quinzenas abertas).

- [ ] **Step 1: Testes que falham**: ordem dos erros (um teste por código, incluindo `PREVIOUS_OPEN` com a 1ª quinzena aberta e tentativa na 2ª); fechar A não afeta B; `MISSING_FUEL_PRICE` e depois fecha com allow → statement com `lines->>'missing_fuel_price' = 'true'` e `driver_periods.missing_fuel_price = true`; sinais com hoje fixado por fixture de datas relativas a `current_date` (end = hoje+5 → yellow; hoje+6 → null; end = hoje−1 aberta → red; pausado com quinzena atual → null); pausa em 2026-11-15 na quinzena 10/11–24/11 → end_date 15/11; corrida do motorista em 2026-11-16 → `DRIVER_PAUSED`; corrida em 15/11 entra; retomar em 2026-12-01 → `driver_period_for(d,'2026-12-01')` = 01/12–15/12; retomar em data ≤ pausa → `INVALID_DATE`; motorista não executa nenhuma dessas funções (FORBIDDEN).
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** `npx supabase db reset --local && npx supabase test db` → PASS (nenhum skip restante).
- [ ] **Step 5:** Commit `feat(db): fechamento por motorista, sinais e pausa`.

---

### Task 4: Gastos de carro, documentos do admin e balanço mensal (0013)

**Files:** Create `supabase/migrations/0013_balance_docs.sql`, `supabase/tests/balance_docs.test.sql`.

**Interfaces — Consumes:** Tasks 1–3. **Produces (admin-only):**
- `car_expenses(id, car_id fk cars, kind 'maintenance'|'insurance'|'tax', description text, mode 'single'|'installments'|'recurring', amount numeric(10,2) > 0, installments int, start_date date not null, end_date date, finished boolean default false, deleted_on date, created_at)`; checks: `tax` exige description não vazia; `installments ≥ 2` sse mode='installments'; carro precisa ser `ownership='company'` (trigger `CAR_NOT_COMPANY`). RLS: só admin.
- `car_expenses_for_month(p_month date) returns table(expense_id uuid, car_id uuid, plate text, model text, kind text, description text, mode text, installment_no int, installments int, amount numeric)` — regra do spec §4.6 com `deleted_on` (conta só se M < mês(deleted_on)); parcela = round(amount/N,2), última = amount − (N−1)×parcela.
- `admin_documents(id, driver_id fk profiles, statement_id fk statements null, kind 'payment_proof'|'signed_receipt'|'other', description text, file_path text, mime_type text, size_bytes int, created_at, created_by)`; `other` exige description; RLS só admin. Bucket privado `admin-docs` (Storage policies só admin; `allowed_mime_types` jpg/png/pdf; `file_size_limit` 10 MB).
- `monthly_balance(p_month date) returns jsonb`:
  `{ month, estimated, result:{ revenue:{uber,transfer,blablacar,total}, owed:{ total, uber_share, transfer_share, fuel_reimbursement, transfer_fuel, expense_reimbursement, off_duty_discount, adjustments, by_driver:[{driver_id,name,total}] }, car_expenses:{ total, by_kind:{maintenance,insurance,tax}, items:[…linhas de car_expenses_for_month] }, company_result, previous_company_result, diff, diff_pct }, cash:{ total, items:[{statement_id,driver_id,name,period_start,period_end,total,paid_at,payment_method,has_payment_proof,has_signed_receipt}] }, payable:{ total, items:[{driver_id,name,closed_unpaid,open_estimate}] } }`
  — competência pela data de cada lançamento no mês (SP); cada parcela com o preço do litro da quinzena do motorista a que pertence; `company_result = revenue.total − owed.total − car_expenses.total`; `estimated` se alguma `driver_periods` com dias no mês está aberta; `payable` = situação de hoje.
- `monthly_detail(p_month date) returns table(occurred_on date, driver_name text, cpf text, login_code text, kind text, description text, gross numeric, driver_amount numeric, period_label text, status text)` — corridas, abastecimentos, despesas, ajustes, pagamentos do mês e gastos de carro (driver vazio).

- [ ] **Step 1: Testes que falham**: pontual 1.800 em mar/2027 aparece só em mar; parcelado 1.000 em 3× desde jan → 333,33/333,33/333,34 e soma 1.000; recorrente 89 desde jan, finalizado em mar → jan–mar; recorrente excluído em `deleted_on`=2027-04-10 → jan–mar contam, abr não; tax sem descrição → 23514; carro próprio → `CAR_NOT_COMPANY`; motorista não lê `car_expenses`, `admin_documents` nem objetos do bucket `admin-docs` (select retorna 0 / storage insert negado); **quinzena 16/09–30/09 com corridas 16–20/09 e fechamento em 02/10**: `monthly_balance('2026-09-01')` tem a receita e o devido dessas corridas, `cash` vazio; após `mark_statement_paid` em 05/10, `monthly_balance('2026-10-01').cash.total` = total do extrato; `estimated=true` enquanto aberta; `company_result` = receita − devido − gastos; `monthly_detail` traz uma linha por item.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS. Regenerar `src/lib/database.types.ts`.
- [ ] **Step 5:** Commit `feat(db): gastos de carro, documentos do admin e balanço mensal`.

---

### Task 5: create-driver com CPF

**Files:** Modify `supabase/functions/create-driver/index.ts`, `src/integration/accounts.test.ts`; Create `src/lib/cpf.ts` + `src/lib/cpf.test.ts`.

**Interfaces — Produces:** body ganha `cpf` (string com ou sem máscara); erros 400 `INVALID_CPF`, `CPF_TAKEN`; grava `cpf` só dígitos. `isValidCpf(s: string): boolean`, `formatCpf(digits: string): string` (`000.000.000-00`) em `src/lib/cpf.ts` — mesma regra de `is_valid_cpf`.

- [ ] **Step 1:** testes: `isValidCpf('529.982.247-25')` true, `'111.111.111-11'` false, `formatCpf('52998224725')` = `'529.982.247-25'`; integração: CPF inválido → 400 INVALID_CPF; repetido → 400 CPF_TAKEN.
- [ ] **Step 2–4:** FAIL → implementar → `npm test` PASS (integração roda com o stack: `npm run test:integration` com `functions serve`).
- [ ] **Step 5:** Commit `feat: CPF no cadastro do motorista`.

---

### Task 6: Telas do motorista

**Files:** Modify `src/lib/api.ts` (insertFueling/updateFueling com `price_per_liter`; `getCurrentPeriodId` → `getMyCurrentPeriod(): {id,start_date,end_date}` via `driver_period_for(auth.uid(), localDate())`), `src/driver/LaunchTab.tsx`, `src/driver/StatementTab.tsx`, `src/driver/TodayEntries.tsx`, `src/components/StatementView.tsx`, `src/lib/offline/queue.ts` (mensagem `DRIVER_PAUSED`, `BEFORE_CYCLE_START` → "Não enviado: data anterior ao seu cadastro"); testes correspondentes.

- [ ] **Step 1: Testes que falham**: Abastecimento exige "Valor total", "Litros", "Preço do litro" e foto; 40 / 6,19 / 274,60 mostra "Valores conflitantes, confira a nota", "40 L × R$ 6,19 = R$ 247,60 ≠ R$ 274,60" e só enfileira após "Salvar mesmo assim"; 247,60 enfileira direto com `price_per_liter: 6.19`; motorista `own_car` vê Abastecimento (sem exigir turno) com o aviso "Usado para calcular a gasolina dos seus Transfers — não é reembolsado"; perfil `paused` mostra "Seu cadastro está pausado. Fale com a empresa." e desabilita Lançar/Iniciar turno/Concluir; Extrato mostra "Quinzena 10/11 – 24/11 · faltam X dias"; `missing_fuel_price` mostra "Ainda não há nota de abastecimento aprovada para calcular a gasolina"; editar abastecimento em Hoje inclui preço do litro.
- [ ] **Step 2–4:** FAIL → implementar → `npm test` e `npm run build` PASS.
- [ ] **Step 5:** Commit `feat(motorista): abastecimento com preço do litro, quinzena própria e pausa`.

---

### Task 7: Admin — Motoristas (CPF, sinais, pausa, Documentos) e Carros (gastos)

**Files:** Modify `src/lib/api.ts`, `src/admin/DriversPage.tsx`, `src/admin/CarsPage.tsx`; Create `src/components/PeriodSignal.tsx`, `src/admin/DriverDocuments.tsx`, `src/admin/CarExpenses.tsx`; testes.

**Interfaces — Produces:** `PeriodSignal({signal, paused})` → 🔴 (aria-label "Quinzena terminada sem fechamento") / 🟡 ("Quinzena termina em até 5 dias") / selo "Pausado"; api: `listDriverSignals()`, `pauseDriver(id, date, reason)`, `resumeDriver(id, date)`, `listDriverPauses(id)`, `listAdminDocuments({driverId?, statementId?})`, `uploadAdminDocument({driverId, statementId?, kind, description?, file})` (bucket `admin-docs`, caminho `{driver_id}/{uuid}.{ext}`, valida tipo/tamanho → "Envie JPG, PNG ou PDF de até 10 MB"), `deleteAdminDocument(id)` (confirm "Excluir este documento?"), `adminDocumentUrl(path)` (signed 600 s), `listCarExpenses(carId)`, `createCarExpense(input)`, `updateCarExpense(id, patch)`, `finishCarExpense(id, lastMonth)`, `deleteCarExpense(id)` (grava `deleted_on` = hoje).

- [ ] **Step 1: Testes que falham**: cadastro exige CPF válido ("CPF inválido"), envia só dígitos; erros `CPF_TAKEN` → "CPF já cadastrado"; lista mostra círculo conforme `listDriverSignals`; "Pausar" pede data (padrão hoje) e motivo opcional, `OPEN_SHIFTS` → "Encerre o turno aberto antes de pausar"; "Retomar" pede data, `INVALID_DATE` → "A data de retorno deve ser depois da pausa"; ficha com aba "Documentos" lista e envia arquivos (kind other exige descrição); carro da empresa mostra "Gastos", carro próprio não; formulário de gasto: tipo, descrição (obrigatória em Imposto: "Descreva o imposto"), forma Pontual/Parcelado/Recorrente, valor, parcelas (≥2), data de início; prévia "3× R$ 333,33 (última R$ 333,34)"; recorrente tem "Finalizar" (pede último mês); excluir confirma "Excluir este gasto? Ele deixa de contar a partir deste mês; os meses anteriores continuam registrados." e o item vai para "Excluídos".
- [ ] **Step 2–4:** FAIL → implementar → `npm test`, `npm run build` PASS.
- [ ] **Step 5:** Commit `feat(admin): CPF, sinais, pausa, documentos e gastos dos carros`.

---

### Task 8: Admin — Quinzenas por motorista, Conferência 🟠 e Início

**Files:** Modify `src/lib/api.ts` (remover `listPeriods`, `setReferencePrice`, `periodDriverStatements`, `periodSummary`, `closePeriod`; adicionar `listDriverPeriods(driverId)`, `closeDriverPeriod(id, {force, allowMissingFuelPrice})`, `driverPeriodStatement(periodId)`), `src/admin/PeriodsPage.tsx`, `src/admin/ReviewPage.tsx`, `src/admin/DashboardPage.tsx`, `src/admin/PrintStatementPage.tsx`; Create `src/admin/PrintReceiptPage.tsx` (rota `/admin/recibo/:statementId`); testes.

- [ ] **Step 1: Testes que falham**:
  - Quinzenas lista motoristas com quinzena atual (dd/mm – dd/mm), sinal, total; abrir motorista mostra suas quinzenas (atual + anteriores) com ❗ e title "Fechada sem nota de abastecimento" quando `missing_fuel_price`.
  - Fechar: `PREVIOUS_OPEN` → "Feche a quinzena anterior primeiro"; `PERIOD_NOT_ENDED` → confirm "A quinzena ainda não terminou. Fechar mesmo assim?" e reenvia com force; `MISSING_FUEL_PRICE` → confirm com o texto exato da Global Constraint e reenvia com allow; demais códigos com as mensagens atuais.
  - Pagamento: após "Marcar como pago", seções "Comprovante de pagamento" e "Recibo assinado" com upload (vários) e ✅/⚪; botão "Recibo" abre `/admin/recibo/:id`.
  - Recibo: "Passos Transfer — Recibo de pagamento", nome, CPF formatado, código, período, linhas do extrato, valor por extenso (ex. 213,00 → "duzentos e treze reais"), data, forma, linha "Assinatura do motorista"; chama `window.print()` uma vez.
  - Conferência: abastecimento com `values_conflict` tem classe/rótulo "🟠 Valores conflitantes" e mostra "40 L × R$ 6,19 = R$ 247,60 ≠ R$ 274,60".
  - Início: "N quinzenas para fechar" (red) e "N terminando em breve" (yellow) e cartões do mês atual a partir de `monthly_balance`.
  - Sem campo de preço de referência em nenhuma tela.
- Valor por extenso: criar `src/lib/extenso.ts` `valorPorExtenso(n: number): string` (reais e centavos, até milhões) com testes 1,00 "um real", 0,50 "cinquenta centavos", 213,00 "duzentos e treze reais", 1.234,56 "mil duzentos e trinta e quatro reais e cinquenta e seis centavos".
- [ ] **Step 2–4:** FAIL → implementar → `npm test`, `npm run build` PASS.
- [ ] **Step 5:** Commit `feat(admin): quinzenas por motorista, recibo, conferência e início`.

---

### Task 9: Admin — Balanço mensal

**Files:** Create `src/admin/BalancePage.tsx` (rota `/admin/balanco`, item "Balanço mensal" no menu), `src/admin/PrintBalancePage.tsx` (`/admin/balanco/imprimir/:month`), testes; Modify `src/lib/api.ts` (`monthlyBalance(month)`, `monthlyDetail(month)`), `src/admin/AdminLayout.tsx`, `src/App.tsx`.

- [ ] **Step 1: Testes que falham**: seletor de mês (padrão atual, "Novembro/2026"); bloco "Resultado do mês" com Faturamento (Uber/Transfer/BlaBlaCar/Total), "Devido aos motoristas" (total + lista por motorista), Combustível (reembolsos, gasolina Transfers, desconto da gasolina por fora como "− R$"), Pedágios e estacionamentos, Ajustes, "Gastos dos carros da empresa" (por tipo e itens com "parcela 2/3" / "recorrente"), "Resultado da empresa", comparação "▲ R$ 1.250,00 (+12%)" ou "▼ …"; selo "estimado" quando `estimated`; bloco "Caixa do mês" (linhas com quinzena de referência e ✅/⚪ anexos); bloco "A pagar" (fechado não pago + "estimado"); "Exportar planilha detalhada" gera CSV de `monthlyDetail` com cabeçalho `data;motorista;cpf;codigo;tipo;descricao;valor_bruto;valor_motorista;quinzena;situacao` e nome `passos-balanco-detalhado-AAAA-MM.csv`; "Exportar resumo" CSV `passos-balanco-AAAA-MM.csv`; "Imprimir / PDF" abre a página de impressão.
- [ ] **Step 2–4:** FAIL → implementar → `npm test`, `npm run build` PASS.
- [ ] **Step 5:** Commit `feat(admin): balanço mensal com exportações`.

---

### Task 10: E2E e documentação

**Files:** Modify `e2e/full-flow.spec.ts`, `docs/DEPLOY.md`.

- [ ] **Step 1:** Atualizar o E2E: admin cria motorista com CPF; motorista abastece (preço do litro, um caso com "Salvar mesmo assim"); admin vê 🟠 na Conferência e aprova; fecha a quinzena do motorista com force; marca pago e anexa um comprovante (fixture PDF); abre o Recibo; abre Balanço mensal do mês atual e confere o Resultado da empresa e o Caixa com valores derivados à mão (comentário com a conta); cadastra um gasto recorrente num carro da empresa e confere que entra no Resultado. Confere que a tela do motorista não tem "Documentos".
- [ ] **Step 2:** `npx playwright test` → PASS; também `npx supabase test db`, `npm test`, `npm run build`.
- [ ] **Step 3:** DEPLOY.md: seção "Atualização de 2026-11 (quinzena por motorista)" — `npx supabase db push` aplica 0010–0013; `npx supabase functions deploy create-driver`; motoristas já cadastrados precisam de CPF antes (não há nenhum em produção).
- [ ] **Step 4:** Commit `test: E2E do fluxo com quinzena por motorista e balanço`.
