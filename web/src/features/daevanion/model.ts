// Value model of the Daevanion tab (pure): what a stat or a skill level is worth for one character, in real units.
//
//   output  = relative damage per second (and healing for healers) from the community damage formula
//             (mmoherald.com, kanonxo / Aion Research Lab; same formula on gameplay.tips, aion2maps, akunito):
//               attack = ((pure attack × weapon damage boost) + attack bonus) × attack increase + PvE / boss / PvP attack
//               hit    = flat of the skill level + % of Attack (aion2data skills.json, per level)
//               damage = hit × (damage boost + PvE + boss | PvP) × crit × Double × Perfect × multi-hit × positional
//               DPS    = Σ skills in the rotation (hit / cooldown, cooldowns shortened by CDR, cap 60 %) × combat speed
//             Caps from the game texts (aion2data stats.json): crit rate 50 %, evasion 30 %, cooldown 60 %.
//   ehp     = effective HP against one reference hit: HP / expected damage taken (defense minus the attacker's
//             penetration takes off 10 % of its value per hit in PvE, 1 % in PvP; damage tolerance works against the
//             attacker's matching damage boost (general / PvE / PvP) and shrinks the damage bucket; crit resist,
//             endurance, evasion / block; status effect resist against being controlled, which costs extra damage).
//             Status effect chance: own control hits, worth extra damage (mostly in PvP).
//   The reference character and the attacker are the game's own totals at the level cap (aion2data power-stats.json:
//   every permanent system, Daevanion taken out), not guesses.
//   score   = w · ln(output / output0) + (1 − w) · ln(ehp / ehp0): percent damage and percent EHP on one scale.
//
// Everything the character page does not show is an assumption (ASSUME, per mode) the tab lists with its source and
// lets the player change. Stats are model keys (K); the boards, gear and skill tables are mapped onto them.

export type Mode = 'pve' | 'pvp'
/** Model stats. Percent stats in percent points, flat stats raw. */
export const K = [
  // offense
  'atk', 'atkBonus', 'atkPct', 'wpn', 'pveAtk', 'bossAtk', 'pvpAtk', 'posAtk', 'crit', 'pvpCrit', 'critPct', 'critDmg',
  'dmg', 'pve', 'boss', 'pvp', 'posDmg', 'double', 'perfect', 'multi', 'speed', 'cdr', 'acc', 'pveAcc', 'pvpAcc', 'accPct', 'heal',
  // defense
  'hp', 'hpPct', 'def', 'defPct', 'pveDef', 'bossDef', 'pvpDef', 'eva', 'pveEva', 'pvpEva', 'evaPct', 'block', 'blockPct',
  'critRes', 'pvpCritRes', 'critResPct', 'critTol', 'tol', 'pveTol', 'bossTol', 'pvpTol', 'endurance', 'multiRes',
  // status effects (control): own chance (offense), resist (defense)
  'statusChance', 'statusRes',
] as const
export type Key = typeof K[number]
export type Totals = Partial<Record<Key, number>>
export const OFF_KEYS = new Set<Key>([...K.slice(0, K.indexOf('heal') + 1), 'statusChance'])

/** Daevanion board stat (plaync effect name) -> model key; missing = not in the model (MP). */
export const DAE_KEY: Record<string, Key> = {
  'Combat Speed': 'speed', 'Attack Bonus': 'atkBonus', 'Critical Hit Resist': 'critRes', 'Critical Hit': 'crit',
  'Cooldown Reduction': 'cdr', 'Defense Bonus': 'def', 'HP': 'hp', 'Damage Tolerance': 'tol', 'Damage Boost': 'dmg',
  'Critical Damage Boost': 'critDmg', 'Critical Damage Tolerance': 'critTol', 'Multi-hit Resist': 'multiRes',
  'Multi-hit Chance': 'multi', 'PvP Damage Tolerance': 'pvpTol', 'PvP Attack': 'pvpAtk', 'PvP Defense': 'pvpDef',
  'PvP Critical Hit': 'pvpCrit', 'PvP Critical Hit Resist': 'pvpCritRes', 'PvP Accuracy': 'pvpAcc', 'PvP Evasion': 'pvpEva',
  'PvP Damage Boost': 'pvp', 'Evasion Bonus': 'eva', 'Accuracy Bonus': 'acc', 'PvE Damage Boost': 'pve', 'Boss Attack': 'bossAtk',
  'PvE Attack': 'pveAtk', 'PvE Defense': 'pveDef', 'PvE Accuracy': 'pveAcc', 'PvE Evasion': 'pveEva', 'Boss Defense': 'bossDef',
  'PvE Damage Tolerance': 'pveTol', 'Boss Damage Boost': 'boss', 'Boss Damage Tolerance': 'bossTol',
  'Status Effect Chance': 'statusChance', 'Status Effect Resist': 'statusRes',
}
/** Column of a skill's level table (aion2data skill page) -> model key; others are not in the model. */
export const FX_KEY: Record<string, Key> = {
  'PvE Damage Boost %': 'pve', 'PvP Damage Boost %': 'pvp', 'Max HP %': 'hpPct', 'HP': 'hp', 'PvE Damage Tolerance %': 'pveTol',
  'PvP Damage Tolerance %': 'pvpTol', 'Double Chance %': 'double', 'Defense %': 'defPct', 'Perfect Chance %': 'perfect',
  'Critical Damage Boost %': 'critDmg', 'Critical Hit': 'crit', 'Front Attack Damage Boost %': 'posDmg',
  'Back Attack Damage Boost %': 'posDmg', 'Endurance %': 'endurance', 'Attack %': 'atkPct', 'Critical Hit Resist': 'critRes',
  'Heal Boost %': 'heal', 'Status Effect Resist %': 'statusRes', 'Status Effect Chance %': 'statusChance',
}

export type Assume = {
  /** Pure Attack, HP and Defense of the class without gear (not on the character page). */
  atkBase: number; hpBase: number; defBase: number
  /** Damage boost bucket without the counted sources (titles, wings, arcana …), in percent. */
  bucket: number
  /** Crit rate per 100 Critical Hit above the target's Critical Hit Resist, the cap, the crit damage base. */
  critPer100: number; critCap: number; critMult: number
  /** Target: Critical Hit Resist, Double Resist (%), Evasion + Block that Accuracy has to cancel. */
  tgtCritRes: number; tgtDoubleRes: number; tgtEva: number
  /** Miss chance per 100 Accuracy short of the target, and its cap (%). */
  missPer100: number; missCap: number
  /** Damage factor of a Double, a Perfect, a multi-hit; share of hits from the front/back. */
  doubleMult: number; perfectMult: number; multiMult: number; posShare: number
  /** Share of the damage from skills without a cooldown (the filler chain). */
  filler: number
  /** Up-time of skill effects that only last a few seconds ("for 20s on Block"). */
  uptime: number
  /** Healers: share of healing in the output (0 = damage only). */
  healShare: number
  /** Incoming reference hit: raw damage, the attacker's general and mode (PvE / PvP) damage boost, penetration, crit
   *  chance and factor, accuracy, multi-hit. */
  hitRaw: number; attDmg: number; attBoost: number; attPen: number; attCrit: number; attCritMult: number; attAcc: number; attMulti: number
  /** Control: the attacker's status effect chance (%) and how much more damage a controlled character takes (0.5 =
   *  +50 %); own base control chance (%), the target's resist (%) and what a controlled target is worth (damage). */
  attStatus: number; ccTaken: number; ownStatus: number; tgtStatusRes: number; ccDmg: number
}
// Character level parts from aion2data power-stats.json (HP 5,702-6,202, Defense Bonus 450); the pure Attack floor
// only matters while the page shows no weapon.
// bucket: the damage boost bucket without the counted sources; endgame characters already carry well over 100 % from
// titles, arcana, buffs (mmoherald: +1 % damage boost = +0.3-0.35 % damage, +1 % crit damage = +0.4-0.6 %), so 200.
const COMMON = { atkBase: 1000, hpBase: 5950, defBase: 450, bucket: 200, critPer100: 6.5, critCap: 50, critMult: 1.5, missPer100: 6.5,
  missCap: 80, doubleMult: 2, perfectMult: 1.1, multiMult: 1.15, posShare: 0.7, filler: 0.25, uptime: 0.5, attCritMult: 1.5, attMulti: 10 }
// Control (ccTaken / ccDmg): PvP is decided by control (a controlled player takes about twice the damage, a
// controlled target is a kill), bosses knock down and stun – estimates set after player feedback.
// PvP attacker = a player with the level-cap totals (aion2data power-stats: Damage Boost 21.5-28.5 %, PvP Damage Boost
// 39-43 %, Penetration 1,900, Status Effect Chance 10.5 %); a boss: estimates.
export const ASSUME: Record<Mode, Assume> = {
  pve: { ...COMMON, tgtCritRes: 530, tgtDoubleRes: 30, tgtEva: 1200, healShare: 0, hitRaw: 10000, attDmg: 15, attBoost: 20, attPen: 0, attCrit: 20, attAcc: 1500,
    attStatus: 20, ccTaken: 0.3, ownStatus: 0, tgtStatusRes: 50, ccDmg: 0.02 },
  pvp: { ...COMMON, tgtCritRes: 600, tgtDoubleRes: 20, tgtEva: 1000, healShare: 0, hitRaw: 6000, attDmg: 25, attBoost: 41, attPen: 1900, attCrit: 30, attAcc: 1200,
    attStatus: 35, ccTaken: 1, ownStatus: 20, tgtStatusRes: 10.5, ccDmg: 0.6 },
}
/** Where each assumption comes from (i18n key suffix: dae.src.<value>). */
export const ASSUME_SRC: Record<keyof Assume, string> = {
  atkBase: 'est', hpBase: 'a2d', defBase: 'a2d', bucket: 'mmo', critPer100: 'mmo', critCap: 'game', critMult: 'mmo',
  tgtCritRes: 'mmo', tgtDoubleRes: 'mmo', tgtEva: 'mmo', missPer100: 'mmo', missCap: 'mmo', doubleMult: 'est',
  perfectMult: 'mmo', multiMult: 'est', posShare: 'mmo', filler: 'est', uptime: 'est', healShare: 'est',
  hitRaw: 'est', attDmg: 'a2d', attBoost: 'a2d', attPen: 'a2d', attCrit: 'est', attCritMult: 'mmo', attAcc: 'est', attMulti: 'est',
  attStatus: 'est', ccTaken: 'est', ownStatus: 'est', tgtStatusRes: 'a2d', ccDmg: 'est',
}

/** Character sheet used while the page gives no gear: a level-cap character WITHOUT its Daevanion boards (the plan adds
 *  those), from the game's totals (aion2data power-stats.json, middle of each range, the Daevanion part taken out; HP
 *  and Defense without the character level part, which hpBase / defBase add). Not in that list (arcana, soul binding,
 *  deity points: crit, Double, speed, accuracy, attack increase): estimates. Every number replaceable in the tab. */
export const TYPICAL: Totals = {
  atk: 1739, atkBonus: 223, wpn: 10, atkPct: 10, crit: 700, critPct: 5, dmg: 18.5, pve: 10, pvp: 33, double: 30, perfect: 5, multi: 5,
  speed: 5, cdr: 5, acc: 1300, pveAtk: 76, bossAtk: 70, pvpAtk: 4, pvpCrit: 10, pvpAcc: 40,
  hp: 9041, hpPct: 22.5, def: 13959, pveDef: 410, bossDef: 600, pvpDef: 110, eva: 900, pvpEva: 20, block: 275, critRes: 212, pvpCritRes: 5,
  tol: 23.5, pveTol: 11.5, pvpTol: 19, statusChance: 2.5, statusRes: 2.5,
}

/** Stats whose class / level base the website does not show (its gear and main stat lines give a level-cap Templar
 *  about 480 Accuracy, 310 Crit, 100 Evasion): with gear from the page they are at least TYPICAL's, or accuracy and
 *  evasion nodes look like they fix 30-40 % misses and crit nodes like they start from 0 %. */
export const SHEET_BASE: Key[] = ['acc', 'crit', 'eva', 'critRes']

/** A skill as the model sees it. `flat` per level (index 0 = level 1); `fx` its stat table per level (passives). */
export type ModelSkill = {
  flat?: number[]; pct?: number; pvp?: [number, number]; cd?: number; heal?: boolean
  /** Crit from the skill's specializations: from level `at` on it always crits, or `add` % more crit chance (game
   *  data: "Critical Hit on hit", "lands as a Critical Hit", "+30% Skill Critical Hit"). */
  crit?: { at: number; add?: number }[]
  /** Other specializations the model counts, from level `at` on: own cooldown shorter by `cdCut` s ("-10s cooldown"),
   *  stats while the skill's effect runs (`fx`, times uptime: "+10% PvE Damage Tolerance … on skill use"). */
  spec?: { at: number; cdCut?: number; fx?: [Key, number][] }[]
  fx?: { keys: (Key | null)[]; lv: number[][]; cond?: boolean }
  /** Rotation weight (0 = not used): share of the base damage; set by `rotation`. */
  w: number
}
export type Ctx = { mode: Mode; a: Assume; skills: ModelSkill[] }

const v = (t: Totals, k: Key) => t[k] || 0
const at = <T>(arr: T[], lv: number) => arr[Math.max(0, Math.min(arr.length - 1, Math.round(lv) - 1))]
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
// rate from a stat difference without a cliff at 0: linear far above (per100 % per 100 points), fading out over about
// SOFT points around the threshold (the real targets differ, so a little accuracy over the assumed evasion still counts)
const SOFT = 150
const soft = (d: number, per100: number) => (d / SOFT > 30 ? d : SOFT * Math.log1p(Math.exp(d / SOFT))) * per100 / 100

/** Totals plus what the skills' effect tables give at their levels. */
export function withSkillFx(t: Totals, lv: number[], ctx: Ctx): Totals {
  const out: Totals = { ...t }
  ctx.skills.forEach((s, i) => {
    if (!s.fx || lv[i] < 1) return
    const row = at(s.fx.lv, lv[i]), up = s.fx.cond ? ctx.a.uptime : 1
    s.fx.keys.forEach((k, c) => { if (k) out[k] = v(out, k) + row[c] * up })
  })
  ctx.skills.forEach((s, i) => {
    for (const x of s.spec || []) if (lv[i] >= x.at) for (const [k, a] of x.fx || []) out[k] = v(out, k) + a * ctx.a.uptime
  })
  return out
}

export function attackOf(t: Totals, ctx: Ctx) {
  const a = ctx.a, pure = Math.max(a.atkBase, v(t, 'atk'))
  const extra = ctx.mode === 'pve' ? v(t, 'pveAtk') + v(t, 'bossAtk') : v(t, 'pvpAtk')
  return (pure * (1 + v(t, 'wpn') / 100) + v(t, 'atkBonus')) * (1 + v(t, 'atkPct') / 100) + extra + v(t, 'posAtk') * a.posShare
}

/** Rates the output uses (shown in the tab). */
export function rates(t: Totals, ctx: Ctx) {
  const a = ctx.a, pvp = ctx.mode === 'pvp'
  const crit = (v(t, 'crit') + (pvp ? v(t, 'pvpCrit') : 0)) * (1 + v(t, 'critPct') / 100)
  const acc = (v(t, 'acc') + (pvp ? v(t, 'pvpAcc') : v(t, 'pveAcc'))) * (1 + v(t, 'accPct') / 100)
  return {
    crit: clamp((crit - a.tgtCritRes) * a.critPer100 / 100, 0, a.critCap) / 100,
    critMult: a.critMult + v(t, 'critDmg') / 100,
    double: clamp(v(t, 'double') - a.tgtDoubleRes, 0, 100) / 100,
    perfect: clamp(v(t, 'perfect'), 0, 100) / 100,
    multi: clamp(v(t, 'multi'), 0, 100) / 100,
    miss: clamp(soft(a.tgtEva - acc, a.missPer100), 0, a.missCap) / 100,
    cdr: Math.min(0.6, v(t, 'cdr') / 100),
  }
}

/** Relative damage (and healing) per second at totals `t` (skill effects already in) and skill levels `lv`. */
export function output(t: Totals, lv: number[], ctx: Ctx) {
  const a = ctx.a, pvp = ctx.mode === 'pvp', A = attackOf(t, ctx), r = rates(t, ctx)
  let dmg = 0, heal = 0, filler = 0, wsum = 0
  // crit per skill: the general rate, raised by the skill's own specializations at its level
  const critOf = (s: ModelSkill, lv: number) => {
    let c = r.crit
    for (const x of s.crit || []) if (lv >= x.at) c = x.add == null ? 1 : Math.min(1, c + x.add / 100)
    return 1 + c * (r.critMult - 1)
  }
  ctx.skills.forEach((s, i) => {
    if (!s.w || !s.flat || lv[i] < 1) return
    // a shorter cooldown: the skill comes more often
    const cut = (s.spec || []).reduce((n, x) => n + (lv[i] >= x.at ? x.cdCut || 0 : 0), 0), often = s.cd && cut ? s.cd / Math.max(1, s.cd - cut) : 1
    let flat = at(s.flat, lv[i]), pct = s.pct || 0
    // PvP: the second value set (known at the points cap, level 10), the flat part scaled by level
    const ref = s.flat[9] ?? s.flat[s.flat.length - 1]
    if (pvp && s.pvp) { flat *= ref ? s.pvp[0] / ref : 1; pct = s.pvp[1] }
    // w is the skill's share at level 10 and base Attack; the hit at its level and Attack scales it
    const part = s.w * (flat + pct / 100 * A) / ((pvp && s.pvp ? s.pvp[0] : ref) + pct / 100 * a.atkBase || 1) * (s.heal ? 1 : critOf(s, lv[i])) * often
    if (s.heal) heal += part
    else if (s.cd) dmg += part / (1 - r.cdr)
    else filler += part
    wsum += s.w
  })
  if (!wsum) dmg = A * critOf({ w: 0 }, 0) // no rotation known: damage follows Attack
  const bucket = (a.bucket + v(t, 'dmg') + (pvp ? v(t, 'pvp') : v(t, 'pve') + v(t, 'boss'))) / 100
  const mult = (1 - r.miss) * (1 + r.double * (a.doubleMult - 1)) *
    (1 + r.perfect * (a.perfectMult - 1)) * (1 + r.multi * (a.multiMult - 1)) * (1 + v(t, 'posDmg') / 100 * a.posShare)
  // own control hits: the share that lands (chance against the target's resist) is worth ccDmg more damage
  const cc = clamp(a.ownStatus + v(t, 'statusChance') - a.tgtStatusRes, 0, 100) / 100
  const speed = 1 + v(t, 'speed') / 100
  return { dmg: (dmg + filler) * bucket * mult * speed * (1 + cc * a.ccDmg), heal: heal * (1 + v(t, 'heal') / 100) * speed / (1 - r.cdr) }
}

/** Effective HP against the reference hit. */
export function ehp(t: Totals, ctx: Ctx) {
  const a = ctx.a, pvp = ctx.mode === 'pvp'
  const hp = (a.hpBase + v(t, 'hp')) * (1 + v(t, 'hpPct') / 100)
  const def = (a.defBase + v(t, 'def')) * (1 + v(t, 'defPct') / 100) + (pvp ? v(t, 'pvpDef') : v(t, 'pveDef') + v(t, 'bossDef'))
  const hit = Math.max(a.hitRaw * 0.05, a.hitRaw - Math.max(0, def - a.attPen) * (pvp ? 0.01 : 0.1))
  // tolerance works against the attacker's matching boost (general against general, PvE / PvP against its mode) and on
  // below it, without a cliff: the damage bucket shrinks by every point, floored at 20 %
  const modeTol = pvp ? v(t, 'pvpTol') : v(t, 'pveTol') + v(t, 'bossTol')
  const bucket = Math.max(0.2, (100 + a.attDmg - v(t, 'tol') + a.attBoost - modeTol) / 100)
  const critRes = (v(t, 'critRes') + (pvp ? v(t, 'pvpCritRes') : 0)) * (1 + v(t, 'critResPct') / 100)
  const cr = clamp(a.attCrit - critRes * a.critPer100 / 100, 0, a.critCap) / 100
  const cm = Math.max(1, a.attCritMult - v(t, 'critTol') / 100)
  const eva = (v(t, 'eva') + (pvp ? v(t, 'pvpEva') : v(t, 'pveEva'))) * (1 + v(t, 'evaPct') / 100) + v(t, 'block') * (1 + v(t, 'blockPct') / 100)
  const avoid = clamp(soft(eva - a.attAcc, a.missPer100), 0, 30) / 100
  const end = clamp(v(t, 'endurance'), 0, 100) / 100
  const multi = Math.max(0, a.attMulti - v(t, 'multiRes')) / 100
  // being controlled (stun, knockdown …) costs extra damage: the attacker's chance minus the own resist
  const ccIn = clamp(a.attStatus - v(t, 'statusRes'), 0, 100) / 100
  const taken = (1 - avoid) * hit * bucket * (1 + cr * (cm - 1)) * (1 - end / 2) * (1 + multi * (a.multiMult - 1)) * (1 + ccIn * a.ccTaken)
  return hp / taken
}

export type Eval = { dmg: number; heal: number; ehp: number }
export function evaluate(t: Totals, lv: number[], ctx: Ctx): Eval {
  const all = withSkillFx(t, lv, ctx)
  return { ...output(all, lv, ctx), ehp: ehp(all, ctx) }
}

/** Output term: log change of damage, for healers mixed with healing (healShare). */
export function outLog(e: Eval, e0: Eval, h: number) {
  const d = Math.log(e.dmg / e0.dmg)
  return h > 0 && e0.heal > 0 ? (1 - h) * d + h * Math.log(e.heal / e0.heal) : d
}
/** Score of `e` against the reference `e0`: w = share of output (1 = damage only, 0 = defense only). */
export const score = (e: Eval, e0: Eval, w: number, h = 0) => w * outLog(e, e0, h) + (1 - w) * Math.log(e.ehp / e0.ehp)
/** Percent change. */
export const pct = (x: number, x0: number) => (x / x0 - 1) * 100

/** Rotation weights from the data. Damage skills: share of the damage (sum 1) = their Attack share per second in the
 *  computed build (aion2data builds.json), else their hit per cooldown at level 10; skills without a cooldown share
 *  `filler`. Healing skills: share of the healing (sum 1) by heal per cooldown. `use[i]` false takes a skill out. */
export function rotation(skills: { share?: Record<string, number>; flat?: number[]; pct?: number; cd?: number; heal?: boolean }[], mode: Mode, use: boolean[], a: Assume): number[] {
  const per = (s: typeof skills[number]) => ((s.flat?.[9] ?? 0) + (s.pct || 0) / 100 * a.atkBase) / a.atkBase / (s.cd || 1)
  const cdW = skills.map((s, i) => (use[i] && s.cd && s.flat && !s.heal ? (s.share?.[mode] ?? s.share?.pve ?? per(s)) : 0))
  const fill = skills.map((s, i) => (use[i] && !s.cd && s.flat && !s.heal ? 1 : 0))
  const heal = skills.map((s, i) => (use[i] && s.flat && s.heal ? per(s) : 0))
  const sum = (x: number[]) => x.reduce((p, q) => p + q, 0), sc = sum(cdW), sf = sum(fill), sh = sum(heal)
  const fShare = sf ? (sc ? a.filler : 1) : 0
  return skills.map((_, i) => (cdW[i] ? cdW[i] / sc * (1 - fShare) : fill[i] ? fill[i] / sf * fShare : heal[i] ? heal[i] / sh : 0))
}
