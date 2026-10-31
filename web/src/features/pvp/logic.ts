// PvP overlay: which players to list, in which order, and how (pure, unit tested in logic.test.ts).
// The host decodes the players around (PlayerFrames.cs: spawn 0x4536 with class, server, level, item level and
// combat power, moves, despawn), the arena roster (0x19e3, teams), the own party (0x92 / 0xd92 / 0x2292) and the own
// character (0x3336 / 0x5636) and sends them as 'pvp'. Here: two sections – enemies (arena: the other team, elsewhere:
// the other faction) and the own team (arena: own roster team, elsewhere: own party / alliance; self always, marked) –
// nearest first, limited; combat power from the packet, else from NCSOFT's character website ('pvpLookup' -> 'pvpWeb').
/* eslint-disable @typescript-eslint/no-explicit-any */

/** `gone`: 0 around, 1 out of range, 2 dead (the host keeps both for 5 s); `by` / `bySrv` = killer (0x048d). */
export type PvpPlayer = { ent: number; name: string; srv: number; pc: number; race: number; lv: number; il: number; cp: number; x: number; z: number
  gone?: number; by?: string; bySrv?: number }
/** Kill around (host: 0x048d with a player victim, self included). */
export type PvpKill = { age: number; victim: string; vSrv: number; vRace: number; killer: string; kSrv: number }
export type RosterMember = { name: string; srv: number; pc: number; race: number; lv: number; team: number }
/** Member of the own party / alliance (host: PlayerFrames.ParseParty). 0 = unknown. */
export type PartyMember = { name: string; srv: number; pc: number; lv: number; il: number; cp: number }
export type Own = { name: string; srv: number; pc: number; race: number; lv: number; il: number; cp: number }
export type WebInfo = { state: 'busy' | 'ok' | 'none' | 'err'; cp?: number; il?: number; cls?: string }
/** `team` = second section with the own team, `teamLimit` = its rows, `self` = oneself as a row of it (marked). */
export type PvpCfg = { limit: number; all: boolean; team?: boolean; teamLimit?: number; self?: boolean }
/** Combat power relative to the own one: weaker (green), similar (yellow), stronger (red); null = unknown. */
export type Tier = 'weak' | 'even' | 'strong' | null
export type PvpRow = {
  key: string; name: string; srv: number; cls: number; lv: number; il: number; cp: number
  /** where the CP comes from: packet, website, website lookup running, not found there, unknown */
  cpSrc: 'pkt' | 'web' | 'busy' | 'none' | 'unknown'
  tier: Tier; dist: number | null; team: number
  /** oneself (team section) */
  me?: boolean
  /** 1 out of range, 2 dead (still listed for a moment); killer */
  gone?: number; by?: string; bySrv?: number
  /** enemy group (moving together, groupsOf), 1 = A ... */
  grp?: number
}
/** `team` = own team rows (null = section off), `teamTotal` = own team size before the limit. */
export type PvpResult = { rows: PvpRow[]; total: number; arena: boolean; lookups: { name: string; srv: number }[]; team: PvpRow[] | null; teamTotal: number }

/** Class from the pcId (class + look): 2 Gladiator, 3 Templar, 4 Ranger, 5 Assassin, 6 Spiritmaster, 7 Sorcerer,
 *  8 Cleric, 9 Chanter (pcId 12 = Templar, 15/16 = Ranger, 30/32 = Cleric ... checked on the character website). */
export const classOf = (pc: number) => (pc > 0 && pc <= 40 ? Math.ceil(pc / 4) : 0)
/** Faction from the server key: 1xxx Elyos (1), 2xxx Asmodian (2). */
export const raceOfServer = (srv: number) => (srv >= 2000 && srv < 3000 ? 2 : srv >= 1000 && srv < 2000 ? 1 : 0)
export const webKey = (name: string, srv: number) => `${name}@${srv}`

/** ±10 % of the own CP counts as similar. */
export function cpTier(cp: number, own: number, band = 0.1): Tier {
  if (!(cp > 0) || !(own > 0)) return null
  return cp < own * (1 - band) ? 'weak' : cp > own * (1 + band) ? 'strong' : 'even'
}

/** Rows for the overlay window. `pos` = own position (map metres), `web` = website lookups by webKey,
 *  `left` = arena players that were in range and despawned (left the match): not listed any more,
 *  `party` = own party / alliance (team section outside the arena), `groups` = enemy entity -> group (outside the arena). */
export function pvpRows(players: Iterable<PvpPlayer>, roster: RosterMember[] | null, own: Own | null, pos: { x: number; z: number } | null,
  web: Map<string, WebInfo>, cfg: PvpCfg, left: Set<string> = new Set(), party: PartyMember[] = [], groups: Map<number, number> = new Map()): PvpResult {
  const list = [...players]
  const me = roster && own ? roster.find(r => r.name === own.name) : undefined
  const arena = !!me
  const showTeam = !!cfg.team
  type Cand = { name: string; srv: number; pc: number; lv: number; il: number; cp: number; team: number; p?: PvpPlayer }
  const cands: Cand[] = [], mates: Cand[] = []
  const spawnOf = (name: string, srv: number) => list.find(q => q.name === name && (!q.srv || !srv || q.srv === srv))
  const partyOf = (name: string) => party.find(m => m.name === name)
  if (me && roster) {
    // Arena: the roster decides (teams mix factions); the spawn (or the arena party) adds position, item level and CP.
    for (const r of roster) {
      if (r.name === own!.name) continue
      const p = spawnOf(r.name, r.srv), m = partyOf(r.name)
      if (!p && left.has(r.name)) continue
      const c = { name: r.name, srv: r.srv || p?.srv || 0, pc: p?.pc || r.pc, lv: p?.lv || r.lv, il: p?.il || m?.il || 0, cp: p?.cp || m?.cp || 0, team: r.team, p }
      if (r.team !== me.team) cands.push(c)
      else if (showTeam) mates.push(c)
      else if (cfg.all) cands.push(c)
    }
  } else {
    if (showTeam)
      for (const m of party) {
        if (own && m.name === own.name) continue
        const p = spawnOf(m.name, m.srv)
        mates.push({ name: m.name, srv: m.srv || p?.srv || 0, pc: m.pc || p?.pc || 0, lv: m.lv || p?.lv || 0, il: m.il || p?.il || 0, cp: m.cp || p?.cp || 0, team: 0, p })
      }
    const myRace = own?.race || raceOfServer(own?.srv || 0)
    for (const p of list) {
      if (own && p.name === own.name) continue
      if (showTeam && mates.some(m => m.name === p.name)) continue
      if (!cfg.all && (!myRace || p.race === myRace)) continue
      cands.push({ name: p.name, srv: p.srv, pc: p.pc, lv: p.lv, il: p.il, cp: p.cp, team: 0, p })
    }
  }
  const ownCp = own?.cp || 0
  const toRow = (c: Cand, mate: boolean): PvpRow => {
    const w = c.srv ? web.get(webKey(c.name, c.srv)) : undefined
    let cp = c.cp, il = c.il, cpSrc: PvpRow['cpSrc'] = cp > 0 ? 'pkt' : 'unknown'
    if (w?.state === 'ok') {
      if (!(cp > 0) && w.cp) { cp = w.cp; cpSrc = 'web' }
      if (!(il > 0) && w.il) il = w.il
    } else if (!(cp > 0) && w) cpSrc = w.state === 'busy' ? 'busy' : w.state === 'none' ? 'none' : 'unknown'
    const dist = pos && c.p ? Math.hypot(c.p.x - pos.x, c.p.z - pos.z) : null
    const row: PvpRow = { key: c.p ? 'e' + c.p.ent : 'r' + c.name, name: c.name, srv: c.srv, cls: classOf(c.pc), lv: c.lv, il, cp, cpSrc, tier: mate ? null : cpTier(cp, ownCp), dist, team: c.team }
    if (c.p?.gone) Object.assign(row, { gone: c.p.gone }, c.p.by ? { by: c.p.by, bySrv: c.p.bySrv || 0 } : {})
    const g = !arena && !mate && c.p ? groups.get(c.p.ent) : undefined
    if (g) row.grp = g
    return row
  }
  // Arena: fixed order by combat power (high to low) so the rows don't jump while everyone moves; elsewhere nearest first.
  // Players gone a moment ago (greyed) after the ones around.
  const order = (a: PvpRow, b: PvpRow) => Number(!!b.me) - Number(!!a.me) || Number(!!a.gone) - Number(!!b.gone)
    || (arena ? 0 : (a.dist ?? Infinity) - (b.dist ?? Infinity)) || b.cp - a.cp || a.name.localeCompare(b.name)
  const rows = cands.map(c => toRow(c, false)).sort(order)
  const shown = rows.slice(0, Math.max(1, cfg.limit))
  let team: PvpRow[] | null = null, teamAll: PvpRow[] = []
  if (showTeam) {
    teamAll = mates.map(c => toRow(c, true))
    if (own && cfg.self) teamAll.push({ key: 'me', name: own.name, srv: own.srv, cls: classOf(own.pc), lv: own.lv, il: own.il, cp: own.cp, cpSrc: own.cp > 0 ? 'pkt' : 'unknown', tier: null, dist: null, team: me?.team || 0, me: true })
    teamAll.sort(order)
    team = teamAll.slice(0, Math.max(1, cfg.teamLimit || 6))
  }
  // Website lookup only for shown rows without CP from the packet, once per name (host caches and throttles).
  const lookups = [...shown, ...(team || [])].filter(r => !r.me && !(r.cp > 0) && r.srv > 0 && !web.has(webKey(r.name, r.srv))).map(r => ({ name: r.name, srv: r.srv }))
  // the team's size counts oneself also when not listed as a row (arena title "5 vs 5")
  return { rows: shown, total: rows.length, arena, lookups, team, teamTotal: teamAll.length + (showTeam && own && !cfg.self ? 1 : 0) }
}

// ---------------------------------------------------------------- groups, fight odds, kill feed

/** Players this close (map metres) count as "together"; the page links a pair once it stayed together for GROUP_MS. */
export const GROUP_RADIUS = 15
export const GROUP_MS = 3000

/** Pair keys "a-b" (a < b) of the players around (not gone) within `radius` of each other. */
export function closePairs(players: PvpPlayer[], radius = GROUP_RADIUS): string[] {
  const here = players.filter(p => !p.gone)
  const out: string[] = []
  for (let i = 0; i < here.length; i++)
    for (let j = i + 1; j < here.length; j++) {
      const a = here[i], b = here[j]
      if (a.race === b.race && Math.hypot(a.x - b.x, a.z - b.z) <= radius) out.push(a.ent < b.ent ? `${a.ent}-${b.ent}` : `${b.ent}-${a.ent}`)
    }
  return out
}

/** Groups (2+ players) from linked pairs: entity -> group 1, 2, ... (largest first, then strongest). */
export function groupsOf(players: PvpPlayer[], links: Iterable<string>): Map<number, number> {
  const parent = new Map<number, number>()
  const find = (x: number): number => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r }
  for (const l of links) {
    const [a, b] = l.split('-').map(Number)
    parent.set(find(a), find(b))
  }
  const by = new Map<number, PvpPlayer[]>()
  for (const p of players) {
    const r = find(p.ent)
    by.set(r, [...(by.get(r) || []), p])
  }
  const list = [...by.values()].filter(g => g.length >= 2)
    .sort((a, b) => b.length - a.length || b.reduce((s, p) => s + p.cp, 0) - a.reduce((s, p) => s + p.cp, 0))
  const out = new Map<number, number>()
  list.forEach((g, i) => g.forEach(p => out.set(p.ent, i + 1)))
  return out
}
export const groupLetter = (g: number) => String.fromCharCode(64 + Math.min(g, 26))

/** Within this distance (m) enemies and team mates count for the fight odds. */
export const FIGHT_RANGE = 40
export type Odds = { n: number; cp: number; unknown: number; m: number; ownCp: number; grp: number; verdict: 'good' | 'even' | 'bad' | null }

/** Odds against the nearest threat: the group of the nearest enemy around (or that enemy alone; arena: all enemies),
 *  summed CP against the own side within FIGHT_RANGE (self + team rows; no team section: self). null = nobody near. */
export function fightOdds(rows: PvpRow[], team: PvpRow[] | null, own: Own | null, arena: boolean): Odds | null {
  const near = rows.filter(r => !r.gone && (arena || (r.dist != null && r.dist <= FIGHT_RANGE)))
  if (!near.length) return null
  const first = near[0]
  const foes = arena ? near : first.grp ? near.filter(r => r.grp === first.grp) : [first]
  const mine = team ? team.filter(r => r.me || (!r.gone && (arena || (r.dist != null && r.dist <= FIGHT_RANGE)))) : []
  // oneself counts even when not listed as a row
  if (team && own && !mine.some(r => r.me)) mine.push({ key: 'me', name: own.name, srv: own.srv, cls: classOf(own.pc), lv: own.lv, il: own.il, cp: own.cp, cpSrc: 'pkt', tier: null, dist: null, team: 0, me: true })
  const ownCp = mine.length ? mine.reduce((s, r) => s + (r.cp || 0), 0) : own?.cp || 0
  const cp = foes.reduce((s, r) => s + (r.cp || 0), 0), unknown = foes.filter(r => !(r.cp > 0)).length
  const ratio = ownCp > 0 && cp > 0 ? cp / ownCp : 0
  const verdict = !ratio || unknown === foes.length ? null : ratio < 0.85 ? 'good' : ratio <= 1.15 ? 'even' : 'bad'
  return { n: foes.length, cp, unknown, m: Math.max(1, mine.length), ownCp, grp: arena ? 0 : first.grp || 0, verdict }
}
export const ODDS_COL: Record<string, string> = { good: '#7ee0a0', even: '#f0c75e', bad: '#ff6b6b', none: '#969eb0' }

/** Kills shown in the feed: the last 3 of the last 60 s. */
export const feedKills = (kills: PvpKill[]) => kills.filter(k => k.age <= 60e3).slice(0, 3)
/** Colour of a kill: own faction died red, the other faction green. */
export const killCol = (k: PvpKill, myRace: number) => (myRace && k.vRace === myRace ? '#ff8a8a' : '#7ee0a0')

// ---------------------------------------------------------------- formatting for the host window (PvpForm.cs)

/** Server key -> name (NCSOFT search results, EU + NA-East). */
const SERVERS: Record<number, string> = {
  1101: 'Siel', 1102: 'Nezekan', 1103: 'Vaizel', 1104: 'Kaisinel', 1105: 'Yustiel', 1106: 'Ariel', 1107: 'Fregion', 1108: 'Meslamtaeda', 1109: 'Hithanya',
  1301: 'Siel', 1302: 'Nezekan', 1303: 'Vaizel', 1304: 'Kaisinel', 1305: 'Yustiel', 1306: 'Ariel', 1307: 'Fregion', 1308: 'Meslamtaeda', 1309: 'Hithanya',
  1310: 'Nania', 1311: 'Tahavatha', 1312: 'Luteros', 1313: 'Phernos', 1314: 'Daminu', 1315: 'Kasaka', 1316: 'Bakarma', 1317: 'Tsenka', 1318: 'Kochi',
  1319: 'Ishtar', 1320: 'Tiamat', 1321: 'Gauss', 1322: 'Lamuatan', 1323: 'Nathara',
  2101: 'Israphel', 2102: 'Zikel', 2103: 'Triniel', 2104: 'Lumiel', 2105: 'Marchutan', 2106: 'Azphel', 2107: 'Ereshkigal', 2108: 'Beritra', 2109: 'Nemon',
  2301: 'Israphel', 2302: 'Zikel', 2303: 'Triniel', 2304: 'Lumiel', 2305: 'Marchutan', 2306: 'Azphel', 2307: 'Ereshkigal', 2308: 'Beritra', 2309: 'Nemon',
  2310: 'Hadala', 2311: 'Ludra', 2312: 'Ulgorn', 2313: 'Munin', 2314: 'Odar', 2315: 'Zemurru', 2316: 'Kromede', 2317: 'Quai', 2318: 'Baba',
  2319: 'Fafnir', 2320: 'Indnath', 2321: 'Agnita', 2322: 'Atiel', 2323: 'Tassin',
}
export const serverName = (srv: number) => SERVERS[srv] ?? (srv ? String(srv) : '')

export const CLASS_COL: Record<number, string> = {
  2: '#e8a05c', 3: '#a9bdd6', 4: '#8fd47e', 5: '#c992f2', 6: '#b7a2ff', 7: '#6fb7ff', 8: '#f2eaa0', 9: '#7fe0cf',
}
export const TIER_COL: Record<string, string> = { weak: '#7ee0a0', even: '#f0c75e', strong: '#ff6b6b', none: '#dde2ec' }
/** Bar colour of the own team's rows. */
export const TEAM_COL = '#5b9cff'

/** c = text badge (fallback), k = class number (emblem in the host window), col = CP text, bar = bar fill colour,
 *  me = oneself (d = the marker). */
export const DIST_CLOSE = '#ff5a52', DIST_NEAR = '#ffa94d'
/** How urgent the list is: 0 nobody near, 1 an enemy within `range`, 2 one within `close` (not in the arena). */
export const urgencyOf = (rows: PvpRow[], arena: boolean, close: number, range: number) => {
  if (arena) return 0
  const d = rows.filter(r => !r.gone && !r.me && r.dist != null).map(r => r.dist!)
  return d.some(x => x <= close) ? 2 : d.some(x => x <= range) ? 1 : 0
}
export type WireRow = { c: string; k: number; cc: string; n: string; sub: string; il: string; cp: string; col: string; bar: string; d: string; f: number; me?: 1; dim?: 1; dc?: string }

/** "131.8K" / "1.25M" (`dec` = locale number formatter). */
export function fmtK(n: number, dec: (v: number, digits: number) => string = (v, d) => v.toFixed(d)) {
  return n >= 1e6 ? dec(n / 1e6, 2) + 'M' : n >= 1000 ? dec(n / 1000, 1) + 'K' : String(Math.round(n))
}

/** Rows as display strings + colours for the host window: class, name, "server · iLvl n", CP, distance, and the
 *  bar fill = CP relative to the strongest of the listed players and yourself (`o.max`: shared by both sections).
 *  `o.team`: own team rows (neutral CP, blue bar), `o.meTag`: marker of oneself in the distance column. */
export function wireRows(rows: PvpRow[], ownCp: number, cls: (n: number) => string, k: (n: number) => string = n => fmtK(n),
  o: { team?: boolean; max?: number; meTag?: string; near?: [number, number] } = {}): WireRow[] {
  const max = o.max ?? Math.max(ownCp || 0, ...rows.map(r => r.cp || 0))
  return rows.map(r => {
    const col = o.team ? TIER_COL.none : TIER_COL[r.tier ?? 'none']
    // dead: "† Boika (Ariel)" instead of the server; group letter in front. Item level: own column (il).
    const info = r.gone === 2 ? ['†' + (r.by ? ' ' + r.by + (r.bySrv ? ` (${serverName(r.bySrv)})` : '') : '')] : [serverName(r.srv)]
    return {
      c: r.cls ? cls(r.cls) : '?', k: r.cls, cc: CLASS_COL[r.cls] ?? '#dde2ec',
      n: r.name,
      sub: [r.grp ? groupLetter(r.grp) : '', ...info].filter(Boolean).join(' · '),
      il: r.il > 0 ? String(r.il) : '',
      cp: r.cp > 0 ? k(r.cp) : r.cpSrc === 'busy' ? '…' : '?',
      col, bar: o.team ? TEAM_COL : col,
      d: r.me ? (o.meTag ?? 'ME') : r.gone === 2 ? '†' : r.dist == null ? '–' : Math.round(r.dist) + ' m',
      f: max > 0 && r.cp > 0 ? Math.round((r.cp / max) * 1000) / 1000 : 0,
      ...(r.me ? { me: 1 as const } : {}),
      ...(r.gone ? { dim: 1 as const } : {}),
      // enemies: distance red when close, orange within the alarm range (o.near = [close, range])
      ...(!o.team && o.near && !r.gone && r.dist != null && r.dist <= o.near[1] ? { dc: r.dist <= o.near[0] ? DIST_CLOSE : DIST_NEAR } : {}),
    }
  })
}
