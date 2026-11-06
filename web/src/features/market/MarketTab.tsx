// "Markt" page (like the merchant page, for the auction house): which skins are worth buying now on the own server –
// KPI row (to buy, cheapest per point, Fashionista, data age), "Buy now" tiles (deals first), "Too dear" and "Not
// listed" behind disclosures, owned ones last; owned = the game's wardrobe list, plus a "have" switch per skin.
import { useEffect } from 'react'
import { Clock, Gem, RefreshCw, ShoppingCart, Shirt } from 'lucide-react'
import { S, U, bump, saveUi, useApp } from '@/core/state'
import { locale, t } from '@/core/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { AppSelect } from '@/components/AppSelect'
import { BarInfo, BarRight, Disclosure, Empty, Hint, HowTo, Kpi, KpiRow, Page, Panel, SUB, Seg, TILE, TILE_P, T_BODY, T_TITLE, grid } from '@/components/kit'
import { ACCESSORY, FASHIONISTA, fashion, serverId, type Kind, type Row } from './logic'
import { M, gameServer, inGame, listAge, loadServers, marketRows, refresh, setOwned, wardrobeSize } from './index'

const fmt = (n: number) => Math.round(n).toLocaleString(locale())
const short = (n: number) => (n >= 1e6 ? (n / 1e6).toLocaleString(locale(), { maximumFractionDigits: 2 }) + ' Mio.' : fmt(n))
const PILL: Record<Kind, string> = {
  deal: 'border-green/50 bg-green/10 text-green', buy: 'border-gold/50 bg-gold/10 text-gold', wait: 'border-red/40 text-red',
  watch: 'border-border text-muted-foreground', have: 'border-border text-dim',
}
type Filter = 'all' | 'acc' | 'armor'
const shown = (r: Row, f: Filter) => f === 'all' || (f === 'acc') === ACCESSORY.has(r.cat)

function SkinTile({ r }: { r: Row }) {
  const vs = r.vs !== null ? Math.round((r.vs - 1) * 100) : null
  const tip = [r.stat ? t('mkt.stat', { stat: r.stat, pts: r.pts }) : '', r.med ? t('mkt.usual', { p: fmt(r.med) }) : '',
    r.gone ? t('mkt.flow', { n: r.gone.toLocaleString(locale(), { maximumFractionDigits: 1 }) }) : t('mkt.noFlow'),
    r.kpp ? t('mkt.kpp.tip', { p: fmt(r.kpp) }) : ''].filter(Boolean).join('\n')
  return (
    <div data-skin={r.item} data-kind={r.kind} data-tip={tip}
      className={cn(TILE, TILE_P, r.kind === 'deal' && 'border-green/45 bg-green/[0.04]', r.kind === 'buy' && 'border-gold/45 bg-gold/[0.04]', r.kind === 'have' && 'opacity-60')}>
      <div className="grid size-10 flex-none place-items-center rounded-md border bg-background text-muted-foreground"><Shirt className="size-5" /></div>
      <div className={T_BODY}>
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cn(T_TITLE, 'min-w-0 flex-1')}>{r.name}</span>
          <span className={cn('flex-none rounded-md border px-1.5 text-[11px] leading-[18px] font-semibold', PILL[r.kind])}>{t('mkt.k.' + r.kind)}</span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-baseline gap-1.5">
          <span className={cn(SUB, 'min-w-0 flex-1 truncate')}>{t('mkt.cat.' + r.cat)} · {t('mkt.grade.' + r.grade)} · {t('mkt.pts', { n: r.pts })}</span>
          {r.price !== null && <span className={cn('flex-none text-[13px] font-semibold tabular-nums', r.kind === 'deal' ? 'text-green' : r.kind === 'buy' ? 'text-gold' : 'text-muted-foreground')}>{short(r.price)}</span>}
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-[11px] tabular-nums text-muted-foreground">
          {vs !== null && <span data-vs={vs} className={cn('rounded-sm px-1', vs <= -15 ? 'bg-green/10 text-green' : vs > 10 ? 'bg-red/10 text-red' : 'bg-accent')}>
            {t(vs <= 0 ? 'mkt.vsBelow' : 'mkt.vsAbove', { n: Math.abs(vs) })}</span>}
          {r.price === null && r.med !== null && <span>{t('mkt.usualShort', { p: short(r.med) })}</span>}
          {r.gone > 0 && <span>{t('mkt.flowShort', { n: r.gone.toLocaleString(locale(), { maximumFractionDigits: 1 }) })}</span>}
          {r.listings > 0 && <span>{t('mkt.listings', { n: r.listings })}</span>}
          {inGame(r)
            ? <span data-ingame={r.item} className="ml-auto rounded-sm border border-green/40 px-1.5 leading-[18px] text-green">{t('mkt.haveGame')}</span>
            : <button data-have={r.item} onClick={() => setOwned(r.item, r.kind !== 'have')}
              className={cn('ml-auto rounded-sm border px-1.5 leading-[18px] hover:bg-foreground/5', r.kind === 'have' ? 'border-green/40 text-green' : 'border-border')}>
              {r.kind === 'have' ? t('mkt.have') : t('mkt.markHave')}
            </button>}
        </div>
      </div>
    </div>
  )
}

function Tiles({ list }: { list: Row[] }) {
  return list.length ? <div className={cn(grid('row'), 'pb-2.5')}>{list.map(r => <SkinTile key={r.item} r={r} />)}</div> : null
}

/** Skins collected: the wardrobe list, else the Fashionista achievement counter. */
const collected = () => wardrobeSize() ?? Math.max(0, ...FASHIONISTA.map(id => S.state?.ach?.[id]?.[0] ?? 0))

function Kpis({ all }: { all: Row[] }) {
  const buy = all.filter(r => r.kind === 'deal' || r.kind === 'buy'), best = buy.filter(r => r.kpp).sort((a, b) => a.kpp! - b.kpp!)[0]
  const f = fashion(collected()), age = listAge(), known = wardrobeSize() !== null || FASHIONISTA.some(id => S.state?.ach?.[id])
  return (
    <KpiRow>
      <Kpi icon={ShoppingCart} label={t('mkt.kpi.buy')} value={M.list.length ? fmt(buy.length) : '–'} tone={buy.length ? 'warn' : undefined}
        sub={t('mkt.kpi.buySub', { n: all.filter(r => r.kind === 'deal').length })} data-kpi="buy" />
      <Kpi icon={Gem} label={t('mkt.kpi.kpp')} value={best ? short(best.kpp!) : '–'} sub={best ? best.name : t('mkt.kpi.kppSub')} data-kpi="kpp" />
      <Kpi icon={Shirt} label={t('mkt.kpi.fashion')} value={known ? fmt(f.n) : '–'} data-kpi="fashion"
        sub={!known ? t('mkt.kpi.fashionNone') : f.next ? t('mkt.kpi.fashionSub', { n: f.next - f.n, goal: f.next }) : t('mkt.kpi.fashionDone')} />
      <Kpi icon={Clock} label={t('mkt.kpi.age')} value={age === null ? '–' : t('mkt.min', { n: age })} sub={M.loading ? t('mkt.loading', { n: M.loading - 1, of: M.data?.items.length ?? 0 }) : t('mkt.kpi.ageSub')} data-kpi="age" />
    </KpiRow>
  )
}

function ServerPick() {
  useEffect(() => { void loadServers() }, [])
  const eu = M.servers.filter(s => s.region === 'EU' || /^EU/.test(s.region_name || ''))
  return (
    <Hint>
      {t('mkt.noServer')}{' '}
      {M.servers.length > 0 && <AppSelect value="" className="ml-1 inline-flex h-7 w-48" options={[{ value: '', label: t('mkt.pickServer') },
        ...(eu.length ? eu : M.servers).map(s => ({ value: String(s.game_server_key), label: `${s.name} (${s.faction})` }))]}
        onChange={v => { U.marketSrv = +v; saveUi(['marketSrv']); void refresh(true); bump() }} />}
    </Hint>
  )
}

export function MarketTab() {
  useApp()
  const srv = gameServer()
  const ready = !!M.data
  useEffect(() => { void refresh() }, [srv, ready])
  const f: Filter = U.marketFilter || 'all'
  const all = marketRows().filter(r => shown(r, f))
  const by = (k: Kind[]) => all.filter(r => k.includes(r.kind))
  const bar = <>
    <BarInfo tip={t('tab.market.tip')}>{srv ? t('mkt.bar', { id: serverId(srv) }) : t('tab.market.tip')}</BarInfo>
    <BarRight>
      <Seg size="sm" value={f} onChange={v => { U.marketFilter = v; saveUi(['marketFilter']); bump() }} item={v => ({ 'data-filter': v })}
        options={(['all', 'acc', 'armor'] as Filter[]).map(v => ({ value: v, label: t('mkt.f.' + v) }))} />
      <Button size="sm" variant="ghost" data-refresh="" disabled={!!M.loading || !srv} data-tip={t('mkt.refresh')} onClick={() => void refresh(true)}><RefreshCw className={cn(M.loading && 'animate-spin')} /></Button>
    </BarRight>
  </>
  return (
    <Page w="rows" bar={bar}>
      {!srv && <ServerPick />}
      {M.error && <Hint>{M.error}</Hint>}
      <Hint tone="cyan">{t('mkt.note')}</Hint>
      <Kpis all={all} />
      <Panel title={t('mkt.buyNow')} sub={t('mkt.buyNow.sub')} data-mkt-buy="">
        {by(['deal', 'buy']).length ? <Tiles list={by(['deal', 'buy'])} /> : <Empty>{M.list.length ? t('mkt.none') : M.loading ? t('mkt.loadingList') : t('mkt.noData')}</Empty>}
      </Panel>
      <Panel className="pb-1.5">
        <Disclosure id="mkt.wait" title={t('mkt.wait', { n: by(['wait']).length })} sub={t('mkt.wait.sub')}><Tiles list={by(['wait'])} /></Disclosure>
        <Disclosure id="mkt.watch" title={t('mkt.watch', { n: by(['watch']).length })} sub={t('mkt.watch.sub')}><Tiles list={by(['watch'])} /></Disclosure>
        <Disclosure id="mkt.have" title={t('mkt.haveList', { n: by(['have']).length })}><Tiles list={by(['have'])} /></Disclosure>
      </Panel>
      <Panel className="pb-1.5">
        <HowTo id="mkt.how" title={t('mkt.howTitle')}>{t('mkt.how')}</HowTo>
      </Panel>
    </Page>
  )
}
