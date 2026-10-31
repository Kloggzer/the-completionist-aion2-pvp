// Build tab (private build): Daevanion | stats & DPS | gear, one page switch at the start of each page's bar.
import { useEffect } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { V, useApp } from '@/core/state'
import { host } from '@/core/host'
import { P } from '@/features/pvp'
import { fmt, lang, t } from '@/core/i18n'
import { AppSelect } from '@/components/AppSelect'
import { BarInfo, BarRight, CHIP, CHIP_ON, Columns, Empty, Foot, Hint, Note, Page, ROW, ROWS, SECT_BTN, Sect, rich } from '@/components/kit'
import { cn } from '@/lib/utils'
import { DaevTab } from '@/features/daevanion/DaevTab'
import { ago, charKey } from '@/features/daevanion/daevanion'
import { profile } from '@/features/daevanion/source'
import { ASSUME, gain, type Assume } from './model'
import { K, PCT_KEYS, type Key } from './stats'
import { assume, autoFight, bs, fightsOf, gearById, gearRows, loadGear, loadingFight, loadingGear, measured, model, setBuild, snap, pickFight, type Page as BuildPage } from './build'
import { candidates, fmtLine, fmtRange, report, upgrades } from './gear'

const PAGES: BuildPage[] = ['dae', 'stats', 'gear']
const num = (v: number, d: number) => v.toLocaleString(lang() === 'de' ? 'de-DE' : 'en-GB', { maximumFractionDigits: d, minimumFractionDigits: d })
const pct = (v: number, d = 2) => (v > 0 ? '+' : '') + num(v, d) + ' %'
const val = (k: Key, v: number) => (PCT_KEYS.includes(k) ? fmtLine(Math.round(v * 10) / 10) + ' %' : fmt(Math.round(v)))

function Nav() {
  const cur = bs().page as BuildPage
  return <span className="flex flex-none gap-1">{PAGES.map(p => (
    <button key={p} data-page={p} onClick={() => setBuild({ page: p })} className={cn(CHIP, cur === p && CHIP_ON)}>{t('build.page.' + p)}</button>
  ))}</span>
}

/** Gear + fight sources: load buttons, what is loaded. */
function Sources() {
  const char = charKey(), p = profile(char), s = snap(char), m = measured(char), fights = fightsOf(char), b = bs()
  return <>
    <Sect right={p && <button className={SECT_BTN} data-load-gear disabled={loadingGear.has(char)} onClick={() => loadGear(char)}>
      {s ? <RefreshCw /> : <Download />}{loadingGear.has(char) ? t('build.loading') : s ? t('build.reload') : t('build.loadGear')}</button>}>{t('build.sect.gear')}</Sect>
    <Note>{!p ? t('dae.liveNoneGame') : s ? t('build.gearAt', { n: s.items.length, age: ago(s.at) }) : t('build.noGear')}</Note>
    <Sect>{t('build.sect.fight')}</Sect>
    {V.abyss === false ? <Note>{t('build.noAbyss')}</Note> : fights.length ? (
      <div className="px-2.5 pb-1">
        <AppSelect value={b.fight[char] || ''} tip={t('build.fightTip')} className="h-7 w-full text-xs"
          options={fights.slice(0, 60).map(f => ({ value: f.id, label: `${f.hasDummy ? '🎯 ' : ''}${f.label} · ${f.startTime.slice(5, 16).replace('T', ' ')} · ${Math.round(f.duration)} s` }))}
          onChange={id => pickFight(id, char)} />
        {loadingFight.has(char) && <Note className="px-0">{t('build.loading')}</Note>}
      </div>
    ) : <Note>{V.abyss == null ? t('build.loading') : t('build.noFights', { name: char })}</Note>}
    {m && <Note>{t('build.measuredAt', { label: m.label, s: Math.round(m.seconds), hits: m.hits, dps: fmt(Math.round(m.dps)) })}
      {m.alwaysCrit.length > 0 && <> · {t('build.alwaysCrit', { list: m.alwaysCrit.join(', ') })}</>}</Note>}
  </>
}

const RATE_ROWS: [string, 'critRate' | 'doubleRate' | 'perfectRate' | 'multiRate', 'critMult' | 'doubleMult' | 'perfectMult' | 'multiMult', string][] = [
  ['build.r.crit', 'critRate', 'critMult', 'crit'], ['build.r.double', 'doubleRate', 'doubleMult', 'double'],
  ['build.r.perfect', 'perfectRate', 'perfectMult', 'perfect'], ['build.r.multi', 'multiRate', 'multiMult', 'multi'],
]

function StatsPage() {
  const char = charKey(), md = model(char), s = md.state, b = bs(), a = assume()
  const order = (Object.keys(md.marg) as Key[]).filter(k => k !== 'might' && k !== 'precision').sort((x, y) => md.marg[y] - md.marg[x])
  const bar = <><Nav /><BarInfo>{t('build.statsInfo')}</BarInfo></>
  const setOver = (k: Key, v: number | null) => { const o = { ...b.over }; if (v == null) delete o[k]; else o[k] = v; setBuild({ over: o }) }
  const setA = (k: keyof Assume, v: number) => setBuild({ assume: { ...b.assume, [k]: v } })
  return (
    <Page w="rows" bar={bar}>
      <Columns>
        <div>
          <Sources />
          <Sect>{t('build.sect.rates')}</Sect>
          <div className={ROWS} data-rates>
            {RATE_ROWS.map(([label, r, m, key]) => (
              <div key={r} className={ROW}>
                <span className="min-w-0 flex-1 truncate">{t(label)}</span>
                <b className="w-16 text-right tabular-nums">{num(s[r] * 100, 1)} %</b>
                <span className="w-14 text-right text-muted-foreground tabular-nums">×{num(s[m], 2)}</span>
                <i className={cn('w-16 text-right text-[11px] not-italic', s.measured[key as 'crit'] ? 'text-green' : 'text-dim')}>{t(s.measured[key as 'crit'] ? 'build.measured' : 'build.assumed')}</i>
              </div>
            ))}
          </div>
          {s.critRate * 100 >= a.critCap * 0.93 && <Hint>{rich(t('build.critCapped', { r: num(s.critRate * 100, 1) }))}</Hint>}
        </div>
        <div>
          <Sect sub={t('build.margSub')}>{t('build.sect.marg')}</Sect>
          <div className={ROWS} data-marg>
            {order.map(k => (
              <div key={k} className={ROW}>
                <span className="min-w-0 flex-1 truncate">{t('build.k.' + k)}</span>
                <span className="w-20 text-right text-[11px] text-dim tabular-nums">+{PCT_KEYS.includes(k) ? '1 %' : '10'}</span>
                <b className={cn('w-20 text-right tabular-nums', md.marg[k] > 0.005 ? 'text-green' : 'text-dim')}>{pct(md.marg[k] * (PCT_KEYS.includes(k) ? 1 : 10))}</b>
              </div>
            ))}
          </div>
        </div>
      </Columns>
      <Sect sub={t('build.totalsSub')}>{t('build.sect.totals')}</Sect>
      <div className={cn(ROWS, 'grid grid-cols-[repeat(auto-fill,minmax(min(260px,100%),1fr))] gap-x-3 px-1.5')} data-totals>
        {K.map(k => {
          const auto = md.auto[k] || 0, own = b.over[k]
          return (
            <div key={k} className={cn(ROW, 'gap-1 px-1')} data-tip={`${t('build.src.gear')} ${val(k, md.by.gear[k] || 0)} · ${t('build.src.deity')} ${val(k, md.by.deity[k] || 0)} · ${t('build.src.dae')} ${val(k, md.by.dae[k] || 0)}`}>
              <span className="min-w-0 flex-1 truncate">{t('build.k.' + k)}</span>
              <span className={cn('tabular-nums', own != null && 'text-dim line-through')}>{val(k, auto)}</span>
              <NumEntry value={own} onChange={v => setOver(k, v)} />
            </div>
          )
        })}
      </div>
      <Sect sub={t('build.assumeSub')}>{t('build.sect.assume')}</Sect>
      <div className={cn(ROWS, 'grid grid-cols-[repeat(auto-fill,minmax(min(260px,100%),1fr))] gap-x-3 px-1.5')}>
        {(Object.keys(ASSUME) as (keyof Assume)[]).map(k => (
          <div key={k} className={cn(ROW, 'gap-1 px-1')} data-tip={t('build.a.' + k + 'Tip')}>
            <span className="min-w-0 flex-1 truncate">{t('build.a.' + k)}</span>
            <NumEntry value={b.assume[k]} placeholder={String(ASSUME[k])} onChange={v => v == null ? setBuild({ assume: Object.fromEntries(Object.entries(b.assume).filter(([x]) => x !== k)) }) : setA(k, v)} />
          </div>
        ))}
      </div>
      <Foot>{t('build.foot')}</Foot>
    </Page>
  )
}

/** Small number field (the overlay takes the keyboard only while it has focus). Empty = not set. */
function NumEntry({ value, onChange, placeholder }: { value: number | undefined; onChange: (v: number | null) => void; placeholder?: string }) {
  return <input key={String(value)} defaultValue={value ?? ''} placeholder={placeholder ?? '–'} inputMode="decimal"
    onFocus={() => host({ type: 'typing', on: true })}
    onBlur={e => { host({ type: 'typing', on: false }); const s = e.target.value.trim().replace(',', '.'); onChange(s === '' || isNaN(+s) ? null : +s) }}
    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
    className="h-6 w-16 flex-none rounded-sm border bg-background/60 px-1.5 text-right text-[12px] text-foreground tabular-nums outline-none placeholder:text-dim focus:border-gold/60" />
}

function GearPage() {
  const char = charKey(), md = model(char), s0 = snap(char), db = gearById(), b = bs()
  const bar = <><Nav /><BarInfo>{t('build.gearInfo')}</BarInfo>
    <BarRight><button className={cn(CHIP)} disabled={loadingGear.has(char)} onClick={() => loadGear(char)}>{s0 ? <RefreshCw /> : <Download />}{t(s0 ? 'build.reload' : 'build.loadGear')}</button></BarRight></>
  if (!s0) return <Page w="rows" bar={bar}><Empty>{profile(char) ? t('build.noGear') : t('dae.liveNoneGame')}</Empty></Page>
  const ups = upgrades(md.state, s0, db).slice(0, 15)
  const sel = s0.items.find(i => i.slot === b.cmp) || s0.items[0]
  const race = P.own?.race, cands = sel ? candidates(md.state, sel, gearRows(), race === 1 ? 'Elyos' : race === 2 ? 'Asmodian' : undefined).slice(0, 8) : []
  return (
    <Page w="rows" bar={bar}>
      <Columns>
        <div>
          <Sect sub={t('build.upSub')}>{t('build.sect.up')}</Sect>
          <div className={ROWS} data-upgrades>
            {ups.length ? ups.map((u, i) => (
              <div key={i} className={cn(ROW, 'min-h-9 gap-2')}>
                <span className={cn('w-14 flex-none text-[11px]', u.kind === 'soul' ? 'text-purple' : u.kind === 'enchant' ? 'text-gold' : 'text-dim')}>{t('build.up.' + u.kind)}</span>
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="truncate">{u.item} <i className="text-[11px] text-dim not-italic">{u.slot}</i></span>
                  <span className="truncate text-[11.5px] text-muted-foreground">{u.text}{u.chance != null && <> · {fmtLine(u.chance)} %</>}</span>
                </span>
                <b className={cn('flex-none tabular-nums', u.gain > 0.005 ? 'text-green' : 'text-dim')}>{u.gain > 0 ? pct(u.gain) : '±0'}</b>
              </div>
            )) : <Note>{t('build.noUp')}</Note>}
          </div>
        </div>
        <div>
          <Sect right={<AppSelect value={sel?.slot || ''} tip={t('build.cmpTip')} className="h-6 text-xs"
            options={s0.items.map(i => ({ value: i.slot, label: `${i.slot} · ${i.name}` }))} onChange={v => setBuild({ cmp: v })} />}>{t('build.sect.cmp')}</Sect>
          <div className={ROWS} data-candidates>
            {cands.length ? cands.map(c => (
              <div key={c.row[0]} className={cn(ROW, 'gap-2')} data-tip={Object.entries(c.row[6]).map(([k, v]) => `${k} ${fmtLine(v)}`).join(' · ')}>
                <span className="min-w-0 flex-1 truncate">{c.row[1]} <i className="text-[11px] text-dim not-italic">{c.row[3]} · iLv {c.row[4]}</i></span>
                <b className={cn('flex-none tabular-nums', c.gain > 0 ? 'text-green' : 'text-red')}>{pct(c.gain)}</b>
              </div>
            )) : <Note>{gearRows().length ? t('build.noCand') : t('build.noGearDb')}</Note>}
          </div>
        </div>
      </Columns>
      <Sect sub={t('build.itemsSub')}>{t('build.sect.items')}</Sect>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-1.5 px-1.5" data-items>
        {s0.items.map(it => {
          const r = report(md.state, it, db), lines = [...r.main.map(l => ({ ...l, g: 'main' })), ...r.sub.map(l => ({ ...l, g: 'sub' })), ...r.stones.map(l => ({ ...l, g: 'stone' }))]
          const total = gain(md.state, Object.fromEntries(lines.filter(l => l.key).reduce((m, l) => m.set(l.key!, (m.get(l.key!) || 0) + l.value), new Map<Key, number>())))
          return (
            <div key={it.slot} data-item={it.slot} className="min-w-0 rounded-sm border bg-card px-2 py-1.5 text-[12px]">
              <div className="flex items-baseline gap-1.5"><b className="min-w-0 flex-1 truncate font-semibold">{it.name} {it.enchant > 0 && <span className="text-gold">+{it.enchant}</span>}</b>
                <span className="text-[11px] text-dim">{it.slot}</span><b className="text-[11.5px] text-green tabular-nums">{pct(total, 1)}</b></div>
              {lines.map((l, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[11.5px]">
                  <i className={cn('w-12 flex-none text-[10.5px] not-italic', l.g === 'sub' ? 'text-purple' : l.g === 'stone' ? 'text-cyan' : 'text-dim')}>{t('build.g.' + l.g)}</i>
                  <span className={cn('min-w-0 flex-1 truncate', !l.key && 'text-dim')}>{l.name} {fmtLine(l.value)}</span>
                  <span className={cn('tabular-nums', l.gain > 0.005 ? 'text-green' : 'text-dim')}>{l.key ? pct(l.gain) : '–'}</span>
                </div>
              ))}
              {r.targets.length > 0 && <div className="mt-1 text-[11px] text-muted-foreground"><span className="text-purple">{t('build.soulTop')}</span>{' '}
                {r.targets.slice(0, 3).map(x => `${x.stat} ${fmtRange(x.low, x.high)} (${pct(x.gain, 1)}, ${fmtLine(x.chance)} %)`).join(' · ')}</div>}
            </div>
          )
        })}
      </div>
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
  return <DaevTab nav={<Nav />} />
}
