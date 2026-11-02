// The character's own stats for the value model, from the public plaync character page (no game traffic):
//   equipment + equipment/item  -> gear lines (main stats incl. enhance bonus, random stats, magic stones)
//   info.stat.statList          -> main and deity stats as the page converts them ("Combat Speed +4.1%")
//   info.profile.combatPower    -> Combat Power (shown and kept per load; its formula is not public)
// Sources the page does not show (titles, wings, arcana stats, the class's own base) are not in the totals: the tab
// lets the player enter the character window's numbers instead (U.dae.own).
import type { Key, Totals } from './model'

/** plaync stat id (gear lines) -> model key. Main stat points (STR, AGI …) are left out: info converts them. */
const BY_ID: Record<string, Key> = {
  WeaponFixingDamage: 'atk', FixingDamage: 'atkBonus', AttackRatio: 'atkPct', AmplifyWeaponDamage: 'wpn', PvEAttack: 'pveAtk',
  BossNpcAttack: 'bossAtk', PvPAttack: 'pvpAtk', FrontAttackDamage: 'posAtk', BackAttackDamage: 'posAtk', Critical: 'crit',
  PvPCritical: 'pvpCrit', CriticalRatio: 'critPct', AmplifyCriticalDamage: 'critDmg', AmplifyAllDamage: 'dmg',
  PvEAmplifyDamage: 'pve', BossNpcAmplifyDamage: 'boss', PvPAmplifyDamage: 'pvp', HardHit: 'double', Perfect: 'perfect',
  AdditionalHitRate: 'multi', CombatSpeed: 'speed', CoolTimeDecrease: 'cdr', WeaponAccuracy: 'acc', Accuracy: 'acc',
  PvEAccuracy: 'pveAcc', PvPAccuracy: 'pvpAcc', HPMax: 'hp', ArmorDefense: 'def', Defense: 'def', PvEDefense: 'pveDef',
  BossNpcDefense: 'bossDef', PvPDefense: 'pvpDef', ArmorEvasion: 'eva', Evasion: 'eva', PvEEvasion: 'pveEva', PvPEvasion: 'pvpEva',
  Block: 'block', CriticalResist: 'critRes', PvPCriticalResist: 'pvpCritRes', ReduceAllDamage: 'tol', PvEReduceDamage: 'pveTol',
  PvPReduceDamage: 'pvpTol', BossNpcReduceDamage: 'bossTol', Endurance: 'endurance',
}
/** Converted main / deity stat lines of the info answer ("Defense increase +4.1%") -> model key. */
const BY_LINE: Record<string, Key> = {
  'Attack increase': 'atkPct', 'Critical Hit increase': 'critPct', 'Accuracy increase': 'accPct', 'Evasion increase': 'evaPct',
  'Block increase': 'blockPct', 'Critical Hit Resist increase': 'critResPct', 'Defense increase': 'defPct', 'HP increase': 'hpPct',
  'Combat Speed': 'speed', 'Cooldown': 'cdr', 'Double Chance': 'double', 'Perfect Chance': 'perfect', 'Endurance': 'endurance',
}

/** "20%" / "+15" / "1,234" / "-0.7%" -> number. */
export const amount = (s: unknown) => Number(String(s ?? '').replace(/[+%,\s]/g, '')) || 0

export type Line = { key: Key | null; id: string; name: string; value: number }
export type Item = { slot: string; name: string; lines: Line[] }
export type Gear = { at: number; items: Item[]; stats: Line[] }

/** plaync item detail -> Item. Weapon attack = the middle of its range, plus the enhance bonus ("extra"). */
export function parseItem(slot: { slotPosName?: string }, d: Record<string, unknown>): Item {
  const lines: Line[] = []
  const add = (a: unknown, main: boolean) => {
    for (const s of Array.isArray(a) ? a : []) {
      const id = String(s?.id ?? ''), hi = amount(s?.value), lo = main && s?.minValue != null ? amount(s.minValue) : hi
      const value = (lo + hi) / 2 + (main ? amount(s?.extra) : 0)
      if (value) lines.push({ key: BY_ID[id] ?? null, id, name: String(s?.name ?? id), value })
    }
  }
  add(d.mainStats, true); add(d.subStats, false); add(d.magicStoneStat, false)
  return { slot: String(slot.slotPosName ?? ''), name: String(d.name ?? ''), lines }
}

/** plaync info answer -> converted main / deity stat lines (cooldown lines are negative: −0.5 % = +0.5 reduction). */
export function parseStats(info: { stat?: { statList?: { type?: string; statSecondList?: string[] | null }[] } } | null | undefined): Line[] {
  const out: Line[] = []
  for (const s of info?.stat?.statList || []) for (const t of s.statSecondList || []) {
    const m = /^(.*?)\s*([+-][\d.]+)%?$/.exec(t)
    if (!m) continue
    const name = m[1].trim(), key = BY_LINE[name] ?? null, v = Number(m[2])
    out.push({ key, id: String(s.type ?? ''), name, value: key === 'cdr' ? -v : v })
  }
  return out
}

export const parseCp = (info: { profile?: { combatPower?: unknown } } | null | undefined) =>
  typeof info?.profile?.combatPower === 'number' ? info.profile.combatPower : null

/** Totals of a gear snapshot: gear lines and converted main / deity stats. */
export function gearTotals(g: Gear | undefined): Totals {
  const t: Totals = {}
  for (const l of [...(g?.items || []).flatMap(i => i.lines), ...(g?.stats || [])]) if (l.key) t[l.key] = (t[l.key] || 0) + l.value
  return t
}

/** Lines the model does not use (shown in the tab as "not in the model"), summed by name. */
export function unused(g: Gear | undefined): [string, number][] {
  const m = new Map<string, number>()
  for (const l of [...(g?.items || []).flatMap(i => i.lines), ...(g?.stats || [])]) if (!l.key) m.set(l.name, (m.get(l.name) || 0) + l.value)
  return [...m]
}
