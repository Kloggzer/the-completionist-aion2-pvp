// Board data types, class defaults and the bridge from the board data to the value model (model.ts).
// A node is worth what it changes in the model: 100 × (w · Δln damage + (1 − w) · Δln EHP), i.e. about "percent".
// Stat nodes by their stats (DAE_KEY), skill nodes by the skill level they add: damage skills by the hit of that level
// (aion2data per level: flat + % Attack) times the skill's share of the rotation, passives by their level table
// (aion2data skill page, e.g. Attack Preparation: +0.5 % PvE damage boost and +2 % defense per level).
import { ASSUME, DAE_KEY, FX_KEY, rotation, type Assume, type Ctx, type Key, type Mode, type ModelSkill } from './model'

export type Stat = { key: string; en: string; de: string; pct: boolean }
/** Skill with its aion2data values: `spec` levels with what opens there, `dmg` damage / healing per level, `fx` the
 *  level table of a skill without damage (passives), `cd` cooldown (s), `max` the points cap, `share` the computed
 *  build's Attack share per second (pve / pvp), `icon` the game's icon file (NCSOFT CDN). */
export type Skill = {
  en: string; de: string; active: boolean; spec?: Record<string, string[]>
  id?: number; max?: number; cd?: number; share?: Record<string, number>; icon?: string
  dmg?: { kind: 'damage' | 'heal'; flat: number[]; pct: number; pvp?: [number, number] }
  fx?: { cols: string[]; lv: number[][] }; cond?: boolean
}
/** [row, col, grade = point cost (0 Start), kind 0 Start | 1 Stat | 2 Skill, ref: [[statIdx, amount]] | skillIdx | 0] */
export type RawNode = [number, number, number, number, [number, number][] | number]
export type Pool = 'pve' | 'ariel' | 'pvp'
export type RawBoard = { name: string; level: number; pool: Pool; nodes: RawNode[]; source?: string }
export type ClassData = { en: string; de: string; skills: Skill[]; boards: Record<string, RawBoard> }
export type DaeData = { source: string; date: string; stats: Stat[]; classes: Record<string, ClassData> }

/** Which model mode a pool is played in by default: Azphel is the PvP board. */
export const POOL_MODE: Record<Pool, Mode> = { pve: 'pve', ariel: 'pve', pvp: 'pvp' }

// Defaults per class id (board id / 10): `off` = output share of the goal (1 = damage only), and the class guide's
// skills: core (the guide's Daevanion picks), good (rest of its setup), skip (Lv 8 filler + Defiance). The rotation
// default is the computed build of aion2data (builds.json) plus core / good; arcana.ts sorts by the same lists.
// Source: wakayashi.gg class guides (27.10.2026), before: aion2data.com class guides, metabot.gg.
export type ClassDef = { off: number; core: string[]; good?: string[]; skip?: string[]; heal?: number }
export const CLASS_DEF: Record<string, ClassDef> = {
  1: {
    off: 0.75, core: ['Attack Preparation', 'Overhead Slam', 'Keen Strike', 'Protection Armor', 'Identify Weakness', 'Rush Strike', 'Survival Stance', 'Ruinous Blow', 'Rending Blow', 'Crushing Wave'],
    good: ['Mocking Blade', 'Leaping Slam', 'Ankle Slice', 'Aerial Snare', 'Experienced Counterstrike', 'Murderous Burst', 'Impact Hit'],
    skip: ['Sword Aura Rampage', 'Defiance'],
  },
  2: {
    off: 0.3, core: ['Warding Strike', 'Punishment', 'Vicious Strike', 'Ironclad Defense', 'Poach', 'Punishing Benediction', 'Debilitating Smash', 'Shield Smite', 'Shield Rush', 'Pummel', 'Judgment', 'Annihilate'],
    good: ['Fury', 'Insulting Roar', 'Impact Hit', 'Survival Willpower', 'Block Pain'], skip: ['Flash Rampage', 'Defiance'],
  },
  3: {
    off: 0.85, core: ["Hunter's Resolve", 'Focused Eye', 'Concentrated Fire', 'Drill Dart', 'Gale Arrow', 'Snipe', 'Tempest Shot', 'Burst Arrow', 'Deadshot'],
    good: ['Snare Shot', 'Marking Shot', 'Explosion Trap', 'Suppressing Arrow', "Hunter's Soul", 'Rooting Eye', 'Vigilant Eye'],
    skip: ['Arrow Scattershot', 'Defiance'],
  },
  4: {
    off: 0.85, core: ['Rear Smite', 'Exploit Weakness', 'Assault Stance', 'Savage Roar', 'Insignia Explosion', 'Heart Gore', 'Quick Slice', 'Storm Rampage'],
    good: ['Ambush', 'Shadowstrike', 'Whirlwind Slice', 'Flash Slice', 'Infiltrate', 'Shadow Fall', 'Impact Hit', 'Ambush Stance', 'Determination'],
    skip: ['Defiance'],
  },
  5: {
    off: 0.8, core: ['Spirit Strike', 'Spirit Revitalization', 'Summon: Earth Spirit', 'Summon: Fire Spirit', 'Summon: Water Spirit', 'Summon: Wind Spirit', 'Combustion', 'Elemental Fusion', 'Corrode', 'Cold Shock', 'Jointstrike: Curse', 'Dimensional Control'],
    good: ['Mental Focus', 'Element Unification', 'Consecutive Countercurrent'],
    skip: ['Rapid Scattershot', 'Defiance'],
  },
  6: {
    off: 0.85, core: ['Fire Mark', 'Robe of Earth', 'Robe of Flame', 'Wish of Concentration', 'Cold Snap', 'Ice Chain', 'Blaze', 'Flame Arrow', 'Firestorm', 'Hellfire', "Winter's Shackles"],
    good: ['Bittercold Wind', 'Frost Burst', 'Grace of Enhancement', 'Vitality Evaporation'],
    skip: ['Flame Scattershot', 'Defiance'],
  },
  7: {
    off: 0.6, heal: 0.6, core: ['Healing Enhancement', "Empyrean Lord's Grace", 'Judgment Thunder', 'Radiant Recovery', 'Healing Light', 'Light of Regeneration', "Earth's Retribution", 'Condemnation', 'Warm Benediction'],
    good: ['Divine Aura', 'Bolt', 'Debilitating Mark', 'Chain of Torment', "Earth's Grace", 'Immortal Veil', 'Survival Willpower'],
    skip: ['Lightning Strike Scattershot', 'Defiance'],
  },
  8: {
    off: 0.7, heal: 0.3, core: ['Attack Preparation', 'Inspiring Spell', 'Tremor Crush', 'Dark Crush', 'Incandescent Blow', 'Heat Wave Blow', 'Spinning Strike', 'Impactful Crush', 'Recuperation', 'Onslaught'],
    good: ['Rushing Smash', 'Wave Blow', "Wind's Promise", 'Impact Hit', "Earth's Promise", 'Blessing of Life'],
    skip: ['Gust Rampage', 'Defiance'],
  },
  9: { off: 0.7, core: ['Chain Fist', 'Exploding Fist', 'Flurry', 'Roundhouse', 'Rampage'] },
}

/** Skill is used by default: active skills of the computed build or the guide's core / good list; passives and buffs
 *  always (their table counts on its own), the guide's skip list never. */
export function defaultUse(cls: string, s: Skill) {
  const d = CLASS_DEF[cls]
  if (d?.skip?.includes(s.en)) return false
  if (!s.active || !s.dmg) return true
  return !!s.share || !!d?.core.includes(s.en) || !!d?.good?.includes(s.en)
}

/** Skill level without Daevanion while it is unknown: the points cap (skill books). */
export const DEFAULT_BASE = 10

/** Settings of one class for the model. */
export type Weights = {
  /** Output share of the goal 0..1 (0 = only defense, 1 = only damage). */
  off: number
  /** Mode per pool (default POOL_MODE). */
  mode: Record<Pool, Mode>
  /** Skill used (en name) -> true / false; missing = defaultUse. */
  use: Record<string, boolean>
  /** Skill level without Daevanion per skill name (en); missing = website or DEFAULT_BASE. */
  base: Record<string, number>
  /** Assumptions changed by the player, per mode. */
  assume: Partial<Record<Mode, Partial<Assume>>>
  /** Stats set to "ignore" (model key). */
  ignore: Key[]
  /** Healers: healing share of the output. */
  heal: number
  /** Percent nodes preferred in the choice (1 = by the model only). */
  pctW: number
}

export const assumeOf = (w: Pick<Weights, 'assume'>, mode: Mode): Assume => ({ ...ASSUME[mode], ...w.assume[mode] })

/** Model context of a class in a mode: its skills with the data and the rotation weights. */
export function modelCtx(c: ClassData, cls: string, mode: Mode, w: Weights): Ctx {
  const a = { ...assumeOf(w, mode), healShare: w.heal }
  const use = c.skills.map(s => w.use[s.en] ?? defaultUse(cls, s))
  // passives with a damage / heal row (procs) are not in the rotation: no cast, no known rate
  const rw = rotation(c.skills.map(s => ({ share: s.share, flat: s.active ? s.dmg?.flat : undefined, pct: s.dmg?.pct, cd: s.cd, heal: s.dmg?.kind === 'heal' })), mode, use, a)
  // crit from specializations: "Critical Hit on hit" / "lands as a Critical Hit" = always; "+30% Skill Critical Hit"
  const critOf = (s: Skill) => Object.entries(s.spec || {}).flatMap(([lv, what]) => what.flatMap(x => {
    const add = /\+(\d+)% Skill Critical Hit/.exec(x)
    if (add) return [{ at: +lv, add: +add[1] }]
    return /Critical Hit on hit|lands as a Critical Hit/.test(x) ? [{ at: +lv }] : []
  }))
  // other specializations: own cooldown cuts, tolerance buffs on skill use (only for skills in the rotation)
  const specOf = (s: Skill): NonNullable<ModelSkill['spec']> => Object.entries(s.spec || {}).flatMap(([lv, what]) => what.flatMap((x): NonNullable<ModelSkill['spec']> => {
    const cd = /^-(\d+)s cooldown$/.exec(x)
    if (cd) return [{ at: +lv, cdCut: +cd[1] }]
    const fx: [Key, number][] = []
    for (const [re, k] of [[/\+(\d+)% PvE Damage Tolerance/, 'pveTol'], [/\+(\d+)% PvP Damage Tolerance/, 'pvpTol']] as const) {
      const m = re.exec(x)
      if (m) fx.push([k, +m[1]])
    }
    return fx.length ? [{ at: +lv, fx }] : []
  }))
  const skills: ModelSkill[] = c.skills.map((s, i) => ({
    crit: s.active ? critOf(s) : undefined, spec: s.active && use[i] ? specOf(s) : undefined,
    flat: s.active ? s.dmg?.flat : undefined, pct: s.dmg?.pct, pvp: s.dmg?.pvp as [number, number] | undefined, cd: s.cd, heal: s.dmg?.kind === 'heal',
    fx: s.fx && use[i] ? { keys: s.fx.cols.map(x => FX_KEY[x] ?? null), lv: s.fx.lv, cond: s.cond } : undefined, w: rw[i],
  }))
  return { mode, a, skills }
}

/** Model effects of a stat node: [model key, amount] (stats outside the model and ignored ones left out). */
export function nodeEffects(n: RawNode, stats: Stat[], ignore: Key[] = []): [Key, number][] {
  if (n[3] !== 1) return []
  const out: [Key, number][] = []
  for (const [s, a] of n[4] as [number, number][]) { const k = DAE_KEY[stats[s].key]; if (k && !ignore.includes(k)) out.push([k, a]) }
  return out
}
