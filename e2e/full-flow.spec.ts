import { expect, test } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { localAnonKey, localApiUrl } from '../playwright.config'

/**
 * Fluxo completo contra o backend real (Supabase local + Edge Functions; seed recriado no globalSetup).
 *
 * Cenário (motorista novo "Carlos Teste": carro da empresa Gol flex, gasolina 10 km/l, Uber 40%,
 * Transfer 30%). Ele é cadastrado hoje, então a quinzena dele vai de hoje a hoje+14 e o fechamento
 * usa o caminho "force" ("A quinzena ainda não terminou. Fechar mesmo assim?"). Tudo é lançado
 * hoje, então o Balanço é o do mês atual.
 *
 *   turno: odômetro 1000 → 1100 (km total 100)
 *   Uber online   R$ 100,00 / 30 km (comprovante JPG)
 *   Uber OFFLINE  R$  50,00 / 10 km (lançado sem rede, enviado ao voltar)
 *   abastecimento R$ 200,00 = 40 L × R$ 5,00 (nota em PDF) → aprovado
 *   abastecimento R$ 274,60 com 40 L × R$ 6,19 = R$ 247,60 → conflito, "Salvar mesmo assim" → RECUSADO
 *   transfer R$ 300,00: Iniciar com odômetro 1040, Concluir com 1060 → km = 1060 − 1040 = 20
 *   pedágio R$ 15,00 lançado pelo Lançar no Transfer (aprovado junto com o Transfer)
 *   gasto do carro: Seguro recorrente R$ 50,00 desde hoje
 *
 * Extrato (statement_lines):
 *   Parte Uber       = (100 + 50) × 40%                          =  60,00
 *   Parte Transfer   = 300 × 30%                                 =  90,00
 *   Reembolso abast. = 200,00 (o recusado não entra)             = 200,00
 *   Pedágio          = 15,00                                     =  15,00
 *   Custo por km     = 200 ÷ (40 L × 10 km/l) = 200 ÷ 400        =   0,50 R$/km
 *   Km em serviço    = 30 + 10 + 20 = 60; por fora = 100 − 60    =  40 km
 *   Gasolina por fora= 40 km × 0,50                              = −20,00
 *   TOTAL            = 60 + 90 + 200 + 15 − 20                   = 345,00
 *
 * Balanço do mês atual (o seed não tem lançamentos; mês anterior = 0):
 *   Faturamento      = Uber 100 + 50 = 150; Transfer 300; BlaBlaCar 0; total 450,00
 *   Devido           = 345,00 (só o Carlos)
 *   Gastos dos carros= Seguro recorrente 50,00
 *   Resultado        = 450 − 345 − 50                            =  55,00
 *   Comparação       = 55 − 0 = ▲ R$ 55,00 (sem % porque o mês anterior é 0)
 *   Caixa            = 345,00 pago hoje (comprovante ✅, recibo assinado ⚪)
 *   Recibo           = R$ 345,00 = "trezentos e quarenta e cinco reais"
 */

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
const ODO = path.join(fixtures, 'odometro.jpg')
const RECIBO = path.join(fixtures, 'recibo.jpg')
const UBER = path.join(fixtures, 'uber.jpg')
const NOTA_PDF = path.join(fixtures, 'nota-abastecimento.pdf')
const PAGAMENTO_PDF = path.join(fixtures, 'comprovante-pagamento.pdf')

/** "R$ 345,00" com o espaço não separável do Intl. */
const brl = (s: string) => new RegExp(`R\\$\\s${s}`)

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date())

const MSG_NOT_ENDED = 'A quinzena ainda não terminou. Fechar mesmo assim?'
const MSG_NO_ESTIMATE = 'Não foi possível calcular o km estimado'

/** Erros do navegador (console/exceções/HTTP >= 400) — o fluxo feliz não deve ter nenhum. */
const browserErrors: string[] = []
/** Mensagens de confirm()/alert() (todas aceitas). */
const dialogs: string[] = []

async function newPage(browser: Browser, who: string): Promise<Page> {
  const ctx = await browser.newContext()
  // a página de recibo chama window.print(): conta as chamadas em vez de abrir a impressão
  await ctx.addInitScript(() => {
    const w = window as unknown as { __prints: number; print: () => void }
    w.__prints = 0
    w.print = () => {
      w.__prints += 1
    }
  })
  const page = await ctx.newPage()
  page.on('dialog', (d) => {
    dialogs.push(d.message())
    void d.accept()
  })
  page.on('pageerror', (e) => browserErrors.push(`${who} pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') browserErrors.push(`${who} console: ${m.text()}`)
  })
  page.on('response', (r) => {
    if (r.status() >= 400) {
      browserErrors.push(`${who} HTTP ${r.status()} ${r.request().method()} ${r.url()}`)
    }
  })
  return page
}

async function login(page: Page, code: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Código de acesso').fill(code)
  await page.getByLabel('Senha', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar' }).click()
}

/** Espera a fila offline esvaziar (o badge some). */
async function expectQueueEmpty(page: Page) {
  await expect(page.locator('.sync-badge')).toHaveCount(0, { timeout: 30_000 })
}

test('fluxo completo: cadastro → turno → Transfer → conferência → fechamento → pagamento → balanço', async ({
  browser,
}) => {
  const admin = await newPage(browser, 'admin')
  const driver = await newPage(browser, 'motorista')

  // ---------- 1. admin: carro flex com consumo, gasto recorrente e motorista com CPF ----------
  await login(admin, 'admin@passostransfer.app', 'admin123')
  await expect(admin).toHaveURL(/\/admin$/)

  await admin.getByRole('link', { name: 'Carros' }).click()
  await admin.getByRole('button', { name: 'Novo carro' }).click()
  await admin.getByLabel('Modelo', { exact: true }).fill('Gol')
  await admin.getByLabel('Placa', { exact: true }).fill('PAS3C45')
  await admin.getByLabel(/^Combustível/).selectOption('flex')
  await admin.getByLabel('Consumo gasolina (km/l)').fill('10')
  await admin.getByLabel('Propriedade').selectOption('company')
  await admin.getByRole('button', { name: 'Criar carro' }).click()
  const carRow = admin.getByRole('row', { name: /PAS3C45/ })
  await expect(carRow).toContainText('10 km/l')

  // gasto recorrente do carro da empresa (entra no Resultado do mês)
  await carRow.getByRole('button', { name: 'Gastos' }).click()
  const gastos = admin.getByRole('region', { name: 'Gastos de Gol PAS3C45' })
  await expect(gastos.getByText('Nenhum gasto cadastrado.')).toBeVisible()
  await gastos.getByRole('button', { name: 'Adicionar gasto' }).click()
  await gastos.getByLabel('Tipo do gasto').selectOption('insurance')
  await gastos.getByLabel(/^Forma/).selectOption('recurring')
  await gastos.getByLabel('Valor', { exact: true }).fill('50,00')
  await expect(gastos.getByLabel('Data de início')).toHaveValue(today)
  await gastos.getByRole('button', { name: 'Salvar gasto' }).click()
  await expect(gastos).toContainText(/Seguro · R\$\s50,00 · Recorrente – ativo/)
  await gastos.getByRole('button', { name: 'Fechar gastos' }).click()

  await admin.getByRole('link', { name: 'Motoristas' }).click()
  await admin.getByRole('button', { name: 'Novo motorista' }).click()
  await admin.getByLabel('Nome', { exact: true }).fill('Carlos Teste')
  await admin.getByLabel('Telefone').fill('(11) 98888-7777')
  // CPF inválido é barrado no app
  await admin.getByLabel('CPF', { exact: true }).fill('123.456.789-00')
  await admin.getByLabel(/^Tipo/).selectOption('company_car')
  await admin.getByLabel('% Uber').fill('40')
  await admin.getByLabel('% Transfer').fill('30')
  await admin.getByLabel(/^Carro/).selectOption({ label: 'Gol PAS3C45' })
  await admin.getByRole('button', { name: 'Criar motorista' }).click()
  await expect(admin.getByText('CPF inválido')).toBeVisible()
  await admin.getByLabel('CPF', { exact: true }).fill('123.456.789-09')
  await admin.getByRole('button', { name: 'Criar motorista' }).click()

  const access = admin.getByRole('region', { name: 'Acesso do motorista' })
  await expect(access).toContainText('Código: PASSOS03CARLOS')
  const pin = (await access.getByText(/^PIN: \d{6}$/).innerText()).replace('PIN: ', '')
  expect(pin).toMatch(/^\d{6}$/)
  await expect(admin.getByRole('row', { name: /PASSOS03CARLOS/ })).toContainText('Gol PAS3C45')

  // ---------- 2. motorista entra com o PIN e troca a senha ----------
  await login(driver, 'PASSOS03CARLOS', pin)
  await expect(driver).toHaveURL(/\/primeiro-acesso$/)
  await driver.getByLabel('Nova senha').fill('carlos123')
  await driver.getByLabel('Confirmar senha').fill('carlos123')
  await driver.getByRole('button', { name: 'Salvar senha' }).click()
  await expect(driver).toHaveURL(/\/m\/hoje$/)

  // ---------- 3. turno, Uber com comprovante (online e offline) ----------
  await expect(driver.getByText('Gol – PAS3C45')).toBeVisible()
  await driver.getByLabel('Odômetro', { exact: true }).fill('1000')
  await driver.getByLabel('Foto do odômetro').setInputFiles(ODO)
  await expect(driver.getByAltText('Pré-visualização')).toBeVisible()
  await driver.getByRole('button', { name: 'Iniciar turno' }).click()
  await expect(driver.getByText('Resumo do dia')).toBeVisible()
  await expectQueueEmpty(driver)

  await driver.getByRole('link', { name: 'Lançar' }).click()
  await driver.getByRole('button', { name: 'Uber', exact: true }).click()
  await driver.getByLabel('Valor líquido').fill('100,00')
  await driver.getByLabel('Km', { exact: true }).fill('30')
  await driver.getByLabel('Comprovante', { exact: true }).setInputFiles(UBER)
  await expect(driver.getByAltText('Pré-visualização')).toBeVisible()
  await driver.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(driver.getByText('Lançamento salvo')).toBeVisible()
  await expectQueueEmpty(driver)

  // sem rede: fica pendente e é enviado ao voltar (com o comprovante guardado na fila)
  await driver.context().setOffline(true)
  await driver.getByLabel('Valor líquido').fill('50,00')
  await driver.getByLabel('Km', { exact: true }).fill('10')
  await driver.getByLabel('Comprovante', { exact: true }).setInputFiles(UBER)
  await expect(driver.getByAltText('Pré-visualização')).toBeVisible()
  await driver.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(driver.locator('.sync-badge')).toContainText('1 pendente(s) de envio')
  await driver.context().setOffline(false)
  await expectQueueEmpty(driver)

  // ---------- 4. abastecimentos: nota em PDF; depois conflito e "Salvar mesmo assim" ----------
  await driver.getByRole('button', { name: 'Abastecimento' }).click()
  await expect(driver.getByLabel(/^Combustível/)).toHaveValue('gasolina')
  await driver.getByLabel('Valor total').fill('200,00')
  await driver.getByLabel('Quantidade (L)').fill('40')
  await driver.getByLabel('Preço por L').fill('5,00')
  await driver.getByLabel('Comprovante', { exact: true }).setInputFiles(NOTA_PDF)
  await expect(driver.getByText('nota-abastecimento.pdf')).toBeVisible()
  await driver.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(driver.getByText('Lançamento salvo')).toBeVisible()
  await expectQueueEmpty(driver)

  await driver.getByLabel('Valor total').fill('274,60')
  await driver.getByLabel('Quantidade (L)').fill('40')
  await driver.getByLabel('Preço por L').fill('6,19')
  await driver.getByLabel('Comprovante', { exact: true }).setInputFiles(RECIBO)
  await expect(driver.getByAltText('Pré-visualização')).toBeVisible()
  await driver.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(driver.getByText('Valores conflitantes, confira a nota')).toBeVisible()
  // 40 × 6,19 = 247,60 ≠ 274,60
  await expect(driver.getByText(/^40 L × R\$\s6,19 = R\$\s247,60 ≠ R\$\s274,60$/)).toBeVisible()
  await driver.getByRole('button', { name: 'Salvar mesmo assim' }).click()
  await expect(driver.getByText('Lançamento salvo')).toBeVisible()
  await expectQueueEmpty(driver)

  // lançamentos de hoje vindos do servidor
  await driver.getByRole('link', { name: 'Hoje' }).click()
  const entries = driver.getByRole('region', { name: 'Lançamentos de hoje' })
  await expect(entries).toContainText(/Uber R\$\s100,00 · 30 km/)
  await expect(entries).toContainText(/Uber R\$\s50,00 · 10 km/)
  await expect(entries).toContainText(/Abastecimento R\$\s200,00 · Gasolina 40 L × R\$\s5,00/)
  await expect(entries).toContainText(/Abastecimento R\$\s274,60 · Gasolina 40 L × R\$\s6,19/)
  await expect(driver.getByText(/^Uber: R\$\s150,00$/)).toBeVisible()
  await expect(driver.getByText('Km em serviço: 40')).toBeVisible()

  // ---------- 5. admin cria o Transfer com endereço (km estimado ou aviso) ----------
  await admin.getByRole('link', { name: 'Transfers' }).click()
  await admin.getByRole('button', { name: 'Novo transfer' }).click()
  await admin.getByLabel('Cliente').fill('Cliente E2E')
  await admin.getByLabel('Data', { exact: true }).fill(today)
  await admin.getByLabel('Horário').fill('10:00')
  const origem = admin.getByRole('group', { name: 'Origem' })
  await origem.getByLabel('Rua e número').fill('Avenida Paulista, 1578')
  await origem.getByLabel('Bairro').fill('Bela Vista')
  await origem.getByLabel('Cidade').fill('São Paulo')
  await origem.getByLabel('UF').fill('sp')
  const destino = admin.getByRole('group', { name: 'Destino' })
  await destino.getByLabel('Rua e número').fill('Rua Augusta, 500')
  await destino.getByLabel('Bairro').fill('Consolação')
  await destino.getByLabel('Cidade').fill('São Paulo')
  await destino.getByLabel('UF').fill('SP')
  await admin.getByLabel('Valor contratado').fill('300,00')
  await admin.getByLabel(/^Motorista/).selectOption({ label: 'Carlos Teste' })
  await admin.getByRole('button', { name: 'Criar transfer' }).click()
  const transferRow = admin.getByRole('row', { name: /Cliente E2E/ })
  await expect(transferRow).toContainText('Atribuída')
  // estimate-route usa o OpenStreetMap (internet): vale o km calculado OU o aviso
  const estimateCell = transferRow.getByRole('cell').nth(4)
  if ((await admin.getByText(MSG_NO_ESTIMATE).count()) > 0) {
    await expect(estimateCell).toHaveText('—')
  } else {
    await expect(estimateCell).toHaveText(/^\d+(,\d)?$/)
  }

  // ---------- 6. motorista: Iniciar, pedágio pelo Lançar, Concluir ----------
  await driver.getByRole('link', { name: 'Transfers' }).click()
  await driver.getByRole('button', { name: /Cliente E2E/ }).click()
  await expect(driver.getByText('Avenida Paulista, 1578, Bela Vista, São Paulo/SP → Rua Augusta, 500, Consolação, São Paulo/SP')).toBeVisible()
  await driver.getByLabel('Odômetro inicial').fill('1040')
  await driver.getByLabel('Foto do odômetro').setInputFiles(ODO)
  await expect(driver.getByAltText('Pré-visualização')).toBeVisible()
  await driver.getByRole('button', { name: 'Iniciar', exact: true }).click()
  await expectQueueEmpty(driver)
  await expect(driver.locator('.badge', { hasText: 'Em andamento' })).toBeVisible()

  await driver.getByRole('link', { name: 'Lançar' }).click()
  await driver.getByRole('button', { name: 'Pedágio' }).click()
  await expect(driver.getByLabel(/^Transfer/)).toHaveValue(/.+/) // único Transfer aberto já escolhido
  await driver.getByLabel('Valor', { exact: true }).fill('15,00')
  await driver.getByLabel('Comprovante', { exact: true }).setInputFiles(RECIBO)
  await expect(driver.getByAltText('Pré-visualização')).toBeVisible()
  await driver.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(driver.getByText('Lançamento salvo')).toBeVisible()
  await expectQueueEmpty(driver)

  await driver.getByRole('link', { name: 'Transfers' }).click()
  await driver.getByRole('button', { name: /Cliente E2E/ }).click()
  await expect(driver.getByText(/Pedágio R\$\s15,00 – Aguardando conferência/)).toBeVisible()
  await expect(driver.getByText('Odômetro inicial: 1040')).toBeVisible()
  await driver.getByLabel('Odômetro final').fill('1060')
  await driver.getByLabel('Foto do odômetro').setInputFiles(ODO)
  await expect(driver.getByAltText('Pré-visualização')).toBeVisible()
  await driver.getByRole('button', { name: 'Concluir' }).click()
  await expectQueueEmpty(driver)
  await expect(driver.locator('.badge', { hasText: 'Aguardando conferência' })).toBeVisible()
  await expect(driver.getByText('Km: 20')).toBeVisible() // 1060 − 1040

  // encerra o turno
  await driver.getByRole('link', { name: 'Hoje' }).click()
  await expect(driver.getByText('Km em serviço: 60')).toBeVisible()
  await driver.getByLabel('Odômetro final', { exact: true }).fill('1100')
  await driver.getByLabel('Foto do odômetro final').setInputFiles(ODO)
  await driver.getByLabel('Print dos ganhos da Uber').setInputFiles(UBER)
  await expect(driver.getByAltText('Pré-visualização')).toHaveCount(2)
  await driver.getByRole('button', { name: 'Encerrar turno' }).click()
  await expect(driver.getByRole('heading', { name: 'Turno encerrado' })).toBeVisible()
  await expectQueueEmpty(driver)
  // 100 km total, 60 em serviço, 40 por fora; sem nota aprovada ainda → desconto "a calcular"
  const ended = driver.locator('dl.panel')
  await expect(ended).toContainText('Km total100Km em serviço60Km por fora40')
  await expect(ended).toContainText('Desconto da gasolinaa calcular')
  await driver.getByRole('button', { name: 'Ok', exact: true }).click()

  // ---------- 7. Início: a bolinha 🟠 leva direto à pendência (1 abastecimento conflitante) ----------
  await admin.getByRole('link', { name: 'Início' }).click()
  const dots = admin.getByLabel('Pendências')
  await expect(dots.getByRole('button', { name: '🟠 1' })).toBeVisible()
  // ⚪: abastecimento de 200, turno e Transfer concluído
  await expect(dots.getByRole('button', { name: '⚪ 3' })).toBeVisible()
  await dots.getByRole('button', { name: '🟠 1' }).click()
  await expect(admin).toHaveURL(/\/admin\/conferencia#item-[0-9a-f-]{36}$/)
  const itemId = new URL(admin.url()).hash.slice(1)
  const conflictItem = admin.locator(`#${itemId}`)
  await expect(conflictItem).toHaveClass(/conflict/)
  await expect(conflictItem).toContainText('🟠 Valores conflitantes')
  await expect(conflictItem).toContainText(/40 L × R\$\s6,19 = R\$\s247,60 ≠ R\$\s274,60/)

  // ---------- 8. conferência única: recusa o conflitante, aprova o resto ----------
  await conflictItem.getByRole('button', { name: 'Recusar' }).click()
  await conflictItem.getByLabel('Motivo').fill('Nota divergente')
  await conflictItem.getByRole('button', { name: 'Confirmar recusa' }).click()
  await expect(admin.locator(`#${itemId}`)).toHaveCount(0)

  // o Transfer aparece com odômetros, km real e o pedágio juntos
  const transferItem = admin.getByRole('region', { name: 'Transfers concluídos' }).locator('.review-item')
  await expect(transferItem).toContainText('Odômetro 1040 → 1060')
  await expect(transferItem).toContainText('Km real: 20')
  await expect(transferItem).toContainText(/Pedágio · R\$\s15,00/)
  await expect(transferItem.getByAltText('Comprovante do pedágio')).toBeVisible()
  // a nota em PDF vira link
  await expect(admin.getByRole('link', { name: 'Foto do abastecimento (PDF)' })).toBeVisible()

  for (let i = 0; i < 10; i++) {
    const approve = admin.getByRole('button', { name: 'Aprovar' })
    if ((await approve.count()) === 0) break
    const before = await approve.count()
    await approve.first().click()
    await expect(admin.getByRole('button', { name: 'Aprovar' })).toHaveCount(before - 1)
  }
  await expect(admin.getByText('Nada para conferir.')).toBeVisible()

  // ---------- 9. fechamento individual com force ----------
  await admin.getByRole('link', { name: 'Quinzenas' }).click()
  await expect(admin.getByLabel('Preço de referência do litro')).toHaveCount(0)
  const qRow = admin.getByRole('row', { name: /Carlos Teste/ })
  await expect(qRow).toContainText(brl('345,00'))
  await qRow.getByRole('button', { name: 'Abrir' }).click()
  await expect(admin.getByRole('heading', { name: /Quinzenas — Carlos Teste/ })).toBeVisible()
  await expect(admin.getByText(/· Aberta$/)).toHaveCount(1)
  await admin.getByRole('button', { name: 'Fechar quinzena' }).click()
  await expect(admin.getByRole('button', { name: 'Fechar quinzena' })).toHaveCount(0)
  await expect(admin.getByText(/· Fechada$/)).toBeVisible()
  expect(dialogs).toContain(MSG_NOT_ENDED)

  await admin.getByRole('button', { name: 'Ver extrato' }).click()
  await expect(admin.getByText(/^Total: R\$\s345,00$/)).toBeVisible()
  const stmt = admin.locator('.statement')
  await expect(stmt.locator('.badge')).toHaveText('Fechado')
  await expect(stmt).toContainText(brl('60,00')) // Parte Uber
  await expect(stmt).toContainText(brl('90,00')) // Parte Transfer
  await expect(stmt).toContainText(brl('200,00')) // abastecimento
  await expect(stmt).toContainText(brl('15,00')) // pedágio
  await expect(stmt).toContainText(/− R\$\s20,00/) // gasolina por fora

  // ---------- 10. pagamento com comprovante em PDF e recibo ----------
  await admin.getByRole('button', { name: 'Marcar como pago' }).click()
  await admin.getByLabel(/^Forma/).selectOption('Pix')
  await admin.getByRole('button', { name: 'Confirmar pagamento' }).click()
  await expect(stmt.locator('.badge')).toHaveText(/^Pago em .* \(Pix\)$/)

  const proof = admin.getByRole('region', { name: 'Comprovante de pagamento' })
  const signed = admin.getByRole('region', { name: 'Recibo assinado' })
  await expect(proof.getByRole('img', { name: 'Sem anexo' })).toBeVisible()
  await proof.getByLabel('Anexar comprovante de pagamento').setInputFiles(PAGAMENTO_PDF)
  await expect(proof.getByRole('img', { name: 'Anexado' })).toBeVisible()
  await expect(proof.getByRole('listitem')).toHaveCount(1)
  await expect(proof.getByRole('listitem')).toContainText(/\.pdf/)
  await expect(signed.getByRole('img', { name: 'Sem anexo' })).toBeVisible()

  await admin.getByRole('link', { name: 'Recibo' }).click()
  await expect(admin).toHaveURL(/\/admin\/recibo\/[0-9a-f-]{36}$/)
  await expect(admin.getByRole('heading', { name: 'Passos Transfer — Recibo de pagamento' })).toBeVisible()
  await expect(admin.getByText('Carlos Teste', { exact: true })).toBeVisible()
  await expect(admin.getByText('CPF: 123.456.789-09')).toBeVisible()
  await expect(admin.getByText('Código: PASSOS03CARLOS')).toBeVisible()
  await expect(admin.locator('.receipt-amount')).toHaveText(brl('345,00'))
  await expect(admin.getByText('(trezentos e quarenta e cinco reais)', { exact: false })).toBeVisible()
  await expect(admin.getByText('Forma de pagamento: Pix')).toBeVisible()
  await expect(admin.getByText('Assinatura do motorista')).toBeVisible()
  expect(await admin.evaluate(() => (window as unknown as { __prints: number }).__prints)).toBe(1)

  // ---------- 11. balanço do mês atual ----------
  await admin.getByRole('link', { name: 'Balanço mensal' }).click()
  const result = admin.getByRole('region', { name: 'Resultado do mês' })
  await expect(result).toContainText(/Uber: R\$\s150,00/)
  await expect(result).toContainText(/Transfer: R\$\s300,00/)
  await expect(result).toContainText(/BlaBlaCar: R\$\s0,00/)
  await expect(result).toContainText(/Total: R\$\s450,00/) // 150 + 300
  await expect(result).toContainText(/Total: R\$\s345,00/) // devido
  await expect(result).toContainText(/Carlos Teste — R\$\s345,00/)
  await expect(result).toContainText(/Reembolsos: R\$\s200,00/)
  await expect(result).toContainText(/Desconto da gasolina por fora: − R\$\s20,00/)
  await expect(result).toContainText(/Seguro: R\$\s50,00/)
  await expect(result).toContainText(/PAS3C45 Gol — Seguro — R\$\s50,00/)
  await expect(result.getByText('recorrente', { exact: true })).toBeVisible()
  await expect(result.locator('.big-number')).toHaveText(brl('55,00')) // 450 − 345 − 50
  await expect(result).toContainText(/▲ R\$\s55,00/) // mês anterior = 0
  await expect(admin.locator('.badge', { hasText: /^estimado$/ }).first()).toBeVisible()
  const cash = admin.getByRole('region', { name: 'Caixa do mês' })
  await expect(cash).toContainText(/Total pago: R\$\s345,00/)
  await expect(cash).toContainText(/Carlos Teste · quinzena .* · R\$\s345,00 · Comprovante ✅ · Recibo assinado ⚪/)

  // e o Início mostra os mesmos números do mês
  await admin.getByRole('link', { name: 'Início' }).click()
  await expect(admin.getByLabel('Pendências').getByRole('button', { name: '🟠 0' })).toBeDisabled()
  await expect(admin.locator('.panel', { hasText: 'Resultado da empresa' }).locator('.big-number')).toHaveText(
    brl('55,00'),
  )

  // ---------- 12. motorista: extrato pago, sem acesso a Documentos ----------
  await driver.getByRole('link', { name: 'Extrato' }).click()
  await expect(driver.getByRole('heading', { name: 'Quinzenas anteriores' })).toBeVisible()
  await expect(
    driver.getByText(/Abastecimento de .* \(R\$\s274,60\) – Recusado: Nota divergente/),
  ).toBeVisible()
  const pastBtn = driver.locator('.panel > button[aria-expanded]')
  await expect(pastBtn).toHaveCount(1)
  await pastBtn.click()
  const closed = pastBtn.locator('xpath=..').locator('.statement')
  await expect(closed.locator('.badge')).toHaveText(/^Pago em .* \(Pix\)$/)
  await expect(closed.locator('.stmt-row.total')).toContainText(brl('345,00'))
  await expect(driver.getByText(/comprovante-pagamento|Documentos/)).toHaveCount(0)

  // a área do admin redireciona o motorista
  await driver.goto('/admin/motoristas')
  await expect(driver).toHaveURL(/\/m\/hoje$/)

  // e a API não entrega documentos nem arquivos do admin ao motorista (RLS / Storage)
  const access_ = await driver.evaluate(
    async ({ api, anon }) => {
      const key = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k))
      const session = key ? (JSON.parse(localStorage.getItem(key) ?? '{}') as { access_token?: string; user?: { id: string } }) : {}
      const headers = { apikey: anon, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }
      const docs = await fetch(`${api}/rest/v1/admin_documents?select=id`, { headers }).then((r) => r.json())
      const files = await fetch(`${api}/storage/v1/object/list/admin-docs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ prefix: session.user?.id ?? '', limit: 100 }),
      }).then((r) => r.json())
      return { docs, files, hasToken: !!session.access_token }
    },
    { api: localApiUrl(), anon: localAnonKey() },
  )
  expect(access_.hasToken).toBe(true)
  expect(access_.docs).toEqual([])
  expect(access_.files).toEqual([])

  // nenhum erro do navegador, exceto as falhas de rede esperadas enquanto offline e a
  // estimate-route sem internet (o app mostra o aviso e salva sem km)
  const unexpected = browserErrors.filter(
    (e) => !/ERR_INTERNET_DISCONNECTED|Failed to fetch|functions\/v1\/estimate-route/.test(e),
  )
  expect(unexpected).toEqual([])
})
