// Gear optimization on top of the DPS model: what each line of the worn gear is worth, which soul binding lines to aim
// for (the item's pool from the game files, aion2data.com: web/public/gear.json via tools/fetch_gear.py), what the next
// enhance level gives, which other item of the slot would be better, and one ranking over all of it.
import { gain, type State } from './model'
import { keyOfName, type Item, type Key, type Line, type Snapshot } from './stats'

/** gear.json row: id, name, category, grade, item level, faction, fixed stats, properties per binding, pool. */
export type GearRow = [number, string, string, string, number, string, Record<string, number>, number, [string, number, number, number][]]

export type Valued = Line & { gain: number }
export const lineGain = (s: State, key: Key | null, value: number) => (key ? gain(s, { [key]: value }) : 0)
const valued = (s: State, ls: Line[]): Valued[] => ls.map(l => ({ ...l, gain: lineGain(s, l.key, l.value) }))

/** Fixed stats of a gear.json item as model totals (weapon attack: the middle of min / max). */
export function fixedTotals(stats: Record<string, number>): Partial<Record<Key, number>> {
  const t: Partial<Record<Key, number>> = {}
  const atk = stats['Min Attack'] != null ? (stats['Min Attack'] + (stats['Max Attack'] ?? stats['Min Attack'])) / 2 : stats['Attack'] ?? 0
  if (atk) t.atk = atk
  for (const [n, v] of Object.entries(stats)) { const k = keyOfName(n); if (k && k !== 'atk') t[k] = (t[k] || 0) + v }
  return t
}

export type SoulTarget = { stat: string; key: Key | null; low: number; high: number; chance: number; gain: number }

/** The item's soul binding pool, best line first (value at the middle of its range). */
export function soulTargets(s: State, row: GearRow | undefined): SoulTarget[] {
  return (row?.[8] || []).map(([stat, low, high, chance]) => {
    const key = keyOfName(stat)
    return { stat, key, low, high, chance, gain: lineGain(s, key, (low + high) / 2) }
  }).sort((a, b) => b.gain - a.gain)
}

export type ItemReport = {
  item: Item; main: Valued[]; sub: Valued[]; stones: Valued[]
  /** Worst soul binding line and the best one the pool has. */
  worstSub: Valued | null; targets: SoulTarget[]
  /** What one more enhance level gives (enchant share of the main stats / level), null when not known. */
  enchantGain: number | null
}

export function report(s: State, it: Item, db: Map<number, GearRow>): ItemReport {
  const sub = valued(s, it.sub)
  const worst = sub.length ? sub.reduce((a, b) => (b.gain < a.gain ? b : a)) : null
  let enchantGain: number | null = null
  if (it.enchant > 0) {
    const d: Partial<Record<Key, number>> = {}
    for (const l of it.main) if (l.key && l.extra) d[l.key] = (d[l.key] || 0) + l.extra / it.enchant
    enchantGain = Object.keys(d).length ? gain(s, d) : 0
  }
  return { item: it, main: valued(s, it.main), sub, stones: valued(s, it.stones), worstSub: worst, targets: soulTargets(s, db.get(it.id)), enchantGain }
}

export type Candidate = { row: GearRow; gain: number }

/** Other items of the slot's category, better ones first: fixed stats against the worn item's (without enhance). */
export function candidates(s: State, it: Item, rows: GearRow[], faction?: string): Candidate[] {
  const seen = new Set<string>()
  const own: Partial<Record<Key, number>> = {}
  for (const l of it.main) if (l.key) own[l.key] = (own[l.key] || 0) + l.value - (l.extra || 0)
  return rows.filter(r => r[2] === it.cat && r[0] !== it.id && r[1] !== it.name && (!faction || r[5] === 'both' || r[5] === faction) && !seen.has(r[1]) && !!seen.add(r[1])).map(row => {
    const t = fixedTotals(row[6]), d: Partial<Record<Key, number>> = {}
    for (const k of new Set([...Object.keys(t), ...Object.keys(own)]) as Set<Key>) d[k] = (t[k] || 0) - (own[k] || 0)
    return { row, gain: gain(s, d) }
  }).sort((a, b) => b.gain - a.gain)
}

export type Upgrade = { kind: 'soul' | 'enchant' | 'stone'; slot: string; item: string; text: string; gain: number; chance?: number }

/** One ranking over all items: swap the worst soul binding line for the pool's best, one more enhance level, and
 *  manastones that add nothing (worth replacing with an offensive one). */
export function upgrades(s: State, snap: Snapshot | undefined, db: Map<number, GearRow>): Upgrade[] {
  const out: Upgrade[] = []
  for (const it of snap?.items || []) {
    const r = report(s, it, db), best = r.targets[0]
    if (best && r.worstSub && best.gain > r.worstSub.gain + 0.01)
      out.push({ kind: 'soul', slot: it.slot, item: it.name, text: `${r.worstSub.name} ${fmtLine(r.worstSub.value)} → ${best.stat} ${fmtRange(best.low, best.high)}`, gain: best.gain - r.worstSub.gain, chance: best.chance })
    if (r.enchantGain && r.enchantGain > 0.01) out.push({ kind: 'enchant', slot: it.slot, item: it.name, text: `+${it.enchant} → +${it.enchant + 1}`, gain: r.enchantGain })
    for (const st of r.stones) if (st.gain <= 0.001) out.push({ kind: 'stone', slot: it.slot, item: it.name, text: `${st.name} ${fmtLine(st.value)}`, gain: 0 })
  }
  return out.sort((a, b) => b.gain - a.gain)
}

export const fmtLine = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1))
export const fmtRange = (lo: number, hi: number) => (lo === hi ? fmtLine(lo) : `${fmtLine(lo)}–${fmtLine(hi)}`)
