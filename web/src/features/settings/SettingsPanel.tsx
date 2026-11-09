// Settings overlay below the header: category nav left (the Sidebar look; icons only on narrow windows), content
// right in a form-width Page; centred with a max width on big windows.
import { ArrowLeft, Database, Keyboard, Layers, Map as MapIcon, Settings, SlidersHorizontal, Swords, Volume2 } from 'lucide-react'
import { S, U, V, saveUi, bump, useApp } from '@/core/state'
import { t } from '@/core/i18n'
import { Button } from '@/components/ui/button'
import { BAR, Page } from '@/components/kit'
import { General, Overlays, MapSettings, Notify, Boss, Hotkeys, Data } from './sections'
import { cn } from '@/lib/utils'

const CATS = [
  ['general', SlidersHorizontal, General],
  ['overlays', Layers, Overlays],
  ['map', MapIcon, MapSettings],
  ['notify', Volume2, Notify],
  ['boss', Swords, Boss],
  ['hotkeys', Keyboard, Hotkeys],
  ['data', Database, Data],
] as const

// the same item classes as the app sidebar (components/Sidebar.tsx)
const ITEM = 'flex h-8 w-full min-w-0 flex-none items-center gap-2 rounded-lg px-2 text-left text-[13px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground [&_svg]:size-4 [&_svg]:flex-none @max-[520px]:justify-center @max-[520px]:px-0'
const ON = 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'

export function SettingsPanel() {
  useApp()
  // categories of older versions: Targets & filters is part of Map & pets now, Live tracking of Connection & data
  const key = ({ filters: 'map', live: 'data' } as Record<string, string>)[U.setCat] ?? U.setCat
  const cat = CATS.find(c => c[0] === key) || CATS[0]
  const Body = cat[2]
  return (
    <div className="@container absolute inset-x-0 top-10 bottom-0 z-30 flex flex-col bg-background">
      {/* back to the app on the left (the header's own X closes the overlay window, not the settings) */}
      <div className={cn(BAR, 'flex-nowrap pr-3 pl-1.5')}>
        <Button variant="ghost" size="xs" data-settings-close className="h-6 text-[12px] text-muted-foreground" onClick={() => { V.settingsOpen = false; bump() }}><ArrowLeft />{t('common.back')}</Button>
        <span data-drag className="flex h-6 min-w-0 flex-1 cursor-grab items-center gap-1.5 text-[13px] font-semibold text-foreground [&_svg]:size-3.5 [&_svg]:flex-none [&_svg]:text-gold">
          <Settings /><span className="truncate">{t('set.title')}</span>
        </span>
      </div>
      {/* Big windows: nav + content as one centred column (max 1000 px), the content a form-width Page. */}
      <div className="mx-auto flex min-h-0 w-full max-w-[1000px] flex-1 @min-[1000px]:border-x">
        <nav aria-label={t('set.title')} className="flex w-52 flex-none flex-col gap-0.5 overflow-y-auto border-r bg-sidebar p-1.5 @max-[520px]:w-12">
          {CATS.map(([k, I]) => (
            <button key={k} data-tip={t('set.cat.' + k)} aria-label={t('set.cat.' + k)} data-on={cat[0] === k ? 'on' : undefined}
              onClick={() => { U.setCat = k; saveUi(['setCat']); bump() }} className={cn(ITEM, cat[0] === k && ON)}>
              <I />
              <span className="truncate @max-[520px]:hidden">{t('set.cat.' + k)}</span>
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          <Page w="form">{S.settings ? <Body /> : null}</Page>
        </div>
      </div>
    </div>
  )
}
