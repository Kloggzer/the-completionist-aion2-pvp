// Arcana tab: which skill rolls on which arcana card, from aion2data.com's dataset (web/public/arcana.json via
// tools/fetch_arcana.py). Per class: every skill's card kind and the chance one binding gives it per card grade (and on
// the Chalice, whose list holds every skill), with the class guide's priority from the Daevanion defaults
// (CLASS_DEF: core / good / skip) and the German names from the board data. The class follows the Daevanion tab.
import { G, U, bump, saveUi, type Any } from '@/core/state'
import { lang } from '@/core/i18n'
import { classId, data as daeData } from '@/features/daevanion/daevanion'
import { CLASS_DEF } from '@/features/daevanion/values'

export const GRADES = ['Common', 'Rare', 'Epic', 'Unique'] as const
export const KINDS = ['Chalice', 'Parchment', 'Compass', 'Bell', 'Mirror'] as const
export type Kind = (typeof KINDS)[number]
export type Card = { n: number; line: string; per: Record<string, number>; top: Record<string, number>; main: string[]; drops: string[] }
/** [skill, id, A/P, kind, chance per grade (%), on the Chalice per grade (%), levels still needed]. */
export type RawSkill = [string, number, 'A' | 'P', Kind, number[], number[], number]
export type ArcData = {
  date: string; client: string; cards: Record<string, Card>; classes: Record<string, RawSkill[]>
  drops: [string, number, Kind, string, number][]
  transmute: { grade: string; material: string; n: number; kinah: number; picks: number; extra?: { materials: number; kinah: number } } | null
}
export type ArcSkill = { en: string; de: string; id: number; active: boolean; kind: Kind; chance: number[]; chalice: number[]; need: number; tier: number }

fetch('arcana.json').then(r => r.json()).then(d => { G.arc = d; bump() }).catch(() => { G.arc = false; bump() })
export const arcData = (): ArcData | null | false => G.arc ?? null

export function arcSettings(): Any {
  U.arc ||= {}
  U.arc.kind ||= 'all'
  return U.arc
}
export function arcSave(patch: Any) { Object.assign(arcSettings(), patch); saveUi(['arc']); bump() }

/** The arcana dataset's class name of a Daevanion class id (the board data's English name; Elementalist = Spiritmaster). */
export function arcClass(d: ArcData, cls: string): string | null {
  const en = daeData()?.classes[cls]?.en
  if (en && d.classes[en]) return en
  const alias: Record<string, string> = { Elementalist: 'Spiritmaster' }
  return en && d.classes[alias[en]] ? alias[en] : null
}

/** Guide priority: 3 core (Daevanion pick), 2 good (rest of the guide's setup), 0 skip, 1 not mentioned. */
export function guideTier(cls: string, en: string) {
  const g = CLASS_DEF[cls]
  return !g ? 1 : g.core.includes(en) ? 3 : g.good?.includes(en) ? 2 : g.skip?.includes(en) ? 0 : 1
}

/** The class's skills: guide priority first, then the levels still needed, then the name. */
export function arcSkills(d: ArcData, cls: string): ArcSkill[] {
  const name = arcClass(d, cls)
  if (!name) return []
  const de = new Map((daeData()?.classes[cls]?.skills || []).map(s => [s.en, s.de]))
  return d.classes[name].map(([en, id, ty, kind, chance, chalice, need]) => ({
    en, de: de.get(en) || en, id, active: ty === 'A', kind, chance, chalice, need, tier: guideTier(cls, en),
  })).sort((a, b) => b.tier - a.tier || b.need - a.need || a.en.localeCompare(b.en))
}

export const skillName = (s: ArcSkill) => (lang() === 'de' ? s.de : s.en)
export { classId }
