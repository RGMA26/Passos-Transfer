# App Passos Transfer — Controle de Corridas e Repasse

**Data:** 2026-10-29
**Status:** aguardando revisão

## 1. Objetivo

Todo o faturamento dos motoristas (Uber, Transfer, BlaBlaCar) é recebido pela Passos Transfer, que repassa a parte de cada motorista a cada quinzena. O app existe para:

1. O motorista registrar, em tempo real, corridas, km, abastecimentos e despesas (pedágio/estacionamento).
2. Separar com precisão o combustível gasto **em serviço** do gasto **por fora** (uso fora das corridas), que é descontado do repasse.
3. Gerar o extrato quinzenal de repasse de cada motorista, com transparência para os dois lados.

**Sucesso significa:** o admin fecha a quinzena e paga cada motorista usando apenas o app, sem planilhas paralelas, e o motorista consegue conferir cada valor do extrato.

## 2. Perfis de usuário

| Perfil | Pode |
|---|---|
| **Admin** (empresa) | Cadastrar motoristas e carros, lançar corridas Transfer, conferir comprovantes, definir preço de referência do litro, lançar ajustes, fechar quinzena, marcar pagamento, exportar relatórios. |
| **Motorista** | Ver e registrar apenas os próprios dados. |

### Tipos de motorista

- **Carro da empresa:** faz Uber, Transfer e BlaBlaCar. Usa turnos com odômetro.
- **Carro próprio:** faz apenas Transfer. Não usa turnos.

## 3. Regras de negócio

### 3.1 Divisão de valores

- **Uber:** o motorista recebe **% Uber** sobre o valor líquido da corrida.
- **Transfer:** o motorista recebe **% Transfer** sobre o valor contratado. Pedágio e estacionamento são cobrados à parte do cliente e reembolsados ao motorista mediante comprovante.
- **BlaBlaCar:** sem divisão, o valor fica com a empresa e cobre o custo do percurso. O km conta como km em serviço.
- As porcentagens **não têm valor padrão**: são obrigatórias no cadastro de cada motorista, conforme o acordo individual (referência atual: Uber 40%, Transfer 30%).
- A porcentagem vigente é **gravada em cada corrida** no momento do lançamento. Alterar a porcentagem do motorista vale apenas para corridas novas; o app pede confirmação e registra no histórico.

### 3.2 Combustível

- **Carro da empresa:** o motorista paga o abastecimento do próprio bolso, anexa o comprovante e é reembolsado no repasse (se o comprovante for aprovado).
- **Carro próprio:** a empresa paga a gasolina das corridas Transfer, calculada por `km da corrida ÷ consumo do carro × preço de referência do litro`.
- **Gasolina por fora** (só carro da empresa) é descontada do repasse:
  - `km total do turno = odômetro final − odômetro inicial`
  - `km em serviço = soma do km das corridas do turno (Uber + BlaBlaCar + Transfer)`
  - `km por fora = km total − km em serviço` (se negativo, considera 0 e gera alerta)
  - `desconto = km por fora ÷ consumo do carro × preço médio do litro da quinzena`
  - Preço médio do litro = soma dos valores ÷ soma dos litros dos abastecimentos aprovados do motorista na quinzena. Sem abastecimentos, usa o preço de referência.
- O consumo (km/l) do carro é **gravado no turno** (carro da empresa) ou **na corrida** (carro próprio), para que mudanças no cadastro do carro não alterem o passado.

### 3.3 Quinzena

- Períodos fixos: **dia 1 a 15** e **dia 16 ao último dia do mês**.
- Status: `aberta → fechada → paga` (o pagamento é marcado por motorista).
- Corridas, turnos e abastecimentos pertencem à quinzena pela data em que ocorreram. Turno pertence à quinzena da data de início.
- Só é possível fechar se não houver turnos abertos nem itens pendentes de conferência no período.
- No fechamento, os extratos são calculados e **congelados**; nenhum dado do período pode ser editado por ninguém (bloqueio no banco).

### 3.4 Extrato do motorista

| Item | Cálculo |
|---|---|
| Parte Uber | Σ (valor líquido × % gravada) |
| Parte Transfer | Σ (valor contratado × % gravada) |
| Reembolso de abastecimento | Σ abastecimentos aprovados (carro da empresa) |
| Reembolso de gasolina Transfer | Σ (km ÷ consumo gravado × preço de referência) (carro próprio) |
| Reembolso de pedágio/estacionamento | Σ comprovantes aprovados |
| Desconto de gasolina por fora | conforme 3.2 |
| Ajustes manuais | + bônus / − vales, multas, correções (com descrição) |
| **A repassar** | soma das linhas |

- Valores em reais, arredondados para 2 casas no total de cada linha.
- Durante a quinzena, o motorista vê o extrato como **"a receber (estimado)"**; itens ainda não conferidos aparecem como "aguardando conferência" e não entram no total estimado.
- Itens recusados aparecem com o motivo.

### 3.5 Login e cadastro

- O admin cadastra o motorista; o app gera o código de login: `PASSOS` + número sequencial com 2 dígitos (3 a partir de 100) + primeiro nome em maiúsculas, sem acentos e espaços. Ex.: `PASSOS01JOAO`, `PASSOS02MARIA`.
- O número nunca é reaproveitado, mesmo se o motorista for desativado.
- No primeiro acesso o motorista define a senha (mínimo 6 caracteres). O admin pode resetar a senha.
- Motorista desativado não consegue entrar; o histórico é mantido.

## 4. Dados

| Entidade | Campos principais |
|---|---|
| **Motorista** | código de login, nome, telefone, tipo (próprio/empresa), % Uber, % Transfer, carro atual, ativo |
| **Carro** | modelo, placa, consumo médio (km/l), propriedade (próprio/empresa), motorista atual |
| **Turno** | motorista, carro, consumo gravado, início/fim, odômetro inicial + foto, odômetro final + foto, print dos ganhos Uber (opcional, exigido se houve Uber no turno) |
| **Corrida** | motorista, turno (se houver), plataforma, data, valor, km, % gravada, status |
| **Detalhe Transfer** | cliente, data/hora, origem/destino (opcional), valor contratado, consumo gravado (carro próprio), status `atribuída → concluída → conferida` |
| **Despesa Transfer** | corrida, tipo (pedágio/estacionamento), valor, foto, status de conferência, motivo de recusa |
| **Abastecimento** | motorista, carro, data, valor, litros, foto, status de conferência, motivo de recusa |
| **Quinzena** | início, fim, status, preço de referência do litro |
| **Ajuste** | motorista, quinzena, tipo (vale/multa/bônus/correção), valor, descrição |
| **Extrato** | motorista, quinzena, linhas congeladas, total, status de pagamento, data e forma de pagamento |
| **Histórico** | quem, quando, o quê (entidade, ação, valores antes/depois) |

## 5. App do motorista (celular)

Quatro abas fixas, botões grandes, uso com uma mão.

1. **Hoje**
   - Carro da empresa sem turno: botão **Iniciar turno** (odômetro + foto, confirma o carro).
   - Com turno aberto: resumo do dia (faturamento por plataforma, km em serviço, abastecido) e botão **Encerrar turno** (odômetro final + foto + print Uber se houve Uber). Ao encerrar mostra km total, em serviço, por fora e o desconto em R$.
   - Carro próprio: lista de Transfers pendentes.
2. **Lançar (+)**: Uber (valor líquido, km), BlaBlaCar (valor, km), Abastecimento (valor, litros, foto). Uber e BlaBlaCar só aparecem para carro da empresa e exigem turno aberto.
3. **Transfers**: corridas atribuídas pelo admin; o motorista informa km, adiciona pedágio/estacionamento com foto e toca **Concluir**.
4. **Extrato**: quinzena atual (estimado) e quinzenas anteriores (fechado, pago/pendente).

**Regras**
- Edição e exclusão dos próprios lançamentos enquanto a quinzena está aberta e o item não foi conferido; tudo vai para o histórico.
- **Offline:** lançamentos e fotos ficam salvos no aparelho com o aviso "pendente de envio" e são enviados automaticamente quando houver conexão.
- Bloqueia iniciar turno com outro aberto; bloqueia odômetro final menor que o inicial.

## 6. Painel do admin (computador, responsivo)

1. **Motoristas**: cadastrar (porcentagens em branco e obrigatórias), gerar código com botão "copiar/enviar por WhatsApp", resetar senha, desativar, alterar porcentagens (com confirmação).
2. **Carros**: cadastro e vínculo com motorista.
3. **Transfers**: criar e atribuir corrida; acompanhar status.
4. **Conferência**: fila de abastecimentos, pedágios/estacionamentos, fotos de odômetro e prints Uber, com **Aprovar / Recusar (motivo)**. Alertas automáticos:
   - km por fora acima de 20% do km total do turno;
   - km por fora negativo (km lançado maior que o rodado);
   - turno não encerrado após 24 h.
5. **Quinzenas e extratos**: valor a repassar por motorista, ajustes manuais, preço de referência do litro, **Fechar quinzena**, **Marcar como pago** (data e forma), exportar extrato em PDF e resumo geral em CSV/Excel.

**Página inicial**: faturamento da quinzena por plataforma, parte da empresa × motoristas, total de gasolina reembolsada e descontada, ranking de km por fora.

## 7. Arquitetura técnica

- **Frontend:** PWA em React + TypeScript (Vite), instalável em Android e iPhone; o mesmo app serve motorista e admin, com telas conforme o perfil. Hospedagem em Vercel.
- **Backend:** Supabase
  - Postgres para os dados e cálculos;
  - Auth para login (o código de login é mapeado internamente para um e-mail técnico, ex.: `passos01joao@login.passostransfer.app`);
  - Storage privado para fotos;
  - Row Level Security: motorista acessa só as próprias linhas; admin acessa tudo;
  - Funções no banco para gerar código de login, calcular extrato e fechar quinzena (cálculo em um só lugar, usado tanto pelo estimado quanto pelo fechamento);
  - Gatilho de bloqueio para edição em quinzena fechada e gatilho de histórico.
- **Offline:** service worker + fila local (IndexedDB) para lançamentos e fotos.
- **Fotos:** comprimidas no celular antes do envio.
- **Backup:** backup diário do Supabase.

## 8. Testes

- **Cálculo do extrato (automatizado, prioridade máxima):** km por fora negativo, mudança de porcentagem no meio da quinzena, comprovante recusado, quinzena sem abastecimento, carro próprio com preço de referência, ajustes positivos e negativos, arredondamento.
- **Regras de acesso:** motorista A não lê nem altera dados do motorista B; motorista não acessa funções de admin; nada é editável em quinzena fechada.
- **Fluxo completo:** cadastrar motorista → primeiro acesso → turno → corridas → abastecimento → conferência → fechamento → extrato → pagamento.
- **Celular real:** Android e iPhone, instalação da PWA, uso sem internet e sincronização posterior.

## 9. Fora do escopo (por enquanto)

- Rastreamento por GPS.
- Controle de manutenção dos carros.
- Integração automática com Uber ou BlaBlaCar.
- Publicação nas lojas de aplicativos.
