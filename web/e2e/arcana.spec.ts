// Arcana tab: which skill rolls on which card, per class, with filters.
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { hasCache, openApp } from './host'

const PUB = path.join(import.meta.dirname, '..', 'public')
test.skip(!hasCache() || !fs.existsSync(path.join(PUB, 'arcana.json')) || !fs.existsSync(path.join(PUB, 'daevanion.json')), 'needs web/public/arcana.json + daevanion.json')

test('class skills with their card, card blocks, drops and the filters', async ({ page }) => {
  await openApp(page, { ui: { tab: 'arc', dae: { cls: '3' } } })
  // the lists sit behind a disclosure, the advice comes first
  await expect(page.locator('[data-arc-skill]')).toHaveCount(0)
  await page.locator('[data-disclosure="arc.all"] button').first().click()
  await expect(page.locator('[data-arc-skill]')).toHaveCount(22)
  const dead = page.locator('[data-arc-skill="Deadshot"]')
  await expect(dead).toContainText('Zielpfeil')
  await expect(dead.locator('[data-kind]')).toHaveText(/Pergament|Kompass/)
  // the guide's core skill comes first
  await expect(page.locator('[data-arc-skill]').first()).toHaveClass(/gap-1.5/)
  await expect(page.locator('[data-card]')).toHaveCount(5)
  await expect(page.locator('[data-drops]')).toHaveCount(2)
  // card filter: only the Bell's passives
  await page.locator('[data-kind-filter="Bell"]').click()
  await expect(page.locator('[data-card]')).toHaveCount(1)
  const n = await page.locator('[data-arc-skill]').count()
  expect(n).toBe(5)
  // guide filter: only core / good skills
  await page.locator('[data-kind-filter="all"]').click()
  await page.locator('[data-guide-filter]').click()
  const g = await page.locator('[data-arc-skill]').count()
  expect(g).toBeGreaterThan(5)
  expect(g).toBeLessThan(22)
  await expect(page.locator('[data-arc-skill="Defiance"]')).toHaveCount(0)
  // the filters sit in the disclosure's header; on the overlay they wrap below its title
  await page.setViewportSize({ width: 360, height: 700 })
  await page.locator('[data-disclosure="arc.all"] > div').first().evaluate(el => el.scrollIntoView({ block: 'center' }))
  await page.screenshot({ path: 'e2e/.out/shots/arcana-filters-360.png' })
})

test('advice: best dungeon stage, the cards, farm list and Transmute', async ({ page }) => {
  await openApp(page, { ui: { tab: 'arc', dae: { cls: '2' } } })
  await expect(page.locator('[data-arc-best]')).toContainText(/Deus Research Base|Shattered Arkanis/)
  await expect(page.locator('[data-arc-chalice]')).toHaveCount(1)
  await expect(page.locator('[data-arc-slot]')).toHaveCount(5)
  await expect(page.locator('[data-farm]')).toHaveCount(4)
  await page.locator('[data-more="arc.farm"]').click()
  await expect(page.locator('[data-farm]')).toHaveCount(8)
  await expect(page.locator('[data-tm]')).toHaveCount(4)
})
