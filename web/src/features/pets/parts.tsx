// Small building blocks shared by the targets and spots lists.
import { Check, Columns2, EyeOff, Globe, Info, List, Map as MapIcon, Search, X, type LucideIcon } from 'lucide-react'
import { U, V, saveUi, bump, type Any } from '@/core/state'
import { goTab } from '@/core/nav'
import { host } from '@/core/host'
import { emit } from '@/core/bus'
import { t } from '@/core/i18n'
import { AppSelect } from '@/components/AppSelect'
import { cn } from '@/lib/utils'
import { Bar, Chip, Seg, ToolbarStrip } from '@/components/kit'
import { Button } from '@/components/ui/button'
export { Empty } from '@/components/kit'
import { SORTS, clearMulti, mobGroups, recompute, spotsForSelection } from './logic'
import { petName } from '@/core/data'

export { rich } from '@/components/kit'

export { Sect } from '@/components/kit'

/** Progress bar: cyan while unlocking, gold while levelling. */
export const Pbar = ({ lv, frac, className }: { lv: number; frac: number; className?: string }) => <Bar frac={frac} tone={lv === 0 ? 'cyan' : 'gold'} className={className} />

/** Three level dots. */
export const LvDots = ({ lv }: { lv: number }) => (
  <span className="flex flex-none gap-0.5" data-tip={t('pets.lvTip', { lv })}>
    {[1, 2, 3].map(l => <i key={l} className={cn('size-[7px] rounded-full border border-dim', l <= lv && 'border-gold bg-gold')} />)}
  </span>
)

/** Category/colour marker (rotated square). */
export const Dot = ({ col, className }: { col?: string; className?: string }) => (
  <span className={cn('mt-[5px] size-2 flex-none rotate-45 rounded-[2px]', className)} style={col ? { background: col } : undefined} />
)

// The map picker counts and both lists depend on the filters, so everything is recomputed.
function toggle(f: string, on: boolean) { U[f] = on; saveUi([f]); emit('recompute') }

type View = 'both' | 'map' | 'list'
function setView(v: View) { U.view = v; saveUi(['view']); bump(); requestAnimationFrame(() => emit('fit')) }

/** Map / map + list / list switch of the map tabs (icons; the label is the tip and the aria-label). */
function ViewSwitch() {
  const views: { value: View; icon: LucideIcon }[] = [{ value: 'both', icon: Columns2 }, { value: 'map', icon: MapIcon }, { value: 'list', icon: List }]
  return <Seg size="sm" iconOnly value={(U.view || 'both') as View} onChange={setView}
    options={views.map(v => ({ ...v, label: t('hdr.view.' + v.value), tip: t('hdr.view.' + v.value) }))} />
}

/** Toolbar of the map tabs, between map and list (stays below the map in "map only"). Empty space drags the window. */
export function Toolbar({ kind }: { kind: 'targets' | 'spots' }) {
  const opts = SORTS.map(k => ({ value: k, label: t('pets.sort.' + k) }))
  const lv = U.lvMin > 1 || U.lvMax < 60
  return (
    <ToolbarStrip>
      {kind === 'targets' && <AppSelect value={U.sort} options={opts} tip={t('pets.sort.tip')} className="h-6 text-xs"
        onChange={v => { U.sort = v; saveUi(['sort']); emit('recompute') }} />}
      {lv && <span data-drag data-tip={t('pets.chip.lv.tip')} className="flex min-w-0 cursor-grab items-center gap-1 truncate px-1 text-[11.5px] text-muted-foreground">
        <Info className="size-3.5 flex-none" /><span className="truncate">{t('pets.lvFilter', { a: U.lvMin, b: U.lvMax })}</span>
      </span>}
      <span data-drag className="h-5 min-w-2 flex-1 cursor-grab" />
      <Chip on={!!U.hideNamed} onChange={v => toggle('hideNamed', v)} tip={t('pets.chip.hideNamed.tip')} className="h-6"><EyeOff />{t('pets.chip.hideNamed')}</Chip>
      {kind === 'targets' && <Chip on={!!U.showLv3} onChange={v => toggle('showLv3', v)} tip={t('pets.chip.showLv3.tip')} className="h-6"><Check />{t('pets.chip.showLv3')}</Chip>}
      <ViewSwitch />
    </ToolbarStrip>
  )
}

/** Checkbox of a target tile: always there while something is selected (data-pin), else only on hover of the tile
 *  (the tile needs `group`), so multi-select is discoverable without cluttering the grid. */
export const PinBox = ({ on, hover }: { on: boolean; hover?: boolean }) => (
  <span data-pin={hover ? undefined : ''} data-pinhint={hover ? '' : undefined}
    className={cn('mt-px ml-auto grid size-4 flex-none place-items-center rounded-[3px] border transition-colors', on ? 'border-gold bg-gold text-primary-foreground' : 'border-dim/80',
      hover && 'invisible group-hover:visible')}>
    {on && <Check className="size-3 stroke-3" />}
  </span>
)

/** Selection bar above the targets/spots list while pets are multi-selected. */
export function SelBar() {
  if (!V.multi.size) return null
  const sel = V.targets.filter((x: Any) => V.multi.has(x.p.id)), names = sel.map((x: Any) => petName(x.p)).join(', ')
  const one = sel.length === 1 ? mobGroups(sel[0])[0] : null
  const spotsTab = U.tab === 'spots'
  return (
    <div data-selbar className="sticky top-0 z-10 flex min-h-9 items-center gap-1.5 border-b border-gold/35 bg-card px-2.5 py-1 text-[12px]">
      <b className="flex-none font-semibold text-gold">{t('sel.n', { n: V.multi.size })}</b>
      <span data-tip={names} className="min-w-0 flex-1 truncate text-muted-foreground">{spotsTab && V.spotsSel ? t('sel.spotsFor') : names}</span>
      {spotsTab && V.spotsSel
        ? <Button size="xs" variant="outline" data-tip={t('sel.allSpots.tip')}
          onClick={() => { V.spotsSel = false; V.spot = null; recompute(); emit('fit') }}>{t('sel.allSpots')}</Button>
        : <Button size="xs" data-tip={t('sel.find.tip')}
          onClick={() => { spotsForSelection(); goTab('spots', '[data-spot="1"]') }}><Search />{t('sel.find')}</Button>}
      {one && <Button size="icon-xs" variant="ghost" data-tip={t('pets.site')} aria-label={t('pets.site')}
        onClick={() => host({ type: 'site', on: true, map: U.map, search: one.n })}><Globe /></Button>}
      <Button size="xs" variant="ghost" data-tip={t('sel.clear')} aria-label={t('sel.clear')} onClick={clearMulti}><X /><span className="@max-[420px]:hidden">{t('sel.clear')}</span></Button>
    </div>
  )
}
