// Markt page data: the tradeable skins (skins.json), the market list of the own server and each skin's 14-day history
// from aion2.exchange via the host (MarketLookup.cs: allowed paths only, one request per second, cached on disk 10 min
// / 1 h). Loaded when the page opens (then every 10 min while it is shown) and every 30 min in the background, which
// toasts new deals on skins not owned (U.marketAlert). The server is the own character's (P.own.srv, kept in
// U.marketSrv), else chosen on the page. Owned: the game's wardrobe list (host 'skins' = 0x5b8d at login, map changes
// and Alt+O; U.skinIds, skin ids) plus the ones marked by hand (U.skinOwned, unlock item ids).
import { host, onHost } from '@/core/host'
import { addStrings, t } from '@/core/i18n'
import { U, bump, saveUi, type Any } from '@/core/state'
import { toast } from '@/core/toast'
import { P } from '@/features/pvp'
import { histOf, rows, serverId, type Hist, type Listing, type Point, type Row, type Skin, type SkinData } from './logic'
import strings from './strings'

addStrings(strings)

export const M: { data: SkinData | null; list: Listing[]; hist: Record<number, Hist>; at: number; loading: number; error: string; servers: Any[] } =
  { data: null, list: [], hist: {}, at: 0, loading: 0, error: '', servers: [] }

fetch('skins.json').then(r => r.json()).then(d => { M.data = d; bump(); if (U.tab === 'market') void refresh() }).catch(() => { M.data = { total: 0, items: [] } })

// host requests with ids (like the plaync proxy of the Daevanion boards)
let seq = 0
const waiting = new Map<number, (m: Any) => void>()
onHost('market', m => { const f = waiting.get(m.id); if (f) { waiting.delete(m.id); f(m) } })
function ask(path: string): Promise<{ status: number; body: string | null; age: number }> {
  const id = ++seq
  return new Promise(res => {
    waiting.set(id, res)
    host({ type: 'market', id, path })
    setTimeout(() => { if (waiting.delete(id)) res({ status: 0, body: null, age: 0 }) }, 30_000)
  })
}

/** The own game server key (Azphel 2306): the character's, else the one chosen / seen before. */
export function gameServer(): number {
  const own = P.own?.srv || 0
  if (own > 0 && own !== U.marketSrv) { U.marketSrv = own; saveUi(['marketSrv']) }
  return own > 0 ? own : U.marketSrv || 0
}
// the game's wardrobe: kept only when it changed (it comes with every map change)
onHost('skins', m => {
  const ids: number[] = m.ids || [], old: number[] = U.skinIds || []
  if (ids.length === old.length && ids.every((v, i) => v === old[i])) return
  U.skinIds = ids
  saveUi(['skinIds'])
  bump()
})
let wardrobe: { src: unknown; set: Set<number> } = { src: null, set: new Set() }
/** The skin is in the game's wardrobe list. */
export function inGame(s: Skin): boolean {
  if (wardrobe.src !== U.skinIds) wardrobe = { src: U.skinIds, set: new Set(U.skinIds || []) }
  return wardrobe.set.has(s.skin)
}
/** Skins in the wardrobe (null: the game has not sent the list yet). */
export const wardrobeSize = (): number | null => (U.skinIds ? U.skinIds.length : null)
/** Owned unlock items: the wardrobe's and the ones marked by hand. */
export function owned(): Record<number, boolean> {
  const o: Record<number, boolean> = { ...(U.skinOwned || {}) }
  for (const s of M.data?.items || []) if (inGame(s)) o[s.item] = true
  return o
}
export function setOwned(item: number, on: boolean) {
  const o = { ...(U.skinOwned || {}) }
  if (on) o[item] = true
  else delete o[item]
  U.skinOwned = o
  saveUi(['skinOwned'])
  bump()
}
export const marketRows = (): Row[] => (M.data ? rows(M.data, M.list, M.hist, owned()) : [])

/** Server list for the chooser (only needed while the character is unknown). */
export async function loadServers() {
  if (M.servers.length) return
  const r = await ask('/api/servers')
  try { M.servers = r.body ? JSON.parse(r.body).servers || [] : [] } catch { M.servers = [] }
  bump()
}

const hourIso = (ms: number) => new Date(Math.floor(ms / 3_600_000) * 3_600_000).toISOString().replace('.000Z', 'Z')

/** Load the list and the histories (sequentially: the host lets one request per second through). */
export async function refresh(force = false) {
  const id = serverId(gameServer())
  if (!id || M.loading || !M.data?.items.length || (!force && Date.now() - M.at < 600_000)) return
  M.loading = 1; M.error = ''
  bump()
  const r = await ask(`/api/items?server=${id}&section=skins&limit=100`)
  try {
    if (!r.body) throw new Error(String(r.status))
    M.list = JSON.parse(r.body).items || []
    M.at = Date.now() - r.age * 1000
  } catch { M.error = t('mkt.error'); M.loading = 0; bump(); return }
  bump()
  // the history from the start of the hour 14 days ago: the same path for an hour = the host's cache answers
  const from = hourIso(Date.now() - 14 * 86_400_000)
  for (const s of M.data.items) {
    M.loading++
    const h = await ask(`/api/items/${s.item}/prices?server=${id}&from=${from}`)
    try { if (h.body) M.hist[s.item] = histOf((JSON.parse(h.body).points || []) as Point[]) } catch { /* keep the old */ }
    if (M.loading % 6 === 0) bump()
  }
  M.loading = 0
  bump()
  alertDeals()
}

/** Toast deals on skins not owned, each item and price once. */
const told = new Set<string>()
function alertDeals() {
  if (U.marketAlert === false || U.tab === 'market') return
  const deals = marketRows().filter(r => r.kind === 'deal' && !told.has(`${r.item}@${r.price}`))
  if (!deals.length) return
  deals.forEach(r => told.add(`${r.item}@${r.price}`))
  toast(deals.length === 1 ? t('mkt.toast1', { name: deals[0].name }) : t('mkt.toast', { n: deals.length }), deals.map(r => r.name).join(', '), 1, true)
}

// while the page is shown every 10 min (refresh skips younger data), in the background every 30 min
setInterval(() => { if (U.tab === 'market' || Date.now() - M.at > 1_800_000) void refresh() }, 60_000)
/** Minutes since the price list was captured, null before the first one. */
export const listAge = () => (M.at ? Math.round((Date.now() - M.at) / 60_000) : null)
/** Number of skins to buy now (sidebar badge). */
export const buyNow = () => marketRows().filter(r => r.kind === 'deal' || r.kind === 'buy').length
