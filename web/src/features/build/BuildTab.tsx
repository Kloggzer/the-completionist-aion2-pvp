// Build tab (private build): Daevanion | stats & DPS | gear (separate pages in the Character area).
// Stats: number tiles (measured DPS, crit rate, best stat, gear age), sources in one line, hit types, value per stat
// (top 5); totals, assumptions and the model wait in closed disclosures. Gear: tiles (best upgrade, upgrades, best swap, gear),
// upgrades (top 5), another piece for a slot (top 4), every piece and the rating in closed disclosures.
import { useEffect } from 'react'
import { ArrowRightLeft, CircleDot, Crosshair, Download, Gem, Package, RefreshCw, Shirt, Sparkles, Swords, Target, TrendingUp, Wrench } from 'lucide-react'
import { V, useApp } from '@/core/state'
import { P } from '@/features/pvp'
import { fmt, fmtPct, locale, t } from '@/core/i18n'
import { AppSelect } from '@/components/AppSelect'
import { Button } from '@/components/ui/button'
import { BarInfo, BarRight, Columns, Disclosure, Empty, Foot, Hint, HowTo, Kpi, KpiRow, ListRow, META, Note, NumField, Page, Panel, ROW, ROWS, TONE, TopN, rich } from '@/components/kit'
import { cn } from '@/lib/utils'
import { DaevTab } from '@/features/daevanion/DaevTab'
import { ago, charKey } from '@/features/daevanion/daevanion'
import { profile } from '@/features/daevanion/source'
import { ASSUME, gain, type Assume } from './model'
import { K, PCT_KEYS, type Key } from './stats'
import { assume, autoFight, bs, fightsOf, gearById, gearRows, loadGear, loadingFight, loadingGear, measured, model, setBuild, snap, pickFight, type Model, type Page as BuildPage } from './build'
import { candidates, fmtLine, fmtRange, report, upgrades, type Candidate } from './gear'

/** DPS change in percent with sign (U+2212 for minus), "±0 %" for nothing. */
const gainPct = (v: number) => (Math.abs(v) < 0.005 ? '±0 %' : (v > 0 ? '+' : '−') + fmtPct(Math.abs(v)))
const gainTone = (v: number) => (v > 0.005 ? TONE.ok : v < -0.005 ? TONE.bad : TONE.off)
const val = (k: Key, v: number) => (PCT_KEYS.includes(k) ? fmt(v, 1) + ' %' : fmt(Math.round(v)))
const more = (k: number) => t('common.moreN', { n: k })
const when = (iso: string) => new Date(iso).toLocaleString(locale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const OLD = 3 * 86400e3 // gear older than this: the age tile turns gold

/** "How is this computed": one closed panel with a short bullet list. */
function How({ id, title, keys }: { id: string; title: string; keys: string[] }) {
  return (
    <Panel className="pb-1.5">
      <HowTo id={id} title={t(title)}>
        <ul className="flex list-disc flex-col gap-1 pl-4 marker:text-dim">{keys.map(k => <li key={k}>{rich(t(k))}</li>)}</ul>
      </HowTo>
    </Panel>
  )
}

/** Load / reload the gear from the plaync character page. */
function LoadBtn({ char, has, variant = 'outline' }: { char: string; has: boolean; variant?: 'outline' | 'ghost' }) {
  const busy = loadingGear.has(char)
  return (
    <Button size="xs" variant={variant} data-load-gear disabled={busy} onClick={() => loadGear(char)} data-tip={t('build.loadTip')}>
      {has ? <RefreshCw /> : <Download />}{busy ? t('build.loading') : t(has ? 'build.reload' : 'build.loadGear')}
    </Button>
  )
}

/** Gear + fight sources in one panel line: what is loaded, the load button, the fight picker. */
function Sources() {
  const char = charKey(), p = profile(char), s = snap(char), m = measured(char), fights = fightsOf(char), b = bs()
  return (
    <Panel title={t('build.sect.src')} right={p && <LoadBtn char={char} has={!!s} variant="ghost" />} data-sources>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 pb-2">
        <span className={cn(META, 'flex min-w-0 flex-[1_1_8rem] items-center gap-1.5 [&_svg]:size-3.5 [&_svg]:flex-none')}>
          <Shirt /><span className="truncate" data-tip={!p ? t('dae.liveNoneGame') : s ? undefined : t('build.noGear')}>{!p ? t('build.noChar') : s ? t('build.src.plaync') : t('build.noGearShort')}</span>
        </span>
        {V.abyss === false ? <span className={cn(META, 'flex-[2_1_12rem]')}>{t('build.noAbyss')}</span> : fights.length ? (
          <AppSelect value={b.fight[char] || ''} tip={t('build.fightTip')} className="h-7 min-w-0 flex-[2_1_12rem] text-xs"
            options={fights.slice(0, 60).map(f => ({ value: f.id, icon: f.hasDummy ? Target : Swords, label: `${f.label} · ${when(f.startTime)} · ${Math.round(f.duration)} s` }))}
            onChange={id => pickFight(id, char)} />
        ) : <span className={cn(META, 'flex-[2_1_12rem]')}>{V.abyss == null ? t('build.loading') : t('build.noFights', { name: char })}</span>}
      </div>
      {loadingFight.has(char) && <Note className="pt-0">{t('build.loading')}</Note>}
      {m && m.alwaysCrit.length > 0 && <Note className="pt-0">{t('build.alwaysCrit', { list: m.alwaysCrit.join(', ') })}</Note>}
    </Panel>
  )
}

const RATE_ROWS: [string, 'critRate' | 'doubleRate' | 'perfectRate' | 'multiRate', 'critMult' | 'doubleMult' | 'perfectMult' | 'multiMult', string][] = [
  ['build.r.crit', 'critRate', 'critMult', 'crit'], ['build.r.double', 'doubleRate', 'doubleMult', 'double'],
  ['build.r.perfect', 'perfectRate', 'perfectMult', 'perfect'], ['build.r.multi', 'multiRate', 'multiMult', 'multi'],
]

const unit = (k: Key) => (PCT_KEYS.includes(k) ? 1 : 10)
const step = (k: Key) => (PCT_KEYS.includes(k) ? '+1 %' : '+10')

function StatsPage() {
  const char = charKey(), md = model(char), s = md.state, b = bs(), a = assume(), m = measured(char), s0 = snap(char)
  const order = (Object.keys(md.marg) as Key[]).filter(k => k !== 'might' && k !== 'precision').sort((x, y) => md.marg[y] * unit(y) - md.marg[x] * unit(x))
  const best = order[0], capped = s.critRate * 100 >= a.critCap * 0.93
  const setOver = (k: Key, v: number | null) => { const o = { ...b.over }; if (v == null) delete o[k]; else o[k] = v; setBuild({ over: o }) }
  const setA = (k: keyof Assume, v: number | null) => setBuild({ assume: v == null ? Object.fromEntries(Object.entries(b.assume).filter(([x]) => x !== k)) : { ...b.assume, [k]: v } })
  const bar = <BarInfo>{t('build.statsInfo')}</BarInfo>
  return (
    <Page w="rows" bar={bar}>
      <KpiRow>
        <Kpi icon={Swords} label={t('build.kpi.dps')} value={m ? fmt(Math.round(m.dps)) : '–'} data-kpi="dps"
          sub={m ? `${m.label} · ${Math.round(m.seconds)} s` : t('build.kpi.noFight')}
          tip={m ? t('build.measuredAt', { label: m.label, s: Math.round(m.seconds), hits: m.hits, dps: fmt(Math.round(m.dps)) }) : t('build.fightTip')} />
        <Kpi icon={Crosshair} label={t('build.kpi.crit')} value={fmtPct(s.critRate * 100)} tone={capped ? 'warn' : undefined} data-kpi="crit"
          sub={capped ? t('build.kpi.critCap', { cap: fmt(a.critCap) }) : t(s.measured.crit ? 'build.measured' : 'build.assumed')}
          tip={capped ? t('build.critCapped', { r: fmt(s.critRate * 100, 1) }).replace(/\*\*/g, '') : undefined} />
        <Kpi icon={TrendingUp} label={t('build.kpi.best')} value={best ? gainPct(md.marg[best] * unit(best)) : '–'} tone={best && md.marg[best] > 0.005 ? 'ok' : undefined} data-kpi="best"
          sub={best ? `${t('build.k.' + best)} ${step(best)}` : undefined} tip={best ? t('build.k.' + best) : undefined} />
        <Kpi icon={Shirt} label={t('build.kpi.gear')} value={s0 ? ago(s0.at) : '–'} tone={s0 && Date.now() - s0.at > OLD ? 'warn' : undefined} data-kpi="gear"
          sub={s0 ? t('build.gearN', { n: s0.items.length }) : t('build.kpi.noGear')} />
      </KpiRow>
      <Sources />
      <Columns>
        <Panel title={t('build.sect.rates')} sub={t('build.ratesSub')}>
          <div className={ROWS} data-rates>
            {RATE_ROWS.map(([label, r, mu, key]) => {
              const meas = s.measured[key as 'crit']
              return <ListRow key={r} title={t(label)} sub={<span className={meas ? TONE.ok : TONE.off}>{t(meas ? 'build.measured' : 'build.assumed')}</span>}
                meta={<span data-tip={t('build.multTip')}>×{fmt(s[mu], 2)}</span>} right={<span className="w-16 text-right">{fmtPct(s[r] * 100)}</span>} />
            })}
          </div>
          {capped && <Note className={TONE.warn}>{rich(t('build.critCapped', { r: fmt(s.critRate * 100, 1) }))}</Note>}
        </Panel>
        <Panel title={t('build.sect.marg')} sub={t('build.margSub')}>
          <div className={ROWS} data-marg>
            <TopN id="build.marg" items={order} n={5} more={more} render={k => (
              <ListRow key={k} title={t('build.k.' + k)} meta={step(k)}
                right={<span className={cn('w-16 text-right', gainTone(md.marg[k]))}>{gainPct(md.marg[k] * unit(k))}</span>} />
            )} />
          </div>
        </Panel>
      </Columns>
      <Panel className="pb-1.5">
        <Disclosure id="build.totals" title={t('build.sect.totals')} sub={t('build.totalsShort')}>
          <Note className="pt-0.5">{t('build.totalsSub')}</Note>
          <div className={cn(ROWS, 'grid grid-cols-[repeat(auto-fill,minmax(min(260px,100%),1fr))] gap-x-3 px-1.5')} data-totals>
            {K.map(k => {
              const auto = md.auto[k] || 0, own = b.over[k]
              return (
                <div key={k} className={cn(ROW, 'gap-1.5 px-1.5')} data-tip={`${t('build.src.gear')} ${val(k, md.by.gear[k] || 0)} · ${t('build.src.deity')} ${val(k, md.by.deity[k] || 0)} · ${t('build.src.dae')} ${val(k, md.by.dae[k] || 0)}`}>
                  <span className="min-w-0 flex-1 truncate">{t('build.k.' + k)}</span>
                  <span className={cn('tabular-nums', own != null && 'text-dim line-through')}>{val(k, auto)}</span>
                  <NumField value={own} onCommit={v => setOver(k, v)} data-total={k} />
                </div>
              )
            })}
          </div>
        </Disclosure>
      </Panel>
      <Panel className="pb-1.5">
        <Disclosure id="build.assume" title={t('build.sect.assume')} sub={t('build.assumeSub')}>
          <div className={cn(ROWS, 'mt-1 grid grid-cols-[repeat(auto-fill,minmax(min(260px,100%),1fr))] gap-x-3 px-1.5')} data-assume>
            {(Object.keys(ASSUME) as (keyof Assume)[]).map(k => (
              <div key={k} className={cn(ROW, 'gap-1.5 px-1.5')} data-tip={t('build.a.' + k + 'Tip')}>
                <span className="min-w-0 flex-1 truncate">{t('build.a.' + k)}</span>
                <NumField value={b.assume[k]} placeholder={String(ASSUME[k])} onCommit={v => setA(k, v)} data-assume-key={k} />
              </div>
            ))}
          </div>
        </Disclosure>
      </Panel>
      <How id="build.how" title="build.how" keys={['build.how.model', 'build.how.rates', 'build.how.totals', 'build.how.dae']} />
      <Foot>{t('build.foot')}</Foot>
    </Page>
  )
}

const UP_ICON = { soul: Gem, enchant: Sparkles, stone: CircleDot }
const UP_TONE = { soul: 'text-purple', enchant: TONE.warn, stone: TONE.off }

// Best other piece over every slot (memoized per model: the model object only changes with its inputs).
type Items = NonNullable<ReturnType<typeof snap>>['items']
const swapMemo = new WeakMap<Model, { c: Candidate; slot: string } | null>()
function bestSwap(md: Model, items: Items, faction?: string) {
  if (!gearRows().length) return null
  if (!swapMemo.has(md)) {
    let best: { c: Candidate; slot: string } | null = null
    for (const it of items) { const c = candidates(md.state, it, gearRows(), faction)[0]; if (c && c.gain > 0.005 && (!best || c.gain > best.c.gain)) best = { c, slot: it.slot } }
    swapMemo.set(md, best)
  }
  return swapMemo.get(md)!
}

function GearPage() {
  const char = charKey(), md = model(char), s0 = snap(char), db = gearById(), b = bs(), p = profile(char)
  const bar = <><BarInfo>{t('build.gearInfo')}</BarInfo>{p && <BarRight><LoadBtn char={char} has={!!s0} /></BarRight>}</>
  if (!s0) return (
    <Page w="rows" bar={bar}>
      {p ? <Hint><div className="flex flex-wrap items-center gap-x-3 gap-y-1.5"><span className="min-w-0 flex-[1_1_14rem]">{t('build.noGear')}</span><LoadBtn char={char} has={false} /></div></Hint>
        : <Empty>{t('dae.liveNoneGame')}</Empty>}
    </Page>
  )
  const ups = upgrades(md.state, s0, db), worth = ups.filter(u => u.gain > 0.005)
  const sel = s0.items.find(i => i.slot === b.cmp) || s0.items[0]
  const race = P.own?.race, faction = race === 1 ? 'Elyos' : race === 2 ? 'Asmodian' : undefined
  const cands = sel ? candidates(md.state, sel, gearRows(), faction).slice(0, 12) : []
  const swap = bestSwap(md, s0.items, faction), top = ups[0]
  return (
    <Page w="rows" bar={bar}>
      <KpiRow>
        <Kpi icon={TrendingUp} label={t('build.kpi.up')} value={top && top.gain > 0.005 ? gainPct(top.gain) : '–'} tone={top && top.gain > 0.005 ? 'ok' : undefined}
          sub={top ? `${t('build.up.' + top.kind)} · ${top.item}` : t('build.noUp')} tip={top ? `${top.item} (${top.slot}): ${top.text}` : undefined} data-kpi="up" />
        <Kpi icon={Wrench} label={t('build.kpi.ups')} value={fmt(worth.length)} sub={t('build.kpi.upsSub', { n: ups.length - worth.length })} data-kpi="ups" />
        <Kpi icon={ArrowRightLeft} label={t('build.kpi.swap')} value={swap ? gainPct(swap.c.gain) : '–'} tone={swap ? 'ok' : undefined} data-kpi="swap"
          sub={swap ? `${swap.slot} · ${swap.c.row[1]}` : gearRows().length ? t('build.noCand') : t('build.noGearDb')}
          tip={swap ? swap.c.row[1] : undefined} onClick={swap ? () => setBuild({ cmp: swap.slot }) : undefined} />
        <Kpi icon={Package} label={t('build.kpi.gear')} value={t('build.gearN', { n: s0.items.length })} sub={ago(s0.at)}
          tone={Date.now() - s0.at > OLD ? 'warn' : undefined} data-kpi="gear" />
      </KpiRow>
      <Columns>
        <Panel title={t('build.sect.up')} sub={t('build.upSub')}>
          <div className={ROWS} data-upgrades>
            {ups.length ? <TopN id="build.ups" items={ups} n={5} more={more} render={(u, i) => {
              const I = UP_ICON[u.kind]
              return <ListRow key={i} icon={<span className="contents" data-tip={t('build.up.' + u.kind + 'Tip')}><I className={UP_TONE[u.kind]} /></span>}
                title={<>{u.item} <span className="text-[11.5px] text-dim">{u.slot}</span></>}
                sub={<>{u.text}{u.chance != null && <> · {fmt(u.chance, 1)} %</>}</>}
                right={<span className={gainTone(u.gain)}>{gainPct(u.gain)}</span>} />
            }} /> : <Note>{t('build.noUp')}</Note>}
          </div>
        </Panel>
        <Panel title={t('build.sect.cmp')} right={<AppSelect value={sel?.slot || ''} tip={t('build.cmpTip')} className="h-6 max-w-48 text-xs"
          options={s0.items.map(i => ({ value: i.slot, label: `${i.slot} · ${i.name}` }))} onChange={v => setBuild({ cmp: v })} />}>
          <div className={ROWS} data-candidates>
            {cands.length ? <TopN id="build.cands" items={cands} n={4} more={more} render={c => (
              <ListRow key={c.row[0]} title={c.row[1]} sub={`${c.row[3]} · ${t('build.ilv', { n: c.row[4] })}`}
                tip={Object.entries(c.row[6]).map(([k, v]) => `${k} ${fmtLine(v)}`).join(' · ')}
                right={<span className={gainTone(c.gain)}>{gainPct(c.gain)}</span>} />
            )} /> : <Note>{gearRows().length ? t('build.noCand') : t('build.noGearDb')}</Note>}
          </div>
        </Panel>
      </Columns>
      <Panel className="pb-1.5">
        <Disclosure id="build.items" title={t('build.sect.items')} sub={t('build.itemsSub')}>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-1.5 px-2.5 pt-1 pb-1" data-items>
            {s0.items.map(it => {
              const r = report(md.state, it, db), lines = [...r.main.map(l => ({ ...l, g: 'main' })), ...r.sub.map(l => ({ ...l, g: 'sub' })), ...r.stones.map(l => ({ ...l, g: 'stone' }))]
              const total = gain(md.state, Object.fromEntries(lines.filter(l => l.key).reduce((m, l) => m.set(l.key!, (m.get(l.key!) || 0) + l.value), new Map<Key, number>())))
              return (
                <div key={it.slot} data-item={it.slot} className="min-w-0 rounded-lg border bg-background/40 px-2.5 py-1.5 text-[12px]">
                  <div className="flex items-baseline gap-1.5"><b className="min-w-0 flex-1 truncate font-semibold" data-tip={it.name}>{it.name} {it.enchant > 0 && <span className="text-gold">+{it.enchant}</span>}</b>
                    <span className="text-[11.5px] text-dim">{it.slot}</span><b className={cn('text-[12px] tabular-nums', gainTone(total))}>{gainPct(total)}</b></div>
                  {lines.map((l, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[11.5px]">
                      <span className={cn('w-14 flex-none truncate text-[11px]', l.g === 'sub' ? 'text-purple' : l.g === 'stone' ? 'text-cyan' : 'text-dim')}>{t('build.g.' + l.g)}</span>
                      <span className={cn('min-w-0 flex-1 truncate', !l.key && 'text-dim')}>{l.name} {fmtLine(l.value)}</span>
                      <span className={cn('tabular-nums', l.key ? gainTone(l.gain) : TONE.off)}>{l.key ? gainPct(l.gain) : '–'}</span>
                    </div>
                  ))}
                  {r.targets.length > 0 && <div className="mt-1 text-[11.5px] whitespace-normal text-muted-foreground"><span className="text-purple">{t('build.soulTop')}</span>{' '}
                    {r.targets.slice(0, 3).map(x => `${x.stat} ${fmtRange(x.low, x.high)} (${gainPct(x.gain)}, ${fmt(x.chance, 1)} %)`).join(' · ')}</div>}
                </div>
              )
            })}
          </div>
        </Disclosure>
      </Panel>
      <How id="build.gearHow" title="build.gearHow" keys={['build.how.soul', 'build.how.enchant', 'build.how.stone']} />
      <Foot>{t('build.gearFoot')}</Foot>
    </Page>
  )
}

export function BuildTab() {
  useApp()
  const page = bs().page as BuildPage, char = charKey()
  // measure the newest dummy fight once the character is known (the game reports it after login)
  useEffect(() => { void autoFight(char) }, [char])
  if (page === 'stats') return <StatsPage />
  if (page === 'gear') return <GearPage />
  return <DaevTab />
}
