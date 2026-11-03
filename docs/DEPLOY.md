# Como colocar o app Passos Transfer no ar

Este guia é para o dono da empresa. Siga os passos na ordem. Você vai precisar de:

- uma conta no **Supabase** (banco de dados, login e fotos) — https://supabase.com
- uma conta na **Vercel** (onde o site fica hospedado) — https://vercel.com
- o código do app no **GitHub**
- um computador com **Node.js** instalado (para rodar os comandos `npx`)

Onde aparecer `<algo entre sinais>`, troque pelo seu valor (sem os sinais `<` e `>`).

> **Versão da CLI do Supabase:** ela já vem fixada no projeto (`devDependencies` do `package.json`).
> Rode `npm install` uma vez na pasta do código; depois disso, todo `npx supabase ...` deste guia usa
> exatamente essa versão (a mesma usada nos testes), e não a mais nova da internet.

---

## 1. Criar o projeto no Supabase

1. Entre em https://supabase.com/dashboard e clique em **New project**.
2. Nome: `passos-transfer`. Região: **South America (São Paulo)**.
3. Crie uma senha forte para o banco e **guarde-a** (vai ser pedida no passo 2).
4. Espere o projeto ficar pronto (alguns minutos).
5. Anote o **Reference ID** do projeto: fica em **Project Settings → General** (algo como `abcdefghijklmnop`).

## 2. Ligar o código ao projeto e criar as tabelas

No computador, abra o terminal dentro da pasta do código e rode:

```bash
npm install
npx supabase login
npx supabase link --project-ref <reference-id>
npx supabase db push
```

- `login` abre o navegador para você autorizar.
- `link` pede a senha do banco criada no passo 1.
- `db push` cria todas as tabelas, regras de acesso, cálculos do extrato e a pasta privada de fotos.

## 3. Publicar as funções de cadastro de motorista

```bash
npx supabase functions deploy create-driver update-driver driver-access estimate-route
```

Essas funções criam e editam o motorista (com CPF), geram o PIN, resetam senha, desativam contas e calculam o km estimado dos Transfers pelo mapa (OpenStreetMap, sem custo).
Elas usam a chave secreta do Supabase **dentro do próprio Supabase** — você não precisa copiar essa chave para lugar nenhum.

## 4. Ajustar o login (Auth)

No painel do Supabase, vá em **Authentication → Sign In / Providers** (ou **Authentication → Settings**):

1. **Desligue** a opção **Allow new users to sign up** (cadastro público). As contas são criadas só pelo admin dentro do app.
2. Deixe o provedor **Email** ligado.
3. A confirmação de e-mail não importa: as contas de motorista já são criadas confirmadas pelo app.
4. **E-mails de login dos motoristas:** por baixo, o código `PASSOS01JOAO` vira o e-mail `passos01joao@login.passostransfer.app`. Esse domínio **não deve receber e-mail** de ninguém:
   - **não** configure SMTP próprio para mandar "recuperação de senha" aos motoristas — a senha deles é resetada pelo admin (menu **Motoristas → Resetar senha**);
   - se um dia quiser usar e-mail de verdade, troque o domínio por um que **a empresa controla** (ex.: `login.suaempresa.com.br`) antes de cadastrar motoristas, para nenhum terceiro conseguir receber links de acesso.

## 5. Criar o primeiro administrador

1. No painel do Supabase, vá em **Authentication → Users → Add user → Create new user**.
2. Informe o e-mail e a senha do admin (ex.: `admin@suaempresa.com.br`) e marque **Auto Confirm User**.
3. Abra o usuário criado e copie o **User UID** (um código longo como `1a2b3c4d-...`).
4. Vá em **SQL Editor → New query**, cole o comando abaixo (trocando os valores) e clique em **Run**:

```sql
insert into profiles (id, role, name, must_change_password, active)
values ('<user id>', 'admin', '<nome>', false, true);
```

Pronto: esse e-mail e senha entram no app como administrador.

## 6. Publicar o site na Vercel

1. Em https://vercel.com, clique em **Add New → Project** e importe o repositório do GitHub.
2. A Vercel reconhece o projeto como **Vite**. Não mude os comandos (build: `npm run build`, pasta: `dist`).
3. Em **Environment Variables**, cadastre as duas variáveis abaixo. Os valores ficam no Supabase em **Project Settings → API** (ou **Data API / API Keys**):

| Nome | Valor |
|---|---|
| `VITE_SUPABASE_URL` | o **Project URL**, ex.: `https://abcdefghijklmnop.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | a chave **anon / public** |

> **Nunca** coloque a chave `service_role` (secreta) na Vercel nem em nenhum lugar do site. Ela dá acesso total ao banco.

4. Clique em **Deploy**. Ao terminar, a Vercel mostra o endereço do app (ex.: `https://passos-transfer.vercel.app`).
5. O arquivo `vercel.json` do código já faz as páginas internas (ex.: `/m/hoje`, `/admin/quinzenas`) abrirem direto pelo endereço, sem erro 404.

Opcional: no Supabase, em **Authentication → URL Configuration**, coloque o endereço da Vercel em **Site URL**.

## 7. Instalar o app no celular

O app é uma PWA: instala direto pelo navegador, sem loja.

**Android (Chrome)**
1. Abra o endereço do app no **Chrome**.
2. Toque no menu **⋮** (canto superior direito) → **Instalar app** (em alguns aparelhos: **Adicionar à tela inicial**).
3. Confirme. O ícone **Passos** aparece junto com os outros apps.

**iPhone (Safari)**
1. Abra o endereço do app no **Safari** (precisa ser o Safari).
2. Toque em **Compartilhar** (quadrado com seta para cima).
3. Role e toque em **Adicionar à Tela de Início** → **Adicionar**.

Depois de instalado, o app abre em tela cheia. Lançamentos feitos sem internet ficam guardados no celular com o aviso "pendente de envio" e são enviados sozinhos quando a conexão voltar.
Atualizações do app chegam automaticamente: basta fechar e abrir o app.

### Teste no celular (antes de liberar para os motoristas)

Faça uma vez em um **Android** e uma vez em um **iPhone**, com um motorista de teste:

- [ ] Instalar o app pela tela inicial (passos acima) e entrar com o código e a senha.
- [ ] Iniciar um turno com a internet ligada.
- [ ] Ligar o **modo avião**.
- [ ] **Fechar o app de verdade** (tirar da lista de apps abertos).
- [ ] Abrir o app de novo, ainda no modo avião: ele deve abrir na aba **Hoje**, no turno aberto (sem pedir login).
- [ ] Lançar uma corrida Uber e um abastecimento com foto: aparece "pendente(s) de envio".
- [ ] Desligar o modo avião e abrir o app: o aviso some sozinho em até 1 minuto.
- [ ] No computador, como admin, conferir em **Conferência** que o abastecimento chegou com a foto.

## 8. Primeiro uso (checklist)

Entre como admin no computador e faça, nesta ordem:

- [ ] **Cadastrar os carros** (menu **Carros**): modelo, placa, combustível, consumo aproximado (km/l, km/m³ ou km/kWh) e se é da empresa ou do motorista. Nos carros da empresa, o botão **Gastos** guarda manutenção, seguro, impostos e outros gastos (eles entram no **Balanço mensal**).
- [ ] **Cadastrar os motoristas** (menu **Motoristas**): nome, telefone, CPF, tipo (carro da empresa ou próprio), % Uber e % Transfer do acordo de cada um, e o carro.
- [ ] **Enviar o código e o PIN** a cada motorista: logo após o cadastro aparecem o código (ex.: `PASSOS01JOAO`) e o PIN, com os botões **Copiar** e **Enviar por WhatsApp**. No primeiro acesso o motorista cria a própria senha.
- [ ] Pedir a cada motorista para **instalar o app** (passo 7) e entrar uma vez para conferir.

## Atualização: quinzena por motorista, Balanço mensal e Documentos (migrações 0010–0014)

Só para quem **já tem o app no ar** com a versão anterior. Faça uma vez, nesta ordem, no computador, dentro da pasta do código (já ligada ao projeto pelo passo 2):

1. **Backup:** no painel do Supabase, em **Database → Backups**, confira se há um backup recente.
2. **Motorista de teste:** os dados do motorista de teste (lançamentos, turnos, quinzenas) são apagados **antes** da atualização. Quem cuida disso é o responsável técnico, e só depois de você confirmar. Não há dados reais a migrar.
3. **Aplicar as mudanças no banco** (migrações `0010` a `0014`: quinzena de cada motorista, CPF, combustível e consumo, Transfer com Iniciar/Concluir, pausa, gastos dos carros, documentos e Balanço mensal):

   ```bash
   npx supabase db push
   ```

   O comando lista as migrações novas (`0010_driver_periods`, `0011_fuel`, `0012_transfer_flow`, `0013_driver_close`, `0014_balance_docs`) e pede confirmação. Responda `Y`.
4. **Publicar as funções novas e atualizadas:**

   ```bash
   npx supabase functions deploy create-driver update-driver estimate-route
   ```

5. **Conferir:** entre como admin e veja se aparecem o menu **Balanço mensal**, as bolinhas no **Início** e o campo **CPF** no cadastro de motorista. Depois, em **Motoristas → Editar**, preencha o **CPF** dos motoristas que já existiam.

## Fechamento da quinzena

- Cada motorista tem a **própria quinzena**: 15 dias contados a partir do cadastro dele. Em **Quinzenas**, abra o motorista e feche a quinzena dele. 🟡 avisa que ela termina em até 5 dias e 🔴 que já terminou e falta fechar (o **Início** mostra as mesmas bolinhas).
- O preço da gasolina vem das **notas de abastecimento** aprovadas na **Conferência** (não existe mais preço de referência). Se não houver nota, o app avisa antes de fechar.
- Feche a quinzena **1 a 2 dias depois de ela terminar** (ex.: a de 1–15 no dia 16 ou 17), **depois que os motoristas abrirem o app com internet** para enviar o que ficou pendente de envio. O que chegar depois do fechamento é recusado ("quinzena fechada").
- Se tentar fechar antes do último dia, o app pergunta "A quinzena ainda não terminou. Fechar mesmo assim?". Só confirme se tiver certeza de que não haverá mais lançamentos nela.
- Turnos recusados também impedem o fechamento ("Há turnos não aprovados"): o motorista corrige as corridas do turno e ele volta para a **Conferência**.

## Backup

O Supabase faz backup diário do banco nos planos pagos (**Database → Backups**). Recomenda-se o plano Pro para a empresa ter esse backup.
