// DPS model (mmoherald.com damage guide):
//   attack = ((pure attack × weapon damage boost) + attack bonus) × attack increase + PvE / boss / positional attack
//   damage = attack × (damage boost + PvE + boss) × crit × Double × Perfect × multi-hit
//   DPS    = damage × combat speed × cooldown factor
// Rates and multipliers come from a measured fight (Abyss Logs) where there is one: crit / Double / Perfect / multi-hit
// rate and the damage factor of each. A stat change moves its rate 1 : 1 (Double Chance +1 % = 1 % more Doubles), crit
// through the conversion the fight implies (rate = crit × (1 + crit increase) / k, capped). Defense of the target is
// left out (training dummy). Everything not measured is an assumption the tab shows and lets the player change.
import { PCT_KEYS, type Key, type Totals } from './stats'
import type { Measured } from './abyss'

export type Assume = {
  /** Crit rate cap (game: 50 %, before the target's resist). */
  critCap: number
  /** Crit stat per 1 % crit rate when no fight says it. */
  critK: number
  /** Crit / Double / Perfect / multi-hit damage factors when no fight says them. */
  critMult: number; doubleMult: number; perfectMult: number; multiMult: number
  /** Share of the damage from skills whose cooldown limits them (the rest is the auto-attack chain). */
  cdShare: number
  /** Share of hits from the front (front attack counts). */
  frontShare: number
  /** Damage boost bucket without the counted sources (base 100 %). */
  bucketBase: number
  /** Pure attack when the gear sum is lower (the class's base attack is not on the character page). */
  atkMin: number
}
export const ASSUME: Assume = { critCap: 50, critK: 25, critMult: 1.5, doubleMult: 2, perfectMult: 1.15, multiMult: 1.15, cdShare: 0.4, frontShare: 0.7, bucketBase: 100, atkMin: 3000 }

/** The model's state: totals plus the rates the fight measured. */
export type State = {
  t: Totals
  critRate: number; critMult: number; doubleRate: number; doubleMult: number; perfectRate: number; perfectMult: number
  multiRate: number; multiMult: number; critK: number
  /** Which numbers come from the fight. */
  measured: Partial<Record<'crit' | 'critMult' | 'double' | 'doubleMult' | 'perfect' | 'perfectMult' | 'multi' | 'multiMult', boolean>>
}

const v = (t: Totals, k: Key) => t[k] || 0
/** Crit stat after crit increase (precision 0.1 % each). */
const critEff = (t: Totals) => v(t, 'crit') * (1 + (v(t, 'critPct') + v(t, 'precision') * 0.1) / 100)

/** State from totals and a measured fight (or the assumptions). */
export function calibrate(t: Totals, m: Measured | null, a: Assume = ASSUME): State {
  const ce = critEff(t)
  // crit conversion from the fight, unless the rate sits at the cap (then the conversion is not visible) or the crit
  // total is too small to be the whole (sources missing); kept within a plausible range
  const critK = m && m.critRate > 0.02 && m.critRate * 100 < a.critCap * 0.97 && ce >= 200 ? Math.min(60, Math.max(12, ce / (m.critRate * 100))) : a.critK
  return {
    t, critK,
    critRate: m ? m.critRate : Math.min(a.critCap, ce / a.critK) / 100,
    critMult: m?.critMult ?? a.critMult + v(t, 'critDmg') / 100,
    doubleRate: m ? m.doubleRate : v(t, 'double') / 100, doubleMult: m?.doubleMult ?? a.doubleMult,
    perfectRate: m ? m.perfectRate : v(t, 'perfect') / 100, perfectMult: m?.perfectMult ?? a.perfectMult,
    multiRate: m ? m.multiRate : v(t, 'multi') / 100, multiMult: m?.multiMult ?? a.multiMult,
    measured: m ? { crit: true, critMult: m.critMult != null, double: true, doubleMult: m.doubleMult != null, perfect: true, perfectMult: m.perfectMult != null, multi: true, multiMult: m.multiMult != null } : {},
  }
}

/** Relative DPS of the state after adding `d` to the totals (only the change matters, not the absolute number). */
export function dps(s: State, d: Totals = {}, a: Assume = ASSUME): number {
  const t = s.t, g = (k: Key) => v(t, k) + (d[k] || 0)
  const pure = Math.max(a.atkMin, v(t, 'atk')) + (d.atk || 0)
  const atkPct = g('atkPct') + g('might') * 0.1
  const attack = (pure * (1 + g('wpn') / 100) + g('atkBonus')) * (1 + atkPct / 100) + g('pveAtk') + g('bossAtk') + g('posAtk') * a.frontShare
  const bucket = (a.bucketBase + g('dmg') + g('pve') + g('boss')) / 100
  // rates move with their stat: crit through the conversion (capped), the others 1 : 1
  const ce0 = critEff(t), ce1 = critEff({ ...t, crit: g('crit'), critPct: g('critPct'), precision: g('precision') })
  const critRate = Math.min(a.critCap / 100, Math.max(0, s.critRate + (ce1 - ce0) / s.critK / 100))
  const critMult = s.critMult + (d.critDmg || 0) / 100
  const dbl = Math.min(1, s.doubleRate + (d.double || 0) / 100), prf = Math.min(1, s.perfectRate + (d.perfect || 0) / 100)
  const mh = Math.min(1, s.multiRate + (d.multi || 0) / 100)
  const hit = attack * bucket * (1 + critRate * (critMult - 1)) * (1 + dbl * (s.doubleMult - 1)) * (1 + prf * (s.perfectMult - 1)) * (1 + mh * (s.multiMult - 1))
  const speed = 1 + g('speed') / 100, cd = 1 / (1 - a.cdShare * Math.min(0.6, g('cdr') / 100))
  return hit * speed * cd
}

/** Step per stat for "what is +1 worth": 1 % for percent stats, 10 for flat ones, 1 point for might / precision. */
export const STEP: Record<Key, number> = Object.fromEntries(
  (['atk', 'atkBonus', 'pveAtk', 'bossAtk', 'posAtk', 'crit'] as Key[]).map(k => [k, 10]).concat(PCT_KEYS.map(k => [k, 1]), [['might', 1], ['precision', 1]]),
) as Record<Key, number>

/** DPS gain in percent for adding `d`. */
export const gain = (s: State, d: Totals, a: Assume = ASSUME) => (dps(s, d, a) / dps(s, {}, a) - 1) * 100

/** Gain in percent per one unit of each stat, at the state shifted by `at` (e.g. minus the Daevanion stats). */
export function marginals(s: State, a: Assume = ASSUME, at: Totals = {}): Record<Key, number> {
  const out = {} as Record<Key, number>, d0 = dps(s, at, a)
  for (const k of Object.keys(STEP) as Key[]) out[k] = (dps(s, { ...at, [k]: (at[k] || 0) + STEP[k] }, a) / d0 - 1) * 100 / STEP[k]
  return out
}
