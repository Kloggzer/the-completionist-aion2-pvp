// What a Daevanion node is worth. NCSOFT does not publish the combat power formula, so the value is a weighting:
// - Stat nodes: one Common node of any stat = 1 (e.g. Attack +3 = Defense +30 = HP +100); a percent stat counts
//   1.5 % = 8, so the 4-point Unique corners are worth twice as much per point as Common nodes (the guides rate
//   them highest); offensive percent stats by their place in the damage formula (PCT_VALUE: combat speed most). Each stat is offensive, defensive, always useful or utility; the attack/defense slider weights
//   the first two (0.5 = both ×1), "always" counts ×1 for every build, the per-stat multiplier comes on top.
// - Skill nodes: per class a tier per skill (3 core, 2 good, 1 rarely used, 0 never), defaults from the community
//   class guides (core rotation + recommended Daevanion passives), editable in the tab. Skill levels only matter at
//   breakpoints (per skill editable; default: the levels where the game opens a specialization, from aion2data;
//   passives none, so every level counts; other actives 8 / 12 / 16 / 20): +k Daevanion levels on top of the skill's level without Daevanion are worth one "breakpoint
//   value" per breakpoint they reach, else nothing. Unknown level: the points cap (10).

export type Stat = { key: string; en: string; de: string; pct: boolean }
/** `spec`: levels at which the skill gains a specialization, with what opens (aion2data, active skills only). */
export type Skill = { en: string; de: string; active: boolean; spec?: Record<string, string[]> }
/** [row, col, grade = point cost (0 Start), kind 0 Start | 1 Stat | 2 Skill, ref: [[statIdx, amount]] | skillIdx | 0] */
export type RawNode = [number, number, number, number, [number, number][] | number]
export type Pool = 'pve' | 'ariel' | 'pvp'
export type RawBoard = { name: string; level: number; pool: Pool; nodes: RawNode[]; source?: string }
export type ClassData = { en: string; de: string; skills: Skill[]; boards: Record<string, RawBoard> }
export type DaeData = { source: string; date: string; stats: Stat[]; classes: Record<string, ClassData> }

export type Cat = 'off' | 'def' | 'all' | 'util'
/** Worth it for tanks and healers too: faster rotation, shorter cooldowns, crit damage. */
const ALL = ['Combat Speed', 'Cooldown Reduction', 'Critical Damage Boost']
const OFF = ['Attack Bonus', 'Critical Hit', 'Damage Boost', 'Multi-hit Chance',
  'Accuracy Bonus', 'PvP Attack', 'PvP Critical Hit', 'PvP Accuracy', 'PvP Damage Boost', 'Status Effect Chance',
  'PvE Attack', 'PvE Accuracy', 'PvE Damage Boost', 'Boss Attack', 'Boss Damage Boost']
const DEF = ['Defense Bonus', 'HP', 'Critical Hit Resist', 'Damage Tolerance', 'Critical Damage Tolerance', 'Multi-hit Resist',
  'Evasion Bonus', 'PvP Defense', 'PvP Critical Hit Resist', 'PvP Evasion', 'PvP Damage Tolerance', 'Status Effect Resist',
  'PvE Defense', 'PvE Evasion', 'PvE Damage Tolerance', 'Boss Defense', 'Boss Damage Tolerance']
export const statCat = (key: string): Cat => ALL.includes(key) ? 'all' : OFF.includes(key) ? 'off' : DEF.includes(key) ? 'def' : 'util'

/** Value per 1 % of a percent stat (1.5 % = 8). */
export const PCT_UNIT = 8 / 1.5
/** Offensive percent stats by what they add to damage (mmoherald.com damage guide: damage = … × (damage boost + PvE +
 *  boss + species) × critical damage × Double Chance × …): combat speed means more of every hit (best), cooldown and
 *  multi-hit next, crit damage (+0.4–0.6 % damage per 1 %), the shared damage boost bucket least (+0.3–0.35 % per 1 %,
 *  endgame characters already carry over 100 % of it). Per 1 %; a 1.5 % corner = 16 / 10 / 10 / 9 / 7. */
export const PCT_VALUE: Record<string, number> = {
  'Combat Speed': 16 / 1.5, 'Cooldown Reduction': 10 / 1.5, 'Multi-hit Chance': 10 / 1.5, 'Critical Damage Boost': 9 / 1.5,
  'Damage Boost': 7 / 1.5, 'PvE Damage Boost': 7 / 1.5, 'Boss Damage Boost': 4.5,
}
/** Utility stats (MP) count like a Common node times their multiplier. */
export const UTIL_W = 1
/** Multiplier of a stat until it is set in the tab: MP is worth nothing (only bought on the way to other nodes). */
export const DEFAULT_MULT: Record<string, number> = { MP: 0 }
export const statMult = (key: string, w: Pick<Weights, 'mult'>) => w.mult[key] ?? DEFAULT_MULT[key] ?? 1
/** Multipliers of a class before the player changes any: MP 0, the class's preferred stats, then the player's. */
export const classMult = (cls: string, own: Record<string, number>) => ({ ...DEFAULT_MULT, ...CLASS_DEF[cls]?.mult, ...own })

/** Values per unit from elsewhere (the private build's DPS model): Daevanion stat key -> value per unit, replacing
 *  the fixed ones above for the stats it knows. `ver` changes when the values do (plan memo). */
export const unitHook: { fn: ((cls: string) => Record<string, number> | null) | null; ver: number } = { fn: null, ver: 0 }

/** Value per unit of every stat for one class: 1 / the amount a Common node gives on its boards (Brawler nodes give
 *  more than the others: Attack +5, Defense +50); percent stats PCT_UNIT. */
export function statUnits(d: DaeData, cls: string): number[] {
  const common: number[] = d.stats.map(() => 0)
  for (const b of Object.values(d.classes[cls].boards)) for (const n of b.nodes)
    if (n[3] === 1 && n[2] === 1) for (const [s, a] of n[4] as [number, number][]) if (!common[s] || a < common[s]) common[s] = a
  const over = unitHook.fn?.(cls)
  return d.stats.map((s, i) => over?.[s.key] ?? (s.pct ? PCT_VALUE[s.key] ?? PCT_UNIT : common[i] ? 1 / common[i] : 0))
}

/** Skill node value per tier, in Common-node units: [Legend (3 points, active skill), Rare (2 points, passive)]. */
export const TIER_VALUE: Record<number, [number, number]> = { 3: [5, 3.2], 2: [3, 2], 1: [1.2, 0.8], 0: [0, 0] }
export const TIERS = [3, 2, 1, 0] as const

// Defaults per class id (board id / 10): attack share of the slider, tier 3 (core), tier 2 (good), tier 0 (skip), and
// stat multipliers for the stats the guides want most. With a `good` list, other actives default to 1 (not on any PvE
// bar), without one to 2. Passives not listed: 1.
// Source: wakayashi.gg class guides (Stand 27.10.2026): core = the guide's Daevanion skill picks ("Skill-Stufen"),
// good = the rest of its skill setup (Lv 12-20 tiles) and its first passives, skip = the Lv 8 filler + Defiance.
// Before: aion2data.com class guides (raw/class-guides.json), metabot.gg; Templar from player feedback (CLASS_DEF_OLD).
export type ClassDef = { off: number; core: string[]; good?: string[]; skip?: string[]; mult?: Record<string, number> }
export const CLASS_DEF: Record<string, ClassDef> = {
  1: {
    off: 0.75, core: ['Attack Preparation', 'Overhead Slam', 'Keen Strike', 'Protection Armor', 'Identify Weakness', 'Rush Strike', 'Survival Stance', 'Ruinous Blow', 'Rending Blow', 'Crushing Wave'],
    good: ['Mocking Blade', 'Leaping Slam', 'Ankle Slice', 'Aerial Snare', 'Experienced Counterstrike', 'Murderous Burst', 'Impact Hit'],
    skip: ['Sword Aura Rampage', 'Defiance'], mult: { 'Critical Hit': 1.5 },
  },
  2: {
    off: 0.3, core: ['Warding Strike', 'Punishment', 'Vicious Strike', 'Ironclad Defense', 'Poach', 'Punishing Benediction', 'Debilitating Smash', 'Shield Smite', 'Shield Rush', 'Pummel', 'Judgment', 'Annihilate'],
    good: ['Fury', 'Insulting Roar', 'Impact Hit', 'Survival Willpower', 'Block Pain'], skip: ['Flash Rampage', 'Defiance'],
  },
  3: {
    off: 0.85, core: ["Hunter's Resolve", 'Focused Eye', 'Concentrated Fire', 'Drill Dart', 'Gale Arrow', 'Snipe', 'Tempest Shot', 'Burst Arrow', 'Deadshot'],
    good: ['Snare Shot', 'Marking Shot', 'Explosion Trap', 'Suppressing Arrow', "Hunter's Soul", 'Rooting Eye', 'Vigilant Eye'],
    skip: ['Arrow Scattershot', 'Defiance'], mult: { 'Critical Hit': 1.5, 'Damage Boost': 1.5 },
  },
  4: {
    off: 0.85, core: ['Rear Smite', 'Exploit Weakness', 'Assault Stance', 'Savage Roar', 'Insignia Explosion', 'Heart Gore', 'Quick Slice', 'Storm Rampage'],
    good: ['Ambush', 'Shadowstrike', 'Whirlwind Slice', 'Flash Slice', 'Infiltrate', 'Shadow Fall', 'Impact Hit', 'Ambush Stance', 'Determination'],
    skip: ['Defiance'], mult: { 'Critical Hit': 1.5, 'Cooldown Reduction': 1.5 },
  },
  5: {
    off: 0.8, core: ['Spirit Strike', 'Spirit Revitalization', 'Summon: Earth Spirit', 'Summon: Fire Spirit', 'Summon: Water Spirit', 'Summon: Wind Spirit', 'Combustion', 'Elemental Fusion', 'Corrode', 'Cold Shock', 'Jointstrike: Curse', 'Dimensional Control'],
    good: ['Mental Focus', 'Element Unification', 'Consecutive Countercurrent'],
    skip: ['Rapid Scattershot', 'Defiance'], mult: { 'Critical Damage Boost': 1.5, 'Damage Boost': 1.5 },
  },
  6: {
    off: 0.85, core: ['Fire Mark', 'Robe of Earth', 'Robe of Flame', 'Wish of Concentration', 'Cold Snap', 'Ice Chain', 'Blaze', 'Flame Arrow', 'Firestorm', 'Hellfire', "Winter's Shackles"],
    good: ['Bittercold Wind', 'Frost Burst', 'Grace of Enhancement', 'Vitality Evaporation'],
    skip: ['Flame Scattershot', 'Defiance'], mult: { 'Critical Damage Boost': 1.5, 'Damage Boost': 1.5 },
  },
  7: {
    off: 0.5, core: ['Healing Enhancement', "Empyrean Lord's Grace", 'Judgment Thunder', 'Radiant Recovery', 'Healing Light', 'Light of Regeneration', "Earth's Retribution", 'Condemnation', 'Warm Benediction'],
    good: ['Divine Aura', 'Bolt', 'Debilitating Mark', 'Chain of Torment', "Earth's Grace", 'Immortal Veil', 'Survival Willpower'],
    skip: ['Lightning Strike Scattershot', 'Defiance'], mult: { 'Attack Bonus': 1.5 },
  },
  8: {
    off: 0.7, core: ['Attack Preparation', 'Inspiring Spell', 'Tremor Crush', 'Dark Crush', 'Incandescent Blow', 'Heat Wave Blow', 'Spinning Strike', 'Impactful Crush', 'Recuperation', 'Onslaught'],
    good: ['Rushing Smash', 'Wave Blow', "Wind's Promise", 'Impact Hit', "Earth's Promise", 'Blessing of Life'],
    skip: ['Gust Rampage', 'Defiance'], mult: { 'Critical Hit': 1.5, 'Damage Boost': 1.5 },
  },
  9: { off: 0.7, core: ['Chain Fist', 'Exploding Fist', 'Flurry', 'Roundhouse', 'Rampage'] },
}
/** Backup of the earlier Templar setup (player feedback). */
export const CLASS_DEF_OLD: Record<string, ClassDef> = {
  2: { off: 0.3, core: ['Punishment', 'Shield Smite', 'Judgment', 'Warding Strike', 'Annihilate', 'Vicious Strike', 'Pummel', 'Enhance Health', 'Ironclad Defense', 'Guarding Seal', 'Fury', 'Insulting Roar'], skip: ['Flash Rampage', 'Defiance'] },
}

/** Skill levels that can do something; skills without known specializations use all of them. */
export const BREAKPOINTS = [8, 12, 16, 20]
/** Level skill points buy (the game's learn cap): assumed level without Daevanion while it is unknown. */
export const DEFAULT_BASE = 10
/** Default breakpoints of a skill: its specialization levels (game data); passives none (every level counts);
 *  other actives BREAKPOINTS. No breakpoints = every level counts on its own. */
export const defaultBps = (sk: Skill) => (sk.spec ? Object.keys(sk.spec).map(Number).sort((a, b) => a - b) : sk.active ? BREAKPOINTS : [])
/** A breakpoint is worth this many single skill levels (about what the four Daevanion nodes of a skill give). */
export const BP_NODES = 4

/** Value of k Daevanion levels of a skill: per breakpoint in (base, base + k]; unknown base = DEFAULT_BASE; no
 *  breakpoints: every level on its own. */
export function skillCurve(perNode: number, base: number | null, bps: number[] = BREAKPOINTS) {
  if (!bps.length) return (k: number) => perNode * k
  const b0 = base ?? DEFAULT_BASE
  return (k: number) => perNode * BP_NODES * bps.filter(b => b > b0 && b <= b0 + k).length
}

export function defaultTier(cls: string, s: Skill) {
  const d = CLASS_DEF[cls]
  if (!d) return s.active ? 2 : 1
  return d.core.includes(s.en) ? 3 : d.skip?.includes(s.en) ? 0 : d.good?.includes(s.en) ? 2 : s.active && !d.good ? 2 : 1
}

export type Weights = {
  /** Attack share 0..1 (0 = only defense, 1 = only attack). */
  off: number
  /** Extra multiplier per stat key (default 1). */
  mult: Record<string, number>
  /** Tier per skill name (en), default from defaultTier. */
  tiers: Record<string, number>
  /** Skill level without Daevanion per skill name (en); missing = unknown. */
  base?: Record<string, number>
  /** Breakpoints per skill name (en); missing = BREAKPOINTS. */
  bps?: Record<string, number[]>
}

/** Value of one stat effect. */
export function effectValue(key: string, amount: number, unit: number, w: Weights) {
  const cat = statCat(key), m = statMult(key, w)
  const cw = cat === 'off' ? 2 * w.off : cat === 'def' ? 2 * (1 - w.off) : cat === 'all' ? 1 : UTIL_W
  return amount * unit * cw * m
}

/** Value of one skill level of skill `sk` from a node of grade `grade` (Legend = active, Rare = passive). */
export function perNodeValue(sk: Skill, grade: number, clsId: string, w: Weights) {
  const tier = w.tiers[sk.en] ?? defaultTier(clsId, sk)
  return TIER_VALUE[tier]?.[grade >= 3 ? 0 : 1] ?? 0
}

/** Value of a node on its own (Start = 0). Skill nodes: the linear value (planPool groups them by skill instead). */
export function nodeValue(n: RawNode, cls: ClassData, clsId: string, units: number[], stats: Stat[], w: Weights) {
  if (n[3] === 1) return (n[4] as [number, number][]).reduce((v, [s, a]) => v + effectValue(stats[s].key, a, units[s], w), 0)
  if (n[3] === 2) return perNodeValue(cls.skills[n[4] as number], n[2], clsId, w)
  return 0
}
