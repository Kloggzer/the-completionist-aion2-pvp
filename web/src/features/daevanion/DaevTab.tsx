import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, Download, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
import { V, bump, useApp } from '@/core/state'
import { fmt, lang, t } from '@/core/i18n'
import { AppSelect } from '@/components/AppSelect'
import { Slider } from '@/components/ui/slider'
import { Bar, BarInfo, BarRight, CHIP, CHIP_ON, Columns, Empty, Foot, Hint, Note, Page, ROW, ROWS, SECT_BTN, Sect, rich } from '@/components/kit'
import { cn } from '@/lib/utils'
import { LIVE, NONE_HINT, advice, ago, charKey, classId, className, data, forgetLive, live, loadLive, loading, plans, POOL_KEY, profile, save, settings, skillBases, totals, weights, type PoolPlan } from './daevanion'
import { BREAKPOINTS, DEFAULT_BASE, TIERS, defaultTier, skillBps, statCat, statMult, type DaeData, type Pool, type Skill } from './values'

const label = (o: { en: string; de: string }) => (lang() === 'de' ? o.de : o.en)
const amount = (v: number, pct: boolean) => (v > 0 ? '+' : '') + (pct ? fmt(Math.round(v * 10) / 10) + ' %' : fmt(v))

/** −10 −1 value +1 +10; `spent` (website boards) shows what of it is spent and free. */
function PointsEdit({ label: l, value, onChange, dataKey, spent }: { label: string; value: number; onChange: (v: number) => void; dataKey: string; spent?: number }) {
  const b = 'h-6 min-w-7 flex-none rounded-sm border px-1 text-[11px] text-muted-foreground tabular-nums transition-colors hover:border-gold/50 hover:text-gold disabled:pointer-events-none disabled:opacity-30'
  const set = (v: number) => onChange(Math.max(0, Math.min(999, v)))
  return (
    <div data-points={dataKey} className={cn(ROW, 'gap-1')}>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-muted-foreground">{l}</span>
        {spent != null && spent > 0 && <span data-spent className="truncate text-[11px] text-dim tabular-nums">{t('dae.spentFree', { spent, free: Math.max(0, value - spent) })}</span>}
      </span>
      {[10, 1].map(d => <button key={-d} className={b} disabled={value <= 0} onClick={() => set(value - d)}>−{d}</button>)}
      <output className="min-w-9 text-center font-semibold text-foreground tabular-nums">{value}</output>
      {[1, 10].map(d => <button key={d} className={b} onClick={() => set(value + d)}>+{d}</button>)}
    </div>
  )
}

function GoalSlider({ cls }: { cls: string }) {
  const off = weights(cls).off, [drag, setDrag] = useState<number | null>(null), v = drag ?? off
  const s = settings()
  return (
    <div className="px-2.5 pb-1">
      <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
        <span className="w-20 flex-none">{t('dae.def')}</span>
        <Slider data-goal min={0} max={100} step={5} value={[Math.round(v * 100)]} className="flex-1"
          onValueChange={x => setDrag((Array.isArray(x) ? x[0] : x) / 100)}
          onValueCommitted={x => { setDrag(null); save({ off: { ...s.off, [cls]: (Array.isArray(x) ? x[0] : x) / 100 } }) }} />
        <span className="w-20 flex-none text-right">{t('dae.atk')}</span>
      </div>
      <div className="mt-0.5 text-center text-[11px] text-dim tabular-nums">{t('dae.slider', { a: Math.round(v * 100), d: Math.round((1 - v) * 100) })}</div>
      <button data-pvp-focus data-tip={t('dae.pvpFocusTip')} onClick={() => save({ pvpFocus: !s.pvpFocus })}
        className={cn(CHIP, 'mt-1 h-6 w-full justify-center text-[11.5px]', s.pvpFocus && CHIP_ON)}>{t(s.pvpFocus ? 'dae.pvpFocusOn' : 'dae.pvpFocus')}</button>
    </div>
  )
}

function LiveBlock() {
  const char = charKey(), p = profile(char), l = live(char), busy = loading.has(char)
  return <>
    <Sect right={p && <>
      <button className={SECT_BTN} disabled={busy} data-tip={t('dae.liveLoadTip')} onClick={() => loadLive(char)}>
        {l ? <RefreshCw /> : <Download />}{busy ? t('dae.liveBusy') : l ? t('dae.liveReload') : t('dae.liveLoad')}
      </button>
      {l && <button className={SECT_BTN} onClick={() => forgetLive(char)}><Trash2 />{t('dae.liveForget')}</button>}
    </>}>{t('dae.sect.live')}</Sect>
    <Note>{!p ? t(NONE_HINT) : l ? `${p.name} · ${t(l.game ? 'dae.liveGame' : 'dae.live', { age: ago(l.at) })}` : p.name}</Note>
  </>
}

const CAT_DOT = { off: 'bg-red/80', def: 'bg-cyan/80', all: 'bg-gold', util: 'bg-dim' } as const

/** Stat / skill change of a plan against the current boards: stats as a two-column grid, skills as chips. */
function Result({ p, d, cls }: { p: PoolPlan; d: DaeData; cls: string }) {
  const now = totals(p, p.cur), next = totals(p, p.plan.owned)
  const added = [...p.plan.owned].filter(i => !p.cur.has(i)).length, removed = [...p.cur].filter(i => !p.plan.owned.has(i)).length
  const left = p.budget - p.plan.spent
  const order = ['all', 'off', 'def', 'util']
  const stats = [...new Set([...now.stats.keys(), ...next.stats.keys()])]
    .map(i => ({ i, st: d.stats[i], a: now.stats.get(i) || 0, b: next.stats.get(i) || 0 })).filter(x => x.a !== x.b)
    .sort((x, y) => order.indexOf(statCat(x.st.key)) - order.indexOf(statCat(y.st.key)) || x.i - y.i)
  const sk = d.classes[cls].skills
  const skills = [...new Set([...now.skills.keys(), ...next.skills.keys()])]
    .map(i => ({ i, a: now.skills.get(i) || 0, b: next.skills.get(i) || 0 })).filter(x => x.a !== x.b)
    .sort((x, y) => y.b - x.b || label(sk[x.i]).localeCompare(label(sk[y.i])))
  const pool = p.slots.map(x => d.classes[cls].boards[x].name).join(' · ')
  return <>
    <Sect sub={pool}>{t('dae.sect.result')}</Sect>
    <div className="px-2.5">
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="text-muted-foreground">{t('dae.used', { n: p.plan.spent, total: p.budget })}</span>
        <span className="flex gap-2 text-[11.5px] tabular-nums">
          {added > 0 && <span className="text-gold">{t('dae.add', { n: added })}</span>}
          {removed > 0 && <span className="text-red">{t('dae.remove', { n: removed })}</span>}
        </span>
      </div>
      <Bar frac={p.budget ? p.plan.spent / p.budget : 0} tone="gold" />
      {left > 0 && p.budget > 0 && <p className="text-[11px] text-dim">{t('dae.left', { n: left })}</p>}
    </div>
    {stats.length || skills.length ? (
      <div data-result={p.pool} className="px-2.5 pt-1">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(170px,100%),1fr))] gap-x-3">
          {stats.map(({ i, st, a, b }) => (
            <div key={i} data-tip={`${label(st)}: ${amount(a, st.pct) || 0} → ${amount(b, st.pct)}`}
              className="flex min-h-6 min-w-0 items-center gap-1.5 border-b border-border/40 text-[12px]">
              <i className={cn('size-1.5 flex-none rounded-full', CAT_DOT[statCat(st.key)])} />
              <span className="min-w-0 flex-1 truncate">{label(st)}</span>
              <b className={cn('font-semibold tabular-nums', b > a ? 'text-green' : 'text-red')}>{amount(b - a, st.pct)}</b>
            </div>
          ))}
        </div>
        {skills.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {skills.map(({ i, a, b }) => (
              <span key={i} data-tip={`${label(sk[i])}: +${a} → +${b}`}
                className={cn('inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 text-[11px]', b > a ? 'border-green/30 bg-green/[0.06]' : 'border-red/40 bg-red/[0.08]')}>
                <SkillName sk={sk[i]} /><b className={cn('tabular-nums', b > a ? 'text-green' : 'text-red')}>{(b > a ? '+' : '') + (b - a)}</b>
              </span>
            ))}
          </div>
        )}
      </div>
    ) : <Note className="text-dim">{t('dae.nothing')}</Note>}
  </>
}

/** Node under the mouse in the order list: highlighted on its board. */
const hover = (k: string | null) => { if (V.daeHover !== k) { V.daeHover = k; bump() } }

/** Click order of the new nodes ("add" mode). */
function Order({ p, d, cls }: { p: PoolPlan; d: DaeData; cls: string }) {
  const steps = p.plan.order.filter(i => !p.cur.has(i))
  if (!steps.length) return null
  return <>
    <Sect sub={t('dae.orderTip')}>{t('dae.sect.order')}</Sect>
    <ol className={cn(ROWS, 'text-[12px]')} data-order={p.pool} onMouseLeave={() => hover(null)}>
      {steps.map((i, k) => (
        <li key={i} onMouseEnter={() => hover(p.pool + i)} className={cn(ROW, 'min-h-7 gap-1.5', V.daeHover === p.pool + i && 'bg-gold/10')}>
          <b className="w-6 flex-none text-right text-gold tabular-nums">{k + 1}.</b>
          <span className="w-16 flex-none truncate text-dim">{d.classes[cls].boards[p.refs[i].slot].name}</span>
          <span className="min-w-0 flex-1 truncate">{nodeText(d, cls, p, i)}</span>
          <span className="flex-none text-[11px] text-dim tabular-nums">{p.g.nodes[i].cost}</span>
        </li>
      ))}
    </ol>
  </>
}

function nodeText(d: DaeData, cls: string, p: PoolPlan, i: number) {
  const n = p.refs[i].n
  if (n[3] === 1) return (n[4] as [number, number][]).map(([s, a]) => `${label(d.stats[s])} ${amount(a, d.stats[s].pct)}`).join(', ')
  if (n[3] === 2) return `${label(d.classes[cls].skills[n[4] as number])} +1`
  return 'Start'
}

/** One board as a grid: owned green, new gold (with its click number in "add" mode), reset red, free hollow;
 *  skills round, Unique corners bigger. */
function Board({ p, d, cls, slot, numbers }: { p: PoolPlan; d: DaeData; cls: string; slot: string; numbers: boolean }) {
  const idx = p.refs.map((r, i) => [r, i] as const).filter(([r]) => r.slot === slot)
  const rs = idx.map(([r]) => r.n[0]), cs = idx.map(([r]) => r.n[1])
  const r0 = Math.min(...rs), c0 = Math.min(...cs), rows = Math.max(...rs) - r0 + 1, cols = Math.max(...cs) - c0 + 1
  const step = new Map(p.plan.order.filter(i => !p.cur.has(i)).map((i, k) => [i, k + 1]))
  let spent = 0, max = 0
  for (const [, i] of idx) { max += p.g.nodes[i].cost; if (p.plan.owned.has(i)) spent += p.g.nodes[i].cost }
  const b = d.classes[cls].boards[slot]
  return (
    <div data-board={b.name} className="min-w-0 rounded-sm border bg-card px-2 pt-1.5 pb-2">
      <div className="flex items-baseline justify-between text-[12px]"><b className="font-semibold">{b.name}</b><span className="text-[11px] text-dim tabular-nums">{spent}/{max}</span></div>
      <Bar frac={max ? spent / max : 0} tone="gold" className="mb-1.5" />
      <div className="mx-auto grid max-w-[340px] gap-[2px]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, auto)` }}>
        {idx.map(([r, i]) => {
          const n = r.n, own = p.cur.has(i), plan = p.plan.owned.has(i), st = n[3] === 0 ? 'start' : own && plan ? 'own' : plan ? 'new' : own ? 'drop' : 'free'
          const no = numbers ? step.get(i) : undefined, hot = V.daeHover === p.pool + i
          const tip = [nodeText(d, cls, p, i), n[3] ? t('dae.boardPts', { n: n[2] }) : '', step.get(i) ? `#${step.get(i)}` : ''].filter(Boolean).join(' · ')
          return (
            <span key={i} data-tip={tip} data-node={st} style={{ gridRow: n[0] - r0 + 1, gridColumn: n[1] - c0 + 1 }}
              className={cn('relative grid aspect-square place-items-center border text-[8px] leading-none font-bold text-black/80 tabular-nums',
                n[3] === 2 ? 'rounded-full' : 'rounded-[2px]', n[2] === 4 ? 'scale-110' : n[2] <= 1 && n[3] === 1 && !no ? 'scale-75' : '',
                st === 'start' && 'rotate-45 scale-75 border-gold bg-gold',
                st !== 'start' && SWATCH[st], hot && 'z-10 scale-150 ring-2 ring-foreground')}>
              {no}
            </span>
          )
        })}
      </div>
    </div>
  )
}

const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : 0)

/** Recommendations from the boards the character has now: respec or add, wasted skill levels, MP dead ends. */
function Advice({ d, cls }: { d: DaeData; cls: string }) {
  const list = advice(), s = settings()
  if (!list.length) return null
  const sk = d.classes[cls].skills
  return <>
    <Sect>{t('dae.sect.advice')}</Sect>
    <div data-advice className="flex flex-col gap-1 px-1.5">
      {list.map(a => {
        // same points both ways: how much more a respec gives than only adding the free points
        const more = pct(a.respec, a.add), worth = more >= 3 && a.respec - a.add > 1
        const name = a.pool === 'pve' ? 'Nezekan–Triniel' : d.classes[cls].boards[a.pool === 'ariel' ? '5' : '6']?.name
        const wasted = a.waste.reduce((n, x) => n + x.points, 0) + a.mpPoints
        return (
          <div key={a.pool} data-advice-pool={a.pool} className={cn('rounded-sm border px-2.5 py-1.5 text-[12px] leading-snug', worth ? 'border-gold/40 bg-gold/[0.06]' : 'border-border bg-card')}>
            <div className="flex items-baseline gap-2">
              <b className="font-semibold">{name}</b>
              <span className="ml-auto text-[11px] text-dim">{t('dae.adv.wasted', { n: wasted })}</span>
            </div>
            <p className="mt-0.5 text-muted-foreground">
              {worth ? rich(t('dae.adv.respec', { g: more, r: a.resets, b: a.buys })) : rich(t('dae.adv.keep', { g: more }))}
              {' '}
              {worth && s.mode !== 'respec' && <button className="text-gold underline underline-offset-2" onClick={() => save({ mode: 'respec' })}>{t('dae.adv.show')}</button>}
              {!worth && s.mode !== 'add' && <button className="text-gold underline underline-offset-2" onClick={() => save({ mode: 'add' })}>{t('dae.adv.showAdd')}</button>}
            </p>
            {a.waste.length > 0 && (
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                <span className="text-gold">{t('dae.adv.skills')}</span>{' '}
                {a.waste.map((x, k) => <span key={x.si} data-tip={t('dae.adv.skillTip', { top: x.top, lv: x.level })}>
                  {k > 0 && ' · '}<SkillName sk={sk[x.si]} /> {x.unused ? t('dae.adv.unused', { n: x.extra }) : <>{t('dae.lv', { n: x.level })} (+{x.extra} {t('dae.adv.over', { top: x.top })})</>}
                </span>)}
              </p>
            )}
            {a.mp > 0 && <p className="mt-1 text-[11.5px] text-muted-foreground"><span className="text-gold">MP</span> {t('dae.adv.mp', { n: a.mp, p: a.mpPoints })}</p>}
          </div>
        )
      })}
    </div>
  </>
}

const SWATCH = { own: 'border-green/70 bg-green/60', new: 'border-gold bg-gold/80', drop: 'border-red bg-red/40', free: 'border-white/30' }
function Legend() {
  return <span className="flex flex-wrap gap-x-2.5">{(Object.keys(SWATCH) as (keyof typeof SWATCH)[]).map(k => (
    <span key={k} className="inline-flex items-center gap-1"><i className={cn('size-2 rounded-[2px] border', SWATCH[k])} />{t('dae.st.' + k)}</span>
  ))}</span>
}

/** Skill name in the UI language; in German with the English name (the one players know) small behind it. */
function SkillName({ sk }: { sk: Skill }) {
  return <>{label(sk)}{lang() === 'de' && sk.de !== sk.en && <i className="ml-1 text-[10.5px] text-dim not-italic">{sk.en}</i>}</>
}

/** Per skill: how important (tier), its level without Daevanion, which levels matter (breakpoints) and what the plan
 *  buys ("+2 → 12"). */
function Skills({ d, cls, p }: { d: DaeData; cls: string; p: PoolPlan }) {
  const s = settings(), w = weights(cls), c = d.classes[cls], l = live()
  const bases = skillBases(c, l && l.cls === cls ? l : undefined, w)
  const put = (key: 'tiers' | 'base' | 'bps', en: string, v: unknown) => {
    const m = { ...(s[key][cls] || {}) }
    if (v == null) delete m[en]; else m[en] = v
    save({ [key]: { ...s[key], [cls]: m } })
  }
  const bought = (si: number) => [...p.plan.owned].filter(i => p.refs[i].n[3] === 2 && p.refs[i].n[4] === si).length
  const order = c.skills.map((sk, si) => ({ sk, si })).sort((a, b) => Number(b.sk.active) - Number(a.sk.active) || label(a.sk).localeCompare(label(b.sk)))
  const b = 'grid size-5 flex-none place-items-center rounded-sm border text-[11px] text-muted-foreground hover:border-gold/50 hover:text-gold'
  return <>
    <Sect sub={t('dae.skillsSub')}>{t('dae.sect.skills')}</Sect>
    <div className={ROWS} data-skills>
      {order.map(({ sk, si }) => {
        const tier = w.tiers[sk.en] ?? defaultTier(cls, sk), base = bases[si], own = w.base?.[sk.en] != null
        const bps = skillBps(cls, sk, w), max = tier === 4, k = bought(si)
        // highest breakpoint the plan reaches; levels above it only lie on the way to other nodes
        const b0 = base ?? DEFAULT_BASE, linear = !bps.length, top = linear ? b0 + k : Math.max(0, ...bps.filter(x => x > b0 && x <= b0 + k))
        const used = linear ? k : top ? top - b0 : 0, way = k - used
        return (
          <div key={sk.en} data-skill={sk.en} className="border-b border-border/40 px-2.5 py-1 text-[12.5px]">
            <div className="flex min-w-0 items-center gap-1">
              <span className="min-w-0 flex-1 truncate" data-tip={`${sk.de} · ${sk.en}`}>
                <SkillName sk={sk} /> <i className="text-[10.5px] text-dim not-italic">{t(sk.active ? 'dae.active' : 'dae.passive')}</i>
              </span>
              {TIERS.map(x => (
                <button key={x} data-tip={t('dae.tierTip')} onClick={() => put('tiers', sk.en, x)}
                  className={cn(CHIP, 'h-5 px-1.5 text-[11px]', tier === x && (x ? CHIP_ON : 'border-red/50 bg-red/10 text-foreground'))}>{t('dae.tier.' + x)}</button>
              ))}
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1" data-tip={t('dae.baseTip')}>
                {t('dae.base')}
                <button className={b} onClick={() => put('base', sk.en, Math.max(1, b0 - 1))}>−</button>
                <output data-base data-tip={base == null ? t('dae.baseGuess') : undefined}
                  className={cn('min-w-5 text-center font-semibold tabular-nums', base == null ? 'text-dim italic' : 'text-foreground')}>{b0}</output>
                <button className={b} onClick={() => put('base', sk.en, Math.min(30, b0 + 1))}>+</button>
                {own && <button className="text-dim hover:text-gold" data-tip={t('dae.baseReset')} onClick={() => put('base', sk.en, null)}>↺</button>}
                {!own && base != null && <i className="text-dim not-italic">plaync</i>}
              </span>
              <span className="flex items-center gap-0.5" data-tip={t('dae.bpTip')}>
                {!max && BREAKPOINTS.map(x => {
                  const on = bps.includes(x), spec = sk.spec?.[x]
                  return <button key={x} data-bp={x} data-tip={spec ? t('dae.lv', { n: x }) + ': ' + spec.join(' · ') : undefined} onClick={() => put('bps', sk.en, on ? bps.filter(y => y !== x) : [...bps, x].sort((m, n) => m - n))}
                    className={cn(CHIP, 'h-5 px-1 text-[11px]', on && CHIP_ON, spec && 'underline decoration-dotted underline-offset-2')}>{x}</button>
                })}
                {!bps.length && <i className="ml-1 text-dim not-italic">{t('dae.everyLevel')}</i>}
              </span>
              {k > 0 && <span className="ml-auto flex gap-1.5 font-semibold tabular-nums">
                {used > 0 && <span className="text-green">+{used}{top ? <> → {t('dae.lv', { n: top })}</> : null}</span>}
                {way > 0 && <span className="text-gold" data-tip={t('dae.wayTip')}>{t('dae.way', { n: way })}</span>}
              </span>}
            </div>
          </div>
        )
      })}
    </div>
  </>
}

const MULTS = [0, 0.5, 1, 1.5, 2]
const CAT_TEXT = { off: 'text-red/80', def: 'text-cyan/80', all: 'text-gold/80', util: 'text-dim' } as const
function StatWeights({ d, ps, cls }: { d: DaeData; ps: PoolPlan[]; cls: string }) {
  const s = settings(), w = weights(cls), used = new Set<number>()
  for (const p of ps) for (const r of p.refs) if (r.n[3] === 1) for (const [st] of r.n[4] as [number, number][]) used.add(st)
  const order = ['all', 'off', 'def', 'util']
  const list = [...used].map(i => d.stats[i]).sort((a, b) => order.indexOf(statCat(a.key)) - order.indexOf(statCat(b.key)) || label(a).localeCompare(label(b)))
  return <>
    <Sect sub={t('dae.statsSub')} right={<button className={SECT_BTN} data-stats-toggle onClick={() => save({ showW: !s.showW })}>
      {s.showW ? <ChevronUp /> : <ChevronDown />}{t(s.showW ? 'dae.hide' : 'dae.show')}</button>}>{t('dae.sect.stats')}</Sect>
    {s.showW && <div className={ROWS} data-stats>
      {list.map(st => {
        const m = statMult(st.key, w), cat = statCat(st.key)
        return (
          <div key={st.key} className={cn(ROW, 'min-h-7 gap-1')}>
            <span className="min-w-0 flex-1 truncate">{label(st)} <i className={cn('text-[10.5px] not-italic', CAT_TEXT[cat])}>{t('dae.cat.' + cat)}</i></span>
            {MULTS.map(x => (
              <button key={x} onClick={() => save({ mult: { ...s.mult, [st.key]: x } })} className={cn(CHIP, 'h-5 px-1.5 text-[11px]', m === x && CHIP_ON)}>×{x}</button>
            ))}
          </div>
        )
      })}
    </div>}
  </>
}

/** `nav`: shown at the start of the bar (the private build's Build tab puts its page switch there). */
export function DaevTab({ nav }: { nav?: ReactNode } = {}) {
  useApp()
  const d = data()
  if (d === null) return <Empty>{t('dae.loading')}</Empty>
  if (!d) return <Empty>{t('dae.missing')}</Empty>
  const s = settings(), cls = classId(), c = d.classes[cls], l = live(), ps = plans()
  const hasLive = !!l && l.cls === cls
  const spent = ps.reduce((n, p) => n + p.spentNow, 0)
  const resetCls = () => {
    const tiers = { ...s.tiers }, off = { ...s.off }
    delete tiers[cls]; delete off[cls]
    save({ tiers, off, mult: {} })
  }
  const bar = <>
    {nav}
    <BarInfo>{hasLive ? t('dae.info', { cls: className(c), spent }) : t('dae.infoNoLive', { cls: className(c) })}</BarInfo>
    <BarRight>
      {!hasLive && <AppSelect value={cls} tip={t('dae.class')} className="h-6 text-xs"
        options={Object.entries(d.classes).map(([k, x]) => ({ value: k, label: className(x) }))} onChange={v => save({ cls: v })} />}
      {(['respec', 'add'] as const).map(m => (
        <button key={m} data-mode={m} data-tip={t(`dae.mode.${m}Tip`)} onClick={() => save({ mode: m })} className={cn(CHIP, s.mode === m && CHIP_ON)}>{t('dae.mode.' + m)}</button>
      ))}
    </BarRight>
  </>
  const pve = ps.find(p => p.pool === 'pve')!, open = ps.filter(p => p.slots.length)
  const locked = Object.entries(c.boards).filter(([k]) => !ps.some(p => p.slots.includes(k)))
  const pointsLabel: Record<Pool, string> = { pve: 'dae.freeTotal', ariel: 'dae.arielTotal', pvp: 'dae.pvpTotal' }
  return (
    <Page w="rows" bar={bar}>
      <Columns>
        <div>
          {LIVE && <LiveBlock />}
          <Sect>{t('dae.sect.points')}</Sect>
          <div className={ROWS}>
            {open.map(p => <PointsEdit key={p.pool} dataKey={p.pool} label={t(pointsLabel[p.pool])} value={p.total} spent={hasLive ? p.spentNow : undefined}
              onChange={v => save({ [POOL_KEY[p.pool]]: v })} />)}
          </div>
          <Sect right={<button className={SECT_BTN} data-tip={t('dae.resetTip')} onClick={resetCls}><RotateCcw />{t('dae.reset')}</button>}>{t('dae.sect.goal')}</Sect>
          <GoalSlider cls={cls} />
          {s.mode === 'respec' && hasLive && <Hint>{rich(t('dae.respecHint'))}</Hint>}
          <Advice d={d} cls={cls} />
        </div>
        {open.filter(p => p.budget > 0 || p.spentNow > 0 || p.pool === 'pve').map(p => (
          <div key={p.pool}>
            <Result p={p} d={d} cls={cls} />
            {s.mode === 'add' && <Order p={p} d={d} cls={cls} />}
          </div>
        ))}
      </Columns>
      <Sect sub={<Legend />}>{t('dae.sect.boards')}</Sect>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(230px,100%),1fr))] gap-1.5 px-1.5">
        {open.flatMap(p => p.slots.map(k => <Board key={k} p={p} d={d} cls={cls} slot={k} numbers={s.mode === 'add'} />))}
        {locked.map(([k, b]) => <div key={k} className="grid place-items-center rounded-sm border border-dashed p-3 text-[11.5px] text-dim">{b.name} · {t('dae.locked', { lv: b.level })}</div>)}
      </div>
      <Columns>
        <div><Skills d={d} cls={cls} p={pve} /></div>
        <div><StatWeights d={d} ps={ps} cls={cls} /></div>
      </Columns>
      <Foot>{t('dae.foot', { date: d.date })}</Foot>
    </Page>
  )
}
