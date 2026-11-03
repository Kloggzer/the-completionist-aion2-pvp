// Session messages from the host: init, settings, pet state, capture status, window modes.
import { host, onHost } from './host'
import { DEF_UI, S, U, V, setU, bump, manual, type Any } from './state'
import { emit } from './bus'
import { setStartView } from './data'
import { lang, t } from './i18n'
import { toast } from './toast'
import { applyTheme } from './theme'

const norm = (st: Any) => Object.assign({ levels: {}, souls: {} }, st || {})

/** Tell the host the effective UI language (tray menu, announcer and alert texts). */
export function syncLang() { host({ type: 'lang', lang: lang() }); document.documentElement.lang = lang() }

onHost('init', m => {
  S.settings = m.settings; S.state = norm(m.state); S.replay = m.replay; S.status = m.status
  const u = Object.assign(structuredClone(DEF_UI), m.settings.ui || {})
  u.layers = Object.assign({}, DEF_UI.layers, u.layers)
  setU(u)
  applyTheme()
  setStartView(m.view)
  syncLang()
  if (manual()) leaveLive()
  else if (S.state.pos) emit('initPos', S.state.pos)
  emit('init')
  bump()
})
// newer release (host: Updater.cs): header button; auto = the portable exe can swap itself
onHost('update', m => {
  const known = V.update?.version === m.version
  V.update = { version: m.version, page: m.page, auto: !!m.auto, busy: V.update?.busy && known }
  if (!known) toast(t('upd.toast'), m.version, 1, true)
  bump()
})
onHost('updateFailed', () => { if (V.update) V.update.busy = false; toast(t('upd.failed'), t('upd.failedSub')); bump() })

onHost('settings', m => {
  const was = manual()
  S.settings = m.settings
  if (manual() && !was) leaveLive()
  emit('recompute'); bump()
})

/** Switch between automatic (Npcap) and manual tracking; the host restarts or stops the capture. */
export function setMode(mode: 'auto' | 'manual') {
  S.settings.mode = mode
  host({ type: 'mode', mode }); emit('recompute'); bump()
}

/** Manual mode: no position, radar or live objects (they all come from the traffic). The radar choice stays saved. */
function leaveLive() {
  S.pos = null; U.radar = false; V.near = null; V.live.clear()
  emit('draw')
}
onHost('state', m => { S.state = norm(m.state); emit('state'); emit('recompute'); bump() })
onHost('dock', m => { S.dock = { dock: m.dock, window: m.window }; bump() })
// Another character: the counters in S.state are the previous one's until the host sends the new state (right after
// this message), so nothing may count them for the new name in between.
onHost('char', m => {
  if (m.name !== S.state.charName && S.state.charName) { S.state.ach = {}; delete S.state.usage; delete S.state.usageAt }
  S.state.charName = m.name; bump()
})
onHost('status', m => { S.status = m; bump() })
onHost('clickThrough', m => { S.ct = m.on; document.body.classList.toggle('ct', m.on); bump() })
onHost('zoom', m => { if (S.settings && Math.abs(S.settings.zoom - m.v) > 0.001) { S.settings.zoom = m.v; bump() } })
onHost('opacity', m => { if (S.settings && Math.abs(S.settings.opacity - m.v) > 0.001) { S.settings.opacity = m.v; bump() } })
onHost('siteMode', m => { S.site = m.on; bump(); if (!m.on) requestAnimationFrame(() => emit('draw')) })

// ---------------------------------------------------------------- hotkeys (display text)

export const HK_IDS = ['toggle', 'click', 'radar', 'site', 'opaUp', 'opaDown', 'zoomIn', 'zoomOut', 'radarLock', 'pvp', 'winEdit'] as const
const KEY_DE: Record<string, string> = { PageUp: 'Bild ↑', PageDown: 'Bild ↓', Home: 'Pos1', End: 'Ende', Insert: 'Einfg', Delete: 'Entf', Oemplus: '+', OemMinus: '−' }
const KEY_EN: Record<string, string> = { PageUp: 'PgUp', PageDown: 'PgDn', Home: 'Home', End: 'End', Insert: 'Ins', Delete: 'Del', Oemplus: '+', OemMinus: '−' }
const MOD_DE: Record<string, string> = { Ctrl: 'Strg', 'Ctrl+Alt': 'Strg+Alt', 'Ctrl+Shift': 'Strg+Shift' }

/** Readable key name ("D5" -> "5", PageUp -> "Bild ↑"). */
export const keyText = (k: string) => (lang() === 'de' ? KEY_DE : KEY_EN)[k] ?? k.replace(/^D(\d)$/, '$1')
export const modText = (m: string) => (m === '' ? t('hk.none') : lang() === 'de' ? MOD_DE[m] ?? m : m)

/** Hotkey of an action as text, e.g. "Strg+Alt+O" ('' if none). */
export function hkText(id: string) {
  const c = S.settings?.hotkeys?.[id]
  return c ? c.split('+').map((p: string) => (lang() === 'de' ? MOD_DE[p] : undefined) ?? keyText(p)).join('+') : ''
}
