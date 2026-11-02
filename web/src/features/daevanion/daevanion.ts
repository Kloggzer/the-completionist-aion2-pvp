// Daevanion tab: board data (web/public/daevanion.json, via tools/fetch_daevanion.py), the character's current boards
// from the public plaync character page (which character: source.ts, per build), settings and the optimized plan.
//
// Settings: U.dae = { mode: 'respec' | 'add', cls, free (total points Nezekan–Triniel), ariel, pvp (Azphel), off: {cls: 0..1}, mult: {statKey: n}, tiers: {cls: {skill: n}},
//   base: {cls: {skill: level without Daevanion}}, bps: {cls: {skill: [breakpoints]}}, showW }
// Live boards: U.daeLive[char] = { at, cls, level, open: {slot: [row * 32 + col, …]}, skills: {name: level}, game, webOpen }
// Open nodes from the website or, newer and preferred, from the game (private build: packet 0x26e2 at login, host
// 'daeGame'); skill levels only from the website, whose skill level includes the Daevanion levels of the boards it
// showed then (webOpen, when the open nodes came from the game since).
import { G, U, bump, saveUi, type Any } from '@/core/state'
import { host, onHost } from '@/core/host'
import { lang, t } from '@/core/i18n'
import { toast } from '@/core/toast'
import { LIVE, NONE_HINT, ago, charKey, gameClass, gameLevel, getJson, profile as srcProfile, resolve, watch, type Profile } from './source'
import { buildGraph, optimize, setValue, type Graph, type Plan } from './optimize'
import { CLASS_DEF, DEFAULT_BASE, classMult, unitHook, defaultTier, nodeValue, perNodeValue, skillBps, skillCurve, statUnits, type ClassData, type DaeData, type Pool, type RawNode, type Weights } from './values'

export type Mode = 'respec' | 'add'
export type Live = { at: number; cls: string; level: number | null; open: Record<string, number[]>; skills?: Record<string, number>
  /** Open nodes from the game (time); `webOpen` = the website's open nodes that go with `skills`. */
  game?: number; webOpen?: Record<string, number[]> }

fetch('daevanion.json').then(r => r.json()).then(d => { G.dae = d; bump() }).catch(() => { G.dae = false; bump() })

export { LIVE, NONE_HINT, ago, charKey }

export const data = (): DaeData | null => G.dae || null
export const pos = (r: number, c: number) => r * 32 + c

export function settings(): Any {
  U.dae ||= {}
  const s = U.dae
  s.mode ||= 'respec'; s.off ||= {}; s.mult ||= {}; s.tiers ||= {}; s.base ||= {}; s.bps ||= {}
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
  return { off: s.off[cls] ?? CLASS_DEF[cls]?.off ?? 0.5, mult: classMult(cls, s.mult), tiers: s.tiers[cls] || {}, base: s.base[cls] || {}, bps: s.bps[cls] || {}, pvp: !!s.pvpFocus }
}

// ---------------------------------------------------------------- website boards

const DETAIL = 'https://aion2.plaync.com/api/character/daevanion/detail'
const INFO = 'https://aion2.plaync.com/api/character/info'
const EQUIP = 'https://aion2.plaync.com/api/character/equipment'
const q = (p: Profile) => `lang=en-US&characterId=${p.id}&serverId=${p.serverId}&region=${p.region}`
export const infoUrl = (p: Profile) => `${INFO}?${q(p)}`
export const boardUrl = (p: Profile, id: number) => `${DETAIL}?${q(p)}&boardId=${id}`
export const equipUrl = (p: Profile) => `${EQUIP}?${q(p)}`

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
 *  Level and skill levels stay from the website (`prev`) while the class matches. */
export function parseGame(boards: Record<string, number[]>, prev: Live | undefined, at = Date.now()): Live | null {
  const ids = Object.keys(boards).map(Number).filter(b => b > 10)
  if (!ids.length) return null
  const cls = String(Math.floor(ids[0] / 10)), open: Record<string, number[]> = {}
  for (const b of ids) open[String(b % 10)] = boards[b].map(id => id % 10000).filter(i => i !== 113).map(i => pos(Math.floor((i - 1) / 15) + 1, (i - 1) % 15 + 1))
  const same = prev?.cls === cls
  return { at, cls, level: same ? prev!.level : gameLevel(), open, game: at, ...(same && prev!.skills ? { skills: prev!.skills, webOpen: prev!.webOpen ?? prev!.open } : {}) }
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
  saveUi(['daeLive']); bump()
}
onHost('daeGame', m => { gameBoards = m.boards; applyGame() })
onHost('pvp', () => setTimeout(applyGame, 0))

export const loading = new Set<string>()

/** Load the character's boards from the website. `quiet` = no toast on failure (automatic loads). */
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
    try { l.skills = parseSkills(await getJson(equipUrl(p))) } catch { /* boards without skill levels */ }
    // the game's open nodes are newer than the website's: keep them, take level and skill levels from the website
    const prev = U.daeLive?.[char]
    U.daeLive ||= {}
    U.daeLive[char] = prev?.game && prev.cls === l.cls ? { ...prev, level: l.level ?? prev.level, skills: l.skills, webOpen: l.open } : l
    saveUi(['daeLive'])
  } catch (e) {
    host({ type: 'log', msg: `Daevanion ${char}: ${(e as Error)?.message || e}` })
    if (!quiet) toast(t('dae.err'), t('dae.errSub'))
  } finally {
    loading.delete(char); bump()
  }
}

watch(char => void loadLive(char, true))

export function forgetLive(char = charKey()) { if (U.daeLive?.[char]) { delete U.daeLive[char]; saveUi(['daeLive']); bump() } }

// ---------------------------------------------------------------- plan

export type Ref = { slot: string; n: RawNode }
/** Point pools: the four skill boards share one, Ariel and Azphel have their own points. */
export const POOLS: Pool[] = ['pve', 'ariel', 'pvp']
/** Settings key of a pool's points. */
export const POOL_KEY: Record<Pool, 'free' | 'ariel' | 'pvp'> = { pve: 'free', ariel: 'ariel', pvp: 'pvp' }

export type PoolPlan = {
  pool: Pool; slots: string[]; g: Graph; refs: Ref[]
  /** Owned now (website) incl. starts, and the plan. */
  cur: Set<number>; plan: Plan
  /** Points spent now, total points (entered, at least spentNow), points the plan may use (respec: all, add: the free ones). */
  spentNow: number; total: number; budget: number
}

/** Boards of a pool the character may use (unlock level). */
export function poolSlots(c: ClassData, pool: Pool, level: number | null) {
  return Object.entries(c.boards).filter(([, b]) => b.pool === pool && (level == null || b.level <= level)).map(([k]) => k)
}

/** `points` = the character's total points of this pool (what the game shows), not counting what is spent. */
export function planPool(d: DaeData, cls: string, pool: Pool, mode: Mode, points: number, l: Live | undefined): PoolPlan {
  const c = d.classes[cls], units = statUnits(d, cls), w = weights(cls)
  const slots = poolSlots(c, pool, l?.level ?? gameLevel()), refs: Ref[] = []
  const mine = !!l && l.cls === cls
  const isOpen = (slot: string, n: RawNode) => mine && !!l!.open[slot]?.includes(pos(n[0], n[1]))
  // skill nodes form one group per skill: worth something at the breakpoints (see skillCurve)
  const bases = skillBases(c, mine ? l : undefined, w)
  const gf = c.skills.map((sk, si) => skillCurve(perNodeValue(sk, sk.active ? 3 : 2, cls, w), bases[si], skillBps(cls, sk, w)))
  const g = buildGraph(slots.map(slot => ({
    b: +slot,
    nodes: c.boards[slot].nodes.map(n => {
      refs.push({ slot, n })
      return n[3] === 2 ? { r: n[0], c: n[1], cost: n[2], v: 0, grp: n[4] as number }
        : { r: n[0], c: n[1], cost: n[2], v: nodeValue(n, c, cls, units, d.stats, w), start: n[3] === 0 }
    }),
  })), gf)
  const cur = new Set(g.starts)
  refs.forEach((x, i) => { if (isOpen(x.slot, x.n)) cur.add(i) })
  let spentNow = 0
  for (const i of cur) spentNow += g.nodes[i].cost
  // fewer points than spent (nothing entered yet): the spent ones
  const total = Math.max(points, spentNow), budget = mode === 'respec' ? total : total - spentNow
  const plan = optimize(g, budget, mode === 'add' ? cur : new Set(g.starts))
  return { pool, slots, g, refs, cur, plan, spentNow, total, budget }
}

/** Skill level without Daevanion per skill index: entered in the tab, else website level minus the open Daevanion
 *  levels of that skill (all boards), else unknown (null). */
export function skillBases(c: ClassData, l: Live | undefined, w: Weights): (number | null)[] {
  const dae = c.skills.map(() => 0)
  const open = l?.webOpen ?? l?.open
  if (open) for (const [slot, b] of Object.entries(c.boards)) for (const n of b.nodes) if (n[3] === 2 && open[slot]?.includes(pos(n[0], n[1]))) dae[n[4] as number]++
  return c.skills.map((sk, si) => w.base?.[sk.en] ?? (l?.skills?.[sk.en] != null ? Math.max(1, l.skills[sk.en] - dae[si]) : null))
}

const memo: Partial<Record<Mode, { key: string; res: PoolPlan[] }>> = {}
/** Every pool for the current settings (memoized per mode: the tab re-renders often). `mode` = the tab's mode. */
export function plans(mode: Mode = settings().mode): PoolPlan[] {
  const d = data()
  if (!d) return []
  const s = settings(), cls = classId(), l = live()
  const key = JSON.stringify([cls, s.free, s.ariel, s.pvp, weights(cls), l?.at, l?.cls, gameLevel(), unitHook.ver])
  if (memo[mode]?.key === key) return memo[mode]!.res
  const res = POOLS.map(p => planPool(d, cls, p, mode, s[POOL_KEY[p]], l))
  memo[mode] = { key, res }
  return res
}

/** `unused`: the skill is set to "never" (every level wasted). */
export type Waste = { si: number; level: number; top: number; extra: number; points: number; unused?: boolean }
export type Advice = {
  pool: Pool
  /** Value now, after adding the free points, after a full respec. */
  now: number; add: number; respec: number
  /** Nodes a respec resets and buys. */
  resets: number; buys: number
  /** Skill levels above the last breakpoint they reach (worth nothing). */
  waste: Waste[]
  /** MP nodes at the end of a branch (worth nothing, lead nowhere): count and points. */
  mp: number; mpPoints: number
}

/** What to change on the boards the character has now (only with website boards): per pool with spent points. */
export function advice(): Advice[] {
  const d = data(), l = live(), cls = classId()
  if (!d || !l || l.cls !== cls) return []
  const c = d.classes[cls], w = weights(cls), bases = skillBases(c, l, w), add = plans('add'), re = plans('respec')
  const mp = d.stats.findIndex(x => x.key === 'MP')
  return add.map((a, k): Advice | null => {
    const r = re[k]
    if (!a.spentNow) return null
    const count = new Map<number, number[]>()
    for (const i of a.cur) if (a.refs[i].n[3] === 2) { const si = a.refs[i].n[4] as number; count.set(si, [...count.get(si) || [], i]) }
    const waste: Waste[] = []
    for (const [si, nodes] of count) {
      const sk = c.skills[si], b0 = bases[si] ?? DEFAULT_BASE, lv = b0 + nodes.length, cost = a.refs[nodes[0]].n[2] || 0
      if ((w.tiers[sk.en] ?? defaultTier(cls, sk)) === 0) { waste.push({ si, level: lv, top: b0, extra: nodes.length, points: nodes.length * cost, unused: true }); continue }
      const bps = skillBps(cls, sk, w)
      if (!bps.length) continue // every level counts
      const top = Math.max(b0, ...bps.filter(x => x > b0 && x <= lv))
      if (lv > top) waste.push({ si, level: lv, top, extra: lv - top, points: (lv - top) * cost })
    }
    let mpN = 0, mpP = 0
    for (const i of a.cur) {
      const n = a.refs[i].n
      if (n[3] === 1 && (n[4] as [number, number][]).every(([x]) => x === mp) && a.g.adj[i].filter(j => a.cur.has(j)).length === 1) { mpN++; mpP += n[2] }
    }
    return {
      pool: a.pool, now: setValue(a.g, a.cur), add: a.plan.value, respec: r.plan.value,
      resets: [...r.cur].filter(i => !r.plan.owned.has(i)).length, buys: [...r.plan.owned].filter(i => !r.cur.has(i)).length,
      waste: waste.sort((x, y) => y.points - x.points), mp: mpN, mpPoints: mpP,
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
