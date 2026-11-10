# Fix: turno recusado aparecia como aberto (2026-11-10)

Branch `fix/turno-recusado`.

## Causa
`deriveShift` (src/driver/useShift.ts) tratava qualquer `start_shift` da fila como turno aberto quando o servidor não tinha turno, inclusive os recusados (`failed`, ex.: ODOMETER_BELOW_LAST). O app mostrava "Encerrar turno" e todas as ops dependentes falhavam depois (NO_OPEN_SHIFT).

## Mudanças
- `deriveShift`: só `start_shift` pendente abre turno; só `end_shift` pendente esconde o turno aberto.
- `src/driver/shiftOps.ts`: `failedStartShift(ops)` e `failureReason(op)`.
- Fila: guarda `detail` (DETAIL do raise, via `details` do PostgREST, repassado por `api.fail`); ODOMETER_BELOW_LAST vira "Não enviado: odômetro menor que o último registrado (101.500 km)" quando há detail.
- Hoje: caixa vermelha com o motivo, "Corrigir e tentar de novo" (formulário com o carro e odômetro vazio; descarta a op recusada ao enfileirar a nova) e "Descartar".
- Transfers: dica "Seu turno não foi aberto: <motivo>. Veja a aba Hoje." quando o início falhou.
- Formulário de início: `api.getLastCarReading(carId)` (odometer_end do último turno encerrado do carro) bloqueia leitura menor com "O odômetro não pode ser menor que o último registrado (X km)". Sem rede, segue sem a pré-validação (o servidor valida).

## Testes
Unitários: useShift.test.ts (novo), queue.test.ts, TodayTab.test.tsx, TransfersTab.test.tsx.

E2E: playwright 1 passed. Vitest: suite completa verde (falhas intermitentes de timeout em outros arquivos sob carga passam isolados). Build ok.
