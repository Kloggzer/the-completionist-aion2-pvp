// The boss helper's dungeons for the navigation: every dungeon with recorded bosses (bossmods.json), named by the
// instance index (G.instances), its bosses by their guide name (the timelines' names come from DPS-meter labels, which can
// name the wrong boss). Bosses of one dungeon with the same name and (nearly) the same skills are one boss with stages
// (e.g. Fortress Guardian Notun: 3 npc ids, the same skills, rising numbers); the same name with other skills stays two.
import { G, S } from '@/core/state'
import { findGuide, type BossMods, type BossStat, type Guide } from './logic'

export type BossEntry = { name: string; ids: number[]; fights: number }
export type DungeonEntry = { name: string; zones: number[]; bosses: BossEntry[] }

const mods = () => G.bossMods as BossMods | undefined

/** Dungeon name of an instance map (the difficulties of a dungeon share it). */
export const dungeonName = (zone?: number) => (zone && G.instances?.get(zone)?.name) || (zone ? `Dungeon ${zone}` : '')
/** Display name of a boss: the guide's, else the timeline's. */
export const bossName = (npc: number, b?: BossStat) => findGuide(G.bossGuide as Guide | undefined, mods(), npc)?.name || b?.name || String(npc)

/** Share of skill ids two timelines have in common (of the smaller set). */
function overlap(a: BossStat, b: BossStat) {
  const x = Object.keys(a.skills), y = new Set(Object.keys(b.skills))
  const same = x.filter(k => y.has(k)).length
  return same / Math.max(1, Math.min(x.length, y.size))
}

let cache: { mods: unknown; inst: unknown; guide: unknown; list: DungeonEntry[] } | null = null
/** The dungeons in game order (group dungeons by map id first, others after), each with its bosses. */
export function dungeons(): DungeonEntry[] {
  const m = mods()
  if (cache && cache.mods === m && cache.inst === G.instances && cache.guide === G.bossGuide) return cache.list
  const by = new Map<string, { zones: Set<number>; bosses: { id: number; b: BossStat; name: string }[] }>()
  for (const [id, b] of Object.entries(m?.bosses || {})) {
    const name = dungeonName(b.zone) || '–'
    const d = by.get(name) || { zones: new Set<number>(), bosses: [] }
    if (b.zone) d.zones.add(b.zone)
    d.bosses.push({ id: +id, b, name: bossName(+id, b) })
    by.set(name, d)
  }
  const list: DungeonEntry[] = [...by.entries()].map(([name, d]) => {
    const bosses: (BossEntry & { stat: BossStat })[] = []
    for (const x of d.bosses.sort((a, b) => a.id - b.id)) {
      const same = bosses.find(e => e.name === x.name && overlap(e.stat, x.b) >= 0.6)
      if (same) { same.ids.push(x.id); same.fights += x.b.fights }
      else bosses.push({ name: x.name, ids: [x.id], fights: x.b.fights, stat: x.b })
    }
    return { name, zones: [...d.zones].sort((a, b) => a - b), bosses: bosses.map(e => ({ name: e.name, ids: e.ids, fights: e.fights })) }
  })
  const key = (d: DungeonEntry) => { const z = d.zones[0] ?? 0; return z >= 600000 && z < 700000 ? z : 1e7 + z }
  list.sort((a, b) => key(a) - key(b))
  cache = { mods: m, inst: G.instances, guide: G.bossGuide, list }
  return list
}

/** The dungeon a boss npc belongs to (its name), and its entry with stages. */
export function entryOf(npc: number): { dungeon: DungeonEntry; boss: BossEntry } | null {
  for (const d of dungeons()) for (const b of d.bosses) if (b.ids.includes(npc)) return { dungeon: d, boss: b }
  return null
}

/** Name of the dungeon the character is in now, if it has recorded bosses. */
export const currentDungeon = () => {
  const n = dungeonName(S.zone)
  return n && dungeons().some(d => d.name === n) ? n : null
}
