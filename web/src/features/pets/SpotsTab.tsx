// "Spots" tab: ranked farm spots (spawn clusters of needed mobs) for the current map. Number tiles first (best spot,
// how many spots, how many pets the best one covers), then the ranked list; the pets of a spot show under it once it
// is selected. How the ranking works sits in a closed HowTo at the end.
import { Crosshair, MapPin, PawPrint } from 'lucide-react'
import { G, U, V, bump, useApp, type Any } from '@/core/state'
import { emit } from '@/core/bus'
import { fmt, t } from '@/core/i18n'
import { cn } from '@/lib/utils'
import { R, mobGroups } from './logic'
import { Dot, Empty, SelBar, rich } from './parts'
import { HowTo, Kpi, KpiRow, ListRow, Page, Panel, ROWS, Rank, TopN } from '@/components/kit'
import { Portrait } from '@/components/Portrait'
import { mapName, petName } from '@/core/data'

const more = (k: number) => t('common.moreN', { n: k })

// Why a spot ranks where it does: how many of its pets you would unlock vs. level (unlocks weigh double).
function reason(s: Any) {
  const un = s.pets.filter((p: Any) => p.t.lv === 0).length, lv = s.pets.length - un
  return [un && t('pets.spot.unlock', { n: un }), lv && t('pets.spot.level', { n: lv })].filter(Boolean).join(' · ')
}

function select(rank: number | null) { V.spot = V.spot === rank ? null : rank; V.sel = null; emit('fit'); bump() }

const petTip = ({ t: x, n }: Any) => `${petName(x.p)}: ${n}× · ${x.souls}/${x.need} (${t('pets.lv', { lv: x.lv })})`

/** The pets of the selected spot: portrait, name (cyan = still to unlock), souls, matching spawns at the spot. */
function SpotPets({ s }: { s: Any }) {
  return <div data-spotpets={s.rank} className="bg-gold/[0.04]">
    {s.pets.map((e: Any) => {
      const x = e.t
      return <ListRow key={x.p.id} className="pl-6" tip={petTip(e)}
        icon={<Portrait por={mobGroups(x)[0]?.mob.por} size={22} className="-my-1" />}
        title={<span className="flex min-w-0 items-center gap-1.5"><Dot col={x.col} className="mt-0" /><span className={cn('truncate', x.lv === 0 && 'text-cyan')}>{petName(x.p)}</span></span>}
        sub={<span className="tabular-nums">{x.souls}/{x.need} · {t('pets.lv', { lv: x.lv })}</span>}
        meta={t('pets.spot.spawns', { n: e.n })} />
    })}
  </div>
}

function SpotRow({ s }: { s: Any }) {
  const sel = V.spot === s.rank, pct = Math.round(s.rel * 100)
  return <>
    <ListRow data-spot={s.rank} selected={sel} onClick={() => select(s.rank)}
      tip={[t('pets.spot.tip', { n: s.n, r: R, pets: s.pets.length }), ...s.pets.map(petTip)].join('\n')}
      icon={<Rank n={s.rank} />} title={<span className={cn(sel && 'font-semibold')}>{s.name}</span>} sub={reason(s)}
      right={<span data-tip={t('pets.spot.score', { n: pct })} className={cn('w-11 text-right', s.rank === 1 ? 'text-gold' : 'text-muted-foreground')}>{pct} %</span>} />
    {sel && <SpotPets s={s} />}
  </>
}

function Spots({ m }: { m: Any }) {
  const spots: Any[] = V.spots, top = spots[0]
  const missing = (V.spotsSel ? V.targets.filter((x: Any) => V.multi.has(x.p.id)) : V.targets).filter((x: Any) => !x.done).length
  return <>
    <KpiRow>
      <Kpi icon={Crosshair} label={t('pets.kpi.best')} value={top.name} sub={reason(top)} tip={top.name} onClick={() => { if (V.spot !== 1) select(1) }} className="col-span-2" data-kpi="best" />
      <Kpi icon={MapPin} label={t('pets.kpi.spots')} value={fmt(spots.length)} sub={mapName(m.name)} tip={t('pets.kpi.spotsSub')} data-kpi="spots" />
      <Kpi icon={PawPrint} label={t('pets.kpi.covered')} value={`${top.pets.length} / ${missing}`} sub={t('pets.kpi.coveredSub', { n: missing })} data-kpi="covered" />
    </KpiRow>
    <Panel title={t('pets.spots')} sub={V.spotsSel ? t('pets.spots.forSel') : t('pets.spots.sub')} data-spots={String(spots.length)}>
      <div className={ROWS}>
        <TopN id="spots.list" items={spots} n={Math.max(5, V.spot || 0)} more={more} render={s => <SpotRow key={s.rank} s={s} />} />
      </div>
    </Panel>
  </>
}

export function SpotsTab() {
  useApp()
  const m = G.md[U.map]
  return <Page w="rows">
    <SelBar />
    {!m ? <Empty>{t('data.loading')}</Empty>
      : !V.spots.length ? <Empty>{t('pets.spot.empty', { filter: U.hideNamed ? t('pets.spot.filter') : '' })}</Empty>
        : <Spots m={m} />}
    <Panel className="pb-1.5">
      <HowTo id="spots.how" title={t('pets.how')}>
        <ul className="flex list-disc flex-col gap-1 pl-4 marker:text-dim">
          {['src', 'count', 'radius', 'cap', 'weight', 'top'].map(k => <li key={k}>{rich(t('pets.how.' + k, { r: R }))}</li>)}
        </ul>
      </HowTo>
    </Panel>
  </Page>
}
