// Unit tests for the Arcana tab's data (web/public/arcana.json + daevanion.json; skipped without them).
import { describe, expect, it } from 'vitest'
import { DEF_UI, G, setU } from '@/core/state'
import { arcClass, arcSkills, guideTier, type ArcData } from '@/features/arcana/arcana'
import type { DaeData } from '@/features/daevanion/values'

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
