// Black Cloud Merchant ("Schwarzwolken-Händler"): which of the offered pets are worth buying.
// Pure logic: farm difficulty from the spawn data, verdicts by the souls still missing to Lv 3, the hourly offer reset,
// merging the offer the game sends (0x9156, host message 'merchant') into the hand-entered one.
import { G, NEED, S, U, manual, type Any } from '@/core/state'
import { petName, zoneOfSpawn } from '@/core/data'
import { achFaction } from '@/features/progress/achievements'
import { petInfo, soulPets } from '@/features/pets/logic'
import PET_ITEMS from './petItems.json'
import PET_IDS from './petIds.json'

/** Score from which a missing pet is worth buying (0 = trivial to farm, 100 = no known spawn). */
export const HARD = 35
export const HOUR = 3600_000

export type Faction = 'Elyos' | 'Asmodian'
export type Reason = { k: string; v?: Record<string, string | number>; tone: 'red' | 'gold' | 'cyan' | 'dim' }
export type Best = { map: string; name: string; n: number; idx: number[] }
export type Diff = { score: number; spawns: number; maps: number; minLv: number; reasons: Reason[]; best: Best | null }
export type MapInfo = { key: string; name: string; faction?: string }

const ENEMY: Record<Faction, string> = { Asmodian: 'Elyos', Elyos: 'Asmodian' }

/** Farm difficulty of a pet ("Farmaufwand") over the loaded maps.
 *  - no spawn of its mobs on any open map: 100 (event, dungeon or not in the game data)
 *  - rarity: 60 / (1 + spawns / 8) – 1 spawn ≈ 53, 8 ≈ 30, 50 ≈ 8
 *  - spawns only in the other faction's territory: +45 (not farmable for you); only in the Abyss: +15 (PvP)
 *  - only named / field boss mobs: +15, only elite/hero mobs: +8
 *  - only on one map: +8; lowest mob level 40+: +5 */
export function difficulty(p: Any, maps: MapInfo[], md: Record<string, Any>, faction: Faction | null): Diff {
  const per: { m: MapInfo; d: Any; n: number; idx: number[] }[] = []
  const mobs: Any[] = []
  for (const m of maps) {
    const d = md[m.key]
    if (!d) continue
    let n = 0
    const idx: number[] = []
    for (const id of p.npc || []) {
      const sp = d.species?.[id], a = d.byId?.get(+id)
      if (!sp || !a?.length) continue
      n += a.length; idx.push(...a); mobs.push(sp)
    }
    if (n) per.push({ m, d, n, idx })
  }
  const spawns = per.reduce((s, x) => s + x.n, 0)
  if (!spawns) return { score: 100, spawns: 0, maps: 0, minLv: 0, reasons: [{ k: 'none', tone: 'red' }], best: null }

  const reasons: Reason[] = []
  const rare = 60 / (1 + spawns / 8)
  let score = rare
  reasons.push({ k: 'spawns', v: { n: spawns }, tone: rare >= 30 ? 'red' : rare >= 15 ? 'gold' : 'dim' })
  const enemy = faction ? ENEMY[faction] : null
  const own = per.filter(x => x.m.faction !== enemy)
  if (enemy && !own.length) { score += 45; reasons.unshift({ k: 'enemy', v: { fac: enemy }, tone: 'red' }) }
  else if (own.every(x => x.m.faction === 'Abyss')) { score += 15; reasons.push({ k: 'abyss', tone: 'gold' }) }
  if (mobs.every(s => s.fb)) { score += 15; reasons.push({ k: 'boss', tone: 'gold' }) }
  else if (mobs.every(s => s.named || s.fb)) { score += 15; reasons.push({ k: 'named', tone: 'gold' }) }
  else if (mobs.every(s => s.r && s.r !== 'Normal')) { score += 8; reasons.push({ k: 'elite', tone: 'gold' }) }
  if (per.length === 1) { score += 8; reasons.push({ k: 'oneMap', tone: 'gold' }) }
  const minLv = Math.min(...mobs.map(s => s.lv || 0))
  if (minLv >= 40) { score += 5; reasons.push({ k: 'lv', v: { lv: minLv }, tone: 'dim' }) }

  const pool = own.length ? own : per
  const top = pool.reduce((a, b) => (b.n > a.n ? b : a))
  return { score: Math.min(99, Math.round(score)), spawns, maps: per.length, minLv, reasons, best: { map: top.m.key, name: top.m.name, n: top.n, idx: top.idx } }
}

export type Verdict = 'buy' | 'opt' | 'have'
/** By the souls still missing to Lv 3 (`rest`): none = Lv 3 reached, buying adds nothing. Missing and hard to farm = buy. */
export const verdict = (rest: number, d: Diff): Verdict => (rest <= 0 ? 'have' : d.score >= HARD ? 'buy' : 'opt')
/** Souls one purchase at the merchant gives (as far as known; change here). */
export const SOULS_PER_BUY = 5
/** What buying does for a pet `rest` souls short of Lv 3: souls left after one purchase, purchases to Lv 3. */
export const buyInfo = (rest: number) => ({ after: Math.max(0, rest - SOULS_PER_BUY), buys: Math.ceil(Math.max(0, rest) / SOULS_PER_BUY) })
/** Kinah per soul of an offer price. */
export const perSoul = (price: number) => Math.round(price / SOULS_PER_BUY)
/** Souls from Lv 0 to Lv 3 (5 + 25 + 75). */
export const MAX_SOULS = NEED.reduce((a, b) => a + b, 0)
/** Souls collected on the way to Lv 3 (0..MAX_SOULS), from the souls still missing. */
export const soulsHave = (rest: number) => MAX_SOULS - Math.min(MAX_SOULS, Math.max(0, rest))
/** Fill of the three level segments (Lv 1 / 2 / 3, 0..1 each) at `have` souls collected. */
export function segments(have: number): number[] {
  let start = 0
  return NEED.map(n => { const f = Math.min(1, Math.max(0, (have - start) / n)); start += n; return f })
}

/** Wish list section of a pet: no known spawn (merchant / event / dungeon only), hard to farm (buying pays), easy. */
export type Group = 'none' | 'hard' | 'easy'
export const groupOf = (d: Diff): Group => (!d.spawns ? 'none' : d.score >= HARD ? 'hard' : 'easy')
/** Calm farm-effort marker (1–3 dots): 3 = very hard (65+ or no spawn), 2 = hard (HARD+), 1 = easy. */
export const tierOf = (d: Diff): 1 | 2 | 3 => (d.score >= 65 ? 3 : d.score >= HARD ? 2 : 1)

/** Priority of a pet: farm difficulty weighted by the souls still missing to Lv 3 (max 105). */
export const priority = (rest: number, d: Diff) => d.score * Math.max(0, rest)

// ---------------------------------------------------------------- hourly offer

/** `id` = the pet (game pet id, see catalog()), or the merchant item id (534760xxx) for a pet item whose name is not in
 *  the catalog (still unknown merchant / event pets) or not in the item table. `tab` = read from the game (that merchant tab's id), `item` = its item id,
 *  `base` = price before the discount, `bought` = when it was bought (a +5 soul update for the pet, markBought). */
export type Offer = { id: number; item?: number; price?: number; base?: number; tab?: number; bought?: number }
/** Other goods of a merchant tab (skins, boxes, …): only shown as a count. */
export type Other = { item: number; tab: number; base: number; price: number }
/** `c` = the character the offer belongs to (every character has its own merchant stock), unset until it is known. */
export type Offers = { h: number; items: Offer[]; other?: Other[]; c?: string }
/** Offers of the other characters by name (U.merchAlt). */
export type AltOffers = Record<string, Offers>
/** One record of the host message 'merchant' (Protocol.cs ParseMerchant). */
export type GameItem = { item: number; count?: number; tier?: number; base: number; price: number }

/** Start of the current full hour (local clock; the merchant rotates on the full hour). */
export const hourStart = (now: number) => { const d = new Date(now); d.setMinutes(0, 0, 0); return d.getTime() }
export const msToNext = (now: number) => hourStart(now) + HOUR - now
/** The saved offer if it is from this hour, else an empty one. */
export const freshOffers = (o: Any, now: number): Offers =>
  o && o.h === hourStart(now) && Array.isArray(o.items) ? o : { h: hourStart(now), items: [], ...(o?.c ? { c: o.c } : {}) }

/** Pet items of the merchant: 534760xxx (the xxx is not the pet id). */
export const isPetItem = (item: number) => Math.floor(item / 1000) === 534760
type PetItem = { n: string; icon: string }
const ITEMS = PET_ITEMS as Record<string, PetItem>
/** English pet name of a pet item (table from aion2.app/db/items, 534760001–534760255), undefined when not listed. */
export const itemName = (item: number): string | undefined => ITEMS[item]?.n
// ---------------------------------------------------------------- pet catalog

type PetId = { n: string; c: string; icon?: string }
/** Game pet ids (the ids of the pet state and the soul updates, same as pets.json) with name, category and portrait,
 *  from aion2.app/db/pets/<id>: also the merchant / event pets that pets.json lacks. */
const IDS = PET_IDS as Record<string, PetId>
let cat: { pets: Any[]; byId: Map<number, Any>; byName: Map<string, number>; extra: Any[] } | null = null
function catalogOf(pets: Any[]) {
  if (cat?.pets === pets) return cat
  const byId = new Map<number, Any>(pets.map(p => [p.id, p])), extra: Any[] = []
  for (const [k, v] of Object.entries(IDS)) {
    if (byId.has(+k)) continue
    const p = { id: +k, n: v.n, c: v.c, npc: [], ev: 1 }
    byId.set(p.id, p); extra.push(p)
  }
  const byName = new Map<string, number>()
  for (const p of byId.values()) { const n = String(p.n).toLowerCase(); if (!byName.has(n)) byName.set(n, p.id) }
  return (cat = { pets, byId, byName, extra })
}
/** Pet of the merchant catalog by its game id: pets.json, else petIds.json (merchant / event pet: `ev`, no spawns). */
export const catPet = (id: number, pets: Any[] = G.pets): Any | undefined => catalogOf(pets).byId.get(id)
/** The catalog's merchant / event pets (in petIds.json, not in pets.json). */
export const extraPets = (pets: Any[] = G.pets): Any[] => catalogOf(pets).extra

let iconIdx: Map<string, string> | null = null
/** Portrait file of a pet (aion2.app, cached by the host under /data/peticons/): by its game id (petIds.json), else by
 *  its name (case-insensitive) in the item table; undefined when neither knows it. */
export function petIcon(name: string | null | undefined, id?: number | null): string | undefined {
  const own = id != null ? IDS[id]?.icon : undefined
  if (own) return own
  if (!name) return undefined
  if (!iconIdx) {
    iconIdx = new Map()
    for (const it of Object.values(ITEMS)) { const k = it.n.toLowerCase(); if (it.icon && !iconIdx.has(k)) iconIdx.set(k, it.icon) }
  }
  return iconIdx.get(name.trim().toLowerCase())
}
/** Pet (catalog id) of a merchant item by its name (case-insensitive), null for other goods, unlisted items and pets
 *  whose name is not in the catalog. */
export function petOfItem(item: number, pets: Any[] = G.pets): number | null {
  const n = isPetItem(item) ? itemName(item) : undefined
  return n ? catalogOf(pets).byName.get(n.toLowerCase()) ?? null : null
}
/** Merchant / event pets for the picker: the catalog's own ones in the item table, plus pet items whose name is not in
 *  the catalog (under their item id, progress unknown). */
export function eventPets(pets: Any[] = G.pets): Any[] {
  const out: Any[] = [], seen = new Set<number>()
  for (const [k, it] of Object.entries(ITEMS)) {
    const id = petOfItem(+k, pets)
    if (id == null) { out.push({ id: +k, n: it.n }); continue }
    const p = catPet(id, pets)
    if (p?.ev && !seen.has(id)) { seen.add(id); out.push(p) }
  }
  return out
}
/** Discount in percent (10/20/30/50), 0 without a base price. */
export const discount = (o: { base?: number; price?: number }) =>
  o.base && o.price != null && o.price < o.base ? Math.round((1 - o.price / o.base) * 100) : 0

/** Merge a merchant tab the game sent into the offer: the tab's earlier game entries are replaced (a pet no longer
 *  offered there drops out), a hand-added entry of an offered pet becomes a game entry with the game's price, hand
 *  entries and the other tabs stay. Bought entries keep their mark (same tab + item, or a hand entry) and stay even
 *  when the game no longer lists them. `added` = pets that were not game entries before (for the toast). */
export function mergeGame(o: Offers, tab: number, list: GameItem[], all: Any[] = G.pets): { offers: Offers; added: number[] } {
  const pets = new Map<number, GameItem>(), other: Other[] = []
  for (const it of list) {
    if (!isPetItem(it.item)) { other.push({ item: it.item, tab, base: it.base, price: it.price }); continue }
    const pet = petOfItem(it.item, all) ?? it.item
    if (!pets.has(pet)) pets.set(pet, it)
  }
  const before = new Set(o.items.filter(x => x.tab != null).map(x => x.id))
  const boughtOf = (id: number, item: number) =>
    o.items.find(x => x.bought && x.id === id && (x.tab == null || (x.tab === tab && (x.item == null || x.item === item))))?.bought
  const items: Offer[] = o.items.filter(x => !pets.has(x.id) && (x.tab !== tab || x.bought))
  const bought = new Set<number>()
  for (const [id, it] of pets) {
    const b = boughtOf(id, it.item)
    if (b) bought.add(id)
    items.push({ id, item: it.item, price: it.price, base: it.base, tab, ...(b ? { bought: b } : {}) })
  }
  return {
    offers: { ...o, items, other: [...(o.other || []).filter(x => x.tab !== tab), ...other] },
    added: [...pets.keys()].filter(id => !before.has(id) && !bought.has(id)),
  }
}

// ---------------------------------------------------------------- purchases

/** Souls collected from Lv 0 at `lv` + `souls` (0..MAX_SOULS). */
export const soulTotal = (lv: number, souls: number) =>
  NEED.slice(0, Math.max(0, Math.min(3, lv))).reduce((a, b) => a + b, 0) + (lv >= 3 ? 0 : Math.max(0, souls || 0))
/** Souls one host 'soul' event added: its `gained`, else the difference to the state before (`prev`, set by the pets
 *  feature before it applies the event). */
export function soulGain(ev: Any): number {
  if (typeof ev?.gained === 'number') return ev.gained
  if (!ev?.prev) return 0
  return soulTotal(ev.level || 0, ev.souls || 0) - soulTotal(ev.prev.level || 0, ev.prev.souls || 0)
}
/** Merchant / event pet entry whose pet is not in the catalog (offered under its item id). */
export const isEventOffer = (o: Offer, known: (id: number) => boolean) => !known(o.id) && isPetItem(o.id)
/** A soul update of `gain` souls for `pet`: a purchase gives SOULS_PER_BUY at once (a kill +1). Marks the pet's offer
 *  bought (by its game id); only for a pet that is not in the catalog the only unbought offer under an item id
 *  (none or several: unclear, nothing marked). null = nothing marked. */
export function markBought(o: Offers, pet: number, gain: number, now: number, known: (id: number) => boolean = id => !!catPet(id)): { offers: Offers; id: number } | null {
  if (gain < SOULS_PER_BUY) return null
  let hit: Offer | undefined
  if (known(pet)) hit = o.items.find(x => x.id === pet && !x.bought)
  else {
    const ev = o.items.filter(x => !x.bought && isEventOffer(x, known))
    if (ev.length === 1) hit = ev[0]
  }
  if (!hit) return null
  return { offers: { ...o, items: o.items.map(x => (x === hit ? { ...x, bought: now } : x)) }, id: hit.id }
}

// ---------------------------------------------------------------- characters

/** Switch the stored offer to character `char`: the current one goes to `alt` under its character, `char`'s own comes
 *  back (or an empty one). An offer without a character is adopted. null = nothing to change (same or unknown char). */
export function switchChar(cur: Offers, alt: AltOffers, char: string, now: number): { merch: Offers; alt: AltOffers } | null {
  if (!char || cur.c === char) return null
  if (cur.c == null) return { merch: { ...cur, c: char }, alt }
  const next = freshAlt(alt, now)
  if (cur.items.length || cur.other?.length) next[cur.c] = cur
  const mine = freshOffers(next[char], now)
  delete next[char]
  return { merch: { ...mine, c: char }, alt: next }
}
/** The other characters' offers of this hour that still list something. */
export function freshAlt(alt: AltOffers | null | undefined, now: number): AltOffers {
  const out: AltOffers = {}
  for (const [c, o] of Object.entries(alt || {})) if (o && o.h === hourStart(now) && (o.items?.length || o.other?.length)) out[c] = o
  return out
}

/** Verdict of an offer entry: by the souls for a catalog pet (also merchant / event pets: their game id has the
 *  progress); 'event' = pet item not in the catalog (progress unknown, top priority: souls only come from the merchant
 *  or events); 'unknown' = item not in the table. */
export type OfferVerdict = Verdict | 'event' | 'unknown'
export const OFFER_ORDER: Record<OfferVerdict, number> = { event: 0, buy: 1, opt: 2, have: 3, unknown: 4 }
export function offerKind(o: Offer): { p: Any | null; name: string | null; v: OfferVerdict } {
  const p = catPet(o.id)
  // shown name in the UI language (list, toast); only unlisted pet items keep their English item name
  if (p) return { p, name: petName(p), v: verdict(soulsLeft(p.id), diffOf(p)) }
  const n = isPetItem(o.id) ? itemName(o.id) : undefined
  return { p: null, name: n ?? null, v: n ? 'event' : 'unknown' }
}
/** Unbought offers worth buying (verdict buy or merchant-only). */
export const buyCount = (o: Offers) => o.items.filter(x => !x.bought && ['buy', 'event'].includes(offerKind(x).v)).length

// ---------------------------------------------------------------- app glue

/** Your faction: chosen in the tab's bar, else the achievements tab's choice (manual mode), else from the achievement
 *  ids the game sent. null = unknown (no faction penalty). */
export function myFaction(): Faction | null {
  const f = U.merchFac || (manual() && U.faction) || achFaction()
  return f === 'Elyos' || f === 'Asmodian' ? f : null
}

/** Every open map's data is loaded (the scores are final). */
export const mapsLoaded = () => G.maps.length > 0 && G.maps.every((m: Any) => G.md[m.key])

let cache = new Map<number, Diff>(), cacheKey = ''
/** Difficulty of a pet in the app's data, cached until the loaded maps or the faction change. */
export function diffOf(p: Any): Diff {
  const key = `${myFaction()}|${G.maps.filter((m: Any) => G.md[m.key]).length}|${G.pets.length}`
  if (key !== cacheKey) { cache = new Map(); cacheKey = key }
  let d = cache.get(p.id)
  if (!d) cache.set(p.id, d = difficulty(p, G.maps, G.md, myFaction()))
  return d
}

/** Area with the most spawns of the pet on its best map ('' when unnamed). */
export function bestZone(b: Best): string {
  const m = G.md[b.map], cnt = new Map<string, number>()
  if (!m) return ''
  for (const i of b.idx) { const z = zoneOfSpawn(m, i); cnt.set(z, (cnt.get(z) || 0) + 1) }
  let best = '', n = 0
  for (const [z, c] of cnt) if (c > n) { best = z; n = c }
  return best
}

/** Pets the merchant can offer: the soul pets of the Global client, the catalog's merchant / event pets that are in the
 *  item table or owned, and owned pets of unknown id ("Pet #<id>"). */
export function merchantPets(): Any[] {
  const own = (id: number) => id in S.state.levels || (S.state.souls[id] || 0) > 0
  const item = new Set(Object.values(ITEMS).map(it => it.n.toLowerCase()))
  const out = [...soulPets(), ...extraPets().filter(p => own(p.id) || item.has(p.n.toLowerCase()))]
  for (const k of new Set([...Object.keys(S.state.levels), ...Object.keys(S.state.souls)]))
    if (!catPet(+k) && own(+k)) out.push({ id: +k, n: 'Pet #' + k, c: '', npc: [], ev: 1 })
  return out
}
export const petLevel = (id: number): number => S.state.levels[id] || 0
/** Souls still missing to Lv 3 (0 = done). */
export const soulsLeft = (id: number): number => petInfo(id).rest

/** Pets below Lv 3, most important first: difficulty × missing souls. */
export function wishlist(): { p: Any; d: Diff; rest: number }[] {
  return merchantPets().map(p => ({ p, d: diffOf(p), rest: soulsLeft(p.id) })).filter(x => x.rest > 0)
    .sort((a, b) => priority(b.rest, b.d) - priority(a.rest, a.d) || b.d.score - a.d.score || a.p.n.localeCompare(b.p.n))
}

export { petInfo }
