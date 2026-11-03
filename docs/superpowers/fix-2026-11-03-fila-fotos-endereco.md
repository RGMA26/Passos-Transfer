# Correção 2026-11-03: fila offline travada por foto, km nulo em endereços reais, código de login reaproveitável

Branch `fix/fila-fotos-endereco`. Só ambiente local (Supabase `--local`). Nada foi enviado ao remoto, nada foi publicado.

## Causas

1. **Fila travada (produção).** `pass()` em `src/lib/offline/queue.ts` envia em ordem estrita e para no
   primeiro erro transitório. A foto ficava no IndexedDB como `Blob`. No iOS Safari esse Blob fica ilegível
   depois de recarregar a página, o upload lança `TypeError` e isso conta como erro transitório. A op
   ficava `pending` para sempre e segurava tudo que vinha depois. Foi o que aconteceu com o
   `start_transfer`: o card mostrava "Concluir" (o `effective()` trata o início pendente como em andamento),
   o servidor seguia `assigned` e o concluir entrava na fila atrás. "Tentar de novo" não resolvia por dois
   motivos: a op da frente nunca saía, e uma passada já em andamento que caísse por rede zerava `rerun`.
2. **Km nulo.** O Nominatim não acha o texto livre "Av. São Rafael, 2152, São Rafael, salvador, BA, 41253-190",
   mas acha "Avenida São Rafael 2152, Salvador, BA" e também `postalcode=41253-190`.
3. **Requisito.** Turno e Transfer precisam andar mesmo sem a foto do odômetro, e o admin precisa ser avisado.
4. **(H)** `generate_login_code` usava `nextval('driver_seq')`: um número queimado nunca voltava
   (produção mostra PASSOS02KAIQUE).

## Mudanças

| Item | O que mudou |
|---|---|
| A | A fila grava as fotos como `{bytes: ArrayBuffer, type}` e reconstrói o Blob no envio (`readStoredPhoto`). Op antiga com Blob: tenta `arrayBuffer()`; se falhar (ou se o IndexedDB devolver `{}`) lança `PhotoLostError`. |
| B | Em `start_shift`/`end_shift` (photo, uber_photo) e `start_transfer`/`complete_transfer` (photo), se a foto não sobe (qualquer erro) a op vai com o campo `null` e entra um `attach_photo` no FIM da fila (id `${op}:${campo}`, com os bytes). O `attach_photo` sobe a foto e chama a RPC `attach_photo`. Ele nunca segura a fila: em falha passa para a próxima op e, depois de 5 falhas de conexão, fica failed. Foto perdida (Blob ilegível) segue sem anexo e fica a pendência 📷. Comprovantes (corrida, abastecimento, despesa) continuam obrigatórios. Comprovante ilegível vira failed com "Não enviado: a foto do comprovante se perdeu. Exclua e lance de novo." e a fila anda. |
| C | `attempts` fica gravado na op. A 5ª falha transitória com rede marca a op failed com "Não enviado: falha de conexão ao enviar. Tente de novo." e `stalled: true`. Uma op stalled continua segurando as seguintes, então a ordem se mantém. Falha com `navigator.onLine === false` não conta. `retryOp` zera `attempts`/`stalled` e, se houver uma passada em andamento, agenda outra para depois dela (corrige o "Tentar de novo não faz nada"). SyncBadge ganhou rótulos para iniciar/concluir Transfer (odômetro; antes mostrava `undefined km`) e para os anexos de foto. |
| D | Migração `0015_photo_pending.sql`: as 4 RPCs aceitam foto nula ou em branco (vira `null`). `UBER_PHOTO_REQUIRED` deixou de bloquear e virou pendência. Nova RPC `attach_photo(p_target, p_id, p_path)`: só o motorista dono; o path precisa ser `^<uid>/[0-9A-Za-z-]+\.jpg$`; só preenche coluna vazia, então é idempotente; em Transfer liga `passos.transfer_rpc` para passar pelo guarda de campos; quinzena fechada dá `PERIOD_CLOSED` pelo gatilho. Erros: `INVALID_TARGET`, `INVALID_PATH`, `NOT_FOUND`, `FORBIDDEN`. `admin_pendencies()` ganhou a categoria `photo`: uma linha por turno ou Transfer, rótulo "Turno sem foto do odômetro (início), foto do odômetro (fim), print da Uber" ou "Transfer sem …", ignorando quinzena fechada. UI: bolinha 📷 no Início (abre `conferencia#item-<id>`), "📷 Foto não enviada" em Pendências (a chave do item agora inclui a categoria), e na Conferência os avisos "📷 Foto do odômetro não enviada (início/fim)" e "📷 Print da Uber não enviado". Tipos regenerados. |
| E | `effective()` já ignorava ops failed. Testes novos garantem que um início failed volta a "Iniciar" e mostra o erro mesmo com um concluir pendente atrás, e que o `attach_photo` não aparece como "pendente de envio" no card. Não precisei mudar código. |
| F | `route.ts` ganhou `expandStreet` (Av./Av, R./R, Rod., Trav., Al., Pç./Pça./Pca, Est., Dr.), `candidateQueries` (1: rua expandida com número + cidade + UF; 2: + bairro; 3: `postalcode`+`country=Brasil`; 4: bairro + cidade + UF; no máximo 4, sem repetidas) e `geocodeFirst` (1,1 s entre chamadas, para no primeiro achado, nunca lança, respeita o prazo). `index.ts` usa essas funções com orçamento de 22 s (18 s para geocodificar e 4 s reservados para o OSRM), timeout por chamada ≤ 6 s e 1,1 s entre a origem e o destino. Removi o `buildQuery`, que ficou sem uso. |
| G | `hasStreetNumber`: no formulário de Transfer, "Rua e número" sem dígito mostra "Informe o número da rua" (na origem e no destino) e não cria nada. |
| H | Migração `0016_login_code_reuse.sql`: `generate_login_code` usa o menor número positivo que nenhum perfil usa, com `pg_advisory_xact_lock`; mantém 2 dígitos abaixo de 100 e número cheio a partir de 100. Desativado mantém o número. `delete_driver(uuid)` (só service_role) dá `HAS_ENTRIES` se houver rides, shifts, fuelings, adjustments, statements, driver_periods **fechadas**, admin_documents ou driver_pauses. Sem isso, desfaz o vínculo do carro, apaga as quinzenas abertas vazias e apaga `auth.users` (o perfil cai em cascata), tudo numa transação, e devolve o código liberado. `driver-access` ganhou a ação `delete` (400 HAS_ENTRIES / 404 / 200 `{login_code}`). `create-driver` repete até 3 vezes se o número ou o e-mail colidir (cadastros concorrentes). UI: botão "Excluir motorista" com a confirmação "Excluir <nome>? O código <código> ficará livre para um novo motorista." e o erro "Este motorista tem lançamentos. Use Desativar." |

## Testes

- Vitest `queue.test.ts`: +12 testes (bytes, Blob antigo legível/ilegível, desacoplamento das 5 fotos, anexo não segura a fila, comprovante perdido, comprovante continua obrigatório, 5 falhas → failed segurando a fila e retry na ordem, offline não conta, retry durante uma passada que cai).
- Vitest admin: Dashboard 📷, Pendências (filtro e chave), Conferência (avisos), TransfersTab (2), TransfersPage (número da rua), DriversPage (3 de excluir), SyncBadge (rótulos), route.test (expandStreet ×16, candidateQueries com os dois endereços reais, geocodeFirst).
- pgTAP: `photo_pending.test.sql` (44) e `login_code_reuse.test.sql` (17). Ajustes: os PHOTO_REQUIRED/UBER_PHOTO_REQUIRED de `shift_transfer_review` e `transfer_flow` viraram "sem foto não bloqueia; a leitura ainda é validada"; `balance_docs` conta categorias sem `photo`; `triggers` reflete o número sem consumo de sequência.
- Integração (`npm run test:integration`, com `supabase functions serve` local): 15/15, sendo 2 novos (excluir libera e o mesmo código é reaproveitado; HAS_ENTRIES mantém o motorista).
- Verificação ao vivo da geocodificação (Nominatim/OSRM reais, script fora do repositório): "Avenida São Rafael 2152, salvador, BA" achou na 1ª tentativa; "Rua Arivaldo de carvalho 734, Feira de Santana, BA" achou na 1ª; OSRM deu 111106,8 m.

### RED (antes da implementação)

```
queue.test.ts:        Tests  12 failed | 34 passed (46)
admin (3 arquivos):   Tests  5 failed | 31 passed (36)
route.test.ts:        Failed Tests 22 — TypeError: expandStreet / candidateQueries is not a function
TransfersPage:        × rua sem número: "Informe o número da rua" … — 1 failed | 18 passed
pgTAP 0015:           photo_pending: function "attach_photo(text,uuid,text)" does not exist — Failed 44/44;
                      shift_transfer_review/transfer_flow falhando no PHOTO_REQUIRED antigo
pgTAP 0016:           login_code_reuse: function "delete_driver(uuid)" does not exist — Failed 16/17
DriversPage:          3 failed | 26 passed (excluir)
```
SyncBadge (rótulos) e TransfersTab (E) não tiveram RED: o rótulo foi implementado junto com o teste, e o comportamento de E já existia, então esses testes são de regressão.

### GREEN: finais das quatro verificações

`npx supabase db reset --local && npx supabase test db`
```
…/supabase/tests/type_change.test.sql ............ ok
All tests successful.
Files=17, Tests=869,  9 wallclock secs
Result: PASS
```
`npm test`
```
 Test Files  45 passed | 1 skipped (46)
      Tests  462 passed | 11 skipped (477)
```
`npm run build`
```
PWA v2.0.0
mode      generateSW
precache  18 entries (693.60 KiB)
files generated
  dist/sw.js
  dist/workbox-9c191d2f.js
```
`npx playwright test`
```
  1 passed (3.7m)
```
A 1ª execução do E2E chegou ao fim do fluxo e falhou só na checagem final de erros do navegador:
`admin HTTP 544 POST …/storage/v1/object/sign/photos/<uid>/<id>.jpg`. Esse erro veio do Storage local ao gerar
o link assinado de uma miniatura. O path vem do banco, e o app só grava um path depois de o upload dar certo.
A 2ª execução, sem mudar nada, passou: tudo indica instabilidade do Storage local. O E2E não precisou mudar.

## Commits

```
490eea0 fix(fila): fotos guardadas como bytes; foto do odômetro não trava a fila (attach_photo no fim); …
5b670eb feat(servidor): fotos do odômetro/print da Uber opcionais nas RPCs, attach_photo e pendência 📷 (0015)
7881074 feat(admin): pendência 📷 no Início/Pendências e aviso de foto não enviada na Conferência
2344e87 test(transfers): Iniciar que falhou volta a Iniciar com o erro; …
8aba89c fix(rota): geocodificação em até 4 tentativas …
d2b2da3 fix(transfers): Rua e número exige o número (origem e destino)
28bfce3 feat(motoristas): número do código de login reaproveitado (menor livre) e Excluir motorista sem lançamentos (0016)
```

## Pontos de atenção

- **Deploy:** as migrações 0015 e 0016 e as funções `estimate-route`, `driver-access` e `create-driver` precisam ir juntas. O app novo chama as RPCs com foto `null`. Se o app for publicado antes da 0015, o servidor antigo recusa com PHOTO_REQUIRED.
- **Ops antigas no iPhone do motorista:** um start_transfer preso com Blob perdido agora sai sem foto e o admin vê 📷. Não dá para recuperar essa foto.
- **C:** com rede ruim de verdade (sinal fraco mas `onLine` verdadeiro), 5 tentativas podem levar poucos minutos. Depois disso a op fica failed e segura a fila até o motorista tocar em "Tentar de novo" (a pedido: a ordem importa).
- **H, desvio consciente:** a especificação inclui driver_periods na lista de bloqueios, mas só quinzenas **fechadas** contam como lançamento. As abertas são criadas sob demanda (por exemplo, pela tela do admin) e bloqueariam a exclusão de qualquer motorista novo; elas são apagadas junto. O `driver_pauses` entrou na lista de bloqueios por causa da chave estrangeira.
- **H:** um código liberado pode ser reaproveitado para outra pessoa, então PDFs ou mensagens antigas com aquele código ficam ambíguos (comportamento pedido).
- **G:** endereços "S/N" agora são recusados; é preciso digitar algum número.
- **Pendência 📷:** continua aparecendo depois da conferência enquanto a quinzena estiver aberta. Se o item já foi aprovado, a âncora da Conferência não existe mais e o link abre a Conferência sem rolar até ele.

## Ajustes pedidos na revisão (mesma branch; 0015 editada no lugar, ainda não publicada)

1. **Foto que subiu mas nunca foi ligada ao registro (importante).** Nos ramos de repetição idempotente, as RPCs passam a preencher a foto só se a coluna estiver vazia: `start_shift` (id já existe), `end_shift` (turno já encerrado: foto final e print da Uber), `start_transfer` (mesma leitura) e `complete_transfer` (mesma leitura). Em Transfer isso passa pelo guarda com `passos.transfer_rpc`. Se esse preenchimento for barrado por um gatilho (por exemplo, quinzena fechada), a repetição continua devolvendo o registro existente.
   Testes pgTAP novos em `photo_pending` (+8, total 52): para cada RPC, a 1ª chamada sem foto e a repetição com foto preenchem a coluna; uma nova repetição com outra foto não troca a que já está lá.
2. **Login órfão no create-driver.** Se o e-mail já existe, o create-driver procura o usuário de login (`listUsers`, por páginas). Se ele não tiver perfil, é apagado e o cadastro tenta de novo uma única vez. Se tiver perfil, o comportamento é o de antes (cadastro concorrente: tenta outro número). Teste de integração novo cobre o caso: um login órfão com o próximo código é apagado e o motorista é criado com esse mesmo código.
3. **attach_photo com alvo que sumiu.** `NOT_FOUND` conta como enviado e o anexo sai da fila. Coluna já preenchida o servidor já tratava como sucesso (no-op). Teste Vitest novo.

### RED

```
pgTAP photo_pending: # Failed test 45: "start_shift repetido com foto preenche a foto vazia"  have: NULL  want: d001/s1.jpg
                     (falhas 45–52: as 8 novas)
queue.test.ts:       × attach_photo com alvo que sumiu (NOT_FOUND) conta como enviado … — 1 failed | 46 passed (47)
integração:          × create-driver: login órfão (sem perfil) com o mesmo e-mail é apagado … — 1 failed | 15 passed (16)
```

### GREEN: as quatro verificações + integração

```
db reset + test db:  Files=17, Tests=877 … Result: PASS
npm test:            Test Files  45 passed | 1 skipped (46) / Tests  463 passed | 12 skipped (479)
npm run build:       files generated  dist/sw.js  dist/workbox-9c191d2f.js
playwright:          1 passed (2.2m)
integração:          Tests  16 passed (16)
```
