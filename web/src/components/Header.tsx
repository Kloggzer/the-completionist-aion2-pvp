import { AppWindow, Download, Globe, Pin, Settings, X, MousePointer2 } from 'lucide-react'
import { G, S, U, V, bump, hasState, manual, useApp, type Any } from '@/core/state'
import { host } from '@/core/host'
import { selectMap, mapName } from '@/core/data'
import { hkText } from '@/core/session'
import { t } from '@/core/i18n'
import { soulPets, computeTargets } from '@/features/pets/logic'
import { AppSelect } from './AppSelect'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const Paw = () => (
  <svg viewBox="0 0 24 24" aria-hidden className="size-[18px] flex-none fill-gold"><ellipse cx="12" cy="16" rx="5.2" ry="4.3" /><ellipse cx="5.4" cy="10.4" rx="2.1" ry="2.6" /><ellipse cx="9.4" cy="6.2" rx="2.1" ry="2.8" /><ellipse cx="14.6" cy="6.2" rx="2.1" ry="2.8" /><ellipse cx="18.6" cy="10.4" rx="2.1" ry="2.6" /></svg>
)

const withKey = (label: string, id: string) => { const h = hkText(id); return h ? `${label} (${h})` : label }

/** Icon-only header button: its tooltip's first line is also its accessible name. */
export function IconBtn({ on, className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean; 'data-tip'?: string }) {
  return <button aria-label={p['data-tip']?.split('\n')[0]} aria-pressed={on} {...p} className={cn('grid size-7 flex-none place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-4', on && 'bg-gold/15 text-gold', className)} />
}

// Below 520 px app width only the dot; its text goes into the tooltip.
function Status() {
  const st = manual() ? 'manual' : S.status.state, noLogin = st === 'live' && !hasState()
  const dot = { live: 'bg-green', waiting: 'bg-gold', error: 'bg-red', replay: 'bg-purple', manual: 'bg-cyan' }[st as string] || 'bg-dim'
  const text = S.ct ? t('hdr.click') : noLogin ? t('status.relog') : t('status.' + st)
  const tip = [text, S.status.text !== text && S.status.text, S.ct && t('status.ctActive', { key: hkText('click') })].filter(Boolean).join('\n')
  return (
    <span data-status={st} role="status" aria-label={text} data-tip={tip}
      className={cn('flex h-7 max-w-36 min-w-0 flex-none items-center gap-1.5 text-[12px] text-muted-foreground @max-[520px]/app:px-1', noLogin && 'text-gold')}>
      <i className={cn('size-2 flex-none rounded-full', dot, st === 'live' && 'shadow-[0_0_6px_var(--green)]')} />
      <span className="truncate @max-[520px]/app:hidden">{text}</span>
    </span>
  )
}

/** Ctrl + mouse wheel over the header: overlay opacity (plain wheel did it by accident). */
function wheelOpacity(e: React.WheelEvent) {
  if (!e.ctrlKey || (e.target as HTMLElement).closest('[data-slot=select-trigger]')) return
  host({ type: 'opacity', v: Math.round((S.settings.opacity + (e.deltaY < 0 ? 0.05 : -0.05)) * 100) / 100 })
}

export function Header() {
  useApp()
  const sp = soulPets(), have = sp.filter((p: Any) => (S.state.levels[p.id] || 0) > 0).length, max = sp.filter((p: Any) => (S.state.levels[p.id] || 0) >= 3).length
  const maps = G.maps.map((m: Any) => {
    const md = G.md[m.key], n = md ? computeTargets(md).filter((x: Any) => !x.done).length : null
    return { value: m.key, label: mapName(m.name) + (n != null ? ` (${n})` : '') }
  })
  // Inside an instance its map is shown: list it too (it is not part of the world map picker).
  if (U.map?.startsWith('dng:') && G.md[U.map]) maps.unshift({ value: U.map, label: G.md[U.map].name })
  const brandTip = (hasState() ? t('hdr.brandState', { have, total: sp.length, max }) : t('hdr.brandNone')) + '\n' + t('hdr.wheel')
  return (
    <header className="flex h-10 min-w-0 flex-none items-center gap-1.5 border-b bg-card pr-1 pl-2" onWheel={wheelOpacity}>
      <div data-drag className="flex flex-none cursor-grab items-center gap-1.5" data-tip={brandTip}>
        <Paw /><b className="font-semibold text-gold tabular-nums">{hasState() && sp.length ? `${have}/${sp.length}` : '–'}</b>
      </div>
      {maps.length > 0 && <AppSelect value={U.map} options={maps} onChange={k => selectMap(k)} tip={t('hdr.map')}
        className="h-7 max-w-52 flex-[0_1_auto] @max-[520px]/app:max-w-32" />}
      <span data-drag className="h-full min-w-2 flex-1 cursor-grab" />
      <Status />
      {V.update && <Button data-update size="xs" disabled={V.update.busy}
        data-tip={V.update.busy ? t('upd.busy') : t(V.update.auto ? 'upd.auto' : 'upd.page', { v: V.update.version })}
        aria-label={t('upd.btn', { v: V.update.version })}
        onClick={() => { if (V.update.auto) { V.update.busy = true; bump() } host({ type: 'updateNow' }) }}
        className="flex-none bg-gold/15 font-semibold text-gold hover:bg-gold/25 disabled:animate-pulse disabled:opacity-100 [&_svg]:size-3.5 @max-[520px]/app:px-1.5">
        <Download /><span className="@max-[520px]/app:hidden">{V.update.busy ? '…' : t('upd.btn', { v: V.update.version })}</span>
      </Button>}
      {/* always there, also while click-through is on: the host keeps the header clickable then (OverlayForm ctTimer) */}
      <IconBtn on={!!S.ct} data-ct={S.ct ? 'on' : 'off'} className="pointer-events-auto"
        data-tip={withKey(t('hdr.click'), 'click') + '\n' + t(S.ct ? 'hdr.click.on' : 'hdr.click.off')}
        onClick={() => host({ type: 'clickThrough' })}><MousePointer2 /></IconBtn>
      {S.site && <IconBtn on data-tip={withKey(t('hdr.site'), 'site')} onClick={() => host({ type: 'site', on: false, map: U.map })}><Globe /></IconBtn>}
      {S.dock && <IconBtn on={S.dock.dock !== 'auto'} data-tip={t(S.dock.window ? 'dock.isWindow' : 'dock.isOverlay') + '\n' + t(S.dock.dock === 'auto' ? 'dock.auto' : 'dock.manual')}
        onClick={() => host({ type: 'dock', dock: S.dock.window ? 'overlay' : 'window' })}>{S.dock.window ? <AppWindow /> : <Pin />}</IconBtn>}
      <IconBtn on={V.settingsOpen} data-tip={t('hdr.settings')} onClick={() => { if (S.site) host({ type: 'site', on: false }); V.settingsOpen = !V.settingsOpen; bump() }}><Settings /></IconBtn>
      <IconBtn data-tip={withKey(t('hdr.hide'), 'toggle')} onClick={() => host({ type: 'hide' })}><X /></IconBtn>
    </header>
  )
}
