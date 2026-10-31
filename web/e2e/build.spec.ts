// Build tab (private build): fight from the Abyss Logs history (mocked host files), gear from the plaync character page
// (mocked website), the DPS model and the gear page.
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { hasCache, openApp } from './host'

test.skip(!hasCache() || !fs.existsSync(path.join(import.meta.dirname, '..', 'public', 'daevanion.json')), 'needs the app data cache and web/public/daevanion.json')

// ---------------------------------------------------------------- a small Abyss Logs file (see src/build.test.ts)
const vint = (n: number) => { const o: number[] = []; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 128; o.push(b) } while (n); return o }
const fv = (f: number, n: number) => [...vint(f * 8), ...vint(n)]
const fb = (f: number, b: number[] | string) => { const a = typeof b === 'string' ? [...Buffer.from(b)] : b; return [...vint(f * 8 + 2), ...vint(a.length), ...a] }
function abyssFile() {
  const hits: number[][] = []
  for (let i = 0; i < 40; i++) hits.push([1000, 0, 0]) // normal
  for (let i = 0; i < 20; i++) hits.push([1650, 1, 0]) // crit (33 %)
  for (let i = 0; i < 8; i++) hits.push([2000, 0, 1]) // double
  const total = hits.reduce((s, h) => s + h[0], 0)
  const header = [...fb(1, 'fight-1'), ...fb(2, 'Melee Training Scarecrow'), ...fv(3, 1e9), ...fv(4, 61e9), ...fv(6, total)]
  const player = fb(1, [...fv(1, 7), ...fb(2, [...fv(1, 7), ...fb(2, 'Testdaeva'), ...fb(3, 'Templar')])])
  const evs = hits.flatMap(([d, c, x]) => fb(1, [...fv(2, 7), ...fv(3, 9), ...fv(4, 12000001), ...fv(6, d), ...fv(7, 1), ...(c ? fv(9, 1) : []), ...(x ? fv(13, 1) : [])]))
  const sec = (t: number, b: number[]) => [t, 0, ...vint(b.length), ...b]
  return Buffer.from([...Buffer.from('ABYS'), 1, 0, 1, 0, ...vint(header.length), ...header, ...sec(2, player), ...sec(3, evs)]).toString('base64')
}
const FIGHT = '11111111-2222-3333-4444-555555555555'

const CORS = { 'access-control-allow-origin': '*' }
async function mockPlaync(page: Page) {
  await page.route('https://api-search.plaync.com/**', r => r.fulfill({ headers: CORS, json: { list: [{ characterId: 'ID%3D', name: '<strong>Testdaeva</strong>', serverId: 2306, level: 45 }] } }))
  await page.route('https://aion2.plaync.com/**', r => {
    const u = new URL(r.request().url())
    if (u.pathname.endsWith('/equipment/item')) return r.fulfill({ headers: CORS, json: {
      id: 1, name: 'Test Mace', grade: 'Unique', categoryName: 'Mace',
      mainStats: [{ id: 'WeaponFixingDamage', name: 'Attack', minValue: '160', value: '206', extra: '25' }, { id: 'Critical', name: 'Critical Hit', value: '50', extra: '0' }],
      subStats: [{ id: 'MPMax', name: 'MP', value: '57' }, { id: 'CombatSpeed', name: 'Combat Speed', value: '3%' }],
      magicStoneStat: [{ id: 'HPMax', name: 'HP', value: '+30' }],
    } })
    if (u.pathname.endsWith('/equipment')) return r.fulfill({ headers: CORS, json: { equipment: { equipmentList: [{ id: 1, enchantLevel: 5, slotPos: 1, slotPosName: 'MainHand' }] }, skill: { skillList: [] } } })
    if (u.pathname.endsWith('/info')) return r.fulfill({ headers: CORS, json: { profile: { characterLevel: 45 }, stat: { statList: [{ type: 'Time', name: 'Time', value: 40, statSecondList: ['Combat Speed +4%'] }] }, daevanion: { boardList: [] } } })
    return r.fulfill({ status: 404, headers: CORS, body: '' })
  })
}

test('Build tab: measured fight, stat values, gear and upgrades', async ({ page }) => {
  await mockPlaync(page)
  await page.addInitScript(([id, file]) => { (window as unknown as { __abyss: unknown }).__abyss = {
    index: [{ id, label: 'Melee Training Scarecrow', startTime: '2026-10-25T13:11:57', duration: 60, totalDamage: 1, playerCount: 1, recorderName: 'Testdaeva', hasDummy: true }],
    files: { [id]: file } } }, [FIGHT, abyssFile()])
  const app = await openApp(page, { ui: { tab: 'dae' } })
  await app.send({ type: 'pvp', own: { name: 'Testdaeva', srv: 2306, pc: 10, race: 2, lv: 45, il: 3000, cp: 0 }, players: [], party: [], kills: [] })
  // Daevanion page with the page switch in its bar
  await expect(page.locator('[data-page="stats"]')).toBeVisible()
  await page.locator('[data-page="stats"]').click()
  // the newest dummy fight is measured on its own: 20 crits in 68 hits, Doubles ×2
  await expect(page.locator('[data-rates]')).toContainText('29,4 %')
  await expect(page.locator('[data-rates]')).toContainText('gemessen')
  await expect(page.locator('[data-marg]')).toContainText('Kampftempo')
  // gear from the character page
  await page.locator('[data-load-gear]').click()
  await expect(page.getByText(/1 Teile/)).toBeVisible()
  await page.locator('[data-page="gear"]').click()
  await expect(page.locator('[data-item="MainHand"]')).toContainText('Test Mace')
  await expect(page.locator('[data-upgrades]')).toContainText('+5 → +6')
  await page.screenshot({ path: 'e2e/.out/shots/build-gear.png', fullPage: true })
})
