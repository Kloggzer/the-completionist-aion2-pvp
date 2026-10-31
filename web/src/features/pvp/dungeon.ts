// Dungeon panel: inside a group dungeon the PvP window shows the dungeon instead of enemies, in tabs –
//   Bosse: per boss level, damage type, Frenzy time per mode and the mechanics worth reacting to
//   Runs:  the mode's item level vs the own one, the own runs here (Abyss Logs history: first pull to last boss, per
//          run group) and the kill times per boss against its Frenzy
//   Loot:  the own loot (this run, all runs here: loot.ts), then what a clear gives per mode (items whose best source is this dungeon mode), the best grades first
// From aion2data.com's datasets (web/public/bosses.json via tools/fetch_bosses.py) and the Abyss Logs index.
// Which zone is a dungeon: aion2maps' instance index (G.instances: map id -> name, type, difficulty, entry item level);
// PvP instances (arena, battlefield, Abyss corridor, instanced world layers, field events) and field maps keep the
// enemy list.
import { G, S } from '@/core/state'
import { t } from '@/core/i18n'
import type { Fight } from '@/features/build/build'
import { ownLootPanel } from './loot'

export type BossData = { boss: string; enrage: [number, string][]; mech: [string, number, number, string, string][]; notes: string[]; lv?: number[]; dmg?: Record<string, number> }
export type LootData = Record<string, { n: number; top: [string, string, number][] }>
export type DungeonData = { bosses: BossData[]; loot?: LootData }
export type Dungeon = { name: string; type: string; diff?: string; il?: number }
export type PanelSection = { h: string; tab?: string; l: { t: string; col: string }[] }

fetch('bosses.json').then(r => r.json()).then(d => { G.bosses = d.dungeons }).catch(() => { G.bosses = {} })

/** Instance types that keep the enemy list (players matter there). */
const PVP_TYPES = new Set(['arena_battlefield', 'abyss_corridor', 'abyss_field', 'world_instance_layer', 'field_event', 'invasion', 'garrison'])

/** The dungeon the character is in (name, type, mode), null on field maps and in PvP instances. */
export function currentDungeon(zone: number = S.zone): Dungeon | null {
  if (!zone || G.maps?.some((m: { map_id: number }) => m.map_id === zone)) return null
  const i = G.instances?.get(zone)
  return i && !PVP_TYPES.has(i.type) ? i : null
}

/** "5:00". */
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
/** Short mode names: "Conquest [Hard]" -> "Hard", "Transcendence Stage 2" -> "T2". */
const modeShort = (m: string) => m.replace('Conquest [Hard]', 'Hard').replace(/^Transcendence Stage (\d)$/, 'T$1').replace('Exploration', 'Erk.')
/** The instance difficulty's mode in the guides and drop tables. */
const MODE_OF: Record<string, string> = { Easy: 'Exploration', Normal: 'Conquest', Hard: 'Conquest [Hard]' }
const ACTION_COL = '#f0c75e', MUTED = '#a8b0c2', RED = '#ff8a7a', GOOD = '#60d678', FG = '#dde2ec'
const GRADE_COL: Record<string, string> = { Unique: '#f0c75e', Legend: '#ff9a4d', Epic: '#c792ff', Heroic: '#6fb6ff', Rare: '#60d678' }
const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length

/** Bosse tab: per boss level and damage type in the head, its Frenzy times, the mechanics (with a reaction first), a note. */
export function bossPanel(bosses: BossData[] | undefined, maxMech = 4): PanelSection[] {
  return (bosses || []).map(b => {
    const enrage = b.enrage.length
      ? t('pvp.dng.frenzy', { list: b.enrage.map(([s, m]) => `${mmss(s)} ${modeShort(m)}`).join(' · ') }) : ''
    const mech = [...b.mech].sort((x, y) => Number(!!y[3]) - Number(!!x[3]) || y[1] - x[1]).slice(0, maxMech).map(([skill, cast, , action, guide]) => {
      const what = action ? t('pvp.dng.a.' + action) : guide.replace(/,? ?kru!?\.?$/i, '').slice(0, 48)
      const name = skill || t('pvp.dng.mech')
      return { t: `${name}${cast ? ` · ${cast} s` : ''}${what ? ' → ' + what : ''}`, col: action ? ACTION_COL : MUTED }
    })
    const l = [...(enrage ? [{ t: enrage, col: RED }] : []), ...mech, ...b.notes.slice(0, 1).map(n => ({ t: '• ' + n, col: MUTED }))]
    const lv = b.lv?.length ? `Lv ${b.lv[0]}${b.lv[1] && b.lv[1] !== b.lv[0] ? '–' + b.lv[1] : ''}` : ''
    const dmg = Object.entries(b.dmg || {}).sort((x, y) => y[1] - x[1]).map(([k]) => t('pvp.dng.dmg.' + k)).join('/')
    return { h: [b.boss, lv, dmg].filter(Boolean).join(' · '), tab: t('pvp.dng.tab.boss'), l }
  }).filter(s => s.l.length)
}

/** Runs tab: mode and item level, the own runs in this zone (count, average, best, last), kill times per boss. */
export function runsPanel(dng: Dungeon, zone: number, fights: Fight[] | null | false | undefined, own: { name: string; il: number } | null,
  bosses: BossData[] = []): PanelSection[] {
  const tab = t('pvp.dng.tab.runs'), mode = MODE_OF[dng.diff || '']
  const out: PanelSection[] = []
  const ml: PanelSection['l'] = []
  if (dng.il) {
    const ok = own?.il ? own.il >= dng.il : null
    ml.push({ t: t('pvp.dng.il', { need: dng.il }) + (own?.il ? ` · ${t('pvp.dng.you', { il: own.il })} ${ok ? '✓' : '✗'}` : ''), col: ok == null ? FG : ok ? GOOD : RED })
  }
  out.push({ h: [dng.diff && t('pvp.dng.diff.' + dng.diff), mode && modeShort(mode)].filter(Boolean).join(' · ') || t('pvp.dng.mode'), tab, l: ml })
  if (fights == null) { ml.push({ t: t('pvp.dng.runsLoading'), col: MUTED }); return out }
  const mine = (fights || []).filter(f => f.zoneId === zone && f.hasBoss && (!own?.name || f.recorderName === own.name))
  // a run: the fights of one run group, first pull to the last boss's end
  const runs = new Map<string, { a: number; b: number }>()
  for (const f of mine) {
    const a = Date.parse(f.startTime), b = a + f.duration * 1000, k = f.runGroupId || f.id, r = runs.get(k)
    if (!r) runs.set(k, { a, b }); else { r.a = Math.min(r.a, a); r.b = Math.max(r.b, b) }
  }
  const rl: PanelSection['l'] = []
  if (!runs.size) rl.push({ t: t('pvp.dng.noRuns'), col: MUTED })
  else {
    const list = [...runs.values()].sort((x, y) => y.a - x.a), secs = list.map(r => (r.b - r.a) / 1000)
    rl.push({ t: t('pvp.dng.runs', { avg: mmss(avg(secs)), best: mmss(Math.min(...secs)), last: mmss(secs[0]) }), col: FG })
  }
  out.push({ h: t('pvp.dng.yourRuns', { n: runs.size }), tab, l: rl })
  // per boss of the guide (in its order), then other bosses of the history
  const names = [...bosses.map(b => b.boss), ...new Set(mine.map(f => f.label).filter(n => !bosses.some(b => b.boss === n)))]
  const kl: PanelSection['l'] = []
  for (const n of names) {
    const d = mine.filter(f => f.label === n).map(f => f.duration)
    if (!d.length) continue
    const fr = bosses.find(b => b.boss === n)?.enrage.find(([, m]) => m === mode)?.[0]
    const a = avg(d)
    kl.push({ t: `${n} · ${t('pvp.dng.kill', { avg: mmss(a), best: mmss(Math.min(...d)), n: d.length })}${fr ? ` / ${mmss(fr)}` : ''}`,
      col: fr && a > fr * 0.85 ? RED : fr && a > fr * 0.6 ? ACTION_COL : FG })
  }
  if (kl.length) out.push({ h: t('pvp.dng.kills'), tab, l: kl.slice(0, 6) })
  return out
}

/** Loot tab: per mode (the current one first) the number of items and the best ones with the chance per clear. */
export function lootPanel(loot: LootData | undefined, diff?: string): PanelSection[] {
  const mode = MODE_OF[diff || ''], tab = t('pvp.dng.tab.loot')
  return Object.entries(loot || {}).sort(([a], [b]) => Number(b === mode) - Number(a === mode)).map(([m, v]) => ({
    h: t('pvp.dng.loot', { mode: modeShort(m), n: v.n }), tab,
    l: v.top.slice(0, 3).map(([item, grade, pct]) => ({ t: `${item} · ${pct >= 100 ? '100' : pct >= 10 ? Math.round(pct) : pct} %`, col: GRADE_COL[grade] || FG })),
  }))
}

/** The whole panel: Bosse, Runs, Loot (tabs in the PvP window). */
export function dungeonPanel(dng: Dungeon, zone: number, fights: Fight[] | null | false | undefined, own: { name: string; il: number } | null): PanelSection[] {
  const d: DungeonData | undefined = G.bosses?.[dng.name]
  // the table's chance per item (any mode, the highest) next to the own rate
  const chance: Record<string, number> = {}
  for (const v of Object.values(d?.loot || {})) for (const [n, , p] of v.top) chance[n] = Math.max(chance[n] || 0, p)
  return [...bossPanel(d?.bosses), ...runsPanel(dng, zone, fights, own, d?.bosses), ...ownLootPanel(dng.name, chance), ...lootPanel(d?.loot, dng.diff)]
}
