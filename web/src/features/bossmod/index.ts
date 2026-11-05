// Boss mod: timelines (bossmods.json), the npcs the host watches (host 'bossMod'), live casts (host 'bossCast' /
// 'bossCastEnd' / 'bossGone') -> banner (host 'alert') + voice (kind 'bossmod') on big casts and before predictable ones.
// Times are the packets' (replay too): the clock offset to Date.now() comes with every event.
import { on } from '@/core/bus'
import { host, onHost } from '@/core/host'
import { addStrings, t } from '@/core/i18n'
import { G, U, V, bump } from '@/core/state'
import { TTS_KINDS, say } from '@/core/tts'
import { toast } from '@/core/toast'
import { inInstance } from '@/features/pvp'
import { addCast, alertOn, dueWarnings, endCast, npcIds, skillName, type BossMods, type Fight, type SkillCfg } from './logic'
import strings from './strings'

addStrings(strings)
TTS_KINDS.push('bossmod')

const fights = new Map<number, Fight>() // entity -> fight
let clock = 0 // Date.now() - packet time
const cfgs = (): Record<string, SkillCfg> => U.bossSkills || {}
const boss = (npc: number) => (G.bossMods as BossMods | undefined)?.bosses[npc]
const on_ = () => !!U.bossMod

/** Tell the host which npcs to watch and what to record: dungeon bosses only, so every npc fight inside a dungeon
 *  (BossRecorder.cs; on unless switched off, U.bossRec), nothing outside. */
function sync() {
  const inst = inInstance()
  host({ type: 'bossMod', ids: npcIds(G.bossMods), learn: !!U.bossLearn, rec: inst && U.bossRec !== false, inst })
}

fetch('bossmods.json').then(r => r.json()).then(d => { G.bossMods = d; sync() }).catch(() => { G.bossMods = { bosses: {} } })
onHost('init', sync)
onHost('zone', sync) // after the map module set S.zone (registered before this module)
on('recompute', sync) // settings toggles

onHost('bossRecs', m => { V.bossRecs = m; bump() })
onHost('bossRec', m => { (V.bossRecList ||= []).unshift(m.rec); V.bossRecList.length = Math.min(V.bossRecList.length, 20); bump() })
onHost('bossMark', m => {
  if (!m.ok) { toast(t('boss.markNone'), ''); return }
  ;(V.bossMarks ||= []).push(m.at)
  toast(t('boss.mark'), '')
})
onHost('bossExported', m => toast(m.path ? t('boss.exported') : t('boss.exportNone'), m.path || ''))

function fightOf(npc: number, ent: number, at: number): Fight {
  let f = fights.get(ent)
  if (!f) fights.set(ent, f = { npc, ent, pull: at, casts: [], warned: new Set() })
  return f
}

onHost('bossCast', m => {
  clock = Date.now() - m.at
  if (!on_()) return
  const f = fightOf(m.npc, m.ent, m.at)
  if (!addCast(f, m.skill, m.at)) return
  V.bossFight = f
  const b = boss(m.npc), s = b?.skills[m.skill], cfg = cfgs()[m.skill]
  if (b && alertOn(s, cfg)) {
    const sec = s?.cast ?? 0
    host({ type: 'alert', title: t('boss.cast', { name: b.name, skill: skillName(m.skill, cfg) }), sub: sec ? t('boss.castSub', { s: sec }) : '', seconds: Math.max(3, Math.ceil(sec) + 1), always: true })
    say('bossmod', t('boss.sayCast', { skill: cfg?.name || t('boss.big') }))
  }
  bump()
})
onHost('bossCastEnd', m => { const f = fights.get(m.ent); if (f) endCast(f, m.skill, m.at) })
onHost('bossGone', m => {
  fights.delete(m.ent)
  if (V.bossFight?.ent === m.ent) { V.bossFight = null; bump() }
})
onHost('zone', () => { fights.clear(); V.bossFight = null })

setInterval(() => {
  if (!on_() || !fights.size) return
  const now = Date.now() - clock
  for (const f of fights.values()) {
    const b = boss(f.npc)
    for (const n of dueWarnings(f, b, cfgs(), now)) {
      const s = Math.max(1, Math.round((n.at - now) / 1000))
      host({ type: 'alert', title: t('boss.soon', { skill: n.name, n: s }), sub: t('boss.soonSub', { name: b?.name ?? '', n: s }), seconds: s, always: true })
      say('bossmod', t('boss.saySoon', { skill: cfgs()[n.skill]?.name || t('boss.big'), n: s }))
    }
  }
}, 250)
