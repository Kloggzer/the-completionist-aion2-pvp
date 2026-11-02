// Unit tests for the Build tab: Abyss Logs fight files, plaync gear -> stats, the DPS model.
import { describe, expect, it } from 'vitest'
import { measure, parseFight } from '@/features/build/abyss'
import { parseDeity, parseItem, totals } from '@/features/build/stats'
import { calibrate, gain, marginals } from '@/features/build/model'

// ---------------------------------------------------------------- tiny protobuf writer for test files
const vint = (n: number) => { const o: number[] = []; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 128; o.push(b) } while (n); return o }
const fv = (f: number, n: number) => [...vint(f * 8), ...vint(n)]
const fb = (f: number, b: number[] | string) => { const a = typeof b === 'string' ? [...new TextEncoder().encode(b)] : b; return [...vint(f * 8 + 2), ...vint(a.length), ...a] }
const section = (type: number, body: number[]) => [type & 255, type >> 8, ...vint(body.length), ...body]

/** A dummy fight: player 7 (Templar) hits target 9; `hits` = [skill, damage, crit, double, perfect, multi-hits]. */
function file(hits: [number, number, boolean, boolean, boolean, number][]) {
  const header = [...fb(1, 'fight-1'), ...fb(2, 'Training Scarecrow'), ...fv(3, 1_000_000_000), ...fv(4, 61_000_000_000), ...fv(6, hits.reduce((s, h) => s + h[1], 0))]
  const skill = (code: number, name: string) => fb(16, [...fv(1, code), ...fb(2, [...fv(1, code), ...fb(2, name)])])
  const player = fb(1, [...fv(1, 7), ...fb(2, [...fv(1, 7), ...fb(2, 'Testdaeva'), ...fb(3, 'Templar'),
    ...fb(22, [...fv(1, 9), ...fb(2, [...fv(1, 9), ...skill(12000001, 'Pummel'), ...skill(12000002, 'Judgment')])])])])
  const evs = hits.flatMap(([sk, dmg, crit, dbl, prf, n]) => fb(1, [...fv(2, 7), ...fv(3, 9), ...fv(4, sk), ...fv(6, dmg), ...fv(7, n),
    ...(crit ? fv(9, 1) : []), ...(prf ? fv(12, 1) : []), ...(dbl ? fv(13, 1) : [])]))
  return new Uint8Array([...'ABYS'].map(c => c.charCodeAt(0)).concat([1, 0, 1, 0], vint(header.length), header, section(2, player), section(3, evs)))
}

describe('Abyss Logs fights', () => {
  // Pummel: 10 normal 1000, 10 crits 1650, 4 doubles 2000, 4 perfect 1150, 4 multi-hits 1200; Judgment always crits
  const hits: [number, number, boolean, boolean, boolean, number][] = [
    ...Array.from({ length: 10 }, () => [12000001, 1000, false, false, false, 1] as [number, number, boolean, boolean, boolean, number]),
    ...Array.from({ length: 10 }, () => [12000001, 1650, true, false, false, 1] as [number, number, boolean, boolean, boolean, number]),
    ...Array.from({ length: 4 }, () => [12000001, 2000, false, true, false, 1] as [number, number, boolean, boolean, boolean, number]),
    ...Array.from({ length: 4 }, () => [12000001, 1150, false, false, true, 1] as [number, number, boolean, boolean, boolean, number]),
    ...Array.from({ length: 4 }, () => [12000001, 1200, false, false, false, 3] as [number, number, boolean, boolean, boolean, number]),
    ...Array.from({ length: 12 }, () => [12000002, 5000, true, false, false, 1] as [number, number, boolean, boolean, boolean, number]),
  ]
  const f = parseFight(file(hits))

  it('reads header, player and hits', () => {
    expect(f.label).toBe('Training Scarecrow')
    expect(f.players).toEqual([{ id: 7, name: 'Testdaeva', cls: 'Templar', skills: new Map([[12000001, 'Pummel'], [12000002, 'Judgment']]) }])
    expect(f.hits).toHaveLength(44)
    expect(f.hits.reduce((s, h) => s + h.dmg, 0)).toBe(f.total)
  })

  it('measures rates and multipliers, leaving out skills that always crit', () => {
    const m = measure(f, 7)
    expect(m.alwaysCrit).toEqual(['Judgment'])
    expect(m.critRate).toBeCloseTo(10 / 32)
    expect(m.critMult).toBeCloseTo(1.65)
    expect(m.doubleMult).toBeCloseTo(2)
    expect(m.perfectMult).toBeCloseTo(1.15)
    expect(m.multiMult).toBeCloseTo(1.2)
    expect(m.dps).toBeCloseTo(f.total / 60)
  })
})

describe('plaync gear -> stats', () => {
  const mace = parseItem({ slotPosName: 'MainHand', slotPos: 1, enchantLevel: 5 }, {
    id: 110730048, name: 'Spiritforged Mace', grade: 'Unique', categoryName: 'Mace',
    mainStats: [{ id: 'WeaponFixingDamage', name: 'Attack', minValue: '160', value: '206', extra: '25' }, { id: 'Critical', name: 'Critical Hit', value: '50', extra: '0' }],
    subStats: [{ id: 'STR', name: 'Might', value: '15' }, { id: 'MPMax', name: 'MP', value: '57' }],
    magicStoneStat: [{ id: 'WeaponFixingDamage', name: 'Attack', value: '+3' }],
  })
  it('reads lines with the model keys (weapon attack = middle of its range)', () => {
    expect(mace.main[0]).toMatchObject({ key: 'atk', value: 183, extra: 25 })
    expect(mace.sub.map(l => l.key)).toEqual(['might', null])
    expect(mace.stones[0]).toMatchObject({ key: 'atk', value: 3 })
  })
  it('reads deity lines and sums all sources', () => {
    const deity = parseDeity({ stat: { statList: [
      { type: 'STR', name: 'Might', value: 25, statSecondList: ['Attack increase +2.5%'] },
      { type: 'Time', name: 'Time [Siel]', value: 41, statSecondList: ['Combat Speed +4.1%', 'Double Resist +4.1%'] },
      { type: 'Illusion', name: 'Illusion', value: 7, statSecondList: ['Cooldown -0.7%'] },
    ] } })
    expect(deity.map(l => [l.key, l.value])).toEqual([['might', 25], ['speed', 4.1], ['cdr', 0.7]])
    const t = totals({ at: 1, items: [mace], deity }, [['Combat Speed', 3], ['Critical Hit', 50]])
    expect(t.all).toMatchObject({ atk: 186, crit: 100, might: 40, speed: 7.1, cdr: 0.7 })
    expect(t.by.dae.speed).toBe(3)
  })
})

describe('DPS model', () => {
  const t = { atk: 3000, crit: 900, critDmg: 15, dmg: 20, speed: 20 }
  const m = { fight: 'f', at: 0, seconds: 100, dps: 1, hits: 500, critRate: 0.5, critMult: 1.65, alwaysCrit: [], doubleRate: 0.13, doubleMult: 2, perfectRate: 0.1, perfectMult: 1.15, multiRate: 0.3, multiMult: 1.15 }

  it('crit at the cap is worth nothing, crit damage and Double are', () => {
    const s = calibrate(t, m), mg = marginals(s)
    expect(mg.crit).toBeLessThan(0.01)
    expect(mg.critDmg).toBeCloseTo(0.5 / (1 + 0.5 * 0.65), 2) // +1 % crit damage on 50 % crits
    expect(mg.double).toBeCloseTo(100 / (100 + 13), 0) // one more Double in 100 hits
    expect(mg.speed).toBeCloseTo(100 / 120, 2)
  })

  it('crit below the cap: the fight implies the conversion', () => {
    const s = calibrate(t, { ...m, critRate: 0.3 })
    expect(s.critK).toBeCloseTo(900 / 30)
    expect(calibrate({ ...t, crit: 50 }, { ...m, critRate: 0.3 }).critK).toBe(25) // too little crit counted: the assumption
    expect(gain(s, { crit: 30 })).toBeGreaterThan(0.5) // +30 crit = +1 % crit rate
  })

  it('without a fight the assumptions apply', () => {
    const s = calibrate(t, null)
    expect(s.measured).toEqual({})
    expect(s.critMult).toBeCloseTo(1.65)
  })
})
