import { describe, expect, it } from 'vitest'
import { alarms, type AlarmMemo } from './alarm'
import { DIST_CLOSE, DIST_NEAR, TEAM_COL, classOf, urgencyOf, closePairs, cpTier, feedKills, fightOdds, fmtK, groupsOf, killCol, pvpRows, raceOfServer, serverName, wireRows, webKey, type Own, type PartyMember, type PvpKill, type PvpPlayer, type RosterMember, type WebInfo } from './logic'

// Values from captures/20261019-201703 (arena 5v5, decoded by PlayerFrames.cs).
const own: Own = { name: 'Testdaeva', srv: 2306, pc: 12, race: 2, lv: 45, il: 2592, cp: 138355 }
const pl = (ent: number, name: string, srv: number, pc: number, race: number, il: number, cp: number, x: number, z: number): PvpPlayer =>
  ({ ent, name, srv, pc, race, lv: 45, il, cp, x, z })
const arenaPlayers = [
  pl(1548, 'Maestro', 2306, 15, 2, 2567, 131827, -69.7, 4.6),
  pl(13965, 'Ley', 2303, 12, 2, 2785, 142671, -77.4, -0.6),
  pl(14018, 'Senbonzakura', 2312, 16, 2, 2165, 93474, 74.4, -3.1),
  pl(14424, 'Kanapenia', 2307, 32, 2, 2666, 144611, 70.5, 0.7),
  pl(10764, 'Miranda', 1308, 30, 1, 1595, 85849, 70.5, 3.3),
  pl(14220, 'Animuz', 2312, 7, 2, 2565, 130428, 75.6, -4.4),
  pl(1106, 'shanfen', 2304, 23, 2, 2500, 0, 69.2, 3.3),
]
const roster: RosterMember[] = [
  ['Testdaeva', 2306, 12, 1], ['Maestro', 2306, 15, 1], ['Ley', 2303, 12, 1], ['LaGuente', 2303, 12, 1], ['Hieii', 2303, 8, 1],
  ['Kanapenia', 2307, 32, 2], ['Miranda', 1308, 30, 2], ['Animuz', 2312, 7, 2], ['Senbonzakura', 2312, 16, 2], ['shanfen', 2304, 23, 2],
].map(([name, srv, pc, team]) => ({ name: name as string, srv: srv as number, pc: pc as number, race: srv === 1308 ? 1 : 2, lv: 45, team: team as number }))
const cfg = { limit: 8, all: false }
const teamCfg = { limit: 8, all: false, team: true, teamLimit: 6, self: true }
// own arena party (0x92): item level and CP also for team members out of range
const arenaParty: PartyMember[] = [
  ['Ley', 2303, 12, 2785, 142671], ['LaGuente', 2303, 12, 2805, 152349], ['Hieii', 2303, 8, 2796, 164468],
  ['Maestro', 2306, 15, 2567, 131827], ['Testdaeva', 2306, 12, 2592, 138355],
].map(([name, srv, pc, il, cp]) => ({ name: name as string, srv: srv as number, pc: pc as number, lv: 45, il: il as number, cp: cp as number }))
const none = new Map<string, WebInfo>()

describe('pvp helpers', () => {
  it('maps pcId to class and server to faction', () => {
    expect([7, 8, 12, 15, 16, 20, 23, 28, 30, 32, 36].map(classOf)).toEqual([2, 2, 3, 4, 4, 5, 6, 7, 8, 8, 9])
    expect(classOf(0)).toBe(0)
    expect([raceOfServer(1308), raceOfServer(2306), raceOfServer(0)]).toEqual([1, 2, 0])
    expect([serverName(2306), serverName(1308), serverName(2999), serverName(0)]).toEqual(['Azphel', 'Meslamtaeda', '2999', ''])
  })
  it('colours CP relative to the own CP (±10 %)', () => {
    expect(cpTier(100000, 138355)).toBe('weak')
    expect(cpTier(131827, 138355)).toBe('even')
    expect(cpTier(150000, 138355)).toBe('even')
    expect(cpTier(160000, 138355)).toBe('strong')
    expect(cpTier(0, 138355)).toBeNull()
    expect(cpTier(100000, 0)).toBeNull()
  })
})

describe('pvpRows', () => {
  it('arena: lists the other team only, strongest first (stable), with roster members not in range yet', () => {
    const r = pvpRows(arenaPlayers, roster, own, { x: -75, z: 0 }, none, cfg)
    expect(r.arena).toBe(true)
    expect(r.rows.map(x => x.name)).toEqual(['Kanapenia', 'Animuz', 'Senbonzakura', 'Miranda', 'shanfen'])
    expect(r.rows.every(x => x.team === 2)).toBe(true)
    // moving doesn't reorder the arena list
    expect(pvpRows(arenaPlayers, roster, own, { x: 75, z: 0 }, none, cfg).rows.map(x => x.name)).toEqual(r.rows.map(x => x.name))
    const k = r.rows[0]
    expect(k).toMatchObject({ cls: 8, il: 2666, cp: 144611, cpSrc: 'pkt', tier: 'even', srv: 2307 })
    expect(k.dist).toBeCloseTo(145.5, 0)
    // shanfen's spawn had no CP: website lookup requested
    expect(r.lookups).toEqual([{ name: 'shanfen', srv: 2304 }])
    expect(r.rows.find(x => x.name === 'Miranda')!.tier).toBe('weak')
  })
  it('arena with "all players": both teams except oneself, players without CP last', () => {
    const r = pvpRows(arenaPlayers, roster, own, { x: -75, z: 0 }, none, { limit: 20, all: true })
    expect(r.total).toBe(9)
    expect(r.rows.map(x => x.name)).not.toContain('Testdaeva')
    expect(r.rows.slice(-3).map(x => [x.name, x.cp])).toEqual([['Hieii', 0], ['LaGuente', 0], ['shanfen', 0]])
  })
  it('arena: players that despawned (left the match) are not listed from the roster any more', () => {
    const r = pvpRows(arenaPlayers.filter(p => p.name !== 'Miranda'), roster, own, null, none, cfg, new Set(['Miranda', 'Hieii']))
    expect(r.rows.map(x => x.name)).not.toContain('Miranda')
    expect(r.total).toBe(4)
    expect(pvpRows([], roster, own, null, none, cfg, new Set(roster.map(x => x.name))).rows).toEqual([])
  })
  it('open world / Abyss: other faction only; all players on request', () => {
    const world = [pl(1, 'Elyos1', 1306, 29, 1, 940, 40913, 10, 0), pl(2, 'Asmo1', 2306, 12, 2, 2276, 107901, 6, 0), pl(3, 'Elyos2', 1308, 9, 1, 1052, 57829, 3, 4)]
    const r = pvpRows(world, null, own, { x: 0, z: 0 }, none, cfg)
    expect(r.arena).toBe(false)
    expect(r.rows.map(x => [x.name, x.dist])).toEqual([['Elyos2', 5], ['Elyos1', 10]])
    expect(pvpRows(world, null, own, { x: 0, z: 0 }, none, { limit: 8, all: true }).rows.map(x => x.name)).toEqual(['Elyos2', 'Asmo1', 'Elyos1'])
    // own faction unknown (no 0x3336 yet): nobody counts as an enemy
    expect(pvpRows(world, null, null, null, none, cfg).rows).toEqual([])
    // own faction from the server key when the race is missing
    expect(pvpRows(world, null, { ...own, race: 0 }, null, none, cfg).rows).toHaveLength(2)
  })
  it('limits the rows and sorts by CP without a position', () => {
    const many = Array.from({ length: 12 }, (_, i) => pl(i + 1, 'E' + i, 1306, 4, 1, 2000, 100000 + i * 1000, i * 10, 0))
    const r = pvpRows(many, null, own, null, none, { limit: 5, all: false })
    expect(r.total).toBe(12)
    expect(r.rows.map(x => x.name)).toEqual(['E11', 'E10', 'E9', 'E8', 'E7'])
    expect(r.rows.every(x => x.dist === null)).toBe(true)
    expect(pvpRows(many, null, own, { x: 0, z: 0 }, none, { limit: 3, all: false }).rows.map(x => x.name)).toEqual(['E0', 'E1', 'E2'])
  })
  it('fills CP / item level from the website lookup', () => {
    const p = [pl(9, 'NoCp', 1306, 4, 1, 0, 0, 1, 1)]
    const busy = new Map<string, WebInfo>([[webKey('NoCp', 1306), { state: 'busy' }]])
    let r = pvpRows(p, null, own, null, busy, cfg)
    expect(r.rows[0].cpSrc).toBe('busy')
    expect(r.lookups).toEqual([])
    const ok = new Map<string, WebInfo>([[webKey('NoCp', 1306), { state: 'ok', cp: 170000, il: 2900 }]])
    r = pvpRows(p, null, own, null, ok, cfg)
    expect(r.rows[0]).toMatchObject({ cp: 170000, il: 2900, cpSrc: 'web', tier: 'strong' })
    const nf = new Map<string, WebInfo>([[webKey('NoCp', 1306), { state: 'none' }]])
    expect(pvpRows(p, null, own, null, nf, cfg).rows[0].cpSrc).toBe('none')
  })
})

describe('pvpRows: team section', () => {
  it('arena: own roster team incl. oneself first, enemies unchanged, CP from the arena party', () => {
    const r = pvpRows(arenaPlayers, roster, own, { x: -75, z: 0 }, none, teamCfg, new Set(), arenaParty)
    expect(r.rows.map(x => x.name)).toEqual(['Kanapenia', 'Animuz', 'Senbonzakura', 'Miranda', 'shanfen'])
    expect(r.team!.map(x => x.name)).toEqual(['Testdaeva', 'Hieii', 'LaGuente', 'Ley', 'Maestro'])
    expect(r.teamTotal).toBe(5)
    expect(r.team![0]).toMatchObject({ me: true, cls: 3, il: 2592, cp: 138355, dist: null, tier: null, team: 1 })
    expect(r.team!.find(x => x.name === 'LaGuente')).toMatchObject({ il: 2805, cp: 152349, cpSrc: 'pkt', dist: null, tier: null })
    expect(r.team!.find(x => x.name === 'Ley')!.dist).toBeCloseTo(2.5, 1)
    expect(r.team!.filter(x => x.me)).toHaveLength(1)
    // no party data: roster-only mates without CP are looked up, oneself never
    const lk = pvpRows(arenaPlayers, roster, own, null, none, teamCfg).lookups.map(x => x.name)
    expect(lk).toEqual(expect.arrayContaining(['shanfen', 'LaGuente', 'Hieii']))
    expect(lk).not.toContain('Testdaeva')
  })
  it('arena with "all players": the own team stays in its section, not among the enemies', () => {
    const r = pvpRows(arenaPlayers, roster, own, { x: -75, z: 0 }, none, { ...teamCfg, all: true, limit: 20 }, new Set(), arenaParty)
    expect(r.total).toBe(5)
    expect(r.team).toHaveLength(5)
  })
  it('team limit (arena): oneself always first, then the strongest', () => {
    const r = pvpRows(arenaPlayers, roster, own, { x: -75, z: 0 }, none, { ...teamCfg, teamLimit: 2 }, new Set(), arenaParty)
    expect(r.team!.map(x => x.name)).toEqual(['Testdaeva', 'Hieii'])
    expect(r.teamTotal).toBe(5)
    // mates that left the match are gone, oneself stays
    expect(pvpRows([], roster, own, null, none, teamCfg, new Set(roster.map(x => x.name))).team!.map(x => x.name)).toEqual(['Testdaeva'])
  })
  it('open world: own party (also out of range) is the team, same faction is not; party members are no enemies', () => {
    const world = [pl(1, 'Elyos1', 1306, 29, 1, 940, 40913, 10, 0), pl(2, 'Asmo1', 2306, 12, 2, 2276, 107901, 6, 0), pl(3, 'Maestro', 2306, 15, 2, 2567, 131827, 3, 4)]
    const duo = arenaParty.filter(m => m.name === 'Maestro' || m.name === 'Testdaeva')
    const r = pvpRows(world, null, own, { x: 0, z: 0 }, none, teamCfg, new Set(), duo)
    expect(r.rows.map(x => x.name)).toEqual(['Elyos1'])
    expect(r.team!.map(x => [x.name, x.dist])).toEqual([['Testdaeva', null], ['Maestro', 5]])
    // "all players": the same faction among the others, the party member only in the team
    expect(pvpRows(world, null, own, { x: 0, z: 0 }, none, { ...teamCfg, all: true }, new Set(), duo).rows.map(x => x.name)).toEqual(['Asmo1', 'Elyos1'])
    // no party: only oneself
    expect(pvpRows(world, null, own, null, none, teamCfg).team!.map(x => x.name)).toEqual(['Testdaeva'])
    // section off: null, own faction not listed
    expect(pvpRows(world, null, own, null, none, cfg, new Set(), duo).team).toBeNull()
  })
})

describe('wireRows', () => {
  it('formats rows for the host window', () => {
    const r = pvpRows(arenaPlayers, roster, own, { x: -75, z: 0 }, new Map([[webKey('shanfen', 2304), { state: 'busy' } as WebInfo]]), cfg)
    const w = wireRows(r.rows, own.cp, n => 'C' + n)
    // fill relative to the strongest listed CP (Kanapenia 144611 > own 138355)
    expect(w[0]).toEqual({ c: 'C8', k: 8, cc: '#f2eaa0', n: 'Kanapenia', sub: 'Ereshkigal', il: '2666', cp: '144.6K', col: '#f0c75e', bar: '#f0c75e', d: '146 m', f: 1 })
    expect(w[4]).toMatchObject({ n: 'shanfen', cp: '…', col: '#dde2ec', f: 0 })
    expect(w.find(x => x.n === 'Miranda')).toMatchObject({ sub: 'Meslamtaeda', il: '1595', col: '#7ee0a0', f: 0.594 })
    const unknown = wireRows([{ ...r.rows[0], cls: 0, il: 0, cp: 0, cpSrc: 'none', tier: null, dist: null, srv: 0 }], 0, n => 'C' + n)[0]
    expect(unknown).toMatchObject({ c: '?', k: 0, sub: '', il: '', cp: '?', d: '–', f: 0 })
  })
  it('team rows: neutral CP, blue bar, oneself marked, one bar scale for both sections', () => {
    const r = pvpRows(arenaPlayers, roster, own, { x: -75, z: 0 }, none, teamCfg, new Set(), arenaParty)
    const w = wireRows(r.team!, own.cp, n => 'C' + n, undefined, { team: true, max: 164468, meTag: 'ICH' })
    expect(w[0]).toEqual({ c: 'C3', k: 3, cc: '#a9bdd6', n: 'Testdaeva', sub: 'Azphel', il: '2592', cp: '138.4K', col: '#dde2ec', bar: TEAM_COL, d: 'ICH', f: 0.841, me: 1 })
    expect(w.find(x => x.n === 'Hieii')).toMatchObject({ k: 2, cp: '164.5K', col: '#dde2ec', bar: TEAM_COL, d: '–', f: 1 })
    expect(w.filter(x => x.me)).toHaveLength(1)
  })
  it('formats CP compactly', () => {
    expect([fmtK(950), fmtK(21600), fmtK(131827), fmtK(1250000)]).toEqual(['950', '21.6K', '131.8K', '1.25M'])
    expect(fmtK(131827, (v, d) => v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }))).toBe('131,8K')
  })
})

// Abyss (captures/20261023-011739): Ipop killed by the Elyos Boika (0x048d), greyed rows, groups, fight odds.
describe('gone, groups, odds, kills', () => {
  const me: Own = { name: 'Testdaevi', srv: 2306, pc: 16, race: 2, lv: 45, il: 1906, cp: 94000 }
  const elyos = (ent: number, name: string, cp: number, x: number, z: number, more: Partial<PvpPlayer> = {}): PvpPlayer =>
    ({ ent, name, srv: 1306, pc: 12, race: 1, lv: 45, il: 2000, cp, x, z, ...more })

  it('dead players stay greyed with the killer, after the ones around', () => {
    const ps = [elyos(1, 'Kagu', 132199, 30, 0, { gone: 2, by: 'Boika', bySrv: 1306 }), elyos(2, 'Far', 50000, 60, 0), elyos(3, 'Left', 50000, 10, 0, { gone: 1 })]
    const r = pvpRows(ps, null, me, { x: 0, z: 0 }, none, cfg)
    expect(r.rows.map(x => x.name)).toEqual(['Far', 'Left', 'Kagu'])
    const w = wireRows(r.rows, me.cp, () => 'Tem')
    expect(w[2]).toMatchObject({ n: 'Kagu', sub: '† Boika (Ariel)', d: '†', dim: 1 })
    expect(w[1]).toMatchObject({ n: 'Left', d: '10 m', dim: 1 })
    expect(w[0].dim).toBeUndefined()
  })

  it('groups players of one faction that stay close, largest first', () => {
    const ps = [elyos(1, 'A', 100000, 0, 0), elyos(2, 'B', 90000, 8, 0), elyos(3, 'C', 80000, 20, 0), elyos(4, 'D', 70000, 200, 0), elyos(5, 'E', 60000, 205, 0),
      { ...elyos(6, 'Asmo', 60000, 3, 0), race: 2 }, elyos(7, 'Gone', 60000, 1, 1, { gone: 1 })]
    const pairs = closePairs(ps)
    expect(pairs.sort()).toEqual(['1-2', '2-3', '4-5'])
    const g = groupsOf(ps, pairs)
    expect([g.get(1), g.get(2), g.get(3), g.get(4), g.get(5), g.get(6)]).toEqual([1, 1, 1, 2, 2, undefined])
    const r = pvpRows(ps.slice(0, 5), null, me, { x: 0, z: 0 }, none, cfg, new Set(), [], g)
    expect(wireRows(r.rows, me.cp, () => 'Tem')[0]).toMatchObject({ sub: 'A · Ariel', il: '2000' })
  })

  it('odds: the nearest group against the own side within 40 m', () => {
    const ps = [elyos(1, 'A', 100000, 5, 0), elyos(2, 'B', 90000, 12, 0), elyos(3, 'Far', 10000, 120, 0)]
    const g = groupsOf(ps, ['1-2'])
    const r = pvpRows(ps, null, me, { x: 0, z: 0 }, none, cfg, new Set(), [], g)
    expect(fightOdds(r.rows, null, me, false)).toMatchObject({ n: 2, cp: 190000, m: 1, ownCp: 94000, grp: 1, verdict: 'bad' })
    // alone and weaker: advantage; nobody within 40 m: none
    const one = pvpRows([elyos(1, 'A', 60000, 5, 0)], null, me, { x: 0, z: 0 }, none, cfg)
    expect(fightOdds(one.rows, null, me, false)).toMatchObject({ n: 1, grp: 0, verdict: 'good' })
    expect(fightOdds(pvpRows([elyos(3, 'Far', 10000, 120, 0)], null, me, { x: 0, z: 0 }, none, cfg).rows, null, me, false)).toBeNull()
  })

  it('kill feed: last 3 of 60 s, own faction red', () => {
    const k = (age: number, vRace: number): PvpKill => ({ age, victim: 'Ipop', vSrv: 2306, vRace, killer: 'Boika', kSrv: 1306 })
    expect(feedKills([k(1e3, 2), k(2e3, 2), k(3e3, 1), k(4e3, 2)]).length).toBe(3)
    expect(feedKills([k(61e3, 2)])).toEqual([])
    expect([killCol(k(0, 2), 2), killCol(k(0, 1), 2)]).toEqual(['#ff8a8a', '#7ee0a0'])
  })
})

describe('self in the team list, enemy alarm', () => {
  it('oneself only with "self"; the fight odds count oneself anyway', () => {
    const r = pvpRows(arenaPlayers, roster, own, { x: -75, z: 0 }, none, { ...teamCfg, self: false }, new Set(), arenaParty)
    expect(r.team!.some(x => x.me)).toBe(false)
    const withMe = pvpRows(arenaPlayers, roster, own, { x: -75, z: 0 }, none, teamCfg, new Set(), arenaParty)
    expect(fightOdds(r.rows, r.team, own, true)!.ownCp).toBe(fightOdds(withMe.rows, withMe.team, own, true)!.ownCp)
  })

  it('alarm: every enemy found, again when it comes back, close once until it moves away; none in the arena', () => {
    const row = (name: string, dist: number | null, gone?: number) => ({ key: name, name, srv: 1301, cls: 2, lv: 45, il: 0, cp: 0, cpSrc: 'unknown' as const, tier: null, dist, team: 0, ...(gone ? { gone } : {}) })
    const memo: AlarmMemo = new Map(), kinds = (rs: ReturnType<typeof row>[], t: number) => alarms(rs, false, memo, t).map(e => [e.kind, e.rows.map(r => r.name)])
    expect(kinds([row('A', 50), row('B', 150)], 0)).toEqual([['new', ['A', 'B']]]) // any distance
    expect(kinds([row('A', 45), row('B', 150)], 1000)).toEqual([]) // still there
    expect(kinds([row('A', 20), row('B', 150)], 2000)).toEqual([['close', ['A']]])
    expect(kinds([row('A', 18), row('B', 150)], 3000)).toEqual([]) // close only once
    expect(kinds([row('A', 40), row('B', 150)], 4000)).toEqual([]) // moved away (past 25 + 10)
    expect(kinds([row('A', 20), row('B', 150)], 5000)).toEqual([['close', ['A']]]) // came close again
    expect(kinds([row('A', 20, 2), row('B', 150)], 6000)).toEqual([]) // A died
    expect(kinds([row('B', 150)], 7000)).toEqual([])
    expect(kinds([row('A', 80), row('B', 150)], 10_000)).toEqual([]) // back after 4 s: flicker, no alarm
    expect(kinds([row('B', 150)], 11_000)).toEqual([])
    expect(kinds([row('A', 80), row('B', 150)], 30_000)).toEqual([['new', ['A']]]) // back after 19 s: found again
    expect(alarms([row('D', 10)], true, new Map(), 0)).toEqual([]) // arena
  })

  it('urgency and distance colours: red when close, orange within the alarm range', () => {
    const row = (dist: number | null, gone?: number) => ({ key: 'x', name: 'X', srv: 1301, cls: 2, lv: 45, il: 0, cp: 0, cpSrc: 'unknown' as const, tier: null, dist, team: 0, ...(gone ? { gone } : {}) })
    expect(urgencyOf([row(80)], false, 25, 60)).toBe(0)
    expect(urgencyOf([row(50), row(80)], false, 25, 60)).toBe(1)
    expect(urgencyOf([row(20)], false, 25, 60)).toBe(2)
    expect(urgencyOf([row(20, 2)], false, 25, 60)).toBe(0) // dead
    expect(urgencyOf([row(20)], true, 25, 60)).toBe(0) // arena
    const w = wireRows([row(20), row(50), row(80)], 0, () => 'C', undefined, { near: [25, 60] })
    expect(w.map(x => x.dc)).toEqual([DIST_CLOSE, DIST_NEAR, undefined])
  })
})

describe('dungeon panel', () => {
  it('per boss: Frenzy per mode, mechanics with a reaction first, a note', async () => {
    const { bossPanel } = await import('./dungeon')
    const p = bossPanel([{ boss: 'Ultimate Berk', enrage: [[300, 'Conquest'], [240, 'Conquest [Hard]']],
      mech: [['Wave of Fury', 6, 2.7, 'behind', 'Quickly, hide behind the rock!'], ['Bite', 1, 5, '', 'Watch out, kru!'], ['Extinction for Eternity', 8, 30, 'stagger', '']],
      notes: ['Keep stamina'], lv: [80, 80], dmg: { Magic: 3, Physic: 1 } }])
    expect(p).toHaveLength(1)
    expect(p[0].h).toBe('Ultimate Berk · Lv 80 · magisch/physisch')
    expect(p[0].tab).toBe('Bosse')
    expect(p[0].l.map(x => x.t)).toEqual([
      'Frenzy 5:00 Conquest · 4:00 Hard',
      'Extinction for Eternity · 8 s → Stagger-Skills',
      'Wave of Fury · 6 s → hinter Deckung',
      'Bite · 1 s → Watch out',
      '• Keep stamina',
    ])
    expect(bossPanel(undefined)).toEqual([])
  })

  it('runs: mode and item level, own runs per run group, kill times against Frenzy', async () => {
    const { runsPanel } = await import('./dungeon')
    const f = (id: string, label: string, run: string, start: string, duration: number, zoneId = 600004, rec = 'Testdaeva') =>
      ({ id, label, runGroupId: run, startTime: start, duration, zoneId, recorderName: rec, hasBoss: true, totalDamage: 0, playerCount: 4 })
    const fights = [
      f('a', 'Gelcos', 'r1', '2026-10-05T22:00:00Z', 60), f('b', 'Ultimate Berk', 'r1', '2026-10-05T22:08:00Z', 120), // 10:00
      f('c', 'Ultimate Berk', 'r2', '2026-10-06T22:00:00Z', 200), // 3:20, the last
      f('d', 'Ultimate Berk', 'r3', '2026-10-06T23:00:00Z', 50, 600001), // other zone
      f('e', 'Ultimate Berk', 'r4', '2026-10-06T23:30:00Z', 50, 600004, 'Other'), // someone else's recording
    ]
    const bosses = [{ boss: 'Ultimate Berk', enrage: [[300, 'Conquest'], [240, 'Conquest [Hard]']] as [number, string][], mech: [], notes: [] }]
    const p = runsPanel({ name: 'Krao Cave', type: 'dungeon', diff: 'Hard', il: 2400 }, 600004, fights, { name: 'Testdaeva', il: 2819 }, bosses)
    expect(p.map(s => s.tab)).toEqual(['Runs', 'Runs', 'Runs'])
    expect(p[0].h).toBe('Schwer · Hard')
    expect(p[0].l[0]).toEqual({ t: 'iLvl 2400 · du 2819 ✓', col: '#60d678' })
    expect(p[1].h).toBe('Deine Runs: 2')
    expect(p[1].l[0].t).toBe('Ø 6:40 · Best 3:20 · zuletzt 3:20')
    expect(p[2].l.map(x => x.t)).toEqual(['Ultimate Berk · Ø 2:40 · Best 2:00 (2×) / 4:00', 'Gelcos · Ø 1:00 · Best 1:00 (1×)'])
    expect(p[2].l[0].col).toBe('#f0c75e') // 160 s of 240: more than 60 %
    expect(runsPanel({ name: 'X', type: 'dungeon', il: 3000 }, 1, null, { name: 'Testdaeva', il: 2819 })[0].l.map(x => x.t))
      .toEqual(['iLvl 3000 · du 2819 ✗', 'Abyss-Logs-Historie wird gelesen …'])
  })

  it('loot: the current mode first, the best grades with the chance per clear', async () => {
    const { lootPanel } = await import('./dungeon')
    const p = lootPanel({ Exploration: { n: 36, top: [['Red Agate Cloak', 'Epic', 20.39]] },
      'Conquest [Hard]': { n: 2, top: [['Ariel Fragment: Krao (Bound)', 'Unique', 100], ['Artwork: Wrathful Krao', 'Heroic', 0.3]] } }, 'Hard')
    expect(p.map(s => s.h)).toEqual(['Tabelle Hard · 2 Items', 'Tabelle Erk. · 36 Items'])
    expect(p[0].tab).toBe('Loot')
    expect(p[0].l.map(x => x.t)).toEqual(['Ariel Fragment: Krao (Bound) · 100 %', 'Artwork: Wrathful Krao · 0.3 %'])
    expect(p[1].l[0].t).toBe('Red Agate Cloak · 20 %')
  })

  it('own loot: per run and over all runs, Kina apart, the same run after a short leave', async () => {
    const { G, U } = await import('@/core/state')
    const { book, trackRun, ownLootPanel, RUN_GAP } = await import('./loot')
    G.itemNames = { 1001: ['Red Agate Cloak', 'Epic'], 1002: ['Odyle', 'Common'], 1003: ['Kina', 'Common'], 1004: ['Artwork: Krao', 'Unique'] }
    U.dngLoot = {}
    const t0 = 1_000_000
    book('Krao Cave', 600001, [[1001, 1], [1002, 3], [1003, 5000]], t0)
    book('Krao Cave', 600001, [[1002, 2]], t0 + 60_000)
    trackRun('Krao Cave', 600001, t0 + RUN_GAP) // back within the gap: same run
    expect(U.dngLoot['Krao Cave'].runs).toBe(1)
    trackRun('Krao Cave', 600001, t0 + 3 * RUN_GAP) // a new run
    book('Krao Cave', 600001, [[1004, 1], [1001, 1], [1003, 7000]], t0 + 3 * RUN_GAP + 1)
    const d = U.dngLoot['Krao Cave']
    expect(d.runs).toBe(2)
    expect(d.items).toEqual({ 1001: [2, 2], 1002: [5, 1], 1004: [1, 1] })
    expect(d.kina).toBe(12000)
    const p = ownLootPanel('Krao Cave', { 'Red Agate Cloak': 20.39 })
    expect(p.map(s => s.h)).toEqual(['Dieser Run: 2 Items', 'Gesamt: 2 Runs · Ø 4.0 Items'])
    expect(p[0].l.map(x => x.t)).toEqual(['Artwork: Krao', 'Red Agate Cloak', '+7000 Kina'])
    expect(p[1].l.map(x => x.t)).toEqual(['Artwork: Krao · 1/2 Runs (50 %)', 'Red Agate Cloak · 2/2 Runs (100 %) · Tabelle 20 %', 'Odyle · 1/2 Runs (50 %)', 'Ø 6000 Kina pro Run'])
    expect(ownLootPanel('Fire Temple')[0].l[0].t).toBe('Noch nichts gelootet')
    // after leaving: the run that just ended (clear reward), not after AFTER
    const { lastRun, AFTER } = await import('./loot')
    const seen = U.dngLoot['Krao Cave'].cur.seen
    expect(lastRun(seen + AFTER - 1)).toEqual(['Krao Cave', 600001])
    expect(lastRun(seen + AFTER + 1)).toBeNull()
  })
})
