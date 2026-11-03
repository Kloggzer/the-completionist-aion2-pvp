// Limited charges that refill over time and stop at a cap: whatever refills above the cap is lost, so the
// warning is about the time until an owner is full. A reading comes from the game (0x0b61 entry limits, 0x0c61
// charges and Odyle energy) or by hand; the app projects it forward from that reading.
import { S, U, saveUi, bump, manual } from '@/core/state'
import { onHost } from '@/core/host'
import { CHECK, charKey, checkSet, lastReset, nextReset, type Per } from './checklist'

export type ChargeDef = {
  id: string; per: Per; tier: 1 | 2 | 3
  cap: () => number
  /** Refill per tick; `every` = ms between ticks, or 'day' = at every daily reset. */
  regen: number; every: number | 'day'
  /** Step of the − / + buttons (Odyle: one cube costs 40). */
  step: number
}

export const CHARGES: ChargeDef[] = [
  { id: 'odyle', per: 'char', tier: 1, cap: () => (U.member ? 840 : 560), regen: 15, every: 3 * 3600e3, step: 40 },
  { id: 'nightmare', per: 'char', tier: 1, cap: () => 14, regen: 2, every: 'day', step: 1 },
  { id: 'shugo', per: 'server', tier: 2, cap: () => (U.member ? 21 : 12), regen: 3, every: 'day', step: 1 },
  { id: 'invasion', per: 'server', tier: 3, cap: () => 7, regen: 1, every: 'day', step: 1 },
]

type Reading = { v: number; at: number; auto?: boolean; bonus?: number }
const key = (d: ChargeDef, char?: string) => d.id + '|' + (d.per === 'server' ? 'srv' : char || '')
const reading = (d: ChargeDef, char?: string): Reading | undefined => (U.charges ||= {})[key(d, char)]

/** Daily resets passed in (from, to]. */
function resetsBetween(from: number, to: number) {
  let n = 0
  for (let r = lastReset('d', new Date(to)).getTime(); r > from; r -= 864e5) n++
  return n
}

/** Time of the last reading (game or by hand), null without one. */
export const chargeReadAt = (d: ChargeDef, char?: string) => reading(d, char)?.at ?? null

/** Projected value now (null without a reading). */
export function chargeNow(d: ChargeDef, char?: string, now = Date.now()): number | null {
  const r = reading(d, char)
  if (!r) return null
  const ticks = d.every === 'day' ? resetsBetween(r.at, now) : Math.floor((now - r.at) / d.every)
  // above the cap (bonus entries): the refill stops, the value stays
  return r.v >= d.cap() ? r.v : Math.min(d.cap(), r.v + ticks * d.regen)
}

/** Milliseconds until full (0 = full, null without a reading). */
export function chargeFullIn(d: ChargeDef, char?: string, now = Date.now()): number | null {
  const r = reading(d, char), v = chargeNow(d, char, now)
  if (!r || v == null) return null
  const ticks = Math.ceil((d.cap() - v) / d.regen)
  if (ticks <= 0) return 0
  if (d.every === 'day') return nextReset('d').getTime() - now + (ticks - 1) * 864e5
  return ticks * d.every - (now - r.at) % d.every
}

export type Light = 'red' | 'yellow' | 'green' | 'none'
/** Red: full or full within 12 h (or by the next reset) – refill is being / about to be lost. Yellow: within 36 h. */
export function chargeLight(d: ChargeDef, char?: string, now = Date.now()): Light {
  const ms = chargeFullIn(d, char, now)
  if (ms == null) return 'none'
  const red = d.every === 'day' ? Math.max(12 * 3600e3, nextReset('d').getTime() - now) : 12 * 3600e3
  return ms <= red ? 'red' : ms <= red + 24 * 3600e3 ? 'yellow' : 'green'
}

export function setCharge(d: ChargeDef, v: number, char?: string, extra?: { auto?: boolean; bonus?: number }) {
  (U.charges ||= {})[key(d, char)] = { v: Math.max(0, Math.min(d.cap(), Math.round(v))), at: Date.now(), ...extra }
  saveUi(['charges']); bump()
}
/** Reading came from the game (not entered by hand), and the Odyle bonus pool sent with it. */
export const chargeAuto = (d: ChargeDef, char?: string) => !manual() && !!reading(d, char)?.auto
export const chargeBonus = (d: ChargeDef, char?: string) => reading(d, char)?.bonus

// Entry charges the server sends when they change or the content window opens (0x0c61 type 04): content id -> left.
const CHARGE_IDS: Record<number, string> = { 4: 'nightmare', 8: 'invasion' }
/** Owner of a game reading: the server slot, or the logged-in character (null while no character is known: the
 *  value would land in another character's slot). */
const gameOwner = (d: ChargeDef): string | undefined | null => (d.per === 'server' ? undefined : S.state.charName || null)
onHost('charge', m => {
  const d = CHARGES.find(x => x.id === CHARGE_IDS[m.id]), owner = d && gameOwner(d)
  if (!d || owner === null || manual()) return
  // the bonus entries (items) come with the login list; keep them until the next one
  setCharge(d, m.left, owner, { auto: true, bonus: reading(d, owner)?.bonus })
})

// Every entry limit of the character (0x0b61, with every map load): [content id, charges left, bonus entries]. Bonus entries
// (from items) sit on top of the charges and do not refill; checked against the game's windows (Shugo 0+12,
// Nightmare 0+21, Ascension trial 0+13).
const ENTRY_IDS: Record<number, string> = { 1: 'shugo', 4: 'nightmare', 8: 'invasion' }
// checklist entries with a weekly entry limit: done = max − left; the bonus entries are shown next to them
const ENTRY_CHECK: Record<number, string> = { 80000001: 'ascensionTrial', 101: 'dailyDungeons' }
/** Key of an entry's bonus in U.entryBonus. */
export const entryBonusKey = (item: string, per: Per, char?: string) => item + '|' + (per === 'server' ? 'srv' : char ?? charKey())
export function applyEntryCharges(list: [number, number, number][]) {
  for (const [id, left, bonus] of list) {
    const d = CHARGES.find(x => x.id === ENTRY_IDS[id]), owner = d && gameOwner(d)
    if (d && owner !== null) setCharge(d, left, owner, { auto: true, bonus })
    const item = CHECK.flatMap(([, items]) => items).find(i => i[0] === ENTRY_CHECK[id])
    if (item && (item[2] === 'server' || S.state.charName)) {
      const kind = CHECK.find(([, items]) => items.includes(item))![0]
      checkSet(item[0], item[2], kind, item[1], item[1] - left)
      U.entryBonus = { ...U.entryBonus, [entryBonusKey(item[0], item[2])]: bonus }; saveUi(['entryBonus'])
    }
  }
}
onHost('entryCharges', m => { if (!manual()) applyEntryCharges(m.list || []) })

// The server sends the logged-in character's Odyle energy when it changes and when the Odyle window opens.
// Above the normal cap there must be a membership.
onHost('odyle', m => {
  const d = CHARGES.find(x => x.id === 'odyle')!
  if (!S.state.charName || manual()) return
  if (m.energy > 560 && !U.member) { U.member = true; saveUi(['member']) }
  setCharge(d, m.energy, charKey(), { auto: true, bonus: m.bonus })
})
/** Set by hand (slider, −/+): the bonus pool read from the game stays. */
export const setChargeByHand = (d: ChargeDef, v: number, char?: string) => setCharge(d, v, char, { bonus: chargeBonus(d, char) })
/** −/+ one step from the projected value (or from 0 without a reading). */
export const stepCharge = (d: ChargeDef, dir: 1 | -1, char?: string) => setChargeByHand(d, (chargeNow(d, char) ?? 0) + dir * d.step, char)

export const chargesOf = (per: Per) => CHARGES.filter(d => d.per === per)
