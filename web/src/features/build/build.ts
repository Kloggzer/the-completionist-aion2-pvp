// Build tab state (private build): gear snapshots from the plaync character page, fights from the Abyss Logs history,
// the stat totals, the calibrated DPS model and the values it hands the Daevanion optimizer.
//
// U.build = { page: 'dae' | 'stats' | 'gear', assume: Partial<Assume>, over: Totals (totals the player set),
//             snaps: {char: Snapshot[]} (newest last, at most SNAPS), meas: {char: Measured & {label}}, fight: {char: id} }
import { G, U, V, bump, saveUi, type Any } from '@/core/state'
import { host, onHost } from '@/core/host'
import { t } from '@/core/i18n'
import { toast } from '@/core/toast'
import { charKey, data, live, pos } from '@/features/daevanion/daevanion'
import { equipUrl, infoUrl } from '@/features/daevanion/daevanion'
import { getJson, profile, resolve } from '@/features/daevanion/source'
import { unitHook } from '@/features/daevanion/values'
import { measure, parseFight, type Measured } from './abyss'
import { ASSUME, calibrate, marginals, type Assume, type State } from './model'
import { keyOfName, parseDeity, parseItem, totals, type Key, type Snapshot, type Totals } from './stats'
import type { GearRow } from './gear'

export type Page = 'dae' | 'stats' | 'gear'
export type Fight = { id: string; label: string; startTime: string; duration: number; totalDamage: number; playerCount: number; recorderName: string; hasDummy?: boolean; hasBoss?: boolean; zoneId?: number; runGroupId?: string; bossMobCode?: number }
const SNAPS = 3

export function bs(): Any {
  U.build ||= {}
  const b = U.build
  b.page ||= 'dae'; b.assume ||= {}; b.over ||= {}; b.snaps ||= {}; b.meas ||= {}; b.fight ||= {}
  return b
}
export function setBuild(patch: Any) { Object.assign(bs(), patch); saveUi(['build']); bump(); unitHook.ver++ }
export const assume = (): Assume => ({ ...ASSUME, ...bs().assume })
export const snap = (char = charKey()): Snapshot | undefined => bs().snaps[char]?.at(-1)
export const measured = (char = charKey()): (Measured & { label: string }) | undefined => bs().meas[char]

// ---------------------------------------------------------------- gear data (aion2data, web/public/gear.json)

fetch('gear.json').then(r => r.json()).then(d => { G.gear = d.items as GearRow[]; G.gearById = new Map(G.gear.map((r: GearRow) => [r[0], r])); bump() }).catch(() => { G.gear = false })
export const gearRows = (): GearRow[] => G.gear || []
export const gearById = (): Map<number, GearRow> => G.gearById || new Map()

// ---------------------------------------------------------------- plaync gear snapshot

const ITEM = 'https://aion2.plaync.com/api/character/equipment/item'
export const loadingGear = new Set<string>()

/** Read the character's worn gear (every item's lines) and deity stats from the plaync character page. */
export async function loadGear(char = charKey()) {
  const p0 = profile(char)
  if (!p0 || loadingGear.has(char)) return
  loadingGear.add(char); bump()
  try {
    const p = await resolve(p0), q = `lang=en-US&characterId=${p.id}&serverId=${p.serverId}&region=${p.region}`
    const [eq, info] = await Promise.all([getJson(equipUrl(p as Any)), getJson(infoUrl(p as Any))])
    const items = []
    for (const s of eq?.equipment?.equipmentList || []) {
      const d = await getJson(`${ITEM}?${q}&id=${s.id}&enchantLevel=${s.enchantLevel}&slotPos=${s.slotPos}`)
      items.push(parseItem(s, d))
    }
    const b = bs(), list: Snapshot[] = [...(b.snaps[char] || []), { at: Date.now(), items, deity: parseDeity(info) }]
    b.snaps[char] = list.slice(-SNAPS)
    setBuild({})
  } catch {
    toast(t('build.gearErr'), t('build.gearErrSub'))
  } finally {
    loadingGear.delete(char); bump()
  }
}

// ---------------------------------------------------------------- Abyss Logs fights (host: AbyssLogs.cs)

let seq = 0
const waiting = new Map<number, (body: string | null) => void>()
onHost('abyss', m => { const f = waiting.get(m.id); if (f) { waiting.delete(m.id); f(m.body ?? null) } })
const ask = (file?: string) => new Promise<string | null>(res => {
  const id = ++seq
  waiting.set(id, res)
  host({ type: 'abyss', id, file: file ?? null })
  setTimeout(() => { if (waiting.delete(id)) res(null) }, 20000)
})

/** The history's training dummy and boss fights (V.abyss; null = not read yet, false = no history). */
export async function loadFights() {
  const body = await ask()
  V.abyss = body ? JSON.parse(body) as Fight[] : false
  bump()
}
/** Fights of this character, training dummies first (they measure cleanly), newest first. */
export const fightsOf = (char = charKey()): Fight[] =>
  (V.abyss || []).filter((f: Fight) => f.recorderName === char).sort((a: Fight, b: Fight) => Number(!!b.hasDummy) - Number(!!a.hasDummy) || b.startTime.localeCompare(a.startTime))

export const loadingFight = new Set<string>()
/** Read one fight and measure the character's hits in it. */
export async function pickFight(id: string, char = charKey()) {
  loadingFight.add(char); bump()
  try {
    const body = await ask(id)
    if (!body) throw new Error('missing')
    const f = parseFight(Uint8Array.from(atob(body), c => c.charCodeAt(0)))
    const p = f.players.find(x => x.name === char) ?? f.players[0]
    if (!p) throw new Error('no player')
    const b = bs()
    b.meas[char] = { ...measure(f, p.id), label: f.label }
    b.fight[char] = id
    setBuild({})
  } catch {
    toast(t('build.fightErr'), '')
  } finally {
    loadingFight.delete(char); bump()
  }
}

/** On the first visit: read the history, measure the newest dummy fight of the character if none is chosen yet. */
export async function autoFight(char = charKey()) {
  if (V.abyss == null) await loadFights()
  if (bs().meas[char] || loadingFight.has(char)) return
  const f = fightsOf(char)[0]
  if (f) await pickFight(f.id, char)
}

// ---------------------------------------------------------------- totals and model

/** Stat effects of the character's open Daevanion nodes (website boards): [Daevanion stat key, amount]. */
export function daeStats(char = charKey()): [string, number][] {
  const d = data(), l = live(char)
  if (!d || !l) return []
  const out: [string, number][] = []
  for (const [slot, b] of Object.entries(d.classes[l.cls]?.boards || {}))
    for (const n of b.nodes) if (n[3] === 1 && l.open[slot]?.includes(pos(n[0], n[1]))) for (const [si, a] of n[4] as [number, number][]) out.push([d.stats[si].key, a])
  return out
}

export type Model = { state: State; by: ReturnType<typeof totals>['by']; auto: Totals; all: Totals; marg: Record<Key, number> }
let memo: { key: string; m: Model } | null = null
/** The model for the character: totals (gear + deity + Daevanion, then the player's own numbers) calibrated with the
 *  measured fight. */
export function model(char = charKey()): Model {
  const b = bs(), s0 = snap(char), m = measured(char), l = live(char)
  const key = JSON.stringify([char, s0?.at, m?.fight, l?.at, b.over, b.assume])
  if (memo?.key === key) return memo.m
  const tt = totals(s0, daeStats(char)), all: Totals = { ...tt.all, ...b.over }
  const state = calibrate(all, m ?? null, assume())
  memo = { key, m: { state, by: tt.by, auto: tt.all, all, marg: marginals(state, assume()) } }
  return memo.m
}

/** Values per unit for the Daevanion optimizer from the model, scaled so a 1.5 % combat speed corner keeps its 16
 *  (the other offensive stats relative to it); only with gear or a measured fight. */
unitHook.fn = () => {
  const char = charKey()
  if (!snap(char) && !measured(char)) return null
  const d = data(), mg = model(char).marg
  if (!d || !(mg.speed > 0)) return null
  const scale = 16 / (mg.speed * 1.5), out: Record<string, number> = {}
  for (const s of d.stats) { const k = keyOfName(s.key); if (k && mg[k] != null) out[s.key] = Math.max(0, mg[k]) * scale }
  return out
}
