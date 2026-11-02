// Daevanion tab: board data (web/public/daevanion.json, via tools/fetch_daevanion.py), the character from the public
// plaync character page (boards, skill levels, gear, main / deity stats, Combat Power; which character: source.ts),
// settings and the plan per point pool (solve.ts, in a worker).
//
// Settings: U.dae = { mode: 'respec' | 'add', cls, free (total points Nezekan–Triniel), ariel, pvp (Azphel),
//   off: {cls: 0..1}, use: {cls: {skill: bool}}, base: {cls: {skill: level without Daevanion}},
//   assume: {cls: {pve|pvp: {key: n}}}, ignore: {cls: [model key]}, heal: {cls: 0..1}, pmode: {pool: 'pve' | 'pvp'},
//   own: {char: Totals} (numbers from the character window, replace the page's), open: {section: bool},
//   pin: {cls: {pinKey: 1 want | -1 never}}, done: {char: [pinKey]} (click order steps ticked off in the game) }
// Live: U.daeLive[char] = { at, cls, level, open: {slot: [row * 32 + col, …]}, skills: {name: level}, gear, cp: [[at, cp]],
//   game, webOpen }
// Open nodes from the website or, newer and preferred, from the game (packet 0x26e2 at login, host 'daeGame'); skill
// levels, gear and Combat Power only from the website, whose skill level includes the Daevanion levels of the boards
// it showed then (webOpen, when the open nodes came from the game since).
import { G, U, V, bump, saveUi, type Any } from '@/core/state'
import { host, onHost } from '@/core/host'
import { lang, t } from '@/core/i18n'
import { toast } from '@/core/toast'
import { LIVE, NONE_HINT, ago, charKey, gameClass, gameLevel, getJson, profile as srcProfile, resolve, watch, type Profile } from './source'
import { buildGraph, type Graph, type Plan } from './optimize'
import { TYPICAL, evaluate, type Key, type Mode, type Totals } from './model'
import { gearTotals, parseCp, parseItem, parseStats, type Gear } from './character'
import { CLASS_DEF, DEFAULT_BASE, POOL_MODE, modelCtx, nodeEffects, type ClassData, type DaeData, type Pool, type RawNode, type Weights } from './values'
import { breakdown, evalSet, solve, type SolveIn, type SolveOut } from './solve'

export type Mode2 = 'respec' | 'add'
export type Live = {
  at: number; cls: string; level: number | null; open: Record<string, number[]>; skills?: Record<string, number>
  gear?: Gear; cp?: [number, number][]
  /** Open nodes from the game (time); `webOpen` = the website's open nodes that go with `skills`. */
  game?: number; webOpen?: Record<string, number[]>
  /** Spent points per pool as the game reports them (0x2ee2), and the highest ever seen: a pool's points never shrink,
   *  so that is at least its total (the game does not send the free points); a reset does not change the plan. */
  spent?: Partial<Record<Pool, number>>; spentMax?: Partial<Record<Pool, number>>
}

fetch('daevanion.json').then(r => r.json()).then(d => { G.dae = d; bump() }).catch(() => { G.dae = false; bump() })

export { LIVE, NONE_HINT, ago, charKey }

export const data = (): DaeData | null => G.dae || null
export const pos = (r: number, c: number) => r * 32 + c

export function settings(): Any {
  U.dae ||= {}
  const s = U.dae
  s.mode ||= 'respec'
  for (const k of ['off', 'use', 'base', 'assume', 'ignore', 'heal', 'pmode', 'own', 'open', 'pin', 'done', 'pctW']) s[k] ||= {}
  s.free ??= 0; s.ariel ??= 0; s.pvp ??= 0
  return s
}
export function save(patch: Any) { Object.assign(settings(), patch); saveUi(['dae']); bump() }

export const live = (char = charKey()): Live | undefined => U.daeLive?.[char]
export const profile = (char = charKey()): Profile | undefined => srcProfile(char)

/** Class id: from the website boards, else the game, else chosen in the tab, else guessed from the linked profile,
 *  else Gladiator. */
export function classId(): string {
  const l = live(), s = settings(), d = data(), g = gameClass()
  if (l?.cls) return l.cls
  if (g && d?.classes[g]) return g
  if (s.cls && d?.classes[s.cls]) return s.cls
  const name = (profile() as { cls?: string } | undefined)?.cls?.toLowerCase()
  const hit = name && d && Object.entries(d.classes).find(([, c]) => c.en.toLowerCase() === name || c.de.toLowerCase() === name)
  return hit ? hit[0] : '1'
}
export const className = (c: ClassData) => (lang() === 'de' ? c.de : c.en)
export const weights = (cls: string): Weights => {
  const s = settings()
  return {
    off: s.off[cls] ?? CLASS_DEF[cls]?.off ?? 0.5, mode: { ...POOL_MODE, ...s.pmode }, use: s.use[cls] || {}, base: s.base[cls] || {},
    assume: s.assume[cls] || {}, ignore: s.ignore[cls] || [], heal: s.heal[cls] ?? CLASS_DEF[cls]?.heal ?? 0,
    pctW: s.pctW?.[cls] ?? 1.5,
  }
}

// ---------------------------------------------------------------- website boards, skills, gear

const DETAIL = 'https://aion2.plaync.com/api/character/daevanion/detail'
const INFO = 'https://aion2.plaync.com/api/character/info'
const EQUIP = 'https://aion2.plaync.com/api/character/equipment'
const ITEM = 'https://aion2.plaync.com/api/character/equipment/item'
const q = (p: Profile) => `lang=en-US&characterId=${p.id}&serverId=${p.serverId}&region=${p.region}`
export const infoUrl = (p: Profile) => `${INFO}?${q(p)}`
export const boardUrl = (p: Profile, id: number) => `${DETAIL}?${q(p)}&boardId=${id}`
export const equipUrl = (p: Profile) => `${EQUIP}?${q(p)}`
export const itemUrl = (p: Profile, s: { id: number; enchantLevel: number; slotPos: number }) => `${ITEM}?${q(p)}&id=${s.id}&enchantLevel=${s.enchantLevel}&slotPos=${s.slotPos}`

/** Website skill list -> {name: level} (active + passive skills; the level includes Daevanion levels). */
export function parseSkills(equip: Any): Record<string, number> {
  const out: Record<string, number> = {}
  for (const x of equip?.skill?.skillList || []) if ((x.category === 'Active' || x.category === 'Passive') && typeof x.skillLevel === 'number') out[x.name] = x.skillLevel
  return out
}

/** Website answers -> Live. `boards` = detail answers by board id. */
export function parseLive(info: Any, boards: Record<number, Any>, at = Date.now()): Live | null {
  const list: Any[] = info?.daevanion?.boardList || []
  if (!list.length) return null
  const open: Record<string, number[]> = {}
  for (const b of list) {
    const nodes: Any[] = boards[b.id]?.nodeList || []
    open[String(b.id % 10)] = nodes.filter(n => n.open === 1 && n.type !== 'Start').map(n => pos(n.row, n.col))
  }
  const lv = info?.profile?.characterLevel
  return { at, cls: String(Math.floor(list[0].id / 10)), level: typeof lv === 'number' ? lv : null, open }
}

/** Live boards from the game: {board id: [node id]} (node id = board * 10000 + (row - 1) * 15 + col, Start included).
 *  Level, skill levels, gear and Combat Power stay from the website (`prev`) while the class matches. */
export function parseGame(boards: Record<string, number[]>, prev: Live | undefined, at = Date.now()): Live | null {
  const ids = Object.keys(boards).map(Number).filter(b => b > 10)
  if (!ids.length) return null
  const cls = String(Math.floor(ids[0] / 10)), open: Record<string, number[]> = {}
  for (const b of ids) open[String(b % 10)] = boards[b].map(id => id % 10000).filter(i => i !== 113).map(i => pos(Math.floor((i - 1) / 15) + 1, (i - 1) % 15 + 1))
  const same = prev?.cls === cls
  return {
    at, cls, level: same ? prev!.level : gameLevel(), open, game: at,
    ...(same && prev!.skills ? { skills: prev!.skills, webOpen: prev!.webOpen ?? prev!.open } : {}),
    ...(same ? { gear: prev!.gear, cp: prev!.cp, spent: prev!.spent, spentMax: prev!.spentMax } : {}),
  }
}

/** Nodes bought / reset in the game (node ids) applied to the live boards; nodes of another class are ignored. */
export function applyNodes(l: Live, bought: number[], reset: number[], at = Date.now()): Live {
  const open = Object.fromEntries(Object.entries(l.open).map(([k, v]) => [k, [...v]]))
  const at_ = (id: number) => { const i = id % 10000; return { slot: String(Math.floor(id / 10000) % 10), p: pos(Math.floor((i - 1) / 15) + 1, (i - 1) % 15 + 1), cls: String(Math.floor(id / 100000)) } }
  for (const id of bought) { const x = at_(id); if (x.cls !== l.cls || id % 10000 === 113) continue; open[x.slot] ||= []; if (!open[x.slot].includes(x.p)) open[x.slot].push(x.p) }
  for (const id of reset) { const x = at_(id); if (x.cls !== l.cls) continue; open[x.slot] = (open[x.slot] || []).filter(p => p !== x.p) }
  return { ...l, open, at, game: at }
}

// the game's boards: for the character logged in (the name may come a moment after the boards)
let gameBoards: Record<string, number[]> | null = null
function applyGame() {
  const char = charKey()
  if (!gameBoards || !char) return
  const l = parseGame(gameBoards, U.daeLive?.[char])
  gameBoards = null
  if (!l) return
  U.daeLive ||= {}
  U.daeLive[char] = l
  saveUi(['daeLive'])
  // fresh boards: the ticked steps are owned now
  if (settings().done[char]?.length) save({ done: { ...settings().done, [char]: [] } })
  bump()
}
onHost('daeGame', m => { gameBoards = m.boards; applyGame() })
// spent points per pool from the game (0x2ee2 at login and on every buy / reset). Pools as checked against a login
// capture: 1 = Nezekan–Triniel (93 + 107 + 105 + 111 = 416), 2 = Ariel (71), 3 = Azphel (0).
const GAME_POOL: Record<string, Pool> = { 1: 'pve', 2: 'ariel', 3: 'pvp' }
onHost('daePoints', m => {
  const char = charKey(), l = U.daeLive?.[char]
  if (!l || !m.pools) return
  const spent = { ...l.spent }, spentMax = { ...l.spentMax }
  for (const [k, v] of Object.entries(m.pools)) if (GAME_POOL[k] && typeof v === 'number') {
    spent[GAME_POOL[k]] = v
    spentMax[GAME_POOL[k]] = Math.max(spentMax[GAME_POOL[k]] ?? 0, v)
  }
  U.daeLive[char] = { ...l, spent, spentMax }
  saveUi(['daeLive']); bump()
})
// nodes bought / reset in the game while playing (0x03e5 / 0x28e2 / 0x2be2): the current boards follow at once
onHost('daeNodes', m => {
  const char = charKey(), l = U.daeLive?.[char]
  if (!l) return
  U.daeLive[char] = applyNodes(l, m.bought || [], m.reset || [])
  saveUi(['daeLive']); bump()
})
onHost('pvp', () => setTimeout(applyGame, 0))

export const loading = new Set<string>()

/** Load the character from the website: boards, skill levels, gear, stats, Combat Power. `quiet` = no toast on
 *  failure (automatic loads). */
export async function loadLive(char = charKey(), quiet = false) {
  const p0 = profile(char)
  if (!p0 || loading.has(char)) return
  loading.add(char); bump()
  try {
    const p = await resolve(p0)
    const info = await getJson(infoUrl(p)), boards: Record<number, Any> = {}
    for (const b of info?.daevanion?.boardList || []) if (b.open && b.openNodeCount > 0) boards[b.id] = await getJson(boardUrl(p, b.id))
    const l = parseLive(info, boards)
    if (!l) throw new Error('empty')
    const old = live(char), cp = parseCp(info)
    l.cp = [...(old?.cp || []), ...(cp != null ? [[l.at, cp] as [number, number]] : [])].slice(-20)
    try {
      const eq = await getJson(equipUrl(p))
      l.skills = parseSkills(eq)
      const items = []
      for (const s of eq?.equipment?.equipmentList || []) items.push(parseItem(s, await getJson(itemUrl(p, s))))
      l.gear = { at: l.at, items, stats: parseStats(info) }
    } catch { /* boards without skill levels / gear */ }
    // the game's open nodes are newer than the website's: keep them, take level, skill levels, gear and CP from it
    U.daeLive ||= {}
    U.daeLive[char] = old?.game && old.cls === l.cls ? { ...old, level: l.level ?? old.level, skills: l.skills, webOpen: l.open, gear: l.gear, cp: l.cp }
      : { ...l, ...(old?.cls === l.cls ? { spent: old.spent, spentMax: old.spentMax } : {}) }
    saveUi(['daeLive'])
    // fresh boards: the ticked steps are owned now
    if (!old?.game && settings().done[char]?.length) save({ done: { ...settings().done, [char]: [] } })
  } catch (e) {
    host({ type: 'log', msg: `Daevanion ${char}: ${(e as Error)?.message || e}` })
    if (!quiet) toast(t('dae.err'), t('dae.errSub'))
  } finally {
    loading.delete(char); bump()
  }
}

watch(char => void loadLive(char, true))

/** Cycle a node's pin: none -> want -> never -> none. */
export function togglePin(cls: string, key: string) {
  const s = settings(), m = { ...(s.pin[cls] || {}) }, v = m[key]
  if (v === 1) m[key] = -1; else if (v === -1) delete m[key]; else m[key] = 1
  save({ pin: { ...s.pin, [cls]: m } })
}
/** Tick a click order step off (or back on). */
export function toggleDone(key: string, char = charKey()) {
  const s = settings(), list: string[] = s.done[char] || []
  save({ done: { ...s.done, [char]: list.includes(key) ? list.filter(x => x !== key) : [...list, key] } })
}

export function forgetLive(char = charKey()) { if (U.daeLive?.[char]) { delete U.daeLive[char]; saveUi(['daeLive']); bump() } }

// ---------------------------------------------------------------- character state

export type Ref = { slot: string; n: RawNode }
/** Key of a node for pins and ticks: board slot and position. */
export const pinKey = (r: Ref) => `${r.slot}:${pos(r.n[0], r.n[1])}`
/** Point pools: the four skill boards share one, Ariel and Azphel have their own points. */
export const POOLS: Pool[] = ['pve', 'ariel', 'pvp']
/** Settings key of a pool's points. */
export const POOL_KEY: Record<Pool, 'free' | 'ariel' | 'pvp'> = { pve: 'free', ariel: 'ariel', pvp: 'pvp' }

/** Boards of a pool the character may use (unlock level). */
export function poolSlots(c: ClassData, pool: Pool, level: number | null) {
  return Object.entries(c.boards).filter(([, b]) => b.pool === pool && (level == null || b.level <= level)).map(([k]) => k)
}

const isOpen = (l: Live | undefined, slot: string, n: RawNode) => !!l?.open[slot]?.includes(pos(n[0], n[1]))

/** Daevanion skill levels and model stats of the open nodes, per pool. */
function openOf(d: DaeData, c: ClassData, l: Live | undefined, ignore: Key[]) {
  const by: Record<Pool, { t: Totals; lv: number[] }> = { pve: { t: {}, lv: c.skills.map(() => 0) }, ariel: { t: {}, lv: c.skills.map(() => 0) }, pvp: { t: {}, lv: c.skills.map(() => 0) } }
  if (l) for (const [slot, b] of Object.entries(c.boards)) for (const n of b.nodes) if (isOpen(l, slot, n)) {
    const x = by[b.pool]
    if (n[3] === 2) x.lv[n[4] as number]++
    for (const [k, a] of nodeEffects(n, d.stats, ignore)) x.t[k] = (x.t[k] || 0) + a
  }
  return by
}

/** Where a total comes from: the page (gear + main / deity stats + open Daevanion nodes), a typical character while
 *  the page gives no gear, or the player. */
export function charTotals(d: DaeData, cls: string, char = charKey()) {
  const l = live(char), mine = l?.cls === cls ? l : undefined, w = weights(cls), open = openOf(d, d.classes[cls], mine, w.ignore)
  const page: Totals = { ...gearTotals(mine?.gear) }
  for (const p of POOLS) for (const [k, a] of Object.entries(open[p].t)) page[k as Key] = (page[k as Key] || 0) + (a as number)
  const own: Totals = settings().own[char] || {}
  // no gear from the page: a typical character instead (model.TYPICAL), the open nodes on top
  const typical: Totals = mine?.gear ? {} : TYPICAL
  const all: Totals = { ...typical }
  for (const [k, a] of Object.entries(page)) all[k as Key] = (mine?.gear ? 0 : typical[k as Key] || 0) + (a as number)
  return { page, own, typical, all: { ...all, ...own } as Totals, open, live: mine }
}

/** Skill level without any Daevanion per skill index: entered in the tab, else website level minus the open
 *  Daevanion levels, else DEFAULT_BASE; `known` = not guessed. */
export function skillBases(c: ClassData, l: Live | undefined, w: Weights) {
  const dae = c.skills.map(() => 0)
  // the website's skill level includes the Daevanion levels of the boards it showed then (webOpen)
  const web = l && { ...l, open: l.webOpen ?? l.open }
  if (web) for (const [slot, b] of Object.entries(c.boards)) for (const n of b.nodes) if (n[3] === 2 && isOpen(web, slot, n)) dae[n[4] as number]++
  return c.skills.map((sk, si) => {
    if (w.base[sk.en] != null) return { lv: w.base[sk.en], src: 'own' as const }
    if (l?.skills?.[sk.en] != null) return { lv: Math.max(1, l.skills[sk.en] - dae[si]), src: 'page' as const }
    return { lv: DEFAULT_BASE, src: 'guess' as const }
  })
}

// ---------------------------------------------------------------- plan

export type PoolPlan = {
  pool: Pool; mode: Mode; slots: string[]; g: Graph; refs: Ref[]; inp: SolveIn
  /** The search key (its inputs). */
  key: string
  /** Owned now (website) incl. starts, and the plan; `pending` while the worker still searches. */
  cur: Set<number>; plan: Plan; pending: boolean
  /** Points spent now, total points (entered, at least spentNow), points the plan may use (respec: all, add: the free ones). */
  spentNow: number; total: number; budget: number
}

/** Solver input of a pool. `points` = the character's total points of this pool (what the game shows). */
/** Stats and skill levels the plans of the pools before this one add ("respec": the pools are planned one after the
 *  other on the character without any Daevanion, so the plan never depends on the boards the character has now). */
export type Prior = { t: Totals; lv: number[] }

export function poolInput(d: DaeData, cls: string, pool: Pool, mode: Mode2, points: number, prior?: Prior) {
  const c = d.classes[cls], w = weights(cls), ct = charTotals(d, cls), l = ct.live
  const slots = poolSlots(c, pool, l?.level ?? gameLevel()), refs: Ref[] = []
  const ctx = modelCtx(c, cls, w.mode[pool], w)
  // respec: the character without any Daevanion node, plus the plans of the pools before (prior); add: without this
  // pool's nodes, the other pools as they are (adding builds on the boards the character has)
  const base: Totals = { ...ct.all }
  for (const p of mode === 'respec' ? POOLS : [pool]) for (const [k, a] of Object.entries(ct.open[p].t)) base[k as Key] = (base[k as Key] || 0) - (a as number)
  if (mode === 'respec') for (const [k, a] of Object.entries(prior?.t || {})) base[k as Key] = (base[k as Key] || 0) + (a as number)
  const nodae = skillBases(c, l, w)
  const lv = c.skills.map((_, si) => nodae[si].lv + (mode === 'respec' ? prior?.lv[si] ?? 0 : POOLS.filter(p => p !== pool).reduce((n, p) => n + ct.open[p].lv[si], 0)))
  const boards = slots.map(slot => ({
    b: +slot,
    nodes: c.boards[slot].nodes.map(n => {
      refs.push({ slot, n })
      const pct = n[3] === 1 && (n[4] as [number, number][]).some(([si]) => d.stats[si].pct) || undefined
      return { r: n[0], c: n[1], cost: n[2], start: n[3] === 0 || undefined, eff: nodeEffects(n, d.stats, w.ignore), skill: n[3] === 2 ? n[4] as number : undefined, pct }
    }),
  }))
  const g = buildGraph(boards.map(b => ({ b: b.b, nodes: b.nodes.map(n => ({ ...n, v: 0 })) })))
  const cur = new Set(g.starts)
  refs.forEach((x, i) => { if (isOpen(l, x.slot, x.n)) cur.add(i) })
  let spentNow = 0
  for (const i of cur) spentNow += g.nodes[i].cost
  // fewer points than spent (nothing entered yet): the spent ones, also as the game counts them (0x2ee2)
  const total = Math.max(points, spentNow, l?.spent?.[pool] ?? 0, l?.spentMax?.[pool] ?? 0), budget = mode === 'respec' ? total : total - spentNow
  // pinned nodes ("slot:row*32+col" -> 1 want / -1 never), per class
  const pin: Record<string, number> = settings().pin[cls] || {}, want: number[] = [], ban: number[] = []
  refs.forEach((x, i) => { const v = pin[pinKey(x)]; if (v === 1) want.push(i); else if (v === -1 && !(mode === 'add' && cur.has(i))) ban.push(i) })
  const inp: SolveIn = { boards, base, lv, ctx, w: w.off, budget, locked: mode === 'add' ? [...cur] : [], want, ban, pctW: w.pctW }
  return { pool, mode: ctx.mode, slots, g, refs, inp, cur, spentNow, total, budget }
}

const toPlan = (o: SolveOut): Plan => ({ owned: new Set(o.owned), order: o.order, spent: o.spent, value: o.score })

// worker: one at a time per key; results land in `done`
const done = new Map<string, SolveOut>()
const asked = new Set<string>()
let worker: Worker | null | undefined, seq = 0
const waiting = new Map<number, string>()
function ask(key: string, inp: SolveIn) {
  if (asked.has(key)) return
  asked.add(key)
  if (worker === undefined) {
    try {
      worker = typeof Worker === 'undefined' ? null : new Worker(new URL('./solve.worker.ts', import.meta.url), { type: 'module' })
      worker?.addEventListener('message', (e: MessageEvent<{ id: number; out: SolveOut }>) => {
        const k = waiting.get(e.data.id)
        if (k) { waiting.delete(e.data.id); if (done.size > 60) { done.clear(); asked.clear(); asked.add(k) } done.set(k, e.data.out); bump() }
      })
    } catch { worker = null }
  }
  if (!worker) { done.set(key, solve(inp)); return }
  const id = ++seq
  waiting.set(id, key)
  worker.postMessage({ id, inp })
}

const memo: Partial<Record<Mode2, { key: string; res: PoolPlan[] }>> = {}
/** Every pool for the current settings (memoized per mode: the tab re-renders often). The quick greedy plan shows at
 *  once, the searched one replaces it when the worker is done (without a worker: searched right away). */
export function plans(mode: Mode2 = settings().mode): PoolPlan[] {
  const d = data()
  if (!d) return []
  const s = settings(), cls = classId(), l = live()
  const key = JSON.stringify([mode, cls, s.free, s.ariel, s.pvp, weights(cls), s.own[charKey()], s.pin[cls], l?.at, l?.cls, l?.spent, gameLevel()])
  if (memo[mode]?.key === key && memo[mode]!.res.every(r => !r.pending || !done.has(r.key))) return memo[mode]!.res
  // one pool after the other; a pool's search runs on exactly its inputs (key), so a change elsewhere (a node bought
  // in the game while planning a respec) finds the same key and the same plan: no flicker, no new search
  let prior: Prior | undefined
  const res = POOLS.map(p => {
    const x = poolInput(d, cls, p, mode, s[POOL_KEY[p]], prior)
    const k = JSON.stringify([x.inp.base, x.inp.lv, x.inp.budget, x.inp.locked, x.inp.want, x.inp.ban, x.inp.w, x.inp.pctW, x.inp.ctx.mode, x.inp.ctx.a, x.inp.ctx.skills.map(z => z.w), x.slots])
    ask(k, x.inp)
    const o = done.get(k)
    const plan = toPlan(o ?? solve({ ...x.inp, iters: 0, rounds: 1 }))
    if (mode === 'respec') {
      const nodes = x.inp.boards.flatMap(b => b.nodes), t: Totals = { ...prior?.t }, lv = prior ? [...prior.lv] : d.classes[cls].skills.map(() => 0)
      for (const i of plan.owned) { for (const [kk, a] of nodes[i].eff || []) t[kk] = (t[kk] || 0) + a; if (nodes[i].skill != null) lv[nodes[i].skill!]++ }
      prior = { t, lv }
    }
    return { ...x, key: k, plan, pending: !o }
  })
  memo[mode] = { key, res }
  return res
}

/** Model numbers of a pool's set: damage / healing / EHP change in percent against the pool without Daevanion, score. */
export function numbers(p: PoolPlan, set: Iterable<number>) {
  const r = evalSet(p.inp, set)
  return { dmg: (r.e.dmg / r.e0.dmg - 1) * 100, heal: r.e0.heal ? (r.e.heal / r.e0.heal - 1) * 100 : 0, ehp: (r.e.ehp / r.e0.ehp - 1) * 100, score: r.score }
}
export { breakdown }

/** What one more unit of every Daevanion stat gives at the plan (damage / EHP in percent), for the stat table. */
export function marginals(p: PoolPlan, keys: [Key, number][]) {
  const nodes = p.inp.boards.flatMap(b => b.nodes), t: Totals = { ...p.inp.base }, lv = [...p.inp.lv]
  for (const i of p.plan.owned) { for (const [k, a] of nodes[i].eff || []) t[k] = (t[k] || 0) + a; if (nodes[i].skill != null) lv[nodes[i].skill!]++ }
  const e0 = evaluate(t, lv, p.inp.ctx)
  return keys.map(([k, a]) => {
    const e = evaluate({ ...t, [k]: (t[k] || 0) + a }, lv, p.inp.ctx)
    return { k, a, dmg: (e.dmg / e0.dmg - 1) * 100, ehp: (e.ehp / e0.ehp - 1) * 100 }
  })
}
const worthMemo = new WeakMap<Plan, { dmg: number; ehp: number }[]>()
/** What every node is worth at the plan (damage / EHP in percent): owned ones what removing them costs, the others
 *  what adding them gives (a skill node: one more level of its skill). */
export function nodeWorth(p: PoolPlan) {
  const hit = worthMemo.get(p.plan)
  if (hit) return hit
  const nodes = p.inp.boards.flatMap(b => b.nodes), t: Totals = { ...p.inp.base }, lv = [...p.inp.lv]
  for (const i of p.plan.owned) { for (const [k, a] of nodes[i].eff || []) t[k] = (t[k] || 0) + a; if (nodes[i].skill != null) lv[nodes[i].skill!]++ }
  const e0 = evaluate(t, lv, p.inp.ctx)
  const out = nodes.map((n, i) => {
    const sign = p.plan.owned.has(i) ? -1 : 1, t2: Totals = { ...t }, l2 = [...lv]
    for (const [k, a] of n.eff || []) t2[k] = (t2[k] || 0) + sign * a
    if (n.skill != null) l2[n.skill] += sign
    const e = evaluate(t2, l2, p.inp.ctx)
    return sign > 0 ? { dmg: (e.dmg / e0.dmg - 1) * 100, ehp: (e.ehp / e0.ehp - 1) * 100 } : { dmg: (e0.dmg / e.dmg - 1) * 100, ehp: (e0.ehp / e.ehp - 1) * 100 }
  })
  worthMemo.set(p.plan, out)
  return out
}

/** What one more level of every skill gives at the plan. */
export function skillMarginals(p: PoolPlan) {
  const nodes = p.inp.boards.flatMap(b => b.nodes), t: Totals = { ...p.inp.base }, lv = [...p.inp.lv]
  for (const i of p.plan.owned) { for (const [k, a] of nodes[i].eff || []) t[k] = (t[k] || 0) + a; if (nodes[i].skill != null) lv[nodes[i].skill!]++ }
  const e0 = evaluate(t, lv, p.inp.ctx)
  return lv.map((x, si) => { const l2 = [...lv]; l2[si] = x + 1; const e = evaluate(t, l2, p.inp.ctx); return { si, lv: x, dmg: (e.dmg / e0.dmg - 1) * 100, ehp: (e.ehp / e0.ehp - 1) * 100 } })
}

export type Advice = {
  pool: Pool
  /** Score now, after adding the free points, after a full respec. */
  now: number; add: number; respec: number
  /** Nodes a respec resets and buys. */
  resets: number; buys: number
  /** Owned nodes at the end of a branch that are worth nothing now (MP, skills not used …): count and points. */
  dead: number; deadPoints: number
}

/** What to change on the boards the character has now (only with website boards): per pool with spent points. */
export function advice(): Advice[] {
  const d = data(), l = live(), cls = classId()
  if (!d || !l || l.cls !== cls) return []
  const add = plans('add'), re = plans('respec')
  return add.map((a, k): Advice | null => {
    const r = re[k]
    if (!a.spentNow) return null
    const now = evalSet(a.inp, a.cur).score
    let dead = 0, deadPoints = 0
    for (const i of a.cur) {
      const n = a.refs[i].n
      if (n[3] === 0 || a.g.adj[i].filter(j => a.cur.has(j)).length !== 1) continue
      const without = new Set(a.cur); without.delete(i)
      if (now - evalSet(a.inp, without).score < 1e-6) { dead++; deadPoints += n[2] }
    }
    return {
      pool: a.pool, now, add: a.plan.value, respec: r.plan.value,
      resets: [...r.cur].filter(i => !r.plan.owned.has(i)).length, buys: [...r.plan.owned].filter(i => !r.cur.has(i)).length,
      dead, deadPoints,
    }
  }).filter((x): x is Advice => !!x)
}

/** Stat and skill totals of a node set: stats by index, skill levels by skill index. */
export function totals(p: PoolPlan, set: Set<number>) {
  const stats = new Map<number, number>(), skills = new Map<number, number>()
  for (const i of set) {
    const n = p.refs[i].n
    if (n[3] === 1) for (const [s, a] of n[4] as [number, number][]) stats.set(s, (stats.get(s) || 0) + a)
    else if (n[3] === 2) skills.set(n[4] as number, (skills.get(n[4] as number) || 0) + 1)
  }
  return { stats, skills }
}

// ---------------------------------------------------------------- in-game marks (host: BoardOverlay.cs)

export type OverlayState = { state: 'off' | 'nogame' | 'black' | 'search' | 'found' | 'error'; slot?: string }
onHost('daeOverlay', m => {
  // the board open in the game becomes the board shown in the tab (until the player picks another tile)
  if (m.state === 'found' && m.slot && m.slot !== V.daeOv?.slot) V.daeBoardGame = m.slot
  V.daeOv = { state: m.state, slot: m.slot ?? undefined }
  bump()
})
onHost('daeOverlayDump', m => { V.daeOvDump = m.path ?? false; bump() })
export const overlayState = (): OverlayState => V.daeOv || { state: 'off' }

/** What the in-game overlay needs: every board of the class (its node cells, for finding it on screen) and the marks
 *  of the plan: respec = buy (green) / reset (red); add = the click order without the ticked steps, the next one
 *  gold. (row, col, kind 0 buy / 1 next / 2 reset, step number or 0). */
export function overlayBoards(d: DaeData, cls: string, ps: PoolPlan[], mode: Mode2) {
  const c = d.classes[cls], done: string[] = settings().done[charKey()] || []
  return Object.entries(c.boards).map(([slot, b]) => {
    const marks: [number, number, number, number][] = [], p = ps.find(x => x.slots.includes(slot))
    if (p) {
      if (mode === 'add') {
        const steps = p.plan.order.filter(i => !p.cur.has(i))
        let next = true
        steps.forEach((i, k) => {
          const r = p.refs[i]
          if (done.includes(pinKey(r))) return
          if (r.slot === slot) marks.push([r.n[0], r.n[1], next ? 1 : 0, k + 1])
          next = false
        })
      } else p.refs.forEach((r, i) => {
        if (r.slot !== slot) return
        const own = p.cur.has(i), plan = p.plan.owned.has(i)
        if (plan && !own) marks.push([r.n[0], r.n[1], 0, 0])
        else if (own && !plan) marks.push([r.n[0], r.n[1], 2, 0])
      })
    }
    return { slot, cells: b.nodes.map(n => [n[0], n[1]]), marks }
  })
}

// ---------------------------------------------------------------- packet research (host: Capture.DaeNodeFrame)

/** Frames with node ids of the own boards, while the research log is on (to find buying / resetting a node). */
export type LogHit = { op: string; ids: number[]; at: number }
onHost('daeLogHit', m => { V.daeLogHits = [...(V.daeLogHits || []), { op: m.op, ids: m.ids, at: m.at }].slice(-200); bump() })
export const logHits = (): LogHit[] => V.daeLogHits || []
/** On while the tab is open (DaevTab), no click: the player just buys and resets nodes. */
export function setLog(on: boolean) { if (!!V.daeLogOn === on) return; V.daeLogOn = on; host({ type: 'daeLog', on }) }
