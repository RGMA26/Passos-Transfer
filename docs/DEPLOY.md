# Como colocar o app Passos Transfer no ar

Este guia é para o dono da empresa. Siga os passos na ordem. Você vai precisar de:

- uma conta no **Supabase** (banco de dados, login e fotos) — https://supabase.com
- uma conta na **Vercel** (onde o site fica hospedado) — https://vercel.com
- o código do app no **GitHub**
- um computador com **Node.js** instalado (para rodar os comandos `npx`)

Onde aparecer `<algo entre sinais>`, troque pelo seu valor (sem os sinais `<` e `>`).

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
npx supabase login
npx supabase link --project-ref <reference-id>
npx supabase db push
```

- `login` abre o navegador para você autorizar.
- `link` pede a senha do banco criada no passo 1.
- `db push` cria todas as tabelas, regras de acesso, cálculos do extrato e a pasta privada de fotos.

## 3. Publicar as funções de cadastro de motorista

```bash
npx supabase functions deploy create-driver driver-access
```

Essas funções criam o login do motorista, geram o PIN, resetam senha e desativam contas.
Elas usam a chave secreta do Supabase **dentro do próprio Supabase** — você não precisa copiar essa chave para lugar nenhum.

## 4. Ajustar o login (Auth)

No painel do Supabase, vá em **Authentication → Sign In / Providers** (ou **Authentication → Settings**):

1. **Desligue** a opção **Allow new users to sign up** (cadastro público). As contas são criadas só pelo admin dentro do app.
2. Deixe o provedor **Email** ligado.
3. A confirmação de e-mail não importa: as contas de motorista já são criadas confirmadas pelo app.

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

## 8. Primeiro uso (checklist)

Entre como admin no computador e faça, nesta ordem:

- [ ] **Cadastrar os carros** (menu **Carros**): modelo, placa, consumo médio (km/l) e se é da empresa ou do motorista.
- [ ] **Cadastrar os motoristas** (menu **Motoristas**): nome, telefone, tipo (carro da empresa ou próprio), % Uber e % Transfer do acordo de cada um, e o carro.
- [ ] **Enviar o código e o PIN** a cada motorista: logo após o cadastro aparecem o código (ex.: `PASSOS01JOAO`) e o PIN, com os botões **Copiar** e **Enviar por WhatsApp**. No primeiro acesso o motorista cria a própria senha.
- [ ] **Definir o preço de referência do litro** na quinzena atual (menu **Quinzenas**). Ele é usado na gasolina dos motoristas de carro próprio e quando não houver abastecimento na quinzena. Sem ele a quinzena não fecha.
- [ ] Pedir a cada motorista para **instalar o app** (passo 7) e entrar uma vez para conferir.

## Backup

O Supabase faz backup diário do banco nos planos pagos (**Database → Backups**). Recomenda-se o plano Pro para a empresa ter esse backup.
