# Atualização pendente — leitura automática da nota de combustível com IA

**Status:** em espera (decidido em 2026-11-02 deixar para depois). Hoje o preço do litro é digitado pelo motorista e conferido pelo admin contra a foto da nota.

## Ideia
Ao anexar a foto do comprovante de abastecimento, o app lê com IA de visão (Claude, da Anthropic) o **valor total**, os **litros** e o **preço do litro** e preenche os campos sozinho. O motorista confere e confirma; se a leitura falhar, digita como hoje. Na conferência, o admin vê a foto ao lado dos valores lidos e dos valores confirmados.

## Como seria feito
- Uma Edge Function no Supabase recebe o caminho da foto, baixa do bucket privado e chama a API do Claude pedindo os três valores em formato estruturado.
- A chave da Anthropic fica como segredo do Supabase (nunca no app nem na Vercel).
- Os valores lidos são só sugestão: o lançamento continua com o mesmo fluxo de aprovação do admin.
- Sem internet: a leitura fica para quando a foto for enviada; o motorista pode digitar na hora.

## O que precisa para começar
- Conta paga na Anthropic e uma chave de API.
- Custo estimado: centavos por foto (poucos reais por mês com ~10 motoristas abastecendo diariamente).

## Riscos
- Notas térmicas apagadas, amassadas ou fotos tremidas → leitura errada; por isso a confirmação do motorista e a conferência do admin continuam obrigatórias.
