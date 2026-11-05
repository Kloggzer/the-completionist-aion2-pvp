// Boss mod: timelines (bossmods.json), the hand-made guide (bossguide.json: phases, mechanics, Frenzy), the npcs the host
// watches (host 'bossMod'), live boss events from the host ('bossCast' / 'bossCastEnd' / 'bossHp' / 'bossTarget' /
// 'bossHit' / 'bossGone') -> the outputs like DBM / WeakAuras:
//   centre callout (host 'bossCall' -> BossCallForm.cs): ONE instruction with a running bar, sound per mechanic,
//   timer panel (host 'bossBars' -> BossBarsForm.cs): phase, Frenzy, HP, the next attacks, aggro target, live Petze,
//   voice (kind 'bossmod'): callout, "in 5", countdown "3, 2, 1", phases, "target on you";
// and after the fight the Petze: who was hit by avoidable skills (banner, the Boss-Helfer page, U.bossFights).
// Times are the packets' (replay too): the clock offset to Date.now() comes with every event.
import { on } from '@/core/bus'
import { host, onHost } from '@/core/host'
import { addStrings, t } from '@/core/i18n'
import { G, U, V, bump, saveUi } from '@/core/state'
import { TTS_KINDS, say } from '@/core/tts'
import { toast } from '@/core/toast'
import { inInstance } from '@/features/pvp'
import {
  addCast, addHit, alertOn, avoidable, bars, blame, dueGuidePhases, duePhases, dueWarnings, endCast, findBoss, findGuide, guideCfgs, hpPct,
  isDanger, kindCol, kindSound, mainTarget, mergeCfgs, newFight, trackTarget, npcIds, phaseHp, phaseName, predictable, setHp, skillName, voiceOn, warnLead, wasReset,
  type BossMods, type Cfgs, type Fight, type Guide,
} from './logic'
import strings from './strings'

addStrings(strings)
TTS_KINDS.push('bossmod')

/** A finished fight as kept for the Boss-Helfer page (last FIGHTS_KEPT, in settings.json). */
export type FightLog = { npc: number; name: string; at: number; dur: number; died: boolean; casts: [number, number][]; marks: number[]; blame: ReturnType<typeof blame> }
const FIGHTS_KEPT = 8
const QUIET = 120_000 // no cast for this long: the fight is over (normally it ends with bossGone or a reset, wasReset)
const TARGET_GAP = 8_000 // "target on you" at most this often

const fights = new Map<number, Fight>() // entity -> fight
const topHp = new Map<number, number>() // entity -> highest HP before its fight (the full HP for the %)
let clock = 0 // Date.now() - packet time
let guideBase: Cfgs = {}
/** Effective skill settings: the guide's, the player's own on top (U.bossSkills). */
export const cfgs = (): Cfgs => mergeCfgs(guideBase, U.bossSkills || {})
/** The player's own settings only (the editor shows the guide's as placeholders). */
export const ownCfgs = (): Cfgs => U.bossSkills || {}
export const boss = (npc: number) => findBoss(G.bossMods as BossMods | undefined, npc)
export const guide = (npc: number) => findGuide(G.bossGuide as Guide | undefined, G.bossMods as BossMods | undefined, npc)
const on_ = () => !!U.bossMod
const opt = (k: string) => U[k] !== false // boss options that default to on
const now_ = () => Date.now() - clock

/** Tell the host which npcs to watch and what to record: dungeon bosses only, so every npc fight inside a dungeon
 *  (BossRecorder.cs; on unless switched off, U.bossRec), nothing outside. */
let synced = ''
function sync(force = false) {
  const inst = inInstance()
  const m = { type: 'bossMod', ids: npcIds(G.bossMods), learn: !!U.bossLearn, rec: inst && U.bossRec !== false, inst }
  const key = JSON.stringify(m)
  if (key === synced && !force) return // 'recompute' comes often; the host rescans the recordings on every message
  synced = key
  host(m)
}

fetch('bossmods.json').then(r => r.json()).then(d => { G.bossMods = d; sync(); bump() }).catch(() => { G.bossMods = { bosses: {} } })
fetch('bossguide.json').then(r => r.json()).then(d => { G.bossGuide = d; guideBase = guideCfgs(d); bump() }).catch(() => { G.bossGuide = { bosses: {} } })
onHost('init', () => sync(true))
onHost('zone', () => { for (const f of [...fights.values()]) finish(f); topHp.clear(); sync(true) }) // the host stops recording on a map change
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

const speak = (text: string, cfg?: { voice?: boolean }) => { if (voiceOn(cfg)) say('bossmod', text) }
/** Centre callout (BossCallForm) with the mechanic's colour and sound. */
function call(title: string, sub: string, cfg: Cfgs[string] | undefined, seconds: number, danger = isDanger(cfg?.kind)) {
  host({ type: 'bossCall', title, sub, col: danger && !cfg?.kind ? '#ff6a5c' : kindCol(cfg), seconds, danger, sound: opt('bossSound') ? kindSound(cfg?.kind) : '' })
}
/** What the voice / callout says for a skill: own text, else the kind ("Raus!"), else its name, else "big attack". */
const what = (cfg?: Cfgs[string]) => cfg?.text || (cfg?.kind ? t('boss.k.' + cfg.kind) : '') || cfg?.name || t('boss.big')

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
  if (!on_()) return
  const f = fightOf(npc, ent, at)
  if (!addCast(f, skill, at)) return
  V.bossFight = f
  const b = boss(npc), s = b?.skills[skill], cfg = cfgs()[skill]
  // the same skill from clones (several entities with this npc id) within 1.5 s: one callout
  const k = `${npc}:${skill}`, last = lastAlert.get(k) ?? -Infinity
  if (b && alertOn(s, cfg) && at - last > 1500) {
    lastAlert.set(k, at)
    const sec = s?.cast ?? 0, kind = cfg?.kind ? t('boss.k.' + cfg.kind).toUpperCase() : ''
    // a big cast aimed at oneself: "ON YOU" (not for the tank: the boss aims at the tank all the time)
    const onMe = me && opt('bossTargetMe') && !iTank(f, at)
    call([onMe ? t('boss.onYou') : kind, skillName(skill, cfg)].filter(Boolean).join(' · '), b.name + (sec ? ' · ' + t('boss.castSub', { s: sec }) : ''), cfg, sec, onMe || undefined)
    speak(onMe ? t('boss.sayOnYou', { skill: what(cfg) }) : what(cfg), cfg)
  }
  bump()
}

export function onHit(npc: number, ent: number, skill: number, tgt: number, name: string, me: boolean, at: number, seq?: number) {
  const f = fights.get(ent) || (on_() ? fightOf(npc, ent, at) : null)
  if (!f || !addHit(f, { skill, tgt, name, me, at, ...(seq !== undefined ? { seq } : {}) })) return
  if (U.bossBlameLive && name && avoidable(boss(npc)?.skills[skill], cfgs()[skill]))
    say('bossmod', t('boss.sayHit', { name, skill: skillName(skill, cfgs()[skill]) }))
}

export function onHp(ent: number, hp: number) {
  const f = fights.get(ent)
  if (f) { setHp(f, hp); if (wasReset(f)) finish(f) }
  else topHp.set(ent, Math.max(topHp.get(ent) ?? 0, hp))
}

let targetAt = -Infinity
let ownEnt: number | undefined // own entity, learnt from the boss's targets (host: me)
/** Oneself holds the boss most of the fight: the tank. */
const iTank = (f: Fight, at: number) => ownEnt !== undefined && mainTarget(f, at) === ownEnt
export function onTarget(ent: number, tgt: number, name: string, me: boolean, at: number) {
  const f = fights.get(ent)
  if (!f) return
  const was = f.target?.me
  if (me) ownEnt = tgt
  trackTarget(f, at)
  f.target = { ent: tgt, name, me }
  if (me && !was && on_() && opt('bossTargetMe') && !iTank(f, at) && at - targetAt > TARGET_GAP) {
    targetAt = at
    call(t('boss.targetYou'), boss(f.npc)?.name ?? '', undefined, 0, true)
    speak(t('boss.sayTarget'))
  }
}

onHost('bossCast', m => { clock = Date.now() - m.at; if (m.me) ownEnt = m.tgt; onCast(m.npc, m.ent, m.skill, m.at, !!m.me) })
onHost('bossCastEnd', m => { const f = fights.get(m.ent); if (f) endCast(f, m.skill, m.at) })
onHost('bossHp', m => { clock = Date.now() - m.at; onHp(m.ent, m.hp) })
onHost('bossHit', m => onHit(m.npc, m.ent, m.skill, m.tgt, m.name, m.me, m.at, m.seq))
onHost('bossTarget', m => onTarget(m.ent, m.tgt, m.name, m.me, m.at))
onHost('bossGone', m => { const f = fights.get(m.ent); if (f) { f.died = m.died; f.end = m.at; finish(f) } })

/** End of a fight: keep it for the page (not a test pull), show the Petze. */
export function finish(f: Fight, test = false) {
  fights.delete(f.ent)
  topHp.delete(f.ent)
  if (V.bossFight?.ent === f.ent) V.bossFight = null
  if (!fights.size) host({ type: 'bossBars', rows: [] })
  if (!f.casts.length) return
  const b = boss(f.npc), end = f.end ?? f.casts.at(-1)!.at, bl = blame(f, b, cfgs())
  const log: FightLog = {
    npc: f.npc, name: b?.name || String(f.npc), at: f.pull + clock, dur: Math.round((end - f.pull) / 1000), died: !!f.died,
    casts: f.casts.map(c => [c.skill, Math.round((c.at - f.pull) / 100) / 10]),
    marks: (f.marks || []).map(m => Math.round((m - f.pull) / 100) / 10), blame: bl,
  }
  if (!test) {
    U.bossFights = [log, ...(U.bossFights || [])].slice(0, FIGHTS_KEPT)
    saveUi(['bossFights'])
  }
  if (opt('bossBlame') && bl.length) {
    const top = bl.slice(0, 3).map(x => `${x.name} ${x.hits}×`).join(', ')
    host({ type: 'alert', title: t('boss.blame', { name: log.name }), sub: top + (bl.length > 3 ? ' …' : ''), seconds: 10, always: true, sound: opt('bossSound') ? 'plong' : '' })
  }
  bump()
}

// ---------------------------------------------------------------- tick: warnings, countdown, phases, bars

const COUNT = [3, 2, 1]
let barsShown = false
setInterval(() => {
  if (!fights.size) {
    if (barsShown) { host({ type: 'bossBars', rows: [] }); barsShown = false }
    return
  }
  const now = now_(), c = cfgs()
  for (const f of [...fights.values()]) {
    if (f.ent >= 0 && now - (f.casts.at(-1)?.at ?? f.pull) > QUIET) { finish(f); continue } // test pull: ent < 0
    if (!on_()) continue
    const b = boss(f.npc), gb = guide(f.npc)
    for (const n of dueWarnings(f, b, c, now)) {
      const s = Math.max(1, Math.round((n.at - now) / 1000)), cfg = c[n.skill]
      call(t('boss.soonTitle', { skill: n.name }), b?.name ?? '', cfg, (n.at - now) / 1000)
      speak(t('boss.saySoon', { skill: what(cfg), n: s }), cfg)
    }
    // countdown "3, 2, 1" for the warned (predictable) skills
    if (opt('bossCount'))
      for (const [id, s] of Object.entries(b?.skills || {})) {
        if (!predictable(s) || warnLead(s, c[id]) <= 0) continue
        const last = f.casts.findLast(x => x.skill === +id)
        if (!last) continue
        const at = last.at + s.gap![0] * 1000
        for (const n of COUNT) {
          const key = `count ${id}@${at}#${n}`
          if (f.warned.has(key) || now < at - n * 1000 || now > at - (n - 1) * 1000) continue
          f.warned.add(key)
          if (voiceOn(c[id])) say('bossmod', String(n))
        }
      }
    // phases: the guide's (named), else the ones found in the timelines
    for (const p of dueGuidePhases(f, gb)) {
      call(t('boss.phase', { skill: p.name, hp: p.hp }), b?.name ?? '', undefined, 0)
      speak(t('boss.sayPhase', { skill: p.name, hp: p.hp }))
    }
    for (const p of duePhases(f, b, c)) {
      if (gb?.phases.some(x => x.skill === p.skill)) continue
      call(t('boss.phase', { skill: p.name, hp: p.hp }), b?.name ?? '', c[p.skill], 0)
      speak(t('boss.sayPhase', { skill: what(c[p.skill]), hp: p.hp }), c[p.skill])
    }
  }
  const f = V.bossFight as Fight | null
  if (!on_() || !opt('bossBars') || !f) return
  postBars(f, now, c)
  barsShown = true
}, 250)

function postBars(f: Fight, now: number, c: Cfgs) {
  const b = boss(f.npc), gb = guide(f.npc), hp = hpPct(f)
  const phases = [...new Set([...(gb?.phases || []).map(p => p.hp), ...(b ? Object.values(b.skills).map(phaseHp).filter((x): x is number => x !== null) : [])])]
  const live = blame(f, b, c).slice(0, 3)
  host({
    type: 'bossBars', title: b?.name || String(f.npc), phase: phaseName(gb, hp), hp, phases,
    frenzy: gb?.frenzy ? Math.max(0, gb.frenzy - (now - f.pull) / 1000) : -1,
    target: f.target?.name || '', me: !!f.target?.me,
    rows: bars(f, b, c, now).map(r => [r.name, Math.round(r.left * 10) / 10, r.total, r.col, c[r.skill]?.kind ? t('boss.b.' + c[r.skill].kind) : '']),
    foot: live.length ? [[t('boss.blameLive', { list: live.map(x => `${x.name} ${x.hits}×`).join(' · ') }), '#e8c872']] : [],
  })
}

// ---------------------------------------------------------------- test pull (like DBM's test bars)

/** Plays a boss's timeline for 75 s with fake events: callouts, bars, voice, phases, "target on you" and a Petze. */
export function testPull(npc: number) {
  const b = boss(npc)
  if (!b) return
  const was = U.bossMod
  U.bossMod = true
  const ent = -1, len = 75_000, fake = (ms: number, f: () => void) => setTimeout(f, ms)
  const shown = Object.entries(b.skills).filter(([, s]) => predictable(s) || (s.cast ?? 0) >= 3)
  // the first callout right away (1 s), not after the boss's real opening
  const shift = Math.min(...shown.map(([, s]) => Math.max(0, s.first))) - 1
  for (const [id, s] of shown)
    for (let at = (Math.max(0, s.first) - shift) * 1000; at < len; at += predictable(s) ? s.gap![1] * 1000 : len) fake(at, () => onCast(npc, ent, +id, now_()))
  for (let ms = 0; ms <= len; ms += 1000) fake(ms, () => onHp(ent, Math.round(1e6 * (1 - ms / len / 1.2))))
  fake(12_000, () => onTarget(ent, 1, 'Testdaeva', true, now_()))
  const big = Object.keys(b.skills).find(id => b.skills[id].cast && b.skills[id].cast! >= 3)
  if (big) {
    fake(20_000, () => onHit(npc, ent, +big, 2, 'Testdaevi', false, now_()))
    fake(40_000, () => onHit(npc, ent, +big, 2, 'Testdaevi', false, now_()))
  }
  fake(len, () => {
    const f = fights.get(ent)
    if (f) { f.end = now_(); finish(f, true) }
    U.bossMod = was
    bump()
  })
}
