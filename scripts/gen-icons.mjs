// Gera os ícones PNG da PWA a partir dos SVGs em public/icons (usa o Chromium do Playwright).
// Uso: node scripts/gen-icons.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const dir = new URL('../public/icons/', import.meta.url)
const jobs = [
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'icon-512.png', 512],
  ['maskable.svg', 'maskable-512.png', 512],
  ['maskable.svg', 'apple-touch-icon-180.png', 180],
]

const browser = await chromium.launch()
const page = await browser.newPage()
for (const [src, out, size] of jobs) {
  const svg = readFileSync(new URL(src, dir), 'utf8')
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<html><body style="margin:0;background:transparent">` +
      `<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${size}" height="${size}" style="display:block"></body></html>`,
  )
  await page.screenshot({ path: fileURLToPath(new URL(out, dir)), omitBackground: true })
  console.log(`ok ${out}`)
}
await browser.close()
