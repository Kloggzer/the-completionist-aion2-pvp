import { useEffect, useRef } from 'react'
import { MAP_TABS, S, U, V, saveUi, bump, useApp } from '@/core/state'
import { host } from '@/core/host'
import { t } from '@/core/i18n'
import { Header } from '@/components/Header'
import { Toasts } from '@/components/Toasts'
import { HoverTip } from '@/components/HoverTip'
import { MapView } from '@/features/map/MapView'
import { TargetsTab } from '@/features/pets/TargetsTab'
import { SpotsTab } from '@/features/pets/SpotsTab'
import { FarmTab, FarmToolbar } from '@/features/farm/FarmTab'
import { MerchantTab } from '@/features/merchant/MerchantTab'
import { BossModTab } from '@/features/bossmod/BossModPage'
import { MarketTab } from '@/features/market/MarketTab'
import { Footer } from '@/features/pets/Footer'
import { Toolbar } from '@/features/pets/parts'
import { TimerTab } from '@/features/events/TimerTab'
import { BossTab } from '@/features/events/BossTab'
import { CheckTab } from '@/features/progress/CheckTab'
import { AchTab } from '@/features/progress/AchTab'
import { BuildTab } from '@/features/build/BuildTab'
import { SettingsPanel } from '@/features/settings/SettingsPanel'
import { ArcanaTab } from '@/features/arcana/ArcanaTab'
import { HomeTab } from '@/features/home/HomeTab'
import { NpcapNotice, Welcome } from '@/features/home/Welcome'
import { cn } from '@/lib/utils'
import { Sidebar, SubNav } from '@/components/Sidebar'

/** Pet freshness footer only where pet progress is shown. */
const FOOTER_TABS = ['targets', 'spots']


// Mousedown on a [data-drag] area moves the window (the host starts a native move). Controls stay clickable.
function useWindowDrag() {
  useEffect(() => {
    const f = (e: MouseEvent) => {
      if (e.button !== 0) return
      const el = e.target as HTMLElement
      if (el.closest('button, input, a, [role=combobox], [role=listbox], [data-slot=select-trigger]')) return
      if (el.closest('[data-drag]')) { e.preventDefault(); host({ type: 'drag' }) }
    }
    document.addEventListener('mousedown', f)
    return () => document.removeEventListener('mousedown', f)
  }, [])
}

// Between map and list: drags the map height, or its width when map and list sit side by side (wide windows).
function Splitter() {
  const ref = useRef<HTMLDivElement>(null)
  const down = (e: React.PointerEvent) => {
    const split = ref.current!.parentElement!, r = split.getBoundingClientRect(), row = getComputedStyle(split).flexDirection === 'row'
    const mv = (ev: PointerEvent) => {
      if (row) U.mapW = Math.min(0.75, Math.max(0.25, (ev.clientX - r.left) / r.width))
      else U.mapH = Math.min(0.8, Math.max(0.15, (ev.clientY - r.top) / r.height))
      bump()
    }
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); saveUi([row ? 'mapW' : 'mapH']) }
    addEventListener('pointermove', mv); addEventListener('pointerup', up)
    e.preventDefault()
  }
  return <div ref={ref} onPointerDown={down} data-tip={t('split.tip')}
    className={cn('h-1.5 flex-none cursor-row-resize bg-border/60 transition-colors hover:bg-gold/50', '@min-[1100px]/main:h-auto @min-[1100px]/main:w-1.5 @min-[1100px]/main:cursor-col-resize')} />
}

function List() {
  switch (U.tab) {
    case 'spots': return <SpotsTab />
    case 'farm': return <FarmTab />
    case 'merchant': return <MerchantTab />
    case 'market': return <MarketTab />
    case 'ach': return <AchTab />
    case 'check': return <CheckTab />
    case 'arc': return <ArcanaTab />
    case 'dae': return <BuildTab />
    case 'boss': return <BossTab />
    case 'bossmod': return <BossModTab />
    case 'timer': return <TimerTab />
    case 'home': return <HomeTab />
    default: return <TargetsTab />
  }
}

// Fixed frame on every page: header, sidebar (components/Sidebar.tsx) left, content right. Map tabs show the map at the top of their content (resizable),
// then their toolbar (filters + view switch), then the list; from 1100 px content width (container query on main) the
// map sits left and toolbar + list right. The other
// tabs use the whole content.
export default function App() {
  useApp()
  useWindowDrag()
  const mapTab = MAP_TABS.includes(U.tab), view = mapTab ? U.view || 'both' : 'list', both = view === 'both'
  const size = { '--map-h': Math.round(U.mapH * 100) + '%', '--map-w': Math.round((U.mapW ?? 0.55) * 100) + '%' } as React.CSSProperties
  return (
    <div className={cn('@container/app relative flex h-full flex-col', S.ct && 'pointer-events-none')}>
      <Header />
      <div className="flex min-h-0 flex-1">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
      <SubNav />
      <NpcapNotice />
      <main className={cn('@container/main flex min-h-0 flex-1 flex-col', S.site && 'invisible')}>
        <div data-split className={cn('flex min-h-0 flex-1 flex-col', both && '@min-[1100px]/main:flex-row')} style={size}>
          {/* the map is dark game art in both themes: `dark` resolves the tokens of its overlays (pills, HUD, tips,
              toasts) to the dark set there; text-foreground because inherited text colour was resolved above */}
          <section className={cn('dark @container/map relative min-h-0 min-w-0 text-foreground', view === 'list' ? 'hidden' : view === 'map' ? 'flex-1' : 'h-(--map-h) flex-none',
            both && '@min-[1100px]/main:h-auto @min-[1100px]/main:w-(--map-w)')}>
            <MapView />
            {view !== 'list' && <Toasts className="top-9 left-1.5" />}
          </section>
          {both && <Splitter />}
          <div className={cn('flex min-h-0 min-w-0 flex-col', view === 'map' ? 'flex-none' : 'flex-1')}>
            {mapTab && (U.tab === 'farm' ? <FarmToolbar /> : <Toolbar kind={U.tab} />)}
            {view !== 'map' && (
              <div className="relative flex min-h-0 flex-1 flex-col">
                <section data-list className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
                  <List />
                </section>
                {view === 'list' && <Toasts className="bottom-2 left-2" />}
              </div>
            )}
          </div>
        </div>
        {FOOTER_TABS.includes(U.tab) && <Footer />}
      </main>
      </div>
      </div>
      {V.settingsOpen && <SettingsPanel />}
      <Welcome />
      <HoverTip />
    </div>
  )
}
