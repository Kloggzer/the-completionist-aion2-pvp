// Boss mod logic (like WoW's WeakAuras / DBM): what a boss is casting right now, what comes next, and who did not play
// the mechanic (the "Petze": hits of avoidable skills per player).
// Timelines per boss npc from captures (web/public/bossmods.json, tools/boss_timeline.py): per skill the casts per fight,
// the first use after the pull, the gap between two uses [min, median, max], the cast time and the boss HP % range.
// Live data from the host (Capture.cs NpcFrame): 0x0238 cast start / 0x0638 cast end, 0x008d HP, 0x3538 aggro target,
// 0x0438 hits of the boss's skills on players (entity -> name by the host), entity -> npc via 0x4136.
// Skill names are not in any public data set: skills are "Skill <id>" until the player names them (U.bossSkills).

/** `common`: the same skill id on several bosses (generic, e.g. the low-HP animation every boss has): never a mechanic. */
export type SkillStat = { fights: number; n: number; first: number; gap?: [number, number, number]; cast?: number; hp?: [number, number]; common?: boolean }
export type BossStat = { name: string; zone?: number; fights: number; dur: number[]; skills: Record<string, SkillStat> }
/** `aliases`: other modes' npc ids of a boss -> the id with the timeline (same name in Abyss Logs, tools/boss_timeline.py). */
export type BossMods = { bosses: Record<string, BossStat>; aliases?: Record<string, string> }

/** What to do against a skill (DBM's warning types). dodge / out / in / spread are avoidable: being hit = a mistake. */
export const KINDS = ['dodge', 'out', 'in', 'stack', 'spread', 'interrupt', 'tank', 'info'] as const
export type Kind = typeof KINDS[number]
const AVOIDABLE: Kind[] = ['dodge', 'out', 'in', 'spread']
/** Bar / banner colour per kind (hex, the native windows draw them). */
export const KIND_COL: Record<Kind, string> = {
  dodge: '#ff6a5c', out: '#ff9f43', in: '#4cc3ff', stack: '#5ce08a', spread: '#c58bff', interrupt: '#ffd25e', tank: '#9aa6bd', info: '#9aa6bd',
}

/** Player settings for one skill (all optional, defaults from the timeline):
 *  name, kind, own callout text, banner on cast start (default: big casts), warning seconds before the predicted next
 *  use (0 = none, default WARN for predictable big casts), bar (default: predictable), voice (default on), avoidable
 *  for the Petze (default: by kind; unmarked skills do not count). */
export type SkillCfg = { name?: string; kind?: Kind; text?: string; alert?: boolean; warn?: number; bar?: boolean; voice?: boolean; avoid?: boolean }
export type Cfgs = Record<string, SkillCfg>

/** Casts at least this long, used at most this often per fight, are "big" (alert by default). */
export const BIG_CAST = 3, BIG_MAX = 3
/** Default warning lead (s) before a predictable big cast; HP lead (%) before a phase skill. */
export const WARN = 5, HP_LEAD = 5

export type Cast = { skill: number; at: number; end?: number }
/** seq: the boss's cast counter (0x0438): all hits of one cast share it. */
export type Hit = { skill: number; tgt: number; name: string; me: boolean; at: number; seq?: number }
export type Fight = {
  npc: number; ent: number; pull: number; casts: Cast[]; warned: Set<string>
  hp?: number; maxHp?: number; target?: { ent: number; name: string; me: boolean }; hits: Hit[]; end?: number; died?: boolean; marks?: number[]; minHp?: number
  /** ms the boss held each target (aggro), and since when the current one: who tanks (mainTarget). */
  held?: Record<number, number>; heldAt?: number
}

export const newFight = (npc: number, ent: number, at: number): Fight => ({ npc, ent, pull: at, casts: [], warned: new Set(), hits: [] })

export const isBig = (s?: SkillStat) => !!s && !s.common && (s.cast ?? 0) >= BIG_CAST && s.n <= BIG_MAX

/** Next use is predictable: seen at least twice per fight and the gap varies little (≤ 25 %, at least 3 s). */
export function predictable(s?: SkillStat): boolean {
  if (!s?.gap || s.n < 2) return false
  const [min, med, max] = s.gap
  return max - min <= Math.max(3, 0.25 * med)
}

/** Phase skill: once per fight, always in a narrow HP band (≤ 8 %): returns the HP % it comes at (top of the band). */
export function phaseHp(s?: SkillStat): number | null {
  if (!s?.hp || s.common || s.n !== 1 || s.fights < 2) return null
  return s.hp[1] - s.hp[0] <= 8 && s.hp[1] < 100 ? s.hp[1] : null
}

export const skillName = (id: number, cfg?: SkillCfg) => cfg?.name || `Skill ${id}`
export const alertOn = (s: SkillStat | undefined, cfg?: SkillCfg) => cfg?.alert ?? isBig(s)
export const warnLead = (s: SkillStat | undefined, cfg?: SkillCfg) => cfg?.warn ?? (isBig(s) && predictable(s) ? WARN : 0)
export const barOn = (s: SkillStat | undefined, cfg?: SkillCfg) => cfg?.bar ?? predictable(s)
export const voiceOn = (cfg?: SkillCfg) => cfg?.voice ?? true
/** Counts for the Petze: set by hand, else by kind (guide / own setting). Unmarked skills never count: hits of 3 of 5
 *  players can be a missed mechanic or plain raid damage – blaming the wrong people is worse than saying nothing. */
export const avoidable = (_s: SkillStat | undefined, cfg?: SkillCfg) => cfg?.avoid ?? (cfg?.kind ? AVOIDABLE.includes(cfg.kind) : false)
export const kindCol = (cfg?: SkillCfg) => KIND_COL[cfg?.kind || 'info']

/** Record a cast start; a cast of the same skill within 0.4 s is the same cast on another target. */
export function addCast(f: Fight, skill: number, at: number): Cast | null {
  const last = f.casts.findLast(c => c.skill === skill)
  if (last && at - last.at < 400) return null
  const c = { skill, at }
  f.casts.push(c)
  return c
}

export function endCast(f: Fight, skill: number, at: number) {
  const c = f.casts.findLast(c => c.skill === skill && c.end === undefined)
  if (c) c.end = at
}

export function setHp(f: Fight, hp: number) {
  f.hp = hp
  f.maxHp = Math.max(f.maxHp ?? 0, hp)
  f.minHp = Math.min(f.minHp ?? hp, hp)
}
/** A new aggro target: the time the previous one was held is added up. */
export function trackTarget(f: Fight, at: number) {
  const prev = f.target?.ent
  if (prev !== undefined && f.heldAt !== undefined) (f.held ||= {})[prev] = (f.held[prev] || 0) + Math.max(0, at - f.heldAt)
  f.heldAt = at
}
/** The entity that held the boss most of the time (≥ 50 % of at least 10 s): the tank; targets on it are no news. */
export function mainTarget(f: Fight, now: number): number | undefined {
  const held = { ...f.held }
  if (f.target && f.heldAt !== undefined) held[f.target.ent] = (held[f.target.ent] || 0) + Math.max(0, now - f.heldAt)
  const total = Object.values(held).reduce((s, x) => s + x, 0)
  const [ent, ms] = Object.entries(held).sort((a, b) => b[1] - a[1])[0] || []
  return ent !== undefined && total >= 10_000 && ms >= total / 2 ? +ent : undefined
}

/** The boss is back at full HP after having lost some: a wipe / reset (the next pull is a new fight). */
export const wasReset = (f: Fight) => !!f.maxHp && f.minHp !== undefined && f.minHp < 0.95 * f.maxHp && (f.hp ?? 0) >= 0.99 * f.maxHp
export const hpPct = (f: Fight) => (f.maxHp ? Math.round((100 * (f.hp ?? f.maxHp)) / f.maxHp) : 100)

/** Record a hit of the boss's skill on a player; several frames of the same skill on the same player within 1 s are one
 *  hit (multi-hit skills, damage over time). Returns the hit if it is new. */
export function addHit(f: Fight, h: Hit): Hit | null {
  if (f.hits.some(x => x.skill === h.skill && x.tgt === h.tgt && (h.seq !== undefined && x.seq === h.seq || h.at - x.at < 1000))) return null
  f.hits.push(h)
  return h
}

export type Next = { skill: number; name: string; at: number; lead: number }

/** The predictable skills' next uses (earliest gap after the last use), soonest first. */
export function upcoming(f: Fight, boss: BossStat | undefined, cfgs: Cfgs = {}): Next[] {
  if (!boss) return []
  const out: Next[] = []
  for (const [id, s] of Object.entries(boss.skills)) {
    if (!predictable(s)) continue
    const last = f.casts.findLast(c => c.skill === +id)
    if (!last) continue
    out.push({ skill: +id, name: skillName(+id, cfgs[id]), at: last.at + s.gap![0] * 1000, lead: warnLead(s, cfgs[id]) })
  }
  return out.sort((a, b) => a.at - b.at)
}

/** Warnings due at `now`: predicted uses within their lead, each once per predicted time. */
export function dueWarnings(f: Fight, boss: BossStat | undefined, cfgs: Cfgs, now: number): Next[] {
  const due: Next[] = []
  for (const n of upcoming(f, boss, cfgs)) {
    const key = `${n.skill}@${n.at}`
    if (n.lead <= 0 || f.warned.has(key) || now < n.at - n.lead * 1000 || now > n.at) continue
    f.warned.add(key)
    due.push(n)
  }
  return due
}

export type Phase = { skill: number; name: string; hp: number }

/** Phase skills about to come: the boss's HP within HP_LEAD % above the phase, not yet cast; each once. */
export function duePhases(f: Fight, boss: BossStat | undefined, cfgs: Cfgs): Phase[] {
  if (!boss || f.maxHp === undefined) return []
  const now = hpPct(f), due: Phase[] = []
  for (const [id, s] of Object.entries(boss.skills)) {
    const at = phaseHp(s), key = `phase ${id}`
    if (at === null || f.warned.has(key) || f.casts.some(c => c.skill === +id) || now > at + HP_LEAD) continue
    f.warned.add(key)
    due.push({ skill: +id, name: skillName(+id, cfgs[id]), hp: at })
  }
  return due
}

export type Bar = { skill: number; name: string; left: number; total: number; col: string }

/** Timer bars at `now`: the next predicted uses with a bar, soonest first (at most `max`); overdue ones stay a few
 *  seconds at 0 (the gap's spread), then drop. */
export function bars(f: Fight, boss: BossStat | undefined, cfgs: Cfgs, now: number, max = 5): Bar[] {
  const out: Bar[] = []
  for (const n of upcoming(f, boss, cfgs)) {
    const s = boss!.skills[n.skill], cfg = cfgs[n.skill]
    if (!barOn(s, cfg)) continue
    const left = (n.at - now) / 1000, spread = s.gap![2] - s.gap![0]
    if (left < -spread - 2) continue
    out.push({ skill: n.skill, name: n.name, left: Math.max(0, left), total: s.gap![0], col: kindCol(cfg) })
  }
  return out.slice(0, max)
}

export type Blame = { name: string; me: boolean; hits: number; skills: { skill: number; name: string; n: number }[] }

/** The hits of a fight per cast: same skill and cast counter (0x0438), else within 3 s of the cast's first hit. */
function perCast(hits: Hit[]): Hit[][] {
  const bySkill = new Map<number, Hit[]>(), out: Hit[][] = []
  for (const h of hits) bySkill.set(h.skill, [...(bySkill.get(h.skill) || []), h])
  for (const hs of bySkill.values()) {
    const open = new Map<string, Hit[]>()
    for (const h of hs) {
      const key = h.seq !== undefined ? `s${h.seq}` : ''
      let cast = open.get(key)
      if (!cast || h.at - cast[0].at > (key ? 30_000 : 3000)) {
        cast = []
        open.set(key, cast)
        out.push(cast)
      }
      cast.push(h)
    }
  }
  return out
}

/** Hits of one cast that struck most of the group (≥ 75 % of the most players any cast hit, at least 3) were not
 *  avoidable: raid damage. Only for skills without an own setting (a skill set to a kind / Petze by hand counts). */
function raidWide(f: Fight, cfgs: Cfgs): Set<Hit> {
  const casts = perCast(f.hits), size = (c: Hit[]) => new Set(c.map(h => h.tgt)).size
  const group = Math.max(0, ...casts.map(size)), out = new Set<Hit>()
  if (group < 3) return out
  for (const c of casts)
    if (cfgs[c[0].skill]?.kind === undefined && cfgs[c[0].skill]?.avoid === undefined && size(c) >= 0.75 * group) c.forEach(h => out.add(h))
  return out
}

/** The Petze: per player the hits of avoidable skills, most first (unknown players by entity: "#<ent>"); hits that
 *  struck most of the group at once are left out unless the skill was set by hand (raidWide). */
export function blame(f: Fight, boss: BossStat | undefined, cfgs: Cfgs): Blame[] {
  const by = new Map<string, Blame>(), wide = raidWide(f, cfgs)
  for (const h of f.hits) {
    if (wide.has(h) || !avoidable(boss?.skills[h.skill], cfgs[h.skill])) continue
    const who = h.name || `#${h.tgt}`
    let b = by.get(who)
    if (!b) by.set(who, b = { name: who, me: h.me, hits: 0, skills: [] })
    b.hits++
    const s = b.skills.find(x => x.skill === h.skill)
    if (s) s.n++
    else b.skills.push({ skill: h.skill, name: skillName(h.skill, cfgs[h.skill]), n: 1 })
  }
  const out = [...by.values()].sort((a, b) => b.hits - a.hits || a.name.localeCompare(b.name))
  for (const b of out) b.skills.sort((x, y) => y.n - x.n)
  return out
}

/** Boss for an npc id: the exact id, else another mode of it (aliases). */
export const findBoss = (d: BossMods | undefined, npc: number): BossStat | undefined =>
  d ? d.bosses[npc] ?? (d.aliases?.[npc] ? d.bosses[d.aliases[npc]] : undefined) : undefined

/** Npc ids the host should watch: the known ones and their other modes. */
export const npcIds = (d?: BossMods): number[] => [...Object.keys(d?.bosses || {}), ...Object.keys(d?.aliases || {})].map(Number)

// ---------------------------------------------------------------- guide (web/public/bossguide.json, tools/boss_guide.py)

/** Hand-made boss guide: Frenzy time, phases (HP %, name, the skill that starts it) and mechanics (kind, callout,
 *  hint, the boss's skill ids). `todo`: placeholder, real values follow from recordings. */
export type GuidePhase = { hp: number; name: string; skill?: number; todo?: boolean }
export type GuideMech = { name: string; kind?: Kind; text?: string; hint?: string; cast?: number; skills: number[]; todo?: boolean }
export type GuideBoss = { name: string; dungeon?: string; frenzy?: number; phases: GuidePhase[]; mechanics: GuideMech[] }
export type Guide = { bosses: Record<string, GuideBoss> }

/** Guide entry of a boss (exact id, else the id its alias points to). */
export function findGuide(g: Guide | undefined, d: BossMods | undefined, npc: number): GuideBoss | undefined {
  if (!g) return undefined
  return g.bosses[npc] ?? (d?.aliases?.[npc] ? g.bosses[d.aliases[npc]] : undefined)
}

/** Skill settings the guide gives (name, kind, callout of the mechanic a skill belongs to); the player's own settings
 *  go on top (mergeCfgs). Placeholder mechanics (todo) without skills give nothing. */
export function guideCfgs(g: Guide | undefined): Cfgs {
  const out: Cfgs = {}
  for (const b of Object.values(g?.bosses || {}))
    for (const m of b.mechanics)
      for (const id of m.skills) out[id] = { name: m.name, ...(m.kind ? { kind: m.kind } : {}), ...(m.text ? { text: m.text } : {}) }
  return out
}

/** Effective settings per skill: the guide's, overridden field by field by the player's. */
export function mergeCfgs(base: Cfgs, own: Cfgs): Cfgs {
  const out: Cfgs = { ...base }
  for (const [id, c] of Object.entries(own)) out[id] = { ...base[id], ...c }
  return out
}

/** The phase the boss is in by its HP (the guide's phases, highest first; "" before the first one). */
export function phaseName(gb: GuideBoss | undefined, hp: number): string {
  let cur = ''
  for (const p of [...(gb?.phases || [])].sort((a, b) => b.hp - a.hp)) if (hp <= p.hp) cur = p.name
  return cur
}

/** Guide phases about to come: the boss's HP within HP_LEAD % above it; each once (also skipped when its skill came). */
export function dueGuidePhases(f: Fight, gb: GuideBoss | undefined): GuidePhase[] {
  if (!gb || f.maxHp === undefined) return []
  const now = hpPct(f), due: GuidePhase[] = []
  for (const p of gb.phases) {
    const key = p.skill ? `phase ${p.skill}` : `phase@${p.hp}`
    if (f.warned.has(key) || (p.skill && f.casts.some(c => c.skill === p.skill)) || now > p.hp + HP_LEAD) continue
    f.warned.add(key)
    due.push(p)
  }
  return due
}

/** Danger kinds: the centre callout pulses and a plain one cannot replace it. */
export const isDanger = (k?: Kind) => k === 'dodge' || k === 'out' || k === 'in'
