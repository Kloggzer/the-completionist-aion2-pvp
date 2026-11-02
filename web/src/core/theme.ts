// Colour theme: light ("Aion Ember"), dark ("Night Indigo") or the system's choice (U.theme). The tokens live in
// index.css (:root = light, .dark = dark); this only sets the class on <html> and follows the system setting live.
// The choice is mirrored to localStorage so index.html can set the class before the CSS loads (no flash before the
// host's init arrives); the host settings stay the source of truth.
import { U } from './state'

const KEY = 'theme'
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
const set = (t: string) => document.documentElement.classList.toggle('dark', t === 'dark' || (t === 'system' && (media?.matches ?? true)))

/** Apply U.theme (after init and on every change) and remember it for the next start. */
export function applyTheme() {
  const t = U.theme || 'system'
  set(t)
  try { localStorage.setItem(KEY, t) } catch { /* storage blocked: only the early guess in index.html is lost */ }
}
media?.addEventListener('change', () => { if ((U.theme || 'system') === 'system') applyTheme() })

// module load (before init, U still holds the defaults): the stored choice
try { set(localStorage.getItem(KEY) || 'system') } catch { set('system') }
