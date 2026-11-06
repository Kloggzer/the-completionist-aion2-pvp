// Boss helper: the page (last fights with the Petze, bosses, guide, skill editor) and the live outputs to the host
// (centre callout 'bossCall', timer panel 'bossBars', Petze banner 'alert') from mocked boss events.
import { expect, test } from '@playwright/test'
import { hasCache, openApp } from './host'

test.skip(!hasCache(), 'needs the app data cache in %LOCALAPPDATA%\TheCompletionist\cache (start the app once)')

const ATIEL = 2343601
const fightLog = {
  npc: ATIEL, name: 'Atiel', at: Date.UTC(2026, 9, 27, 22, 18), dur: 162, died: true, marks: [16.5],
  casts: [[1801460, 9.4], [1801450, 16.2], [1801510, 36.6]],
  blame: [{ name: 'Testdaevi', me: false, hits: 2, skills: [{ skill: 1801450, name: 'Skill 1801450', n: 2 }] }],
}

test('page: last fights with the Petze, the guide and the skill editor', async ({ page }) => {
  const h = await openApp(page, { ui: { tab: 'bossmod', bossMod: true, bossFights: [fightLog] } })
  const row = page.locator('[data-fight="0"]')
  await expect(row).toContainText('Atiel')
  await expect(row.locator('[data-blame="Testdaevi"]')).toContainText('2×')
  await row.click()
  // timeline with the fight's casts and the marker, the guide with Frenzy and placeholder phases
  await expect(page.locator('[data-bm-timeline] circle').first()).toBeVisible()
  await expect(page.locator('[data-bm-guide]')).toContainText('Phase 2')
  await expect(page.locator('[data-bm-guide]')).toContainText('Werte folgen')
  // the skill cast right before the marker is highlighted, naming it saves the own setting
  await expect(page.locator('[data-bm-skill="1801450"]')).toHaveClass(/bg-gold/)
  await page.locator('[data-bm-name="1801450"]').fill('Sprung')
  const ui = (await h.posted('ui')).map((m: { patch: Record<string, unknown> }) => m.patch).filter(p => p.bossSkills).at(-1)
  expect(ui?.bossSkills).toEqual({ 1801450: { name: 'Sprung' } })
  await page.screenshot({ path: 'e2e/.out/shots/bossmod-detail.png', fullPage: true })
})

test('live: callout, timer panel and the Petze after the fight', async ({ page }) => {
  const h = await openApp(page, { ui: { tab: 'bossmod', bossMod: true, bossSkills: { 1801450: { name: 'Sprung', kind: 'dodge' } } } })
  await expect(page.locator('[data-bm-boss]').first()).toBeVisible() // timelines loaded
  const at = Date.now()
  await h.send({ type: 'bossHp', npc: ATIEL, ent: 7, hp: 1000, at })
  await h.send({ type: 'bossCast', npc: ATIEL, ent: 7, skill: 1801450, seq: 1, tgt: 3, me: true, name: 'Testdaeva', at })
  await expect.poll(async () => (await h.posted('bossCall')).map((m: { title: string }) => m.title)).toContainEqual(expect.stringContaining('Sprung'))
  const callout = (await h.posted('bossCall')).find((m: { title: string }) => m.title.includes('Sprung'))
  expect(callout).toMatchObject({ danger: true, col: '#ff6a5c', sound: 'close' }) // aimed at oneself: the urgent sound
  expect(callout.title).toContain('AUF DICH')
  await expect.poll(async () => (await h.posted('bossBars')).some((m: { title?: string }) => m.title === 'Atiel')).toBe(true)
  const bars = (await h.posted('bossBars')).filter((m: { title?: string }) => m.title === 'Atiel').at(-1)
  expect(bars.rows[0][0]).toBe('Sprung')
  expect(bars.rows[0][4]).toBe('WEG')
  expect(bars.frenzy).toBeGreaterThan(290)
  // two players hit by the avoidable attack: Petze banner after the kill
  await h.send({ type: 'bossHit', npc: ATIEL, ent: 7, skill: 1801450, tgt: 3, name: 'Testdaeva', me: true, flags: 0, at: at + 500 })
  await h.send({ type: 'bossHit', npc: ATIEL, ent: 7, skill: 1801450, tgt: 4, name: 'Testdaevi', me: false, flags: 0, at: at + 600 })
  await h.send({ type: 'bossHit', npc: ATIEL, ent: 7, skill: 1801540, tgt: 5, name: 'Other', me: false, flags: 0, at: at + 700 })
  await h.send({ type: 'bossGone', npc: ATIEL, ent: 7, died: true, at: at + 2000 })
  await expect.poll(async () => (await h.posted('alert')).map((m: { title: string; sub: string }) => m.title + ' | ' + m.sub))
    .toContainEqual(expect.stringMatching(/Atiel: Mechanik nicht gespielt \| (Testdaeva 1×, Testdaevi 1×|Testdaevi 1×, Testdaeva 1×)/))
  await expect(page.locator('[data-fight="0"]')).toContainText('Atiel')
})

test('test pull plays the timeline', async ({ page }) => {
  const h = await openApp(page, { ui: { tab: 'bossmod', bossMod: true } })
  await page.locator(`[data-bm-boss="${ATIEL}"]`).click()
  await page.locator('[data-bm-test]').click()
  await expect.poll(async () => (await h.posted('bossBars')).length, { timeout: 5000 }).toBeGreaterThan(0)
})
