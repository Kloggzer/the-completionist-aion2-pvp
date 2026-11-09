// What the checklist cards show about a character besides its lists: class, level, item level, CP (from the login data
// of the logged-in character, host 'pvp' own) and when it was last played. Kept per character name in U.charInfo.
import { S, U, saveUi, type Any } from '@/core/state'
import { classOf } from '@/features/pvp/logic'

export type CharInfo = { cls: number; lv: number; il: number; cp: number; seen: number }

/** A character's saved info (undefined until it was logged in once with this version). */
export const charInfo = (name: string): CharInfo | undefined => U.charInfo?.[name]

/** Playing this character right now (live data, the logged-in one). */
export const playingNow = (name: string) => !!name && S.state.charName === name && (S.status.state === 'live' || S.status.state === 'replay')

/** The logged-in character's data from the host: saved when it changed, the "last played" time at most every 5 min. */
export function noteOwn(own: Any) {
  if (!own?.name) return
  const prev = charInfo(own.name), now = Date.now()
  const next: CharInfo = { cls: classOf(own.pc) || prev?.cls || 0, lv: own.lv || prev?.lv || 0, il: own.il || prev?.il || 0, cp: own.cp || prev?.cp || 0, seen: now }
  const changed = !prev || prev.cls !== next.cls || prev.lv !== next.lv || prev.il !== next.il || prev.cp !== next.cp
  if (!changed && now - prev.seen < 5 * 60e3) return
  U.charInfo = { ...U.charInfo, [own.name]: next }
  saveUi(['charInfo'])
}

/** Move a character's info to another name, or drop it (checklist rename / remove). */
export function moveCharInfo(from: string, to?: string) {
  if (!U.charInfo?.[from]) return
  const all = { ...U.charInfo }
  if (to) all[to] = all[from]
  delete all[from]
  U.charInfo = all
  saveUi(['charInfo'])
}
