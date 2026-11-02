# Quinzena por motorista, preço do litro pela nota, Balanço mensal e Documentos — Design

**Data:** 2026-11-02
**Status:** aguardando revisão
**Base:** app em produção descrito em `docs/superpowers/specs/2026-10-29-passos-transfer-app-design.md`. Este documento descreve apenas o que muda.

## 1. Objetivo

1. Cada motorista tem o **próprio ciclo de quinzenas**, contado a partir do seu cadastro, com fechamento individual e sinais visuais de prazo.
2. O preço do litro passa a vir **das notas de abastecimento** de cada motorista (digitado e conferido), e o preço de referência do admin deixa de existir.
3. Nova aba **Balanço mensal** com a visão financeira da empresa no mês, exportações para o contador e recibo de pagamento.
4. Área de **Documentos** por motorista e anexos por pagamento, visíveis **somente para o admin**.

Fora de escopo: leitura automática da nota com IA (registrada em `docs/backlog/leitura-automatica-nota-ia.md`), cálculo de impostos, emissão de nota fiscal, despesas gerais da empresa.

Não há dados reais em produção; as mudanças são migrações novas (0010+) aplicadas sobre 0001–0009, sem migração de dados.

## 2. Quinzena por motorista

### 2.1 Ciclo
- `profiles.cycle_start_date date not null` = data local (America/Sao_Paulo) do cadastro do motorista. Definida na criação; não é editável diretamente — só muda pela **retomada após pausa** (§2.4).
- Quinzena = **15 dias corridos**. A quinzena *n* (n ≥ 0) vai de `cycle_start_date + 15n` até `cycle_start_date + 15n + 14`.
  Ex.: cadastro 10/11 → 10/11–24/11, 25/11–09/12, 10/12–24/12.
- Tabela `driver_periods(id, driver_id, start_date, end_date, status 'open'|'closed', closed_at, unique(driver_id, start_date))`. Função `driver_period_for(p_driver uuid, p_date date) returns uuid` devolve a quinzena **já existente** do motorista que contém a data; se não houver, cria a quinzena do ciclo atual (a partir de `cycle_start_date`) que contém a data — mesma técnica concorrência-segura de `period_for_date`. Datas entre o fim de uma quinzena encurtada por pausa e a retomada não pertencem a quinzena alguma (§2.4).
- Lançamentos com data **anterior** ao `cycle_start_date` do motorista são recusados (`BEFORE_CYCLE_START`).
- Pertencimento: corrida por `ride_date`; abastecimento por `fueled_on`; turno por `start_date`; despesa pela corrida; ajuste pela sua quinzena (`driver_period_id`).
- A tabela global `periods`, `period_for_date`, `period_drivers` e `periods.reference_fuel_price` são removidos; `statements` e `adjustments` passam a referenciar `driver_period_id`.

### 2.2 Fechamento individual
- `close_driver_period(p_period uuid, p_force boolean default false)` — só admin. Verificações, nesta ordem, restritas ao motorista e às datas da quinzena:
  1. `PREVIOUS_OPEN` — existe quinzena anterior do mesmo motorista ainda aberta (fechar em ordem).
  2. `PERIOD_NOT_ENDED` — hoje (SP) ≤ `end_date` e `p_force` = false (a tela pede a segunda confirmação "A quinzena ainda não terminou. Fechar mesmo assim?").
  3. `OPEN_SHIFTS`, `ASSIGNED_TRANSFERS`, `PENDING_REVIEW`, `SHIFTS_NOT_APPROVED` — mesmos significados atuais.
- Gera **um** `statement` (linhas congeladas de `compute_statement`) e marca a quinzena `closed`. Mantêm-se: congelamento do extrato (só `paid_at`/`payment_method` mudam), bloqueio de escrita na quinzena fechada (por motorista, com o lock `FOR SHARE` atual), `mark_statement_paid`.
- Fechar a quinzena de um motorista não afeta nenhum outro.

### 2.4 Pausa e retomada do motorista
- Para afastamentos (doença, viagem etc.), o admin usa **"Pausar"** na ficha do motorista, informando a **data da pausa** (padrão: hoje) e um motivo opcional. Tabela `driver_pauses(id, driver_id, paused_on, resumed_on null, reason, created_at)`; `profiles.paused boolean`.
- Ao pausar:
  - a quinzena aberta que contém a data da pausa é **encurtada**: `end_date` passa a ser a data da pausa (último dia trabalhado). Ela pode ser fechada normalmente (já terminou);
  - pausar exige não haver turno aberto do motorista (`OPEN_SHIFTS`);
  - enquanto pausado, o motorista consegue entrar no app e ver o Extrato, mas **não consegue lançar nada** (corrida, abastecimento, turno, conclusão de Transfer, despesa): erro `DRIVER_PAUSED` → "Seu cadastro está pausado. Fale com a empresa." Transfers não podem ser atribuídos a motorista pausado.
- Ao **"Retomar"**, o admin informa a **data de retorno** (padrão: hoje; deve ser posterior à pausa): `cycle_start_date` passa a ser a data de retorno e as novas quinzenas contam a partir dela (15 dias corridos). `driver_pauses.resumed_on` é preenchido e `paused` volta a falso.
- A ficha do motorista mostra o histórico de pausas (de–até, motivo). Motorista pausado aparece com o selo cinza **"Pausado"** nas listas; recebe 🔴 apenas se tiver quinzena terminada e não fechada.
- Pausar é diferente de **Desativar** (que bloqueia o acesso de vez).

### 2.3 Sinais de prazo
- Para cada motorista ativo e não pausado (pausados: só o 🔴 descrito em §2.4):
  - 🔴 **vermelho** se existe quinzena com `end_date` < hoje (SP) e status `open`;
  - 🟡 **amarelo** (se não estiver vermelho) quando `end_date` da quinzena atual − hoje ≤ 5 (inclui o último dia);
  - sem sinal caso contrário.
- Função `driver_period_signals()` (só admin) → `driver_id, current_period_id, start_date, end_date, days_left, signal ('red'|'yellow'|null)`.
- Exibidos ao lado do nome em **Motoristas** e **Quinzenas**; **Início** mostra "N quinzenas para fechar" (vermelho) e "N terminando em breve" (amarelo).
- O motorista vê no **Extrato** as datas da sua quinzena atual ("Quinzena 10/11 – 24/11, faltam X dias"), sem os círculos.

## 3. Abastecimento e preço do litro

### 3.1 Lançamento (todos os motoristas)
- Campos obrigatórios: **valor total**, **litros**, **preço do litro** (`fuelings.price_per_liter numeric(6,3)`, > 0) e **foto da nota**.
- Conferência no app: conflito quando `|litros × preço − total| > max(R$ 0,10; 0,5% do total)`.
  - Sem conflito: salva normalmente.
  - Com conflito: mensagem **"Valores conflitantes, confira a nota"**, a conta exibida (ex.: "40 L × R$ 6,19 = R$ 247,60 ≠ R$ 274,60") e o botão **"Salvar mesmo assim"**.
- O banco recalcula e grava `fuelings.values_conflict boolean` (gatilho), independentemente do app.
- Na **Conferência** do admin, abastecimentos com conflito aparecem em **🟠 laranja** com o aviso "Valores conflitantes", a foto e a conta.
- Abastecimentos pendentes **nunca bloqueiam** novos lançamentos; só impedem o fechamento da quinzena (como hoje).
- Motorista de **carro próprio** passa a ver o formulário de Abastecimento (aviso: "Usado para calcular a gasolina dos seus Transfers — não é reembolsado"). Não exige turno.

### 3.2 Uso nas contas
- **Reembolso de abastecimento**: só abastecimentos aprovados de motoristas de **carro da empresa** (`driver_type = 'company_car'` no momento do cálculo).
- **Preço do litro** usado na quinzena de um motorista, em ordem:
  1. média ponderada (Σ valor ÷ Σ litros) das notas **aprovadas** dele na quinzena;
  2. senão, `price_per_liter` da **última nota aprovada** dele com `fueled_on` ≤ fim da quinzena;
  3. senão, a **última nota aprovada da empresa** com `fueled_on` ≤ fim da quinzena;
  4. senão, 0 e o extrato marca `missing_fuel_price = true` (substitui `missing_reference_price`; aviso "Ainda não há nota de abastecimento aprovada para calcular a gasolina").
- Quando o caso 4 se aplica e o preço é necessário (Transfer de carro próprio com km > 0, ou km por fora > 0), o fechamento retorna `MISSING_FUEL_PRICE` e a tela pergunta: **"Não há nota de abastecimento aprovada para calcular a gasolina desta quinzena. A gasolina será calculada como R$ 0,00. Tem certeza que deseja fechar?"** Confirmando, fecha com `p_allow_missing_fuel_price = true` (parâmetro novo de `close_driver_period`). O extrato congelado guarda `missing_fuel_price = true`.
- Quinzenas **fechadas sem nota** exibem uma **❗ exclamação vermelha** ao lado do período em todas as listas de quinzenas do motorista (admin). É só uma marca histórica: não é lembrete, não conta nos sinais 🔴/🟡 e não bloqueia nada. Ao passar o dedo/mouse: "Fechada sem nota de abastecimento".
- Gasolina dos Transfers de carro próprio e desconto da gasolina por fora usam esse preço.

## 4. Balanço mensal (aba nova do admin)

Seletor de mês (padrão: mês atual). Todos os valores em reais, 2 casas.

### 4.1 Resultado do mês (competência — pela data de cada lançamento, mês em SP)
- **Faturamento**: Uber (Σ valor líquido), Transfer (Σ valor contratado de transfers concluídos/conferidos), BlaBlaCar (Σ valor), total.
- **Devido aos motoristas** no mês, por motorista e total, com as mesmas regras do extrato aplicadas aos lançamentos do mês:
  parte Uber + parte Transfer + reembolso de abastecimento + gasolina dos Transfers (carro próprio) + pedágios/estacionamentos aprovados − gasolina por fora (turnos iniciados no mês) + ajustes (pela `effective_date`).
  - Ajustes ganham `adjustments.effective_date date not null default` hoje (SP), editável pelo admin, dentro da quinzena do ajuste.
  - O preço do litro de cada parcela é o da quinzena do motorista a que o lançamento pertence (§3.2).
- **Combustível** (detalhe): reembolsos de abastecimento, gasolina dos Transfers de carro próprio, desconto da gasolina por fora (negativo).
- **Pedágios e estacionamentos** reembolsados.
- **Ajustes**: vales, multas, bônus, correções.
- **Gastos dos carros da empresa** (§4.6): manutenção, seguro e impostos lançados no mês, por carro e total.
- **Resultado da empresa** = Faturamento − Devido aos motoristas − Gastos dos carros da empresa.
- **Comparação** com o mês anterior: diferença em R$ e % do resultado.
- Selo **"estimado"** quando alguma quinzena com dias no mês ainda está aberta.

### 4.2 Caixa do mês
- Repasses com `paid_at` no mês: motorista, quinzena de referência, valor, data, forma, situação dos anexos (✅/⚪ comprovante, ✅/⚪ recibo assinado). Total pago.

### 4.3 A pagar (situação de hoje)
- Por motorista: quinzenas fechadas e não pagas (valor definitivo) + quinzena aberta atual (valor estimado, marcado "estimado"). Total.

### 4.4 Exportações e recibo
- **Planilha detalhada do mês** (CSV `;`, BOM, vírgula decimal): uma linha por corrida, abastecimento, pedágio/estacionamento, ajuste e pagamento do mês — data, motorista, CPF, código, tipo, plataforma/descrição, valor bruto, valor para o motorista, quinzena (dd/mm–dd/mm), situação.
- **Resumo** em CSV e em página de impressão/PDF.
- **Recibo de pagamento** (página de impressão/PDF) para cada repasse pago: "Passos Transfer — Recibo de pagamento", nome e CPF do motorista, código, período da quinzena, linhas do extrato, valor pago por extenso e em número, data e forma de pagamento, linha para assinatura do motorista.

### 4.6 Gastos dos carros da empresa
- Só para carros com propriedade **"Empresa"** (não para o carro próprio do motorista).
- Tabela `car_expenses(id, car_id, kind 'maintenance'|'insurance'|'tax', description, mode 'single'|'installments'|'recurring', amount numeric(10,2) > 0, installments int null, start_date date not null, end_date date null, finished boolean default false, created_at)`. Somente admin (RLS); motoristas não veem.
- Tipos: **Manutenção**, **Seguro** e **Imposto** — no Imposto, `description` é obrigatória e escrita livremente (ex.: "IPVA 2027", "Licenciamento"); nos demais é opcional.
- **Data de início** (`start_date`, obrigatória): o mês a partir do qual o gasto começa a contar no Resultado da empresa.
- **Forma de registro** (`mode`):
  - **Pontual** — o valor (`amount`) entra uma única vez, no mês da data de início.
  - **Parcelado** — informa-se o **valor cheio** (`amount`) e o **número de parcelas** (`installments` ≥ 2). Cada mês, a partir do mês da data de início, recebe `amount ÷ parcelas` arredondado a 2 casas; a **última parcela** absorve a diferença de centavos para que a soma feche exatamente o valor cheio. A tela mostra a prévia ("10× R$ 120,00").
  - **Recorrente** — o valor (`amount`) entra **todo mês**, a partir do mês da data de início, até o gasto ser **finalizado**. "Finalizar" pede o **último mês** que conta (padrão: mês atual) e grava `end_date`/`finished = true`; a partir do mês seguinte deixa de contar. Os meses anteriores continuam no histórico.
- **Excluir** não apaga o histórico: grava `deleted_on` (data de hoje, SP) e o gasto **deixa de contar a partir do mês da exclusão** (inclusive); os meses anteriores continuam registrados no Balanço e na planilha. Vale para as três formas (parcelas e repetições futuras somem; um pontual de mês futuro some). O gasto sai da lista de ativos do carro e aparece em "Excluídos" com a data. Confirmação: "Excluir este gasto? Ele deixa de contar a partir deste mês; os meses anteriores continuam registrados." (Coluna nova `deleted_on date null`.)
- Opcional: no cadastro do carro da empresa há a seção **"Gastos do carro (opcional)"**; o carro é salvo sem nenhum gasto. Na lista de Carros, cada carro da empresa tem **"Gastos"** para ver, adicionar, editar, finalizar e excluir a qualquer momento. A lista mostra a forma (Pontual / Parcela x de N / Recorrente – ativo ou finalizado em mm/aaaa).
- Cálculo do mês M (função `car_expenses_for_month(p_month)`): pontual se o mês da data de início = M; parcela *k* (0 ≤ k < N) quando mês(início) + k = M; recorrente quando mês(início) ≤ M e (não finalizado ou M ≤ mês(`end_date`)); em todos os casos, só se `deleted_on` é nulo ou M < mês(`deleted_on`).
- No Balanço, o bloco "Gastos dos carros da empresa" mostra os valores do mês por tipo e por carro (com "parcela 3/10" ou "recorrente") e entra no Resultado da empresa. A planilha detalhada inclui uma linha por gasto que conta no mês (carro/placa, tipo, descrição, forma, parcela, valor do mês).
- Gastos não dependem de quinzena e não aparecem para motoristas.

### 4.5 CPF
- `profiles.cpf text` obrigatório para motoristas (validação dos dígitos verificadores no app e no banco; único). Campo no cadastro e na edição do motorista; enviado na criação via `create-driver` (novo erro `INVALID_CPF` → "CPF inválido"; `CPF_TAKEN` → "CPF já cadastrado").

## 5. Documentos (somente admin)

- Tabela `admin_documents(id, driver_id, statement_id null, kind 'payment_proof'|'signed_receipt'|'other', description, file_path, mime_type, size_bytes, created_at, created_by)`.
- Bucket **privado** `admin-docs`; políticas de Storage e RLS da tabela: **somente admin** lê/escreve/exclui. Motoristas não têm nenhuma política (nem leitura).
- Arquivos aceitos: JPG, PNG, PDF até 10 MB. Caminho `{driver_id}/{uuid}.{ext}`.
- **No pagamento** (Quinzenas → motorista → repasse pago): "Anexar comprovante de pagamento" e "Anexar recibo assinado" (vários arquivos cada), listar, abrir (link assinado), excluir (com confirmação).
- **Ficha do motorista** (Motoristas → abrir → aba **Documentos**): todos os documentos do motorista agrupados por quinzena/data e "Adicionar documento" (`kind = 'other'`, descrição obrigatória).
- Nenhuma tela do motorista mostra documentos; o Extrato continua mostrando só "Pago em dd/mm (forma)".

## 6. Telas afetadas (resumo)

| Tela | Mudança |
|---|---|
| Motorista › Lançar | Abastecimento com preço do litro, conferência e "Salvar mesmo assim"; disponível para carro próprio |
| Motorista › Hoje | Lista "Lançamentos de hoje" inclui o preço do litro nos abastecimentos |
| Motorista › Extrato | Quinzena própria com datas e dias restantes; aviso de preço ausente |
| Admin › Início | Contadores 🔴/🟡; números passam a ser do mês atual (reaproveita o Balanço) |
| Admin › Motoristas | CPF no cadastro/edição; círculos; Pausar/Retomar com histórico; ficha com aba Documentos |
| Admin › Carros | Seção opcional "Gastos do carro" (manutenção, seguro, imposto) para carros da empresa |
| Admin › Conferência | Abastecimentos 🟠 com a conta |
| Admin › Quinzenas | Lista por motorista (quinzena atual, círculo, total, Fechar, Pagar, anexos, Recibo); sem preço de referência; quinzenas anteriores por motorista |
| Admin › Balanço mensal | Nova aba (§4) |

## 7. Testes

- **pgTAP**: cálculo do ciclo (virada de mês e ano, cadastro no dia 31, data anterior ao ciclo); fechamento individual e ordem (`PREVIOUS_OPEN`); bloqueio só da quinzena do motorista; `values_conflict` (dentro/fora da tolerância); preço do litro nas quatro situações; reembolso só para carro da empresa; `MISSING_FUEL_PRICE` e fechamento confirmado com a marca ❗; pausa (quinzena encurtada, `DRIVER_PAUSED`, retomada reinicia o ciclo na data de retorno); gastos de carro (pontual, parcelado com ajuste de centavos na última parcela, recorrente até finalizar) no Resultado e invisíveis ao motorista; sinais 🔴/🟡 (limites de 5 dias); balanço mensal com uma quinzena atravessando dois meses (setembro/outubro) nos três blocos; CPF válido/duplicado; `admin_documents` e bucket inacessíveis ao motorista.
- **Vitest**: formulário de abastecimento (conflito, "Salvar mesmo assim"), círculos, Balanço (blocos, comparação, exportações), recibo, Documentos, CPF.
- **Playwright**: fluxo completo atualizado (cadastro com CPF, abastecimento com preço, conflito, fechamento individual, pagamento com anexos, balanço do mês com o valor esperado).

## 8. Publicação
Migrações aplicadas no projeto Supabase **Passos Transfer** (`bfddyxquxvspsrlgljos`) e Edge Function `create-driver` atualizada **somente após confirmação do usuário**; código enviado ao GitHub (`RGMA26/Passos-Transfer`, `main`) com publicação automática na Vercel.

## 9. Adendo (2026-11-02, segunda rodada) — prevalece sobre as seções anteriores onde conflitar

### 9.1 Combustível por tipo e consumo opcional
- Carro ganha `fuel_type` ∈ {`gnv`, `diesel`, `gasolina`, `alcool`, `flex`, `eletrico`, `hibrido`} e consumos aproximados por combustível aplicável: `km_per_l_gasolina`, `km_per_l_alcool`, `km_per_l_diesel`, `km_per_m3_gnv`, `km_per_kwh` (flex → gasolina+álcool; híbrido → gasolina+elétrico; elétrico → kWh; gnv → m³; demais → o próprio). **Todos opcionais**; salvar sem consumo pergunta "Tem certeza que quer cadastrar sem o consumo? Sem ele, a gasolina por km não pode ser calculada." e permite.
- Abastecimento ganha `fuel` ∈ {`gasolina`, `alcool`, `diesel`, `gnv`, `eletrico`} (opções limitadas ao tipo do carro) e a unidade correspondente (L, L, L, m³, kWh); os campos passam a ser **valor total, quantidade, preço por unidade e comprovante** — a regra de conflito (§3.1) vale com "quantidade × preço por unidade".
- O cálculo passa a usar **custo por km**: para uma quinzena, `custo_km = Σ valor ÷ Σ (quantidade × consumo do carro para aquele combustível)` das notas aprovadas do motorista; reservas iguais às de §3.2 (última nota do motorista, depois da empresa), cada uma convertida pelo consumo do carro da nota. Gasolina por fora = km por fora × custo_km; gasolina do Transfer (carro próprio) = km do Transfer × custo_km.
- Se faltar o consumo do carro para o combustível de uma nota necessária, o extrato marca `missing_consumption = true` e o fechamento pede confirmação como em §3.2 ("Falta o consumo do carro para calcular a gasolina. A gasolina será calculada como R$ 0,00. Tem certeza que deseja fechar?"), com a mesma marca ❗ ("Fechada sem consumo/nota").

### 9.2 Comprovante obrigatório (foto ou PDF)
- Todo lançamento do motorista exige comprovante: corrida Uber/BlaBlaCar (print da corrida), abastecimento, pedágio e estacionamento. Aceita **foto ou PDF** (até 10 MB). O banco exige `receipt_path` não vazio.
- **Lançar** ganha **Pedágio** e **Estacionamento** (valor + comprovante + Transfer em andamento/concluído ao qual pertence — obrigatório escolher o Transfer; se não houver Transfer do motorista aberto, a opção mostra "Pedágio e estacionamento são lançados em um Transfer").
- **Compartilhar (Android):** o app instalado aparece no "Compartilhar" do celular (Web Share Target). Ao receber um arquivo, abre "O que é este comprovante?" com Abastecimento, Pedágio, Estacionamento, Corrida Uber, Corrida BlaBlaCar e leva ao formulário certo com o arquivo já anexado. No iPhone não é possível; lá o motorista anexa pelo botão.

### 9.3 Transfer: iniciar, em andamento, concluir, conferência única
- Status: `assigned` (Atribuída) → `in_progress` (Em andamento) → `completed` (Concluída, aguardando conferência) → `checked` (Conferida).
- **Iniciar** (ao pegar o cliente): leitura do odômetro + foto. **Concluir** (ao deixar o cliente): leitura do odômetro + foto. `km = odômetro final − odômetro inicial` (o motorista não digita km). Final < inicial → "O odômetro final não pode ser menor que o inicial".
- Carro da empresa: Iniciar exige turno aberto; a leitura inicial não pode ser menor que o último odômetro do carro.
- **Conferência única**: o admin vê, juntos, odômetros e fotos, km real, km estimado, pedágios/estacionamentos e comprovantes; **Aprovar** aprova o Transfer e todas as suas despesas; **Recusar** (com motivo) devolve o Transfer para `in_progress` com o motivo e as despesas pendentes, para o motorista corrigir e concluir de novo.
- **Origem e destino obrigatórios** (admin), em campos: rua e número, bairro, cidade, UF, CEP (CEP opcional; referência opcional). Ao salvar, o app calcula o **km estimado** pela rota (OpenStreetMap: Nominatim + OSRM, via Edge Function `estimate-route`, sem custo). Se não conseguir: "Não foi possível calcular o km estimado" e salva sem ele.
- Gasolina do Transfer (carro próprio) = km do odômetro × custo_km da quinzena (§9.1).

### 9.4 Odômetro
- Início de turno: leitura não pode ser menor que o **último odômetro registrado do carro** (maior valor entre turnos e Transfers daquele carro) → `ODOMETER_BELOW_LAST` "O odômetro não pode ser menor que o último registrado (X km)".

### 9.5 Início: central de pendências
- Bolinhas com quantidade: ⚪ itens aguardando conferência; 🟡 quinzenas terminando em até 5 dias; 🔴 quinzenas terminadas e não fechadas; 🟠 abastecimentos com valores conflitantes.
- Clicar: se houver 1 item, abre direto a pendência; se houver mais, abre `/admin/pendencias?tipo=…` com a lista, cada linha levando à pendência específica.

### 9.6 Outros
- Gastos dos carros: tipo **Outro** com descrição livre obrigatória.
- Ranking de km por fora: por motorista e por carro (Início e Balanço).
- Edição completa do motorista após o cadastro (nome, telefone, CPF, tipo, porcentagens, carro) e do vínculo carro↔motorista.
- BlaBlaCar: **sem mudanças** por enquanto (definição pendente com os sócios).
- Motorista de teste "Kaique" em produção: seus dados são apagados antes de aplicar as migrações novas.
