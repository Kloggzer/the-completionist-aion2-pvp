import { describe, expect, it } from 'vitest'
import data from '../../../public/bossmods.json'
import {
  HP_LEAD, WARN, addCast, addHit, alertOn, avoidable, bars, blame, duePhases, dueWarnings, endCast, findBoss, isBig, newFight, npcIds, phaseHp,
  predictable, setHp, upcoming, warnLead, wasReset, findGuide, guideCfgs, mergeCfgs, mainTarget, trackTarget, phaseName, dueGuidePhases, isDanger,
  speakable, type BossMods, type BossStat, type Guide,
} from './logic'

// Atiel (Deus Research Base, 2343601): 3 fights in captures/20261027-170912 (tools/boss_timeline.py).
const mods = data as unknown as BossMods
const atiel = mods.bosses['2343601']
const fight = () => newFight(2343601, 38334, 0)
// A boss with a well-known timer (many fights): 9001 every 66–72 s, 9002 every 30–60 s (not predictable).
const timed: BossStat = {
  name: 'Test', fights: 6, dur: [180], skills: {
    9001: { fights: 6, n: 3, first: 10, gap: [66.6, 70, 72], gaps: 12, cast: 3.7, hp: [10, 95] },
    9002: { fights: 6, n: 4, first: 5, gap: [30, 45, 60], gaps: 18, cast: 3.2, hp: [5, 99] },
    9003: { fights: 2, n: 3, first: 5, gap: [40, 41, 42], gaps: 4, cast: 3.5, hp: [5, 99] },
  },
}

describe('boss mod timelines', () => {
  it('has the captured dungeon bosses', () => {
    expect(atiel.name).toBe('Atiel')
    expect(npcIds(mods)).toEqual(expect.arrayContaining([2343601, 2343615, 2343616, 2353707, 2353708, 2353709]))
  })

  it('other modes of a boss come from the aliases', () => {
    expect(mods.aliases?.['2346601']).toBe('2343601')
    expect(findBoss(mods, 2346601)?.name).toBe('Atiel')
    expect(npcIds(mods)).toContain(2346601)
    expect(findBoss(mods, 2346699)).toBeUndefined()
  })

  it('big casts: long and rare', () => {
    expect(isBig(atiel.skills['1801450'])).toBe(true) // 3.7 s, twice per fight
    expect(isBig(atiel.skills['1801540'])).toBe(false) // instant, 25 per fight
    expect(alertOn(atiel.skills['1801540'], { alert: true })).toBe(true) // own setting wins
  })

  it('predictable: the gap varies little and comes from enough fights', () => {
    expect(predictable(timed.skills[9001])).toBe(true) // 66.6–72 s from 12 gaps in 6 fights
    expect(predictable(timed.skills[9002])).toBe(false) // 30–60 s
    expect(predictable(timed.skills[9003])).toBe(false) // tight, but 4 gaps from 2 fights: noise
    expect(predictable(atiel.skills['1801510'])).toBe(false) // once per fight (HP phase)
    expect(warnLead(timed.skills[9001])).toBe(WARN)
    expect(warnLead(timed.skills[9001], { warn: 0 })).toBe(0)
  })

  it('never says a skill id: only named / described skills are spoken', () => {
    expect(speakable(undefined)).toBe(false)
    expect(speakable({ alert: true })).toBe(false)
    expect(speakable({ kind: 'out' })).toBe(true)
    expect(speakable({ name: 'Sprung' })).toBe(true)
  })

  it('phase skills: marked by the tool (once per fight, in most fights, narrow HP band), never a generic skill', () => {
    expect(phaseHp(atiel.skills['1801510'])).toBe(atiel.skills['1801510'].hp![1]) // 70–74 %
    expect(phaseHp(atiel.skills['1801450'])).toBeNull()
    expect(phaseHp({ ...atiel.skills['1801510'], common: true })).toBeNull()
  })
})

describe('boss mod fight', () => {
  it('one cast on several targets counts once, the end is recorded', () => {
    const f = fight()
    expect(addCast(f, 1801450, 1000)).not.toBeNull()
    expect(addCast(f, 1801450, 1100)).toBeNull()
    endCast(f, 1801450, 4700)
    expect(f.casts).toEqual([{ skill: 1801450, at: 1000, end: 4700 }])
  })

  it('warns once, WARN seconds before the earliest next use', () => {
    const f = fight()
    addCast(f, 9001, 0)
    const next = upcoming(f, timed).find(n => n.skill === 9001)!
    expect(next.at).toBe(66_600)
    expect(dueWarnings(f, timed, {}, next.at - WARN * 1000 - 100)).toEqual([])
    expect(dueWarnings(f, timed, {}, next.at - WARN * 1000 + 100).map(n => n.skill)).toEqual([9001])
    expect(dueWarnings(f, timed, {}, next.at - 1000)).toEqual([])
  })

  it('named skills show their name', () => {
    const f = fight()
    addCast(f, 9001, 0)
    expect(upcoming(f, timed, { 9001: { name: 'Sprung' } }).find(n => n.skill === 9001)?.name).toBe('Sprung')
  })

  it('phase warning once, HP_LEAD % above the phase, not after the skill came', () => {
    const at = phaseHp(atiel.skills['1801510'])!
    const f = fight()
    setHp(f, 1000)
    setHp(f, Math.round(10 * (at + HP_LEAD + 2)))
    expect(duePhases(f, atiel, {})).toEqual([])
    setHp(f, Math.round(10 * (at + HP_LEAD - 1)))
    expect(duePhases(f, atiel, {}).map(p => p.skill)).toEqual([1801510])
    expect(duePhases(f, atiel, {})).toEqual([])
    const g = fight()
    setHp(g, 1000)
    addCast(g, 1801510, 0)
    setHp(g, Math.round(10 * at))
    expect(duePhases(g, atiel, {})).toEqual([])
  })

  it('bars: only predictable skills, counting down, coloured by what to do', () => {
    const f = fight()
    addCast(f, 9001, 0)
    addCast(f, 9002, 2000)
    const b = bars(f, timed, { 9001: { kind: 'dodge' } }, 10_000)
    expect(b.map(x => x.skill)).toEqual([9001])
    expect(b[0]).toMatchObject({ col: '#ff6a5c' })
    expect(b[0].left).toBeCloseTo(56.6, 1)
    expect(bars(f, timed, { 9001: { bar: false } }, 10_000)).toEqual([])
  })

  it('the tank: who held the boss most of the time (from 10 s)', () => {
    const f = fight()
    const to = (ent: number, at: number) => { trackTarget(f, at); f.target = { ent, name: '', me: false } }
    to(1, 0)
    expect(mainTarget(f, 5000)).toBeUndefined() // too short
    to(2, 9000) // a mechanic on player 2 for 2 s
    to(1, 11000)
    expect(mainTarget(f, 20000)).toBe(1)
    to(2, 20000)
    expect(mainTarget(f, 60000)).toBe(2) // now 2 holds it most of the time
  })

  it('a boss back at full HP after damage was reset (wipe)', () => {
    const f = fight()
    setHp(f, 1000)
    expect(wasReset(f)).toBe(false)
    setHp(f, 600)
    expect(wasReset(f)).toBe(false)
    setHp(f, 1000)
    expect(wasReset(f)).toBe(true)
  })
})

describe('boss mod Petze', () => {
  it('counts hits of avoidable skills per player, multi-hits once', () => {
    const f = fight()
    addHit(f, { skill: 1801450, tgt: 1, name: 'Testdaeva', me: true, at: 1000 })
    expect(addHit(f, { skill: 1801450, tgt: 1, name: 'Testdaeva', me: true, at: 1300 })).toBeNull() // same hit, more frames
    addHit(f, { skill: 1801450, tgt: 1, name: 'Testdaeva', me: true, at: 70_000 })
    addHit(f, { skill: 1801450, tgt: 2, name: 'Testdaevi', me: false, at: 1000 })
    addHit(f, { skill: 1801540, tgt: 2, name: 'Testdaevi', me: false, at: 2000 }) // small attack: not avoidable by default
    addHit(f, { skill: 1801430, tgt: 3, name: '', me: false, at: 2000 })
    addHit(f, { skill: 1801500, tgt: 3, name: '', me: false, at: 3000 }) // not marked: never counts
    const b = blame(f, atiel, { 1801450: { name: 'Sprung', kind: 'dodge' }, 1801430: { kind: 'out' } })
    expect(b.map(x => [x.name, x.hits])).toEqual([['Testdaeva', 2], ['#3', 1], ['Testdaevi', 1]])
    expect(b[0]).toMatchObject({ me: true, skills: [{ skill: 1801450, name: 'Sprung', n: 2 }] })
  })

  it('a cast that hits most of the group is raid damage, unless the skill is set by hand', () => {
    const f = fight()
    for (const tgt of [1, 2, 3, 4]) addHit(f, { skill: 1801450, tgt, name: 'P' + tgt, me: false, at: 1000 + tgt * 100 })
    addHit(f, { skill: 1801450, tgt: 1, name: 'P1', me: false, at: 70_000 }) // next cast: only one hit
    expect(blame(f, atiel, { 1801450: { avoid: true } }).map(x => [x.name, x.hits])).toEqual([['P1', 2], ['P2', 1], ['P3', 1], ['P4', 1]])
    expect(blame(f, atiel, {})).toEqual([]) // unmarked: nothing
  })

  it('a multi-part cast spread over seconds is one cast (cast counter)', () => {
    const f = fight()
    // cast 7 hits all four players over 6 s (several parts): raid damage; cast 8 hits only P2
    for (const [tgt, at] of [[1, 0], [2, 2500], [3, 4500], [4, 6000], [1, 6500]]) addHit(f, { skill: 1801455, tgt, name: 'P' + tgt, me: false, at, seq: 7 })
    for (const tgt of [1, 2, 3, 4]) addHit(f, { skill: 1801450, tgt, name: 'P' + tgt, me: false, at: 20_000, seq: 9 })
    addHit(f, { skill: 1801455, tgt: 2, name: 'P2', me: false, at: 40_000, seq: 8 })
    expect(f.hits.filter(h => h.skill === 1801455 && h.tgt === 1)).toHaveLength(1) // same cast, same player: once
    // marked by hand: counts even when it hit everybody; one hit per player and cast
    expect(blame(f, atiel, { 1801455: { avoid: true } }).map(x => [x.name, x.hits])).toEqual([['P2', 2], ['P1', 1], ['P3', 1], ['P4', 1]])
  })

  it('generic skills (on many bosses) are never big or a phase', () => {
    const s = atiel.skills['1000009']
    expect(s.common).toBe(true)
    expect(phaseHp(s)).toBeNull()
    expect(isBig({ ...s, cast: 5 })).toBe(false)
  })

  it('avoidable by kind, or set by hand; unmarked never', () => {
    const s = atiel.skills['1801540']
    expect(avoidable(s)).toBe(false)
    expect(avoidable(atiel.skills['1801450'])).toBe(false)
    expect(avoidable(s, { kind: 'out' })).toBe(true)
    expect(avoidable(atiel.skills['1801450'], { kind: 'stack' })).toBe(false)
    expect(avoidable(atiel.skills['1801450'], { kind: 'stack', avoid: true })).toBe(true)
  })
})

describe('boss guide', () => {
  const g: Guide = {
    bosses: {
      2343601: {
        name: 'Atiel', frenzy: 300,
        phases: [{ hp: 74, name: 'Sprungphase', skill: 1801510 }, { hp: 30, name: 'Endphase' }],
        mechanics: [{ name: 'Sprung', kind: 'dodge', text: 'Weg vom Boss', skills: [1801450] }, { name: 'Ketten', skills: [], todo: true }],
      },
    },
  }

  it('gives skill settings, the player own ones on top', () => {
    const base = guideCfgs(g)
    expect(base[1801450]).toEqual({ name: 'Sprung', kind: 'dodge', text: 'Weg vom Boss' })
    expect(Object.keys(base)).toEqual(['1801450']) // placeholder mechanics without skills give nothing
    expect(mergeCfgs(base, { 1801450: { text: 'Raus!' } })[1801450]).toEqual({ name: 'Sprung', kind: 'dodge', text: 'Raus!' })
  })

  it('finds the guide of another mode through the aliases', () => {
    expect(findGuide(g, mods, 2346601)?.name).toBe('Atiel')
  })

  it('phase by HP and phase warnings once, HP_LEAD % above', () => {
    const gb = g.bosses[2343601]
    expect(phaseName(gb, 90)).toBe('')
    expect(phaseName(gb, 50)).toBe('Sprungphase')
    expect(phaseName(gb, 10)).toBe('Endphase')
    const f = fight()
    setHp(f, 1000)
    setHp(f, 340)
    expect(dueGuidePhases(f, gb).map(p => p.name)).toEqual(['Sprungphase', 'Endphase'])
    expect(dueGuidePhases(f, gb)).toEqual([])
  })

  it('danger per kind', () => {
    expect(isDanger('dodge')).toBe(true)
    expect(isDanger('stack')).toBe(false)
  })
})
