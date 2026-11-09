// Main flows of the overlay UI with a mocked host. Screenshots land in e2e/.out/shots for a visual check.
import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { CACHE, fakeState, goPage, hasCache, navBtn, openApp } from './host'

test.skip(!hasCache(), 'needs the app data cache in %LOCALAPPDATA%\\TheCompletionist\\cache (start the app once)')

const TABS = ['Übersicht', 'Ziele', 'Spots', 'Händler', 'Farmen', 'Erfolge', 'Checkliste', 'Daevanion', 'Arkana', 'Bosse', 'Timer']
const tab = (page: Page, name: string) => navBtn(page, name)
const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/.out/shots/${name}.png` })
const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!

const CHK = { srv: {}, chars: { Testchar: {}, Zweitchar: { supplyEmergency: { c: 1, at: Date.now() } } } }

/** Page clock one day after the last weekly reset (Wed 07:00 UTC), so no "reset soon" alerts depend on the test date. */
async function calmClock(page: Page) {
  const r = new Date(); r.setUTCHours(7, 0, 0, 0)
  r.setUTCDate(r.getUTCDate() - ((r.getUTCDay() - 3 + 7) % 7))
  if (r.getTime() > Date.now()) r.setUTCDate(r.getUTCDate() - 7)
  await page.clock.install({ time: r.getTime() + 29 * 3600e3 })
}

test('navigation stays in place on every tab', async ({ page }) => {
  await openApp(page)
  const ref = await box(page, '[data-tabs]'), hdr = await box(page, 'header')
  for (const name of TABS) {
    await goPage(page, name)
    await expect(tab(page, name)).toHaveAttribute('data-on', 'on')
    expect(await box(page, '[data-tabs]')).toEqual(ref)
    expect(await box(page, 'header')).toEqual(hdr)
    await shot(page, 'tab-' + name)
  }
})

test('navigation fits a narrow window: area icons left, the pages of the area on top', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 700 })
  await openApp(page)
  expect((await box(page, '[data-tabs]')).width).toBeLessThanOrEqual(56)
  for (const name of TABS) {
    await goPage(page, name)
    const sub = page.locator('[data-subnav]')
    if (await sub.count()) {
      expect(await sub.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      const b = (await tab(page, name).boundingBox())!
      expect(b.x + b.width).toBeLessThanOrEqual(360)
      // page buttons stay one line high
      expect(b.height).toBeLessThanOrEqual(32)
    }
  }
  await shot(page, 'narrow-360')
})

test('toasts never cover the navigation', async ({ page }) => {
  const app = await openApp(page)
  const pet = fakeState().levels, id = +Object.keys(pet)[0]
  for (const name of ['Ziele', 'Erfolge']) {
    await goPage(page, name)
    await app.send({ type: 'soul', ev: { pet: id, level: 1, souls: 3, need: 25, levelUp: false } })
    const t = page.locator('[data-toasts] > div').first()
    await t.waitFor()
    const nav = await box(page, '[data-tabs]'), tb = (await t.boundingBox())!
    expect(tb.x).toBeGreaterThanOrEqual(nav.x + nav.width)
    expect(await page.locator('[data-toasts]').first().evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none')
    await shot(page, 'toast-' + name)
  }
})

test('checklist: own character page -> all characters -> other character -> back', async ({ page }) => {
  await calmClock(page)
  await openApp(page, { ui: { tab: 'check', checklist: CHK } })
  // logged in: the checklist opens on the own character's page
  const back = page.getByRole('button', { name: 'Alle Charaktere' })
  await expect(back).toBeVisible()
  await expect(page.locator('[data-char]')).toHaveCount(0)
  await back.click()
  await expect(page.getByText('Charaktere', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Zweitchar/ }).click()
  await expect(page.getByText('nicht eingeloggt')).toBeVisible()
  await shot(page, 'check-char')
  await page.getByRole('button', { name: 'Alle Charaktere' }).click()
  await expect(page.getByText('Charaktere', { exact: true })).toBeVisible()
})

test('charges: odyle about to overflow shows a red warning with a CTA', async ({ page }) => {
  const at = Date.now()
  await openApp(page, { ui: { tab: 'home', checklist: CHK, charges: { 'odyle|Zweitchar': { v: 545, at } } } })
  const warn = page.getByRole('button', { name: /Odyle-Energie 545\/560.*Zweitchar/ })
  await expect(warn).toBeVisible()
  await shot(page, 'alerts-home')
  await warn.click()
  await expect(page.getByText('nicht eingeloggt')).toBeVisible()
  await expect(page.getByText('Odyle-Energie', { exact: true })).toBeVisible()
  await page.locator('[data-tip="−40"]').first().click()
  await expect(page.getByText('505/560', { exact: true })).toBeVisible()
  await shot(page, 'charges-char')
})

test('overview: +1 on the checklist and jump to a tab', async ({ page }) => {
  await calmClock(page)
  const app = await openApp(page, { ui: { tab: 'home', checklist: CHK } })
  const row = page.locator('div', { hasText: /^Ludra \(Abgrundsveredelung\)0\/1$/ }).first()
  await expect(row).toBeVisible()
  await row.getByRole('button').click()
  await expect(page.getByText('Ludra (Abgrundsveredelung)')).toHaveCount(0)
  expect((await app.posted('ui')).some((m: { patch: { checklist?: unknown } }) => m.patch.checklist)).toBe(true)
  await shot(page, 'overview')
  await page.getByRole('button', { name: 'alle Timer' }).click()
  await expect(tab(page, 'Timer')).toHaveAttribute('data-on', 'on')
})

test('spots: ranking explanation toggles', async ({ page }) => {
  await openApp(page, { ui: { tab: 'spots' } })
  // a closed HowTo at the end of the page (kit), remembered under U.open['spots.how']
  await expect(page.locator('[data-disclosure="spots.how"]')).toHaveAttribute('data-open', 'off')
  await expect(page.getByText('Spawns im Umkreis von')).toHaveCount(0)
  await page.getByRole('button', { name: /Wie wird das berechnet/ }).click()
  await expect(page.getByText('Spawns im Umkreis von')).toBeVisible()
  await shot(page, 'spots-how')
  await page.getByRole('button', { name: /Wie wird das berechnet/ }).click()
  await expect(page.getByText('Spawns im Umkreis von')).toHaveCount(0)
})

test('settings: every category opens, closes again', async ({ page }) => {
  await openApp(page)
  await page.locator('[data-tip="Einstellungen"]').click()
  for (const c of ['Allgemein', 'Karte', 'Ziele & Filter', 'Benachrichtigungen', 'Hotkeys', 'Live-Tracking', 'Daten & Über']) {
    await page.locator(`nav [data-tip="${c}"]`).click()
    await expect(page.locator(`nav [data-tip="${c}"]`)).toHaveAttribute('data-on', 'on')
  }
  await shot(page, 'settings')
  await page.locator('[data-settings-close]').click()
  await expect(page.getByText('Einstellungen', { exact: true })).toHaveCount(0)
})

test('no radar: neither the map mode nor the mini radar (the position is too rough for it)', async ({ page }) => {
  const app = await openApp(page, { ui: { tab: 'targets', view: 'both' } })
  await app.send({ type: 'pos', pos: { x: 0, z: 0, y: 0, at: new Date().toISOString() } })
  await page.waitForTimeout(600)
  await expect(page.getByRole('button', { name: 'Radar' })).toHaveCount(0)
  await expect(page.locator('[data-mini-radar]')).toHaveCount(0)
  expect(await app.posted('radar2')).toHaveLength(0)
  // settings: the map category has no radar groups, the hotkeys no radar actions
  await page.locator('[data-tip="Einstellungen"]').click()
  await page.locator('nav [data-tip="Karte"]').click()
  await expect(page.getByText('Mini-Radar', { exact: false })).toHaveCount(0)
  await page.locator('nav [data-tip="Hotkeys"]').click()
  await expect(page.getByText('Radar', { exact: false })).toHaveCount(0)
})

test('language switch de -> en', async ({ page }) => {
  await openApp(page)
  await page.locator('[data-tip="Einstellungen"]').click()
  await page.getByRole('combobox').filter({ hasText: /System/ }).click()
  await page.getByRole('option', { name: 'English' }).click()
  await expect(page.getByText('General', { exact: true }).first()).toBeVisible()
  await page.locator('[data-settings-close]').click()
  await expect(tab(page, 'Übersicht')).toHaveText(/Overview/)
  await shot(page, 'english')
})

test('multi-select pets -> find spot for the selection', async ({ page }) => {
  await openApp(page, { ui: { tab: 'targets', view: 'list' } })
  const tiles = page.locator('[data-pet]')
  await expect(page.locator('[data-pin]')).toHaveCount(0) // no checkboxes while nothing is selected
  const w0 = (await tiles.nth(4).boundingBox())!.width
  await tiles.nth(4).click()
  await tiles.nth(5).click()
  await tiles.nth(6).click()
  expect((await tiles.nth(4).boundingBox())!.width).toBe(w0) // selected tiles keep their size
  expect(await page.locator('[data-pin]').count()).toBeGreaterThan(3) // every tile shows its checkbox now
  const bar = page.locator('[data-selbar]')
  await expect(bar).toContainText('3 ausgewählt')
  await shot(page, 'multi-targets')
  await bar.getByRole('button', { name: 'Spot suchen' }).click()
  await expect(tab(page, 'Spots')).toHaveAttribute('data-on', 'on')
  await expect(bar).toContainText('Spots nur für deine Auswahl')
  await expect(page.locator('[data-spot="1"][data-sel]')).toBeVisible()
  await shot(page, 'multi-spots')
  await bar.getByRole('button', { name: /Auswahl aufheben/ }).click()
  await expect(page.locator('[data-selbar]')).toHaveCount(0)
})

test('tooltips: shadcn tooltip on hover, no native titles', async ({ page }) => {
  await calmClock(page)
  await openApp(page)
  expect(await page.locator('[title]').count()).toBe(0)
  await page.locator('[data-tip="Einstellungen"]').hover()
  await expect(page.locator('[data-slot=tooltip-content]')).toHaveText('Einstellungen')
  await shot(page, 'tooltip')
  const bar = await box(page, '[data-bar]') // empty end of the page bar: nothing with a tooltip below the mouse
  await page.mouse.move(bar.x + bar.width - 8, bar.y + bar.height / 2)
  await expect(page.locator('[data-slot=tooltip-content]')).toHaveCount(0)
})

test('bosses + timers: big bell toggles', async ({ page }) => {
  const app = await openApp(page, { ui: { tab: 'boss' } })
  const bell = page.locator('main button[data-tip="Ansage vor dem Respawn"]').first()
  await expect(bell).toBeVisible()
  const b = (await bell.boundingBox())!
  expect(b.height).toBeGreaterThanOrEqual(42)
  expect(b.width).toBeGreaterThanOrEqual(30)
  await bell.click()
  expect((await app.posted('ui')).some((m: { patch: { bossBells?: unknown } }) => m.patch.bossBells)).toBe(true)
  await shot(page, 'boss-bells')
  await goPage(page, 'Timer')
  await shot(page, 'timer-bells')
})

test('bosses: abyss bosses always available in their own group', async ({ page }) => {
  await openApp(page, { ui: { tab: 'boss' } })
  const abyss = page.locator('[data-disclosure="boss.abyss"]')
  await expect(abyss).toBeVisible({ timeout: 15000 })
  await expect(abyss.getByText('Abyss', { exact: true })).toBeVisible()
  await expect(page.locator('[data-boss="2600089"]')).toHaveCount(0) // closed by default off the Abyss map
  await abyss.locator('button').first().click()
  await expect(page.locator('[data-boss="2600089"]')).toBeVisible() // Watcher Kaira (Abyss)
  await page.locator('[data-boss="2600089"]').scrollIntoViewIfNeeded()
  await shot(page, 'boss-abyss')
})

test('timers: calendar, occurrence and series bells', async ({ page }) => {
  const app = await openApp(page, { ui: { tab: 'timer' } })
  await expect(page.locator('[data-cal]')).toBeVisible()
  const visibleDays = () => page.locator('[data-day]').evaluateAll(els => els.filter(e => getComputedStyle(e).display !== 'none').length)
  expect(await visibleDays()).toBe(3)
  await shot(page, 'timer-cal-640')
  // an upcoming occurrence (overrides of past ones are dropped right away)
  const key = await page.locator('[data-occ]').evaluateAll(els => els.map(e => e.getAttribute('data-occ')!).find(k => +k.split('|').pop()! > Date.now() + 3600e3))
  await page.locator(`[data-occ="${key}"]`).click()
  const pop = page.locator('[data-calpop]')
  await expect(pop).toBeVisible()
  await pop.getByRole('button', { name: /Nur dieser Termin/ }).click()
  expect((await app.posted('ui')).some((m: { patch: { timerOnce?: Record<string, boolean> } }) => m.patch.timerOnce && Object.values(m.patch.timerOnce).includes(false))).toBe(true)
  await shot(page, 'timer-cal-pop')
  await pop.getByRole('button', { name: /Alle/ }).click()
  expect((await app.posted('ui')).some((m: { patch: { timerOn?: unknown } }) => m.patch.timerOn)).toBe(true)
  await page.mouse.click(5, 790)
  await expect(pop).toHaveCount(0)
  await page.setViewportSize({ width: 2000, height: 1100 })
  expect(await visibleDays()).toBe(7)
  await shot(page, 'timer-cal-2000')
})

// Map background (Kartenstil): the coloured map rendered by the host (GameData.EnsureTerrain) or the relief.
// Screenshots map-style-{map,relief}-{640,2000}.png compare the two.
for (const [w, h] of [[640, 800], [2000, 1100]]) {
  test(`map style at ${w}x${h}: coloured map, switch to the relief in the settings`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h })
    // which image the canvas draws behind the markers
    await page.addInitScript(() => {
      const ctx = CanvasRenderingContext2D.prototype, draw = ctx.drawImage
      ctx.drawImage = function (this: CanvasRenderingContext2D, ...a: unknown[]) {
        const img = a[0]
        if (img instanceof HTMLImageElement && /\/data\/(maps|dungeons)\//.test(img.src)) (window as unknown as { __bg: string }).__bg = img.src.replace(/^.*\/data\//, '')
        return (draw as (...x: unknown[]) => void).apply(this, a)
      } as typeof ctx.drawImage
    })
    const bg = () => page.evaluate(() => (window as unknown as { __bg?: string }).__bg ?? '')
    const app = await openApp(page, { ui: { tab: 'targets', view: 'both', map: 'World_D_A', mapStyle: 'map' } })
    await expect.poll(async () => (await app.posted('needArt')).at(-1)?.key).toBe('World_D_A')
    // the coloured map once the app has rendered it into the cache, else the relief meanwhile
    const rendered = fs.readdirSync(path.join(CACHE, 'maps', 'World_D_A')).some(f => /^terrain-v\d+\.jpg$/.test(f))
    await expect.poll(bg).toMatch(rendered ? /^maps\/World_D_A\/terrain-v\d+\.jpg$/ : /^maps\/World_D_A\/relief\.png$/)
    await page.waitForTimeout(300)
    await shot(page, `map-style-map-${w}`)
    await page.locator('[data-tip="Einstellungen"]').click()
    await page.locator('nav [data-tip="Karte"]').click()
    await page.locator('div.flex-wrap', { hasText: 'Kartenstil' }).last().getByRole('combobox').click()
    await page.getByRole('option', { name: 'Relief' }).click()
    expect((await app.posted('ui')).at(-1)).toMatchObject({ patch: { mapStyle: 'relief' } })
    await page.locator('[data-settings-close]').click()
    await expect.poll(bg).toBe('maps/World_D_A/relief.png')
    await page.waitForTimeout(300)
    await shot(page, `map-style-relief-${w}`)
  })
}

test('header: fits at 360 px with every button, click-through always there, opacity only with Ctrl + wheel', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 700 })
  const app = await openApp(page)
  await app.send({ type: 'dock', dock: 'overlay', window: false })
  await app.send({ type: 'update', version: '9.9.0', page: 'https://example.invalid/', auto: true })
  const ct = page.locator('header [data-ct]')
  await expect(ct).toHaveAttribute('data-ct', 'off')
  await expect(page.locator('[data-update]')).toBeVisible()
  // nothing leaves the header, every control stays one line high
  for (const el of await page.locator('header > :not([data-drag])').all()) {
    const b = (await el.boundingBox())!
    expect(b.x + b.width).toBeLessThanOrEqual(360)
    expect(b.height).toBeLessThanOrEqual(32)
  }
  await shot(page, 'header-360')
  await ct.click()
  expect(await app.posted('clickThrough')).toHaveLength(1)
  await app.send({ type: 'clickThrough', on: true })
  await expect(ct).toHaveAttribute('data-ct', 'on')
  await ct.click() // still clickable while the rest of the app lets the mouse through
  expect(await app.posted('clickThrough')).toHaveLength(2)
  await app.send({ type: 'clickThrough', on: false })
  // plain wheel over the header does nothing, Ctrl + wheel changes the opacity
  await page.locator('header [data-drag]').first().hover()
  await page.mouse.wheel(0, -100)
  await page.waitForTimeout(100)
  expect(await app.posted('opacity')).toHaveLength(0)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -100)
  await page.keyboard.up('Control')
  await expect.poll(async () => (await app.posted('opacity')).length).toBe(1)
})
