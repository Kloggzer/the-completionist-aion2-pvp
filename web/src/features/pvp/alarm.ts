// Enemy alarm (pure, unit tested in logic.test.ts): which enemies of the PvP list deserve a banner + sound + voice.
// "new": every enemy that is found (shows up around you) – again each time it comes back after being gone, unless it
// was gone for less than `rejoin` (flickering at the edge of sight); "close": once when it comes within `close` metres,
// again after it moved out past `close + hysteresis` or was gone. Several in the same tick are one event. Arena: no
// alarm (you know who is there).
import type { PvpRow } from './logic'

export type AlarmCfg = { close: number; rejoin: number; hysteresis: number }
export const ALARM = { close: 25, range: 60, rejoin: 10_000, hysteresis: 10 }
/** Per enemy (name@server): around now, when it left, close alarm given (until it moves away). */
export type AlarmMemo = Map<string, { here: boolean; left: number; close: boolean }>
export type AlarmEvent = { kind: 'new' | 'close'; rows: PvpRow[] }

const key = (r: PvpRow) => `${r.name}@${r.srv}`

export function alarms(rows: PvpRow[], arena: boolean, memo: AlarmMemo, now: number, cfg: AlarmCfg = ALARM): AlarmEvent[] {
  if (arena) return []
  const here = rows.filter(r => !r.gone && !r.me)
  const seen = new Set(here.map(key))
  // left (dead / out of sight): remember when, so a quick return does not count as new
  for (const [k, m] of memo) {
    if (!seen.has(k) && m.here) { m.here = false; m.left = now; m.close = false }
    if (!m.here && now - m.left > 10 * 60_000) memo.delete(k)
  }
  const fresh: PvpRow[] = [], close: PvpRow[] = []
  for (const r of here) {
    let m = memo.get(key(r))
    const isNew = !m || (!m.here && now - m.left >= cfg.rejoin)
    if (!m) memo.set(key(r), m = { here: true, left: -Infinity, close: false })
    m.here = true
    if (r.dist != null && r.dist <= cfg.close && !m.close) { m.close = true; close.push(r) }
    else if (isNew) fresh.push(r)
    if (r.dist != null && r.dist > cfg.close + cfg.hysteresis) m.close = false
  }
  const out: AlarmEvent[] = []
  if (close.length) out.push({ kind: 'close', rows: close })
  if (fresh.length) out.push({ kind: 'new', rows: fresh })
  return out
}
