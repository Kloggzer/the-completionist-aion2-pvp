// Own loot in dungeons: the host sends every gain of the own inventory ('loot': [item id, count], PlayerFrames.Inventory
// 0x1b56). Inside a dungeon it is booked on the current run; per dungeon the runs, the items (how often, in how many
// runs) and the Kina are kept (U.dngLoot, saved). A run starts on entering the dungeon's zone; back in the same zone
// within RUN_GAP (disconnect, wipe + re-entry) it is the same run. The clear reward can arrive after leaving
// (captures/20261027-170912: Krao Cave's staff 10 s after the exit): gains within AFTER of the run's last moment in the
// dungeon still go to it. Names: web/public/itemnames.json (aion2data).
import { G, S, U, bump, saveUi, type Any } from '@/core/state'
import { onHost } from '@/core/host'
import { t } from '@/core/i18n'
import { currentDungeon, type PanelSection } from './dungeon'

export type Run = { zone: number; at: number; seen: number; items: Record<string, number>; kina: number }
export type DngLoot = { runs: number; items: Record<string, [number, number]>; kina: number; cur: Run | null }

export const RUN_GAP = 20 * 60_000, AFTER = 90_000
const KINA = new Set(['Kina', 'Kina (Bound)'])
const SKIP = new Set(['Abyss Points'])
const GRADE: Record<string, number> = { Unique: 5, Legend: 4, Epic: 4, Heroic: 3, Rare: 2, Special: 1 }
const GRADE_COL: Record<string, string> = { Unique: '#f0c75e', Legend: '#ff9a4d', Epic: '#c792ff', Heroic: '#6fb6ff', Rare: '#60d678' }
const MUTED = '#a8b0c2', FG = '#dde2ec', KINA_COL = '#e8c45c'

fetch('itemnames.json').then(r => r.json()).then(d => { G.itemNames = d }).catch(() => { G.itemNames = {} })
const item = (id: number | string): [string, string] => G.itemNames?.[id] || [`#${id}`, '']

export const lootOf = (name: string): DngLoot => {
  U.dngLoot ||= {}
  return (U.dngLoot[name] ||= { runs: 0, items: {}, kina: 0, cur: null })
}

/** The run in this dungeon zone: the current one when still here (or back within RUN_GAP), else a new one. */
export function trackRun(name: string, zone: number, now = Date.now()): Run {
  const d = lootOf(name)
  if (!d.cur || d.cur.zone !== zone || now - d.cur.seen > RUN_GAP) {
    d.cur = { zone, at: now, seen: now, items: {}, kina: 0 }
    d.runs++
    saveUi(['dngLoot'])
  }
  d.cur.seen = now
  return d.cur
}

/** Book gains on the dungeon's current run and its totals. */
export function book(name: string, zone: number, gains: [number, number][], now = Date.now()) {
  const d = lootOf(name), run = trackRun(name, zone, now)
  for (const [id, n] of gains) {
    const [nm] = item(id)
    if (SKIP.has(nm)) continue
    if (KINA.has(nm)) { run.kina += n; d.kina += n; continue }
    const k = String(id), tot = d.items[k] ||= [0, 0]
    if (!run.items[k]) tot[1]++
    run.items[k] = (run.items[k] || 0) + n
    tot[0] += n
  }
  saveUi(['dngLoot'])
}

/** Gains outside a dungeon right after one: the run that just ended, else null. */
export function lastRun(now = Date.now()): [string, number] | null {
  let best: [string, number, number] | null = null
  for (const [name, d] of Object.entries((U.dngLoot || {}) as Record<string, DngLoot>))
    if (d.cur && now - d.cur.seen < AFTER && (!best || d.cur.seen > best[2])) best = [name, d.cur.zone, d.cur.seen]
  return best && [best[0], best[1]]
}

onHost('loot', m => {
  const dng = currentDungeon(), gains = (m.items || []) as [number, number][]
  if (dng) book(dng.name, S.zone, gains)
  else {
    const r = lastRun()
    if (!r) return
    const d = lootOf(r[0]), seen = d.cur!.seen
    book(r[0], r[1], gains)
    d.cur!.seen = seen // booking does not prolong the run
  }
  bump()
})

const kfmt = (n: number) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : String(n)
const byGrade = (a: [string, Any][]) => a.sort(([x, xv], [y, yv]) =>
  (GRADE[item(y)[1]] || 0) - (GRADE[item(x)[1]] || 0) || (Array.isArray(yv) ? yv[1] - xv[1] : yv - xv))

/** Loot tab, own part: this run's items and Kina, then all runs here (per item in how many runs, vs the table's chance). */
export function ownLootPanel(name: string, chance: Record<string, number> = {}): PanelSection[] {
  const d: DngLoot | undefined = U.dngLoot?.[name]
  const tab = t('pvp.dng.tab.loot')
  if (!d?.runs) return [{ h: t('pvp.dng.lootRun', { n: 0 }), tab, l: [{ t: t('pvp.dng.lootNone'), col: MUTED }] }]
  const out: PanelSection[] = []
  const run = d.cur, ri = Object.entries(run?.items || {})
  const rl = byGrade(ri).slice(0, 4).map(([id, n]) => ({ t: `${item(id)[0]}${n > 1 ? ' ×' + n : ''}`, col: GRADE_COL[item(id)[1]] || FG }))
  if (run?.kina) rl.push({ t: `+${kfmt(run.kina)} Kina`, col: KINA_COL })
  if (!rl.length) rl.push({ t: t('pvp.dng.lootNone'), col: MUTED })
  out.push({ h: t('pvp.dng.lootRun', { n: ri.reduce((s, [, n]) => s + n, 0) }), tab, l: rl })
  const all = Object.entries(d.items), n = all.reduce((s, [, v]) => s + v[0], 0)
  const tl = byGrade(all).slice(0, 4).map(([id, [, runs]]) => {
    const [nm, gr] = item(id), tab = chance[nm]
    return { t: `${nm} · ${t('pvp.dng.lootIn', { n: runs, of: d.runs })} (${Math.round(runs / d.runs * 100)} %)${tab ? ' · ' + t('pvp.dng.lootTable', { p: tab >= 10 ? Math.round(tab) : tab }) : ''}`,
      col: GRADE_COL[gr] || FG }
  })
  if (d.kina) tl.push({ t: t('pvp.dng.lootKina', { k: kfmt(Math.round(d.kina / d.runs)) }), col: KINA_COL })
  out.push({ h: t('pvp.dng.lootAll', { runs: d.runs, avg: (n / d.runs).toFixed(1) }), tab, l: tl })
  return out
}
