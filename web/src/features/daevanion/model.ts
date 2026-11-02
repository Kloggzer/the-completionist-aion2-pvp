// Value model of the Daevanion tab (pure): what a stat or a skill level is worth for one character, in real units.
//
//   output  = relative damage per second (and healing for healers) from the community damage formula
//             (mmoherald.com, kanonxo / Aion Research Lab; same formula on gameplay.tips, aion2maps, akunito):
//               attack = ((pure attack × weapon damage boost) + attack bonus) × attack increase + PvE / boss / PvP attack
//               hit    = flat of the skill level + % of Attack (aion2data skills.json, per level)
//               damage = hit × (damage boost + PvE + boss | PvP) × crit × Double × Perfect × multi-hit × positional
//               DPS    = Σ skills in the rotation (hit / cooldown, cooldowns shortened by CDR, cap 60 %) × combat speed
//             Caps from the game texts (aion2data stats.json): crit rate 50 %, evasion 30 %, cooldown 60 %.
//   ehp     = effective HP against one reference hit: HP / expected damage taken (defense takes off 10 % of its value
//             per hit in PvE, 1 % in PvP; damage tolerance cancels the attacker's damage boost; crit resist, endurance,
//             evasion / block).
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
] as const
export type Key = typeof K[number]
export type Totals = Partial<Record<Key, number>>
export const OFF_KEYS = new Set<Key>(K.slice(0, K.indexOf('heal') + 1))

/** Daevanion board stat (plaync effect name) -> model key; missing = not in the model (MP, status effects). */
export const DAE_KEY: Record<string, Key> = {
  'Combat Speed': 'speed', 'Attack Bonus': 'atkBonus', 'Critical Hit Resist': 'critRes', 'Critical Hit': 'crit',
  'Cooldown Reduction': 'cdr', 'Defense Bonus': 'def', 'HP': 'hp', 'Damage Tolerance': 'tol', 'Damage Boost': 'dmg',
  'Critical Damage Boost': 'critDmg', 'Critical Damage Tolerance': 'critTol', 'Multi-hit Resist': 'multiRes',
  'Multi-hit Chance': 'multi', 'PvP Damage Tolerance': 'pvpTol', 'PvP Attack': 'pvpAtk', 'PvP Defense': 'pvpDef',
  'PvP Critical Hit': 'pvpCrit', 'PvP Critical Hit Resist': 'pvpCritRes', 'PvP Accuracy': 'pvpAcc', 'PvP Evasion': 'pvpEva',
  'PvP Damage Boost': 'pvp', 'Evasion Bonus': 'eva', 'Accuracy Bonus': 'acc', 'PvE Damage Boost': 'pve', 'Boss Attack': 'bossAtk',
  'PvE Attack': 'pveAtk', 'PvE Defense': 'pveDef', 'PvE Accuracy': 'pveAcc', 'PvE Evasion': 'pveEva', 'Boss Defense': 'bossDef',
  'PvE Damage Tolerance': 'pveTol', 'Boss Damage Boost': 'boss', 'Boss Damage Tolerance': 'bossTol',
}
/** Column of a skill's level table (aion2data skill page) -> model key; others are not in the model. */
export const FX_KEY: Record<string, Key> = {
  'PvE Damage Boost %': 'pve', 'PvP Damage Boost %': 'pvp', 'Max HP %': 'hpPct', 'HP': 'hp', 'PvE Damage Tolerance %': 'pveTol',
  'PvP Damage Tolerance %': 'pvpTol', 'Double Chance %': 'double', 'Defense %': 'defPct', 'Perfect Chance %': 'perfect',
  'Critical Damage Boost %': 'critDmg', 'Critical Hit': 'crit', 'Front Attack Damage Boost %': 'posDmg',
  'Back Attack Damage Boost %': 'posDmg', 'Endurance %': 'endurance', 'Attack %': 'atkPct', 'Critical Hit Resist': 'critRes',
  'Heal Boost %': 'heal',
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
  /** Incoming reference hit: raw damage, the attacker's damage boost, crit chance and factor, accuracy, multi-hit. */
  hitRaw: number; attBoost: number; attCrit: number; attCritMult: number; attAcc: number; attMulti: number
}
const COMMON = { atkBase: 3000, hpBase: 12000, defBase: 1500, bucket: 100, critPer100: 6.5, critCap: 50, critMult: 1.5, missPer100: 6.5,
  missCap: 80, doubleMult: 2, perfectMult: 1.1, multiMult: 1.15, posShare: 0.7, filler: 0.25, uptime: 0.5, attCritMult: 1.5, attMulti: 10 }
export const ASSUME: Record<Mode, Assume> = {
  pve: { ...COMMON, tgtCritRes: 530, tgtDoubleRes: 30, tgtEva: 1200, healShare: 0, hitRaw: 10000, attBoost: 30, attCrit: 20, attAcc: 1500 },
  pvp: { ...COMMON, tgtCritRes: 600, tgtDoubleRes: 20, tgtEva: 1000, healShare: 0, hitRaw: 6000, attBoost: 30, attCrit: 30, attAcc: 1200 },
}
/** Where each assumption comes from (i18n key suffix: dae.src.<value>). */
export const ASSUME_SRC: Record<keyof Assume, string> = {
  atkBase: 'est', hpBase: 'est', defBase: 'est', bucket: 'mmo', critPer100: 'mmo', critCap: 'game', critMult: 'mmo',
  tgtCritRes: 'mmo', tgtDoubleRes: 'mmo', tgtEva: 'mmo', missPer100: 'mmo', missCap: 'mmo', doubleMult: 'est',
  perfectMult: 'mmo', multiMult: 'est', posShare: 'mmo', filler: 'est', uptime: 'est', healShare: 'est',
  hitRaw: 'est', attBoost: 'est', attCrit: 'est', attCritMult: 'mmo', attAcc: 'est', attMulti: 'est',
}

/** Character sheet used while the page gives no gear: a typical level-45 character in the ranges of the mmoherald
 *  guide (shown as an estimate in the tab, every number replaceable). Without it crit, Double etc. would sit at 0 and
 *  their Daevanion nodes look worthless. */
export const TYPICAL: Totals = { atk: 3500, wpn: 20, atkBonus: 400, atkPct: 15, crit: 1000, critPct: 5, critDmg: 30, dmg: 30, pve: 30,
  boss: 10, pvp: 20, double: 50, perfect: 20, multi: 15, speed: 25, cdr: 10, acc: 1300, hp: 8000, def: 1500, critRes: 300, eva: 900, block: 300 }

/** A skill as the model sees it. `flat` per level (index 0 = level 1); `fx` its stat table per level (passives). */
export type ModelSkill = {
  flat?: number[]; pct?: number; pvp?: [number, number]; cd?: number; heal?: boolean
  fx?: { keys: (Key | null)[]; lv: number[][]; cond?: boolean }
  /** Rotation weight (0 = not used): share of the base damage; set by `rotation`. */
  w: number
}
export type Ctx = { mode: Mode; a: Assume; skills: ModelSkill[] }

const v = (t: Totals, k: Key) => t[k] || 0
const at = <T>(arr: T[], lv: number) => arr[Math.max(0, Math.min(arr.length - 1, Math.round(lv) - 1))]
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

/** Totals plus what the skills' effect tables give at their levels. */
export function withSkillFx(t: Totals, lv: number[], ctx: Ctx): Totals {
  const out: Totals = { ...t }
  ctx.skills.forEach((s, i) => {
    if (!s.fx || lv[i] < 1) return
    const row = at(s.fx.lv, lv[i]), up = s.fx.cond ? ctx.a.uptime : 1
    s.fx.keys.forEach((k, c) => { if (k) out[k] = v(out, k) + row[c] * up })
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
    miss: clamp((a.tgtEva - acc) * a.missPer100 / 100, 0, a.missCap) / 100,
    cdr: Math.min(0.6, v(t, 'cdr') / 100),
  }
}

/** Relative damage (and healing) per second at totals `t` (skill effects already in) and skill levels `lv`. */
export function output(t: Totals, lv: number[], ctx: Ctx) {
  const a = ctx.a, pvp = ctx.mode === 'pvp', A = attackOf(t, ctx), r = rates(t, ctx)
  let dmg = 0, heal = 0, filler = 0, wsum = 0
  ctx.skills.forEach((s, i) => {
    if (!s.w || !s.flat || lv[i] < 1) return
    let flat = at(s.flat, lv[i]), pct = s.pct || 0
    // PvP: the second value set (known at the points cap, level 10), the flat part scaled by level
    const ref = s.flat[9] ?? s.flat[s.flat.length - 1]
    if (pvp && s.pvp) { flat *= ref ? s.pvp[0] / ref : 1; pct = s.pvp[1] }
    // w is the skill's share at level 10 and base Attack; the hit at its level and Attack scales it
    const part = s.w * (flat + pct / 100 * A) / ((pvp && s.pvp ? s.pvp[0] : ref) + pct / 100 * a.atkBase || 1)
    if (s.heal) heal += part
    else if (s.cd) dmg += part / (1 - r.cdr)
    else filler += part
    wsum += s.w
  })
  if (!wsum) dmg = A // no rotation known: damage follows Attack
  const bucket = (a.bucket + v(t, 'dmg') + (pvp ? v(t, 'pvp') : v(t, 'pve') + v(t, 'boss'))) / 100
  const mult = (1 - r.miss) * (1 + r.crit * (r.critMult - 1)) * (1 + r.double * (a.doubleMult - 1)) *
    (1 + r.perfect * (a.perfectMult - 1)) * (1 + r.multi * (a.multiMult - 1)) * (1 + v(t, 'posDmg') / 100 * a.posShare)
  const speed = 1 + v(t, 'speed') / 100
  return { dmg: (dmg + filler) * bucket * mult * speed, heal: heal * (1 + v(t, 'heal') / 100) * speed / (1 - r.cdr) }
}

/** Effective HP against the reference hit. */
export function ehp(t: Totals, ctx: Ctx) {
  const a = ctx.a, pvp = ctx.mode === 'pvp'
  const hp = (a.hpBase + v(t, 'hp')) * (1 + v(t, 'hpPct') / 100)
  const def = (a.defBase + v(t, 'def')) * (1 + v(t, 'defPct') / 100) + (pvp ? v(t, 'pvpDef') : v(t, 'pveDef') + v(t, 'bossDef'))
  const hit = Math.max(a.hitRaw * 0.05, a.hitRaw - def * (pvp ? 0.01 : 0.1))
  const tol = v(t, 'tol') + (pvp ? v(t, 'pvpTol') : v(t, 'pveTol') + v(t, 'bossTol'))
  const bucket = (100 + Math.max(0, a.attBoost - tol)) / 100
  const critRes = (v(t, 'critRes') + (pvp ? v(t, 'pvpCritRes') : 0)) * (1 + v(t, 'critResPct') / 100)
  const cr = clamp(a.attCrit - critRes * a.critPer100 / 100, 0, a.critCap) / 100
  const cm = Math.max(1, a.attCritMult - v(t, 'critTol') / 100)
  const eva = (v(t, 'eva') + (pvp ? v(t, 'pvpEva') : v(t, 'pveEva'))) * (1 + v(t, 'evaPct') / 100) + v(t, 'block') * (1 + v(t, 'blockPct') / 100)
  const avoid = clamp((eva - a.attAcc) * a.missPer100 / 100, 0, 30) / 100
  const end = clamp(v(t, 'endurance'), 0, 100) / 100
  const multi = Math.max(0, a.attMulti - v(t, 'multiRes')) / 100
  const taken = (1 - avoid) * hit * bucket * (1 + cr * (cm - 1)) * (1 - end / 2) * (1 + multi * (a.multiMult - 1))
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
