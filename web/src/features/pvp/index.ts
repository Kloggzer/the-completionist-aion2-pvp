// PvP overlay: a separate native window of the host (PvpForm.cs) listing nearby enemy players and the own team. The
// host sends the decoded players, arena roster and own party ('pvp'); the page picks, sorts and formats the rows (logic.ts) and posts them as 'pvp2' a few times
// per second – only when something changed. Settings: S.settings.pvp (host-owned).
import { G, S, U, V, bump, manual, saveUi, type Any } from '@/core/state'
import { host, onHost } from '@/core/host'
import { t, locale, fmt } from '@/core/i18n'
import { mapName } from '@/core/data'
import { say, TTS_KINDS } from '@/core/tts'
import { alarms, ALARM, type AlarmMemo } from './alarm'
import { currentDungeon, dungeonPanel } from './dungeon'
import { trackRun } from './loot'
import { loadFights } from '@/features/build/build'
import { CLASS_COL, GROUP_MS, ODDS_COL, urgencyOf, classOf, closePairs, feedKills, fightOdds, fmtK, groupLetter, groupsOf, killCol, pvpRows, raceOfServer, serverName, wireRows, webKey,
  type Own, type PartyMember, type PvpKill, type PvpPlayer, type RosterMember, type WebInfo } from './logic'

export * from './logic'

/** Settings of the PvP window as the host reports them. */
export const pvpCfg = (): Any => S.settings?.pvp || { on: true, locked: true, auto: true, scale: 1, alpha: 0.95, limit: 8, all: false, team: true, teamLimit: 6, alarm: true, alarmSound: true, alarmRange: 60, self: false, idle: 'bar', compact: false, feed: true, feedScale: 1, feedLimit: 5 }
if (!TTS_KINDS.includes('pvp')) TTS_KINDS.unshift('pvp')

/** Latest data from the host (also read by the e2e tests through the posted 'pvp2'). */
export const P: { players: PvpPlayer[]; roster: RosterMember[] | null; party: PartyMember[]; own: Own | null; web: Map<string, WebInfo>; left: Set<string>;
  me: { x: number; z: number } | null; kills: PvpKill[]; killsAt: number; ap: { now: number; session: number; pvp: number } | null } =
  { players: [], roster: null, party: [], own: null, web: new Map(), left: new Set(), me: null, kills: [], killsAt: 0, ap: null }

// Pairs of players close to each other since (ms): linked into a group once together for GROUP_MS.
const pairSince = new Map<string, number>()

onHost('pvp', m => {
  P.players = (m.players || []).map((a: Any[]): PvpPlayer => ({
    ent: a[0], name: a[1], srv: a[2], pc: a[3], race: a[4], lv: a[5], il: a[6], cp: a[7], x: a[8], z: a[9],
    ...(a[10] ? { gone: a[10] } : {}), ...(a[11] ? { by: a[11], bySrv: a[12] || 0 } : {}),
  }))
  // kills around: [age ms, victim, victim server, victim race, killer, killer server]
  P.kills = (m.kills || []).map((a: Any[]): PvpKill => ({ age: a[0], victim: a[1], vSrv: a[2], vRace: a[3], killer: a[4], kSrv: a[5] }))
  P.killsAt = Date.now()
  // Abyss points: [current, gained this session, of which right after player kills]
  P.ap = m.ap ? { now: m.ap[0], session: m.ap[1], pvp: m.ap[2] } : null
  const t0 = Date.now(), close = new Set(closePairs(P.players))
  for (const k of pairSince.keys()) if (!close.has(k)) pairSince.delete(k)
  for (const k of close) if (!pairSince.has(k)) pairSince.set(k, t0)
  const roster = m.roster || null
  if (JSON.stringify(roster) !== JSON.stringify(P.roster)) { seen.clear(); P.left.clear() } // new match
  P.roster = roster
  P.own = m.own || null
  // own party / alliance: [name, server, pcId, level, item level, CP]
  P.party = (m.party || []).map((a: Any[]): PartyMember => ({ name: a[0], srv: a[1], pc: a[2], lv: a[3], il: a[4], cp: a[5] }))
  // own position from the host's looser fix (arenas around 0/0 included): [x, z, age ms]
  if (m.me) { const at = Date.now() - m.me[2]; if (at > meAt) { P.me = { x: m.me[0], z: m.me[1] }; meAt = at } }
  // Arena players that were in range and are gone again left the match (despawn reason 0a at its end).
  const now = new Set(P.players.map(p => p.name))
  for (const n of seen) if (!now.has(n)) P.left.add(n)
  for (const n of now) { seen.add(n); P.left.delete(n) }
  tick()
})
const seen = new Set<string>()

// Own position: the map's 'pos' (with dead reckoning) or the host's PvP fix, whichever is newer. After a map change
// both are the old map's until the first fix there (the teleport frame comes ~50 ms before the map change): none then.
let zoneAt = 0, posAt = 0, meAt = 0
onHost('zone', () => { zoneAt = Date.now() })
onHost('pos', () => { posAt = Date.now() })
export function ownPos(): { x: number; z: number } | null {
  const ok = (t: number) => t > 0 && t >= zoneAt - 1500
  if (P.me && ok(meAt) && meAt > posAt) return P.me
  return S.pos && ok(posAt || (zoneAt ? 0 : 1)) ? S.pos : null
}

onHost('pvpWeb', m => {
  const k = webKey(m.name, m.srv)
  P.web.set(k, { state: m.state, cp: m.cp, il: m.il, cls: m.cls })
  if (m.state === 'err') setTimeout(() => { if (P.web.get(k)?.state === 'err') P.web.delete(k) }, 120e3) // offline: try again later
  tick()
})

onHost('pvpWin', m => {
  if (!S.settings) return
  S.settings.pvp = m.pvp
  last = '' // the window may have just been (re)created: send the content again
  tick(); bump()
})

/** Title: "Arena · 5 vs 5" (team section) / "Arena · 5 Gegner" / "<zone> · 3 Gegner" (8/12 when limited). */
function zoneName() {
  const m = G.maps?.find((x: Any) => x.map_id === S.zone) || G.dungeons?.get?.(S.zone)
  return m?.name ? mapName(m.name) : t('pvp.zone')
}

/** Website lookup state for the footer: running, failed, used. */
function lookupStatus(): [string, string] {
  // without the own character (it comes only at login / zone change) nobody counts as an enemy: say so
  if (!P.own && !manual()) return [t('pvp.noOwn'), '#e8c45c']
  const st = [...P.web.values()].map(w => w.state)
  if (st.includes('busy')) return [t('pvp.web.busy'), '#969eb0']
  if (st.includes('err')) return [t('pvp.web.err'), '#ff8a8a']
  if (st.length) return [t('pvp.web.ok'), '#60d678']
  return ['', '#969eb0']
}

let fightsZone = 0
/** The 'pvp2' message for the current data (exported for tests). */
export function pvpMessage() {
  const cfg = pvpCfg()
  // group dungeon: the bosses instead of enemies (the enemy feed stays empty)
  const dng = currentDungeon()
  // the Abyss Logs history once per dungeon visit (own runs and kill times)
  if (dng && fightsZone !== S.zone) { fightsZone = S.zone; V.abyss = null; loadFights() }
  if (dng) trackRun(dng.name, S.zone)
  if (dng) return {
    msg: {
      type: 'pvp2', title: dng.name, empty: t('pvp.dng.none'), rows: [], panel: dungeonPanel(dng, S.zone, V.abyss, P.own),
      foot: '', footCls: '', footK: 0, footCol: '#dde2ec', status: '', statusCol: '#969eb0', urg: 0,
    },
    lookups: [] as { name: string; srv: number }[],
  }
  const pos = manual() ? null : ownPos()
  const team = cfg.team ?? true
  const now = Date.now()
  const groups = groupsOf(P.players, [...pairSince].filter(([, at]) => now - at >= GROUP_MS).map(([k]) => k))
  const r = pvpRows(P.players, P.roster, P.own, pos, P.web, { limit: cfg.limit || 8, all: !!cfg.all, team, teamLimit: cfg.teamLimit || 6, self: !!cfg.self }, P.left, P.party, groups)
  const cnt = (shown: number, total: number) => (total > shown ? `${shown}/${total}` : String(total))
  const n = cnt(r.rows.length, r.total)
  const zone = r.arena ? t('pvp.arena') : zoneName()
  const urg = inInstance() ? 0 : urgencyOf(r.rows, r.arena, ALARM.close, cfg.alarmRange || ALARM.range)
  const title = (urg ? '⚔ ' : '') + (r.arena && r.team ? t('pvp.title.vs', { zone, a: r.teamTotal, b: r.total }) : t(cfg.all ? 'pvp.title.all' : 'pvp.title', { zone, n }))
  const k = (v: number) => fmtK(v, (x, d) => x.toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d }))
  const own = P.own, oc = own ? classOf(own.pc) : 0
  const [status, statusCol] = lookupStatus()
  const cls = (c: number) => t('pvp.cls.' + c)
  // one bar scale for both sections: the strongest listed player or yourself
  const max = Math.max(own?.cp || 0, ...r.rows.map(x => x.cp || 0), ...(r.team || []).map(x => x.cp || 0))
  const selfListed = !!r.team?.some(x => x.me)
  // fight odds against the nearest group: "Gruppe A: 3 · 410K vs 2 · 280K · Nachteil"
  const o = fightOdds(r.rows, r.team, own, r.arena)
  const odds = o && {
    t: t('pvp.odds', { who: r.arena ? t('pvp.odds.arena') : o.grp ? t('pvp.odds.grp', { g: groupLetter(o.grp) }) : t('pvp.odds.one'), n: o.n, cp: k(o.cp), m: o.m, own: k(o.ownCp) })
      + (o.verdict ? ' · ' + t('pvp.odds.' + o.verdict) : '') + (o.unknown ? ' · ' + t('pvp.odds.unknown', { n: o.unknown }) : ''),
    col: ODDS_COL[o.verdict ?? 'none'],
  }
  // kill feed: "Boika (Ariel) tötet Ipop · vor 12 s"
  const myRace = own?.race || raceOfServer(own?.srv || 0)
  const age = now - P.killsAt
  const feed = feedKills(P.kills.map(x => ({ ...x, age: x.age + age }))).map(x => ({
    t: (own && x.victim === own.name ? t('pvp.killMe', { k: x.killer + ` (${serverName(x.kSrv)})` })
      : t('pvp.kill', { k: x.killer + ` (${serverName(x.kSrv)})`, v: x.victim })) + ' · ' + t('pvp.ago', { n: Math.round(x.age / 1000) }),
    col: killCol(x, myRace),
  }))
  return {
    msg: {
      type: 'pvp2', title, empty: t('pvp.empty'),
      ...(odds ? { odds } : {}),
      ...(feed.length ? { feed, feedHead: t('pvp.sec.kills') } : {}),
      rows: wireRows(r.rows, own?.cp || 0, cls, k, { max, ...(inInstance() ? {} : { near: [ALARM.close, cfg.alarmRange || ALARM.range] as [number, number] }) }),
      urg,
      ...(lastAlarmAt ? { alarmAt: lastAlarmAt } : {}),
      ...(r.team ? {
        team: wireRows(r.team, own?.cp || 0, cls, k, { team: true, max, meTag: t('pvp.me') }),
        enemyHead: t(cfg.all && !r.arena ? 'pvp.sec.all' : 'pvp.sec.enemies', { n }),
        teamHead: t('pvp.sec.team', { n: cnt(r.team.length, r.teamTotal) }),
      } : {}),
      // own character in the footer only while it is not a row of the team section
      foot: [own && !selfListed ? own.name + (own.cp ? ' · ' + k(own.cp) : '') : '',
        P.ap && P.ap.session > 0 ? t('pvp.ap', { n: fmt(P.ap.session), pvp: fmt(P.ap.pvp) }) : ''].filter(Boolean).join(' · '),
      footCls: oc && !selfListed ? cls(oc) : '', footK: selfListed ? 0 : oc, footCol: CLASS_COL[oc] ?? '#dde2ec',
      status, statusCol,
    },
    lookups: r.lookups,
  }
}

onHost('openSettings', m => { V.settingsOpen = true; U.setCat = m.cat || 'map'; saveUi(['setCat']); bump() })

// ---------------------------------------------------------------- enemy alarm (alarm.ts)

const alarmMemo: AlarmMemo = new Map()
/** In a group dungeon (instance index, not a PvP instance): no alarm, no red, the boss panel instead of enemies. */
export const inInstance = () => !!currentDungeon()
/** When the last alarm fired (the window blinks once per new value). */
let lastAlarmAt = 0
/** Enemies of the banner on screen: when all of them are dead / gone, the banner goes (alertHide). */
let shown: { keys: Set<string>; until: number } | null = null
let noOwnLogged = false
const dm = (d: number | null) => (d == null ? '' : ` · ${Math.round(d)} m`)
/** Banner (red, also while the overlay is hidden) + sound + voice for enemies coming into range / close. */
export function enemyAlarm(now = Date.now()) {
  const cfg = pvpCfg()
  if (!S.settings || manual() || cfg.alarm === false || inInstance()) return
  // instance index not read yet (app start inside an instance): no alarm until it is clear whether this is a dungeon
  if (!G.instances && S.zone && !G.maps?.some((m: { map_id: number }) => m.map_id === S.zone)) return
  if (!P.own) {
    // players around but no own character: the alarm cannot tell enemies – log it once per stretch
    if (P.players.some(p => !p.gone) && !noOwnLogged) { noOwnLogged = true; host({ type: 'log', msg: 'Gegner-Alarm: eigener Charakter unbekannt (einmal teleportieren / Zone wechseln)' }) }
    return
  }
  noOwnLogged = false
  // every enemy around, not only the listed ones
  const r = pvpRows(P.players, P.roster, P.own, ownPos(), P.web, { limit: 100, all: false }, P.left, P.party)
  const evs = alarms(r.rows, r.arena, alarmMemo, now)
  const cls = (c: number) => t('pvp.cls.' + c)
  if (evs.length) lastAlarmAt = now
  // banner up and none of its enemies around any more (dead, out of range): take it down
  if (shown && !evs.length) {
    if (now > shown.until) shown = null
    else if (!r.rows.some(x => !x.gone && shown!.keys.has(`${x.name}@${x.srv}`))) { host({ type: 'alertHide' }); shown = null }
  }
  for (const ev of evs) {
    const one = ev.rows.length === 1 ? ev.rows[0] : null, nearest = ev.rows[0]
    // one line: "⚠ joeyss · Ran · 20 m" / "⚔ 3 Gegner · 45 m"
    const icon = ev.kind === 'close' ? '⚠' : '⚔'
    const title = one ? `${icon} ${one.name} · ${cls(one.cls)}${dm(one.dist)}`
      : `${icon} ${t(ev.kind === 'close' ? 'pvp.alarm.closeN' : 'pvp.alarm.newN', { n: ev.rows.length })}${dm(nearest.dist)}`
    host({ type: 'alert', title, sub: '', sound: cfg.alarmSound !== false ? (ev.kind === 'close' ? 'pvpClose' : 'pvp') : '', always: true, danger: true, seconds: 6 })
    shown = { keys: new Set(ev.rows.map(x => `${x.name}@${x.srv}`)), until: now + 6000 }
    host({ type: 'log', msg: 'Gegner-Alarm: ' + title })
    say('pvp', ev.kind === 'close'
      ? t('pvp.say.close', { n: ev.rows.length, d: nearest.dist != null ? Math.round(nearest.dist) : '' })
      : one ? t('pvp.say.new', { cls: cls(one.cls), d: one.dist != null ? Math.round(one.dist) : '' }) : t('pvp.say.newN', { n: ev.rows.length }))
  }
}

let last = ''
// Rows without CP wait 3 s before the website lookup: in the arena the roster comes a moment before the spawns.
const noCpSince = new Map<string, number>()
function tick() {
  enemyAlarm()
  // the list window or the enemy feed (EnemyFeedForm) needs the rows
  if (!S.settings || (!pvpCfg().on && pvpCfg().feed === false)) { last = ''; return }
  const { msg, lookups } = pvpMessage()
  const t0 = Date.now()
  for (const k of noCpSince.keys()) if (!lookups.some(l => webKey(l.name, l.srv) === k)) noCpSince.delete(k)
  for (const l of lookups) {
    const k = webKey(l.name, l.srv)
    if (!noCpSince.has(k)) noCpSince.set(k, t0)
    if (t0 - noCpSince.get(k)! < 3000) continue
    noCpSince.delete(k)
    P.web.set(k, { state: 'busy' })
    host({ type: 'pvpLookup', name: l.name, srv: l.srv })
  }
  const key = JSON.stringify(msg)
  if (key === last) return
  last = key
  host(msg)
}
// Own position moves (dead reckoning) between host snapshots: refresh the distances.
setInterval(tick, 500)

/** Change a PvP setting (limit, all, team, teamLimit, auto, scale, alpha); the host answers with 'pvpWin'. */
export function setPvpCfg(patch: Any) {
  Object.assign(pvpCfg(), patch)
  host({ type: 'pvpCfg', ...patch }); last = ''; tick(); bump()
}
export const togglePvp = () => { const c = pvpCfg(); c.on = !c.on; host({ type: 'pvpWin', on: c.on }); bump() }
/** Edit mode of the small overlay windows (PvP list, announcer, alert banner): move them. */
export const toggleWinEdit = () => host({ type: 'winEdit' })
