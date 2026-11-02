// One point pool: from the character's state without this pool's Daevanion (base totals, skill levels) find the
// best node set (pure; runs in solve.worker.ts, in the tests directly).
//
// The model is not additive (crit cap, buckets multiply), the optimizer needs node values: each round values every
// node at a reference set (round 0: the locked nodes, then the plan of round 0): a node in it by what removing it costs, a
// node outside by what adding it gives; a skill by what its k levels from this pool give. The optimizer finds the
// best set for these values; the plan is then scored with the full model. The best plan by the full model wins.
import { buildGraph, connectOrder, optimize, type Graph } from './optimize'
import { evaluate, score, type Ctx, type Eval, type Key, type Totals } from './model'

/** `pct`: the node gives a percent stat (preferred in the choice by SolveIn.pctW). */
export type PoolNode = { r: number; c: number; cost: number; start?: boolean; eff?: [Key, number][]; skill?: number; pct?: boolean }
export type SolveIn = {
  boards: { b: number; nodes: PoolNode[] }[]
  /** Totals and skill levels (per skill index) without this pool's Daevanion nodes. */
  base: Totals; lv: number[]
  ctx: Ctx; w: number
  budget: number; locked: number[]
  /** Percent nodes weigh this much more in the choice (player setting: they scale, flat values fade); the plan's
   *  numbers stay the model's. */
  pctW?: number
  /** Pinned by the player: nodes the plan must have (with the cheapest path to them), nodes it must not buy. */
  want?: number[]; ban?: number[]
  iters?: number; rounds?: number
}
export type SolveOut = { owned: number[]; order: number[]; spent: number; score: number }

/** Flat node list in graph order. */
export const flatNodes = (inp: SolveIn) => inp.boards.flatMap(b => b.nodes)

/** Totals and levels with the nodes of `set` added. */
export function stateOf(inp: SolveIn, set: Iterable<number>, nodes = flatNodes(inp)) {
  const t: Totals = { ...inp.base }, lv = [...inp.lv]
  for (const i of set) {
    const n = nodes[i]
    for (const [k, a] of n.eff || []) t[k] = (t[k] || 0) + a
    if (n.skill != null) lv[n.skill]++
  }
  return { t, lv }
}

/** Model numbers of a set and its score (100 × score: about percent) against the base. */
export function evalSet(inp: SolveIn, set: Iterable<number>, e0 = evaluate(inp.base, inp.lv, inp.ctx)): { e: Eval; e0: Eval; score: number } {
  const { t, lv } = stateOf(inp, set), e = evaluate(t, lv, inp.ctx)
  return { e, e0, score: 100 * score(e, e0, inp.w, inp.ctx.a.healShare) }
}

/** Node values and skill curves at the reference set `ref`. */
export function linearize(inp: SolveIn, ref: Set<number>) {
  const nodes = flatNodes(inp), e0 = evaluate(inp.base, inp.lv, inp.ctx)
  const S = (t: Totals, lv: number[]) => 100 * score(evaluate(t, lv, inp.ctx), e0, inp.w, inp.ctx.a.healShare)
  const { t, lv } = stateOf(inp, ref, nodes), s0 = S(t, lv)
  const v = nodes.map((n, i) => {
    if (!n.eff?.length) return 0
    const t2: Totals = { ...t }, sign = ref.has(i) ? -1 : 1
    for (const [k, a] of n.eff) t2[k] = (t2[k] || 0) + sign * a
    return Math.max(0, sign * (S(t2, lv) - s0)) * (n.pct ? inp.pctW ?? 1 : 1)
  })
  // skill curves: f(k) = what k levels of this pool give on top of the levels outside it, the rest at `ref`
  const size = inp.lv.map(() => 0), own = inp.lv.map(() => 0)
  nodes.forEach((n, i) => { if (n.skill != null) { size[n.skill]++; if (ref.has(i)) own[n.skill]++ } })
  const curves = inp.lv.map((_, si) => {
    if (!size[si]) return [0]
    const at = (k: number) => { const l2 = [...lv]; l2[si] = lv[si] - own[si] + k; return S(t, l2) }
    const f0 = at(0), out = [0]
    for (let k = 1; k <= size[si]; k++) out.push(Math.max(out[k - 1], at(k) - f0))
    return out
  })
  return { v, curves }
}

/** Cost of a banned node: never affordable, so nothing is bought through it. */
const BAN = 1e6

export function graphOf(inp: SolveIn, v: number[], curves: number[][]): Graph {
  const ban = new Set(inp.ban || [])
  let k = 0
  return buildGraph(inp.boards.map(b => ({
    b: b.b, nodes: b.nodes.map(n => { const i = k++; return { r: n.r, c: n.c, cost: ban.has(i) ? BAN : n.cost, start: n.start, v: ban.has(i) ? 0 : v[i], grp: ban.has(i) ? undefined : n.skill } }),
  })), curves.map(c => (n: number) => c[Math.min(n, c.length - 1)]))
}

/** The wanted nodes with the cheapest path from what is owned to each (in buy order, banned nodes avoided). */
export function wantPaths(g: Graph, owned: Set<number>, want: number[]) {
  const have = new Set(owned), out: number[] = []
  for (const w of want) {
    if (have.has(w) || g.nodes[w].cost >= BAN) continue
    const dist = new Float64Array(g.nodes.length).fill(Infinity), par = new Int32Array(g.nodes.length).fill(-1), done = new Uint8Array(g.nodes.length)
    for (const i of have) dist[i] = 0
    for (;;) {
      let u = -1
      for (let i = 0; i < dist.length; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i
      if (u < 0 || u === w) break
      done[u] = 1
      for (const x of g.adj[u]) { const d = dist[u] + g.nodes[x].cost; if (d < dist[x]) { dist[x] = d; par[x] = u } }
    }
    if (dist[w] >= BAN) continue
    const path: number[] = []
    for (let j = w; j >= 0 && !have.has(j); j = par[j]) path.unshift(j)
    for (const j of path) { have.add(j); out.push(j) }
  }
  return out
}

export function solve(inp: SolveIn): SolveOut {
  const rounds = inp.rounds ?? 2, g0 = graphOf(inp, flatNodes(inp).map(() => 0), [])
  const base = new Set([...inp.locked, ...g0.starts])
  // wanted nodes and their paths are locked, their points come off the budget
  const extra = wantPaths(g0, base, inp.want || []), extraCost = extra.reduce((n, i) => n + g0.nodes[i].cost, 0)
  const locked = new Set([...base, ...extra]), budget = Math.max(0, inp.budget - extraCost)
  let best: SolveOut | null = null, ref = new Set<number>(locked)
  for (let r = 0; r < rounds; r++) {
    const { v, curves } = linearize(inp, ref), g = graphOf(inp, v, curves)
    const p = optimize(g, budget, locked, inp.iters ?? 1500, 12345 + r)
    const sc = evalSet(inp, p.owned).score
    if (!best || sc > best.score + 1e-9) best = { owned: [...p.owned], order: connectOrder(g, base, [...extra, ...p.order]), spent: p.spent + extraCost, score: sc }
    const next = new Set(p.owned)
    if ([...next].every(i => ref.has(i)) && next.size === ref.size) break // stable
    ref = next
  }
  return best!
}

/** What each stat (model key) and each skill of `set` is worth: the score lost without it (damage and EHP in percent
 *  of the plan's numbers). */
export function breakdown(inp: SolveIn, set: Iterable<number>) {
  const nodes = flatNodes(inp), all = [...set], full = evalSet(inp, all)
  const stats = new Map<Key, number>(), skills = new Map<number, number>()
  for (const i of all) {
    for (const [k, a] of nodes[i].eff || []) stats.set(k, (stats.get(k) || 0) + a)
    if (nodes[i].skill != null) skills.set(nodes[i].skill!, (skills.get(nodes[i].skill!) || 0) + 1)
  }
  const { t, lv } = stateOf(inp, all, nodes)
  const loss = (t2: Totals, l2: number[]) => {
    const e = evaluate(t2, l2, inp.ctx)
    return { dmg: (full.e.dmg / e.dmg - 1) * 100, heal: e.heal ? (full.e.heal / e.heal - 1) * 100 : 0, ehp: (full.e.ehp / e.ehp - 1) * 100 }
  }
  return {
    stats: [...stats].map(([k, a]) => ({ k, a, ...loss({ ...t, [k]: (t[k] || 0) - a }, lv) })),
    skills: [...skills].map(([si, n]) => { const l2 = [...lv]; l2[si] -= n; return { si, n, ...loss(t, l2) } }),
  }
}
