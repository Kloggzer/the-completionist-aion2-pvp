// Boss mod: timelines (bossmods.json), the hand-made guide (bossguide.json: phases, mechanics, Frenzy), the npcs the host
// watches (host 'bossMod'), live boss events from the host ('bossCast' / 'bossCastEnd' / 'bossHp' / 'bossTarget' /
// 'bossHit' / 'bossGone') -> the outputs like DBM / WeakAuras:
//   centre callout (host 'bossCall' -> BossCallForm.cs): ONE instruction with a running bar (no chimes: voice only),
//   timer panel (host 'bossBars' -> BossBarsForm.cs): phase, Frenzy, HP, the next attacks, aggro target, live Petze,
//   voice (kind 'bossmod'): what to do, "X in 5", countdown "3, 2, 1", phases, "on you"; never a skill id (speakable);
// and after the fight the Petze: who was hit by avoidable skills (banner + voice, the Boss-Helfer page, U.bossFights).
// Noise control: per boss on / bars only / off (U.bossBoss), "danger only" (U.bossDangerOnly), the role (U.bossRole).
// Times are the packets' (replay too): the clock offset to Date.now() comes with every event.
import { on } from '@/core/bus'
import { host, onHost } from '@/core/host'
import { addStrings, locale, t } from '@/core/i18n'
import { G, S, U, V, bump, saveUi } from '@/core/state'
import { TTS_KINDS, say } from '@/core/tts'
import { toast } from '@/core/toast'
import { inInstance } from '@/features/pvp'
import {
  addCast, addHit, alertOn, avoidable, bars, blame, dueGuidePhases, duePhases, dueWarnings, endCast, findBoss, findGuide, guideCfgs, hpPct,
  isDanger, kindCol, mainTarget, mergeCfgs, newFight, npcIds, phaseHp, phaseName, predictable, setHp, skillName, speakable, trackTarget,
  voiceOn, warnLead, wasReset, type Blame, type BossMods, type Cfgs, type Fight, type Guide, type GuideMech, type Hit, type Role, type SkillCfg,
} from './logic'
import strings from './strings'

addStrings(strings)
TTS_KINDS.push('bossmod')

/** A finished fight as kept for the Boss-Helfer page (last FIGHTS_KEPT, in settings.json): casts [skill, s], hits of
 *  the boss's own skills [skill, cast counter, name, me, s] (so the Petze can be counted again after naming skills),
 *  lowest HP %, the phase it ended in. */
export type FightLog = {
  npc: number; name: string; at: number; dur: number; died: boolean; casts: [number, number][]; marks: number[]; blame: Blame[]
  hits?: [number, number, string, boolean, number][]; low?: number; phase?: string
}
export type BossMode = 'on' | 'bars' | 'off'
const FIGHTS_KEPT = 8, HITS_KEPT = 800
const QUIET = 120_000 // no cast for this long: the fight is over (normally it ends with bossGone or a reset, wasReset)
const TARGET_GAP = 8_000 // "target on you" at most this often
const BLAME_LIVE_WAIT = 1_200 // ms: the hits of one cast are collected, then said once

const fights = new Map<number, Fight>() // entity -> fight
const topHp = new Map<number, number>() // entity -> highest HP before its fight (the full HP for the %)
let clock = 0 // Date.now() - packet time
let guideBase: Cfgs = {}
let cfgCache: { own: unknown; base: Cfgs; all: Cfgs } | null = null
/** Effective skill settings: the guide's, the player's own on top (U.bossSkills); cached until either changes. */
export function cfgs(): Cfgs {
  const own = U.bossSkills || {}
  if (!cfgCache || cfgCache.own !== own || cfgCache.base !== guideBase) cfgCache = { own, base: guideBase, all: mergeCfgs(guideBase, own) }
  return cfgCache.all
}
/** The player's own settings only (the editor shows the guide's as placeholders). */
export const ownCfgs = (): Cfgs => U.bossSkills || {}
const mods = () => G.bossMods as BossMods | undefined
export const boss = (npc: number) => findBoss(mods(), npc)
export const guide = (npc: number) => findGuide(G.bossGuide as Guide | undefined, mods(), npc)
/** The id a boss's settings are kept under: its timeline's (other modes map to it). */
export const canon = (npc: number) => +(mods()?.aliases?.[npc] ?? npc)
export const bossMode = (npc: number): BossMode => U.bossBoss?.[canon(npc)] ?? 'on'
export const role = (): Role => U.bossRole ?? 'auto'
const on_ = () => !!U.bossMod
const opt = (k: string) => U[k] !== false // boss options that default to on
const now_ = () => Date.now() - clock
const num = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: 1 })

/** Tell the host which npcs to watch, whether the helper is on (its windows in the edit mode) and whether to record:
 *  the whole visit of a dungeon (BossRecorder.cs; on unless switched off, U.bossRec), nothing outside. */
let synced = ''
/** Npc ids whose appearance is a mechanic (guide mechanics' `spawns`): npc id -> its boss and mechanic. */
function spawnMechs() {
  const out = new Map<number, { boss: number; m: GuideMech }>()
  for (const [id, b] of Object.entries((G.bossGuide as Guide | undefined)?.bosses || {}))
    for (const m of b.mechanics) for (const n of m.spawns || []) out.set(n, { boss: +id, m })
  return out
}
/** 600000–699999 are the group PvE instances (raids, conquest, transcendence): one the dungeon index does not know yet
 *  (a new mode after a rework, e.g. Ludra Hard) is recorded too, so its timeline can be built. */
const newGroupInstance = (zone: number) => zone >= 600000 && zone < 700000 && !!G.instances?.size && !G.instances.has(zone)
function sync(force = false) {
  const inst = inInstance() || newGroupInstance(S.zone || 0)
  // zone: the map the page means (the host only starts recording if it is still the current one)
  const m = { type: 'bossMod', ids: npcIds(mods()), spawns: [...spawnMechs().keys()], on: on_(), rec: inst && U.bossRec !== false, inst, zone: S.zone || 0 }
  const key = JSON.stringify(m)
  if (key === synced && !force) return // 'recompute' comes often; the host rescans the recordings on every message
  synced = key
  host(m)
}

fetch('bossmods.json').then(r => r.json()).then(d => { G.bossMods = d; sync(); bump() }).catch(() => { G.bossMods = { bosses: {} } })
fetch('bossguide.json').then(r => r.json()).then(d => { G.bossGuide = d; guideBase = guideCfgs(d); sync(); bump() }).catch(() => { G.bossGuide = { bosses: {} } })
onHost('init', () => sync(true))
// another map: the fights are over; the same map again (cutscene into a boss room, respawn) keeps them running
let lastZone = 0
onHost('zone', m => {
  if (m.id !== lastZone) { for (const f of [...fights.values()]) finish(f); topHp.clear() }
  lastZone = m.id
  sync(true)
})
on('recompute', () => sync()) // settings toggles

onHost('bossRecs', m => { V.bossRecs = m; bump() })
onHost('bossRec', m => { (V.bossRecList ||= []).unshift(m.rec); V.bossRecList.length = Math.min(V.bossRecList.length, 20); bump() })
onHost('bossMark', m => {
  if (!m.ok) { toast(t('boss.markNone'), ''); return }
  const f = V.bossFight as Fight | null
  if (f) (f.marks ||= []).push(m.at - clock)
  toast(t('boss.mark'), '')
})
onHost('bossExported', m => toast(m.path ? t('boss.exported') : t('boss.exportNone'), m.path || ''))

// ---------------------------------------------------------------- outputs

let ownEnt: number | undefined // own entity, learnt from the boss's targets (host: me)
/** Oneself tanks: set as the role, or (auto) holds the boss most of the fight. */
const iTank = (f: Fight, at: number) => role() === 'tank' || role() === 'auto' && ownEnt !== undefined && mainTarget(f, at) === ownEnt
/** Voice for this skill now: its own switch, "danger only", tank callouts only for the tank, the boss's mode. */
function voiceFor(f: Fight, cfg: SkillCfg | undefined, danger: boolean, at: number) {
  if (!voiceOn(cfg) || bossMode(f.npc) !== 'on') return false
  if (U.bossDangerOnly && !danger) return false
  return cfg?.kind !== 'tank' || iTank(f, at)
}
const speak = (text: string, urgent = false) => say('bossmod', text, { urgent })
/** Centre callout (BossCallForm) with the mechanic's colour; what to do is spoken separately (no chimes). */
function call(f: Fight, title: string, sub: string, cfg: SkillCfg | undefined, seconds: number, danger = isDanger(cfg?.kind)) {
  if (bossMode(f.npc) !== 'on') return
  host({ type: 'bossCall', title, sub, col: danger && !cfg?.kind ? '#ff6a5c' : kindCol(cfg), seconds, danger })
}
/** What the voice says for a skill: own text, else the kind ("Raus"), else its name (callers check speakable). */
const what = (cfg?: SkillCfg) => cfg?.text || (cfg?.kind ? t('boss.k.' + cfg.kind) : '') || cfg?.name || t('boss.big')

// ---------------------------------------------------------------- events

function fightOf(npc: number, ent: number, at: number): Fight {
  let f = fights.get(ent)
  if (!f) {
    fights.set(ent, f = newFight(npc, ent, at))
    if (topHp.has(ent)) setHp(f, topHp.get(ent)!)
  }
  return f
}

const lastAlert = new Map<string, number>()

export function onCast(npc: number, ent: number, skill: number, at: number, me = false) {
  if (!on_() || bossMode(npc) === 'off') return
  const f = fightOf(npc, ent, at)
  if (!addCast(f, skill, at)) return
  V.bossFight = f
  const b = boss(npc), s = b?.skills[skill], cfg = cfgs()[skill]
  // the same skill from clones (several entities with this npc id) within 1.5 s: one callout
  const k = `${npc}:${skill}`, last = lastAlert.get(k) ?? -Infinity
  const onMe = me && opt('bossTargetMe') && !iTank(f, at) && !s?.common
  if (b && (alertOn(s, cfg) || onMe) && at - last > 1500) {
    lastAlert.set(k, at)
    const sec = s?.cast ?? 0, kind = cfg?.kind ? t('boss.k.' + cfg.kind).toUpperCase() : ''
    const danger = onMe || isDanger(cfg?.kind)
    call(f, [onMe ? t('boss.onYou') : kind, skillName(skill, cfg)].filter(Boolean).join(' · '), b.name + (sec ? ' · ' + t('boss.castSub', { s: num(sec) }) : ''), cfg, sec, danger)
    // voice only with something worth saying (a name, a kind, an own text) – or when it goes on oneself
    if (voiceFor(f, cfg, danger, at) && (speakable(cfg) || onMe))
      speak(onMe ? (speakable(cfg) ? t('boss.sayOnYou', { skill: what(cfg) }) : t('boss.sayOnYouAny')) : what(cfg), danger)
  }
  bump()
}

/** The Petze (who was hit by avoidable skills) is left out for now: no banner, voice, panel line, page chips or
 *  settings. The code stays; true brings it back. */
export const BLAME = false

// live Petze: the hits of one cast collected, then one sentence (low priority: never over a callout)
const pendingBlame = new Map<string, { names: Set<string>; skill: number }>()
export function onHit(npc: number, ent: number, skill: number, tgt: number, name: string, me: boolean, at: number, seq?: number) {
  const f = fights.get(ent) || (on_() && bossMode(npc) !== 'off' ? fightOf(npc, ent, at) : null)
  if (!f || !addHit(f, { skill, tgt, name, me, at, ...(seq !== undefined ? { seq } : {}) })) return
  const cfg = cfgs()[skill]
  if (!BLAME || !U.bossBlameLive || !name || !avoidable(boss(npc)?.skills[skill], cfg) || bossMode(npc) !== 'on') return
  const key = `${ent}:${skill}:${seq ?? Math.floor(at / 3000)}`
  const p = pendingBlame.get(key)
  if (p) { p.names.add(name); return }
  pendingBlame.set(key, { names: new Set([name]), skill })
  setTimeout(() => {
    const q = pendingBlame.get(key)
    pendingBlame.delete(key)
    if (q) say('bossmod', t('boss.sayHit', { name: [...q.names].join(t('boss.and')), skill: skillName(q.skill, cfgs()[q.skill]) }), { idle: true })
  }, BLAME_LIVE_WAIT)
}

export function onHp(ent: number, hp: number) {
  const f = fights.get(ent)
  if (f) { setHp(f, hp); if (wasReset(f)) finish(f) }
  else topHp.set(ent, Math.max(topHp.get(ent) ?? 0, hp))
}

let targetAt = -Infinity
export function onTarget(ent: number, tgt: number, name: string, me: boolean, at: number) {
  const f = fights.get(ent)
  if (!f) return
  const was = f.target?.me
  if (me) ownEnt = tgt
  trackTarget(f, at)
  f.target = { ent: tgt, name, me }
  if (me && !was && on_() && opt('bossTargetMe') && !iTank(f, at) && at - targetAt > TARGET_GAP) {
    targetAt = at
    call(f, t('boss.targetYou'), boss(f.npc)?.name ?? '', undefined, 0, true)
    if (voiceFor(f, undefined, true, at)) speak(t('boss.sayTarget'), true)
  }
}

onHost('bossCast', m => { clock = Date.now() - m.at; if (m.me) ownEnt = m.tgt; onCast(m.npc, m.ent, m.skill, m.at, !!m.me) })
// a mechanic that is an npc appearing (Rahu's rings: one per player): one callout per wave, only in that boss's fight
onHost('bossSpawn', m => {
  clock = Date.now() - m.at
  const sm = spawnMechs().get(m.npc), f = V.bossFight as Fight | null
  if (!sm || !on_() || !f || f.end !== undefined || canon(f.npc) !== canon(sm.boss)) return
  const k = 'spawn:' + m.npc, last = lastAlert.get(k) ?? -Infinity
  if (m.at - last < 3000) return
  lastAlert.set(k, m.at)
  const cfg: SkillCfg = { name: sm.m.name, ...(sm.m.kind ? { kind: sm.m.kind } : {}), ...(sm.m.text ? { text: sm.m.text } : {}) }
  const danger = isDanger(cfg.kind)
  call(f, [cfg.kind ? t('boss.k.' + cfg.kind).toUpperCase() : '', cfg.name].filter(Boolean).join(' · '), boss(f.npc)?.name ?? '', cfg, 0, danger)
  if (voiceFor(f, cfg, danger, m.at)) speak(what(cfg), danger)
})
onHost('bossCastEnd', m => { const f = fights.get(m.ent); if (f) endCast(f, m.skill, m.at) })
onHost('bossHp', m => { clock = Date.now() - m.at; onHp(m.ent, m.hp) })
onHost('bossHit', m => onHit(m.npc, m.ent, m.skill, m.tgt, m.name, m.me, m.at, m.seq))
onHost('bossTarget', m => onTarget(m.ent, m.tgt, m.name, m.me, m.at))
onHost('bossGone', m => { const f = fights.get(m.ent); if (f) { f.died = m.died; f.end = m.at; finish(f) } })

/** The Petze of a kept fight with today's settings (skills named / marked after the fight count too). */
export function blameOf(log: FightLog): Blame[] {
  if (!log.hits) return log.blame
  // the entity is not kept: the name stands for the player
  const ids = new Map<string, number>()
  const f = newFight(log.npc, 0, 0)
  f.hits = log.hits.map(([skill, seq, name, me, s]): Hit => {
    if (!ids.has(name)) ids.set(name, ids.size + 1)
    return { skill, ...(seq >= 0 ? { seq } : {}), name, me, tgt: ids.get(name)!, at: s * 1000 }
  })
  return blame(f, boss(log.npc), cfgs())
}
/** At least one skill of this boss counts for the Petze (marked avoidable): else "nobody hit" means nothing. */
export const blameActive = (npc: number) => Object.entries(boss(npc)?.skills || {}).some(([id, s]) => avoidable(s, cfgs()[id]))

/** End of a fight: keep it for the page (not a test pull), Petze / wipe banner and voice. */
export function finish(f: Fight, test = false) {
  fights.delete(f.ent)
  topHp.delete(f.ent)
  if (V.bossFight?.ent === f.ent) // the panel follows the fight that cast last, if one is still running
    V.bossFight = [...fights.values()].sort((a, b) => (b.casts.at(-1)?.at ?? b.pull) - (a.casts.at(-1)?.at ?? a.pull))[0] ?? null
  if (!fights.size) host({ type: 'bossBars', rows: [] })
  if (!f.casts.length) return
  const b = boss(f.npc), end = f.end ?? f.casts.at(-1)!.at, bl = blame(f, b, cfgs())
  const low = f.maxHp ? Math.round((100 * (f.minHp ?? f.maxHp)) / f.maxHp) : undefined
  const phase = phaseName(guide(f.npc), low ?? 100) || undefined
  const skills = b?.skills || {}
  const log: FightLog = {
    npc: f.npc, name: b?.name || String(f.npc), at: f.pull + clock, dur: Math.round((end - f.pull) / 1000), died: !!f.died,
    casts: f.casts.map(c => [c.skill, Math.round((c.at - f.pull) / 100) / 10]),
    marks: (f.marks || []).map(m => Math.round((m - f.pull) / 100) / 10), blame: bl,
    // hits of the boss's own skills (not the generic ones), for counting the Petze again later
    hits: f.hits.filter(h => skills[h.skill] && !skills[h.skill].common).slice(-HITS_KEPT)
      .map(h => [h.skill, h.seq ?? -1, h.name || `#${h.tgt}`, h.me, Math.round((h.at - f.pull) / 100) / 10]),
    ...(low !== undefined ? { low } : {}), ...(phase ? { phase } : {}),
  }
  if (!test) {
    U.bossFights = [log, ...(U.bossFights || [])].slice(0, FIGHTS_KEPT)
    saveUi(['bossFights'])
  }
  if (bossMode(f.npc) === 'on') {
    const tell = BLAME && opt('bossBlame') && bl.length > 0
    const wipe = !f.died && low !== undefined && low > 0
    const top = bl.slice(0, 3).map(x => `${x.name} ${x.hits}×`).join(', ')
    if (wipe) {
      const where = t('boss.wipe', { hp: low, phase: phase ? ' · ' + phase : '' })
      host({ type: 'alert', title: `${log.name}: ${where}`, sub: tell ? top : '', seconds: 10, always: true })
    } else if (tell)
      host({ type: 'alert', title: t('boss.blame', { name: log.name }), sub: top + (bl.length > 3 ? ' …' : ''), seconds: 10, always: true })
    if (tell)
      say('bossmod', t('boss.sayBlame', { list: bl.slice(0, 3).map(x => t('boss.sayBlameOne', { name: x.name, n: x.hits })).join(', ') }))
  }
  bump()
}

// ---------------------------------------------------------------- tick: warnings, countdown, phases, bars

const COUNT = [3, 2, 1]
const spoken = new Set<string>() // warnings / countdown numbers already given, over all fights (clones of one npc)
let barsShown = false
const clearBars = () => { if (barsShown) { host({ type: 'bossBars', rows: [] }); barsShown = false } }
setInterval(() => {
  if (!fights.size) { clearBars(); return }
  const now = now_(), c = cfgs()
  if (spoken.size > 500) spoken.clear()
  for (const f of [...fights.values()]) {
    if (f.ent >= 0 && now - (f.casts.at(-1)?.at ?? f.pull) > QUIET) { finish(f); continue } // test pull: ent < 0
    if (!on_() || bossMode(f.npc) !== 'on') continue
    const b = boss(f.npc), gb = guide(f.npc)
    for (const n of dueWarnings(f, b, c, now)) {
      const key = `${f.npc}:${n.skill}@${Math.round(n.at / 1000)}`, cfg = c[n.skill]
      if (spoken.has(key)) continue
      spoken.add(key)
      const s = Math.max(1, Math.round((n.at - now) / 1000)), danger = isDanger(cfg?.kind)
      call(f, t('boss.soonTitle', { skill: n.name }), b?.name ?? '', cfg, (n.at - now) / 1000)
      if (speakable(cfg) && voiceFor(f, cfg, danger, now)) speak(t('boss.saySoon', { skill: what(cfg), n: s }))
    }
    // countdown "3, 2, 1" for the warned (predictable) skills that have something to say
    if (opt('bossCount'))
      for (const [id, s] of Object.entries(b?.skills || {})) {
        const cfg = c[id]
        if (!predictable(s) || warnLead(s, cfg) <= 0 || !speakable(cfg)) continue
        const last = f.casts.findLast(x => x.skill === +id)
        if (!last) continue
        const at = last.at + s.gap![0] * 1000
        for (const n of COUNT) {
          const key = `${f.npc}:${id}@${Math.round(at / 1000)}#${n}`
          if (spoken.has(key) || now < at - n * 1000 || now >= at - (n - 1) * 1000) continue // [at - n s, at - (n-1) s)
          spoken.add(key)
          if (voiceFor(f, cfg, isDanger(cfg?.kind), now)) speak(String(n), true)
        }
      }
    // phases: the guide's (placeholders without voice), else the ones found in the timelines
    for (const p of dueGuidePhases(f, gb)) {
      call(f, t('boss.phase', { skill: p.name, hp: p.hp }), b?.name ?? '', undefined, 0, false)
      if (!p.todo && voiceFor(f, undefined, false, now)) speak(t('boss.sayPhase', { skill: p.name, hp: p.hp }))
    }
    for (const p of duePhases(f, b, c)) {
      if (gb?.phases.some(x => x.skill === p.skill)) continue
      call(f, t('boss.phase', { skill: p.name, hp: p.hp }), b?.name ?? '', c[p.skill], 0, false)
      if (speakable(c[p.skill]) && voiceFor(f, c[p.skill], false, now)) speak(t('boss.sayPhase', { skill: what(c[p.skill]), hp: p.hp }))
    }
  }
  const f = V.bossFight as Fight | null
  if (!on_() || !opt('bossBars') || !f || bossMode(f.npc) === 'off') { clearBars(); return }
  postBars(f, now, c)
  barsShown = true
}, 250)

// Petze for the panel: counted again only when new hits came (or the settings changed)
const blameCache = new WeakMap<Fight, { n: number; c: Cfgs; res: Blame[] }>()
function liveBlame(f: Fight, c: Cfgs): Blame[] {
  if (!BLAME) return []
  const k = blameCache.get(f)
  if (k && k.n === f.hits.length && k.c === c) return k.res
  const res = blame(f, boss(f.npc), c)
  blameCache.set(f, { n: f.hits.length, c, res })
  return res
}

function postBars(f: Fight, now: number, c: Cfgs) {
  const b = boss(f.npc), gb = guide(f.npc), hp = hpPct(f)
  const phases = [...new Set([...(gb?.phases || []).map(p => p.hp), ...(b ? Object.values(b.skills).map(phaseHp).filter((x): x is number => x !== null) : [])])]
  const live = liveBlame(f, c).slice(0, 3)
  host({
    type: 'bossBars', title: b?.name || String(f.npc), phase: phaseName(gb, hp), hp, phases,
    frenzy: gb?.frenzy ? Math.max(0, gb.frenzy - (now - f.pull) / 1000) : -1,
    target: f.target?.name || '', me: !!f.target?.me,
    rows: bars(f, b, c, now).map(r => [r.name, Math.round(r.left * 10) / 10, r.total, r.col, c[r.skill]?.kind ? t('boss.b.' + c[r.skill].kind) : '']),
    foot: live.length ? [[t('boss.blameLive', { list: live.map(x => `${x.name} ${x.hits}×`).join(' · ') }), '#e8c872']] : [],
  })
}

// ---------------------------------------------------------------- test pull (like DBM's test bars)

let testTimers: ReturnType<typeof setTimeout>[] = []
/** Stop a running test pull. */
export function stopTest() {
  testTimers.forEach(clearTimeout)
  testTimers = []
  const f = fights.get(-1)
  if (f) { f.end = now_(); finish(f, true) }
  if (V.bmTest) { U.bossMod = V.bmTest.was; V.bmTest = null }
  host({ type: 'bossCall', title: '' })
  bump()
}

/** Plays a boss's timeline for 75 s with fake events: callouts, bars, voice, phases, "target on you" and a Petze. */
export function testPull(npc: number) {
  const b = boss(npc)
  if (!b) return
  stopTest() // one at a time
  V.bmTest = { npc, was: !!U.bossMod }
  U.bossMod = true
  const ent = -1, len = 75_000, fake = (ms: number, f: () => void) => { testTimers.push(setTimeout(f, ms)) }
  const shown = Object.entries(b.skills).filter(([, s]) => !s.common && (predictable(s) || (s.cast ?? 0) >= 3))
  // the first callout right away (1 s), not after the boss's real opening
  const shift = Math.min(...shown.map(([, s]) => Math.max(0, s.first))) - 1
  for (const [id, s] of shown)
    for (let at = (Math.max(0, s.first) - shift) * 1000; at < len; at += predictable(s) ? s.gap![1] * 1000 : len) fake(at, () => onCast(npc, ent, +id, now_()))
  for (let ms = 0; ms <= len; ms += 1000) fake(ms, () => onHp(ent, Math.round(1e6 * (1 - ms / len / 1.2))))
  fake(12_000, () => onTarget(ent, 1, 'Testdaeva', true, now_()))
  const big = shown.find(([, s]) => (s.cast ?? 0) >= 3)?.[0]
  if (big) {
    fake(20_000, () => onHit(npc, ent, +big, 2, 'Testdaevi', false, now_(), 1))
    fake(40_000, () => onHit(npc, ent, +big, 2, 'Testdaevi', false, now_(), 2))
  }
  fake(len, stopTest)
  bump()
}
