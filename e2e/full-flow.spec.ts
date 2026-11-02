import { expect, test } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Fluxo completo contra o backend real (Supabase local + seed recriado no globalSetup).
 *
 * Valores escolhidos (motorista novo, carro da empresa 10 km/l, Uber 40%, Transfer 30%):
 *   turno: odômetro 1000 → 1100 (km total 100)
 *   Uber online  R$ 100,00 / 30 km
 *   Uber OFFLINE R$  50,00 / 10 km   (passo 8: lançado sem rede, enviado ao voltar)
 *   abastecimento R$ 200,00 / 40 L (aprovado)  → preço médio 200 / 40 = R$ 5,00/L
 *   abastecimento R$  80,00 / 16 L (RECUSADO)  → não entra em nada; aparece em "Itens recusados"
 *   transfer R$ 300,00, concluído com 20 km + pedágio R$ 15,00 (aprovado)
 *
 * compute_statement:
 *   Parte Uber      = (100 + 50) × 40%           =  60,00
 *   Parte Transfer  = 300 × 30%                  =  90,00
 *   Reembolso abast.= 200,00 (só o aprovado)     = 200,00
 *   Gasolina Transf.= 0 (carro da empresa)       =   0,00
 *   Pedágio         = 15,00                      =  15,00
 *   Km em serviço   = 30 + 10 + 20 = 60; por fora = 100 − 60 = 40 km
 *   Desconto        = 40 km ÷ 10 km/l × R$ 5,00  = −20,00
 *   Ajustes         = 0
 *   TOTAL           = 60 + 90 + 200 + 15 − 20    = 345,00
 *
 * Ordem: o passo 8 (offline) acontece durante o turno do passo 3, porque depois do
 * passo 5 a quinzena atual está fechada e nada mais pode ser lançado nela. O transfer
 * (passo 4) é concluído antes de encerrar o turno, pois motorista de carro da empresa
 * só conclui transfer com turno aberto.
 */

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
const ODO = path.join(fixtures, 'odometro.jpg')
const RECIBO = path.join(fixtures, 'recibo.jpg')
const UBER = path.join(fixtures, 'uber.jpg')

/** "R$ 345,00" com o espaço não separável do Intl. */
const brl = (s: string) => new RegExp(`R\\$\\s${s}`)

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date())

/** Erros do navegador (console/exceções/HTTP >= 400) — o fluxo feliz não deve ter nenhum. */
const browserErrors: string[] = []
/** Mensagens de confirm()/alert() (todas aceitas). */
const dialogs: string[] = []

async function newPage(browser: Browser, who: string): Promise<Page> {
  const ctx = await browser.newContext()
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

test('fluxo completo: cadastro → turno → transfer → conferência → fechamento → pagamento (+ offline)', async ({
  browser,
}) => {
  const admin = await newPage(browser, 'admin')
  const driver = await newPage(browser, 'motorista')

  // ---------- 1. admin cadastra carro da empresa e motorista ----------
  await login(admin, 'admin@passostransfer.app', 'admin123')
  await expect(admin).toHaveURL(/\/admin$/)

  await admin.getByRole('link', { name: 'Carros' }).click()
  await admin.getByRole('button', { name: 'Novo carro' }).click()
  await admin.getByLabel('Modelo', { exact: true }).fill('Gol')
  await admin.getByLabel('Placa', { exact: true }).fill('PAS3C45')
  await admin.getByLabel('Consumo km/l').fill('10')
  await admin.getByLabel('Propriedade').selectOption('company')
  await admin.getByRole('button', { name: 'Criar carro' }).click()
  await expect(admin.getByRole('cell', { name: 'PAS3C45' })).toBeVisible()

  await admin.getByRole('link', { name: 'Motoristas' }).click()
  await admin.getByRole('button', { name: 'Novo motorista' }).click()
  await admin.getByLabel('Nome', { exact: true }).fill('Carlos Teste')
  await admin.getByLabel('Telefone').fill('(11) 98888-7777')
  await admin.getByLabel(/^Tipo/).selectOption('company_car')
  await admin.getByLabel('% Uber').fill('40')
  await admin.getByLabel('% Transfer').fill('30')
  await admin.getByLabel(/^Carro/).selectOption({ label: 'Gol PAS3C45' })
  await admin.getByRole('button', { name: 'Criar motorista' }).click()

  const access = admin.getByRole('region', { name: 'Acesso do motorista' })
  await expect(access).toContainText('Código: PASSOS03CARLOS')
  const pin = (await access.getByText(/^PIN: \d{6}$/).innerText()).replace('PIN: ', '')
  expect(pin).toMatch(/^\d{6}$/)

  // ---------- 2. motorista entra com o PIN e troca a senha ----------
  await login(driver, 'PASSOS03CARLOS', pin)
  await expect(driver).toHaveURL(/\/primeiro-acesso$/)
  await driver.getByLabel('Nova senha').fill('carlos123')
  await driver.getByLabel('Confirmar senha').fill('carlos123')
  await driver.getByRole('button', { name: 'Salvar senha' }).click()
  await expect(driver).toHaveURL(/\/m\/hoje$/)

  // ---------- 3. inicia o turno, lança Uber e abastecimentos ----------
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
  await driver.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(driver.getByText('Lançamento salvo')).toBeVisible()
  await expectQueueEmpty(driver)

  // ---------- 8. modo offline: Uber sem rede fica pendente e é enviado ao voltar ----------
  await driver.context().setOffline(true)
  await driver.getByLabel('Valor líquido').fill('50,00')
  await driver.getByLabel('Km', { exact: true }).fill('10')
  await driver.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(driver.locator('.sync-badge')).toContainText('1 pendente(s) de envio')
  await driver.context().setOffline(false)
  await expectQueueEmpty(driver)
  // a corrida aparece no resumo do dia, agora vinda do servidor
  await driver.getByRole('link', { name: 'Hoje' }).click()
  await expect(driver.getByText(/^Uber: R\$\s150,00$/)).toBeVisible()
  await expect(driver.getByText('Km em serviço: 40')).toBeVisible()

  await driver.getByRole('link', { name: 'Lançar' }).click()
  await driver.getByRole('button', { name: 'Abastecimento' }).click()
  await driver.getByLabel('Valor', { exact: true }).fill('200,00')
  await driver.getByLabel('Litros', { exact: true }).fill('40')
  await driver.getByLabel('Comprovante', { exact: true }).setInputFiles(RECIBO)
  await expect(driver.getByAltText('Pré-visualização')).toBeVisible()
  await driver.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(driver.getByText('Lançamento salvo')).toBeVisible()
  await expectQueueEmpty(driver)

  await driver.getByLabel('Valor', { exact: true }).fill('80,00')
  await driver.getByLabel('Litros', { exact: true }).fill('16')
  await driver.getByLabel('Comprovante', { exact: true }).setInputFiles(RECIBO)
  await expect(driver.getByAltText('Pré-visualização')).toBeVisible()
  await driver.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(driver.getByText('Lançamento salvo')).toBeVisible()
  await expectQueueEmpty(driver)

  // ---------- 4. admin cria o Transfer; motorista conclui com pedágio ----------
  await admin.getByRole('link', { name: 'Transfers' }).click()
  await admin.getByRole('button', { name: 'Novo transfer' }).click()
  await admin.getByLabel('Cliente').fill('Cliente E2E')
  await admin.getByLabel('Data', { exact: true }).fill(today)
  await admin.getByLabel('Horário').fill('10:00')
  await admin.getByLabel('Origem (opcional)').fill('Aeroporto')
  await admin.getByLabel('Destino (opcional)').fill('Centro')
  await admin.getByLabel('Valor contratado').fill('300,00')
  await admin.getByLabel(/^Motorista/).selectOption({ label: 'Carlos Teste' })
  await admin.getByRole('button', { name: 'Criar transfer' }).click()
  await expect(admin.getByRole('cell', { name: 'Cliente E2E' })).toBeVisible()

  await driver.getByRole('link', { name: 'Transfers' }).click()
  await driver.getByRole('button', { name: /Cliente E2E/ }).click()
  await driver.getByRole('button', { name: 'Adicionar pedágio' }).click()
  await driver.getByLabel('Valor', { exact: true }).fill('15,00')
  await driver.getByLabel('Foto do comprovante').setInputFiles(RECIBO)
  await expect(driver.getByAltText('Pré-visualização')).toBeVisible()
  await driver.getByRole('button', { name: 'Salvar despesa' }).click()
  await expectQueueEmpty(driver)
  await expect(driver.getByText(/Pedágio R\$\s15,00 – Aguardando conferência/)).toBeVisible()
  await driver.getByLabel('Km', { exact: true }).fill('20')
  await driver.getByRole('button', { name: 'Concluir' }).click()
  await expectQueueEmpty(driver)
  await expect(driver.locator('.badge', { hasText: 'Concluída' })).toBeVisible()

  // encerra o turno (fim do passo 3)
  await driver.getByRole('link', { name: 'Hoje' }).click()
  await expect(driver.getByText('Km em serviço: 60')).toBeVisible()
  await driver.getByLabel('Odômetro final', { exact: true }).fill('1100')
  await driver.getByLabel('Foto do odômetro final').setInputFiles(ODO)
  await driver.getByLabel('Print dos ganhos da Uber').setInputFiles(UBER)
  await expect(driver.getByAltText('Pré-visualização')).toHaveCount(2)
  await driver.getByRole('button', { name: 'Encerrar turno' }).click()
  await expect(driver.getByRole('heading', { name: 'Turno encerrado' })).toBeVisible()
  await expectQueueEmpty(driver)
  // resumo vindo do servidor (end_shift): 100 km total, 60 em serviço, 40 por fora.
  // O desconto fica 'a calcular': nenhum abastecimento aprovado ainda e sem preço de referência.
  const ended = driver.locator('dl.panel')
  await expect(ended).toContainText('Km total100Km em serviço60Km por fora40')
  await expect(ended).toContainText('Desconto da gasolinaa calcular')

  // ---------- 5. admin aprova tudo (recusa o 2º abastecimento), preço e fechamento ----------
  await admin.getByRole('link', { name: 'Conferência' }).click()
  const fuelings = admin.getByRole('region', { name: 'Abastecimentos' })
  const refused = fuelings.locator('.review-item', { hasText: '16 L' })
  await refused.getByRole('button', { name: 'Recusar' }).click()
  await refused.getByLabel('Motivo').fill('Comprovante ilegível')
  await refused.getByRole('button', { name: 'Confirmar recusa' }).click()
  await expect(fuelings.locator('.review-item', { hasText: '16 L' })).toHaveCount(0)

  for (let i = 0; i < 10; i++) {
    const approve = admin.getByRole('button', { name: 'Aprovar' })
    if ((await approve.count()) === 0) break
    const before = await approve.count()
    await approve.first().click()
    await expect(admin.getByRole('button', { name: 'Aprovar' })).toHaveCount(before - 1)
  }
  await expect(admin.getByText('Nada para conferir.')).toBeVisible()

  await admin.getByRole('link', { name: 'Quinzenas' }).click()
  await admin.getByLabel('Preço de referência do litro').fill('6,00')
  await admin.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(admin.getByText('Preço salvo')).toBeVisible()
  const row = admin.getByRole('row', { name: /Carlos Teste/ })
  await expect(row).toContainText(brl('345,00'))
  // a quinzena atual ainda não terminou: o servidor responde PERIOD_NOT_ENDED e o app
  // pede a segunda confirmação antes de fechar com p_force
  await admin.getByRole('button', { name: 'Fechar quinzena' }).click()
  await expect(admin.getByRole('button', { name: 'Fechar quinzena' })).toHaveCount(0)
  expect(dialogs).toContain('A quinzena ainda não terminou. Fechar mesmo assim?')
  await expect(row).toContainText('A pagar')
  await expect(row).toContainText(brl('345,00'))

  // ---------- 6. extrato do motorista: "Fechado" com o total esperado ----------
  await driver.getByRole('button', { name: 'Ok', exact: true }).click()
  await driver.getByRole('link', { name: 'Extrato' }).click()
  await expect(driver.getByRole('heading', { name: 'Quinzenas anteriores' })).toBeVisible()
  // listRejectedItems contra o banco real: o abastecimento recusado aparece com o motivo
  await expect(driver.getByText(/Abastecimento de .* \(R\$\s80,00\) – Recusado: Comprovante ilegível/)).toBeVisible()
  // listMyStatements contra o banco real: a quinzena fechada aparece
  const pastBtn = driver.locator('.panel > button[aria-expanded]')
  await expect(pastBtn).toHaveCount(1)
  await pastBtn.click()
  const closed = pastBtn.locator('xpath=..').locator('.statement')
  await expect(closed.locator('.badge')).toHaveText('Fechado')
  await expect(closed.locator('.stmt-row.total')).toContainText(brl('345,00'))
  await expect(closed).toContainText(brl('60,00')) // Parte Uber
  await expect(closed).toContainText(brl('90,00')) // Parte Transfer
  await expect(closed).toContainText(brl('200,00')) // abastecimento
  await expect(closed).toContainText(brl('15,00')) // pedágio
  await expect(closed).toContainText(/− R\$\s20,00/) // gasolina por fora

  // ---------- 7. admin marca como pago ----------
  await row.getByRole('button', { name: 'Ver extrato' }).click()
  await admin.getByRole('button', { name: 'Marcar como pago' }).click()
  await admin.getByLabel(/^Forma/).selectOption('Pix')
  await admin.getByRole('button', { name: 'Confirmar pagamento' }).click()
  await expect(row).toContainText('Pago em')

  // o motorista vê o pagamento
  await driver.reload()
  await driver.locator('.panel > button[aria-expanded]').click()
  await expect(driver.locator('.statement .badge', { hasText: /^Pago em .* \(Pix\)$/ })).toBeVisible()

  // nenhum erro do navegador, exceto as falhas de rede esperadas enquanto offline
  const unexpected = browserErrors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(e))
  expect(unexpected).toEqual([])
})
