// Mini radar: a separate native window of the host (RadarForm.cs) that sits on the character in the game. The page
// has spawns, targets and the position, so it computes the content (relative to the player, metres, north up = -z on
// screen like the map) and posts it as 'radar2' a few times per second – only when something changed.
import { G, S, U, V, bump, manual, type Any } from '@/core/state'
import { host, onHost } from '@/core/host'
import { onMap } from './engine'
import { radarContent } from './radarContent'

export { nextRange, MIN_RANGE, MAX_RANGE } from './radarContent'

/** Settings of the radar window as the host reports them (S.settings.radar). */
export const radarCfg = (): Any => S.settings?.radar || { on: false, locked: true, range: 100, disc: 0.15, rim: 0.2, alpha: 1, size: 240, arrow: true, offY: 0 }

let last = ''
function tick() {
  const cfg = radarCfg()
  if (!cfg.on) { last = ''; return }
  const m = G.md[U.map], p = S.pos
  const ok = !manual() && !S.instance && !!m && !!p && onMap(m, p)
  const msg: Any = ok
    ? { type: 'radar2', ok: true, x: Math.round(p.x), z: Math.round(p.z), heading: V.heading == null ? null : Math.round(V.heading * 20) / 20, range: cfg.range,
        // Filter estimate: the host dims the content and draws the uncertainty ring instead of the arrow.
        sigma: p.est && p.sigma ? Math.round(p.sigma) : null, ...radarContent(m, V.targets, p, cfg.range, V.live.values()) }
    : { type: 'radar2', ok: false }
  const key = JSON.stringify(msg)
  if (key === last) return
  last = key
  host(msg)
}
setInterval(tick, 250)

onHost('radarWin', m => {
  if (!S.settings) return
  S.settings.radar = m.radar
  last = '' // the window may have just been (re)created: send the content again
  tick(); bump()
})

/** Change a radar setting (range, size, alpha, disc, rim, arrow, offY); the host answers with 'radarWin'. */
export function setRadarCfg(patch: Any) {
  Object.assign(radarCfg(), patch)
  host({ type: 'radarCfg', ...patch }); bump()
}
export const toggleMiniRadar = () => { const c = radarCfg(); c.on = !c.on; host({ type: 'radarWin', on: c.on }); bump() }
export const toggleRadarLock = () => host({ type: 'radarLock' })
export const centerRadar = () => host({ type: 'radarCenter' })
