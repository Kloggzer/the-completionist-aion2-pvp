// Markt page: one list of the skins on the market, cheapest first, owned ones hidden; prices from mocked aion2.exchange
// answers (the host proxy is mocked in e2e/host.ts and fetches https://aion2.exchange/api/..., routed here to fixtures).
import { expect, test, type Page } from '@playwright/test'
import { hasCache, openApp } from './host'

test.skip(!hasCache(), 'needs the app data cache in %LOCALAPPDATA%\\TheCompletionist\\cache (start the app once)')

const APPLE = 516010007 // Apple Candy (Helm): real unlock item id of web/public/skins.json
type L = Record<number, { price: number | null; listings: number }>

async function mock(page: Page, list: L) {
  await page.route('https://aion2.exchange/api/items?**', r => r.fulfill({ json: {
    total: Object.keys(list).length, items: Object.entries(list).map(([k, v]) => ({ item_key: +k, name: 'x', category: { section_id: 'skins' }, price: v.price,
      listings: v.listings, last_price: v.price, captured_at: new Date().toISOString() })),
  } }))
  await page.route('https://aion2.exchange/api/items/*/prices?**', r => r.fulfill({ json: { points: Array.from({ length: 24 }, (_, i) => ({
    ts: new Date(Date.now() - (24 - i) * 3_600_000).toISOString(), low: 500_000, close: 500_000, listings: 5, listings_min: 5, listings_max: 5,
  })) } }))
}
const order = (page: Page) => page.locator('[data-mkt-list] tbody tr').evaluateAll(rs => rs.map(r => +(r as HTMLElement).dataset.skin!))

test('one list, cheapest first, owned ones hidden', async ({ page }) => {
  const data = await (await fetch('http://localhost:4173/skins.json')).json() as { items: { item: number; skin: number; cat: string }[] }
  const jewel = data.items.find(s => s.cat === 'Earrings')!.item, dear = data.items.find(s => s.cat === 'Gloves')!.item
  await mock(page, { [jewel]: { price: 500_000, listings: 3 }, [APPLE]: { price: 400_000, listings: 18 }, [dear]: { price: 5_000_000, listings: 1 } })
  const h = await openApp(page, { ui: { tab: 'market', marketSrv: 2306 } })
  await expect(page.locator(`[data-mkt-list] tr[data-skin="${APPLE}"]`)).toBeVisible()
  // cheapest first, then dearer, the unlisted ones after them; no cards
  expect((await order(page)).slice(0, 3)).toEqual([APPLE, jewel, dear])
  expect(await order(page)).toHaveLength(data.items.length)
  await expect(page.locator(`tr[data-skin="${APPLE}"] td`).nth(4)).toHaveText(/400[.,]000/)
  // marked by hand: hidden, saved
  await page.locator(`[data-have="${APPLE}"]`).click()
  await expect(page.locator(`tr[data-skin="${APPLE}"]`)).toHaveCount(0)
  expect((await h.posted('ui')).some((m: { patch: { skinOwned?: Record<string, boolean> } }) => m.patch.skinOwned?.[APPLE])).toBe(true)
  // the game's wardrobe (0x5b8d): owned ones hidden too, shown with the switch, marked as from the game
  const jewelSkin = data.items.find(s => s.item === jewel)!.skin
  await h.send({ type: 'skins', ids: [10001101, jewelSkin] })
  await expect(page.locator(`tr[data-skin="${jewel}"]`)).toHaveCount(0)
  await expect(page.locator('[data-bar]')).toContainText('Kleiderschrank 2')
  await page.locator('[data-owned-toggle]').click()
  await expect(page.locator(`[data-ingame="${jewel}"]`)).toBeVisible()
  // the requests went through the host proxy with the server id and the skins section
  const paths = (await h.posted('market')).map((m: { path: string }) => m.path)
  expect(paths[0]).toBe('/api/items?server=12306&section=skins&limit=100')
  // the histories come one after the other
  await expect.poll(async () => (await h.posted('market')).some((m: { path: string }) => m.path.startsWith(`/api/items/${APPLE}/prices?server=12306&from=`)), { timeout: 10_000 }).toBe(true)
  await page.screenshot({ path: 'e2e/.out/shots/market.png', fullPage: true })
})

test('unknown server: a chooser instead of prices', async ({ page }) => {
  await page.route('https://aion2.exchange/api/servers', r => r.fulfill({ json: { servers: [{ server_id: 12306, name: 'Azphel', game_server_key: 2306, region: 'EU', faction: 'Asmodian' }] } }))
  await openApp(page, { ui: { tab: 'market' } })
  await expect(page.getByText('Dein Server ist noch nicht bekannt')).toBeVisible()
})
