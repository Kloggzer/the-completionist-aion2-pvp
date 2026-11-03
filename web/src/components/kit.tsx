// Shared building blocks of every view: one page frame, one top bar, one section header, one tile, one flat row, one
// chip, one bar, and the primitives below (Seg, Chip, Stepper, Panel, Disclosure, TopN, PanelTabs on Base UI).
// Spacing scale: 6 px gaps (gap-1.5), 10 px outer padding (px-2.5), 12 px text inset (px-3). Type scale (Manrope):
// section 12 px semibold (no capitals anywhere), title 13 px semibold, text 13 px, sub 12 px muted, meta 11.5 px; page titles 19 px bold.
// Radius: rounded-lg for controls and tiles, rounded-xl for panels. Colours only via tokens (index.css: light "Aion
// Ember", dark "Night Indigo"; `gold` = the accent). Controls never wrap (index.css): long labels truncate.
// Icons: 14 px (size-3.5) in rows and bars, 28 px / stroke 1.5 in tile icon columns, 18 px in bell / step columns.
//
// Responsive system (container queries, never the viewport: the overlay can be any size):
// - Every tab renders inside <Page>: full width and dense at overlay sizes, centred with a max width on large
//   windows (tiles 1680 px, rows 1400 px, forms 760 px). The page is the @container all breakpoints below refer to.
// - Every tab has one bar at the top of its list (BAR, min 40 px): info text left (its empty space drags the window),
//   filter chips / actions right-aligned (<BarRight>). Map tabs: <ToolbarStrip> between map and list; the other
//   tabs: <Page bar={…}> (sticky, full width, content aligned with the page).
// - Tile grids (grid()): auto-fill columns with a minimum tile width that grows on wide pages, so tiles never get
//   narrower than readable nor wider than ~2x their minimum, and a maximized window shows 6-8 columns, not 15.
// - Row lists (<Columns>): one column up to 900 px, then 2, from 1300 px 3 columns of row blocks (day groups,
//   overview blocks) instead of rows stretched over the full width.
// - Tiles have one anatomy (T_* classes): one-line title, two-line sub, bar + footer at the bottom, so all tiles of
//   a grid are equally high; portrait tiles (TILE_P) put a square portrait / icon column left of that text column,
//   optional control columns (bell, −/+) at the right edge.
// - Breakpoints: 520 (overlay wide), 900 (2 columns / bigger tiles), 1300 (3 columns / biggest tiles). The map tabs
//   switch to map left / list right at 1100 px content width (App.tsx).
import { Fragment, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Bell, BellOff, ChevronRight, Minus, Plus, type LucideIcon } from 'lucide-react'
import { host } from '@/core/host'
import { U, bump, saveUi, useApp } from '@/core/state'
import { cn } from '@/lib/utils'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress as ProgressPrimitive } from '@base-ui/react/progress'

// ---------------------------------------------------------------- text + layout classes

export const TITLE = 'text-[13px] leading-tight font-semibold [overflow-wrap:anywhere]'
export const SUB = 'text-[12px] leading-tight whitespace-normal text-muted-foreground [overflow-wrap:anywhere]'
export const META = 'text-[11.5px] text-muted-foreground tabular-nums'
export const CLAMP2 = 'line-clamp-2 whitespace-normal'
/** Gap above a tile grid / row list that starts right below the bar (no section header in between). */
export const LEAD = 'pt-2.5'

/** Status text colours, the same meaning in every tab. */
export const TONE = { ok: 'text-green', warn: 'text-gold', bad: 'text-red', info: 'text-cyan', off: 'text-dim' } as const
/** Tinted boxes (tile icon columns, badges). */
export const BOX = {
  gold: 'text-gold bg-gold/10 border-gold/25', cyan: 'text-cyan bg-cyan/10 border-cyan/25', green: 'text-green bg-green/10 border-green/30',
  red: 'text-red bg-red/10 border-red/35', purple: 'text-purple bg-purple/10 border-purple/25', dim: 'text-dim bg-foreground/[0.03] border-foreground/10',
} as const
export type BoxTone = keyof typeof BOX
/** Tile border accent per traffic light. */
export const ACCENT = { red: 'border-red/50 bg-red/[0.06]', yellow: 'border-gold/40', green: 'border-green/30', none: '' } as const

/** Tile grid sizes: minimum tile width per page width (px): base / page >= 900 / page >= 1300. */
const TILE_W = {
  boss: '[--tile:165px] @min-[900px]:[--tile:210px] @min-[1300px]:[--tile:230px]', // boss cards (portrait + bell)
  pet: '[--tile:160px] @min-[900px]:[--tile:200px] @min-[1300px]:[--tile:220px]', // portrait tiles: pets, nearby, spots, achievements
  md: '[--tile:150px] @min-[900px]:[--tile:190px] @min-[1300px]:[--tile:215px]', // small text tiles
  row: '[--tile:230px] @min-[900px]:[--tile:260px] @min-[1300px]:[--tile:280px]', // checklist / charge / character tiles (with −/+)
}
export type TileSize = keyof typeof TILE_W

/** Responsive tile grid (inside a <Page>): auto-fill columns, min tile width grows with the page width. */
export const grid = (size: TileSize = 'md') =>
  cn('grid grid-cols-[repeat(auto-fill,minmax(min(var(--tile),100%),1fr))] gap-1.5 px-2.5 pb-1.5', TILE_W[size])

/** Top bar of a tab (min 40 px, wraps as a whole): info left, chips right. */
export const BAR = 'flex min-h-10 flex-none flex-wrap items-center gap-x-1.5 gap-y-1 border-b bg-card px-2.5 py-1.5 text-[12.5px] text-muted-foreground'

/** Page frame of every tab: the container the responsive rules query, centred with a max width on big windows.
 *  `bar` = the tab's top bar (sticky, full width, its content aligned with the page). */
const PAGE_W = { tiles: 'max-w-[1680px]', rows: 'max-w-[1400px]', form: 'max-w-[760px]' }
export function Page({ w = 'tiles', bar, children, className }: { w?: keyof typeof PAGE_W; bar?: ReactNode; children: ReactNode; className?: string }) {
  return <>
    {bar && <div data-bar className="sticky top-0 z-10 border-b bg-card"><div className={cn(BAR, 'mx-auto w-full border-b-0', PAGE_W[w])}>{bar}</div></div>}
    <div className={cn('@container mx-auto w-full min-w-0 pb-3', PAGE_W[w], className)}>{children}</div>
  </>
}

/** Blocks of rows side by side on wide pages: 1 column, 2 from 900 px, 3 from 1300 px. Children are the blocks. */
export function Columns({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid items-start gap-x-4 @min-[900px]:grid-cols-2 @min-[1300px]:grid-cols-3 [&>*]:min-w-0', className)}>{children}</div>
}

/** Tile: bordered box with title / sub / bar / footer slots (use the classes above inside). */
export const TILE = 'flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card px-2 pt-1.5 pb-1 text-left whitespace-normal shadow-(--shadow-card)'
/** Tile anatomy, the same in every grid so tiles in a row line up: a one-line title (full text in the tooltip), a sub
 *  text that always takes exactly two lines, then bar + footer pinned to the bottom (T_FOOT). */
export const T_TITLE = cn(TITLE, 'truncate')
export const T_SUB = cn(SUB, 'mt-0.5 line-clamp-2 min-h-[2lh]')
export const T_FOOT = 'mt-auto'
/** Footer line of a tile: value left, extras right. */
export const T_META = 'flex min-w-0 items-center justify-between gap-1.5 text-[11.5px] text-muted-foreground tabular-nums'
/** Portrait tile: square portrait column at the left edge (60 px, 64 px on wide pages), text column right of it. */
export const TILE_P = 'flex-row items-stretch gap-2.5 p-1.5 pr-2'
// Hidden in narrow windows (the overlay next to the game): text first; from 700 px a compact square.
export const T_PORTRAIT = 'hidden @min-[700px]:inline-grid size-[44px] @min-[1300px]:size-[52px]'
export const T_BODY = 'flex min-w-0 flex-1 flex-col'
export const TILE_CLICK = 'cursor-pointer transition-colors hover:border-gold/40 hover:bg-accent/40'
export const TILE_SEL = 'border-gold bg-gold/[0.06] ring-1 ring-gold/60 hover:border-gold hover:bg-gold/[0.06]'

/** Flat row with a hairline separator (lists without frames). */
export const ROW = 'flex min-h-9 min-w-0 items-center gap-2.5 border-b border-border/50 px-3 text-[13px]'
export const ROW_CLICK = 'cursor-pointer hover:bg-foreground/5'
/** Hairline above a block of ROWs. */
export const ROWS = 'border-t border-border/50'
/** Icon slot of a row (time | icon | name …). */
export const ROW_ICON = 'grid w-[22px] flex-none place-items-center [&_svg]:size-4'

/** Toggle chip (filters) – same look in every bar, 28 px high like Seg md and Button sm. */
export const CHIP = 'inline-flex h-7 max-w-full min-w-0 flex-none items-center gap-1.5 truncate rounded-lg border border-border bg-card px-2.5 text-[12.5px] whitespace-nowrap text-muted-foreground transition-colors hover:border-gold/40 hover:text-foreground [&_svg]:size-3.5 [&_svg]:flex-none'
export const CHIP_ON = 'border-gold/45 bg-gold/[0.12] font-semibold text-gold hover:border-gold/60 hover:bg-gold/[0.16] hover:text-gold'

/** Small count badge (tab bar, headers). */
export const BADGE = 'rounded-full bg-accent px-1.5 text-[11px] font-semibold not-italic text-muted-foreground tabular-nums'

/** Small action at the right of a section header ("Alle erledigt", "Mitgliedschaft"). */
export const SECT_BTN = 'flex items-center gap-1 rounded-sm px-1 py-0.5 text-[11px] text-muted-foreground hover:bg-foreground/5 hover:text-foreground [&_svg]:size-3'

// ---------------------------------------------------------------- components

/** Section header: 12 px semibold line (sentence case); `sub` inline after it, `right` (link/action) at the end. */
export function Sect({ children, sub, right, className }: { children: ReactNode; sub?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-h-7 items-center gap-1.5 px-3 pt-2.5 pb-1 text-[12px] font-semibold text-muted-foreground', className)}>
      <span className="flex-none">{children}</span>
      {sub && <span className="min-w-0 truncate font-normal">{sub}</span>}
      {right && <span className="ml-auto flex flex-none items-center gap-1 font-normal">{right}</span>}
    </div>
  )
}

/** "alle Timer ›" style link at the right of a section header. */
export function More({ onClick, children, tip }: { onClick: () => void; children: ReactNode; tip?: string }) {
  return (
    <button onClick={onClick} data-tip={tip} className="flex items-center gap-0.5 rounded-sm px-1 py-0.5 text-[11px] text-muted-foreground hover:bg-foreground/5 hover:text-gold">
      {children}<ChevronRight className="size-3" />
    </button>
  )
}

/** Thin progress bar, frac 0..1. cyan = unlocking, gold = levelling / filling up, green = progress/done, red = overflowing. */
export function Bar({ frac, tone = 'green', className }: { frac: number; tone?: 'cyan' | 'gold' | 'green' | 'red' | 'dim'; className?: string }) {
  const fill = { cyan: 'bg-cyan', gold: 'bg-gold', red: 'bg-red', dim: 'bg-dim', green: frac >= 1 ? 'bg-green' : 'bg-linear-to-r from-green to-cyan' }[tone]
  const pct = Math.min(100, Math.max(0, frac * 100))
  return (
    <ProgressPrimitive.Root value={pct} className={cn('my-1 flex-none', className)}>
      <ProgressPrimitive.Track className="block h-[3px] overflow-hidden rounded-full bg-foreground/[0.07]">
        <ProgressPrimitive.Indicator className={cn('block h-full rounded-full transition-[width]', fill)} />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  )
}

/** Info text at the left of a bar: one line, truncated; its empty space drags the window. */
export function BarInfo({ children, tip }: { children: ReactNode; tip?: string }) {
  return (
    <span data-drag data-tip={tip} className="min-w-0 flex-[1_1_9rem] cursor-grab truncate px-1 text-[11.5px] leading-6 text-muted-foreground [&_svg]:inline [&_svg]:size-3 [&_svg]:align-[-2px]">
      {children}
    </span>
  )
}
/** Right-aligned group of a bar (filter chips, actions). */
export function BarRight({ children }: { children: ReactNode }) {
  return <span className="ml-auto flex flex-wrap items-center justify-end gap-1">{children}</span>
}

/** Toolbar strip of the map tabs (between map and list): the same bar, controls left, drag space, controls right. */
export function ToolbarStrip({ children }: { children: ReactNode }) {
  return <div className={BAR}>{children}</div>
}

/** Empty / loading state of a whole tab. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-center text-[13px] leading-relaxed whitespace-normal text-muted-foreground">{children}</p>
}
/** Empty state inside a section (one muted line). */
export function Note({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn(SUB, 'px-3 py-1.5', className)}>{children}</p>
}
/** Explanation at the end of a page. */
export function Foot({ children }: { children: ReactNode }) {
  return <p className="px-3 pt-2.5 text-[11.5px] leading-normal text-dim">{children}</p>
}

/** Icon column of a tile (same size as a portrait), tinted. */
export function TileIcon({ icon: I, tone, tip, className, children }: { icon?: LucideIcon; tone: BoxTone; tip?: string; className?: string; children?: ReactNode }) {
  return (
    <span data-tip={tip} className={cn(T_PORTRAIT, 'relative grid flex-none place-items-center rounded-sm border', BOX[tone], className)}>
      {I && <I className="size-7" strokeWidth={1.5} />}{children}
    </span>
  )
}

/** "A" badge: the value is counted / read automatically from the game. */
export function AutoBadge({ tip }: { tip: string }) {
  return <span data-tip={tip} className="flex-none rounded-[3px] border border-green/40 px-[3px] text-[9.5px] leading-[13px] font-bold text-green">A</span>
}

/** −/+ column at the right edge of a tile (+ above, − below), full tile height so both are easy to hit.
 *  The tile needs TILE_P + 'pr-0'. */
export function StepCol({ onStep, minus = true, plus = true, tips }: { onStep: (d: 1 | -1) => void; minus?: boolean; plus?: boolean; tips: [string, string] }) {
  const b = 'flex flex-1 items-center justify-center text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-gold disabled:pointer-events-none disabled:opacity-25 [&_svg]:size-4.5'
  return (
    <span className="-my-1 flex w-10 flex-none flex-col self-stretch border-l">
      <button className={b} disabled={!plus} data-tip={tips[1]} aria-label={tips[1]} onClick={e => { e.stopPropagation(); onStep(1) }}><Plus /></button>
      <button className={cn(b, 'border-t')} disabled={!minus} data-tip={tips[0]} aria-label={tips[0]} onClick={e => { e.stopPropagation(); onStep(-1) }}><Minus /></button>
    </span>
  )
}

/** Big bell toggle at the right end of an event row or tile: full height, wide hit area. */
export function BellBtn({ on, onClick, tip, className }: { on: boolean; onClick: (e: MouseEvent) => void; tip: string; className?: string }) {
  return (
    <button onClick={onClick} data-tip={tip} aria-label={tip} aria-pressed={on}
      className={cn('flex w-10 flex-none items-center justify-center self-stretch transition-colors', on ? 'bg-gold/10 text-gold hover:bg-gold/20' : 'text-dim hover:bg-foreground/10 hover:text-muted-foreground', className)}>
      {on ? <Bell className="size-4.5" /> : <BellOff className="size-4.5" />}
    </button>
  )
}

/** Hint box (login hints etc.). */
export function Hint({ children, tone = 'gold' }: { children: ReactNode; tone?: 'gold' | 'cyan' }) {
  return (
    <div className={cn('mx-2.5 mt-2.5 rounded-lg border px-3 py-2 text-[12.5px] leading-snug whitespace-normal',
      tone === 'gold' ? 'border-warn-line bg-warn-bg text-warn' : 'border-cyan/25 bg-cyan/[0.06] text-muted-foreground')}>{children}</div>
  )
}

/** Translated text with **bold** parts and {slot} placeholders replaced by elements (links, buttons). */
export function rich(s: string, slots: Record<string, ReactNode> = {}) {
  return s.split(/(\*\*.+?\*\*|\{\w+\})/).map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**') && p.length > 4) return <b key={i} className="font-semibold text-foreground">{p.slice(2, -2)}</b>
    const slot = /^\{(\w+)\}$/.exec(p)?.[1]
    return <Fragment key={i}>{slot && slot in slots ? slots[slot] : p}</Fragment>
  })
}

/** Npcap download page (the host opens it in the browser; it only allows aion2maps.com and npcap.com). */
export const NPCAP_URL = 'https://npcap.com/#download'
export const NpcapLink = () => <a href={NPCAP_URL} target="_blank" rel="noreferrer" className="text-gold hover:underline">npcap.com</a>

/** Single-line text field. The overlay never takes the keyboard: while the field has focus the host lets the window
 *  activate (host message 'typing'). Enter submits, Escape cancels. */
export function TextEntry({ value, onChange, onSubmit, onCancel, placeholder, className }: {
  value: string; onChange: (v: string) => void; onSubmit: () => void; onCancel?: () => void; placeholder?: string; className?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus(); return () => host({ type: 'typing', on: false }) }, [])
  return (
    <input ref={ref} value={value} placeholder={placeholder} maxLength={40} spellCheck={false}
      onFocus={() => host({ type: 'typing', on: true })} onBlur={() => host({ type: 'typing', on: false })}
      onChange={e => onChange(e.target.value)} onClick={e => e.stopPropagation()}
      onKeyDown={e => { if (e.key === 'Enter') onSubmit(); else if (e.key === 'Escape') onCancel?.() }}
      className={cn('h-8 min-w-0 rounded-lg border bg-background px-2.5 text-[13px] text-foreground outline-none placeholder:text-dim focus:border-gold/60', className)} />
  )
}

/** Text field that stays in place (no autofocus): sends host 'typing' while focused like TextEntry. Extra input
 *  attributes (data-*, role, aria-*) pass through; `tip` becomes data-tip. */
export function Field({ value, onChange, onKey, onBlur, placeholder, className, tip, ...rest }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'onBlur' | 'value'> & {
  value: string; onChange: (v: string) => void; onKey?: (e: React.KeyboardEvent<HTMLInputElement>) => void; onBlur?: () => void
  tip?: string; [k: `data-${string}`]: string
}) {
  return <input value={value} placeholder={placeholder} spellCheck={false} data-tip={tip} {...rest}
    onFocus={() => host({ type: 'typing', on: true })} onBlur={() => { host({ type: 'typing', on: false }); onBlur?.() }}
    onChange={e => onChange(e.target.value)} onKeyDown={onKey}
    className={cn('h-7 min-w-0 rounded-lg border bg-background px-2.5 text-[12.5px] text-foreground outline-none placeholder:text-dim focus:border-gold/60', className)} />
}

/** Number field that stays in place: shows `value` (empty = not set, `placeholder` instead), commits on Enter or blur
 *  (`null` = cleared), Escape cancels. Sends host 'typing' while focused. Accepts a decimal comma. data-* pass through. */
export function NumField({ value, onCommit, placeholder = '–', className, tip, ...rest }: {
  value: number | undefined | null; onCommit: (v: number | null) => void; placeholder?: string; className?: string; tip?: string
} & Record<`data-${string}`, string | undefined>) {
  const [txt, setTxt] = useState<string | null>(null)
  const commit = () => {
    if (txt != null) { const v = txt.trim() === '' ? null : Number(txt.trim().replace(',', '.')); if (v == null || isFinite(v)) onCommit(v) }
    setTxt(null)
  }
  return (
    <input value={txt ?? (value == null ? '' : String(Math.round(value * 100) / 100))} placeholder={placeholder} inputMode="decimal" spellCheck={false} data-tip={tip} {...rest}
      onFocus={() => host({ type: 'typing', on: true })} onBlur={() => { host({ type: 'typing', on: false }); commit() }}
      onChange={e => setTxt(e.target.value)} onClick={e => e.stopPropagation()}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { setTxt(null); e.currentTarget.blur() } }}
      className={cn('h-6 w-16 flex-none rounded-md border bg-background/60 px-1.5 text-right text-[12px] text-foreground tabular-nums outline-none placeholder:text-dim focus:border-gold/60', className)} />
  )
}

/** Rank square of a ranked list (spots, farm routes): gold for the first, muted for the rest. */
export function Rank({ n, className }: { n: number; className?: string }) {
  return <span className={cn('grid size-5 flex-none place-items-center rounded-sm text-[11px] font-bold tabular-nums', n === 1 ? 'bg-gold/15 text-gold' : 'bg-foreground/[0.06] text-muted-foreground', className)}>{n}</span>
}

// ---------------------------------------------------------------- primitives (Base UI) with the house look
// Design language "calm & compact": the density of the overlay, rounded-lg controls / rounded-xl panels, panels as slightly raised
// cards, gold only for selection / the one action that matters, segmented controls instead of rows of chips.
// Progressive disclosure: a view shows its answer first (a number, a board, a list of the top few); details sit in a
// <Disclosure> or behind "show all" and are remembered (U.open) – never everything at once.

/** Segmented control (one of a few options): Base UI ToggleGroup. `item` adds attributes per option (tests, tips). */
export function Seg<T extends string>({ value, onChange, options, size = 'md', className, item, iconOnly, labelClass }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; tip?: string; icon?: LucideIcon }[]; size?: 'sm' | 'md'; className?: string
  item?: (v: T) => Record<string, string | undefined>
  /** Icons only: the label is hidden, the tip (else a string label) becomes the aria-label. */
  iconOnly?: boolean
  /** Extra classes of each label, e.g. a container query that hides it on narrow windows (`@max-[520px]/main:hidden`);
   *  the tip (else a string label) becomes the aria-label then. */
  labelClass?: string
}) {
  return (
    <ToggleGroup value={[value]} onValueChange={(v: unknown[]) => { if (v.length) onChange(v[v.length - 1] as T) }} spacing={0}
      className={cn('max-w-full min-w-0 flex-none rounded-lg border bg-background p-0.5', className)}>
      {options.map(o => (
        <ToggleGroupItem key={o.value} value={o.value} data-tip={o.tip} aria-label={iconOnly || labelClass ? o.tip ?? (typeof o.label === 'string' ? o.label : undefined) : undefined} {...item?.(o.value)}
          className={cn('min-w-0 shrink gap-1.5 rounded-md! border-0 font-normal whitespace-nowrap text-muted-foreground hover:bg-foreground/5 hover:text-foreground data-[pressed]:bg-gold/[0.14] data-[pressed]:font-semibold data-[pressed]:text-gold [&_svg]:size-3.5 [&_svg]:flex-none',
            size === 'sm' ? 'h-6 px-2 text-[11.5px]' : 'h-7 px-2.5 text-[12.5px]', iconOnly && (size === 'sm' ? 'px-1.5' : 'px-2'))}>
          {o.icon && <o.icon />}{!(iconOnly && o.icon) && <span className={cn('min-w-0 truncate', labelClass)}>{o.label}</span>}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/** On / off chip (filters, single switches): Base UI Toggle. */
export function Chip({ on, onChange, children, tip, className, ...rest }: {
  on: boolean; onChange: (on: boolean) => void; children: ReactNode; tip?: string; className?: string
} & Record<`data-${string}`, string | undefined>) {
  return (
    <Toggle pressed={on} onPressedChange={onChange} data-tip={tip} {...rest}
      className={cn(CHIP, 'font-normal data-[pressed]:border-gold/45 data-[pressed]:bg-gold/[0.12] data-[pressed]:text-gold', className)}>
      {children}
    </Toggle>
  )
}

/** −/value/+ with optional big steps (shown only where there is room). */
export function Stepper({ value, onChange, min = 0, max = 999, big, className, ...rest }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; big?: number; className?: string
} & Record<`data-${string}`, string | undefined>) {
  const set = (v: number) => onChange(Math.max(min, Math.min(max, v)))
  const b = 'grid h-[22px] min-w-[22px] flex-none place-items-center rounded-[5px] px-1 text-[11px] text-muted-foreground tabular-nums transition-colors hover:bg-foreground/[0.07] hover:text-gold disabled:pointer-events-none disabled:opacity-30 [&_svg]:size-3'
  return (
    <span className={cn('flex flex-none items-center rounded-md border bg-background/40 p-px', className)} {...rest}>
      {big && <button className={cn(b, 'hidden @min-[420px]:grid')} disabled={value <= min} onClick={() => set(value - big)}>−{big}</button>}
      <button className={b} aria-label="−1" disabled={value <= min} onClick={() => set(value - 1)}><Minus /></button>
      <output className="min-w-9 text-center text-[12.5px] font-semibold text-foreground tabular-nums">{value}</output>
      <button className={b} aria-label="+1" disabled={value >= max} onClick={() => set(value + 1)}><Plus /></button>
      {big && <button className={cn(b, 'hidden @min-[420px]:grid')} disabled={value >= max} onClick={() => set(value + big)}>+{big}</button>}
    </span>
  )
}

/** Raised block (card) with an optional header line: title, sub text, action at the right. */
export function Panel({ title, sub, right, children, className, ...rest }: {
  title?: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string
} & Record<`data-${string}`, string | undefined>) {
  return (
    <section className={cn('mx-2.5 mt-2.5 overflow-hidden rounded-xl border bg-card shadow-(--shadow-card)', className)} {...rest}>
      {(title || right) && <Sect sub={sub} right={right} className="pt-2">{title}</Sect>}
      {children}
    </section>
  )
}

/** Details on demand: a header line that opens / closes its content; open state remembered under `id` (U.open). */
export function Disclosure({ id, title, sub, children, defaultOpen = false, right }: {
  id: string; title: ReactNode; sub?: ReactNode; children: ReactNode; defaultOpen?: boolean; right?: ReactNode
}) {
  useApp()
  const open = (U.open?.[id] as boolean | undefined) ?? defaultOpen
  const toggle = () => { U.open = { ...U.open, [id]: !open }; saveUi(['open']); bump() }
  return (
    <div data-disclosure={id} data-open={open ? 'on' : 'off'}>
      {/* `right` (controls) wraps below the title when both do not fit */}
      <div className="flex min-h-8 flex-wrap items-center gap-x-1.5 gap-y-1 px-3 pt-1.5">
        <button onClick={toggle} aria-expanded={open} className="flex min-h-6 min-w-0 flex-[1_1_12rem] items-center gap-1.5 text-left text-[12px] font-semibold text-muted-foreground hover:text-foreground [&_svg]:size-3.5">
          <ChevronRight className={cn('flex-none transition-transform', open && 'rotate-90')} />
          <span className="flex-none">{title}</span>
          {sub && <span className="min-w-0 truncate font-normal">{sub}</span>}
        </button>
        {right}
      </div>
      {open && children}
    </div>
  )
}

/** The first `n` items, the rest behind "show all (k more)"; remembered under `id`. */
export function TopN<T>({ id, items, n, render, more, moreClass }: {
  id: string; items: T[]; n: number; render: (x: T, i: number) => ReactNode; more: (k: number) => string
  /** Extra classes of the "show all" line (e.g. `col-span-full` inside a tile grid). */
  moreClass?: string
}) {
  useApp()
  const all = !!U.open?.[id], shown = all ? items : items.slice(0, n)
  return <>
    {shown.map(render)}
    {items.length > n && (
      <button data-more={id} onClick={() => { U.open = { ...U.open, [id]: !all }; saveUi(['open']); bump() }}
        className={cn('flex w-full items-center gap-1 px-3 py-1.5 text-[12px] text-muted-foreground hover:text-gold [&_svg]:size-3.5', moreClass)}>
        <ChevronRight className={cn('transition-transform', all && '-rotate-90')} />{all ? '−' : more(items.length - n)}
      </button>
    )}
  </>
}

/** Tabs for the detail areas of a view (line style, Base UI Tabs); the choice is remembered under `id`. */
export function PanelTabs<T extends string>({ id, tabs, children }: {
  id: string; tabs: { value: T; label: ReactNode }[]; children: (v: T) => ReactNode
}) {
  useApp()
  const v = (tabs.some(x => x.value === U.open?.[id]) ? U.open[id] : tabs[0].value) as T
  return (
    <Tabs value={v} onValueChange={(x: unknown) => { U.open = { ...U.open, [id]: x }; saveUi(['open']); bump() }} className="gap-0">
      <TabsList variant="line" className="mx-1.5 h-8 w-auto justify-start gap-0 border-b px-0" data-panels>
        {tabs.map(x => <TabsTrigger key={x.value} value={x.value} data-panel={x.value} className="flex-none px-2.5 text-[12px] data-active:text-gold after:bg-gold!">{x.label}</TabsTrigger>)}
      </TabsList>
      {children(v)}
    </Tabs>
  )
}

/** Small labelled −/+ stepper (popovers, manual entry). */
export function MiniStepper({ label, value, onStep, minus = true, plus = true, tips }: {
  label: ReactNode; value: ReactNode; onStep: (d: 1 | -1) => void; minus?: boolean; plus?: boolean; tips?: [string, string]
}) {
  const b = 'grid size-6 flex-none place-items-center rounded-sm border text-muted-foreground transition-colors hover:border-gold/50 hover:text-gold disabled:pointer-events-none disabled:opacity-30 [&_svg]:size-3.5'
  return (
    <div className="flex items-center gap-1.5 text-[12px]">
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{label}</span>
      <button className={b} disabled={!minus} data-tip={tips?.[0]} aria-label={tips?.[0] ?? '−1'} onClick={e => { e.stopPropagation(); onStep(-1) }}><Minus /></button>
      <output className="min-w-10 text-center font-semibold text-foreground tabular-nums">{value}</output>
      <button className={b} disabled={!plus} data-tip={tips?.[1]} aria-label={tips?.[1] ?? '+1'} onClick={e => { e.stopPropagation(); onStep(1) }}><Plus /></button>
    </div>
  )
}

/** Page head: bold title, muted sub line, actions at the right (filters, switches). */
export function PageHead({ title, sub, right, icon: I }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; icon?: LucideIcon }) {
  return (
    <div data-drag className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1.5 px-3 pt-3">
      <h1 className="m-0 flex min-w-0 items-center gap-2 font-display text-[19px] leading-none font-bold text-foreground">
        {I && <I className="size-4.5 flex-none text-gold" />}<span className="truncate">{title}</span>
      </h1>
      {sub && <span className="min-w-0 flex-[1_1_8rem] truncate text-[12.5px] text-muted-foreground">{sub}</span>}
      {right && <span className="ml-auto flex max-w-full min-w-0 flex-wrap items-center justify-end gap-1.5">{right}</span>}
    </div>
  )
}

/** Number tile of a page's top row: label, big value, one small line. `tone` colours the value; `onClick` jumps to the list. */
export function Kpi({ label, value, sub, tone, icon: I, onClick, tip, className, ...rest }: {
  label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: keyof typeof TONE; icon?: LucideIcon; onClick?: () => void; tip?: string; className?: string
} & Record<`data-${string}`, string | undefined>) {
  const C = onClick ? 'button' : 'div'
  return (
    <C onClick={onClick} data-tip={tip} {...rest}
      className={cn('flex min-w-0 flex-col rounded-lg border bg-card px-3 py-2 text-left shadow-(--shadow-card)', onClick && 'cursor-pointer transition-colors hover:border-gold/40', className)}>
      <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground [&_svg]:size-3.5 [&_svg]:flex-none">{I && <I />}<span className="truncate">{label}</span></span>
      <span className={cn('mt-0.5 truncate text-[21px] leading-tight font-bold tabular-nums', tone ? TONE[tone] : 'text-foreground')}>{value}</span>
      {sub && <span className="truncate text-[11.5px] text-dim">{sub}</span>}
    </C>
  )
}
/** The row of number tiles at the top of a page: 2 columns on the overlay, 4 from 640 px. */
export function KpiRow({ children }: { children: ReactNode }) {
  return <div data-kpis className="grid grid-cols-2 gap-1.5 px-2.5 pt-2.5 @min-[640px]:grid-cols-4">{children}</div>
}

/** One list line: icon, title + one sub line, meta, value / action at the right. Click = select. */
export function ListRow({ icon, title, sub, meta, right, onClick, selected, tip, className, ...rest }: {
  icon?: ReactNode; title: ReactNode; sub?: ReactNode; meta?: ReactNode; right?: ReactNode; onClick?: () => void; selected?: boolean; tip?: string; className?: string
} & Record<`data-${string}`, string | undefined>) {
  return (
    <div onClick={onClick} data-tip={tip} data-sel={selected ? 'on' : undefined} {...rest}
      className={cn(ROW, 'py-1', onClick && ROW_CLICK, selected && 'bg-gold/[0.08]', className)}>
      {icon && <span className={cn(ROW_ICON, 'text-muted-foreground')}>{icon}</span>}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{title}</span>
        {sub && <span className="truncate text-[12px] text-muted-foreground">{sub}</span>}
      </span>
      {meta && <span className={cn(META, 'flex-none')}>{meta}</span>}
      {right && <span className="flex flex-none items-center gap-1.5 font-semibold tabular-nums">{right}</span>}
    </div>
  )
}

/** "How is this computed": a closed disclosure holding the explanation (never shown by default). */
export function HowTo({ id, title, children }: { id: string; title: ReactNode; children: ReactNode }) {
  return <Disclosure id={id} title={title}><div className="px-3 pb-2.5 text-[12.5px] leading-relaxed whitespace-normal text-muted-foreground">{children}</div></Disclosure>
}
