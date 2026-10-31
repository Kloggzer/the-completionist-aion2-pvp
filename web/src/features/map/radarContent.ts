// Content of the mini radar window (RadarForm.cs), pure so it can be unit tested: needed spawns and live cubes around
// the player, relative to the player in metres (north up: +dz is down on screen, like the map).
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any

export const MIN_RANGE = 30, MAX_RANGE = 300
/** Next radar range in smooth steps: 10 m up to 100 m, 25 m above (same rule as RadarForm.NextRange). */
export function nextRange(r: number, d: 1 | -1) {
  const step = (d > 0 ? r >= 100 : r > 100) ? 25 : 10
  return Math.min(MAX_RANGE, Math.max(MIN_RANGE, Math.round((r + step * d) / step) * step))
}
const MAX_DOTS = 400

/** [dx, dz, colour, named 0/1] relative to the player. */
export type RadarDot = [number, number, string, 0 | 1]
export type RadarContent = { dots: RadarDot[]; cubes: [number, number][]; nearest: [number, number] | null }

/** Needed spawns within `range` around `pos` (nearest first, capped), live cubes within range, and the nearest needed
 *  spawn at any distance (the host draws the line to it, cut at the rim). Pure: map data + targets in, payload out. */
export function radarContent(m: Any, targets: Any[], pos: { x: number; z: number }, range: number, live: Iterable<Any> = []): RadarContent {
  const r2 = range * range
  const inRange: [number, RadarDot][] = []
  let best: [number, number, number] | null = null
  for (const tg of targets) {
    if (tg.done) continue
    for (const mob of tg.mobs) {
      const named: 0 | 1 = mob.named || (mob.r && mob.r !== 'Normal') ? 1 : 0
      for (const i of m.byId.get(+mob.id) || []) {
        const dx = m.xs[i] - pos.x, dz = m.zs[i] - pos.z, d = dx * dx + dz * dz
        if (!best || d < best[0]) best = [d, dx, dz]
        if (d <= r2) inRange.push([d, [Math.round(dx), Math.round(dz), tg.col, named]])
      }
    }
  }
  inRange.sort((a, b) => a[0] - b[0])
  const cubes: [number, number][] = []
  for (const l of live) {
    const dx = l.x - pos.x, dz = l.z - pos.z
    if (dx * dx + dz * dz <= r2) cubes.push([Math.round(dx), Math.round(dz)])
  }
  return {
    dots: inRange.slice(0, MAX_DOTS).map(e => e[1]),
    cubes,
    nearest: best ? [Math.round(best[1]), Math.round(best[2])] : null,
  }
}
