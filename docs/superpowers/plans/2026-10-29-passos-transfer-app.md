# App Passos Transfer — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PWA para motoristas registrarem corridas, km, abastecimentos e despesas, e para o admin conferir, fechar a quinzena e pagar o repasse de cada motorista.

**Architecture:** Um único app React (PWA) com telas por perfil (motorista / admin). Toda regra de negócio sensível (snapshots de %, bloqueio de quinzena, cálculo de extrato, fechamento) vive no Postgres do Supabase como funções/gatilhos testados com pgTAP; o frontend só chama RPCs e tabelas protegidas por RLS. Criação de contas usa Edge Functions (precisam da service role).

**Tech Stack:** Vite + React 18 + TypeScript, react-router, @supabase/supabase-js v2, vite-plugin-pwa, idb (IndexedDB), browser-image-compression, Vitest + Testing Library + fake-indexeddb, Supabase CLI (Postgres, Auth, Storage, Edge Functions em Deno), pgTAP, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-29-passos-transfer-app-design.md`

## Global Constraints

- Pré-requisitos de ambiente: Node ≥ 20 (instalado: 26), **Docker Desktop** (necessário para `supabase start`; ainda não instalado), Supabase CLI via `npx supabase`.
- Interface em **português (pt-BR)**; identificadores de código e banco em inglês.
- Fuso horário de negócio: **America/Sao_Paulo**. Datas de corrida/abastecimento são `date` local; o turno pertence à quinzena da data local de início.
- Quinzenas: **dia 1–15** e **dia 16–último dia do mês**.
- Dinheiro: `numeric(10,2)`; arredondar para 2 casas **somente no total de cada linha** do extrato. Entrada aceita vírgula decimal (`45,90`).
- Porcentagens de motorista **sem valor padrão**, obrigatórias, `0 < pct ≤ 100`.
- Código de login: `PASSOS` + sequencial com 2 dígitos (3+ a partir de 100) + primeiro nome em maiúsculas sem acentos/espaços. Número nunca reaproveitado.
- E-mail técnico de login: `lower(codigo)@login.passostransfer.app`.
- Senha mínima: **6 caracteres**.
- Alerta de km por fora: **> 20%** do km total do turno; alerta de turno aberto: **> 24 h**.
- Fotos em bucket privado `photos`, caminho `{driver_id}/{uuid}.jpg`, comprimidas para no máximo ~1600 px / 500 KB.
- Toda escrita feita pelo app deve usar `id` uuid gerado no cliente (idempotência da fila offline).

## Review Focus

1. **Lançamento offline sincronizado depois do fechamento da quinzena** → o servidor rejeita; o item fica visível na fila como "não enviado: quinzena fechada", nunca some em silêncio. (Teste na Task 10.)
2. **Toque duplo / reenvio após timeout** → nenhuma corrida, abastecimento ou turno duplicado (insert com id do cliente e `on conflict do nothing`; RPCs idempotentes por id). (Testes nas Tasks 5 e 10.)
3. **Transfer reatribuído a outro motorista** → % e consumo gravados passam a ser os do novo motorista. (Teste na Task 3.)
4. **Turno que vira a meia-noite do dia 15 para o 16** → km por fora conta na quinzena do início do turno, usando todas as corridas do turno. (Teste na Task 6.)
5. **Valor digitado com vírgula ou com "R$"** (`"45,90"`, `"R$ 1.234,50"`) → interpretado como 45.90 / 1234.50; texto inválido é recusado. (Teste na Task 1.)

---

## Estrutura de arquivos

```
package.json, vite.config.ts, tsconfig.json, index.html, .env.example
src/
  main.tsx, App.tsx                 rotas por perfil
  lib/
    supabase.ts                     cliente
    money.ts                        parseBRL, formatBRL
    periods.ts                      periodBounds, localDate
    loginCode.ts                    loginToEmail
    auth.tsx                        AuthProvider, useAuth
    photos.ts                       compressImage, uploadPhoto
    offline/queue.ts                fila IndexedDB
    api.ts                          wrappers tipados das RPCs/tabelas
    types.ts                        tipos do banco
  components/StatementView.tsx      extrato (motorista e admin)
  components/MoneyInput.tsx, PhotoInput.tsx
  auth/LoginPage.tsx, FirstAccessPage.tsx
  driver/DriverLayout.tsx, TodayTab.tsx, LaunchTab.tsx, TransfersTab.tsx, StatementTab.tsx
  admin/AdminLayout.tsx, DashboardPage.tsx, DriversPage.tsx, CarsPage.tsx,
        TransfersPage.tsx, ReviewPage.tsx, PeriodsPage.tsx, PrintStatementPage.tsx
  **/*.test.ts(x)                   ao lado do código
supabase/
  config.toml, seed.sql
  migrations/0001_schema.sql, 0002_triggers.sql, 0003_rls.sql,
             0004_shift_transfer_review.sql, 0005_statement.sql, 0006_close_alerts.sql
  tests/*.test.sql                  pgTAP
  functions/create-driver/index.ts, functions/driver-access/index.ts
e2e/full-flow.spec.ts
docs/DEPLOY.md
```

---

### Task 1: Scaffold e utilitários

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `.env.example`, `.gitignore`, `src/main.tsx`, `src/App.tsx`
- Create: `src/lib/money.ts`, `src/lib/periods.ts`, `src/lib/loginCode.ts`
- Test: `src/lib/money.test.ts`, `src/lib/periods.test.ts`, `src/lib/loginCode.test.ts`

**Interfaces:**
- Produces:
  - `parseBRL(input: string): number | null`, `formatBRL(value: number): string`
  - `localDate(d?: Date): string` (YYYY-MM-DD em America/Sao_Paulo)
  - `periodBounds(date: string): { start: string; end: string }`
  - `loginToEmail(login: string): string` (se contém `@`, retorna como está)

- [ ] **Step 1:** `npm create vite@latest . -- --template react-ts`, instalar `react-router-dom @supabase/supabase-js` e dev `vitest @testing-library/react @testing-library/jest-dom jsdom`; script `"test": "vitest run"`; `npx supabase init`.
- [ ] **Step 2: Testes que falham**

```ts
// money.test.ts
expect(parseBRL('45,90')).toBe(45.9)
expect(parseBRL('R$ 1.234,50')).toBe(1234.5)
expect(parseBRL('12.5')).toBe(12.5)
expect(parseBRL('abc')).toBeNull()
expect(parseBRL('')).toBeNull()
expect(formatBRL(1234.5)).toBe('R$ 1.234,50')   // comparar após normalizar NBSP
// periods.test.ts
expect(periodBounds('2026-11-15')).toEqual({ start: '2026-11-01', end: '2026-11-15' })
expect(periodBounds('2026-11-16')).toEqual({ start: '2026-11-16', end: '2026-11-30' })
expect(periodBounds('2027-02-20')).toEqual({ start: '2027-02-16', end: '2027-02-28' })
expect(localDate(new Date('2026-11-16T02:30:00Z'))).toBe('2026-11-15') // 23:30 em SP
// loginCode.test.ts
expect(loginToEmail('PASSOS01JOAO')).toBe('passos01joao@login.passostransfer.app')
expect(loginToEmail(' passos01joao ')).toBe('passos01joao@login.passostransfer.app')
expect(loginToEmail('admin@passos.com')).toBe('admin@passos.com')
```

- [ ] **Step 3:** `npm test` → FAIL (módulos inexistentes).
- [ ] **Step 4:** Implementar. `parseBRL`: remove `R$` e espaços; se houver vírgula, pontos são milhar e vírgula é decimal; rejeita qualquer coisa que não seja número finito ≥ 0. `formatBRL` via `Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'})`. `localDate` via `Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo'})`.
- [ ] **Step 5:** `npm test` → PASS.
- [ ] **Step 6:** Commit `feat: scaffold do projeto e utilitários de dinheiro, quinzena e login`.

---

### Task 2: Esquema do banco

**Files:**
- Create: `supabase/migrations/0001_schema.sql`
- Test: `supabase/tests/schema.test.sql`

**Interfaces:**
- Produces (tabelas, todas com `id uuid primary key default gen_random_uuid()` e `created_at timestamptz default now()`):
  - `profiles(id uuid pk references auth.users, role text check in ('admin','driver'), login_code text unique, seq_number int unique, name text, phone text, driver_type text check in ('own_car','company_car') null para admin, uber_pct numeric(5,2), transfer_pct numeric(5,2), current_car_id uuid, active bool default true, must_change_password bool default true)` — check: driver exige `transfer_pct`; `company_car` exige `uber_pct`; pcts em `(0,100]`.
  - `cars(model, plate unique, consumption_km_l numeric(5,2) check > 0, ownership text check in ('own','company'), current_driver_id uuid references profiles)`
  - `periods(start_date date unique, end_date date, status text check in ('open','closed') default 'open', reference_fuel_price numeric(6,3), closed_at timestamptz)`
  - `shifts(driver_id, car_id, consumption_km_l numeric(5,2), started_at timestamptz, ended_at timestamptz, start_date date, odometer_start int, odometer_start_photo text, odometer_end int, odometer_end_photo text, uber_earnings_photo text, review_status text default 'pending' check in ('pending','approved','rejected'), reject_reason text)` — check `odometer_end >= odometer_start`.
  - `rides(driver_id, shift_id null, platform text check in ('uber','transfer','blablacar'), ride_date date, amount numeric(10,2) check >= 0, km numeric(8,1) check >= 0 null, driver_pct numeric(5,2), consumption_km_l numeric(5,2), client_name text, scheduled_at timestamptz, origin text, destination text, transfer_status text check in ('assigned','completed','checked'))` — check: transfer exige `client_name` e `transfer_status`.
  - `ride_expenses(ride_id references rides on delete cascade, kind text check in ('toll','parking'), amount numeric(10,2) > 0, photo_path text not null, review_status, reject_reason)`
  - `fuelings(driver_id, car_id, fueled_on date, amount numeric(10,2) > 0, liters numeric(7,3) > 0, photo_path text not null, review_status, reject_reason)`
  - `adjustments(driver_id, period_id, kind text check in ('advance','fine','bonus','correction'), amount numeric(10,2), description text not null)` — sinal no valor: vale/multa negativos (check por kind), bônus positivo, correção qualquer.
  - `statements(driver_id, period_id, lines jsonb, total numeric(10,2), paid_at date, payment_method text, unique(driver_id, period_id))`
  - `audit_log(actor_id uuid, at timestamptz default now(), table_name text, row_id uuid, action text, old_data jsonb, new_data jsonb)`
  - `create sequence driver_seq;` `create extension unaccent;`
  - Função `period_for_date(d date) returns uuid` (security definer): retorna o id da quinzena que contém `d`, criando-a se não existir.

- [ ] **Step 1: Teste pgTAP que falha** — `has_table` para cada tabela; `throws_ok` para: pct 0 e 101; `uber_pct` nulo em `company_car`; odômetro final < inicial; ajuste `advance` positivo; `results_eq` de `period_for_date('2026-11-16')` duas vezes retornando o mesmo id com `start_date='2026-11-16', end_date='2026-11-30'`.
- [ ] **Step 2:** `npx supabase start` e `npx supabase test db` → FAIL.
- [ ] **Step 3:** Escrever a migration.
- [ ] **Step 4:** `npx supabase db reset && npx supabase test db` → PASS.
- [ ] **Step 5:** Commit `feat(db): esquema inicial`.

---

### Task 3: Gatilhos: código de login, snapshots, turno automático e histórico

**Files:**
- Create: `supabase/migrations/0002_triggers.sql`
- Test: `supabase/tests/triggers.test.sql`

**Interfaces:**
- Consumes: tabelas da Task 2.
- Produces:
  - `generate_login_code(p_name text) returns text` — usa `nextval('driver_seq')`; ex.: primeira chamada com `'João da Silva'` → `PASSOS01JOAO`.
  - Gatilho `rides_before_write`:
    - em insert, e em update quando `driver_id` muda: grava `driver_pct` (uber → `uber_pct`, transfer → `transfer_pct`, blablacar → null) e, se transfer de motorista `own_car`, `consumption_km_l` do carro atual;
    - uber/blablacar: preenche `shift_id` com o turno aberto do motorista, ou erro `NO_OPEN_SHIFT`; recusa se motorista `own_car` (`PLATFORM_NOT_ALLOWED`).
  - Gatilho `audit_row()` em profiles, cars, shifts, rides, ride_expenses, fuelings, adjustments, statements, periods.

- [ ] **Step 1: Testes que falham:**
  - `generate_login_code('João da Silva')` = `PASSOS01JOAO`, depois `generate_login_code('maria')` = `PASSOS02MARIA`.
  - Uber com `uber_pct=40` → `driver_pct=40`; após mudar para 50, nova corrida = 50 e a antiga continua 40.
  - Transfer criado para A (30%), reatribuído para B (25%, own_car, carro 12.5 km/l) → `driver_pct=25` e `consumption_km_l=12.5`.
  - Uber sem turno aberto → `NO_OPEN_SHIFT`; Uber de motorista own_car → `PLATFORM_NOT_ALLOWED`.
  - Update em `profiles.uber_pct` gera linha em `audit_log` com old/new.
- [ ] **Step 2:** `npx supabase test db` → FAIL.
- [ ] **Step 3:** Implementar (unaccent + `regexp_replace('[^A-Z]','','g')` no primeiro nome; `lpad(n::text, 2, '0')`).
- [ ] **Step 4:** `npx supabase db reset && npx supabase test db` → PASS.
- [ ] **Step 5:** Commit `feat(db): código de login, snapshots e histórico`.

---

### Task 4: RLS, Storage e bloqueio de quinzena fechada

**Files:**
- Create: `supabase/migrations/0003_rls.sql`, `supabase/seed.sql` (1 admin, 2 motoristas, 2 carros para dev)
- Test: `supabase/tests/rls.test.sql`

**Interfaces:**
- Produces:
  - `is_admin() returns bool` (security definer, lê `profiles.role` de `auth.uid()`).
  - Políticas: admin tudo; motorista `select` só onde `driver_id = auth.uid()` (ride_expenses via ride; o próprio profile; o carro atual; periods `select` liberado; statements próprios).
  - Escrita do motorista:
    - insert/update/delete em `rides` só para uber/blablacar;
    - insert em `fuelings` e `ride_expenses` (do próprio transfer);
    - update/delete só se `review_status='pending'`.
    - Turnos e conclusão de transfer **só via RPC** (Task 5). Motorista não altera `profiles`, exceto `must_change_password` via RPC `clear_must_change_password()`.
  - Gatilho `block_closed_period` em rides, fuelings, shifts, ride_expenses, adjustments: se a data (ride_date / fueled_on / start_date / data da ride pai / período do ajuste) cai em quinzena `closed` → erro `PERIOD_CLOSED` (vale também para admin).
  - Bucket `photos` privado: motorista lê/escreve só em `{auth.uid()}/...`; admin lê tudo.

- [ ] **Step 1: Testes que falham** (usar `set local role authenticated` + `set local request.jwt.claims`):
  - motorista A não enxerga rides/fuelings/shifts/statements de B (count = 0);
  - motorista não consegue inserir transfer nem alterar `transfer_status`;
  - motorista não edita abastecimento já `approved`;
  - com a quinzena `closed`: insert de Uber datado nela → `PERIOD_CLOSED`; update de abastecimento pelo admin → `PERIOD_CLOSED`;
  - motorista não altera o próprio `uber_pct`.
- [ ] **Step 2:** `npx supabase test db` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npx supabase db reset && npx supabase test db` → PASS.
- [ ] **Step 5:** Commit `feat(db): RLS, storage privado e bloqueio de quinzena fechada`.

---

### Task 5: RPCs de turno, Transfer e conferência

**Files:**
- Create: `supabase/migrations/0004_shift_transfer_review.sql`
- Test: `supabase/tests/shift_transfer_review.test.sql`

**Interfaces:**
- Produces (todas security definer, validando `auth.uid()`):
  - `start_shift(p_id uuid, p_car_id uuid, p_odometer int, p_photo text) returns shifts` — erros `SHIFT_ALREADY_OPEN`, `NOT_COMPANY_CAR`; grava `consumption_km_l` e `start_date = (now() at time zone 'America/Sao_Paulo')::date`; se `p_id` já existe e é do mesmo motorista, retorna o existente (idempotente).
  - `end_shift(p_shift_id uuid, p_odometer int, p_photo text, p_uber_photo text) returns jsonb` → `{km_total, km_service, km_off, off_discount_estimate}`; erros `ODOMETER_BELOW_START`, `UBER_PHOTO_REQUIRED` (se houve Uber no turno). Chamar de novo num turno já encerrado retorna o mesmo resultado.
  - `complete_transfer(p_ride_id uuid, p_km numeric) returns rides` — só motorista dono, status `assigned` ou `completed` → `completed`.
  - `review_item(p_kind text, p_id uuid, p_approved bool, p_reason text) returns void` — `p_kind in ('fueling','expense','shift','transfer')`; admin only; recusa exige motivo (`REASON_REQUIRED`); `transfer` aprovado → `transfer_status='checked'`.
  - `clear_must_change_password() returns void`.

- [ ] **Step 1: Testes que falham:** segundo `start_shift` com outro id → `SHIFT_ALREADY_OPEN`; mesmo id → mesma linha, sem duplicar; `end_shift` com 1000→1200 e corridas de 50+30+70+30 km → `{200,180,20,...}`; final 990 → `ODOMETER_BELOW_START`; Uber no turno sem print → `UBER_PHOTO_REQUIRED`; motorista chamando `review_item` → erro; recusa sem motivo → `REASON_REQUIRED`.
- [ ] **Step 2:** `npx supabase test db` → FAIL.
- [ ] **Step 3:** Implementar (`off_discount_estimate` usa a mesma função auxiliar de preço da Task 6; até lá, retornar o km e preencher o desconto na Task 6).
- [ ] **Step 4:** `npx supabase db reset && npx supabase test db` → PASS.
- [ ] **Step 5:** Commit `feat(db): RPCs de turno, transfer e conferência`.

---

### Task 6: Cálculo do extrato

**Files:**
- Create: `supabase/migrations/0005_statement.sql`
- Test: `supabase/tests/statement.test.sql`
- Also in 0005: `fuel_price_for(p_driver uuid, p_period uuid) returns numeric` (preço médio aprovado ou referência) e `create or replace` de `end_shift` para preencher `off_discount_estimate` com ela.

**Interfaces:**
- Produces: `compute_statement(p_driver uuid, p_period uuid) returns jsonb` (admin ou o próprio motorista) com o formato:

```json
{ "uber_share": 0, "transfer_share": 0, "fuel_reimbursement": 0,
  "transfer_fuel_reimbursement": 0, "expense_reimbursement": 0,
  "off_duty_fuel_discount": 0, "adjustments": 0, "total": 0,
  "avg_fuel_price": 0, "missing_reference_price": false,
  "km": { "total": 0, "service": 0, "off": 0 },
  "pending": { "fuelings": 0, "expenses": 0 } }
```

  Regras (spec 3.2 e 3.4):
  - uber/transfer contam por `ride_date` na quinzena; transfer só se `completed` ou `checked`;
  - abastecimentos e despesas só `approved`; `pending` soma os pendentes (fora do total);
  - km por fora por turno = `greatest(0, odômetro final − inicial − Σ km de todas as corridas do turno)`, para turnos encerrados com `start_date` na quinzena;
  - preço = Σ valor / Σ litros dos abastecimentos aprovados da quinzena, senão `reference_fuel_price`; se nulo e necessário → usa 0 e `missing_reference_price=true`;
  - desconto em número positivo, subtraído no total; cada linha com `round(...,2)` depois de somar.

- [ ] **Step 1: Testes que falham** (cada um com `results_eq` em `compute_statement(...)->>'campo'`):
  - **Cenário completo carro da empresa** (10 km/l, Uber 40%, Transfer 30%): turno 1000→1200; Uber 100,00/50 km e 50,00/30 km; BlaBlaCar 80,00/70 km; Transfer 300,00/30 km concluído; abastecimento aprovado 100,00/16 L e pendente 50,00/8 L; pedágio 15,50 aprovado e estacionamento 20,00 recusado; vale −50,00 e bônus +10,00 → `uber_share=60.00`, `transfer_share=90.00`, `fuel_reimbursement=100.00`, `expense_reimbursement=15.50`, `avg_fuel_price=6.25`, `off_duty_fuel_discount=12.50`, `adjustments=-40.00`, `total=213.00`, `pending.fuelings=50.00`, `pending.expenses=0`.
  - **Mudança de % no meio da quinzena:** Uber 100 a 40% e depois 100 a 50% → `uber_share=90.00`.
  - **Carro próprio:** 12,5 km/l, referência 6,00, Transfer 200,00/50 km, 30% → `transfer_share=60.00`, `transfer_fuel_reimbursement=24.00`, `off_duty_fuel_discount=0`.
  - **km negativo:** turno 1000→1100 com 120 km lançados → `off_duty_fuel_discount=0`.
  - **Sem abastecimento:** referência 6,00, 20 km por fora, 10 km/l → `off_duty_fuel_discount=12.00`; com referência nula → `missing_reference_price=true`.
  - **Arredondamento:** três Uber de 33,33 a 40% → `uber_share=40.00`.
  - **Transfer `assigned`** não entra.
  - **Turno das 22h do dia 15 até 02h do dia 16** com uma corrida datada 16 → km por fora entra na quinzena 1–15 e a corrida Uber entra na 16–fim.
  - Motorista B chamando para A → erro.
- [ ] **Step 2:** `npx supabase test db` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npx supabase db reset && npx supabase test db` → PASS.
- [ ] **Step 5:** Commit `feat(db): cálculo do extrato quinzenal`.

---

### Task 7: Fechamento, pagamento, alertas e resumo

**Files:**
- Create: `supabase/migrations/0006_close_alerts.sql`
- Test: `supabase/tests/close_alerts.test.sql`

**Interfaces:**
- Consumes: `compute_statement`.
- Produces (admin only):
  - `close_period(p_period uuid) returns int` (nº de extratos gerados). Erros, verificados nesta ordem: `OPEN_SHIFTS`, `ASSIGNED_TRANSFERS` (transfer `assigned` na quinzena), `PENDING_REVIEW` (abastecimento/despesa/turno `pending` ou transfer `completed`), `MISSING_REFERENCE_PRICE` (se algum extrato precisaria dela). Gera um `statements` por motorista com movimento, `lines = compute_statement(...)`; marca `closed`.
  - `mark_statement_paid(p_statement uuid, p_paid_at date, p_method text) returns void`.
  - `admin_alerts() returns table(kind text, driver_id uuid, shift_id uuid, detail jsonb)` com `kind in ('HIGH_OFF_KM','NEGATIVE_OFF_KM','SHIFT_OPEN_24H')`.
  - `period_summary(p_period uuid) returns jsonb` → `{revenue:{uber,transfer,blablacar}, drivers_share, company_share, fuel_reimbursed, fuel_discounted, off_km_ranking:[{driver_id,name,km_off}]}`. Usa os extratos congelados se a quinzena estiver fechada; senão, calcula na hora.

- [ ] **Step 1: Testes que falham:** fechar com turno aberto → `OPEN_SHIFTS`; com abastecimento pendente → `PENDING_REVIEW`; caminho feliz gera extrato com `total=213.00` (cenário da Task 6) e depois qualquer insert na quinzena → `PERIOD_CLOSED`; turno 1000→1200 com 150 km lançados → `HIGH_OFF_KM`; turno aberto há 25 h → `SHIFT_OPEN_24H`; `period_summary.company_share` = receita total − `drivers_share` (onde drivers_share = Σ uber_share + transfer_share).
- [ ] **Step 2:** `npx supabase test db` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npx supabase db reset && npx supabase test db` → PASS.
- [ ] **Step 5:** Commit `feat(db): fechamento de quinzena, pagamento, alertas e resumo`.

---

### Task 8: Edge Functions de contas

**Files:**
- Create: `supabase/functions/create-driver/index.ts`, `supabase/functions/driver-access/index.ts`, `supabase/functions/_shared/admin.ts`
- Test: `src/integration/accounts.test.ts` (Vitest contra o Supabase local; pular se `SUPABASE_URL` não definido)

**Interfaces:**
- Produces:
  - `POST /functions/v1/create-driver` body `{name, phone, driver_type, uber_pct?, transfer_pct, car_id?}` → `{driver_id, login_code, temp_pin}`. Valida que o chamador é admin; gera código via `generate_login_code`; cria usuário com e-mail técnico e PIN numérico de 6 dígitos; insere profile com `must_change_password=true`; vincula carro.
  - `POST /functions/v1/driver-access` body `{driver_id, action: 'reset_password'|'deactivate'|'reactivate'}` → `{temp_pin?}`. `deactivate` define `active=false` e bloqueia o usuário (`ban_duration`); `reactivate` desfaz.
  - **Decisão:** "definir senha no primeiro acesso" = entra com o PIN temporário enviado pelo admin e é obrigado a trocar a senha.

- [ ] **Step 1: Testes que falham:** admin cria "João Silva" → `login_code` casa com `/^PASSOS\d{2}JOAO$/` e login com o PIN funciona; não-admin → 403; `deactivate` → login falha; `reset_password` → PIN antigo falha e o novo funciona.
- [ ] **Step 2:** `npx supabase functions serve` + `npm test` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: edge functions de criação e acesso de motoristas`.

---

### Task 9: Autenticação e navegação no frontend

**Files:**
- Create: `src/lib/supabase.ts`, `src/lib/types.ts`, `src/lib/api.ts`, `src/lib/auth.tsx`, `src/auth/LoginPage.tsx`, `src/auth/FirstAccessPage.tsx`, `src/driver/DriverLayout.tsx`, `src/admin/AdminLayout.tsx`
- Modify: `src/App.tsx`
- Test: `src/auth/LoginPage.test.tsx`, `src/App.test.tsx`

**Interfaces:**
- Consumes: `loginToEmail`.
- Produces:
  - `useAuth(): { session, profile: Profile | null, loading, signIn(login, password), signOut() }`
  - `types.ts`: `Profile`, `Car`, `Shift`, `Ride`, `RideExpense`, `Fueling`, `Period`, `Statement`, `StatementLines` (formato da Task 6). Gerar com `npx supabase gen types typescript --local > src/lib/database.types.ts` e reexportar.
  - Rotas: `/login`, `/primeiro-acesso`, `/m/*` (motorista: `hoje`, `lancar`, `transfers`, `extrato`), `/admin/*` (`''`, `motoristas`, `carros`, `transfers`, `conferencia`, `quinzenas`, `extrato/:statementId`).
  - Textos: rótulo "Código de acesso", erro "Código ou senha inválidos".

- [ ] **Step 1: Testes que falham** (mock de `useAuth`/supabase): login com `PASSOS01JOAO` chama `signInWithPassword` com o e-mail técnico; `must_change_password=true` redireciona para `/primeiro-acesso`; nova senha com 5 caracteres mostra erro; motorista em `/admin` é redirecionado para `/m/hoje`; motorista inativo vê "Conta desativada".
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implementar; layout do motorista com barra inferior de 4 abas.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: login, primeiro acesso e rotas por perfil`.

---

### Task 10: Fotos e fila offline

**Files:**
- Create: `src/lib/photos.ts`, `src/lib/offline/queue.ts`, `src/components/PhotoInput.tsx`, `src/components/MoneyInput.tsx`, `src/components/SyncBadge.tsx`
- Test: `src/lib/offline/queue.test.ts`

**Interfaces:**
- Produces:
  - `compressImage(file: File): Promise<Blob>`; `uploadPhoto(blob: Blob, driverId: string, photoId: string): Promise<string>` (path; `upsert: true` → idempotente)
  - `type QueuedOp = { id: string; kind: 'insert_ride'|'insert_fueling'|'insert_expense'|'start_shift'|'end_shift'|'complete_transfer'; payload: Record<string, unknown>; photos: { field: string; photoId: string; blob: Blob }[]; status: 'pending'|'failed'; error?: string; createdAt: number }`
  - `enqueue(op): Promise<void>`, `flush(): Promise<void>` (FIFO, um por vez; envia as fotos, preenche os campos de path e chama a operação), `listOps(): Promise<QueuedOp[]>`, `discardOp(id)`, `onQueueChange(cb)`.
  - Erros permanentes (`PERIOD_CLOSED`, `NO_OPEN_SHIFT`, `SHIFT_ALREADY_OPEN` com id diferente, violação de check) → `status='failed'` + mensagem pt-BR, e a fila **continua**. Erro de rede → para e tenta de novo em `online` / a cada 30 s.
  - Inserts usam `upsert` com `onConflict: 'id', ignoreDuplicates: true`.
  - `MoneyInput` usa `parseBRL`.

- [ ] **Step 1: Testes que falham** (fake-indexeddb, mock de `api`): ops enviadas na ordem; erro de rede mantém a op `pending` e para a fila; `PERIOD_CLOSED` marca `failed` com "Não enviado: quinzena fechada" e a próxima op segue; `flush` duas vezes ao mesmo tempo não envia a op em dobro; foto enviada antes da op e path preenchido no payload.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implementar (`idb`, `browser-image-compression`); `SyncBadge` mostra "N pendente(s) de envio" / "N com erro".
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: fila offline e envio de fotos`.

---

### Task 11: Motorista — abas Hoje e Lançar

**Files:**
- Create: `src/driver/TodayTab.tsx`, `src/driver/LaunchTab.tsx`
- Test: `src/driver/TodayTab.test.tsx`, `src/driver/LaunchTab.test.tsx`

**Interfaces:**
- Consumes: `enqueue`, `useAuth`, `api.getOpenShift()`, `api.getTodaySummary()`, `PhotoInput`, `MoneyInput`.
- Produces: telas conforme spec §5 (abas 1 e 2).

- [ ] **Step 1: Testes que falham:**
  - carro da empresa sem turno mostra "Iniciar turno"; odômetro sem foto não envia;
  - com turno aberto mostra "Encerrar turno"; final menor que inicial mostra "O odômetro final não pode ser menor que o inicial";
  - encerramento com Uber no dia exige o print dos ganhos;
  - resumo pós-encerramento mostra km total, em serviço, por fora e desconto em R$;
  - motorista de carro próprio não vê Uber/BlaBlaCar em Lançar;
  - sem turno aberto, Uber/BlaBlaCar ficam desabilitados com "Inicie um turno para lançar corridas";
  - abastecimento exige valor, litros e foto.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implementar; todas as escritas passam por `enqueue` com `crypto.randomUUID()`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat(motorista): abas Hoje e Lançar`.

---

### Task 12: Motorista — Transfers e Extrato

**Files:**
- Create: `src/driver/TransfersTab.tsx`, `src/driver/StatementTab.tsx`, `src/components/StatementView.tsx`
- Test: `src/components/StatementView.test.tsx`, `src/driver/TransfersTab.test.tsx`

**Interfaces:**
- Consumes: `compute_statement` (via `api.computeStatement(driverId, periodId)`), `statements`, `complete_transfer`, `insert_expense`.
- Produces: `<StatementView lines={StatementLines} status="estimated"|"closed"|"paid" paidAt? method? />`, reutilizado pelo admin.

- [ ] **Step 1: Testes que falham:**
  - `StatementView` com as linhas do cenário da Task 6 mostra "R$ 213,00" e o selo "A receber (estimado)";
  - desconto aparece como "− R$ 12,50";
  - `pending.fuelings=50` mostra "R$ 50,00 aguardando conferência";
  - `missing_reference_price` mostra o aviso "Preço de referência do litro ainda não definido";
  - item recusado aparece com o motivo;
  - Transfer: "Concluir" exige km; despesa exige valor e foto.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat(motorista): Transfers e Extrato`.

---

### Task 13: Admin — Motoristas e Carros

**Files:**
- Create: `src/admin/DriversPage.tsx`, `src/admin/CarsPage.tsx`
- Test: `src/admin/DriversPage.test.tsx`

**Interfaces:**
- Consumes: Edge Functions da Task 8; tabelas `profiles`, `cars`.

- [ ] **Step 1: Testes que falham:**
  - formulário sem % Uber (carro da empresa) ou sem % Transfer não envia; os campos começam vazios;
  - campo % Uber escondido para carro próprio;
  - após criar, mostra código e PIN, e o link do WhatsApp é `https://wa.me/55{telefone só dígitos}?text=` com código e PIN codificados;
  - alterar % abre a confirmação "Vale a partir de hoje para novas corridas. Confirmar?";
  - desativar pede confirmação.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat(admin): motoristas e carros`.

---

### Task 14: Admin — Transfers e Conferência

**Files:**
- Create: `src/admin/TransfersPage.tsx`, `src/admin/ReviewPage.tsx`
- Test: `src/admin/ReviewPage.test.tsx`, `src/admin/TransfersPage.test.tsx`

**Interfaces:**
- Consumes: `review_item`, `admin_alerts`, `rides` (transfer), signed URLs do Storage (`createSignedUrl`, 10 min).

- [ ] **Step 1: Testes que falham:**
  - criar Transfer exige cliente, data/hora, valor e motorista;
  - lista mostra os status "Atribuída / Concluída / Conferida";
  - a fila de conferência lista abastecimentos, despesas, turnos e transfers concluídos com a foto;
  - "Recusar" sem motivo fica bloqueado;
  - alertas renderizam "km por fora acima de 20%", "km lançado maior que o rodado" e "Turno aberto há mais de 24 h";
  - o admin consegue corrigir o odômetro de um turno pendente antes de aprovar.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat(admin): transfers e conferência`.

---

### Task 15: Admin — Quinzenas, extratos e painel inicial

**Files:**
- Create: `src/admin/PeriodsPage.tsx`, `src/admin/PrintStatementPage.tsx`, `src/admin/DashboardPage.tsx`, `src/lib/csv.ts`
- Test: `src/lib/csv.test.ts`, `src/admin/PeriodsPage.test.tsx`

**Interfaces:**
- Consumes: `compute_statement`, `close_period`, `mark_statement_paid`, `period_summary`, `adjustments`, `StatementView`.
- Produces: `toCSV(rows: Record<string, string|number>[]): string` — separador `;`, BOM UTF-8, números com vírgula decimal.

- [ ] **Step 1: Testes que falham:**
  - `toCSV([{motorista:'João', total: 213}])` começa com `﻿` e contém `João;213,00`;
  - os erros de `close_period` aparecem como "Há turnos abertos", "Há transfers não concluídos", "Há itens aguardando conferência", "Defina o preço de referência do litro";
  - "Fechar quinzena" pede confirmação;
  - ajuste do tipo vale é salvo com valor negativo mesmo se digitado positivo;
  - "Marcar como pago" exige data e forma;
  - a página de impressão chama `window.print()`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implementar; o painel inicial usa `period_summary` da quinzena atual.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat(admin): quinzenas, extratos, exportação e painel`.

---

### Task 16: PWA, teste ponta a ponta e deploy

**Files:**
- Modify: `vite.config.ts` (vite-plugin-pwa: `registerType: 'autoUpdate'`, manifest `name: 'Passos Transfer'`, `display: 'standalone'`, ícones 192/512, cache do app shell)
- Create: `public/icons/*`, `e2e/full-flow.spec.ts`, `playwright.config.ts`, `docs/DEPLOY.md`

- [ ] **Step 1: Teste E2E que falha** (Playwright contra `npm run dev` + Supabase local + seed):
  1. o admin cria um motorista de carro da empresa;
  2. o motorista entra com o PIN e troca a senha;
  3. inicia o turno, lança Uber e abastecimento e encerra o turno;
  4. o admin cria o Transfer, que o motorista conclui com pedágio;
  5. o admin aprova tudo, define o preço de referência e fecha a quinzena;
  6. o extrato do motorista mostra "Fechado" com o total esperado;
  7. o admin marca como pago;
  8. **modo offline:** `context.setOffline(true)` → lançar Uber mostra "1 pendente de envio" → `setOffline(false)` → a contagem zera e a corrida aparece.
- [ ] **Step 2:** `npx playwright test` → FAIL.
- [ ] **Step 3:** Configurar a PWA e corrigir o que o E2E revelar.
- [ ] **Step 4:** `npx playwright test` e `npm test` e `npx supabase test db` → PASS; `npm run build` sem erros.
- [ ] **Step 5:** Escrever `docs/DEPLOY.md`: criar o projeto Supabase, `supabase link`, `supabase db push`, `supabase functions deploy`, criar o primeiro admin (usuário no painel + `update profiles set role='admin'`), variáveis na Vercel (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`), como instalar a PWA no Android (Chrome → "Instalar app") e no iPhone (Safari → Compartilhar → "Adicionar à Tela de Início").
- [ ] **Step 6:** Commit `feat: PWA instalável, teste ponta a ponta e guia de deploy`.
