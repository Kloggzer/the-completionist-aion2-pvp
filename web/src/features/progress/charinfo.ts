// What the checklist cards show about a character besides its lists: class, level, item level, CP (from the login data
// of the logged-in character, host 'pvp' own) and when it was last played (U.charInfo); the kinah earned today toward the
// daily cap (host 'kinahDay', game 0xa5ff / 0xa6ff; U.kinahDay). Kept per character name.
import { S, U, bump, saveUi, type Any } from '@/core/state'
import { classOf } from '@/features/pvp/logic'
import { lastReset } from './checklist'

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

/** Daily cap of the kinah earned from monsters and quests. */
export const KINAH_CAP = 1_000_000

/** Kinah earned today by a character (0 after the daily reset), null when never read. */
export function kinahToday(name: string): number | null {
  const r = U.kinahDay?.[name] as { v: number; at: number } | undefined
  if (!r) return null
  return r.at >= lastReset('d').getTime() ? r.v : 0
}

let kinahSavedAt = 0
/** The logged-in character's kinah today from the host: kept every time, saved at most every 30 s (it comes per kill). */
export function noteKinah(v: number) {
  const name = S.state.charName
  if (!name) return
  U.kinahDay = { ...U.kinahDay, [name]: { v, at: Date.now() } }
  if (Date.now() - kinahSavedAt > 30e3 || v >= KINAH_CAP) { kinahSavedAt = Date.now(); saveUi(['kinahDay']) }
  bump()
}

/** Move a character's info and kinah to another name, or drop them (checklist rename / remove). */
export function moveCharInfo(from: string, to?: string) {
  for (const k of ['charInfo', 'kinahDay'] as const) {
    if (!U[k]?.[from]) continue
    const all = { ...U[k] }
    if (to) all[to] = all[from]
    delete all[from]
    U[k] = all
    saveUi([k])
  }
}
