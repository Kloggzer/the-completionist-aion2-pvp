// Daevanion tab: optimizer without character data (this build has no plaync character lookup).
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { hasCache, navBtn, openApp } from './host'

const FILE = path.join(import.meta.dirname, '..', 'public', 'daevanion.json')
test.skip(!hasCache() || !fs.existsSync(FILE), 'needs the app data cache and web/public/daevanion.json (tools/fetch_daevanion.py)')

const tab = (page: Page) => navBtn(page, 'dae')

test('without character data: class, points and goal give a plan on the boards', async ({ page }) => {
  const app = await openApp(page, { ui: { tab: 'dae' } })
  await expect(tab(page)).toHaveAttribute('data-on', 'on')
  await expect(page.locator('[data-board="Nezekan"]')).toBeVisible()
  // points for the four boards: the plan uses them, the boards show new (gold) nodes
  const pve = page.locator('[data-points="pve"]')
  for (let i = 0; i < 3; i++) await pve.getByRole('button', { name: '+10', exact: true }).click()
  await expect(pve.locator('output')).toHaveText('30')
  await expect(page.locator('[data-result="pve"]')).toBeVisible()
  // the board the plan spends the most on shows its new nodes
  const spent = await page.locator('[data-board-tab]').evaluateAll(els => els.map(e => Number(e.querySelector('span')?.textContent?.split('/')[0] || 0)))
  await page.locator('[data-board-tab]').nth(spent.indexOf(Math.max(...spent))).click()
  await expect.poll(() => page.locator('[data-node="new"]').count()).toBeGreaterThan(5)
  // exactly the player's points: 30 of 30
  await expect(page.locator('[data-kpi="points"]')).toContainText('30 / 30')
  // in-game frames: on while the tab is open, the host gets every board with its marks
  await expect(page.locator('[data-ingame]')).toBeVisible()
  await expect.poll(async () => (await app.posted('daeOverlay')).some((m: { on: boolean; boards: { marks: unknown[] }[] }) => m.on && m.boards.length === 6 && m.boards.some(b => b.marks.length > 0))).toBe(true)
  await page.locator('[data-ingame-toggle]').click()
  await expect.poll(async () => (await app.posted('daeOverlay')).at(-1)?.on).toBe(false)
  await page.locator('[data-ingame-toggle]').click()
  // the packet research log runs on its own while the tab is open
  expect((await app.posted('daeLog')).at(-1)?.on).toBe(true)
  // the tab follows the board the overlay found in the game
  await app.send({ type: 'daeOverlay', state: 'found', slot: '2' })
  await expect(page.locator('[data-board="Zikel"]')).toBeVisible()
  await expect(page.locator('[data-ingame="found"]')).toContainText('Zikel erkannt')
  await page.locator('[data-board-tab="Nezekan"]').click()
  await expect(page.locator('[data-board="Nezekan"]')).toBeVisible()
  // one board at a time: tiles switch it, the side panel lists its skill levels and stats
  await expect(page.locator('[data-board-side="Nezekan"]')).toBeVisible()
  await page.locator('[data-board-tab="Zikel"]').click()
  await expect(page.locator('[data-board="Zikel"]')).toBeVisible()
  await expect(page.locator('[data-board-side="Zikel"]')).toBeVisible()
  await page.locator('[data-board-tab="Nezekan"]').click()
  // a click pins a node: want -> never -> free
  const node = page.locator('[data-board="Nezekan"] [data-node="free"]').first()
  await node.click()
  await expect(page.locator('[data-board="Nezekan"] [data-pin="want"]')).toHaveCount(1)
  await page.locator('[data-board="Nezekan"] [data-pin="want"]').click()
  await expect(page.locator('[data-board="Nezekan"] [data-pin="never"]')).toHaveCount(1)
  await page.locator('[data-board="Nezekan"] [data-pin="never"]').click()
  await expect(page.locator('[data-board="Nezekan"] [data-pin]')).toHaveCount(0)
  await page.locator('[data-board="Nezekan"]').scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'e2e/.out/shots/dae-board.png' })
  // the plan says what it gives in damage / effective HP, and where that comes from
  await expect(page.locator('[data-gain="pve"]')).toContainText(/Schaden\s*\+/)
  // details on demand: closed at first, open on a click (remembered)
  await expect(page.locator('[data-why]')).toHaveCount(0)
  await page.locator('[data-disclosure="dae.details"] button').first().click()
  await expect(page.locator('[data-why="pve"] > div').first()).toBeVisible()
  // goal presets: max damage vs defensive change the plan's numbers
  await page.locator('[data-preset="def"]').click()
  await expect(page.locator('[data-preset="def"]')).toHaveAttribute('data-pressed')
  await page.locator('[data-pmode="pve"] [data-pm="pvp"]').click()
  await expect(page.locator('[data-pmode="pve"] [data-pm="pvp"]')).toHaveAttribute('data-pressed')
  await expect(page.locator('[data-gain="pve"]').locator('..')).toBeVisible()
  // a skill taken out of the rotation is saved per class
  await page.locator('[data-panel="skills"]').click()
  const skill = page.locator('[data-skill="Ruinous Blow"]')
  await skill.locator('[data-use]').click()
  await expect(skill.locator('[data-use]')).toHaveAttribute('data-use', 'off')
  await expect(page.locator('[data-skill="Overhead Slam"] [data-lvworth]')).toContainText('+1 Stufe')
  // stat values and the numbers / assumptions panel
  await page.locator('[data-panel="stats"]').click()
  await expect(page.locator('[data-stat="Combat Speed"]')).toContainText('+')
  await page.locator('[data-panel="stats"]').scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'e2e/.out/shots/dae-stats.png' })
  await page.locator('[data-panel="inputs"]').click()
  await expect(page.locator('[data-assume-key="critCap"]')).toContainText('Spieltext')
  await expect(page.locator('[data-sheet-key="crit"]')).toContainText('typisch')
  await page.screenshot({ path: 'e2e/.out/shots/dae-respec.png', fullPage: true })
})

test('boards from the game (0x26e2): own nodes on the boards, marked as from the game', async ({ page }) => {
  const app = await openApp(page, { ui: { tab: 'dae' } })
  await app.send({ type: 'pvp', own: { name: 'Testdaeva', srv: 2306, pc: 10, race: 2, lv: 45, il: 3000, cp: 0 }, players: [], party: [], kills: [] })
  await app.send({ type: 'daeGame', boards: { 21: [210113, 210033, 210034], 26: [260113] } })
  await expect(page.getByText(/Boards aus dem Spiel/)).toBeVisible()
  // spent points from the game (0x2ee2): the total follows without entering it
  await app.send({ type: 'daePoints', pools: { 1: 248, 2: 0 } })
  await expect(page.locator('[data-disclosure="dae.setup"]')).toContainText('Nezekan–Triniel 248') // in the setup's summary line
  // a node bought in the game (0x28e2): owned on the board at once
  await app.send({ type: 'daeNodes', bought: [210034 + 1], reset: [] })
  await expect(page.locator('[data-board="Nezekan"] [data-node="own"], [data-board="Nezekan"] [data-node="drop"]')).toHaveCount(3) // 2 from the login + 1 bought
})
