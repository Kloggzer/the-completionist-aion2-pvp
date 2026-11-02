// Colour theme: light ("Aion Ember"), dark ("Night Indigo") or the system's choice (U.theme). The tokens live in
// index.css (:root = light, .dark = dark); this only sets the class on <html> and follows the system setting live.
import { U } from './state'

const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null

export function applyTheme() {
  const t = U.theme || 'system', dark = t === 'dark' || (t === 'system' && (media?.matches ?? true))
  document.documentElement.classList.toggle('dark', dark)
}
media?.addEventListener('change', () => { if ((U.theme || 'system') === 'system') applyTheme() })
