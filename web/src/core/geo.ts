// Position helpers shared by the map/radar and the lists.
import { S } from './state'
import { lang, t } from './i18n'

/** Seconds since the last position (Infinity without one). */
export const posAge = () => (S.pos ? (Date.now() - new Date(S.pos.at).getTime()) / 1000 : Infinity)

/** "12 s" / "5 Min." / "2 Std." */
export const ago = (sec: number) => sec < 60 ? t('geo.s', { n: Math.max(1, Math.round(sec)) }) : sec < 3600 ? t('geo.min', { n: Math.round(sec / 60) }) : t('geo.h', { n: Math.round(sec / 3600) })

const DIRS_DE = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW']
const DIRS_EN = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
/** Compass direction from the player to (dx, dz) (map z grows southwards). */
export const dirTo = (dx: number, dz: number) => (lang() === 'de' ? DIRS_DE : DIRS_EN)[Math.round(((Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360) / 45) % 8]
export const fmtDist = (d: number) => (d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`)

/** Height of a point relative to the player: "12 m über dir" / "8 m unter dir" / "auf deiner Höhe" ('' without data). */
export function relHeight(h: number | null | undefined) {
  if (h == null) return ''
  const own = S.pos?.y
  if (own == null || S.pos?.est) return t('geo.height', { h: Math.round(h) })
  const d = Math.round(h - own)
  return Math.abs(d) < 3 ? t('geo.level') : d > 0 ? t('geo.above', { n: d }) : t('geo.below', { n: -d })
}
