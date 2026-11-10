# Correção 2026-11-03 (c): odômetro errado conferido, desfazer conferência, leitura fora do normal

Branch `fix/odometro-correcao`. Tudo foi feito só no ambiente local (Supabase `--local`). Nada foi enviado ao remoto e nada foi publicado.

## O que aconteceu em produção

O Polo da empresa tinha um turno de 57.876 → 57.877, já aprovado. Dentro desse turno havia um Transfer lançado com 1.010.000 → 10.102.500, ou seja, km 9.092.500. O admin conferiu esse Transfer. Resultado:

1. O extrato usou esse km.
2. `car_last_odometer` passou a ser 10.102.500, e o próximo `start_shift` / `start_transfer` no Polo falha com `ODOMETER_BELOW_LAST`.
3. Um Transfer conferido não podia ser editado, e o admin não tinha como desfazer a conferência nem corrigir as leituras.

Ninguém foi avisado em nenhum momento: nem o motorista ao digitar, nem o admin ao conferir.

## Commits

| Commit | Item |
|---|---|
| `997f01a` | 1. feat(conferencia): Desfazer conferência (RPC `unreview_item`, 0019) |
| `5fee419` | 2. feat(transfers): Corrigir odômetro do Transfer (RPC `admin_fix_transfer_odometer`) |
| `1153ef7` | 3. feat(odometro): `odometer_suspect` + pendência 🟠 + aviso na Conferência; `end_shift` ≥ leituras dos Transfers; confirmação e eco da leitura no app |
| (este)    | 4./5. E2E (desfazer → corrigir → conferir de novo) + este registro |

## Mudanças

### Migração `0019_odometer_fix.sql` (nova)

- **`unreview_item(p_kind, p_id)`**: só admin, senão `FORBIDDEN`.
  - `transfer`: checked → completed. As despesas aprovadas voltam a pendentes; as recusadas ficam como estão.
  - `shift`: approved|rejected → pending.
  - `fueling` / `expense`: approved|rejected → pending.
  - O motivo da recusa é apagado.
  - Erros:
    - item não conferido: `NOT_REVIEWED`;
    - despesa de um Transfer ainda conferido: `USE_TRANSFER_REVIEW` (é preciso desfazer o Transfer);
    - tipo inválido: `INVALID_KIND`;
    - quinzena fechada: `PERIOD_CLOSED`, pelo gatilho `block_closed_period`.
  - Auditoria pelo gatilho `audit_*` que já existe.
- **`admin_fix_transfer_odometer(p_id, p_start, p_end)`**: só admin.
  - `in_progress`: corrige só a leitura inicial (`p_end` nulo).
  - `completed`: corrige as duas leituras e recalcula `km = final − inicial`.
  - Erros:
    - status `checked` ou `assigned`: `NOT_CHANGEABLE` (no conferido, desfazer a conferência antes);
    - leitura nula ou negativa, ou leitura final enviada para um Transfer em andamento: `INVALID_ODOMETER`;
    - final menor que o inicial: `ODOMETER_BELOW_START`;
    - quinzena fechada: `PERIOD_CLOSED`.
  - Auditoria pelo gatilho `audit_rides`. Como `car_last_odometer` é calculado na hora, a correção libera o carro.
- **`odometer_suspect boolean not null default false`** em `shifts` e `rides`.
  - Calculado pelos gatilhos BEFORE `shifts_odometer_suspect` e `rides_odometer_suspect`. O de rides roda depois de `rides_before_write`.
  - É recalculado só quando mudam as leituras ou o carro. Fora disso o valor anterior é mantido, então o cliente nunca consegue gravar a marca.
  - Regras:
    - (a) leitura inicial mais de 1.000 km acima da maior leitura do carro, sem contar a própria linha (nova função interna `car_prev_odometer`);
    - (b) Transfer com km > 1.000;
    - (c) turno com km_total > 1.500.
  - Não bloqueia nada.
- **`admin_pendencies()`**: recriada a partir da 0015, com mais um bloco.
  - Categoria `orange`, `item_type` `shift` ou `transfer`, rótulo "Odômetro fora do normal".
  - Só entra o que não está em quinzena fechada.
- **`end_shift`**: recriada a partir da 0015.
  - A leitura final precisa ser ≥ a maior leitura dos Transfers ligados ao turno. Senão: `ODOMETER_BELOW_LAST`, com `detail` = essa leitura.
- Sem backfill: a base de produção foi zerada antes desta migração (só resta o admin).

### Admin (UI)

- **Transfers**:
  - "Desfazer conferência" nas linhas Conferida, com o confirm "Desfazer a conferência deste item? Ele volta para a fila de conferência.".
  - "Corrigir odômetro" inline nas linhas Em andamento (só a inicial) e Concluída (as duas).
  - A coluna Km real mostra as leituras formatadas, por exemplo "1.010.000 → 10.102.500".
- **Conferência**:
  - Nova seção "Conferidos recentemente" (últimos 45 dias, até 30 por tipo, via `api.listReviewed`): abastecimentos aprovados/recusados, turnos aprovados e Transfers conferidos, cada um com "Desfazer conferência".
  - Cartão do Transfer com "Corrigir odômetro" (componente `OdometerFix`).
  - Leituras formatadas no cartão.
  - Aviso laranja "🟠 Odômetro fora do normal: 1.010.000 → 10.102.500 (9.092.500 km)" no cartão do Transfer e no do turno marcados.
- **Pendências / Início**: o rótulo 🟠 passa a ser "Valores conflitantes / odômetro fora do normal".
- API nova: `unreviewItem`, `fixTransferOdometer`, `listReviewed`. `PendingShift` e `PendingTransfer` ganham `odometer_suspect`.

### Motorista (UI)

- `src/lib/odometer.ts` com `fmtInt`, `parseOdometerText` (só inteiro), `odometerEcho`, `checkReading`/`confirmReading`, `lastReading`/`rememberReading` (última leitura enviada por este aparelho, em `localStorage`) e `maxReading`.
- `OdometerField`: mostra a leitura formatada embaixo do campo ("10.102.500 km"). Ponto ou vírgula dá o erro "Digite só números, sem ponto ou vírgula".
- Antes de pôr na fila, se a leitura passa mais de 1.000 km da referência, aparece o confirm "Confira a leitura: 10.102.500 km (9.092.500 km acima da última). Está certa?". Cancelar mantém o formulário preenchido.
- Referência usada em cada formulário:
  - Iniciar turno: a última leitura do aparelho.
  - Encerrar turno: a maior entre o início do turno e a última do aparelho.
  - Iniciar Transfer: a maior entre o início do turno aberto (carro da empresa) e a última do aparelho.
  - Concluir Transfer: o início do Transfer, o que cobre km > 1.000.
- "Odômetro inicial" aparece formatado em Hoje e em Transfers.

## Testes (TDD: RED → GREEN)

| Item | RED (antes) | GREEN |
|---|---|---|
| 1 pgTAP `unreview.test.sql` (27) | `function "unreview_item(text,uuid)" does not exist`, 27/27 falharam | PASS |
| 1 Vitest `api.odometer`, `ReviewPage.undo`, `TransfersPage.odometer` | 8 falharam (`unreviewItem`/`listReviewed` inexistentes, botões ausentes) | PASS |
| 2 pgTAP `fix_transfer_odometer.test.sql` (20) | função inexistente, 20/20 falharam | PASS |
| 2 Vitest (Corrigir odômetro em Transfers/Conferência, api) | 10 falharam | PASS |
| 3 pgTAP `odometer_suspect.test.sql` (24) | `column "odometer_suspect" does not exist`, 24/24 falharam | PASS |
| 3 Vitest `odometer`, `TodayTab.odometer`, `TransfersTab.odometer`, aviso 🟠 | 15 falharam | PASS |

Cobertura pgTAP:
- `unreview_item`: cada tipo, `NOT_REVIEWED`, `NOT_FOUND`, `INVALID_KIND`, quinzena fechada (Transfer e turno), motorista → `FORBIDDEN`, audit_log e conferir de novo.
- `admin_fix_transfer_odometer`: o caso de produção, em andamento, conferido/atribuído, final < inicial, quinzena fechada, audit_log, desfazer → corrigir.
- `odometer_suspect`: regras (a), (b) e (c) com os limites exatos (1.000 e 1.500 não marcam), marca gravada à mão é ignorada, pendência 🟠 aparece e some ao corrigir, quinzena fechada fica de fora.
- `end_shift` contra as leituras dos Transfers, pelas RPCs.

Ajustes em testes existentes:
- `statement.test.sql` e `transfer_flow.test.sql` encerravam turnos abaixo da leitura de um Transfer do próprio turno, que é exatamente o caso que a nova regra recusa. As leituras finais foram para ≥ a do Transfer, e a estimativa esperada foi recalculada (200 × 0,60 = 120,00).
- Vitest: as asserções de leitura agora esperam os números formatados ("5.000", "1.000 → 1.040").

E2E (`full-flow.spec.ts`):
- Leituras formatadas.
- Novo passo 8b: "Desfazer conferência" do Transfer em "Conferidos recentemente" → o Transfer volta à fila → "Corrigir odômetro" → Aprovar de novo, mantendo os valores (o extrato esperado não muda).

## Verificação final (saídas brutas)

```
$ npx supabase db reset --local && npx supabase test db
All tests successful.
Files=22, Tests=1013,  8 wallclock secs ( 0.38 usr  0.19 sys +  0.55 cusr  0.56 csys =  1.68 CPU)
Result: PASS
db exit 0
```

```
$ npm test
 Test Files  53 passed | 1 skipped (54)
      Tests  528 passed | 12 skipped (544)
test exit 0
```

```
$ npm run build
precache  18 entries (714.35 KiB)
files generated
  dist/sw.js
  dist/workbox-2fbc6a65.js
build exit 0
```

```
$ npx playwright test
  1 passed (4.5m)
[exited with code 0]
```

## Deploy (controlador)

1. Aplicar `supabase/migrations/0019_odometer_fix.sql` no projeto remoto com `supabase db push`. Ela é aditiva: duas colunas novas com default, 3 funções novas, 2 gatilhos novos, e `end_shift`/`admin_pendencies` recriadas com a mesma assinatura. Não há backfill (a base foi zerada).
2. Publicar o front (Vercel). O app novo usa `unreview_item`, `admin_fix_transfer_odometer` e `odometer_suspect`, então a migração precisa ir antes do front.
3. Não há mudança em Edge Functions nem em secrets.
4. Se um dia aparecer um caso como o do Polo: Transfers → "Desfazer conferência" → "Corrigir odômetro" → conferir de novo. O carro volta a aceitar leituras normais na mesma hora.

## Pontos de atenção

- Com a nova regra do `end_shift`, um Transfer lançado com leitura absurda dentro do turno impede o motorista de encerrar o turno: a fila mostra "Não enviado: odômetro menor que o último registrado". O admin precisa corrigir o Transfer (em andamento ou concluído) antes. A operação na fila fica marcada como falha, e o motorista encerra de novo depois da correção.
- A referência do aviso no app é local ao aparelho (última leitura enviada). Num aparelho novo, o primeiro "Iniciar turno" não tem referência; nesse caso só o servidor marca (pendência 🟠).
- Um item marcado 🟠 continua na central até ser corrigido ou até a quinzena fechar, mesmo depois de aprovado. Isso é de propósito, para não sumir sem correção.
