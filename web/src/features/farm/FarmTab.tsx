// "Farm" tab: pick a resource, get ranked hotspots with a loop route each; "Switch" jumps to the next one
// (bots or other gatherers on your spot). The ranked list (rate and route per row), the resource details in a closed
// disclosure, the ranking in a HowTo.
import { ArrowRightLeft, Pickaxe, Skull } from 'lucide-react'
import { G, U, V, saveUi, useApp, type Any } from '@/core/state'
import { emit } from '@/core/bus'
import { t, fmt, fmtPct } from '@/core/i18n'
import { cn } from '@/lib/utils'
import { AppSelect, type Option } from '@/components/AppSelect'
import { Button } from '@/components/ui/button'
import { Disclosure, Empty, HowTo, ListRow, Note, Page, Panel, ROWS, Rank, ToolbarStrip, TopN, rich } from '@/components/kit'
import { PARAMS, recomputeFarm, selectSpot, switchSpot, type Hotspot } from './logic'

const pct = (p: number) => fmtPct(p * 100)
const mins = (s: number) => Math.max(1, Math.round(s / 60))
const more = (k: number) => t('common.moreN', { n: k })

const icon = (r: Any) => (r.kind === 'gather' ? Pickaxe : Skull)
const label = (r: Any) => `${r.name} (${r.kind === 'gather' ? fmt(r.nodes) : pct(r.best)})`

/** Toolbar between map and list: resource picker, switch button. */
export function FarmToolbar() {
  useApp()
  const opts: Option[] = V.farmRes.map((r: Any) => ({ value: r.key, label: label(r), icon: icon(r) }))
  if (!V.farmCur) opts.unshift({ value: U.farmRes || '', label: t('farm.pick') }) // nothing chosen (on this map) yet
  return (
    <ToolbarStrip>
      <AppSelect value={U.farmRes || ''} options={opts.length ? opts : [{ value: '', label: t('farm.pick') }]} tip={t('farm.pick.tip')}
        className="h-6 max-w-56 shrink text-xs" onChange={v => { U.farmRes = v; saveUi(['farmRes']); V.farmSpot = null; recomputeFarm().then(() => emit('fit')) }} />
      {/* switching spots needs a resource first */}
      {V.farmCur && <Button size="xs" variant="outline" disabled={V.farmSpots.length < 2} onClick={switchSpot} data-tip={t('farm.switch.tip')}>
        <ArrowRightLeft />{t('farm.switch')}
      </Button>}
      <span data-drag className="h-5 min-w-2 flex-1 cursor-grab" />
    </ToolbarStrip>
  )
}

const routeText = (s: Hotspot) => t('farm.spot.route', { n: s.route.length, len: fmt(Math.round(s.len)), min: mins(s.secs) })
const spotName = (s: Hotspot) => s.name || t('farm.spot.n', { n: s.rank })

function SpotRow({ s }: { s: Hotspot }) {
  const sel = V.farmSpot === s.rank
  return (
    <ListRow data-farmspot={s.rank} selected={sel} onClick={() => selectSpot(sel ? null : s.rank)}
      tip={t('farm.spot.tip', { n: s.route.length, len: fmt(Math.round(s.len)), min: mins(s.secs), round: fmt(s.perRound, 1) })}
      icon={<Rank n={s.rank} />} title={<span className={cn(sel && 'font-semibold')}>{spotName(s)}</span>} sub={routeText(s)}
      right={<span className={cn('text-right', s.rank === 1 ? 'text-gold' : 'text-muted-foreground')}>{t('farm.spot.rate', { n: fmt(s.per10, 1) })}</span>} />
  )
}

/** What the chosen resource is: gathering grades / flying note, or the mobs that drop it (closed by default). */
function ResInfo({ r }: { r: Any }) {
  if (r.kind === 'gather') return (
    <Panel className="pb-1.5">
      <Disclosure id="farm.res" title={t('farm.res')} sub={t('farm.res.gather', { n: fmt(r.nodes) }) + (r.air ? ' · ' + t('farm.res.air') : '')}>
        <Note className="pb-1">{rich(t('farm.info.gather', { n: fmt(r.nodes), mats: r.mats.join(', ') }))}</Note>
        {r.air && <Note className="pt-0">{rich(t('farm.info.air'))}</Note>}
      </Disclosure>
    </Panel>
  )
  const mobs = [...r.mobs].sort((a: Any, b: Any) => b.p * b.spawns - a.p * a.spawns)
  return (
    <Panel className="pb-1.5">
      <Disclosure id="farm.res" title={t('farm.res')} sub={t('farm.res.drop', { n: fmt(mobs.length) })}>
        <div className={cn(ROWS, 'mt-1')}>
          <TopN id="farm.res.mobs" items={mobs} n={4} more={more} render={(x: Any) => (
            <ListRow key={x.id} icon={<Skull />} title={x.n} sub={t('farm.mob.sub', { lv: x.lv, n: fmt(x.spawns) })}
              right={<span className="text-muted-foreground">{pct(x.p)}</span>} tip={t('farm.mob.tip')} />
          )} />
        </div>
      </Disclosure>
    </Panel>
  )
}

function HowRanked() {
  const g = PARAMS.gather, d = PARAMS.drop
  const lines = [
    t('farm.how.src'),
    t('farm.how.spot', { rg: g.radius, rd: d.radius }),
    t('farm.how.route'),
    t('farm.how.time', { sg: g.speed, ag: g.act, sd: d.speed, ad: d.act, min: mins(PARAMS.minRound) }),
    t('farm.how.alt'),
  ]
  return (
    <Panel className="pb-1.5">
      <HowTo id="farm.how" title={t('farm.how')}>
        <ul className="flex list-disc flex-col gap-1 pl-4 marker:text-dim">{lines.map((l, i) => <li key={i}>{rich(l)}</li>)}</ul>
      </HowTo>
    </Panel>
  )
}

export function FarmTab() {
  useApp()
  const m = G.md[U.map], r = V.farmCur, spots: Hotspot[] = V.farmSpots
  return <Page w="rows">
    {!m ? <Empty>{t('data.loading')}</Empty>
      : !V.farmRes.length ? <Empty>{t('farm.noData')}</Empty>
        : !r ? <Empty>{t('farm.pick.first')}</Empty>
          : !spots.length ? <><Empty>{t('farm.empty')}</Empty><ResInfo r={r} /></>
            : <>
              <Panel title={t('farm.spots')} sub={t('farm.spots.sub')} data-farmspots={String(spots.length)}>
                <div className={ROWS}>
                  <TopN id="farm.spots" items={spots} n={Math.max(5, V.farmSpot || 0)} more={more} render={s => <SpotRow key={s.rank} s={s} />} />
                </div>
              </Panel>
              <ResInfo r={r} />
            </>}
    {m && V.farmRes.length > 0 && <HowRanked />}
  </Page>
}
