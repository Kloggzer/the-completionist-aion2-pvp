import { describe, expect, it } from 'vitest'
import data from '../../../public/bossmods.json'
import {
  HP_LEAD, WARN, addCast, addHit, alertOn, avoidable, bars, blame, duePhases, dueWarnings, endCast, findBoss, isBig, newFight, npcIds, phaseHp,
  predictable, setHp, upcoming, warnLead, wasReset, type BossMods,
} from './logic'

// Atiel (Deus Research Base, 2343601): 3 fights in captures/20261027-170912 (tools/boss_timeline.py).
const mods = data as unknown as BossMods
const atiel = mods.bosses['2343601']
const fight = () => newFight(2343601, 38334, 0)

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

  it('predictable: the gap varies little', () => {
    expect(predictable(atiel.skills['1801450'])).toBe(true) // 66.6–75.8 s
    expect(predictable(atiel.skills['1801430'])).toBe(false) // 13.5–46.2 s
    expect(predictable(atiel.skills['1801510'])).toBe(false) // once per fight (HP phase)
    expect(warnLead(atiel.skills['1801450'])).toBe(WARN)
    expect(warnLead(atiel.skills['1801450'], { warn: 0 })).toBe(0)
  })

  it('phase skills: once per fight in a narrow HP band', () => {
    expect(phaseHp(atiel.skills['1801510'])).toBe(atiel.skills['1801510'].hp![1]) // 70–74 %
    expect(phaseHp(atiel.skills['1801450'])).toBeNull()
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
    addCast(f, 1801450, 0)
    const next = upcoming(f, atiel).find(n => n.skill === 1801450)!
    expect(next.at).toBe(atiel.skills['1801450'].gap![0] * 1000)
    expect(dueWarnings(f, atiel, {}, next.at - WARN * 1000 - 100)).toEqual([])
    expect(dueWarnings(f, atiel, {}, next.at - WARN * 1000 + 100).map(n => n.skill)).toContain(1801450)
    expect(dueWarnings(f, atiel, {}, next.at - 1000)).toEqual([])
  })

  it('named skills show their name', () => {
    const f = fight()
    addCast(f, 1801450, 0)
    expect(upcoming(f, atiel, { 1801450: { name: 'Sprung' } }).find(n => n.skill === 1801450)?.name).toBe('Sprung')
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

  it('bars: soonest first, counting down, coloured by what to do', () => {
    const f = fight()
    addCast(f, 1801450, 0)
    addCast(f, 1801460, 2000)
    const b = bars(f, atiel, { 1801450: { kind: 'dodge' } }, 10_000)
    expect(b[0]).toMatchObject({ skill: 1801450, col: '#ff6a5c' })
    expect(b[0].left).toBeCloseTo(atiel.skills['1801450'].gap![0] - 10, 1)
    expect(bars(f, atiel, { 1801450: { bar: false } }, 10_000).some(x => x.skill === 1801450)).toBe(false)
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
    const b = blame(f, atiel, { 1801450: { name: 'Sprung' } })
    expect(b.map(x => [x.name, x.hits])).toEqual([['Testdaeva', 2], ['#3', 1], ['Testdaevi', 1]])
    expect(b[0]).toMatchObject({ me: true, skills: [{ skill: 1801450, name: 'Sprung', n: 2 }] })
  })

  it('a cast that hits most of the group is raid damage, unless the skill is set by hand', () => {
    const f = fight()
    for (const tgt of [1, 2, 3, 4]) addHit(f, { skill: 1801450, tgt, name: 'P' + tgt, me: false, at: 1000 + tgt * 100 })
    addHit(f, { skill: 1801450, tgt: 1, name: 'P1', me: false, at: 70_000 }) // next cast: only one hit
    expect(blame(f, atiel, {}).map(x => [x.name, x.hits])).toEqual([['P1', 1]])
    expect(blame(f, atiel, { 1801450: { kind: 'dodge' } }).map(x => x.hits)).toEqual([2, 1, 1, 1])
  })

  it('generic skills (on many bosses) are never big or a phase', () => {
    const s = atiel.skills['1000009']
    expect(s.common).toBe(true)
    expect(phaseHp(s)).toBeNull()
    expect(isBig({ ...s, cast: 5 })).toBe(false)
  })

  it('avoidable by kind, or set by hand', () => {
    const s = atiel.skills['1801540']
    expect(avoidable(s)).toBe(false)
    expect(avoidable(s, { kind: 'out' })).toBe(true)
    expect(avoidable(atiel.skills['1801450'], { kind: 'stack' })).toBe(false)
    expect(avoidable(atiel.skills['1801450'], { kind: 'stack', avoid: true })).toBe(true)
  })
})
