import { describe, expect, it } from 'vitest'
import { hotspots, loopLen, route, type Pt } from './logic'

const pt = (x: number, z: number, w = 1): Pt => ({ x, z, w, label: '' })

describe('route', () => {
  it('visits every point once', () => {
    const pts = [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100), pt(50, 50)]
    const r = route(pts)
    expect(r).toHaveLength(pts.length)
    expect(new Set(r)).toEqual(new Set(pts))
  })

  it('untangles a crossing loop (2-opt)', () => {
    // square corners in a crossing order: the best loop is the perimeter, 400 m
    const r = route([pt(0, 0), pt(100, 100), pt(100, 0), pt(0, 100)])
    expect(loopLen(r)).toBeCloseTo(400, 0)
  })
})

describe('hotspots', () => {
  // two dense clusters 1 km apart and a single far node
  const cluster = (cx: number, cz: number, n: number) => Array.from({ length: n }, (_, i) => pt(cx + (i % 5) * 20, cz + Math.floor(i / 5) * 20))
  const pts = [...cluster(0, 0, 20), ...cluster(1000, 0, 10), pt(-2500, 2500)]

  it('ranks the denser cluster first and keeps alternatives apart', () => {
    const hs = hotspots(pts, 'gather')
    expect(hs.length).toBeGreaterThanOrEqual(2)
    expect(hs[0].route.length).toBe(20)
    expect(hs[0].rel).toBe(1)
    for (let i = 0; i < hs.length; i++) for (let k = i + 1; k < hs.length; k++)
      expect(Math.hypot(hs[i].x - hs[k].x, hs[i].z - hs[k].z)).toBeGreaterThanOrEqual(440)
  })

  it('rates a single node by the minimum round time, not its tiny loop', () => {
    const lone = hotspots([pt(0, 0, 2)], 'gather')[0]
    expect(lone.secs).toBe(180)
    expect(lone.per10).toBeCloseTo(2 / 180 * 600, 5)
  })

  it('is empty without points', () => {
    expect(hotspots([], 'drop')).toEqual([])
  })
})
