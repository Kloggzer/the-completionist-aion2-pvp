// Daevanion optimizer (pure). A board is a 15×15 grid; a node can be bought when it touches an owned node
// orthogonally, starting from the board's Start node. Several boards that share one point pool are optimized as one
// graph with several start nodes, so the points go to whichever board pays most.
//
// Greedy: from the owned set, find the cheapest path to every node (Dijkstra, cost = node grade) and buy the path
// with the best value per point; repeat while a path with value > 0 fits into the budget. Then local search: drop a
// low-value leaf branch (or a few random ones), refill greedily, keep the result if it is worth more. On the real
// boards this lands within ~1 % of a long random search in well under 100 ms.
//
// Groups: nodes of one skill (one per board) are worth nothing alone but f(count) together (skill level breakpoints:
// +2 may reach level 12, +1 does nothing). The greedy also offers "bundles": the k cheapest nodes of a group at once.

export type Node = { b: number; r: number; c: number; cost: number; v: number; grp: number }
/** `gf[g](k)` = value of owning k nodes of group g (f(0) = 0, never decreasing). */
export type Graph = { nodes: Node[]; adj: number[][]; starts: number[]; gf: ((k: number) => number)[] }
export type Plan = { owned: Set<number>; order: number[]; spent: number; value: number }

/** Graph from boards: node lists with row / col, 4-neighbourhood within each board. */
export function buildGraph(boards: { b: number; nodes: { r: number; c: number; cost: number; v: number; start?: boolean; grp?: number }[] }[],
  gf: ((k: number) => number)[] = []): Graph {
  const nodes: Node[] = [], adj: number[][] = [], starts: number[] = []
  for (const bd of boards) {
    const at = new Map<number, number>()
    for (const n of bd.nodes) {
      at.set(n.r * 32 + n.c, nodes.length)
      if (n.start) starts.push(nodes.length)
      nodes.push({ b: bd.b, r: n.r, c: n.c, cost: n.start ? 0 : n.cost, v: n.start ? 0 : n.v, grp: n.grp ?? -1 })
      adj.push([])
    }
    for (const n of bd.nodes) {
      const i = at.get(n.r * 32 + n.c)!
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = at.get((n.r + dr) * 32 + n.c + dc)
        if (j != null) adj[i].push(j)
      }
    }
  }
  return { nodes, adj, starts, gf }
}

const EPS = 1e-9
/** Owned nodes per group. */
function counts(g: Graph, s: Iterable<number>) {
  const c = new Int32Array(g.gf.length)
  for (const i of s) if (g.nodes[i].grp >= 0) c[g.nodes[i].grp]++
  return c
}
/** Value of a node set: node values plus group values. */
export function setValue(g: Graph, s: Iterable<number>) {
  let v = 0
  for (const i of s) v += g.nodes[i].v
  counts(g, s).forEach((k, gi) => { if (k) v += g.gf[gi](k) })
  return v
}
const sumV = setValue
/** What node i adds to the set it is in (its own value + the group step it makes). */
function contrib(g: Graph, c: Int32Array, i: number) {
  const n = g.nodes[i]
  return n.v + (n.grp >= 0 ? g.gf[n.grp](c[n.grp]) - g.gf[n.grp](c[n.grp] - 1) : 0)
}

/** Cheapest paths from the owned set to every other node (multi-source Dijkstra with a binary heap). */
function paths(g: Graph, owned: Set<number>) {
  const n = g.nodes.length, dist = new Float64Array(n).fill(Infinity), val = new Float64Array(n), par = new Int32Array(n).fill(-1), done = new Uint8Array(n)
  // heap of [dist, -val, node]: cheapest first, on a tie the path worth more
  const h: [number, number, number][] = []
  const less = (a: [number, number, number], b: [number, number, number]) => a[0] < b[0] - EPS || (Math.abs(a[0] - b[0]) <= EPS && a[1] < b[1])
  const push = (e: [number, number, number]) => {
    let i = h.push(e) - 1
    while (i > 0) { const p = (i - 1) >> 1; if (!less(h[i], h[p])) break; [h[i], h[p]] = [h[p], h[i]]; i = p }
  }
  const pop = () => {
    const top = h[0], last = h.pop()!
    if (h.length) {
      h[0] = last
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < h.length && less(h[l], h[m])) m = l
        if (r < h.length && less(h[r], h[m])) m = r
        if (m === i) break
        ;[h[i], h[m]] = [h[m], h[i]]; i = m
      }
    }
    return top
  }
  for (const i of owned) { dist[i] = 0; push([0, 0, i]) }
  while (h.length) {
    const [, , u] = pop()
    if (done[u]) continue
    done[u] = 1
    for (const w of g.adj[u]) {
      if (owned.has(w) || done[w]) continue
      const d = dist[u] + g.nodes[w].cost, v = val[u] + g.nodes[w].v
      // equal cost: prefer the path that is worth more on the way
      if (d < dist[w] - EPS || (Math.abs(d - dist[w]) < EPS && v > val[w])) { dist[w] = d; val[w] = v; par[w] = u; push([d, -v, w]) }
    }
  }
  return { dist, val, par }
}

/** Buy the best value-per-point paths (or group bundles) until nothing of value fits. Mutates owned, returns the
 *  bought nodes in buy order. */
export function fill(g: Graph, owned: Set<number>, budget: number): number[] {
  const order: number[] = [], n = g.nodes.length
  const members: number[][] = g.gf.map(() => [])
  for (let i = 0; i < n; i++) if (g.nodes[i].grp >= 0) members[g.nodes[i].grp].push(i)
  for (;;) {
    const { dist, val, par } = paths(g, owned), c = counts(g, owned)
    const pathOf = (i: number, into: Set<number>) => { for (let j = i; j >= 0 && !owned.has(j) && !into.has(j); j = par[j]) into.add(j); return into }
    // value of buying the node set P (paths): node values + group steps
    const gain = (P: Set<number>) => {
      let v = 0
      const add = new Map<number, number>()
      for (const j of P) { v += g.nodes[j].v; const gr = g.nodes[j].grp; if (gr >= 0) add.set(gr, (add.get(gr) || 0) + 1) }
      for (const [gr, k] of add) v += g.gf[gr](c[gr] + k) - g.gf[gr](c[gr])
      return v
    }
    let best: Set<number> | null = null, bestR = 0, bestC = 0
    const offer = (P: Set<number>) => {
      let cc = 0
      for (const j of P) cc += g.nodes[j].cost
      if (cc > budget + EPS || cc <= 0) return
      const v = gain(P)
      if (v <= EPS) return
      const r = v / cc
      if (r > bestR + EPS || (Math.abs(r - bestR) <= EPS && best && cc < bestC)) { best = P; bestR = r; bestC = cc }
    }
    for (let i = 0; i < n; i++) if (!owned.has(i) && dist[i] <= budget + EPS) {
      // a path without group nodes is worth its static value; others need the group steps
      if (val[i] > EPS || g.nodes[i].grp >= 0) offer(pathOf(i, new Set()))
    }
    // bundles: the k cheapest missing nodes of a group together (reaches a breakpoint single nodes cannot)
    members.forEach(ms => {
      const open = ms.filter(i => !owned.has(i) && dist[i] < Infinity).sort((a, b) => dist[a] - dist[b])
      const P = new Set<number>()
      for (let k = 0; k < open.length; k++) { pathOf(open[k], P); if (k) offer(new Set(P)) }
    })
    if (!best) return order
    // buy in an order that keeps everything connected
    for (const i of connectOrder(g, owned, [...(best as Set<number>)])) { owned.add(i); order.push(i) }
    budget -= bestC
  }
}

/** Owned nodes whose removal keeps every board connected to its start (and are not locked). */
function leaves(g: Graph, owned: Set<number>, locked: Set<number>) {
  return [...owned].filter(i => !locked.has(i) && g.adj[i].filter(j => owned.has(j)).length === 1)
}

/** Drop leaf i and then every new leaf that adds nothing (pure path nodes, group nodes past a breakpoint). */
function prune(g: Graph, owned: Set<number>, locked: Set<number>, i: number) {
  owned.delete(i)
  for (let changed = true; changed;) {
    changed = false
    const c = counts(g, owned)
    for (const j of leaves(g, owned, locked)) if (contrib(g, c, j) <= EPS) { owned.delete(j); c[g.nodes[j].grp] -= g.nodes[j].grp >= 0 ? 1 : 0; changed = true }
  }
}

const cost = (g: Graph, s: Iterable<number>) => { let c = 0; for (const i of s) c += g.nodes[i].cost; return c }

/** Best connected selection for `budget` points. `locked` nodes stay owned (starts, or the current board in
 *  "add" mode); `budget` counts the points on top of the locked nodes. */
export function optimize(g: Graph, budget: number, locked: Set<number> = new Set(g.starts), rounds = 60, kicks = 150): Plan {
  const base = new Set([...locked, ...g.starts]), total = cost(g, base) + budget
  let owned = new Set(base)
  let order = fill(g, owned, budget)
  let value = sumV(g, owned)
  // local search: try the cheapest-value leaves first; accept the first improvement, stop when none helps
  for (let round = 0; round < rounds; round++) {
    const c = counts(g, owned), w = (i: number) => contrib(g, c, i) / g.nodes[i].cost
    const cand = leaves(g, owned, base).sort((a, b) => w(a) - w(b)).slice(0, 12)
    let improved = false
    for (const i of cand) {
      const next = new Set(owned)
      prune(g, next, base, i)
      fill(g, next, total - cost(g, next))
      const v = sumV(g, next)
      if (v > value + 1e-6) { owned = next; value = v; improved = true; break }
    }
    if (!improved) break
  }
  // perturbation: drop a few random leaf branches at once and refill (escapes what single drops cannot); seeded, so
  // the same settings always give the same plan
  let seed = 12345
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let it = 0; it < kicks; it++) {
    const next = new Set(owned), k = 2 + Math.floor(rnd() * 6)
    for (let j = 0; j < k; j++) {
      const lv = leaves(g, next, base)
      if (!lv.length) break
      prune(g, next, base, lv[Math.floor(rnd() * lv.length)])
    }
    fill(g, next, total - cost(g, next))
    const v = sumV(g, next)
    if (v > value + 1e-6) { owned = next; value = v }
  }
  // buy order of the final set: the greedy order where it still applies, the rest connected outward from the base
  const keep = order.filter(i => owned.has(i)), seen = new Set([...base, ...keep])
  order = connectOrder(g, base, [...keep, ...[...owned].filter(i => !seen.has(i))])
  return { owned, order, spent: cost(g, owned) - cost(g, base), value }
}

/** Sort nodes into an order in which each one touches an already owned one (keeps the given order where possible). */
export function connectOrder(g: Graph, base: Set<number>, nodes: number[]): number[] {
  const have = new Set(base), left = [...nodes], out: number[] = []
  while (left.length) {
    const k = left.findIndex(i => g.adj[i].some(j => have.has(j)))
    if (k < 0) break // not connected (cannot happen for optimizer output)
    const [i] = left.splice(k, 1)
    have.add(i); out.push(i)
  }
  return out
}

/** True if every owned node of every board is connected to a start through owned nodes. */
export function connected(g: Graph, owned: Set<number>): boolean {
  const seen = new Set(g.starts.filter(s => owned.has(s))), q = [...seen]
  while (q.length) for (const j of g.adj[q.pop()!]) if (owned.has(j) && !seen.has(j)) { seen.add(j); q.push(j) }
  return [...owned].every(i => seen.has(i))
}
