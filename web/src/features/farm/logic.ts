// Farm tab: where to farm one resource on the current map – gathering nodes (gather.json) or monster drops
// (drops.json, chance per kill from the Global client) – as ranked hotspots, each with a loop route through its
// points. Several hotspots far enough apart, so you can switch when bots or other gatherers occupy one.
import { G, U, V, bump, type Any } from '@/core/state'
import { emit } from '@/core/bus'
import { getJson, mapBase, zoneAt, nearestZone } from '@/core/data'
import { mobOk } from '@/features/pets/logic'

/** One point of a route: position, expected items per visit, and what it is (node name or mob). */
export type Pt = { x: number; z: number; w: number; label: string }
export type Hotspot = {
  rank: number; x: number; z: number; name: string
  route: Pt[]; len: number; secs: number; perRound: number; per10: number; rel: number
}

// Assumptions behind the ranking (explained in the tab): travel speed on the route, time per node / kill, and a
// minimum round time – nodes and mobs need a while to respawn, so a tiny loop can't be farmed faster than that.
export const PARAMS = {
  gather: { radius: 220, speed: 10, act: 4 },
  drop: { radius: 160, speed: 7, act: 12 },
  minRound: 180,
  maxStops: 45,
  maxSpots: 6,
}

// ---------------------------------------------------------------- data

/** gather.json + drops.json of a map, loaded once (both optional; null when the source lacks them). */
export async function farmData(key: string): Promise<Any> {
  G.farm ??= {}
  if (G.farm[key]) return G.farm[key]
  const get = (f: string) => getJson(mapBase(key) + f).catch(() => null)
  const [gather, drops] = await Promise.all([get('gather.json'), get('drops.json')])
  return G.farm[key] = { gather, drops }
}

/** Resources on a map: gathering node types and monster-dropped crafting materials (item ids 6xxxxxxxx). */
export function resources(m: Any, fd: Any): Any[] {
  const out: Any[] = []
  const types: Any[] = fd?.gather?.types || [], nodeOf = fd?.gather?.node_of || {}
  const perType = new Map<number, number>()
  for (const o of m.gather) { const ti = nodeOf[o.i]; if (ti != null) perType.set(ti, (perType.get(ti) || 0) + 1) }
  types.forEach((tp, ti) => {
    if (!perType.get(ti)) return
    out.push({ key: 'g:' + tp.n, kind: 'gather', name: tp.n, ti, nodes: perType.get(ti), mats: tp.mats.map((x: Any) => x.n),
      air: tp.terrain === 'Air', counts: tp.counts || [1] })
  })
  const items = new Map<string, Any>()
  for (const [npc, v] of Object.entries<Any>(fd?.drops?.npc || {})) {
    const spawns = m.byId.get(+npc)?.length || 0, mob = m.species[npc]
    if (!spawns || !mob) continue
    for (const [iid, p, qty] of v.d || []) {
      const id = String(iid)
      if (!id.startsWith('6') || p >= 1 || !m.itemNames[id]) continue // materials only; 100 % rows are quest items
      let it = items.get(id)
      if (!it) items.set(id, it = { key: 'd:' + id, kind: 'drop', name: m.itemNames[id], id, mobs: [] })
      it.mobs.push({ id: +npc, n: mob.n, lv: mob.lv, named: mob.named || mob.r !== 'Normal', p, qty: qty || 1, spawns, mob })
    }
  }
  for (const it of items.values()) {
    it.best = Math.max(...it.mobs.map((x: Any) => x.p))
    it.spawns = it.mobs.reduce((s: number, x: Any) => s + x.spawns, 0)
    out.push(it)
  }
  return out.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'gather' ? -1 : 1))
}

/** Points of a resource with the expected items per visit / kill. Mobs follow the level / named filters. */
export function points(m: Any, fd: Any, res: Any): Pt[] {
  if (res.kind === 'gather') {
    const nodeOf = fd.gather.node_of, avg = (res.counts[0] + res.counts[res.counts.length - 1]) / 2
    return m.gather.filter((o: Any) => nodeOf[o.i] === res.ti).map((o: Any) => ({ x: o.x, z: o.z, w: avg, label: o.n }))
  }
  const out: Pt[] = []
  for (const mb of res.mobs) {
    if (!mobOk(mb.mob)) continue
    for (const i of m.byId.get(mb.id) || []) out.push({ x: m.xs[i], z: m.zs[i], w: mb.p * mb.qty, label: mb.n })
  }
  return out
}

// ---------------------------------------------------------------- routes

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.z - b.z)
export const loopLen = (r: Pt[]) => r.reduce((s, p, i) => s + dist(p, r[(i + 1) % r.length]), 0) * (r.length > 1 ? 1 : 0)

/** Closed loop through the points: nearest neighbour from the westernmost point, then 2-opt until no gain. */
export function route(pts: Pt[]): Pt[] {
  if (pts.length < 3) return [...pts]
  const left = [...pts], r: Pt[] = []
  let cur = left.reduce((a, b) => (b.x < a.x ? b : a))
  left.splice(left.indexOf(cur), 1); r.push(cur)
  while (left.length) {
    let bi = 0, bd = Infinity
    for (let i = 0; i < left.length; i++) { const d = dist(cur, left[i]); if (d < bd) { bd = d; bi = i } }
    cur = left.splice(bi, 1)[0]; r.push(cur)
  }
  for (let improved = true, guard = 0; improved && guard < 50; guard++) {
    improved = false
    for (let i = 0; i < r.length - 1; i++) for (let k = i + 2; k < r.length; k++) {
      const a = r[i], b = r[i + 1], c = r[k], d = r[(k + 1) % r.length]
      if (a === d) continue
      if (dist(a, c) + dist(b, d) < dist(a, b) + dist(c, d) - 0.01) { r.splice(i + 1, k - i, ...r.slice(i + 1, k + 1).reverse()); improved = true }
    }
  }
  return r
}

// ---------------------------------------------------------------- hotspots

/** Ranked, non-overlapping hotspots: points within `radius` of a centre, a loop route through them, and the
 *  expected items per 10 minutes (route time = travel + time per stop, at least PARAMS.minRound). */
export function hotspots(pts: Pt[], kind: 'gather' | 'drop', zoneName: (x: number, z: number) => string = () => ''): Hotspot[] {
  if (!pts.length) return []
  const P = PARAMS[kind], R = P.radius, C = R / 2
  const key = (a: number, b: number) => a * 100003 + b
  const hash = new Map<number, Pt[]>()
  for (const p of pts) { const h = key(Math.floor(p.x / R), Math.floor(p.z / R)); let a = hash.get(h); if (!a) hash.set(h, a = []); a.push(p) }
  const near = (x: number, z: number) => {
    const out: Pt[] = [], gx = Math.floor(x / R), gz = Math.floor(z / R)
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++)
      for (const p of hash.get(key(gx + dx, gz + dz)) || []) if ((p.x - x) ** 2 + (p.z - z) ** 2 <= R * R) out.push(p)
    return out
  }
  // Candidates: centroids of small cells, re-centred on the points around them; cheapest first pass by item sum.
  const cells = new Map<number, number[]>()
  for (const p of pts) { const h = key(Math.floor(p.x / C), Math.floor(p.z / C)); let c = cells.get(h); if (!c) cells.set(h, c = [0, 0, 0]); c[0] += p.x; c[1] += p.z; c[2]++ }
  const cand = [...cells.values()].map(([sx, sz, n]) => {
    const ps = near(sx / n, sz / n)
    const x = ps.reduce((s, p) => s + p.x, 0) / ps.length, z = ps.reduce((s, p) => s + p.z, 0) / ps.length
    return { x, z, ps: near(x, z) }
  }).filter(c => c.ps.length).map(c => ({ ...c, sum: c.ps.reduce((s, p) => s + p.w, 0) })).sort((a, b) => b.sum - a.sum).slice(0, 60)
  // Full scoring (route) for the strongest candidates only.
  const scored = cand.map(c => {
    const max = PARAMS.maxStops
    const stops = c.ps.length > max ? [...c.ps].sort((a, b) => dist(a, c as Any) - dist(b, c as Any)).slice(0, max) : c.ps
    const r = route(stops), len = loopLen(r), perRound = stops.reduce((s, p) => s + p.w, 0)
    const secs = Math.max(PARAMS.minRound, len / P.speed + stops.length * P.act)
    return { x: c.x, z: c.z, route: r, len, secs, perRound, per10: perRound / secs * 600 }
  }).sort((a, b) => b.per10 - a.per10)
  const out: Hotspot[] = []
  for (const s of scored) {
    if (out.length >= PARAMS.maxSpots) break
    // far enough apart that the alternatives don't share nodes / mobs with the occupied spot
    if (out.some(o => Math.hypot(o.x - s.x, o.z - s.z) < R * 2)) continue
    out.push({ ...s, rank: out.length + 1, name: zoneName(s.x, s.z), rel: 0 })
  }
  const top = out[0]?.per10 || 1
  for (const h of out) h.rel = h.per10 / top
  return out
}

// ---------------------------------------------------------------- state

export function selectSpot(rank: number | null) { V.farmSpot = rank; emit('fit'); bump() }

/** Next hotspot (wraps around): for when the current one is taken. */
export function switchSpot() {
  const n = V.farmSpots.length
  if (!n) return
  const i = V.farmSpots.findIndex((s: Hotspot) => s.rank === V.farmSpot)
  selectSpot(V.farmSpots[(i + 1) % n].rank)
}

/** Recompute the farm view for the current map and the chosen resource (V.farm*). */
export async function recomputeFarm() {
  const m = G.md[U.map]
  if (!m) return
  const key = U.map, fd = await farmData(key)
  if (U.map !== key) return
  V.farmRes = resources(m, fd)
  const res = V.farmRes.find((r: Any) => r.key === U.farmRes) || null
  V.farmCur = res
  V.farmPts = res ? points(m, fd, res) : []
  V.farmSpots = res ? hotspots(V.farmPts, res.kind, (x, z) => zoneAt(m, x, z) || nearestZone(m, x, z)) : []
  if (V.farmSpot && !V.farmSpots.some((s: Hotspot) => s.rank === V.farmSpot)) V.farmSpot = null
  bump()
}
