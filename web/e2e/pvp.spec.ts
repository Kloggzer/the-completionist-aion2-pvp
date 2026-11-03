// PvP overlay: the host's decoded players ('pvp', as PlayerFrames.cs reads them from captures/20261019-201703)
// become the rows of the native list window ('pvp2', drawn by PvpForm.cs): enemies (arena: CP high to low, elsewhere
// nearest first), limited, CP coloured
// against the own CP, missing CP looked up on the character website (mock: 'pvpLookup' -> 'pvpWeb'); below them the own
// team (arena roster team / party, self marked).
import { expect, test } from '@playwright/test'
import { hasCache, openApp } from './host'

test.skip(!hasCache(), 'needs the app data cache in %LOCALAPPDATA%\\TheCompletionist\\cache (start the app once)')

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any

const own = { name: 'Testdaeva', srv: 2306, pc: 12, race: 2, lv: 45, il: 2592, cp: 138355 }
// [entity, name, server, pcId, race, level, item level, CP, x, z]
const players = [
  [1548, 'Maestro', 2306, 15, 2, 45, 2567, 131827, -69.7, 4.6],
  [9875, 'Ley', 2303, 12, 2, 45, 2785, 142671, -77.4, -0.6],
  [13933, 'Senbonzakura', 2312, 16, 2, 45, 2165, 93474, 74.4, -3.1],
  [14424, 'Kanapenia', 2307, 32, 2, 45, 2666, 144611, 70.5, 0.7],
  [10762, 'Miranda', 1308, 30, 1, 45, 1595, 85849, 70.5, 3.3],
  [14220, 'Animuz', 2312, 7, 2, 45, 2565, 130428, 75.6, -4.4],
  [1106, 'shanfen', 2304, 23, 2, 45, 2500, 0, 69.2, 3.3],
]
const roster = [
  ['Testdaeva', 2306, 12, 1], ['Maestro', 2306, 15, 1], ['Ley', 2303, 12, 1], ['LaGuente', 2303, 12, 1], ['Hieii', 2303, 8, 1],
  ['Kanapenia', 2307, 32, 2], ['Miranda', 1308, 30, 2], ['Animuz', 2312, 7, 2], ['Senbonzakura', 2312, 16, 2], ['shanfen', 2304, 23, 2],
].map(([name, srv, pc, team]) => ({ name, srv, pc, race: srv === 1308 ? 1 : 2, lv: 45, team }))
// own party (0x92): [name, server, pcId, level, item level, CP]
const party = [
  ['Ley', 2303, 12, 45, 2785, 142671], ['LaGuente', 2303, 12, 45, 2805, 152349], ['Hieii', 2303, 8, 45, 2796, 164468],
  ['Maestro', 2306, 15, 45, 2567, 131827], ['Testdaeva', 2306, 12, 45, 2592, 138355],
]

const lastRows = async (app: Any) => (await app.posted('pvp2')).at(-1)

test('arena: enemy team by CP (high to low), CP colours, website lookup for a missing CP', async ({ page }) => {
  await page.addInitScript(() => { (window as Any).__pvpWeb = { 'shanfen@2304': { cp: 120942, il: 2500, cls: 'Spiritmaster' } } })
  const app = await openApp(page)
  await app.send({ type: 'pos', pos: { x: -75, z: 0, y: 39 } })
  await app.send({ type: 'pvp', own, roster, players })
  await expect.poll(async () => (await lastRows(app))?.rows?.length).toBe(5)
  let m = await lastRows(app)
  expect(m.title).toBe('Arena · 5 vs 5')
  expect(m.rows.map((r: Any) => r.n)).toEqual(['Kanapenia', 'Animuz', 'Senbonzakura', 'Miranda', 'shanfen'])
  expect(m.rows[0]).toEqual({ c: 'Kle', k: 8, cc: '#f2eaa0', n: 'Kanapenia', sub: 'Ereshkigal', il: '2666', cp: '144,6K', col: '#f0c75e', bar: '#f0c75e', d: '146 m', f: 1 })
  // oneself is a row of the team section: no footer text
  expect(m).toMatchObject({ foot: '', footCls: '', footK: 0, status: '', enemyHead: 'Gegner · 5', teamHead: 'Team · 5' })
  expect(m.team[0]).toMatchObject({ n: 'Testdaeva', k: 3, d: 'Ich', me: 1, cp: '138,4K' })
  expect(m.rows.find((r: Any) => r.n === 'Miranda')).toMatchObject({ c: 'Kle', sub: 'Meslamtaeda', il: '1595', col: '#7ee0a0' })
  expect(m.rows.find((r: Any) => r.n === 'Animuz')).toMatchObject({ c: 'Gla', col: '#f0c75e', d: '151 m' })
  // shanfen had no CP in the packet: after 3 s looked up once, then shown with the website value
  expect(m.rows[4]).toMatchObject({ n: 'shanfen', cp: '?' })
  // (and the two mates out of range without party data; oneself never)
  await expect.poll(async () => (await app.posted('pvpLookup')).map((x: Any) => x.name)).toEqual(['shanfen', 'Hieii', 'LaGuente'])
  await expect.poll(async () => (await lastRows(app)).rows[2].cp).toBe('120,9K')
  m = await lastRows(app)
  expect(m.rows.map((r: Any) => r.n)).toEqual(['Kanapenia', 'Animuz', 'shanfen', 'Senbonzakura', 'Miranda'])
  expect(m.rows[2]).toMatchObject({ n: 'shanfen', c: 'Bes', sub: 'Lumiel', il: '2500', col: '#7ee0a0' })
  expect(m).toMatchObject({ status: 'plaync ok', statusCol: '#60d678' })
  expect(await app.posted('pvpLookup')).toHaveLength(3)
  // an enemy moves away: only the distance changes, the order stays (CP)
  await app.send({ type: 'pvp', own, roster, players: players.map(p => (p[1] === 'shanfen' ? [...p.slice(0, 8), 150, 40] : p)) })
  await expect.poll(async () => (await lastRows(app)).rows[2]).toMatchObject({ n: 'shanfen', d: '229 m' })
  // match over: everyone despawns (0x4736 reason 0a) -> nobody listed although the roster is still known
  await app.send({ type: 'pvp', own, roster, players: [] })
  await expect.poll(async () => (await lastRows(app)).rows.length).toBe(0)
  expect(await app.posted('pvpLookup')).toHaveLength(3)
})

test('arena: both teams, own party fills CP of mates out of range; team section off -> enemies only + footer', async ({ page }) => {
  const app = await openApp(page)
  await app.send({ type: 'pvp', own, roster, players, party, me: [-75, 0, 50] })
  await expect.poll(async () => (await lastRows(app))?.team?.length).toBe(5)
  let m = await lastRows(app)
  expect(m.title).toBe('Arena · 5 vs 5')
  expect(m.team.map((r: Any) => r.n)).toEqual(['Testdaeva', 'Hieii', 'LaGuente', 'Ley', 'Maestro'])
  expect(m.team.find((r: Any) => r.n === 'LaGuente')).toMatchObject({ c: 'Tem', k: 3, sub: 'Triniel', il: '2805', cp: '152,3K', col: '#dde2ec', bar: '#5b9cff', d: '–' })
  expect(m.team.find((r: Any) => r.n === 'Ley')).toMatchObject({ d: '2 m' })
  expect(m.team.filter((r: Any) => r.me)).toHaveLength(1)
  // bars of both sections on one scale: Hieii (164.5K) is the strongest
  expect(m.team.find((r: Any) => r.n === 'Hieii').f).toBe(1)
  expect(m.rows.find((r: Any) => r.n === 'Kanapenia').f).toBeCloseTo(0.879, 3)

  await page.locator('[data-tip="Einstellungen"]').click()
  await page.locator('nav [data-tip="Karte & Radar"]').click()
  await page.locator('[data-disclosure="set.pvp.fine"] button[aria-expanded]').click()
  const teamLimit = page.locator('div.flex-wrap', { hasText: 'Team-Zeilen' }).last()
  await expect(teamLimit).toContainText('6')
  for (let i = 0; i < 3; i++) await teamLimit.getByRole('button').first().click()
  expect((await app.posted('pvpCfg')).at(-1)).toMatchObject({ teamLimit: 3 })
  await expect.poll(async () => (await lastRows(app)).team.map((r: Any) => r.n)).toEqual(['Testdaeva', 'Hieii', 'LaGuente'])
  expect((await lastRows(app)).teamHead).toBe('Team · 3/5')
  await page.screenshot({ path: 'e2e/.out/shots/pvp-team-settings.png' })

  await page.locator('div.flex-wrap', { hasText: 'Eigenes Team anzeigen' }).last().getByRole('switch').click()
  expect((await app.posted('pvpCfg')).at(-1)).toMatchObject({ team: false })
  await expect.poll(async () => (await lastRows(app)).team).toBeUndefined()
  m = await lastRows(app)
  expect(m.title).toBe('Arena · 5 Gegner')
  expect(m).toMatchObject({ foot: 'Testdaeva · 138,4K', footCls: 'Tem', footK: 3, footCol: '#a9bdd6' })
  await expect(page.getByText('Team-Zeilen')).toHaveCount(0)
})

test('open world: party duo as team (member out of range included), same faction is no team', async ({ page }) => {
  const app = await openApp(page)
  await app.send({ type: 'zone', id: 1110 }) // Altgard
  await app.send({ type: 'pos', pos: { x: -440, z: 495, y: 166 } })
  const world = [
    [1, 'Chika7ilo', 1306, 29, 1, 45, 940, 40913, -378.6, 451.6],
    [2, 'Drei8Sechs', 2306, 32, 2, 45, 1730, 82455, -438.9, 496.6],
  ]
  await app.send({ type: 'pvp', own, roster: null, players: world, party: party.filter(p => p[0] === 'Maestro' || p[0] === 'Testdaeva') })
  await expect.poll(async () => (await lastRows(app))?.team?.map((r: Any) => r.n)).toEqual(['Testdaeva', 'Maestro'])
  const m = await lastRows(app)
  expect(m.title).toBe('Altgard · 1 Gegner')
  expect(m.rows.map((r: Any) => r.n)).toEqual(['Chika7ilo'])
  expect(m.team[1]).toMatchObject({ c: 'Jäg', k: 4, sub: 'Azphel', il: '2567', cp: '131,8K', d: '–' })
  expect(m).toMatchObject({ enemyHead: 'Gegner · 1', teamHead: 'Team · 2' })
})

test('open world: other faction only, zone title, empty list, settings: all players + limit', async ({ page }) => {
  const app = await openApp(page)
  await app.send({ type: 'zone', id: 1110 }) // Altgard
  await app.send({ type: 'pos', pos: { x: -440, z: 495, y: 166 } })
  const world = [
    [1, 'Chika7ilo', 1306, 29, 1, 45, 940, 40913, -378.6, 451.6],
    [2, 'Drei8Sechs', 2306, 32, 2, 45, 1730, 82455, -438.9, 496.6],
    [3, 'SamAdriel', 1306, 9, 1, 45, 1052, 57829, -328.1, 383.4],
    [4, 'Tyla', 1306, 26, 1, 45, 1164, 61861, -302.6, 364.2],
  ]
  await app.send({ type: 'pvp', own, roster: null, players: world })
  await expect.poll(async () => (await lastRows(app))?.rows?.map((r: Any) => r.n)).toEqual(['Chika7ilo', 'SamAdriel', 'Tyla'])
  expect((await lastRows(app)).title).toBe('Altgard · 3 Gegner')
  expect((await lastRows(app)).rows[0]).toMatchObject({ c: 'Kle', sub: 'Ariel', il: '940', d: '75 m', col: '#7ee0a0' })

  await page.locator('[data-tip="Einstellungen"]').click()
  await page.locator('nav [data-tip="Karte & Radar"]').click()
  await expect(page.getByText('PvP-Liste anzeigen')).toBeVisible()
  await page.locator('div.flex-wrap', { hasText: 'Alle Spieler' }).last().getByRole('switch').click()
  expect((await app.posted('pvpCfg')).at(-1)).toMatchObject({ all: true })
  await expect.poll(async () => (await lastRows(app)).rows.map((r: Any) => r.n)).toEqual(['Drei8Sechs', 'Chika7ilo', 'SamAdriel', 'Tyla'])
  expect((await lastRows(app)).title).toMatch(/ · 4 Spieler$/)
  await page.locator('[data-disclosure="set.pvp.fine"] button[aria-expanded]').click()
  const limit = page.locator('div.flex-wrap', { hasText: 'Anzahl Zeilen' }).last()
  await expect(limit).toContainText('8')
  for (let i = 0; i < 6; i++) await limit.getByRole('button').first().click()
  expect((await app.posted('pvpCfg')).at(-1)).toMatchObject({ limit: 2 })
  await expect.poll(async () => (await lastRows(app)).title).toMatch(/ · 2\/4 Spieler$/)
  await page.screenshot({ path: 'e2e/.out/shots/pvp-settings.png' })

  // everyone gone (map change): the window gets an empty list and hides itself (auto)
  await app.send({ type: 'pvp', own, roster: null, players: [] })
  await expect.poll(async () => (await lastRows(app)).rows.length).toBe(0)
  expect((await lastRows(app)).empty).toBe('keine Gegner in der Nähe')
})

test('arena: own position from the PvP fix of the host (arena coordinates around 0/0), not from the old map', async ({ page }) => {
  const app = await openApp(page)
  await app.send({ type: 'pos', pos: { x: -440, z: 495, y: 166 } }) // open world, before the arena
  await page.waitForTimeout(1700) // (a fix up to 1.5 s before the map change counts: the teleport frame comes first)
  await app.send({ type: 'zone', id: 60 })
  await app.send({ type: 'pvp', own, roster, players })
  await expect.poll(async () => (await lastRows(app))?.rows?.length).toBe(5)
  expect((await lastRows(app)).rows.every((r: Any) => r.d === '–')).toBe(true) // no own position in the arena yet
  await app.send({ type: 'pvp', own, roster, players, me: [-75, 0, 120] })
  await expect.poll(async () => (await lastRows(app)).rows[0]).toMatchObject({ n: 'Kanapenia', d: '146 m' })
})

test('overlay windows: edit mode from the settings (PvP list, announcer, alert banner)', async ({ page }) => {
  const app = await openApp(page)
  await page.locator('[data-tip="Einstellungen"]').click()
  await page.locator('nav [data-tip="Benachrichtigungen"]').click()
  const btn = page.locator('[data-win-edit]')
  await expect(btn).toHaveText('Lösen')
  await btn.click()
  expect((await app.posted('winEdit')).length).toBe(1)
  await expect(btn).toHaveText('Fixieren')
  await expect(btn).toHaveAttribute('data-win-edit', 'edit')
  await btn.click()
  await expect(btn).toHaveText('Lösen')
  // the same switch in the PvP group
  await page.locator('nav [data-tip="Karte & Radar"]').click()
  await expect(page.locator('[data-win-edit]')).toHaveText('Lösen')
  await expect(page.getByText('Fenster verschieben').first()).toBeVisible()
})

test('settings button of the window opens the PvP settings', async ({ page }) => {
  const app = await openApp(page)
  await app.send({ type: 'openSettings', cat: 'map' })
  await expect(page.getByText('PvP-Liste anzeigen')).toBeVisible()
  await expect(page.locator('nav [data-tip="Karte & Radar"]')).toHaveAttribute('data-on', 'on')
})

test('list and enemy feed switched off: no more rows are posted', async ({ page }) => {
  const app = await openApp(page)
  await page.locator('[data-tip="Einstellungen"]').click()
  await page.locator('nav [data-tip="Karte & Radar"]').click()
  await page.locator('div.flex-wrap', { hasText: 'PvP-Liste anzeigen' }).last().getByRole('switch').click()
  expect((await app.posted('pvpWin')).at(-1)).toMatchObject({ on: false })
  await page.locator('div.flex-wrap', { hasText: 'Gegner-Feed (Widget)' }).last().getByRole('switch').click()
  expect((await app.posted('pvpCfg')).at(-1)).toMatchObject({ feed: false })
  const before = (await app.posted('pvp2')).length
  await app.send({ type: 'pvp', own, roster: null, players: [[1, 'Chika7ilo', 1306, 29, 1, 45, 940, 40913, 0, 0]] })
  await page.waitForTimeout(700)
  expect((await app.posted('pvp2')).length).toBe(before)
})

test('enemy alarm: red banner + sound when an enemy comes into range, a sharper one when close, once per enemy', async ({ page }) => {
  const app = await openApp(page)
  await app.send({ type: 'zone', id: 1110 }) // Altgard
  await app.send({ type: 'pos', pos: { x: -440, z: 495, y: 166 } })
  const at = (x: number) => [[7, 'Chika7ilo', 1306, 29, 1, 45, 940, 40913, x, 495]]
  await app.send({ type: 'pvp', own, roster: null, players: at(-410) }) // 30 m
  await expect.poll(async () => (await app.posted('alert')).length).toBe(1)
  expect((await app.posted('alert'))[0]).toMatchObject({ title: '⚔ Chika7ilo · Kle · 30 m', sub: '', sound: 'pvp', danger: true, always: true })
  // the window turns red: urgency 1, distance orange, blink time stamp, ⚔ in the title
  await expect.poll(async () => (await lastRows(app))?.urg).toBe(1)
  expect(await lastRows(app)).toMatchObject({ alarmAt: expect.any(Number), rows: [expect.objectContaining({ dc: '#ffa94d' })] })
  expect((await lastRows(app)).title.startsWith('⚔ ')).toBe(true)
  // still there: no new alarm; comes close: the sharper one
  await page.waitForTimeout(700)
  expect((await app.posted('alert')).length).toBe(1)
  await app.send({ type: 'pvp', own, roster: null, players: at(-425) }) // 15 m
  await expect.poll(async () => (await app.posted('alert')).length).toBe(2)
  expect((await app.posted('alert'))[1]).toMatchObject({ title: '⚠ Chika7ilo · Kle · 15 m', sound: 'pvpClose' })
  await expect.poll(async () => (await lastRows(app))?.urg).toBe(2)
  // the enemy dies: the banner goes at once
  await app.send({ type: 'pvp', own, roster: null, players: [[7, 'Chika7ilo', 1306, 29, 1, 45, 940, 40913, -425, 495, 2]] })
  await expect.poll(async () => (await app.posted('alertHide')).length).toBe(1)
})

test('enemy feed: rows still go to the host with the PvP list off, nothing with both off', async ({ page }) => {
  const app = await openApp(page)
  const cfg = { on: false, locked: true, auto: true, scale: 1, alpha: 0.9, limit: 8, all: false, team: true, teamLimit: 6, feed: true }
  await app.send({ type: 'pvpWin', pvp: cfg })
  await app.send({ type: 'zone', id: 1110 })
  await app.send({ type: 'pos', pos: { x: -440, z: 495, y: 166 } })
  await app.send({ type: 'pvp', own, roster: null, players: [[7, 'Chika7ilo', 1306, 29, 1, 45, 940, 40913, -410, 495]] })
  await expect.poll(async () => (await lastRows(app))?.rows?.map((r: Any) => r.n)).toEqual(['Chika7ilo'])
  const before = (await app.posted('pvp2')).length
  await app.send({ type: 'pvpWin', pvp: { ...cfg, feed: false } })
  await app.send({ type: 'pvp', own, roster: null, players: [[8, 'Tyla', 1306, 26, 1, 45, 1164, 61861, -420, 495]] })
  await page.waitForTimeout(800)
  expect((await app.posted('pvp2')).length).toBe(before)
})

test('dungeon: no alarm, no enemies, the boss panel instead (Frenzy, mechanics)', async ({ page }) => {
  const app = await openApp(page)
  await app.send({ type: 'zone', id: 600001 }) // Krao Cave (aion2maps instance index)
  await app.send({ type: 'pvp', own, roster: null, players: [[7, 'Chika7ilo', 1306, 29, 1, 45, 940, 40913, 0, 0]] })
  await expect.poll(async () => (await lastRows(app))?.title).toBe('Krao Cave')
  const m = await lastRows(app)
  expect(m.rows).toEqual([])
  expect(m.urg).toBe(0)
  expect(m.panel[0].h).toMatch(/^Ultimate Berk/)
  expect(m.panel[0].tab).toBe('Bosse')
  expect(m.panel[0].l[0].t).toBe('Frenzy 5:00 Conquest · 4:00 Hard')
  // tabs: Bosse, Runs (mode + item level, Abyss Logs history), Loot (per mode, the current one first)
  expect([...new Set(m.panel.map((s: Any) => s.tab))]).toEqual(['Bosse', 'Runs', 'Loot'])
  await expect.poll(async () => (await lastRows(app))?.panel.find((s: Any) => s.tab === 'Runs')?.l[0]?.t).toMatch(/^iLvl 700/)
  // own loot (inventory gains from the host) on the run: this run first, then all runs, then the table
  await app.send({ type: 'loot', items: [[110120003, 1], [610610013, 4]] })
  await expect.poll(async () => (await lastRows(app))?.panel.find((s: Any) => s.tab === 'Loot')?.h).toBe('Dieser Run: 5 Items')
  const own2 = (await lastRows(app)).panel.filter((s: Any) => s.tab === 'Loot')
  expect(own2[0].l[0].t).toBe("Ludra's Blade of Extinction")
  expect(own2[1].h).toBe('Gesamt: 1 Runs · Ø 5.0 Items')
  expect(own2[2].h).toMatch(/^Tabelle Conquest · \d+ Items/)
  expect(m.panel[0].l.map((x: Any) => x.t).join('|')).toContain('Wave of Fury · 6 s → hinter Deckung')
  await page.waitForTimeout(700)
  const al = await app.posted('alert'); expect(al.map((a: Any) => a.title)).toEqual([])
})
