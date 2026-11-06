// Markt page: skins on the market with verdicts from mocked aion2.exchange answers (the host proxy is mocked in
// e2e/host.ts and fetches https://aion2.exchange/api/..., routed here to fixtures).
import { expect, test, type Page } from '@playwright/test'
import { hasCache, openApp } from './host'

test.skip(!hasCache(), 'needs the app data cache in %LOCALAPPDATA%\\TheCompletionist\\cache (start the app once)')

// real unlock item ids of web/public/skins.json
const APPLE = 516010007 // Apple Candy (Helm, Epic): fair price
const items = (over: Record<number, { price: number | null; listings: number }>) => ({
  total: 3, items: Object.entries(over).map(([k, v]) => ({ item_key: +k, name: 'x', category: { section_id: 'skins' }, price: v.price, listings: v.listings,
    last_price: v.price, captured_at: new Date().toISOString() })),
})
const usual: Record<number, number> = { [APPLE]: 400_000 }

async function mock(page: Page, list: Record<number, { price: number | null; listings: number }>) {
  await page.route('https://aion2.exchange/api/items?**', r => r.fulfill({ json: items(list) }))
  await page.route('https://aion2.exchange/api/items/*/prices?**', r => {
    const key = +r.request().url().split('/items/')[1].split('/')[0], med = usual[key] ?? 500_000
    const points = Array.from({ length: 24 }, (_, i) => ({
      ts: new Date(Date.now() - (24 - i) * 3_600_000).toISOString(), low: med, close: med, listings: 10 - (i % 3), listings_min: 8, listings_max: 10,
    }))
    return r.fulfill({ json: { points } })
  })
}

test('skins to buy: bargain first, fair price, too dear, owned', async ({ page }) => {
  const data = await (await fetch('http://localhost:4173/skins.json')).json() as { items: { item: number; cat: string }[] }
  const jewel = data.items.find(s => s.cat === 'Earrings')!.item
  const dear = data.items.find(s => s.cat === 'Gloves')!.item
  usual[jewel] = 800_000
  await mock(page, { [APPLE]: { price: 400_000, listings: 18 }, [jewel]: { price: 500_000, listings: 3 }, [dear]: { price: 5_000_000, listings: 1 } })
  const h = await openApp(page, { ui: { tab: 'market', marketSrv: 2306 } })
  const buy = page.locator('[data-mkt-buy]')
  await expect(buy.locator(`[data-skin="${jewel}"]`)).toHaveAttribute('data-kind', 'deal')
  await expect(buy.locator(`[data-skin="${APPLE}"]`)).toHaveAttribute('data-kind', 'buy')
  // bargain first
  await expect(buy.locator('[data-skin]').first()).toHaveAttribute('data-skin', String(jewel))
  // the dear one sits behind "Zu teuer", the unlisted ones behind "Nicht im Angebot"
  await expect(page.locator(`[data-skin="${dear}"]`)).toHaveCount(0)
  await page.locator('[data-disclosure="mkt.wait"] button').first().click()
  await expect(page.locator(`[data-skin="${dear}"]`)).toHaveAttribute('data-kind', 'wait')
  // marking one as owned moves it out of "buy now" and is saved
  await buy.locator(`[data-have="${APPLE}"]`).click()
  await expect(buy.locator(`[data-skin="${APPLE}"]`)).toHaveCount(0)
  expect((await h.posted('ui')).some((m: { patch: { skinOwned?: Record<string, boolean> } }) => m.patch.skinOwned?.[APPLE])).toBe(true)
  // the requests went through the host proxy with the server id and the skins section
  const paths = (await h.posted('market')).map((m: { path: string }) => m.path)
  expect(paths[0]).toBe('/api/items?server=12306&section=skins&limit=100')
  expect(paths.some((p: string) => p.startsWith(`/api/items/${APPLE}/prices?server=12306&from=`))).toBe(true)
  await page.screenshot({ path: 'e2e/.out/shots/market.png', fullPage: true })
})

test('unknown server: a chooser instead of prices', async ({ page }) => {
  await page.route('https://aion2.exchange/api/servers', r => r.fulfill({ json: { servers: [{ server_id: 12306, name: 'Azphel', game_server_key: 2306, region: 'EU', faction: 'Asmodian' }] } }))
  await openApp(page, { ui: { tab: 'market' } })
  await expect(page.getByText('Dein Server ist noch nicht bekannt')).toBeVisible()
})
