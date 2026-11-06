// "Markt" page: the skins on the market as one plain list, cheapest first (not listed at the end), the ones you own
// hidden (switch to show them). Columns: skin, slot, collection points, listings, price; the usual price only in the
// tooltip. Owned = the game's wardrobe list, plus a "have" mark by hand for missing ones.
import { useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { U, bump, saveUi, useApp } from '@/core/state'
import { locale, t } from '@/core/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { AppSelect } from '@/components/AppSelect'
import { BarInfo, BarRight, Empty, Hint, HowTo, Page, Panel, Seg } from '@/components/kit'
import { ACCESSORY, serverId, type Row } from './logic'
import { M, gameServer, inGame, loadServers, marketRows, refresh, setOwned, wardrobeSize } from './index'

const fmt = (n: number) => Math.round(n).toLocaleString(locale())
type Filter = 'all' | 'acc' | 'armor'
const shown = (r: Row, f: Filter) => f === 'all' || (f === 'acc') === ACCESSORY.has(r.cat)
/** Cheapest first, not listed at the end (by the usual price there). */
const byPrice = (a: Row, b: Row) => (a.price ?? Infinity) - (b.price ?? Infinity) || (a.med ?? Infinity) - (b.med ?? Infinity)
const GRADE_COL: Record<string, string> = { Common: 'bg-dim', Rare: 'bg-green', Epic: 'bg-cyan', Unique: 'bg-gold', Heroic: 'bg-purple', Legend: 'bg-red' }

function SkinRow({ r }: { r: Row }) {
  const have = r.kind === 'have', game = inGame(r)
  const tip = [r.stat ? t('mkt.stat', { stat: r.stat, pts: r.pts }) : '', r.med ? t('mkt.usual', { p: fmt(r.med) }) : ''].filter(Boolean).join('\n')
  return (
    <tr data-skin={r.item} data-kind={r.kind} data-tip={tip} className={cn('border-b border-border/50 hover:bg-foreground/[0.03]', have && 'text-dim')}>
      <td className="py-1.5 pr-2 pl-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn('size-2 flex-none rounded-full', GRADE_COL[r.grade] || 'bg-dim')} data-tip={t('mkt.grade.' + r.grade)} />
          <span className="truncate font-medium">{r.name}</span>
        </span>
      </td>
      <td className="px-2 text-muted-foreground">{t('mkt.cat.' + r.cat)}</td>
      <td className="px-2 text-right tabular-nums">{r.pts}</td>
      <td className="px-2 text-right tabular-nums text-muted-foreground">{r.listings || '–'}</td>
      <td className="px-2 text-right font-semibold tabular-nums">{r.price !== null ? fmt(r.price) : '–'}</td>
      <td className="py-1.5 pr-3 pl-1 text-right">
        {game
          ? <span data-ingame={r.item} className="text-[11px] text-green" data-tip={t('mkt.haveGame.tip')}>✓</span>
          : <button data-have={r.item} onClick={() => setOwned(r.item, !have)} data-tip={have ? t('mkt.unmark') : t('mkt.markHave.tip')}
            className={cn('rounded-sm border px-1.5 text-[11px] leading-[18px] hover:bg-foreground/5', have ? 'border-green/40 text-green' : 'border-border text-muted-foreground')}>
            {have ? '✓' : t('mkt.markHave')}
          </button>}
      </td>
    </tr>
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
  const srv = gameServer(), ready = !!M.data
  useEffect(() => { void refresh() }, [srv, ready])
  const f: Filter = U.marketFilter || 'all', showOwned = !!U.marketOwned
  const rows = marketRows().filter(r => shown(r, f))
  const list = rows.filter(r => showOwned || r.kind !== 'have').sort(byPrice)
  const listed = rows.filter(r => r.kind !== 'have' && r.price !== null).length, missing = rows.filter(r => r.kind !== 'have').length
  const ward = wardrobeSize()
  const bar = <>
    <BarInfo tip={srv ? t('mkt.bar', { id: serverId(srv) }) : t('tab.market.tip')}>
      {t('mkt.summary', { listed, missing })}{ward !== null ? ' · ' + t('mkt.wardrobe', { n: ward }) : ''}
    </BarInfo>
    <BarRight>
      <Seg size="sm" value={f} onChange={v => { U.marketFilter = v; saveUi(['marketFilter']); bump() }} item={v => ({ 'data-filter': v })}
        options={(['all', 'acc', 'armor'] as Filter[]).map(v => ({ value: v, label: t('mkt.f.' + v) }))} />
      <Button size="sm" variant={showOwned ? 'secondary' : 'ghost'} data-owned-toggle="" onClick={() => { U.marketOwned = !showOwned; saveUi(['marketOwned']); bump() }}>
        {t('mkt.showOwned')}
      </Button>
      <Button size="sm" variant="ghost" data-refresh="" disabled={!!M.loading || !srv} data-tip={t('mkt.refresh')} onClick={() => void refresh(true)}><RefreshCw className={cn(M.loading && 'animate-spin')} /></Button>
    </BarRight>
  </>
  return (
    <Page w="rows" bar={bar}>
      {!srv && <ServerPick />}
      {M.error && <Hint>{M.error}</Hint>}
      <Panel data-mkt-list="">
        {list.length
          ? <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b text-left text-[11.5px] text-muted-foreground">
                <th className="py-1.5 pr-2 pl-3 font-medium">{t('mkt.col.skin')}</th>
                <th className="px-2 font-medium">{t('mkt.col.slot')}</th>
                <th className="px-2 text-right font-medium" data-tip={t('mkt.col.pts.tip')}>{t('mkt.col.pts')}</th>
                <th className="px-2 text-right font-medium">{t('mkt.col.listings')}</th>
                <th className="px-2 text-right font-medium">{t('mkt.col.price')}</th>
                <th className="pr-3" />
              </tr>
            </thead>
            <tbody>{list.map(r => <SkinRow key={r.item} r={r} />)}</tbody>
          </table>
          : <Empty>{M.loading ? t('mkt.loadingList') : M.data?.items.length ? t('mkt.allOwned') : t('mkt.noData')}</Empty>}
      </Panel>
      <Panel className="pb-1.5">
        <HowTo id="mkt.how" title={t('mkt.howTitle')}>{t('mkt.how')}</HowTo>
      </Panel>
    </Page>
  )
}
