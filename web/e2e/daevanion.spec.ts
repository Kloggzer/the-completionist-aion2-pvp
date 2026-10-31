// Daevanion tab: optimizer without character data (this build has no plaync character lookup).
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { hasCache, openApp } from './host'

const FILE = path.join(import.meta.dirname, '..', 'public', 'daevanion.json')
test.skip(!hasCache() || !fs.existsSync(FILE), 'needs the app data cache and web/public/daevanion.json (tools/fetch_daevanion.py)')

const TABS = ['Übersicht', 'Ziele', 'Spots', 'Händler', 'Farmen', 'Erfolge', 'Checkliste', 'Build', 'Arkana', 'Bosse', 'Timer']
const tab = (page: Page) => page.locator('[data-tabs] button').nth(TABS.indexOf('Build'))

test('without character data: class, points and goal give a plan on the boards', async ({ page }) => {
  await openApp(page, { ui: { tab: 'dae' } })
  await expect(tab(page)).toHaveClass(/border-gold/)
  await expect(page.locator('[data-board="Nezekan"]')).toBeVisible()
  // points for the four boards: the plan uses them, the boards show new (gold) nodes
  const pve = page.locator('[data-points="pve"]')
  for (let i = 0; i < 3; i++) await pve.getByRole('button', { name: '+10', exact: true }).click()
  await expect(pve.locator('output')).toHaveText('30')
  await expect(page.locator('[data-result="pve"]')).toBeVisible()
  expect(await page.locator('[data-node="new"]').count()).toBeGreaterThan(5)
  await expect(page.getByText(/\/30 Punkte verplant/)).toBeVisible()
  // skill tiers: switching a core skill off changes nothing about the layout, but is saved per class
  const skill = page.locator('[data-skill="Ruinous Blow"]')
  await skill.getByRole('button', { name: 'Nie' }).click()
  await expect(skill.getByRole('button', { name: 'Nie' })).toHaveClass(/border-red/)
  await page.screenshot({ path: 'e2e/.out/shots/dae-respec.png', fullPage: true })
})
