// Markt page logic: which skins on the market (auction house) are worth buying now. Pure functions, tested in
// logic.test.ts; data: web/public/skins.json (tools/fetch_skins.py, aion2data.com) and aion2.exchange prices (host
// 'market' -> MarketLookup.cs).
// A skin unlocked for the first time gives its category collection points (Common 1 … Heroic 5), each +0.1 % of that
// category's stat, while owned (not only worn); the unlock item is used up. Accessories (earrings, necklace) raise
// attack and defence, armor pieces only their defence: accessories count fully, armor half.
// Like the user's craftprofit tool only "things that actually move" count: the usual price is the 14-day median of the
// hourly closes (not the lowest: 10 000 Kinah misprints), the flow the listings that vanished per day.

export type Skin = { item: number; skin: number; name: string; cat: string; grade: string; pts: number; stat: string }
export type SkinData = { total: number; items: Skin[] }
/** aion2.exchange list entry (one server, section skins). */
export type Listing = { item_key: number; name: string; price: number | null; listings: number; last_price: number | null; captured_at: string }
/** aion2.exchange history point (hourly bucket). */
export type Point = { ts: string; low: number; close: number; listings: number; listings_min: number; listings_max: number }
export type Hist = { med: number | null; low: number | null; gone: number; days: number }

export const ACCESSORY = new Set(['Earrings', 'Necklace'])
/** Worth of a point by category: accessories give attack and defence. */
export const catWeight = (cat: string) => (ACCESSORY.has(cat) ? 1 : 0.5)
/** Fashionista (Asmodian 440100800 / Elyos 340100800): skins collected for the tiers' Kinah rewards. */
export const FASHIONISTA = [440100800, 340100800]
export const FASHION_GOALS = [10, 50, 100, 200, 300, 500, 700, 1000]
/** Buy at most this much above the usual price; a deal is this much below it. */
export const FAIR = 1.1, DEAL = 0.85

const median = (a: number[]) => {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y), k = s.length >> 1
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2
}

/** Usual price (median close), lowest low, listings gone per day (bought, pulled or expired; craftprofit movement()). */
export function histOf(points: Point[], now = Date.now()): Hist {
  if (points.length < 2) return { med: median(points.map(p => p.close)), low: points[0]?.low ?? null, gone: 0, days: 0 }
  let gone = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]
    gone += Math.max(0, a.listings - b.listings)
    gone += Math.max(0, b.listings_max - b.listings_min - Math.max(0, b.listings - a.listings))
  }
  const days = Math.max((now - Date.parse(points[0].ts)) / 86_400_000, 1 / 24)
  return { med: median(points.map(p => p.close)), low: Math.min(...points.map(p => p.low)), gone: gone / days, days }
}

export type Kind = 'deal' | 'buy' | 'wait' | 'watch' | 'have'
export type Row = Skin & { price: number | null; listings: number; med: number | null; gone: number; kind: Kind; vs: number | null; kpp: number | null; score: number }

/** One skin's verdict: owned / nothing listed (watch) / too dear (wait) / fair (buy) / clearly below usual (deal). */
export function judge(s: Skin, l: Listing | undefined, h: Hist | undefined, owned: boolean): Row {
  const price = l?.price ?? null, med = h?.med ?? l?.last_price ?? null
  const vs = price !== null && med ? price / med : null
  const value = s.pts * catWeight(s.cat), kpp = price !== null && value > 0 ? price / value : null
  const kind: Kind = owned ? 'have' : price === null || !l?.listings ? 'watch' : vs !== null && vs > FAIR ? 'wait' : vs !== null && vs <= DEAL ? 'deal' : 'buy'
  // more value per Kinah, cheaper than usual and moving -> higher
  const flow = Math.min(1, (h?.gone ?? 0) / 2), deal = vs ? Math.min(2, Math.max(0.5, 1 / vs)) : 1
  const score = kpp ? (deal * (0.5 + 0.5 * flow) * 1e6) / kpp : 0
  return { ...s, price, listings: l?.listings ?? 0, med, gone: h?.gone ?? 0, kind, vs, kpp, score }
}

export const ORDER: Kind[] = ['deal', 'buy', 'wait', 'watch', 'have']
/** All rows, best first within each kind (deal and buy by score, wait by how close to usual, watch by usual price). */
export function rows(data: SkinData, list: Listing[], hist: Record<number, Hist>, owned: Record<number, boolean>): Row[] {
  const byKey = new Map(list.map(l => [l.item_key, l]))
  return data.items.map(s => judge(s, byKey.get(s.item), hist[s.item], !!owned[s.item]))
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || b.score - a.score || (a.vs ?? 9) - (b.vs ?? 9) || (a.med ?? 9e9) - (b.med ?? 9e9))
}

/** Fashionista progress: skins collected (the achievement counter) and the next tier's goal (null: all done). */
export function fashion(counter: number): { n: number; next: number | null } {
  return { n: counter, next: FASHION_GOALS.find(g => g > counter) ?? null }
}

/** aion2.exchange server id of a game server key (Azphel 2306 -> 12306). */
export const serverId = (gameServer: number) => (gameServer > 0 ? 10000 + gameServer : 0)
