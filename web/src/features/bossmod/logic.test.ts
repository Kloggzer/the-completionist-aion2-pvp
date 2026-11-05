import { describe, expect, it } from 'vitest'
import data from '../../../public/bossmods.json'
import { WARN, addCast, alertOn, dueWarnings, endCast, isBig, npcIds, predictable, upcoming, warnLead, type BossMods, type Fight } from './logic'

// Atiel (Deus Research Base, 2343601): 3 fights in captures/20261027-170912 (tools/boss_timeline.py).
const mods = data as unknown as BossMods
const atiel = mods.bosses['2343601']
const fight = (): Fight => ({ npc: 2343601, ent: 38334, pull: 0, casts: [], warned: new Set() })

describe('boss mod timelines', () => {
  it('has the captured dungeon bosses', () => {
    expect(atiel.name).toBe('Atiel')
    expect(npcIds(mods)).toEqual(expect.arrayContaining([2343601, 2343615, 2343616, 2353707, 2353708, 2353709]))
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
    expect(dueWarnings(f, atiel, { 1801450: { name: 'Sprung' } }, next.at - 1000)).toEqual([]) // already warned
  })

  it('named skills show their name', () => {
    const f = fight()
    addCast(f, 1801450, 0)
    expect(upcoming(f, atiel, { 1801450: { name: 'Sprung' } }).find(n => n.skill === 1801450)?.name).toBe('Sprung')
  })
})
