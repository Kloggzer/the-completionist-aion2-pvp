// Farm tab: resource picker, ranked hotspots with a route, "switch" to the next spot. Mocked host, real map data
// from the app cache (needs maps/<key>/gather.json + drops.json, fetched by GameData.EnsureMap).
import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { CACHE, hasCache, openApp } from './host'

const hasFarm = () => fs.existsSync(path.join(CACHE, 'maps', 'World_D_A', 'gather.json'))
test.skip(!hasCache() || !hasFarm(), 'needs the app data cache incl. gather.json/drops.json for Altgard')

const shot = (page: import('@playwright/test').Page, name: string) => page.screenshot({ path: `e2e/.out/shots/${name}.png` })

for (const [res, title] of [['g:Odyle', 'odyle'], ['d:610530011', 'leather']] as const) {
  test(`hotspots and route for ${title}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 })
    await openApp(page, { ui: { tab: 'farm', farmRes: res } })
    const tiles = page.locator('[data-farmspot]')
    await expect(tiles.first()).toBeVisible({ timeout: 15000 })
    expect(await tiles.count()).toBeGreaterThanOrEqual(2)
    await shot(page, `farm-${title}-list`)

    await tiles.first().click()
    await expect(tiles.first()).toHaveAttribute('data-sel', 'true')
    await shot(page, `farm-${title}-route`)

    // "Ausweichen" moves on to the next hotspot
    await page.getByRole('button', { name: 'Ausweichen' }).click()
    await expect(page.locator('[data-farmspot="2"]')).toHaveAttribute('data-sel', 'true')
    await shot(page, `farm-${title}-switched`)
  })
}

test('resource choice is saved', async ({ page }) => {
  const { posted } = await openApp(page, { ui: { tab: 'farm', farmRes: 'g:Odyle' } })
  await expect(page.locator('[data-farmspot]').first()).toBeVisible({ timeout: 15000 })
  await page.locator('[data-slot=select-trigger]').filter({ hasText: 'Odyle' }).click()
  await page.getByRole('option', { name: /Asvata/ }).click()
  await expect.poll(async () => (await posted('ui')).some((m: { patch: { farmRes?: string } }) => m.patch.farmRes === 'g:Asvata')).toBe(true)
})
