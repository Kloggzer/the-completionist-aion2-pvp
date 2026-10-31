// Mini radar payload: spawns within range relative to the player, nearest first, live cubes, nearest needed spawn.
import { describe, expect, it } from 'vitest'
import { nextRange, radarContent } from './radarContent'

// Map data like G.md[...]: spawn coordinates xs/zs, byId = mob id -> spawn indices.
const md = { xs: [110, 300, 100, 95, 1000], zs: [100, 100, 160, 100, 1000], byId: new Map([[1, [0, 1]], [2, [2, 3]], [3, [4]]]) }
const targets = [
  { col: '#5fd0e0', done: false, mobs: [{ id: 1, r: 'Normal' }] },
  { col: '#f0a050', done: false, mobs: [{ id: 2, named: true }] },
  { col: '#b48cff', done: true, mobs: [{ id: 3, r: 'Normal' }] },
]

describe('radarContent', () => {
  const pos = { x: 100, z: 100 }
  it('keeps needed spawns within range, relative, nearest first, named flagged', () => {
    const r = radarContent(md, targets, pos, 100)
    expect(r.dots).toEqual([[-5, 0, '#f0a050', 1], [10, 0, '#5fd0e0', 0], [0, 60, '#f0a050', 1]])
    expect(r.nearest).toEqual([-5, 0])
  })
  it('skips pets already done', () => {
    const r = radarContent(md, targets, { x: 1000, z: 1000 }, 50)
    expect(r.dots).toEqual([])
    expect(r.nearest).not.toBeNull() // the nearest needed spawn may lie outside the range (line to the rim)
  })
  it('adds live cubes within range only', () => {
    const r = radarContent(md, targets, pos, 100, [{ x: 140, z: 70 }, { x: 900, z: 900 }])
    expect(r.cubes).toEqual([[40, -30]])
  })
  it('range steps: 10 m up to 100, 25 m above, 30-300', () => {
    expect(nextRange(100, 1)).toBe(125)
    expect(nextRange(100, -1)).toBe(90)
    expect(nextRange(125, -1)).toBe(100)
    expect(nextRange(30, -1)).toBe(30)
    expect(nextRange(300, 1)).toBe(300)
    expect(nextRange(90, 1)).toBe(100)
  })
  it('no targets: no dots, no nearest', () => {
    expect(radarContent(md, [], pos, 250)).toEqual({ dots: [], cubes: [], nearest: null })
  })
})
