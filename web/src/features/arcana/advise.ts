// Arcana advice for the own character: what the equipped cards are worth, which Transcendence dungeon and stage
// brings the most damage per clear, and whether a Transmute pays. Values come from the Daevanion tab's damage model
// (PvE: dungeons) at the character's own totals and skill levels (website levels, gear, arcana, Daevanion included).
// A card's worth = damage with its skill levels against damage without them. A new card: Monte Carlo over the card
// kind's list (skills drawn without repeats, every skill alike: aion2data's chances are equal within a list), each
// skill +1..3 levels (ASSUMED: what the own cards show; the game files hold no per-skill level table).
import { charKey, charTotals, data as daeData, live, loadLive, loading, skillBases, weights } from '@/features/daevanion/daevanion'
import { evaluate } from '@/features/daevanion/model'
import { modelCtx } from '@/features/daevanion/values'
import type { ArcCard } from '@/features/daevanion/character'
import { GRADES, KINDS, arcSkills, type ArcData, type Kind } from './arcana'

/** Levels one bound skill gets (assumed uniform). */
export const LEVELS = [1, 2, 3]
const SAMPLES = 800

/** `state`: other = the class is not the own character's, none = no cards from the page, loading = its cards are
 *  being read, cards = from the page. */
export type Model = { names: string[]; lv: number[]; dmg: (lv: number[]) => number; state: 'other' | 'none' | 'loading' | 'cards' }

// pure (called during render); the refetch below runs from an effect
function cardsState(cls: string): Model['state'] {
  const char = charKey(), l = live(char)
  if (l && l.cls !== cls) return 'other'
  if (l?.gear?.arcana) return 'cards'
  return loading.has(char) ? 'loading' : 'none'
}

// gear read before the cards were (older save): read the page again once per character and session
const refetched = new Set<string>()
export function refetchCards(char = charKey()) {
  const l = live(char)
  if (!l || l.gear?.arcana || refetched.has(char)) return
  refetched.add(char)
  void loadLive(char, true)
}

/** The character's damage as a function of its skill levels (PvE, damage only). */
export function arcModel(cls: string): Model | null {
  const d = daeData(), c = d?.classes[cls]
  if (!d || !c) return null
  const l = live(), mine = l?.cls === cls ? l : undefined, w = weights(cls)
  const ctx = modelCtx(c, cls, 'pve', w), t = charTotals(d, cls).all
  const base = skillBases(c, mine, w)
  const lv = c.skills.map((s, i) => mine?.skills?.[s.en] ?? base[i].lv)
  return { names: c.skills.map(s => s.en), lv, dmg: x => evaluate(t, x, ctx).dmg, state: cardsState(cls) }
}

const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 }

/** One slot: the card kind, the card on it now (if any) and the levels without it. */
export type Slot = { kind: Kind; card?: ArcCard; list: number[]; base: number[]; cur: number }

export function slots(d: ArcData, cls: string, m: Model): Slot[] {
  const cards = live()?.gear?.arcana || []
  const all = arcSkills(d, cls)
  return KINDS.map(kind => {
    const card = cards.find(x => x.kind === kind)
    const list = (kind === 'Chalice' ? all : all.filter(s => s.kind === kind)).map(s => m.names.indexOf(s.en)).filter(i => i >= 0)
    const base = [...m.lv]
    for (const s of card?.skills || []) { const i = m.names.indexOf(s.name); if (i >= 0) base[i] = Math.max(1, base[i] - s.level) }
    return { kind, card, list, base, cur: m.dmg(m.lv) / m.dmg(base) - 1 }
  })
}

/** A new card of `n` skills on the slot (`pick`: skills chosen, the rest random): mean change against the card now,
 *  mean gain counting only upgrades, chance it is better. In fractions (0.01 = +1 % damage). */
export function newCard(s: Slot, m: Model, n: number, pick: number[] = [], seed = 1) {
  const r = rng(seed + s.kind.length * 97 + n * 13 + pick.length), d0 = m.dmg(s.base)
  let mean = 0, up = 0, better = 0
  for (let k = 0; k < SAMPLES; k++) {
    const pool = s.list.filter(i => !pick.includes(i)), got = [...pick]
    while (got.length < n && pool.length) got.push(pool.splice(Math.floor(r() * pool.length), 1)[0])
    const lv = [...s.base]
    for (const i of got) lv[i] += LEVELS[Math.floor(r() * LEVELS.length)]
    const ch = (m.dmg(lv) / d0) / (1 + s.cur) - 1
    mean += ch; if (ch > 1e-6) { up += ch; better++ }
  }
  return { mean: mean / SAMPLES, up: up / SAMPLES, p: better / SAMPLES }
}

/** The best skills to pick on a Transmute: highest worth at the middle level, one after another. */
export function bestPicks(s: Slot, m: Model, k: number) {
  const out: number[] = [], lv = [...s.base], mid = LEVELS[Math.floor(LEVELS.length / 2)]
  while (out.length < k) {
    let best = -1, bv = 0
    for (const i of s.list) {
      if (out.includes(i)) continue
      const x = [...lv]; x[i] += mid
      const v = m.dmg(x)
      if (best < 0 || v > bv) { best = i; bv = v }
    }
    if (best < 0) break
    out.push(best); lv[best] += mid
  }
  return out
}

/** A drop counts for a slot when it keeps the slot's set bonus: same set while that set has its bonus (2+ pieces),
 *  else either set (the chance per clear is per set). */
const setFactor = (s: Slot) => (s.card?.set && s.card.set.count >= 2 ? 1 : 2)

export type Farm = { dungeon: string; stage: number; gain: number; p: number }

/** Per dungeon and stage: expected damage gain per clear (upgrades only) and the chance of an upgrade. */
export function farm(d: ArcData, ss: Slot[], m: Model): Farm[] {
  const memo = new Map<string, ReturnType<typeof newCard>>()
  const nc = (s: Slot, g: string) => {
    const k = s.kind + g
    if (!memo.has(k)) memo.set(k, newCard(s, m, d.cards[s.kind]?.per[g] ?? 1))
    return memo.get(k)!
  }
  const by = new Map<string, Farm>()
  for (const [dungeon, stage, kind, grade, pct] of d.drops) {
    const s = ss.find(x => x.kind === kind)
    if (!s || !GRADES.includes(grade as never)) continue
    const key = dungeon + '|' + stage, f = by.get(key) ?? { dungeon, stage, gain: 0, p: 0 }
    const c = Math.min(1, pct / 100 * setFactor(s)), x = nc(s, grade)
    f.gain += c * x.up
    f.p = 1 - (1 - f.p) * (1 - c * x.p)
    by.set(key, f)
  }
  return [...by.values()].sort((a, b) => b.gain - a.gain)
}

export type Transmute = { kind: Kind; picks: number[]; n: number; mean: number; p: number; mats: number; kinah: number }

/** Transmute (Unique) per slot with one and with two picked skills: the card's skills drawn anew (ASSUMED: it
 *  replaces the card's skills), so the mean may be below 0. */
export function transmutes(d: ArcData, ss: Slot[], m: Model): Transmute[] {
  const tr = d.transmute
  if (!tr) return []
  const out: Transmute[] = []
  for (const s of ss) {
    const n = d.cards[s.kind]?.per.Unique ?? 4
    for (const k of [1, 2].filter(k => k <= tr.picks)) {
      const picks = bestPicks(s, m, k), r = newCard(s, m, n, picks, 7)
      out.push({ kind: s.kind, picks, n: k, mean: r.mean, p: r.p, mats: tr.n + (k - 1) * (tr.extra?.materials ?? 0), kinah: tr.kinah + (k - 1) * (tr.extra?.kinah ?? 0) })
    }
  }
  return out
}

/** Everything the tab shows, memoized on its inputs. */
let memo: { key: string; res: ReturnType<typeof compute> } | null = null
function compute(d: ArcData, cls: string, m: Model) {
  const ss = slots(d, cls, m)
  return { m, slots: ss, farm: farm(d, ss, m), transmute: transmutes(d, ss, m) }
}
export function advise(d: ArcData, cls: string) {
  const m = arcModel(cls)
  if (!m) return null
  const key = JSON.stringify([cls, m.lv, m.state, live()?.gear?.at, live()?.gear?.arcana, weights(cls), m.dmg(m.lv)])
  if (memo?.key !== key) memo = { key, res: compute(d, cls, m) }
  return memo.res
}
