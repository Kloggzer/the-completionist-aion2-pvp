// "Farm" tab: pick a resource, get ranked hotspots with a loop route each; "Switch" jumps to the next one
// (bots or other gatherers on your spot).
import { ArrowRightLeft, ChevronDown, Info } from 'lucide-react'
import { G, U, V, saveUi, bump, useApp, type Any } from '@/core/state'
import { emit } from '@/core/bus'
import { t, fmt } from '@/core/i18n'
import { cn } from '@/lib/utils'
import { AppSelect } from '@/components/AppSelect'
import { Bar, CHIP, Empty, Hint, LEAD, Page, T_BODY, T_TITLE, TILE as KTILE, TILE_CLICK, TILE_SEL, ToolbarStrip, grid, rich } from '@/components/kit'
import { PARAMS, recomputeFarm, selectSpot, switchSpot, type Hotspot } from './logic'

const GRID = grid('pet'), TILE = cn(KTILE, TILE_CLICK)

const pct = (p: number) => (p * 100).toLocaleString(undefined, { maximumFractionDigits: p < 0.01 ? 2 : 1 }) + ' %'
const mins = (s: number) => Math.max(1, Math.round(s / 60))

function label(r: Any) {
  return r.kind === 'gather' ? `⛏ ${r.name} (${r.nodes})` : `☠ ${r.name} (${pct(r.best)})`
}

/** Toolbar between map and list: resource picker, switch button, explanation toggle. */
export function FarmToolbar() {
  useApp()
  const opts = V.farmRes.map((r: Any) => ({ value: r.key, label: label(r) }))
  return (
    <ToolbarStrip>
      <AppSelect value={U.farmRes || ''} options={opts.length ? opts : [{ value: '', label: t('farm.pick') }]} tip={t('farm.pick.tip')}
        className="h-6 max-w-56 shrink text-xs" onChange={v => { U.farmRes = v; saveUi(['farmRes']); V.farmSpot = null; recomputeFarm().then(() => emit('fit')) }} />
      <button disabled={V.farmSpots.length < 2} onClick={switchSpot} data-tip={t('farm.switch.tip')} className={cn(CHIP, 'disabled:opacity-40')}>
        <ArrowRightLeft />{t('farm.switch')}
      </button>
      <span data-drag className="h-5 min-w-2 flex-1 cursor-grab" />
      <button onClick={() => { U.farmHelp = !U.farmHelp; saveUi(['farmHelp']); bump() }} data-tip={t('farm.how.tip')}
        className={cn('flex min-w-0 items-center gap-1 rounded-sm px-1 hover:text-foreground', U.farmHelp && 'text-cyan hover:text-cyan')}>
        <Info className="size-3.5 flex-none" /><span className="truncate">{t('farm.how')}</span>
        <ChevronDown className={cn('size-3.5 flex-none transition-transform', U.farmHelp && 'rotate-180')} />
      </button>
    </ToolbarStrip>
  )
}

function HowRanked() {
  if (!U.farmHelp) return null
  const g = PARAMS.gather, d = PARAMS.drop
  const lines = [
    t('farm.how.src'),
    t('farm.how.spot', { rg: g.radius, rd: d.radius }),
    t('farm.how.route'),
    t('farm.how.time', { sg: g.speed, ag: g.act, sd: d.speed, ad: d.act, min: mins(PARAMS.minRound) }),
    t('farm.how.alt'),
  ]
  return <Hint tone="cyan"><ul className="flex list-disc flex-col gap-1 pl-4 marker:text-dim">{lines.map((l, i) => <li key={i}>{rich(l)}</li>)}</ul></Hint>
}

/** What the chosen resource is: gathering grades / flying note, or the mobs that drop it. */
function ResInfo({ r }: { r: Any }) {
  if (r.kind === 'gather') return (
    <Hint tone="gold">{rich(t('farm.info.gather', { n: r.nodes, mats: r.mats.join(', ') }))}{r.air && <> {rich(t('farm.info.air'))}</>}</Hint>
  )
  const mobs = [...r.mobs].sort((a: Any, b: Any) => b.p * b.spawns - a.p * a.spawns).slice(0, 4)
  return <Hint tone="gold">{rich(t('farm.info.drop', { mobs: mobs.map((x: Any) => `${x.n} (Lv ${x.lv}, ${pct(x.p)})`).join(', ') }))}</Hint>
}

function Spot({ s }: { s: Hotspot }) {
  const sel = V.farmSpot === s.rank
  return (
    <div data-farmspot={s.rank} data-sel={sel || undefined} onClick={() => selectSpot(sel ? null : s.rank)}
      data-tip={t('farm.spot.tip', { n: s.route.length, len: fmt(Math.round(s.len)), min: mins(s.secs), round: s.perRound.toFixed(1) })}
      className={cn(TILE, 'gap-0.5', sel && TILE_SEL)}>
      <div className={T_BODY}>
        <div className="flex items-center gap-1.5">
          <span className="grid size-4 flex-none place-items-center rounded-sm bg-gold/15 text-[10.5px] font-bold text-gold">{s.rank}</span>
          <span className={T_TITLE}>{s.name}</span>
        </div>
        <div className="mt-0.5 truncate text-[11.5px] font-semibold">{t('farm.spot.rate', { n: s.per10.toFixed(1) })}</div>
        <Bar frac={s.rel} tone="gold" />
        <div className="truncate text-[11.5px] text-muted-foreground">{t('farm.spot.route', { n: s.route.length, len: fmt(Math.round(s.len)), min: mins(s.secs) })}</div>
      </div>
    </div>
  )
}

export function FarmTab() {
  useApp()
  const m = G.md[U.map], r = V.farmCur
  return <Page>
    <HowRanked />
    {!m ? <Empty>{t('data.loading')}</Empty>
      : !V.farmRes.length ? <Empty>{t('farm.noData')}</Empty>
        : !r ? <Empty>{t('farm.pick.first')}</Empty>
          : <>
            <ResInfo r={r} />
            {!V.farmSpots.length ? <Empty>{t('farm.empty')}</Empty>
              : <div className={cn(GRID, LEAD)}>{V.farmSpots.map((s: Hotspot) => <Spot key={s.rank} s={s} />)}</div>}
          </>}
  </Page>
}
