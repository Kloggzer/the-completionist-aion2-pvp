// Boss mod logic (like WoW's WeakAuras / DBM): what a boss is casting right now and what comes next.
// Timelines per boss npc from captures (web/public/bossmods.json, tools/boss_timeline.py): per skill the casts per fight,
// the first use after the pull, the gap between two uses [min, median, max], the cast time and the boss HP % range.
// Live casts come from the host (Capture.cs NpcFrame: 0x0238 cast start / 0x0638 cast end, entity -> npc via 0x4136).
// Skill names are not in any public data set: skills are "Skill <id>" until the player names them (U.bossSkills).

export type SkillStat = { fights: number; n: number; first: number; gap?: [number, number, number]; cast?: number; hp?: [number, number] }
export type BossStat = { name: string; fights: number; dur: number[]; skills: Record<string, SkillStat> }
export type BossMods = { bosses: Record<string, BossStat> }
/** Player settings for one skill: own name, alert on cast start (default: big casts), warning seconds before the
 *  predicted next use (0 = none, default: WARN for predictable big casts). */
export type SkillCfg = { name?: string; alert?: boolean; warn?: number }

/** Casts at least this long, used at most this often per fight, are "big" (alert by default). */
export const BIG_CAST = 3, BIG_MAX = 3
/** Default warning lead (s) before a predictable big cast. */
export const WARN = 5

export type Cast = { skill: number; at: number; end?: number }
export type Fight = { npc: number; ent: number; pull: number; casts: Cast[]; warned: Set<string> }

export const isBig = (s?: SkillStat) => !!s && (s.cast ?? 0) >= BIG_CAST && s.n <= BIG_MAX

/** Next use is predictable: seen at least twice per fight and the gap varies little (≤ 25 %, at least 3 s). */
export function predictable(s?: SkillStat): boolean {
  if (!s?.gap || s.n < 2) return false
  const [min, med, max] = s.gap
  return max - min <= Math.max(3, 0.25 * med)
}

export const skillName = (id: number, cfg?: SkillCfg) => cfg?.name || `Skill ${id}`
export const alertOn = (s: SkillStat | undefined, cfg?: SkillCfg) => cfg?.alert ?? isBig(s)
export const warnLead = (s: SkillStat | undefined, cfg?: SkillCfg) => cfg?.warn ?? (isBig(s) && predictable(s) ? WARN : 0)

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

export type Next = { skill: number; name: string; at: number; lead: number }

/** The predictable skills' next uses (earliest gap after the last use), soonest first. */
export function upcoming(f: Fight, boss: BossStat | undefined, cfgs: Record<string, SkillCfg> = {}): Next[] {
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
export function dueWarnings(f: Fight, boss: BossStat | undefined, cfgs: Record<string, SkillCfg>, now: number): Next[] {
  const due: Next[] = []
  for (const n of upcoming(f, boss, cfgs)) {
    const key = `${n.skill}@${n.at}`
    if (n.lead <= 0 || f.warned.has(key) || now < n.at - n.lead * 1000 || now > n.at) continue
    f.warned.add(key)
    due.push(n)
  }
  return due
}

/** Npc ids the host should watch. */
export const npcIds = (d?: BossMods) => Object.keys(d?.bosses || {}).map(Number)
