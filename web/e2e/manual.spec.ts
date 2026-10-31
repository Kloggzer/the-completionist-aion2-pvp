// Manual mode (v1.1, no Npcap): onboarding, pets / achievements / characters by hand, live features off.
import { expect, test, type Page } from '@playwright/test'
import { emptyState, hasCache, openApp, type HostOpts } from './host'

test.skip(!hasCache(), 'needs the app data cache in %LOCALAPPDATA%\\TheCompletionist\\cache (start the app once)')

const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/.out/shots/${name}.png` })
const MANUAL: HostOpts = { settings: { mode: 'manual' }, state: emptyState(), status: { state: 'manual', text: 'Manueller Modus' } }
const manual = (page: Page, ui: Record<string, unknown> = {}, o: HostOpts = {}) => openApp(page, { ...MANUAL, ...o, ui })

test('first start without Npcap: welcome card, manual mode chosen', async ({ page }) => {
  const app = await openApp(page, { settings: { npcap: false }, ui: { welcomed: 0 }, state: emptyState(), status: { state: 'manual', text: '' } })
  const card = page.locator('[data-welcome]')
  await expect(card).toBeVisible()
  await expect(card.locator('[data-mode="auto"] button')).toBeDisabled() // automatic needs Npcap
  await expect(card.getByRole('link', { name: 'npcap.com' })).toHaveAttribute('href', /npcap\.com/)
  await shot(page, 'manual-welcome')
  await card.locator('[data-mode="manual"] button').click()
  await expect(card).toHaveCount(0)
  expect(await app.posted('mode')).toEqual([{ type: 'mode', mode: 'manual' }])
  await expect(page.locator('header [data-status="manual"]')).toHaveText('Manuell')
  await expect(page.locator('[data-npcap-notice]')).toHaveCount(0) // the welcome card said it already
})

test('Npcap missing after an update: one-time notice instead of an error', async ({ page }) => {
  await openApp(page, { settings: { npcap: false }, status: { state: 'manual', text: '' } })
  const note = page.locator('[data-npcap-notice]')
  await expect(note).toContainText('manuellen Modus')
  await expect(page.locator('header [data-status="manual"]')).toBeVisible()
  await note.getByRole('button', { name: 'Verstanden' }).click()
  await expect(note).toHaveCount(0)
})

test('auto mode stays uncluttered: no manual controls', async ({ page }) => {
  await openApp(page, { ui: { tab: 'targets', view: 'list' } })
  await expect(page.locator('[data-pet]').first()).toBeVisible()
  await expect(page.locator('[data-manual]')).toHaveCount(0)
  await expect(page.locator('[data-radar-off]')).toHaveCount(0)
})

test('pets: +1 soul on the tile, unlock at 5', async ({ page }) => {
  const app = await manual(page, { tab: 'targets', view: 'list' })
  await expect(page.getByText('Manueller Modus:')).toBeVisible()
  const first = page.locator('[data-pet]').first(), id = await first.getAttribute('data-pet')
  const tile = page.locator(`[data-pet="${id}"]`)
  await tile.locator('[data-add-soul]').click()
  await expect(tile).toContainText('1/5')
  expect(await app.posted('addSoul')).toEqual([{ type: 'addSoul', id: +id!, n: 1 }])
  await expect(page.getByText('Manueller Modus:')).toHaveCount(0) // hint gone once something is entered
  for (let i = 0; i < 4; i++) await tile.locator('[data-add-soul]').click()
  await expect(tile).toContainText('Lv1')
  await expect(tile).toContainText('0/25')
  await expect(page.locator('[data-toasts]').first()).toContainText('freigeschaltet')
  await expect(page.locator('[data-pin]')).toHaveCount(0) // the buttons do not select the tile
  await shot(page, 'manual-pets')
})

test('pets: level and souls in the popover', async ({ page }) => {
  const app = await manual(page, { tab: 'targets', view: 'list', showLv3: true })
  const id = await page.locator('[data-pet]').first().getAttribute('data-pet')
  const tile = page.locator(`[data-pet="${id}"]`)
  await tile.locator('[data-pet-edit]').click()
  const pop = page.locator('[data-slot="popover-content"]')
  await expect(pop).toBeVisible()
  await pop.locator('[data-tip="+1"]').first().click() // level 0 -> 1
  await expect(tile).toContainText('Lv1')
  await pop.locator('[data-tip="+1"]').nth(1).click() // one soul (counted by the host)
  await expect(pop).toContainText('1/25')
  await shot(page, 'manual-pet-popover')
  await pop.getByRole('button', { name: 'Lv3 – komplett' }).click()
  await expect(tile).toContainText('✓')
  const sets = await app.posted('setPet')
  expect(sets[0]).toEqual({ type: 'setPet', id: +id!, level: 1, souls: 0 })
  expect(sets.at(-1)).toEqual({ type: 'setPet', id: +id!, level: 3, souls: 0 })
})

test('characters: add, select, rename by hand', async ({ page }) => {
  const app = await manual(page, { tab: 'check' })
  await expect(page.getByText('Noch kein Charakter')).toBeVisible()
  await page.locator('[data-add-char]').click()
  await page.getByPlaceholder('Name des Charakters').fill('Aria')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-char="Aria"]')).toBeVisible()
  expect((await app.posted('typing')).some((m: { on: boolean }) => m.on)).toBe(true) // the host lets the window take the keyboard
  await page.locator('[data-add-char]').click()
  await page.getByPlaceholder('Name des Charakters').fill('Borin')
  await page.getByRole('button', { name: 'OK' }).click()
  await expect(page.locator('[data-char="Borin"]')).toBeVisible()
  expect((await app.posted('setChar')).map((m: { name: string }) => m.name)).toEqual(['Aria', 'Borin'])
  // the active character is picked in the bar
  await page.locator('[data-tip="Aktiven Charakter wählen"]').click()
  await page.getByRole('option', { name: 'Aria' }).click()
  await expect.poll(async () => (await app.posted('setChar')).at(-1).name).toBe('Aria')
  await shot(page, 'manual-chars')
  // rename on the character's page
  await page.locator('[data-char="Borin"]').click()
  await page.locator('[data-tip="Umbenennen"]').click()
  await page.getByPlaceholder('Name des Charakters').fill('Borin2')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-list]').getByText('Borin2', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Übersicht' }).last().click()
  await expect(page.locator('[data-char="Borin2"]')).toBeVisible()
  await expect(page.locator('[data-char="Borin"]')).toHaveCount(0)
})

test('achievements: counter and tier ticks by hand', async ({ page }) => {
  const app = await manual(page, { tab: 'ach', achDone: true })
  await expect(page.getByText('Manueller Modus:')).toBeVisible()
  // first achievement with at least two tiers (one-tier ones are done after the first tick)
  let id = 0
  for (let i = 0; !id; i++) {
    const cand = page.locator('[data-ach]').nth(i)
    await cand.click()
    if (await cand.locator('[data-tier="2"]').count()) id = +(await cand.getAttribute('data-ach'))!
  }
  const tile = page.locator(`[data-ach="${id}"]`), edit = tile.locator('[data-ach-edit]')
  await expect(edit).toBeVisible()
  // tick tier 1: counter jumps to its goal
  await tile.locator('[data-tier="1"]').click()
  await expect.poll(async () => (await app.posted('setAch')).length).toBe(1)
  const [tick] = await app.posted('setAch')
  expect(tick).toMatchObject({ type: 'setAch', id, tier: 1 })
  await expect(tile.locator('[data-tier="1"]')).toContainText('☑')
  // fine counter
  await edit.getByRole('button', { name: '+1', exact: true }).click()
  await expect.poll(async () => (await app.posted('setAch')).at(-1).val).toBe(tick.val + 1)
  await expect(page.getByText('Manueller Modus:')).toHaveCount(0)
  await shot(page, 'manual-ach')
})

test('map and bosses: radar off with a note, prominent kill button', async ({ page }) => {
  await manual(page, { tab: 'targets', view: 'both' })
  await expect(page.locator('[data-radar-off]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Radar' })).toHaveCount(0)
  await page.locator('[data-tabs] button').nth(9).click() // Bosse
  await expect(page.getByText('Manuell: nach dem Kill')).toBeVisible()
  const kill = page.locator('[data-kill]')
  if (await kill.count()) {
    await kill.first().click()
    await expect(page.locator('[data-boss]').first()).toBeVisible()
  }
  await shot(page, 'manual-bosses')
})

test('settings: mode switch and version', async ({ page }) => {
  const app = await manual(page)
  await page.locator('[data-tip="Einstellungen"]').click()
  await page.locator('nav [data-tip="Live-Tracking"]').click()
  await page.getByRole('combobox').filter({ hasText: 'Manuell (ohne Npcap)' }).click()
  await page.getByRole('option', { name: 'Automatisch (Npcap mitlesen)' }).click()
  await expect.poll(async () => (await app.posted('mode')).at(-1)?.mode).toBe('auto')
  await page.locator('nav [data-tip="Daten & Über"]').click()
  await expect(page.getByText('The Completionist 1.1.0')).toBeVisible()
})
