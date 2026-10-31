// Map canvas, radar, player position and zone/instance handling.
// The painting stays imperative: MapView hands over its canvas (attachCanvas), everything else works on module state.
import { G, S, U, V, saveUi, bump, selIds, type Any } from '@/core/state'
import { host, onHost } from '@/core/host'
import { emit } from '@/core/bus'
import { selectMap, showMapMsg } from '@/core/data'
import { posAge, dirTo } from '@/core/geo'
import { t } from '@/core/i18n'
import { CANVAS_ICONS } from './canvasIcons'
import { ext as plugins } from '@/core/ext'

import { R } from '@/features/pets/logic'
import { PARAMS as FARM } from '@/features/farm/logic'
const NEAR_R = 600 // m – "In der Nähe" in the target list

V.follow ??= true

// ---------------------------------------------------------------- map canvas

let cv: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D = null as Any
export const view = { cx: 0, cz: 0, s: 0.05, w: 1, h: 1 }

export function attachCanvas(c: HTMLCanvasElement | null) {
  cv = c
  if (c) { ctx = c.getContext('2d')!; sizeCanvas() }
}

export function sizeCanvas() {
  if (!cv) return
  const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1
  if (!r.width || !r.height) return // section hidden (list-only view)
  view.w = r.width; view.h = r.height
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  if (fitPending) fit()
  draw()
}

const sx = (x: number) => (x - view.cx) * view.s + view.w / 2, sz = (z: number) => (z - view.cz) * view.s + view.h / 2
const wx = (px: number) => (px - view.w / 2) / view.s + view.cx, wz = (py: number) => (py - view.h / 2) / view.s + view.cz

function selection(): number[][] | null {
  const m = G.md[U.map]
  if (!m) return null
  if (U.tab === 'farm') {
    const s = V.farmSpots.find((x: Any) => x.rank === V.farmSpot)
    const pts = (s ? s.route : V.farmPts).map((p: Any) => [p.x, p.z])
    if (pts.length) return pts
  }
  if (V.spot) { const s = V.spots.find((x: Any) => x.rank === V.spot); if (s) return [[s.x - R * 2.2, s.z - R * 2.2], [s.x + R * 2.2, s.z + R * 2.2]] }
  if (V.cube) { const c = m.cubes.find((x: Any) => x.key === V.cube); if (c) return c.pts }
  const ids = selIds(), ts = ids.size ? V.targets.filter((x: Any) => ids.has(x.p.id)) : V.targets.filter((x: Any) => !x.done)
  const pts: number[][] = []
  for (const tg of ts) for (const mob of tg.mobs) for (const i of m.byId.get(+mob.id) || []) pts.push([m.xs[i], m.zs[i]])
  if (!pts.length) for (let i = 0; i < m.xs.length; i += 7) pts.push([m.xs[i], m.zs[i]])
  return pts
}

let fitPending = false // fit() while the canvas had no size (list-only view): redo once it has one
export function fit() {
  fitPending = view.w <= 1
  if (U.radar && S.pos && !selIds().size && !V.spot && !V.cube && !(U.tab === 'farm' && V.farmSpot)) { V.follow = V.radarView = true; view.cx = S.pos.x; view.cz = S.pos.z; view.s = U.radarS; draw(); return }
  if (U.radar && S.pos) V.follow = false
  const pts = selection()
  if (!pts?.length || view.w <= 1) return
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9
  for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z) }
  const pad = 80
  view.cx = (x0 + x1) / 2; view.cz = (z0 + z1) / 2
  view.s = Math.min(1.2, Math.min(view.w / (x1 - x0 + pad * 2), view.h / (z1 - z0 + pad * 2)))
  draw()
}

// Lucide icons on the canvas: the SVG elements of CANVAS_ICONS[name] as one Path2D (24x24 units), cached.
const ICON_PATHS: Record<string, Path2D> = {}
function iconPath(name: string) {
  if (ICON_PATHS[name]) return ICON_PATHS[name]
  const p = new Path2D(), src = CANVAS_ICONS[name] || ''
  for (const [, d] of src.matchAll(/<path d="([^"]+)"/g)) p.addPath(new Path2D(d))
  for (const [, cx, cy, r] of src.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)) { const c = new Path2D(); c.arc(+cx, +cy, +r, 0, 7); p.addPath(c) }
  return ICON_PATHS[name] = p
}
// Icon centred at (x, y), `size` px, coloured stroke on a dark disc for contrast on the relief.
function drawIcon(name: string, x: number, y: number, size: number, color: string, disc = true) {
  ctx.save()
  if (disc) { ctx.fillStyle = '#0b1220cc'; ctx.beginPath(); ctx.arc(x, y, size * 0.62, 0, 7); ctx.fill() }
  ctx.translate(x - size / 2, y - size / 2); ctx.scale(size / 24, size / 24)
  ctx.lineWidth = disc ? 2.4 : 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = color; ctx.stroke(iconPath(name))
  ctx.restore()
}

let raf = 0, again = false
export function draw() {
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; again = false; paint(); if (again) setTimeout(draw, 50) })
}

function paint() {
  if (!cv || !ctx || view.w <= 1) return
  const m = G.md[U.map]
  ctx.clearRect(0, 0, view.w, view.h)
  if (!m) return
  const g = m.grid, ext = g.extent_m, x0 = g.x0
  // background: the coloured map (Kartenstil "Karte") once loaded, else the relief / instance art; around it its sea colour
  const art = U.mapStyle !== 'relief' && m.art, bg = art || m.relief
  ctx.fillStyle = (art && m.artBg) || '#1a3248'; ctx.fillRect(0, 0, view.w, view.h)
  if (S.instance) return // no map for instances: only the hint text
  if (bg) { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bg, sx(x0), sz(x0), ext * view.s, ext * view.s) }

  const ids = selIds(), dim = ids.size || V.spot || V.cube, farm = U.tab === 'farm'
  // Spawns of needed mobs.
  if (U.layers.spawns && !farm) {
    const r = Math.max(1.6, Math.min(4, view.s * 4))
    const shown = V.targets.filter((x: Any) => !x.done) // every pet still needed (filters: toolbar / settings)
    for (const tg of ids.size ? V.targets.filter((x: Any) => ids.has(x.p.id)) : shown) {
      const on = !dim || ids.has(tg.p.id)
      if (ids.size && !on) continue
      ctx.fillStyle = tg.col; ctx.globalAlpha = on ? (V.spot || V.cube ? 0.55 : 0.95) : 0.3
      for (const mob of tg.mobs) {
        const named = mob.named || mob.r !== 'Normal'
        for (const i of m.byId.get(+mob.id) || []) {
          const x = sx(m.xs[i]), y = sz(m.zs[i])
          if (x < -5 || y < -5 || x > view.w + 5 || y > view.h + 5) continue
          if (view.s >= 0.45) drawIcon('skull', x, y, named ? 16 : 12, tg.col) // street level: skulls in the pet's colour
          else if (named) { ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4); ctx.fillRect(-r * 1.4, -r * 1.4, r * 2.8, r * 2.8); ctx.restore() }
          else { ctx.beginPath(); ctx.arc(x, y, ids.size ? r * 1.3 : r, 0, 7); ctx.fill() }
        }
      }
    }
    ctx.globalAlpha = 1
  }

  // Area labels.
  if (U.layers.labels) {
    ctx.font = '600 11px "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.lineWidth = 3; ctx.strokeStyle = '#0a0d14cc'
    const placed: number[][] = []
    for (const z of [...m.zones].sort((a: Any, b: Any) => b.area - a.area)) {
      const wpx = (z.bb[1] - z.bb[0]) * view.s, tw = ctx.measureText(z.n).width
      if (wpx < tw * 0.9) continue
      const x = sx(z.c[0]), y = sz(z.c[1])
      if (x < 0 || y < 0 || x > view.w || y > view.h) continue
      if (placed.some(p => Math.abs(p[0] - x) < (p[2] + tw) / 2 + 4 && Math.abs(p[1] - y) < 14)) continue
      placed.push([x, y, tw])
      ctx.fillStyle = '#e9edf5'; ctx.strokeText(z.n, x, y); ctx.fillText(z.n, x, y)
    }
  }

  // Farm spots.
  if ((U.layers.spots || V.spot) && !farm) {
    for (const s of V.spots) {
      if (V.spot && V.spot !== s.rank) continue
      const x = sx(s.x), y = sz(s.z), rr = Math.max(9, R * view.s)
      const on = !ids.size || s.pets.some((p: Any) => ids.has(p.t.p.id))
      ctx.globalAlpha = on ? 1 : 0.35
      ctx.lineWidth = V.spot === s.rank ? 2.5 : 1.6; ctx.strokeStyle = '#e8c872'; ctx.fillStyle = '#e8c87218'
      ctx.beginPath(); ctx.arc(x, y, rr, 0, 7); ctx.fill(); ctx.stroke()
      ctx.fillStyle = '#e8c872'; ctx.beginPath(); ctx.arc(x, y - rr, 8, 0, 7); ctx.fill()
      ctx.fillStyle = '#1b1607'; ctx.font = '700 10px "Segoe UI"'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(s.rank, x, y - rr + 0.5)
    }
    ctx.globalAlpha = 1
  }
  // Hidden cubes. Candidate spots: Lucide cube icon at every zoom level (smaller when zoomed out); not in the radar
  // (there only a cube reported live by a local module matters).
  if (U.layers.cubes || V.cube || V.live.size) {
    const near = view.s >= 0.35, live = new Map<string, Any>([...V.live.values()].map((l: Any) => [l.c.key, l]))
    if (!U.radar || U.radarCubes || V.cube)
      for (const c of m.cubes) {
        if (V.cube && V.cube !== c.key) continue
        if (!U.layers.cubes && !V.cube) break
        const known = live.has(c.key) // real spot known: the other candidates fade out
        for (const [x, z] of c.pts) {
          const px = sx(x), py = sz(z)
          if (px < -10 || py < -10 || px > view.w + 10 || py > view.h + 10) continue
          // Zoomed out a whole map has hundreds of spots: small, translucent and without the dark disc.
          const far = !near && !V.cube
          ctx.globalAlpha = known ? 0.3 : far ? 0.6 : 1
          drawIcon('box', px, py, V.cube ? 18 : near ? 15 : Math.max(6, Math.min(9, view.s * 40)), '#d9a8ff', !far)
          ctx.globalAlpha = 1
        }
      }
  }
  if (farm) paintFarm()
  // Layers of optional local modules (src/private).
  for (const f of plugins.paint) if (f(ctx, { sx, sz, view, drawIcon })) again = true
  if (S.pos) paintPlayer()
}

// ---------------------------------------------------------------- farm tab
const farmR = () => FARM[V.farmCur?.kind === 'drop' ? 'drop' : 'gather'].radius

// Points of the chosen resource, hotspot circles with their rank and, for the selected hotspot, its numbered loop.
function paintFarm() {
  const sel = V.farmSpots.find((s: Any) => s.rank === V.farmSpot), col = V.farmCur?.kind === 'drop' ? '#ff7a8a' : '#74d68a'
  const r = Math.max(1.8, Math.min(4, view.s * 4))
  ctx.fillStyle = col; ctx.globalAlpha = sel ? 0.35 : 0.9
  for (const p of V.farmPts) {
    const x = sx(p.x), y = sz(p.z)
    if (x < -5 || y < -5 || x > view.w + 5 || y > view.h + 5) continue
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill()
  }
  ctx.globalAlpha = 1
  if (sel && sel.route.length > 1) {
    ctx.strokeStyle = '#e8c872'; ctx.lineWidth = 2; ctx.setLineDash([6, 4])
    ctx.beginPath()
    sel.route.forEach((p: Any, i: number) => (i ? ctx.lineTo(sx(p.x), sz(p.z)) : ctx.moveTo(sx(p.x), sz(p.z))))
    ctx.closePath(); ctx.stroke(); ctx.setLineDash([])
    const big = view.s >= 0.3
    ctx.font = '700 9.5px "Segoe UI"'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    sel.route.forEach((p: Any, i: number) => {
      const x = sx(p.x), y = sz(p.z)
      ctx.fillStyle = i === 0 ? '#5fd0e0' : col; ctx.strokeStyle = '#0b1220'; ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.arc(x, y, big ? 8 : 4, 0, 7); ctx.fill(); ctx.stroke()
      if (big) { ctx.fillStyle = '#0b1220'; ctx.fillText(String(i + 1), x, y + 0.5) }
    })
  }
  for (const s of V.farmSpots) {
    if (sel && sel !== s) continue
    const x = sx(s.x), y = sz(s.z), rr = Math.max(9, farmR() * view.s)
    ctx.lineWidth = sel ? 2.5 : 1.6; ctx.strokeStyle = '#e8c872'; ctx.fillStyle = sel ? '#e8c87208' : '#e8c87218'
    ctx.beginPath(); ctx.arc(x, y, rr, 0, 7); ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#e8c872'; ctx.beginPath(); ctx.arc(x, y - rr, 8, 0, 7); ctx.fill()
    ctx.fillStyle = '#1b1607'; ctx.font = '700 10px "Segoe UI"'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(s.rank), x, y - rr + 0.5)
  }
}

// ---------------------------------------------------------------- radar

export function onPos(p: Any, quiet?: boolean) {
  const now = Date.now()
  // A spawn-centroid estimate (±20-30 m) is worse than dead reckoning from a fresh real fix.
  if (p.est && now - V.realAt < 20000) return
  if (!p.est && !quiet) {
    if (V.realPos) {
      const dt = (now - V.realAt) / 1000
      if (dt > 0.3 && dt < 15) {
        const vx = (p.x - V.realPos.x) / dt, vz = (p.z - V.realPos.z) / dt, sp = Math.hypot(vx, vz)
        V.vel = sp > 0.5 && sp < 45 ? { vx, vz } : null
      }
    }
    V.realPos = { x: p.x, z: p.z }; V.realAt = now
  }
  if (S.pos && !quiet) {
    const dx = p.x - S.pos.x, dz = p.z - S.pos.z
    if (dx * dx + dz * dz > 9) V.heading = Math.atan2(dz, dx)
  }
  S.pos = p
  posMoved(true)
}

// Out of combat the server reports the own position only every ~4-10 s (0x2a38). In between the marker keeps
// moving with the last measured velocity (dead reckoning, max 8 s), so walking and flying look continuous.
setInterval(() => {
  if (!V.vel || !V.realPos || !S.pos) return
  const age = (Date.now() - V.realAt) / 1000
  if (age < 0.4 || age > 10) return
  S.pos = Object.assign({}, S.pos, { x: V.realPos.x + V.vel.vx * age, z: V.realPos.z + V.vel.vz * age, est: true })
  V.heading = Math.atan2(V.vel.vz, V.vel.vx)
  posMoved(false)
}, 200)

let listAt = 0
function posMoved(full: boolean) {
  const p = S.pos
  if (S.instance) return
  if (U.radar && !V.follow && Date.now() - (V.panAt || 0) > 6000 && !selIds().size && !V.spot && !V.cube) V.follow = true
  if (U.radar && V.follow) { view.cx = p.x; view.cz = p.z; if (!V.radarView) { view.s = U.radarS; V.radarView = true } }
  draw()
  // Lists and distances are heavier: at most every 1.5 s.
  if (!full && Date.now() - listAt < 1500) return
  listAt = Date.now()
  updateNear(); bump()
}

export function onMap(m: Any, p: Any) { const g = m.grid; return p.x >= g.x0 && p.x <= g.x0 + g.extent_m && p.z >= g.x0 && p.z <= g.x0 + g.extent_m }

// Hidden Cubes respawn at another spot of their group after opening, so nothing is ever ticked off.
export function cubeDone(_m?: Any): Set<string> { return new Set() }

// Nearest needed mob, farm spot and open Hidden Cube around the player.
export function updateNear() {
  const m = G.md[U.map], p = S.pos
  V.near = null
  if (S.instance) return
  if (!m || !p || !onMap(m, p)) return
  const d2 = (x: number, z: number) => (x - p.x) ** 2 + (z - p.z) ** 2
  let mob: Any = null, spot: Any = null, cube: Any = null
  const close: Any[] = []
  for (const tg of V.targets) {
    if (tg.done) continue
    let best: Any = null
    for (const mb of tg.mobs) for (const i of m.byId.get(+mb.id) || []) {
      const d = d2(m.xs[i], m.zs[i])
      if (!best || d < best.d) best = { d, t: tg, mob: mb, x: m.xs[i], z: m.zs[i] }
    }
    if (best && (!mob || best.d < mob.d)) mob = best
    if (best && best.d < NEAR_R * NEAR_R) close.push(best)
  }
  for (const s of V.spots) { const d = d2(s.x, s.z); if (!spot || d < spot.d) spot = { d, s, x: s.x, z: s.z } }
  const done = cubeDone(m)
  for (const c of m.cubes) if (!done.has(c.key)) for (const [x, z] of c.pts) { const d = d2(x, z); if (!cube || d < cube.d) cube = { d, c, x, z } }
  const cubes: Any[] = []
  for (const c of m.cubes) if (!done.has(c.key)) {
    let best: Any = null
    for (const [x, z] of c.pts) { const d = d2(x, z); if (!best || d < best.d) best = { d, c, x, z } }
    if (best && best.d < NEAR_R * NEAR_R) cubes.push(best)
  }
  close.sort((a, b) => a.d - b.d); cubes.sort((a, b) => a.d - b.d)
  for (const o of [mob, spot, cube, ...close, ...cubes]) if (o) { o.dist = Math.sqrt(o.d); o.dir = dirTo(o.x - p.x, o.z - p.z) }
  V.near = { mob, spot, cube, close: close.slice(0, 9), cubes: cubes.slice(0, 3) }
}

function paintPlayer() {
  const m = G.md[U.map], p = S.pos
  if (S.instance) return
  if (!onMap(m, p)) return
  const x = sx(p.x), y = sz(p.z), stale = posAge() > 120
  if (U.radar) {
    ctx.strokeStyle = '#ffffff22'; ctx.lineWidth = 1; ctx.setLineDash([3, 4])
    ctx.font = '10px "Segoe UI"'; ctx.fillStyle = '#ffffff66'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'
    for (const r of [100, 250, 500]) {
      const rr = r * view.s
      if (rr < 25 || rr > Math.max(view.w, view.h)) continue
      ctx.beginPath(); ctx.arc(x, y, rr, 0, 7); ctx.stroke(); ctx.fillText(r + ' m', x + rr * 0.71 + 2, y - rr * 0.71)
    }
    ctx.setLineDash([])
    const n = V.near
    if (n?.mob) {
      ctx.strokeStyle = n.mob.t.col; ctx.globalAlpha = 0.85; ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(sx(n.mob.x), sz(n.mob.z)); ctx.stroke()
      ctx.beginPath(); ctx.arc(sx(n.mob.x), sz(n.mob.z), 7, 0, 7); ctx.stroke(); ctx.globalAlpha = 1
    }
  }
  ctx.globalAlpha = stale ? 0.55 : 1
  if (p.est) { // estimated (filter: 1-σ radius p.sigma; dead reckoning: ~30 m): dashed uncertainty ring
    ctx.strokeStyle = '#5fd0e0aa'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4])
    ctx.beginPath(); ctx.arc(x, y, Math.max(13, (p.sigma || 30) * view.s), 0, 7); ctx.stroke(); ctx.setLineDash([])
  }
  ctx.fillStyle = '#5fd0e033'; ctx.beginPath(); ctx.arc(x, y, 13, 0, 7); ctx.fill()
  ctx.save(); ctx.translate(x, y)
  if (V.heading != null) {
    ctx.rotate(V.heading + Math.PI / 2)
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6.5, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6.5, 7); ctx.closePath()
  } else { ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, 7) }
  ctx.fillStyle = '#5fd0e0'; ctx.strokeStyle = '#0b1220'; ctx.lineWidth = 2; ctx.stroke(); ctx.fill()
  ctx.restore(); ctx.globalAlpha = 1
}

// The radar HUD is rendered by MapView; refresh the "position x ago" line.
setInterval(() => { if (U.radar && S.pos) { bump(); draw() } }, 5000)

export function setRadar(on: boolean) {
  U.radar = on; saveUi(['radar'])
  V.follow = true
  if (on && S.pos) { view.cx = S.pos.x; view.cz = S.pos.z; view.s = U.radarS; V.sel = V.spot = V.cube = null }
  else if (!on) fit()
  updateNear(); bump(); draw()
}

// ---------------------------------------------------------------- pan / zoom / hover / click

export type Tip = { x: number; y: number; it: Any } | null
let tipFn: (tip: Tip) => void = () => {}
export function onTip(f: (tip: Tip) => void) { tipFn = f }

let drag: Any = null
export function pointerDown(e: PointerEvent) {
  drag = { x: e.clientX, y: e.clientY, cx: view.cx, cz: view.cz, moved: false }
  cv?.setPointerCapture(e.pointerId)
}
export function pointerMove(e: PointerEvent) {
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y
    if (Math.abs(dx) + Math.abs(dy) > 3) { drag.moved = true; if (cv) cv.style.cursor = 'grabbing'; tipFn(null) }
    if (drag.moved) { view.cx = drag.cx - dx / view.s; view.cz = drag.cz - dy / view.s; if (U.radar) { V.follow = false; V.panAt = Date.now() } draw() }
    return
  }
  hover(e)
}
export function pointerUp(e: PointerEvent) {
  const d = drag; drag = null
  if (cv) cv.style.cursor = ''
  if (d && !d.moved) click(e)
}
export const pointerLeave = () => tipFn(null)
export function wheel(e: WheelEvent) { e.preventDefault(); zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.25 : 0.8) }
export const dblClick = (e: MouseEvent) => zoomAt(e.offsetX, e.offsetY, 2)
export const zoomIn = () => zoomAt(view.w / 2, view.h / 2, 1.5)
export const zoomOut = () => zoomAt(view.w / 2, view.h / 2, 1 / 1.5)

function zoomAt(px: number, py: number, f: number) {
  if (U.radar && V.follow && S.pos) { px = view.w / 2; py = view.h / 2 }
  const x = wx(px), z = wz(py)
  view.s = Math.min(3, Math.max(0.02, view.s * f))
  view.cx = x - (px - view.w / 2) / view.s; view.cz = z - (py - view.h / 2) / view.s
  if (U.radar) { U.radarS = view.s; saveUi(['radarS']) }
  draw()
}

function pick(px: number, py: number): Any {
  const m = G.md[U.map]
  if (!m) return null
  let best: Any = null, bd = 12 * 12
  const test = (x: number, z: number, item: Any) => { const d = (sx(x) - px) ** 2 + (sz(z) - py) ** 2; if (d < bd) { bd = d; best = item } }
  if (U.tab === 'farm') {
    for (const s of V.farmSpots) {
      if (V.farmSpot && V.farmSpot !== s.rank) continue
      test(s.x, s.z, { farm: s })
      const rr = Math.max(9, farmR() * view.s), d = (sx(s.x) - px) ** 2 + (sz(s.z) - rr - py) ** 2
      if (d < 100) { bd = 0; best = { farm: s } }
    }
    return best
  }
  if (U.layers.spots || V.spot) for (const s of V.spots) {
    if (!V.spot || V.spot === s.rank) {
      test(s.x, s.z, { spot: s })
      const rr = Math.max(9, R * view.s), d = (sx(s.x) - px) ** 2 + (sz(s.z) - rr - py) ** 2 // the rank badge
      if (d < 100) { bd = 0; best = { spot: s } }
    }
  }
  if (U.layers.cubes || V.cube) for (const c of m.cubes) if (!V.cube || V.cube === c.key) c.pts.forEach(([x, z]: number[], i: number) => test(x, z, { cube: c, h: c.hs?.[i] }))
  const ids = selIds()
  if (U.layers.spawns) for (const tg of ids.size ? V.targets.filter((x: Any) => ids.has(x.p.id)) : V.targets.filter((x: Any) => !x.done)) {
    for (const mob of tg.mobs) for (const i of m.byId.get(+mob.id) || []) test(m.xs[i], m.zs[i], { t: tg, mob, i })
  }
  return best
}

function hover(e: PointerEvent) {
  const it = pick(e.offsetX, e.offsetY)
  if (cv) cv.style.cursor = it ? 'pointer' : ''
  tipFn(it ? { x: e.offsetX, y: e.offsetY, it } : null)
}

function click(e: PointerEvent) {
  const it = pick(e.offsetX, e.offsetY)
  if (!it) { if (V.sel || V.spot || V.cube) { V.sel = V.spot = V.cube = null; bump(); draw() } return }
  if (it.farm) { V.farmSpot = V.farmSpot === it.farm.rank ? null : it.farm.rank; bump(); fit(); return }
  if (it.spot) { V.spot = it.spot.rank; V.sel = null; V.cube = null; U.tab = 'spots' }
  else if (it.cube) { V.cube = it.cube.key; V.sel = V.spot = null }
  else { V.multi.add(it.t.p.id); V.sel = null; V.spot = V.cube = null; U.tab = 'targets'; V.spotsSel = false; emit('recompute') }
  saveUi(['tab']); bump(); draw()
  // After the list re-rendered (bump is batched per frame): bring the selected entry into view.
  requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector('[data-sel="true"], .sel')?.scrollIntoView({ block: 'nearest' })))
}

export function mergeSiteCubes(cubes: Any) {
  let changed = false
  for (const [key, names] of Object.entries<string[]>(cubes || {})) {
    const cur = new Set(U.cubes[key] || [])
    for (const n of names) if (!cur.has(n)) { cur.add(n); changed = true }
    U.cubes[key] = [...cur]
  }
  if (changed) { saveUi(['cubes']); bump(); draw() }
}

// ---------------------------------------------------------------- map changes
// 0x0140 tells the current map id on login, teleport and instance entry. aion2maps maps have a map_id
// (1110 = Altgard); instances/dungeons have other ids and no map, so the radar pauses there.
export function onZone(id: number) {
  S.zone = id
  if (!G.maps.length) return // loadBase emits 'zoneCheck' again
  // Instances with an aion2maps instance map show it (with the own position) instead of hiding the overlay.
  const dng = G.dungeons?.get(id)
  const meta = G.maps.find((m: Any) => m.map_id === id) || dng
  S.instance = !meta && !!id
  V.live.clear()
  clearInterval(V.instTimer)
  if (meta) {
    // Back from an instance: undo our own minimize.
    if (U.instHidden) { U.instHidden = false; saveUi(['instHidden']); host({ type: 'instShow' }) }
    if ((dng || U.autoMap !== false) && meta.key !== U.map) { selectMap(meta.key); bump(); return }
    showMapMsg('')
  } else if (S.instance) host({ type: 'instCheck' }) // host answers 'instScreen': hide only on the game's monitor
  updateNear(); bump(); draw()
}

// In an instance the map is useless: warn with a countdown, then hide the overlay until the player leaves.
onHost('instScreen', m => {
  if (!S.instance) return
  if (m.same) instanceCountdown()
  else showMapMsg(t('map.instStay'))
})

function instanceCountdown() {
  let n = 3
  const tick = () => {
    if (!S.instance) return clearInterval(V.instTimer)
    if (n > 0) { showMapMsg(t('map.instCountdown', { n })); n--; return }
    clearInterval(V.instTimer)
    showMapMsg(t('map.instHidden'))
    U.instHidden = true; saveUi(['instHidden']); host({ type: 'instHide' })
  }
  tick(); V.instTimer = setInterval(tick, 1000)
}

