// Daily / weekly checklist.
// Per character; items the game limits per server/account are shared by all characters (per: 'server').
// A count is valid until the next reset: stored with the time of the last change.
import { S, U, saveUi, bump, manual, type Any } from '@/core/state'
import { t } from '@/core/i18n'
import { host } from '@/core/host'
import { Trophy, Users, Castle, ClipboardList, Crown, DoorOpen, FlaskConical, FlaskRound, Gem, Mountain, Package, PackageOpen, ScrollText, Store, Swords, type LucideIcon } from 'lucide-react'

export type Kind = 'd' | 'w'
export type Per = 'server' | 'char'
/** [id, max, per] – name and tip come from i18n ('progress.item.<id>', 'progress.tip.<id>'). */
export type CheckItem = [string, number, Per]

// Global client values (aion2maps datamine, Oct 2026). Sorted by priority tier within each period.
// Charge-based limits (Nightmare attempts, Shugo keys, Odyle energy, …) live in charges.ts.
export const CHECK: [Kind, CheckItem[]][] = [
  ['d', [
    ['dutyMissions', 5, 'server'],
    ['supplyEmergency', 1, 'char'],
  ]],
  ['w', [
    ['ludra', 1, 'char'],               // one rewarded final-boss kill
    ['dutyCommands', 32, 'server'],
    ['dailyDungeons', 14, 'server'],
    ['odyleCraft', 4, 'char'],
    ['ascensionTrial', 3, 'char'],
    ['battlefieldWins', 3, 'char'],
    ['arena', 10, 'char'],              // match rewards; the wins (30) are shown next to it
    ['coopArena', 10, 'char'],
    ['odyleCraftServer', 16, 'server'], // shared Substance Morph pool on top of the 4 per character
    ['windBreezeShop', 1, 'server'],    // Wind Breeze Merchant (membership)
    ['supplyWeekly', 1, 'char'],
    ['abyssShop', 1, 'char'],
  ]],
]
/** Priority: 1 = must do, 2 = should do, 3 = optional. */
export const TIER: Record<string, 1 | 2 | 3> = {
  dutyMissions: 1, ludra: 1, dutyCommands: 1, dailyDungeons: 1, odyleCraft: 1, ascensionTrial: 1,
  supplyEmergency: 2, battlefieldWins: 2, arena: 3, coopArena: 3, odyleCraftServer: 2, windBreezeShop: 2, supplyWeekly: 2, abyssShop: 3,
}
/** Icon per entry (tile icon column, overview rows). */
export const CHECK_ICON: Record<string, LucideIcon> = {
  dutyMissions: ClipboardList, supplyEmergency: Package, ludra: Crown, dutyCommands: ScrollText, dailyDungeons: DoorOpen, odyleCraft: FlaskConical, odyleCraftServer: FlaskRound,
  ascensionTrial: Mountain, battlefieldWins: Swords, arena: Trophy, coopArena: Users, windBreezeShop: Store, supplyWeekly: PackageOpen, abyssShop: Gem,
}
export const CHECK_ICON_DEFAULT = Castle
/** Game icon per entry (public/icons, tools/fetch_icons.py); entries without one keep the lucide icon. */
export const CHECK_GAME: Record<string, string> = {
  dutyMissions: 'duty', dutyCommands: 'duty-commands', ludra: 'ludra', dailyDungeons: 'dungeon', odyleCraft: 'odyle-craft', odyleCraftServer: 'odyle-craft',
  ascensionTrial: 'ascension', arena: 'arena', coopArena: 'coop-arena', windBreezeShop: 'odyle', abyssShop: 'abyss',
}
/** Colour per priority tier: must = gold, should = cyan, optional = dim. */
export const TIER_TONE = { 1: 'gold', 2: 'cyan', 3: 'dim' } as const
/** Weekly items worth doing on the last day of the lockout (higher item level by then). */
export const LAST_DAY = new Set(['ascensionTrial'])

// Aion 2 Global/EU resets: daily 07:00 UTC, weekly Wednesday 07:00 UTC (game8, aion2timers, metabot; the login
// frames 0x23E2/0x56E2 carry the same times).
export function lastReset(kind: Kind, now = new Date()) {
  const r = new Date(now)
  r.setUTCHours(7, 0, 0, 0)
  if (kind === 'd') { if (r > now) r.setUTCDate(r.getUTCDate() - 1); return r }
  r.setUTCDate(r.getUTCDate() - ((r.getUTCDay() - 3 + 7) % 7))
  if (r > now) r.setUTCDate(r.getUTCDate() - 7)
  return r
}
export const nextReset = (kind: Kind) => { const r = lastReset(kind); r.setUTCDate(r.getUTCDate() + (kind === 'd' ? 1 : 7)); return r }
/** Time until a reset as "2 T 5 h" / "5 h 12 min". */
export const resetIn = (d: Date) => {
  const m = Math.max(0, Math.round((d.getTime() - Date.now()) / 60000))
  return m >= 1440 ? t('progress.inDays', { d: Math.floor(m / 1440), h: Math.floor(m % 1440 / 60) }) : t('progress.inHours', { h: Math.floor(m / 60), m: m % 60 })
}

// Automatic counts from cumulative achievement counters ([value, tier, last change ms]; Asmodian 4xx / Elyos 3xx).
// While a counter's last change is older than the reset, its value is the period baseline; progress = value - baseline.
const AUTO: Record<string, number[]> = {
  dutyMissions: [400100300, 300100300],    // "Pflicht-Quests: Missionen"
  supplyEmergency: [400100500, 300100500], // Notfall-Versorgungsaufträge
  supplyWeekly: [400100600, 300100600],    // Wöchentliche Versorgungsaufträge
  dutyCommands: [400100400, 300100400],    // Schriftrollen (Wochenquests)
}
const autoKind = (id: string) => CHECK.find(([, items]) => items.some(i => i[0] === id))?.[0]
const itemOf = (id: string) => CHECK.flatMap(([, items]) => items).find(i => i[0] === id)
/** Maximum of an entry per period (CHECK). */
export const maxOf = (id: string) => itemOf(id)?.[1] ?? 0
// Baselines must be taken in the background: right after a reset and before every live update, whether or not
// the checklist tab is open. Otherwise the first update after a reset finds no baseline and nothing is counted.
// The counted progress is stored in the owner's list too: the counters only ever describe the logged-in character,
// so without that a character's progress was gone as soon as another one logged in.
export function refreshBaselines() {
  if (!manual() && S.state.charName) writeBaselines()
  let dirty = false
  for (const id of new Set([...Object.keys(AUTO), ...Object.keys(USAGE)])) {
    const k = autoKind(id), item = itemOf(id)
    if (!k || !item || manual() || (item[2] === 'char' && !S.state.charName)) continue
    const n = Math.min(item[1], Math.max(autoCount(id, k) ?? 0, usageCount(id, k) ?? 0))
    if (n > manualCount(id, item[2], k)) { checkSlot(id, item[2])[id] = { c: n, at: Date.now() }; dirty = true }
  }
  if (dirty) { saveUi(['checklist']); bump() }
}

// Baselines per character: the counters are the logged-in character's, another character has other values.
// A counter unchanged since the reset is the baseline of the period. Written only here (refreshBaselines), never
// while rendering.
function writeBaselines() {
  const st: Any = S.state.ach || {}
  U.checkBaselines ||= {}
  const base = (U.checkBaselines['@' + charKey()] ||= {})
  let dirty = false
  for (const [item, ids] of Object.entries(AUTO)) {
    const reset = lastReset(autoKind(item)!).getTime()
    for (const id of ids) {
      const r = st[id], b = base[id]
      if (r && (!r[2] || r[2] < reset) && (!b || b.v !== r[0] || b.r !== reset)) { base[id] = { v: r[0], r: reset }; dirty = true }
    }
  }
  if (dirty) saveUi(['checkBaselines'])
}

/** Progress since the reset from the achievement counters. Pure: reads the baselines refreshBaselines wrote. */
export function autoCount(item: string, kind: Kind): number | null {
  const ids = AUTO[item], st: Any = S.state.ach || {}
  if (!ids) return null
  const reset = lastReset(kind).getTime(), base = U.checkBaselines?.['@' + charKey()] || {}
  let sum = 0, known = false
  for (const id of ids) {
    const r = st[id]
    if (!r) continue
    const [val, , ts] = r, b = base[id]
    if (!ts || ts < reset) known = true // nothing since the reset: this value is the baseline
    else if (b && b.r === reset) { sum += val - b.v; known = true }
  }
  return known ? sum : null // null: changed since the reset but no baseline seen -> manual
}

export const charKey = () => S.state.charName || 'Standard'

// `char` = whose list (default: the logged-in character). Server items ignore it.
export function checkSlot(_id: string, per: Per, char = charKey()): Any {
  U.checklist ||= { srv: {}, chars: {} }
  return per === 'server' ? U.checklist.srv : (U.checklist.chars[char] ||= {})
}
export function manualCount(id: string, per: Per, kind: Kind, char?: string): number {
  // Read without creating the slot: a stale render of a just renamed character must not bring its old name back.
  const e = (per === 'server' ? U.checklist?.srv : U.checklist?.chars?.[char ?? charKey()])?.[id]
  return e && e.at >= lastReset(kind).getTime() ? e.c : 0
}
// Usage counters the server sends at login (0xacff: id -> used this week), valid if sent after the last reset.
// Verified for id 2 = daily dungeon entries (14 used before the weekly reset, 0 after it).
const USAGE: Record<string, number> = { dailyDungeons: 2 }
export function usageCount(id: string, kind: Kind): number | null {
  const k = USAGE[id], st: Any = S.state
  if (k == null || !st.usage || st.usage[k] == null || !st.usageAt || st.usageAt < lastReset(kind).getTime()) return null
  return st.usage[k]
}

// The game counters only tell what the logged-in character did, so per-character items of other characters are manual.
// Manual mode: nothing is counted automatically (old counters from an earlier auto session are ignored).
const autoFor = (per: Per, char?: string) => !manual() && (per === 'server' || !char || char === charKey())
export const checkAuto = (id: string, per: Per, kind: Kind, char?: string) =>
  autoFor(per, char) && (autoCount(id, kind) != null || usageCount(id, kind) != null)
export const checkCount = (id: string, per: Per, kind: Kind, char?: string) =>
  Math.max(manualCount(id, per, kind, char), autoFor(per, char) ? Math.max(autoCount(id, kind) ?? 0, usageCount(id, kind) ?? 0) : 0)
export function checkSet(id: string, per: Per, _kind: Kind, max: number, c: number, char?: string) {
  checkSlot(id, per, char)[id] = { c: Math.max(0, Math.min(max, c)), at: Date.now() }
  saveUi(['checklist']); bump()
}

/** All items of one owner ('server' or a character), with their period. */
export const itemsOf = (per: Per) => CHECK.flatMap(([kind, items]) => items.filter(i => i[2] === per).map(i => ({ kind, id: i[0], max: i[1], per })))

/** Progress 0..1 of an owner: mean of the item fractions (a half-done 32-quest weekly counts half). */
export function progressOf(per: Per, char?: string, kind?: Kind) {
  const items = itemsOf(per).filter(i => !kind || i.kind === kind)
  if (!items.length) return 1
  return items.reduce((s, i) => s + Math.min(1, checkCount(i.id, per, i.kind, char) / i.max), 0) / items.length
}

/** Set every item of an owner and period to done (or back to 0). Automatic counts still win when higher. */
export function setAll(per: Per, kind: Kind, done: boolean, char?: string) {
  for (const i of itemsOf(per)) if (i.kind === kind) checkSlot(i.id, per, char)[i.id] = { c: done ? i.max : 0, at: Date.now() }
  saveUi(['checklist']); bump()
}

/** Known characters: everyone with a list, plus the logged-in one; logged-in first, then by name. Pure (called while
 *  rendering): the logged-in character's list is created by its first entry (checkSlot). */
export function characters(): string[] {
  const chars = U.checklist?.chars || {}, cur = S.state.charName
  const names = new Set(Object.keys(chars).filter(c => c !== 'Standard' || Object.keys(chars[c]).length))
  if (cur) names.add(cur)
  return [...names].sort((a, b) => (b === cur ? 1 : 0) - (a === cur ? 1 : 0) || a.localeCompare(b))
}

/** Stores keyed '<id>|<character>' (besides the list and the baselines '@<character>'). */
const PER_CHAR = ['charges', 'entryBonus', 'pvpWins'] as const
/** Move a character's entries to another name, or delete them (no `to`). */
function moveCharData(from: string, to?: string) {
  const chars = U.checklist?.chars, base = U.checkBaselines
  if (chars) { if (to != null) chars[to] = chars[from] || {}; delete chars[from] }
  if (base?.['@' + from]) { if (to != null) base['@' + to] = base['@' + from]; delete base['@' + from] }
  for (const store of PER_CHAR) {
    const m = U[store]
    if (m) for (const k of Object.keys(m)) if (k.endsWith('|' + from)) { if (to != null) m[k.slice(0, -from.length) + to] = m[k]; delete m[k] }
  }
  saveUi(['checklist', 'checkBaselines', ...PER_CHAR])
}

/** Forget a character: its list, baselines, charge readings, bonus entries and PvP wins (e.g. a deleted character). */
export function removeChar(char: string) { moveCharData(char); bump() }

// ---------------------------------------------------------------- manual mode: characters by hand

/** Make a character the active one (the host stores it as the character name, as if read from the game). */
export function selectChar(name: string) {
  S.state.charName = name
  host({ type: 'setChar', name })
  bump()
}

/** Add a character and make it active. The very first one takes over the lists kept under "Standard" so far. */
export function addChar(name: string): boolean {
  name = name.trim()
  U.checklist ||= { srv: {}, chars: {} }
  if (!name || name === 'Standard' || U.checklist.chars[name]) return false
  if (!S.state.charName && U.checklist.chars.Standard) return renameChar('Standard', name)
  U.checklist.chars[name] = {}
  saveUi(['checklist'])
  selectChar(name)
  return true
}

/** Rename a character: its list, baselines, charge readings, bonus entries and PvP wins move along; the active one
 *  stays active. */
export function renameChar(from: string, to: string): boolean {
  to = to.trim()
  U.checklist ||= { srv: {}, chars: {} }
  if (!to || to === 'Standard' || (U.checklist.chars[to] && to !== from)) return false
  if (to === from) return true
  moveCharData(from, to)
  if (S.state.charName === from || (from === 'Standard' && !S.state.charName)) selectChar(to)
  else bump()
  return true
}

// PvP match history (sent when its window opens, the newest matches per mode): battlefield wins since the weekly reset
// count for the logged-in character. Contents ids: 22 arena, 44 coop arena, 55 battlefield.
// Members match by name and server (`ownSrv` from the host, 0 = unknown: by name only), so a namesake on another
// server does not count.
export type PvpMatch = { start: number; cid: number; win: number; members: { name: string; srv?: number; team: number }[] }
export function applyPvpHistory(matches: PvpMatch[], ownSrv = 0) {
  const me = S.state.charName, reset = lastReset('w').getTime()
  if (!me || manual()) return
  const isMe = (x: PvpMatch['members'][number]) => x.name === me && (!ownSrv || !x.srv || x.srv === ownSrv)
  const mine = (cid: number) => matches.filter(m => m.cid === cid && m.start >= reset && m.members.some(isMe))
  const won = (m: PvpMatch) => m.members.find(isMe)?.team === m.win
  const wins = mine(55).filter(won).length
  if (wins > manualCount('battlefieldWins', 'char', 'w')) checkSet('battlefieldWins', 'char', 'w', maxOf('battlefieldWins'), wins)
  // arena (22) and coop arena (44): the entry counts matches (10 rewards), the wins (30 rewards) are kept beside it.
  // The history holds only the newest matches of a mode, so a count never goes down.
  for (const [cid, id] of [[22, 'arena'], [44, 'coopArena']] as const) {
    const ms = mine(cid), k = id + '|' + me, prev = U.pvpWins?.[k]
    if (ms.length > manualCount(id, 'char', 'w')) checkSet(id, 'char', 'w', maxOf(id), ms.length)
    const w = Math.max(ms.filter(won).length, prev && prev.r === reset ? prev.n : 0)
    U.pvpWins = { ...U.pvpWins, [k]: { n: w, r: reset } }; saveUi(['pvpWins'])
  }
}
