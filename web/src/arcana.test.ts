// Unit tests for the Arcana tab's data (web/public/arcana.json + daevanion.json; skipped without them).
import { describe, expect, it } from 'vitest'
import { DEF_UI, G, setU } from '@/core/state'
import { arcClass, arcSkills, guideTier, type ArcData } from '@/features/arcana/arcana'
import type { DaeData } from '@/features/daevanion/values'
import { parseArcana } from '@/features/daevanion/character'
import { advise, newCard } from '@/features/arcana/advise'

setU(structuredClone(DEF_UI))
const arc = Object.values(import.meta.glob('../public/arcana.json', { eager: true, import: 'default' }))[0] as ArcData | undefined
const dae = Object.values(import.meta.glob('../public/daevanion.json', { eager: true, import: 'default' }))[0] as DaeData | undefined

describe.skipIf(!arc || !dae)('Arcana data', () => {
  it('every class of the boards has its 22 arcana skills, the Elementalist under its game name', () => {
    G.dae = dae
    for (const cls of Object.keys(dae!.classes).filter(k => k !== '9')) {
      expect(arcClass(arc!, cls), cls).toBeTruthy()
      expect(arcSkills(arc!, cls), cls).toHaveLength(22)
    }
  })
  it('Ranger: Deadshot on the Parchment or Compass, guide core first, German names from the boards', () => {
    G.dae = dae
    const s = arcSkills(arc!, '3')
    const dead = s.find(x => x.en === 'Deadshot')!
    expect(['Parchment', 'Compass']).toContain(dead.kind)
    expect(dead.de).toBe('Zielpfeil')
    expect(dead.tier).toBe(3)
    expect(dead.chance[3]).toBeGreaterThan(dead.chalice[3])
    expect(s[0].tier).toBe(3)
    expect(s.at(-1)!.tier).toBeLessThanOrEqual(1)
    expect(guideTier('3', 'Defiance')).toBe(0)
    // passives sit on Bell / Mirror, actives on Parchment / Compass
    for (const x of s) expect(x.active ? ['Parchment', 'Compass'] : ['Bell', 'Mirror'], x.en).toContain(x.kind)
  })
})

describe.skipIf(!arc || !dae)('Arcana advice', () => {
  // a Templar Chalice as the plaync item detail gives it (shape of a real answer)
  const chalice = parseArcana({ slotPosName: 'Arcana1' }, {
    name: 'Chalice of Vigor', grade: 'Unique', enchantLevel: 4, categoryName: 'Chalice',
    subSkills: [{ name: 'Judgment', level: 2 }, { name: 'Guarding Seal', level: 3 }, { name: 'Impact Hit', level: 1 }, { name: 'Flash Rampage', level: 2 }],
    set: { id: 'Arcana_A_set_001', name: 'Primal Vigor', equippedCount: 4 },
  })!
  it('reads an arcana slot (Legend = Epic), other slots give null', () => {
    expect(chalice).toMatchObject({ kind: 'Chalice', grade: 'Unique', enchant: 4, set: { count: 4 } })
    expect(chalice.skills[0]).toEqual({ name: 'Judgment', level: 2 })
    expect(parseArcana({ slotPosName: 'Arcana2' }, { grade: 'Legend', categoryName: 'Bell' })!.grade).toBe('Epic')
    expect(parseArcana({ slotPosName: 'Helmet' }, {})).toBeNull()
  })
  it('values the cards, ranks dungeon stages and Transmute', () => {
    G.dae = dae
    setU({ ...structuredClone(DEF_UI), dae: { cls: '2' }, daeLive: { Standard: { at: 1, cls: '2', level: 45, open: {}, skills: { Judgment: 20 }, gear: { at: 1, items: [], stats: [], arcana: [chalice] } } } })
    const a = advise(arc!, '2')!
    const s = a.slots.find(x => x.kind === 'Chalice')!
    expect(s.cur).toBeGreaterThan(0) // Judgment +2
    expect(a.farm[0].gain).toBeGreaterThanOrEqual(a.farm.at(-1)!.gain)
    // higher stages drop better cards: T4 beats T1 in the same dungeon
    const deus = (st: number) => a.farm.find(f => f.dungeon === 'Deus Research Base' && f.stage === st)!.gain
    expect(deus(4)).toBeGreaterThan(deus(1))
    // picking more skills on a Transmute never makes it worse
    const tm = a.transmute.filter(x => x.kind === 'Chalice')
    expect(tm[1].mean).toBeGreaterThanOrEqual(tm[0].mean - 1e-3)
    // a Common card (1 skill) is worth less than a Unique (4)
    expect(newCard(s, a.m, 1).mean).toBeLessThan(newCard(s, a.m, 4).mean)
    setU(structuredClone(DEF_UI))
  })
})
