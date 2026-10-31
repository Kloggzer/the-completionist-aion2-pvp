// Abyss Logs fight files (%USERPROFILE%\.abyss-dps-meter\segments\<id>.abyss, read by the host: AbyssLogs.cs).
// Format (reverse engineered from the files, no schema published): "ABYS", 4 bytes version, varint length + header
// message; then sections of u16 type (little endian) + varint length + message:
//   type 2: players (1 = player { 1 id, 2 { 1 id, 2 name, 3 class, 22 = target { 2 { 16 = skill { 2 { 1 code, 2 name } } } } } })
//   type 3: hits    (1 = hit { 2 source, 3 target, 4 skill, 6 damage, 7 hits (multi-hit 2–4), 9 crit, 12 perfect?,
//                    13 double?, 15 damage over time })
// Flags 12 / 13 are read from their effect: 12 ≈ ×1.1 (Perfect, the top of the damage range), 13 ≈ ×2 (Double).

export type Hit = { src: number; tgt: number; skill: number; dmg: number; hits: number; crit: boolean; perfect: boolean; double: boolean; dot: boolean }
export type Player = { id: number; name: string; cls: string; skills: Map<number, string> }
export type Fight = { id: string; label: string; start: number; end: number; total: number; players: Player[]; hits: Hit[] }

type Msg = Map<number, (number | Uint8Array)[]>

function varint(b: Uint8Array, i: number): [number, number] {
  let r = 0, s = 1
  for (;;) {
    const c = b[i++]
    if (c === undefined) throw new Error('eof')
    r += (c & 0x7f) * s; s *= 128
    if (c < 0x80) return [r, i]
  }
}

/** One protobuf message: field -> values (varints as numbers, length-delimited as bytes; fixed ignored). */
export function message(b: Uint8Array): Msg {
  const m: Msg = new Map()
  let i = 0
  while (i < b.length) {
    let key: number
    ;[key, i] = varint(b, i)
    const f = Math.floor(key / 8), wt = key & 7
    let v: number | Uint8Array
    if (wt === 0) [v, i] = varint(b, i)
    else if (wt === 2) { let n: number; [n, i] = varint(b, i); v = b.subarray(i, i + n); i += n }
    else if (wt === 1) { i += 8; continue }
    else if (wt === 5) { i += 4; continue }
    else throw new Error('wire type ' + wt)
    let a = m.get(f)
    if (!a) m.set(f, a = [])
    a.push(v)
  }
  return m
}

const num = (m: Msg, f: number) => (typeof m.get(f)?.[0] === 'number' ? m.get(f)![0] as number : 0)
const bytes = (m: Msg, f: number) => (m.get(f) || []).filter((x): x is Uint8Array => x instanceof Uint8Array)
const text = (m: Msg, f: number) => { const b = bytes(m, f)[0]; return b ? new TextDecoder().decode(b) : '' }
const sub = (m: Msg, f: number) => bytes(m, f).map(message)

/** Decode a whole .abyss file. */
export function parseFight(b: Uint8Array): Fight {
  if (String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'ABYS') throw new Error('not an Abyss Logs file')
  let [n, i] = varint(b, 8)
  const h = message(b.subarray(i, i + n)); i += n
  const players: Player[] = [], hits: Hit[] = []
  while (i < b.length) {
    const type = b[i] | (b[i + 1] << 8); i += 2
    ;[n, i] = varint(b, i)
    const body = message(b.subarray(i, i + n)); i += n
    if (type === 2) for (const p of sub(body, 1)) {
      const d = sub(p, 2)[0]
      if (!d) continue
      const skills = new Map<number, string>()
      for (const tg of sub(d, 22)) for (const t2 of sub(tg, 2)) for (const s of sub(t2, 16)) for (const s2 of sub(s, 2)) skills.set(num(s2, 1), text(s2, 2))
      players.push({ id: num(d, 1), name: text(d, 2), cls: text(d, 3), skills })
    }
    else if (type === 3) for (const e of sub(body, 1)) hits.push({
      src: num(e, 2), tgt: num(e, 3), skill: num(e, 4), dmg: num(e, 6), hits: num(e, 7) || 1,
      crit: e.has(9), perfect: e.has(12), double: e.has(13), dot: e.has(15),
    })
  }
  return { id: text(h, 1), label: text(h, 2), start: num(h, 3) / 1e6, end: num(h, 4) / 1e6, total: num(h, 6), players, hits }
}

// ---------------------------------------------------------------- analysis

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2 }

/** Weighted median of per-skill ratios (weight = the smaller sample of the pair). */
function ratio(groups: Map<number, Hit[]>, hit: (h: Hit) => boolean, base: (h: Hit) => boolean, min = 4): number | null {
  const rs: { r: number; w: number }[] = []
  for (const hs of groups.values()) {
    const a = hs.filter(hit).map(h => h.dmg), b = hs.filter(base).map(h => h.dmg)
    if (a.length >= min && b.length >= min) rs.push({ r: median(a) / median(b), w: Math.min(a.length, b.length) })
  }
  if (!rs.length) return null
  rs.sort((x, y) => x.r - y.r)
  const half = rs.reduce((s, x) => s + x.w, 0) / 2
  let acc = 0
  for (const x of rs) { acc += x.w; if (acc >= half) return x.r }
  return rs.at(-1)!.r
}

export type Measured = {
  fight: string; at: number; seconds: number; dps: number; hits: number
  /** Crit rate without skills that always crit (specializations), crit damage multiplier. */
  critRate: number; critMult: number | null; alwaysCrit: string[]
  doubleRate: number; doubleMult: number | null
  perfectRate: number; perfectMult: number | null
  multiRate: number; multiMult: number | null
}

/** What one fight says about a player: rates and multipliers of his hits (damage over time left out; class skills
 *  only for the multipliers, item procs like Theostones scale differently). */
export function measure(f: Fight, playerId: number): Measured {
  const p = f.players.find(x => x.id === playerId)
  const mine = f.hits.filter(h => h.src === playerId && !h.dot)
  const groups = new Map<number, Hit[]>()
  for (const h of mine) if (h.skill >= 10_000_000) { let a = groups.get(h.skill); if (!a) groups.set(h.skill, a = []); a.push(h) }
  const always = [...groups.entries()].filter(([, hs]) => hs.length >= 10 && hs.filter(h => h.crit).length / hs.length >= 0.97).map(([k]) => k)
  const counted = mine.filter(h => !always.includes(h.skill))
  const share = (hs: Hit[], f2: (h: Hit) => boolean) => (hs.length ? hs.filter(f2).length / hs.length : 0)
  const plain = (h: Hit) => h.hits === 1 && !h.crit && !h.perfect && !h.double
  const seconds = Math.max(1, (f.end - f.start) / 1000)
  return {
    fight: f.id, at: f.start, seconds, hits: mine.length,
    dps: f.hits.filter(h => h.src === playerId).reduce((s, h) => s + h.dmg, 0) / seconds,
    critRate: share(counted, h => h.crit),
    critMult: ratio(groups, h => h.hits === 1 && h.crit && !h.perfect && !h.double, plain),
    alwaysCrit: always.map(k => p?.skills.get(k) || String(k)),
    doubleRate: share(mine, h => h.double),
    doubleMult: ratio(groups, h => h.hits === 1 && h.double && !h.crit && !h.perfect, plain, 2),
    perfectRate: share(mine, h => h.perfect),
    perfectMult: ratio(groups, h => h.hits === 1 && h.perfect && !h.crit && !h.double, plain, 2),
    multiRate: share(mine, h => h.hits > 1),
    multiMult: ratio(groups, h => h.hits > 1 && !h.crit && !h.perfect && !h.double, plain, 3),
  }
}
