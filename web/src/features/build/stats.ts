// Character stats for the DPS model: the stats the model uses (K), how the sources name them (plaync stat ids,
// plaync / aion2data stat names, Daevanion stat keys) and the totals from a gear snapshot of the plaync character page.
// Sources not on the page (titles, wings, arcana, enhance set bonuses, the class's own base) are missing: the totals
// are what the gear, deity stats and Daevanion give; the tab lets the player correct each total.

/** Model stats. % stats in percent points, flat stats raw; might / precision in points (0.1 % each). */
export const K = ['atk', 'atkBonus', 'atkPct', 'wpn', 'pveAtk', 'bossAtk', 'posAtk', 'crit', 'critPct', 'critDmg', 'dmg', 'pve', 'boss',
  'double', 'perfect', 'multi', 'speed', 'cdr', 'might', 'precision'] as const
export type Key = typeof K[number]
export type Totals = Partial<Record<Key, number>>
export const PCT_KEYS: Key[] = ['atkPct', 'wpn', 'critPct', 'critDmg', 'dmg', 'pve', 'boss', 'double', 'perfect', 'multi', 'speed', 'cdr']

/** plaync stat id (EStat) -> model key. */
const BY_ID: Record<string, Key> = {
  WeaponFixingDamage: 'atk', Critical: 'crit', AmplifyWeaponDamage: 'wpn', AmplifyAllDamage: 'dmg', PvEAmplifyDamage: 'pve',
  BossNpcAmplifyDamage: 'boss', AmplifyCriticalDamage: 'critDmg', HardHit: 'double', Perfect: 'perfect', AdditionalHitRate: 'multi',
  CombatSpeed: 'speed', CoolTimeDecrease: 'cdr', STR: 'might', AGI: 'precision', CriticalRatio: 'critPct', AttackRatio: 'atkPct',
  PvEAttack: 'pveAtk', BossNpcAttack: 'bossAtk', AmplifyFrontAttack: 'posAtk',
}
/** Stat names (plaync deity lines, aion2data soul binding pools, Daevanion boards) -> model key. */
const BY_NAME: Record<string, Key> = {
  'Attack': 'atk', 'Attack Bonus': 'atkBonus', 'Attack increase': 'atkPct', 'Weapon Damage Boost': 'wpn', 'PvE Attack': 'pveAtk',
  'Boss Attack': 'bossAtk', 'Front Attack': 'posAtk', 'Critical Hit': 'crit', 'Critical Hit increase': 'critPct',
  'Critical Damage Boost': 'critDmg', 'Damage Boost': 'dmg', 'PvE Damage Boost': 'pve', 'Boss Damage Boost': 'boss',
  'Double Chance': 'double', 'Perfect Chance': 'perfect', 'Multi-hit Chance': 'multi', 'Combat Speed': 'speed',
  'Cooldown Reduction': 'cdr', 'Cooldown': 'cdr', 'Might': 'might', 'Precision': 'precision',
}
export const keyOfId = (id: string): Key | null => BY_ID[id] ?? null
export const keyOfName = (name: string): Key | null => BY_NAME[name.trim()] ?? null

/** "20%" / "+15" / "1,234" / "-0.7%" -> number (cooldown lines are negative: -0.7 % cooldown = +0.7 reduction). */
export const amount = (s: unknown) => Number(String(s ?? '').replace(/[+%,\s]/g, '')) || 0

export type Line = { key: Key | null; id: string; name: string; value: number; extra?: number }
export type Item = { slot: string; slotPos: number; id: number; name: string; grade: string; enchant: number; cat: string; main: Line[]; sub: Line[]; stones: Line[] }
export type Snapshot = { at: number; items: Item[]; deity: Line[] }

/** plaync item detail -> Item (weapon attack = the middle of its range). */
export function parseItem(slot: { slotPosName: string; slotPos: number; enchantLevel: number }, d: Record<string, unknown>): Item {
  const lines = (a: unknown, main = false): Line[] => (Array.isArray(a) ? a : []).map(s => {
    const v = amount(s.value), lo = s.minValue != null && main ? amount(s.minValue) : v
    return { key: keyOfId(String(s.id)), id: String(s.id), name: String(s.name ?? s.id), value: (lo + v) / 2, extra: main ? amount(s.extra) : undefined }
  })
  return {
    slot: slot.slotPosName, slotPos: slot.slotPos, id: Number(d.id), name: String(d.name ?? ''), grade: String(d.grade ?? ''),
    enchant: slot.enchantLevel, cat: String(d.categoryName ?? ''), main: lines(d.mainStats, true), sub: lines(d.subStats), stones: lines(d.magicStoneStat),
  }
}

/** plaync info stat list -> deity / main stat lines ("Combat Speed +4.1%"); might / precision as points. */
export function parseDeity(info: { stat?: { statList?: { type: string; name: string; value: number; statSecondList?: string[] | null }[] } }): Line[] {
  const out: Line[] = []
  for (const s of info?.stat?.statList || []) {
    if (s.type === 'STR' || s.type === 'AGI') { out.push({ key: s.type === 'STR' ? 'might' : 'precision', id: s.type, name: s.name, value: s.value }); continue }
    for (const t of s.statSecondList || []) {
      const m = /^(.*?)\s*([+-][\d.]+)%?$/.exec(t)
      if (!m) continue
      const name = m[1].trim(), v = Number(m[2]), key = keyOfName(name)
      // main stats' own lines (Might -> Attack increase) are counted through the points
      if (key && !(s.type === 'STR' && key === 'atkPct') && !(s.type === 'AGI' && key === 'critPct')) out.push({ key, id: s.type, name, value: key === 'cdr' ? -v : v })
    }
  }
  return out
}

export type Source = 'gear' | 'deity' | 'dae'
/** Totals per source and overall. `dae` = [stat key (Daevanion), amount] of the open Daevanion nodes. */
export function totals(snap: Snapshot | undefined, dae: [string, number][]): { by: Record<Source, Totals>; all: Totals } {
  const by: Record<Source, Totals> = { gear: {}, deity: {}, dae: {} }
  const add = (src: Source, k: Key | null, v: number) => { if (k) by[src][k] = (by[src][k] || 0) + v }
  for (const it of snap?.items || []) for (const l of [...it.main, ...it.sub, ...it.stones]) add('gear', l.key, l.value)
  for (const l of snap?.deity || []) add('deity', l.key, l.value)
  for (const [name, v] of dae) add('dae', keyOfName(name), v)
  const all: Totals = {}
  for (const src of Object.values(by)) for (const [k, v] of Object.entries(src)) all[k as Key] = (all[k as Key] || 0) + (v as number)
  return { by, all }
}
