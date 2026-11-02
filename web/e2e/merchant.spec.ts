// Merchant tab: offers entered via the pet picker get a verdict, survive within the hour and clear on the full hour
// (fake clock); the offer the game sends (host 'merchant') fills the list. Mocked host, real pet/map data from the app
// cache, synthetic pet state (fakeState: every third pet unlocked, here one of them at Lv 3).
import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { CACHE, fakeState, hasCache, openApp } from './host'

test.skip(!hasCache(), 'needs the app data cache in %LOCALAPPDATA%\\TheCompletionist\\cache (start the app once)')

const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/.out/shots/${name}.png` })

// Pet portraits (aion2.app, cached by the host under /data/peticons/; host.ts leaves them to this route): the app cache's
// file if it has one, else a small orange square; `missing` ones 404. Register before openApp. Returns the requested names.
const ICON = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAEklEQVR4nGM4UaHxHx9mGBkKAEIJmcHZIRmGAAAAAElFTkSuQmCC', 'base64')
async function petIcons(page: Page, missing: string[] = []) {
  const asked: string[] = []
  await page.route('**/data/peticons/**', route => {
    const f = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop()!)
    asked.push(f)
    const real = path.join(CACHE, 'peticons', f)
    if (missing.includes(f)) return route.fulfill({ status: 404, body: 'missing' })
    return fs.existsSync(real) ? route.fulfill({ status: 200, body: fs.readFileSync(real), contentType: 'image/webp' }) : route.fulfill({ status: 200, body: ICON, contentType: 'image/png' })
  })
  return asked
}

async function addOffer(page: Page, name: string) {
  const box = page.locator('[data-merchpicker]')
  await box.fill(name)
  await expect(page.getByRole('option').first()).toContainText(name)
  await box.press('Enter')
  await expect(box).toHaveValue('')
}

test('offers get verdicts and clear on the full hour', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 })
  await page.clock.install({ time: new Date(2026, 9, 14, 13, 57, 30) })
  const pets = JSON.parse(fs.readFileSync(path.join(CACHE, 'pets.json'), 'utf8')).pets
  const owned = pets[0].n, state = fakeState()
  state.levels[pets[0].id] = 3; state.souls[pets[0].id] = 0
  const { posted } = await openApp(page, { state, ui: { tab: 'merchant', merchFac: 'Asmodian' } })
  await expect(page.getByText('Kartendaten werden noch geladen')).toHaveCount(0, { timeout: 20000 })
  await expect(page.getByText(/neues Angebot in 2:\d\d/).first()).toBeVisible()

  // most important pet below Lv 3 (wish list: farm effort × missing souls) and the first easy one
  const wish = page.locator('[data-wish]')
  expect(await wish.count()).toBeGreaterThan(10)
  await expect(wish.first().locator('[data-souls]')).toHaveCount(1)
  const name = async (l: typeof wish) => (await l.locator('[data-name]').innerText()).trim()
  const hard = await name(wish.first())
  const scores = await wish.evaluateAll(els => els.map(e => +(e.getAttribute('data-score') || 0)))
  const easy = await name(wish.nth(scores.findIndex(n => n < 35)))

  for (const n of [easy, owned, hard]) await addOffer(page, n)
  const offers = page.locator('[data-offer]')
  await expect(offers).toHaveCount(3)
  // buy first, owned last
  await expect(offers.nth(0)).toHaveAttribute('data-verdict', 'buy')
  await expect(offers.nth(0)).toContainText('KAUFEN')
  await expect(offers.nth(0)).toContainText(hard)
  await expect(offers.nth(1)).toHaveAttribute('data-verdict', 'opt')
  await expect(offers.nth(1)).toContainText(/Spawns/)
  await expect(offers.nth(1)).toContainText(/\+5 Seelen → \d+\/105 · \d+× bis Lv 3/)
  await expect(offers.nth(2)).toHaveAttribute('data-verdict', 'have')
  await expect(offers.nth(2)).toContainText('Lv 3 erreicht')

  // optional price, saved with the offer
  await offers.nth(0).locator('[data-price]').fill('250000')
  await offers.nth(0).locator('[data-price]').press('Enter')
  await expect.poll(async () => (await posted('ui')).filter((m: { patch: { merch?: { items: { price?: number }[] } } }) => m.patch.merch)
    .at(-1)?.patch.merch?.items.some(x => x.price === 250000)).toBe(true)
  await expect(offers.nth(0).locator('[data-persoul]')).toHaveText('50.000/Seele')
  await shot(page, 'merchant-offer')

  // full hour: the list clears by itself
  await page.clock.runFor(3 * 60 * 1000)
  await expect(offers).toHaveCount(0)
  await expect(page.getByText(/neues Angebot in 5\d:\d\d/).first()).toBeVisible()
  await expect.poll(async () => (await posted('ui')).filter((m: { patch: { merch?: { items: unknown[] } } }) => m.patch.merch).at(-1)?.patch.merch?.items.length).toBe(0)
})

test('saved offer survives a restart within the hour, not after it', async ({ page }) => {
  const now = new Date(2026, 9, 14, 13, 20, 0)
  await page.clock.install({ time: now })
  const pets = JSON.parse(fs.readFileSync(path.join(CACHE, 'pets.json'), 'utf8')).pets
  const h = new Date(2026, 9, 14, 13, 0, 0).getTime()
  await openApp(page, { ui: { tab: 'merchant', merch: { h, items: [{ id: pets[1].id, price: 1000 }] } } })
  await expect(page.locator('[data-offer]')).toHaveCount(1)
  await expect(page.locator('[data-price]')).toHaveValue('1.000')

  // the same saved offer from the previous hour is gone
  const page2 = await page.context().newPage()
  const { posted } = await openApp(page2, { ui: { tab: 'merchant', merch: { h: h - 3600_000, items: [{ id: pets[1].id }] } } })
  await expect(page2.locator('[data-tabs]')).toBeVisible()
  await expect(page2.locator('[data-offer]')).toHaveCount(0)
  await expect.poll(async () => (await posted('ui')).some((m: { patch: { merch?: { h: number } } }) => m.patch.merch?.h === h)).toBe(true)
})

test('wish list row jumps to the pet on the map', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 })
  await openApp(page, { ui: { tab: 'merchant', merchFac: 'Asmodian' } })
  await expect(page.getByText('Kartendaten werden noch geladen')).toHaveCount(0, { timeout: 20000 })
  const row = page.locator('[data-wish]').filter({ has: page.locator('svg.lucide-map-pin') }).first()
  const id = await row.getAttribute('data-wish')
  await row.click()
  await expect(page.locator(`[data-pet="${id}"][data-sel]`)).toBeVisible({ timeout: 15000 })
})

// 0x9156 samples as Protocol.cs ParseMerchant decodes them: [item, base, sale]. TAB1 from capture 20261014-055236,
// TAB2 = the in-game shop the user screenshotted (Kalgolem -50 %, Superior Wind Spirit -10 %, Ashen Lupyllini -30 %, …).
// The UI maps pet items to pets by name (petItems.json): 534760083 = Kalgolem = pet 1084, not 1083.
const items = (l: number[][]) => l.map(([item, base, price]) => ({ item, count: 1, tier: 0, base, price }))
const TAB1 = items([[535810569, 48000, 43200], [533850010, 960000, 768000], [534760200, 100000, 70000], [535710046, 96000, 76800],
  [533850005, 1920000, 1536000], [534760111, 100000, 80000], [533840017, 3600000, 2880000], [533840014, 2400000, 2160000],
  [534760004, 100000, 80000], [534760110, 100000, 80000]])
const TAB2 = items([[534760083, 100000, 50000], [534760094, 100000, 90000], [534760163, 100000, 70000], [534760167, 100000, 70000],
  [534760130, 100000, 80000], [534760185, 100000, 90000], [534760187, 100000, 70000], [534760197, 100000, 80000],
  [534760201, 100000, 80000], [534760222, 100000, 70000]])
// pets of both tabs (pets.json ids by name)
const OFFERED = [1084, 1095, 1132, 1136, 1167, 1186, 1217, 1181, 1180, 1210, 1175, 1209, 1005, 1159]

test('offer read from the game fills the list with verdicts and prices', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 })
  await page.clock.install({ time: new Date(2026, 9, 14, 13, 20, 0) })
  const pets = JSON.parse(fs.readFileSync(path.join(CACHE, 'pets.json'), 'utf8')).pets as { id: number; n: string; ng?: number }[]
  const state = fakeState()
  state.levels[1084] = 3; state.souls[1084] = 0 // Kalgolem: Lv 3 done
  state.levels[1095] = 2; state.souls[1095] = 10 // Superior Wind Spirit: 65 souls missing
  delete state.levels[1132]; state.souls[1132] = 0 // Ashen Lupyllini: 105 missing
  const { send, posted } = await openApp(page, { state, ui: { tab: 'merchant', merchFac: 'Asmodian', toasts: true } })
  await expect(page.getByText('Kartendaten werden noch geladen')).toHaveCount(0, { timeout: 20000 })

  // a hand-added pet that the game offers too becomes a game entry
  await addOffer(page, 'Superior Wind Spirit')
  await expect(page.locator('[data-offer="1095"] [data-game]')).toHaveCount(0)

  await send({ type: 'merchant', tab: 1356, at: Date.now(), items: TAB2 })
  const offers = page.locator('[data-offer]')
  await expect(offers).toHaveCount(10)
  await expect(page.locator('[data-offer] [data-game]')).toHaveCount(10)
  await expect(page.locator('[data-offer="1084"]')).toContainText('Kalgolem')
  await expect(page.locator('[data-offer="1095"] [data-game]')).toHaveAttribute('aria-label', 'aus dem Spiel')
  await expect(page.locator('[data-offer="1095"]')).toContainText('Superior Wind Spirit')
  await expect(page.locator('[data-offer="1095"] [data-price]')).toHaveValue('90.000')
  await expect(page.locator('[data-offer="1095"] [data-discount]')).toHaveText('-10 %')
  await expect(page.locator('[data-offer="1095"] [data-missing]')).toHaveAttribute('data-missing', '65')
  await expect(page.locator('[data-offer="1095"]')).toContainText('+5 Seelen → 45/105 · 13× bis Lv 3')
  await expect(page.locator('[data-offer="1095"] [data-souls]')).toHaveAttribute('data-souls', '40')
  await expect(page.locator('[data-offer="1095"] [data-persoul]')).toHaveText('18.000/Seele')
  await expect(page.locator('[data-offer="1084"]')).toHaveAttribute('data-verdict', 'have')
  await expect(page.locator('[data-offer="1084"] [data-discount]')).toHaveText('-50 %')
  await expect(page.locator('[data-offer="1084"] [data-price]')).toHaveValue('50.000')
  await expect(page.locator('[data-offer="1132"]')).toContainText('Ashen Lupyllini')
  await expect(page.locator('[data-offer="1132"] [data-missing]')).toHaveAttribute('data-missing', '105')
  await expect(page.locator('[data-offer="1132"] [data-discount]')).toHaveText('-30 %')
  await expect(page.locator('[data-offer="1210"]')).toContainText('Dry Leaf Agrint')
  // buy first, then optional, Lv 3 done
  const rank: Record<string, number> = { event: 0, buy: 1, opt: 2, have: 3, unknown: 4 }
  const sortedRanks = async () => {
    const ranks = (await offers.evaluateAll(els => els.map(e => e.getAttribute('data-verdict') || ''))).map(v => rank[v])
    expect(ranks).toEqual([...ranks].sort())
  }
  await sortedRanks()
  const verdicts = await offers.evaluateAll(els => els.map(e => e.getAttribute('data-verdict') || ''))
  // toast for the pets worth buying
  const nBuy = verdicts.filter(v => v === 'buy').length
  if (nBuy) await expect(page.getByText(`Händler: ${nBuy} Pets zum Kaufen`)).toBeVisible()
  await expect.poll(async () => (await posted('ui')).filter((m: { patch: { merch?: { items: { tab?: number }[] } } }) => m.patch.merch)
    .at(-1)?.patch.merch?.items.filter(x => x.tab === 1356).length).toBe(10)
  await shot(page, 'merchant-game')

  // the other tab: its pets join, the other goods are counted; reopening a tab does not duplicate
  await send({ type: 'merchant', tab: 1353, at: Date.now(), items: TAB1 })
  await expect(offers).toHaveCount(14)
  await expect(page.locator('[data-other]')).toHaveText('+6 weitere Artikel (keine Pets)')
  await send({ type: 'merchant', tab: 1353, at: Date.now(), items: TAB1 })
  await expect(offers).toHaveCount(14)

  // a merchant / event pet (not in pets.json) under its game id: progress from the state (Lv 0 here), a normal verdict;
  // an unlisted pet item last
  await send({ type: 'merchant', tab: 1357, at: Date.now(), items: items([[534760008, 100000, 80000], [534760018, 100000, 90000]]) })
  await expect(offers).toHaveCount(16)
  const kernon = page.locator('[data-offer="1009"]')
  await expect(kernon).toHaveAttribute('data-verdict', 'buy')
  await expect(kernon).toContainText('Kernon')
  await expect(kernon).toContainText('Nur Händler/Event')
  await expect(kernon.locator('[data-missing]')).toHaveAttribute('data-missing', '105')
  await expect(offers.last()).toHaveAttribute('data-verdict', 'unknown')
  await expect(offers.last()).toContainText('Unbekanntes Pet (Item 534760018)')
  await sortedRanks()

  // manual entry still works next to the game entries (also for merchant / event pets)
  const extra = pets.find(p => !OFFERED.includes(p.id) && !p.ng && !state.levels[p.id])!
  await addOffer(page, extra.n)
  await expect(offers).toHaveCount(17)
  await expect(page.locator(`[data-offer="${extra.id}"] [data-game]`)).toHaveCount(0)
  // a pet item without a known game id stays "merchant only" (progress unknown) and comes first
  await addOffer(page, 'Golden Baikron')
  await expect(offers).toHaveCount(18)
  await expect(offers.first()).toHaveAttribute('data-verdict', 'event')
  await expect(offers.first()).toContainText('Golden Baikron')
})

test('layout: grouped wish list, empty offer with picks, offer tiles at 420 / 900 / 1400 px', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 9, 14, 13, 20, 0) })
  await page.setViewportSize({ width: 1400, height: 900 })
  await petIcons(page)
  const { send } = await openApp(page, { ui: { tab: 'merchant', merchFac: 'Asmodian' } })
  await expect(page.getByText('Kartendaten werden noch geladen')).toHaveCount(0, { timeout: 20000 })

  // sections in order: merchant only, hard, easy; the "no spawns" note only once, in the section header
  const groups = page.locator('[data-wishgroup]')
  expect(await groups.evaluateAll(els => els.map(e => e.getAttribute('data-wishgroup')))).toEqual(['none', 'hard', 'easy'])
  const total = await page.locator('[data-wish]').count()
  const counts = await groups.evaluateAll(els => els.map(e => +(e.getAttribute('data-count') || 0)))
  expect(counts.reduce((a, b) => a + b, 0)).toBe(total)
  await expect(page.getByText('keine Spawns bekannt', { exact: false })).toHaveCount(1)
  await expect(page.locator('[data-wishgroup="none"] [data-wish]').first()).toHaveAttribute('data-score', '100')
  await expect(page.locator('[data-wishgroup="none"] [data-tier]')).toHaveCount(0) // the header says it once
  await expect(page.locator('[data-wishgroup="hard"] [data-tier]').first()).toHaveAttribute('data-tier', /[23]/)
  // portraits in the tiles (wide window)
  expect(await page.locator('[data-wish] img[data-peticon]').count()).toBeGreaterThan(10)
  // empty offer: one line + countdown, the top picks below
  await expect(page.locator('[data-offerempty]')).toContainText(/neues Angebot in 39:\d\d/)
  await expect(page.locator('[data-watchpet]')).toHaveCount(6)
  // three wish columns side by side at 1400 px
  const xs = await page.locator('[data-wishgroup="none"] [data-wish]').evaluateAll(els => [...new Set(els.slice(0, 6).map(e => Math.round(e.getBoundingClientRect().x)))].length)
  expect(xs).toBe(3)
  await shot(page, 'merchant-1400-empty')

  await send({ type: 'merchant', tab: 1356, at: Date.now(), items: TAB2 })
  await send({ type: 'merchant', tab: 1357, at: Date.now(), items: items([[534760008, 100000, 80000]]) })
  await expect(page.locator('[data-offer]')).toHaveCount(11)
  await expect(page.locator('[data-watchpet]')).toHaveCount(0)
  await shot(page, 'merchant-1400')
  for (const w of [900, 420]) {
    await page.setViewportSize({ width: w, height: 900 })
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(over).toBeLessThanOrEqual(0)
    await shot(page, `merchant-${w}`)
  }
  // narrow: one wish column
  const xs420 = await page.locator('[data-wish]').evaluateAll(els => [...new Set(els.slice(0, 4).map(e => Math.round(e.getBoundingClientRect().x)))].length)
  expect(xs420).toBe(1)
})

test('offer, picks and wish list show the pet portraits from aion2.app', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 9, 14, 13, 20, 0) })
  await page.setViewportSize({ width: 1280, height: 860 })
  // Ashen Lupyllini's portrait is missing (offline / not downloadable): its category icon stays
  const ashen = 'UT_Vehicle_Portrait_Lufilini_02_CV01.webp'
  const asked = await petIcons(page, [ashen])
  const { send } = await openApp(page, { ui: { tab: 'merchant', merchFac: 'Asmodian' } })
  await expect(page.getByText('Kartendaten werden noch geladen')).toHaveCount(0, { timeout: 20000 })

  // top picks while the offer is empty
  await expect(page.locator('[data-watchpet] img[data-peticon]')).toHaveCount(6)
  await send({ type: 'merchant', tab: 1356, at: Date.now(), items: TAB2 })
  await send({ type: 'merchant', tab: 1357, at: Date.now(), items: items([[534760008, 100000, 80000], [534760018, 100000, 90000]]) })
  await expect(page.locator('[data-offer]')).toHaveCount(12)
  const kal = page.locator('[data-offer="1084"] img[data-peticon]')
  await expect(kal).toHaveAttribute('src', '/data/peticons/UT_Vehicle_Portrait_Kalgolem_01.webp')
  await expect(kal).toBeVisible()
  await expect(kal).not.toHaveClass(/opacity-0/) // loaded
  expect(await kal.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0)
  // merchant / event pet by its game id; unlisted item: question mark
  await expect(page.locator('[data-offer="1009"] img[data-peticon]')).toHaveAttribute('src', /Keneir/)
  await expect(page.locator('[data-offer="534760018"] img')).toHaveCount(0)
  // the portrait column spans the full tile height
  const tile = await page.locator('[data-offer="1084"]').boundingBox(), pic = await kal.locator('..').boundingBox()
  expect(pic!.height).toBeGreaterThan(tile!.height - 16) // tile padding 6 px top and bottom
  // a missing portrait falls back to the category icon
  const lup = page.locator('[data-offer="1132"]')
  await expect(lup.locator('img')).toHaveCount(0)
  expect(asked).toContain(ashen)
  await expect(lup.locator('svg').first()).toBeVisible()
  // wish list tiles too, also merchant / event pets (by their game id)
  expect(await page.locator('[data-wish] img[data-peticon]').count()).toBeGreaterThan(10)
  await expect(page.locator('[data-wish="1146"] img[data-peticon]')).toHaveAttribute('src', /UT_Vehicle_Portrait_/)
  expect(asked.every(f => /^[A-Za-z0-9_.-]+\.webp$/.test(f))).toBe(true)
  await shot(page, 'merchant-peticons')
})

test('a +5 soul update moves the bought offer to "Gekauft"; offers are kept per character', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 })
  await page.clock.install({ time: new Date(2026, 9, 14, 13, 20, 0) })
  const state = fakeState()
  delete state.levels[1132]; state.souls[1132] = 0 // Ashen Lupyllini: not unlocked yet
  const { send, posted } = await openApp(page, { state, ui: { tab: 'merchant', merchFac: 'Asmodian' } })
  await expect(page.getByText('Kartendaten werden noch geladen')).toHaveCount(0, { timeout: 20000 })
  await send({ type: 'merchant', tab: 1356, at: Date.now(), items: TAB2 })
  const offers = page.locator('[data-offer]')
  await expect(offers).toHaveCount(10)

  // a field kill (+1) is no purchase, +5 is
  await send({ type: 'soul', ev: { pet: 1132, gained: 1, level: 0, souls: 1, need: 5, levelUp: false } })
  await expect(page.locator('[data-bought]')).toHaveCount(0)
  await send({ type: 'soul', ev: { pet: 1132, gained: 5, level: 1, souls: 1, need: 25, levelUp: true } })
  await expect(offers).toHaveCount(9)
  await expect(page.locator('[data-offer="1132"]')).toHaveCount(0)
  const bought = page.locator('[data-boughtoffer="1132"]')
  await expect(bought).toContainText('Ashen Lupyllini')
  await expect(bought).toContainText('+5 Seelen · 70.000')
  await expect(page.locator('[data-bought]')).toContainText('Gekauft')
  await expect.poll(async () => (await posted('ui')).filter((m: { patch: { merch?: { items: { id: number; bought?: number }[] } } }) => m.patch.merch)
    .at(-1)?.patch.merch?.items.find(x => x.id === 1132)?.bought).toBeGreaterThan(0)
  // the game re-sends the tab: still bought
  await send({ type: 'merchant', tab: 1356, at: Date.now(), items: TAB2 })
  await expect(bought).toHaveCount(1)
  await expect(offers).toHaveCount(9)
  await shot(page, 'merchant-bought')

  // undo
  await bought.locator('[data-unbuy]').click()
  await expect(page.locator('[data-bought]')).toHaveCount(0)
  await expect(offers).toHaveCount(10)

  // another character: its own (empty) offer, a chip for the first one
  await send({ type: 'char', name: 'Twink' })
  await expect(offers).toHaveCount(0)
  await expect(page.locator('[data-charchips]')).toBeVisible()
  const main = page.locator('[data-charchip="Testchar"]')
  await expect(main).toContainText(/Testchar: (\d+× KAUFEN|10)/)
  await send({ type: 'merchant', tab: 1353, at: Date.now(), items: TAB1 })
  await expect(offers).toHaveCount(4)
  await main.click()
  await expect(offers).toHaveCount(10)
  await page.locator('[data-charchip=""]').click()
  await expect(offers).toHaveCount(4)
  // back to the first character: its offer returns
  await send({ type: 'char', name: 'Testchar' })
  await expect(offers).toHaveCount(10)
  await expect(page.locator('[data-charchip="Twink"]')).toBeVisible()
})

test('merchant / event pets with a game id: wish list with progress, purchase matched by id', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 })
  await page.clock.install({ time: new Date(2026, 9, 14, 13, 20, 0) })
  await petIcons(page)
  const state = fakeState()
  state.levels[1009] = 1; state.souls[1009] = 3 // Kernon: 97 souls missing
  state.levels[1146] = 3; state.souls[1146] = 0 // Gatekeeper Pinopi: Lv 3 done
  state.levels[1299] = 1; state.souls[1299] = 0 // not in any table
  state.levels[1001] = 1; state.souls[1001] = 0 // Black Dragon: owned, not in the item table
  const { send } = await openApp(page, { state, ui: { tab: 'merchant', merchFac: 'Asmodian' } })
  await expect(page.getByText('Kartendaten werden noch geladen')).toHaveCount(0, { timeout: 20000 })

  const none = page.locator('[data-wishgroup="none"]')
  const kernon = none.locator('[data-wish="1009"]')
  await expect(kernon).toContainText('Kernon')
  await expect(kernon).toContainText('Nur Händler/Event')
  await expect(kernon.locator('[data-souls]')).toHaveAttribute('data-souls', '8')
  await expect(kernon.locator('img[data-peticon]')).toHaveAttribute('src', /Keneir/)
  await expect(none.locator('[data-wish="1299"]')).toContainText('Pet #1299')
  await expect(none.locator('[data-wish="1001"] img[data-peticon]')).toHaveAttribute('src', /BlackDragon_01\.webp/)
  await expect(page.locator('[data-wish="1146"]')).toHaveCount(0) // Lv 3

  await send({ type: 'merchant', tab: 1357, at: Date.now(), items: items([[534760008, 100000, 80000], [534760183, 100000, 80000]]) })
  await expect(page.locator('[data-offer="1009"]')).toHaveAttribute('data-verdict', 'buy')
  await expect(page.locator('[data-offer="1009"]')).toContainText('+5 Seelen → 13/105')
  await expect(page.locator('[data-offer="534760183"]')).toHaveAttribute('data-verdict', 'event')
  await send({ type: 'soul', ev: { pet: 1009, gained: 5, level: 1, souls: 8, need: 25, levelUp: false } })
  await expect(page.locator('[data-boughtoffer="1009"]')).toContainText('Kernon')
  await expect(page.locator('[data-offer="534760183"]')).toHaveCount(1) // the unknown one stays
  await shot(page, 'merchant-eventpets')
})
