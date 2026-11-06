// Navigation: four areas (Today, Pets, Farming, Character) with their pages. Wide windows: a sidebar with every page
// under its area; narrow windows (< 760 px) or the collapsed sidebar (U.navMini): area icons only, the pages of the
// current area as a segmented control above the content (SubNav). Page keys are the tab keys (U.tab) plus the build
// pages (dae.stats, dae.gear); an area remembers its last page (U.lastPage), however the page was reached.
import { useEffect } from 'react'
import { BarChart3, Clock, Gem, Grid3x3, Layers, LayoutDashboard, ListChecks, MapPin, PanelLeftClose, PanelLeftOpen, PawPrint, Pickaxe, Shield, Skull, Store, Sun, Swords, Target, Trophy, UserRound, type LucideIcon } from 'lucide-react'
import { U, V, saveUi, bump } from '@/core/state'
import { goTab } from '@/core/nav'
import { t } from '@/core/i18n'
import { cn } from '@/lib/utils'
import { BADGE, Seg } from '@/components/kit'
import { buyCount, freshOffers } from '@/features/merchant/logic'
import { bs, setBuild, type Page as BuildPage } from '@/features/build/build'
import { buyNow } from '@/features/market'

type NavPage = { key: string; tab: string; build?: BuildPage; icon: LucideIcon; label: () => string; count?: () => number }
type Area = { key: string; icon: LucideIcon; pages: NavPage[] }

const tabPage = (tab: string, icon: LucideIcon, count?: () => number): NavPage => ({ key: tab, tab, icon, label: () => t('tab.' + tab), count })
const buildPage = (build: BuildPage, icon: LucideIcon): NavPage => ({ key: build === 'dae' ? 'dae' : 'dae.' + build, tab: 'dae', build, icon, label: () => t('nav.' + build) })

/** Offers of this hour still worth buying (the merchant's own count). */
const merchBuy = () => (U.merch ? buyCount(freshOffers(U.merch, Date.now())) : 0)

// Badges count what is open and worth acting on now (missing pets, spots, merchant offers to buy); the achievements'
// open count is always large and was noise.
export const AREAS: Area[] = [
  { key: 'today', icon: Sun, pages: [tabPage('home', LayoutDashboard), tabPage('check', ListChecks), tabPage('boss', Skull), tabPage('bossmod', Swords), tabPage('timer', Clock)] },
  { key: 'pets', icon: PawPrint, pages: [
    tabPage('targets', Target, () => V.targets.filter((x: { done: boolean }) => !x.done).length), tabPage('spots', MapPin, () => V.spots.length), tabPage('merchant', Store, merchBuy)] },
  { key: 'farm', icon: Pickaxe, pages: [tabPage('farm', Pickaxe)] },
  { key: 'char', icon: UserRound, pages: [buildPage('dae', Grid3x3), buildPage('stats', BarChart3), buildPage('gear', Shield), tabPage('arc', Layers), tabPage('ach', Trophy), tabPage('market', Gem, buyNow)] },
]

const known = (key: string) => AREAS.some(a => a.pages.some(p => p.key === key))
/** Key of the page shown now (an unknown build page, e.g. from an older save, counts as the Daevanion page). */
export const navKey = () => {
  if (U.tab !== 'dae') return U.tab
  const k = bs().page === 'dae' ? 'dae' : 'dae.' + bs().page
  return known(k) ? k : 'dae'
}
const areaOf = (key: string) => AREAS.find(a => a.pages.some(p => p.key === key)) || AREAS[0]

export function goPage(p: NavPage) {
  if (p.build) setBuild({ page: p.build })
  goTab(p.tab)
}
function goArea(a: Area) {
  if (areaOf(navKey()) === a) return
  goPage(a.pages.find(p => p.key === U.lastPage?.[a.key]) || a.pages[0])
}

function Badge({ n, on }: { n: number; on?: boolean }) {
  return n > 0 ? <i className={cn(BADGE, 'ml-auto flex-none', on && 'bg-gold/20 text-gold')}>{n}</i> : null
}

export function Sidebar() {
  const cur = navKey(), mini = !!U.navMini
  // remember the page for its area on every navigation (sidebar, SubNav, goTab from cards and links)
  useEffect(() => {
    const a = areaOf(cur)
    if (!known(cur) || U.lastPage?.[a.key] === cur) return
    U.lastPage = { ...U.lastPage, [a.key]: cur }; saveUi(['lastPage'])
  }, [cur])
  const toggle = () => { U.navMini = !mini; saveUi(['navMini']); bump() }
  const item = 'flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-[13px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground [&_svg]:size-4 [&_svg]:flex-none'
  const on = 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
  return (
    <nav data-tabs data-mini={mini ? 'on' : undefined} aria-label={t('nav.label')}
      className={cn('flex flex-none flex-col gap-0.5 overflow-y-auto border-r bg-sidebar p-1.5', mini ? 'w-12' : 'w-12 @min-[760px]/app:w-[176px] @min-[760px]/app:p-2')}>
      {AREAS.map(a => {
        const inArea = areaOf(cur) === a, sum = a.pages.reduce((n, p) => n + (p.count?.() || 0), 0)
        return (
          <div key={a.key} className="flex flex-col gap-0.5">
            {/* icon-only area button (narrow / collapsed) */}
            <button data-area={a.key} data-nav={a.pages.length === 1 ? a.pages[0].key : undefined} data-on={inArea ? 'on' : undefined} onClick={() => goArea(a)} data-tip={t('area.' + a.key)} aria-label={t('area.' + a.key)}
              aria-current={inArea && a.pages.length === 1 ? 'page' : undefined}
              className={cn(item, 'relative justify-center px-0', inArea && on, !mini && '@min-[760px]/app:hidden')}>
              <a.icon />{sum > 0 && !inArea && <i className="absolute top-1 right-1 size-1.5 rounded-full bg-gold" />}
            </button>
            {/* wide: area caption + every page */}
            <div className={cn('hidden flex-col gap-0.5', !mini && '@min-[760px]/app:flex')}>
              <span className="flex items-center gap-1.5 px-2 pt-2.5 pb-1 text-[12px] font-semibold text-muted-foreground [&_svg]:size-3.5">
                <a.icon />{t('area.' + a.key)}
              </span>
              {a.pages.map(p => {
                const sel = p.key === cur, n = p.count?.() || 0
                return (
                  <button key={p.key} data-nav={p.key} data-on={sel ? 'on' : undefined} onClick={() => goPage(p)} data-tip={p.label()} aria-current={sel ? 'page' : undefined}
                    className={cn(item, 'pl-3', sel && on)}>
                    <p.icon /><span className="min-w-0 truncate">{p.label()}</span><Badge n={n} on={sel} />
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
      <span className="flex-1" />
      <button onClick={toggle} data-tip={t(mini ? 'nav.expand' : 'nav.collapse')} aria-label={t(mini ? 'nav.expand' : 'nav.collapse')} className={cn(item, 'hidden justify-center px-0 @min-[760px]/app:flex', !mini && '@min-[760px]/app:justify-start @min-[760px]/app:px-2')}>
        {mini ? <PanelLeftOpen /> : <><PanelLeftClose /><span className="truncate">{t('nav.collapse')}</span></>}
      </button>
    </nav>
  )
}

/** Pages of the current area as a segmented control: shown in narrow windows and with the sidebar collapsed. */
export function SubNav() {
  const cur = navKey(), a = areaOf(cur)
  if (a.pages.length < 2) return null
  return (
    <div data-subnav className={cn('flex flex-none border-b bg-card px-2.5 py-1.5', !U.navMini && '@min-[760px]/app:hidden')}>
      <Seg value={cur} onChange={k => goPage(a.pages.find(p => p.key === k)!)} className="[&>*]:flex-none @max-[560px]/app:[&>:not([data-pressed])]:flex-none @max-[560px]/app:[&>:not([data-pressed])>span]:hidden" item={v => ({ 'data-nav': v, 'data-on': v === cur ? 'on' : undefined })}
        options={a.pages.map(p => ({ value: p.key, label: p.label(), icon: p.icon, tip: p.label() }))} />
    </div>
  )
}
