// Where the Daevanion tab gets the character from (this file differs per build; daevanion.ts and the tab do not).
// Private build: the logged-in character as the game reports it (PvP feature: name, server, pcId, level). Class and
// level come from there; the boards from its public plaync character page (found by name + server), loaded on their
// own when the character is new or its boards are older than MAX_AGE. Website requests go through the host
// ('plaync' -> PlayerLookup.Raw, only api-search.plaync.com / aion2.plaync.com).
import { U, type Any } from '@/core/state'
import { host, onHost } from '@/core/host'
import { t } from '@/core/i18n'
import { charKey as checkChar } from '@/features/progress/checklist'
import { P } from '@/features/pvp'
import { classOf } from '@/features/pvp/logic'

/** Boards can be read from the plaync character page. */
export const LIVE = true
/** Hint (i18n key) while there is no character to load. */
export const NONE_HINT = 'dae.liveNoneGame'
/** What loading the boards needs: the website ids (`id` empty until the search found the character). */
export type Profile = { id: string; name: string; serverId: number; region: string }
const MAX_AGE = 4 * 3600e3

const region = (srv: number) => (Math.floor(srv / 100) % 10 === 1 ? 'nae' : 'eu')
const ids: Record<string, string> = {}

export const charKey = () => P.own?.name || checkChar()
export const profile = (char: string): Profile | undefined => {
  const o = P.own
  return o && o.name === char ? { id: ids[char] || '', name: o.name, serverId: o.srv, region: region(o.srv) } : undefined
}

let seq = 0
const waiting = new Map<number, (m: Any) => void>()
onHost('plaync', m => { const f = waiting.get(m.id); if (f) { waiting.delete(m.id); f(m) } })
export async function getJson(url: string): Promise<Any> {
  const id = ++seq
  const m = await new Promise<Any>((res, rej) => {
    waiting.set(id, res)
    host({ type: 'plaync', id, url })
    setTimeout(() => { if (waiting.delete(id)) rej(new Error('timeout')) }, 20000)
  })
  if (!m.status || m.status >= 400 || m.body == null) throw new Error(m.status ? 'HTTP ' + m.status : 'offline')
  return JSON.parse(m.body)
}

const strip = (s: unknown) => String(s ?? '').replace(/<[^>]*>/g, '').trim()
/** Find the website id: exact name on the same server. */
export async function resolve(p: Profile): Promise<Profile> {
  if (p.id) return p
  const q = `keyword=${encodeURIComponent(p.name)}&region=${p.region}&localeInfo=en-US&size=50`
  const r = await getJson('https://api-search.plaync.com/aion2global/search/v2/character?' + q)
  const hit = (r?.list || []).find((x: Any) => x?.characterId && strip(x.name) === p.name && Number(x.serverId) === p.serverId)
  if (!hit) throw new Error('not found')
  ids[p.name] = String(hit.characterId)
  return { ...p, id: ids[p.name] }
}

export function ago(at: number, now = Date.now()) {
  const m = Math.max(0, Math.round((now - at) / 60000))
  return m < 1 ? t('dae.agoNow') : m < 60 ? t('dae.agoMin', { n: m }) : m < 2880 ? t('dae.agoH', { n: Math.round(m / 60) }) : t('dae.agoD', { n: Math.round(m / 1440) })
}

/** Board class id (class * 10 + slot): game class 1..10 minus 1 (checked against plaync: pcId 24 = Spiritmaster = 5x). */
export const gameClass = (): string | null => {
  const c = P.own ? classOf(P.own.pc) : 0
  return c > 1 ? String(c - 1) : null
}
export const gameLevel = (): number | null => P.own?.lv || null

/** Load the boards on their own once per character and session when they are missing or old. */
export function watch(load: (char: string) => void) {
  const tried = new Set<string>()
  onHost('pvp', () => setTimeout(() => {
    const o = P.own
    if (!o?.name || tried.has(o.name)) return
    const l = U.daeLive?.[o.name]
    if (l && Date.now() - l.at < MAX_AGE) return
    tried.add(o.name)
    load(o.name)
  }, 0))
}
