// Boss mod: timelines (bossmods.json), the npcs the host watches (host 'bossMod'), live boss events from the host
// ('bossCast' / 'bossCastEnd' / 'bossHp' / 'bossTarget' / 'bossHit' / 'bossGone') -> the three outputs like DBM:
//   timer bars (host 'bossBars' -> BossBarsForm.cs), banner (host 'alert' -> AlertForm.cs), voice (kind 'bossmod');
// and after the fight the Petze: who was hit by avoidable skills (banner + the Boss-Helfer page, U.bossFights).
// Times are the packets' (replay too): the clock offset to Date.now() comes with every event.
import { on } from '@/core/bus'
import { host, onHost } from '@/core/host'
import { addStrings, t } from '@/core/i18n'
import { G, U, V, bump, saveUi } from '@/core/state'
import { TTS_KINDS, say } from '@/core/tts'
import { toast } from '@/core/toast'
import { inInstance } from '@/features/pvp'
import {
  addCast, addHit, alertOn, avoidable, bars, blame, duePhases, dueWarnings, endCast, findBoss, hpPct, kindCol, newFight, npcIds, phaseHp, predictable,
  setHp, skillName, voiceOn, wasReset, type BossMods, type Cfgs, type Fight,
} from './logic'
import strings from './strings'

addStrings(strings)
TTS_KINDS.push('bossmod')

/** A finished fight as kept for the Boss-Helfer page (last FIGHTS_KEPT, in settings.json). */
export type FightLog = { npc: number; name: string; at: number; dur: number; died: boolean; casts: [number, number][]; marks: number[]; blame: ReturnType<typeof blame> }
const FIGHTS_KEPT = 8
const QUIET = 120_000 // no cast for this long: the fight is over (normally it ends with bossGone or a reset, wasReset)

const fights = new Map<number, Fight>() // entity -> fight
const topHp = new Map<number, number>() // entity -> highest HP before its fight (the full HP for the %)
let clock = 0 // Date.now() - packet time
export const cfgs = (): Cfgs => U.bossSkills || {}
export const boss = (npc: number) => findBoss(G.bossMods as BossMods | undefined, npc)
const on_ = () => !!U.bossMod
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

fetch('bossmods.json').then(r => r.json()).then(d => { G.bossMods = d; sync() }).catch(() => { G.bossMods = { bosses: {} } })
onHost('init', () => sync(true))
onHost('zone', () => { for (const f of [...fights.values()]) finish(f); topHp.clear(); sync(true) }) // the host stops recording on a map change // after the map module set S.zone
on('recompute', sync) // settings toggles

onHost('bossRecs', m => { V.bossRecs = m; bump() })
onHost('bossRec', m => { (V.bossRecList ||= []).unshift(m.rec); V.bossRecList.length = Math.min(V.bossRecList.length, 20); bump() })
onHost('bossMark', m => {
  if (!m.ok) { toast(t('boss.markNone'), ''); return }
  const f = V.bossFight as Fight | null
  if (f) (f.marks ||= []).push(m.at - clock)
  toast(t('boss.mark'), '')
})
onHost('bossExported', m => toast(m.path ? t('boss.exported') : t('boss.exportNone'), m.path || ''))

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
const speak = (text: string, cfg?: { voice?: boolean }) => { if (voiceOn(cfg)) say('bossmod', text) }

export function onCast(npc: number, ent: number, skill: number, at: number) {
  if (!on_()) return
  const f = fightOf(npc, ent, at)
  if (!addCast(f, skill, at)) return
  V.bossFight = f
  const b = boss(npc), s = b?.skills[skill], cfg = cfgs()[skill]
  // the same skill from clones (several entities with this npc id) within 1.5 s: one banner / voice line
  const k = `${npc}:${skill}`, last = lastAlert.get(k) ?? -Infinity
  if (b && alertOn(s, cfg) && at - last > 1500) {
    lastAlert.set(k, at)
    const sec = s?.cast ?? 0, what = cfg?.text || (cfg?.kind ? t('boss.k.' + cfg.kind) : '')
    host({
      type: 'alert', title: t('boss.cast', { name: b.name, skill: skillName(skill, cfg) }) + (what ? ' – ' + what : ''),
      sub: sec ? t('boss.castSub', { s: sec }) : '', seconds: Math.max(3, Math.ceil(sec) + 1), always: true,
      danger: cfg?.kind === 'dodge' || cfg?.kind === 'out' || cfg?.kind === 'in',
    })
    speak(cfg?.text || (cfg?.kind ? t('boss.k.' + cfg.kind) : cfg?.name || t('boss.big')), cfg)
  }
  bump()
}

export function onHit(npc: number, ent: number, skill: number, tgt: number, name: string, me: boolean, at: number) {
  const f = fights.get(ent) || (on_() ? fightOf(npc, ent, at) : null)
  if (!f || !addHit(f, { skill, tgt, name, me, at })) return
  if (U.bossBlameLive && name && avoidable(boss(npc)?.skills[skill], cfgs()[skill]))
    say('bossmod', t('boss.sayHit', { name, skill: skillName(skill, cfgs()[skill]) }))
}

export function onHp(ent: number, hp: number) {
  const f = fights.get(ent)
  if (f) { setHp(f, hp); if (wasReset(f)) finish(f) }
  else topHp.set(ent, Math.max(topHp.get(ent) ?? 0, hp))
}

onHost('bossCast', m => { clock = Date.now() - m.at; onCast(m.npc, m.ent, m.skill, m.at) })
onHost('bossCastEnd', m => { const f = fights.get(m.ent); if (f) endCast(f, m.skill, m.at) })
onHost('bossHp', m => { clock = Date.now() - m.at; onHp(m.ent, m.hp) })
onHost('bossHit', m => onHit(m.npc, m.ent, m.skill, m.tgt, m.name, m.me, m.at))
onHost('bossTarget', m => { const f = fights.get(m.ent); if (f) f.target = { ent: m.tgt, name: m.name, me: m.me } })
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
  if (U.bossBlame !== false && bl.length) {
    const top = bl.slice(0, 3).map(x => `${x.name} ${x.hits}×`).join(', ')
    host({ type: 'alert', title: t('boss.blame', { name: log.name }), sub: top + (bl.length > 3 ? ' …' : ''), seconds: 10, always: true })
  }
  bump()
}

// ---------------------------------------------------------------- tick: warnings, phases, bars

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
    const b = boss(f.npc)
    for (const n of dueWarnings(f, b, c, now)) {
      const s = Math.max(1, Math.round((n.at - now) / 1000)), cfg = c[n.skill]
      host({ type: 'alert', title: t('boss.soon', { skill: n.name, n: s }), sub: t('boss.soonSub', { name: b?.name ?? '', n: s }), seconds: s, always: true })
      speak(t('boss.saySoon', { skill: cfg?.name || (cfg?.kind ? t('boss.k.' + cfg.kind) : t('boss.big')), n: s }), cfg)
    }
    for (const p of duePhases(f, b, c)) {
      host({ type: 'alert', title: t('boss.phase', { skill: p.name, hp: p.hp }), sub: b?.name ?? '', seconds: 5, always: true })
      speak(t('boss.sayPhase', { skill: c[p.skill]?.name || t('boss.big'), hp: p.hp }), c[p.skill])
    }
  }
  const f = V.bossFight as Fight | null
  if (!on_() || U.bossBars === false || !f) return
  const b = boss(f.npc)
  const phases = b ? Object.entries(b.skills).map(([, s]) => phaseHp(s)).filter((x): x is number => x !== null) : []
  host({
    type: 'bossBars', title: b?.name || String(f.npc), hp: hpPct(f), phases, target: f.target?.name || '', me: !!f.target?.me,
    rows: bars(f, b, c, now).map(r => [r.name, Math.round(r.left * 10) / 10, r.total, r.col]),
  })
  barsShown = true
}, 250)

// ---------------------------------------------------------------- test pull (like DBM's test bars)

/** Plays a boss's timeline for 75 s with fake events: bars, banners, voice, phases and a Petze at the end. */
export function testPull(npc: number) {
  const b = boss(npc)
  if (!b) return
  const was = U.bossMod
  U.bossMod = true
  const ent = -1, len = 75_000, fake = (ms: number, f: () => void) => setTimeout(f, ms)
  for (const [id, s] of Object.entries(b.skills)) {
    if (!predictable(s) && !(s.cast && s.cast >= 3)) continue
    for (let at = Math.max(0, s.first) * 1000; at < len; at += predictable(s) ? s.gap![1] * 1000 : len) fake(at, () => onCast(npc, ent, +id, now_()))
  }
  for (let ms = 0; ms <= len; ms += 1000) fake(ms, () => onHp(ent, Math.round(1e6 * (1 - ms / len / 1.2))))
  const big = Object.keys(b.skills).find(id => b.skills[id].cast && b.skills[id].cast! >= 3)
  if (big) fake(20_000, () => onHit(npc, ent, +big, 1, 'Testdaeva', false, now_()))
  fake(len, () => {
    const f = fights.get(ent)
    if (f) { f.end = now_(); finish(f, true) }
    U.bossMod = was
    bump()
  })
}

/** For the page: the live fight, if any. */
export const liveFight = () => V.bossFight as Fight | null
export { kindCol }
