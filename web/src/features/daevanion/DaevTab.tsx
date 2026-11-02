import { useEffect, useState, type ReactNode } from 'react'
import { Ban, Check, ChevronDown, ChevronUp, Download, Loader2, MonitorUp, Pin, RefreshCw, RotateCcw, Save, Shield, Sparkles, Swords, Trash2 } from 'lucide-react'
import { U, V, bump, useApp } from '@/core/state'
import { host } from '@/core/host'
import { fmt, lang, t } from '@/core/i18n'
import { AppSelect } from '@/components/AppSelect'
import { Slider } from '@/components/ui/slider'
import { Bar, BarInfo, BarRight, CHIP, CHIP_ON, Chip, Disclosure, Empty, Foot, Hint, Note, Page, Panel, PanelTabs, ROW, ROWS, SECT_BTN, Sect, Seg, Stepper, TopN, rich } from '@/components/kit'
import { cn } from '@/lib/utils'
import {
  LIVE, NONE_HINT, advice, ago, logHits, setLog, breakdown, charKey, charTotals, classId, className, data, forgetLive, live, loadLive, loading,
  marginals, nodeWorth, numbers, overlayBoards, overlayState, pinKey, plans, POOL_KEY, profile, save, settings, skillBases, skillMarginals, toggleDone, togglePin, totals, weights, type PoolPlan,
} from './daevanion'
import { ASSUME, ASSUME_SRC, DAE_KEY, OFF_KEYS, type Assume, type Key, type Mode } from './model'
import { CLASS_DEF, assumeOf, defaultUse, type ClassData, type DaeData, type Skill } from './values'

const label = (o: { en: string; de: string }) => (lang() === 'de' ? o.de : o.en)
const amount = (v: number, pct: boolean) => (v > 0 ? '+' : '') + (pct ? fmt(Math.round(v * 10) / 10) + ' %' : fmt(Math.round(v)))
/** Percent change with sign, two decimals below 1 %. */
const pc = (v: number) => (v >= 0 ? '+' : '−') + fmt(Math.abs(v) < 1 ? Math.round(Math.abs(v) * 100) / 100 : Math.round(Math.abs(v) * 10) / 10) + ' %'
const tone = (v: number) => (v > 0.005 ? 'text-green' : v < -0.005 ? 'text-red' : 'text-dim')

/** Number field: the overlay only takes the keyboard while it has focus (host 'typing'); Enter / leaving commits. */
function NumField({ value, onCommit, className, data: dk }: { value: number; onCommit: (v: number | null) => void; className?: string; data?: string }) {
  const [txt, setTxt] = useState<string | null>(null)
  const commit = () => { if (txt != null) { const v = txt.trim() === '' ? null : Number(txt.replace(',', '.')); if (v == null || isFinite(v)) onCommit(v) } setTxt(null) }
  return (
    <input data-num={dk} value={txt ?? String(Math.round(value * 100) / 100)} inputMode="decimal" spellCheck={false}
      onFocus={() => host({ type: 'typing', on: true })} onBlur={() => { host({ type: 'typing', on: false }); commit() }}
      onChange={e => setTxt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setTxt(null); (e.target as HTMLInputElement).blur() } }}
      className={cn('h-6 w-16 rounded-sm border bg-background/60 px-1.5 text-right text-[12px] text-foreground tabular-nums outline-none focus:border-gold/60', className)} />
  )
}

/** One point pool: name, spent / free (with character data), PvE / PvP, the points. */
function PointsEdit({ label: l, value, onChange, dataKey, spent, mode, onMode }: {
  label: string; value: number; onChange: (v: number) => void; dataKey: string; spent?: number; mode: Mode; onMode: (m: Mode) => void
}) {
  return (
    <div data-points={dataKey} className={cn(ROW, 'gap-1.5')}>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate">{l}</span>
        {spent != null && spent > 0 && <span data-spent className="truncate text-[11px] text-dim tabular-nums">{t('dae.spentFree', { spent, free: Math.max(0, value - spent) })}</span>}
      </span>
      <span data-pmode={dataKey} data-tip={t('dae.pmodeTip')}>
        <Seg size="sm" value={mode} onChange={onMode} item={m => ({ 'data-pm': m })} options={[{ value: 'pve', label: 'PvE' }, { value: 'pvp', label: 'PvP' }]} />
      </span>
      <Stepper value={value} onChange={onChange} big={10} />
    </div>
  )
}

const PRESETS = [['dmg', 1], ['both', 0.6], ['def', 0.2]] as const

/** Goal: presets (segmented) and the slider survival ↔ damage for fine tuning. */
function Goal({ cls }: { cls: string }) {
  const w = weights(cls), [drag, setDrag] = useState<number | null>(null), v = drag ?? w.off, s = settings()
  const setOff = (x: number) => save({ off: { ...s.off, [cls]: x } })
  const preset = PRESETS.find(([, x]) => Math.abs(w.off - x) < 0.001)?.[0] ?? ''
  return (
    <div className="px-2.5 pt-1.5 pb-2">
      <Seg value={preset as 'dmg'} onChange={k => setOff(PRESETS.find(([x]) => x === k)![1])} item={k => ({ 'data-preset': k })}
        options={PRESETS.map(([k]) => ({ value: k, label: t('dae.preset.' + k) }))} />
      <div className="mt-2 flex items-center gap-2 text-[11.5px] text-muted-foreground">
        <span className="flex-none">{t('dae.def')}</span>
        <Slider data-goal min={0} max={100} step={5} value={[Math.round(v * 100)]} className="flex-1"
          onValueChange={x => setDrag((Array.isArray(x) ? x[0] : x) / 100)}
          onValueCommitted={x => { setDrag(null); setOff((Array.isArray(x) ? x[0] : x) / 100) }} />
        <span className="flex-none">{t('dae.atk')}</span>
        <span className="w-12 flex-none text-right text-[11px] text-dim tabular-nums">{Math.round(v * 100)}:{Math.round((1 - v) * 100)}</span>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[11.5px] text-muted-foreground" data-tip={t('dae.pctTip')}>
        <span className="min-w-0 flex-1 truncate">{t('dae.pctW')}</span>
        <Seg size="sm" value={String(w.pctW)} onChange={x => save({ pctW: { ...s.pctW, [cls]: +x } })} item={x => ({ 'data-pctw': x })}
          options={[{ value: '1', label: t('dae.pct.1') }, { value: '1.5', label: t('dae.pct.15') }, { value: '2', label: t('dae.pct.2') }]} />
      </div>
    </div>
  )
}

/** Character: one line (who, where the data comes from, Combat Power), reload / forget at the right. */
function LiveBlock() {
  const char = charKey(), p = profile(char), l = live(char), busy = loading.has(char)
  const cp = l?.cp || [], last = cp.at(-1), prev = cp.at(-2)
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-0.5 px-2.5 py-1 text-[12px]" data-live>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {!p ? t(NONE_HINT) : <><b className="font-semibold text-foreground">{p.name}</b>{l && <> · {t(l.game ? 'dae.liveGame' : 'dae.live', { age: ago(l.at) })}</>}</>}
      </span>
      {last && <span data-cp className="text-muted-foreground tabular-nums" data-tip={t('dae.cpTip')}>
        {t('dae.cp')} <b className="font-semibold text-foreground">{fmt(last[1])}</b>
        {prev && <span className={cn('ml-1', tone(last[1] - prev[1]))}>{(last[1] >= prev[1] ? '+' : '') + fmt(last[1] - prev[1])}</span>}
      </span>}
      {p && <span className="flex gap-0.5">
        <button className={SECT_BTN} disabled={busy} data-tip={t('dae.liveLoadTip')} onClick={() => loadLive(char)}>
          {l ? <RefreshCw /> : <Download />}{busy ? t('dae.liveBusy') : l ? t('dae.liveReload') : t('dae.liveLoad')}
        </button>
        {l && <button className={SECT_BTN} data-tip={t('dae.liveForget')} onClick={() => forgetLive(char)}><Trash2 /></button>}
      </span>}
      <PacketLog />
    </div>
  )
}

/** Research: frames with node ids, logged on their own while the tab is open (daevanion-packets.log); shown once some
 *  came in. */
function PacketLog() {
  const hits = logHits(), ops = [...new Set(hits.map(h => h.op))]
  if (!hits.length) return null
  return <div data-dae-log className="px-2.5 pb-1 text-[11px] text-dim tabular-nums">{t('dae.log.hits', { n: hits.length, ops: ops.join(', ') })}</div>
}

const CAT_DOT = { off: 'bg-red/80', def: 'bg-cyan/80', none: 'bg-dim' } as const
const cat = (stKey: string) => { const k = DAE_KEY[stKey]; return !k ? 'none' : OFF_KEYS.has(k) ? 'off' : 'def' }

/** Damage / EHP pair. */
function DE({ dmg, ehp, heal, className }: { dmg: number; ehp: number; heal?: number; className?: string }) {
  return <span className={cn('flex gap-2 tabular-nums', className)}>
    <span className={tone(dmg)} data-tip={t('dae.dmgTip')}>{t('dae.dmgShort')} {pc(dmg)}</span>
    {heal != null && Math.abs(heal) > 0.005 && <span className={tone(heal)}>{t('dae.healShort')} {pc(heal)}</span>}
    <span className={tone(ehp)} data-tip={t('dae.ehpTip')}>{t('dae.ehpShort')} {pc(ehp)}</span>
  </span>
}

/** Damage / EHP as two fixed columns (tables: the header says which is which); a thin bar shows the size. */
function Vals({ dmg, ehp, max = 0 }: { dmg: number; ehp: number; max?: number }) {
  const cell = (v: number) => (
    <span className="relative w-[4.6rem] flex-none text-right">
      {max > 0 && Math.abs(v) > 0.005 && <i className={cn('absolute right-0 -bottom-px h-[2px] rounded-full', v > 0 ? 'bg-green/50' : 'bg-red/50')} style={{ width: `${Math.min(100, Math.abs(v) / max * 100)}%` }} />}
      <span className={tone(v)}>{Math.abs(v) > 0.005 ? pc(v) : '·'}</span>
    </span>
  )
  return <span className="flex flex-none gap-1 text-[11.5px] tabular-nums">{cell(dmg)}{cell(ehp)}</span>
}
function ValHead({ children }: { children?: ReactNode }) {
  return (
    <div className="flex min-h-6 items-center gap-2 px-2.5 text-[10.5px] tracking-wide text-dim uppercase">
      <span className="min-w-0 flex-1 truncate normal-case tracking-normal">{children}</span>
      <span className="flex flex-none gap-1"><span className="w-[4.6rem] text-right">{t('dae.dmgShort')}</span><span className="w-[4.6rem] text-right">{t('dae.ehpShort')}</span></span>
    </div>
  )
}
const maxOf = (rows: { dmg: number; ehp: number }[]) => Math.max(0.01, ...rows.flatMap(r => [Math.abs(r.dmg), Math.abs(r.ehp)]))

/** Big numbers of a plan: damage, healing (healers), effective HP. */
function Tiles({ dmg, ehp, heal, sub }: { dmg: number; ehp: number; heal?: number; sub?: { dmg: number; ehp: number } }) {
  const tile = (name: string, v: number, s: number | undefined, tip: string) => (
    <div className="min-w-0 flex-1 rounded-sm border bg-card px-2 py-1" data-tip={tip}>
      <div className="text-[10.5px] tracking-wide text-dim uppercase">{name}</div>
      <div className={cn('text-[17px] leading-tight font-semibold tabular-nums', tone(v))}>{pc(v)}</div>
      {s != null && <div className={cn('text-[10.5px] tabular-nums', tone(s))}>{t('dae.vsNowShort', { v: pc(s) })}</div>}
    </div>
  )
  return (
    <div className="flex gap-1.5 px-2.5 pb-1">
      {tile(t('dae.dmgShort'), dmg, sub?.dmg, t('dae.dmgTip'))}
      {heal != null && Math.abs(heal) > 0.005 && tile(t('dae.healShort'), heal, undefined, t('dae.dmgTip'))}
      {tile(t('dae.ehpShort'), ehp, sub?.ehp, t('dae.ehpTip'))}
    </div>
  )
}

/** The answer first: what the plan of the shown board's pool gives (big numbers), points used, nodes to buy / reset. */
function Summary({ p, d, cls, hasLive }: { p: PoolPlan; d: DaeData; cls: string; hasLive: boolean }) {
  const added = [...p.plan.owned].filter(i => !p.cur.has(i)).length, removed = [...p.cur].filter(i => !p.plan.owned.has(i)).length
  const nPlan = numbers(p, p.plan.owned), nNow = numbers(p, p.cur)
  const pool = p.slots.map(x => d.classes[cls].boards[x].name).join(' · ')
  return (
    <Panel title={t('dae.sect.result')} sub={<>{pool} · {p.mode === 'pve' ? 'PvE' : 'PvP'}</>}
      right={p.pending && <span data-pending className="flex items-center gap-1 text-[11px] text-dim"><Loader2 className="size-3 animate-spin" />{t('dae.searching')}</span>}>
      <div data-gain={p.pool} data-result={p.pool}>
        <Tiles dmg={nPlan.dmg} ehp={nPlan.ehp} heal={nPlan.heal}
          sub={p.spentNow > 0 ? { dmg: ((1 + nPlan.dmg / 100) / (1 + nNow.dmg / 100) - 1) * 100, ehp: ((1 + nPlan.ehp / 100) / (1 + nNow.ehp / 100) - 1) * 100 } : undefined} />
      </div>
      <div className="px-2.5 pb-2">
        <div className="flex items-baseline justify-between gap-2 text-[12px]">
          <span className="text-muted-foreground">{t('dae.used', { n: p.plan.spent, total: p.budget })}</span>
          <span className="flex gap-2 text-[11.5px] tabular-nums">
            {added > 0 && <span className="text-gold">{t('dae.add', { n: added })}</span>}
            {removed > 0 && <span className="text-red">{t('dae.remove', { n: removed })}</span>}
          </span>
        </div>
        <Bar frac={p.budget ? p.plan.spent / p.budget : 0} tone="gold" />
        <p className="text-[11px] text-dim">{hasLive ? t('dae.planGives') : rich(t('dae.noCharShort'))}</p>
      </div>
    </Panel>
  )
}

/** Where the plan's value comes from: per stat and skill what the plan loses without it (panel). */
function Why({ p, d, cls }: { p: PoolPlan; d: DaeData; cls: string }) {
  if (!p.plan.owned.size || p.plan.owned.size <= p.g.starts.length) return <Note className="text-dim">{t('dae.nothing')}</Note>
  const b = breakdown(p.inp, p.plan.owned), w = p.inp.w
  const name = (key: Key) => { const st = d.stats.find(x => DAE_KEY[x.key] === key); return st ? label(st) : key }
  const rows = [
    ...b.stats.map(x => ({ id: 's' + x.k, text: name(x.k), dmg: x.dmg, ehp: x.ehp })),
    ...b.skills.map(x => ({ id: 'k' + x.si, text: <><SkillName sk={d.classes[cls].skills[x.si]} /> +{x.n}</>, dmg: x.dmg, ehp: x.ehp })),
  ].map(r => ({ ...r, v: w * r.dmg + (1 - w) * r.ehp })).filter(r => Math.abs(r.dmg) + Math.abs(r.ehp) > 0.001).sort((x, y) => y.v - x.v)
  return (
    <div data-why={p.pool}>
      <Note className="text-dim">{t('dae.whySub')}</Note>
      <ValHead />
      <div className={ROWS}>
        {rows.slice(0, 24).map(r => (
          <div key={r.id} className={cn(ROW, 'min-h-6 text-[12px]')}>
            <span className="min-w-0 flex-1 truncate">{r.text}</span>
            <Vals dmg={r.dmg} ehp={r.ehp} max={maxOf(rows)} />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Node under the mouse in the order list: highlighted on its board. */
const hover = (k: string | null) => { if (V.daeHover !== k) { V.daeHover = k; bump() } }

/** Click order of the new nodes ("add" mode). */
function Order({ p, d, cls }: { p: PoolPlan; d: DaeData; cls: string }) {
  const steps = p.plan.order.filter(i => !p.cur.has(i))
  if (!steps.length) return null
  const worth = nodeWorth(p), done: string[] = settings().done[charKey()] || [], s = settings()
  const isDone = (i: number) => done.includes(pinKey(p.refs[i])), next = steps.find(i => !isDone(i)), n = steps.filter(isDone).length
  return <>
    <Sect sub={t('dae.orderTip')} right={n > 0 && <button className={SECT_BTN} data-done-reset onClick={() => save({ done: { ...s.done, [charKey()]: [] } })}><RotateCcw />{t('dae.doneReset')}</button>}>
      {t('dae.sect.order')} <span className="ml-1 text-gold tabular-nums">{n}/{steps.length}</span>
    </Sect>
    <ol className={cn(ROWS, 'text-[12px]')} data-order={p.pool} onMouseLeave={() => hover(null)}>
      {steps.map((i, k) => {
        const ok = isDone(i)
        return (
          <li key={i} data-step={ok ? 'done' : i === next ? 'next' : 'open'} onMouseEnter={() => hover(p.pool + i)} onClick={() => toggleDone(pinKey(p.refs[i]))}
            className={cn(ROW, 'min-h-7 cursor-pointer gap-1.5', ok && 'opacity-45', i === next && 'bg-gold/[0.07]', V.daeHover === p.pool + i && 'bg-gold/10')}>
            <span className={cn('grid size-4 flex-none place-items-center rounded-[3px] border [&_svg]:size-3', ok ? 'border-green bg-green/30 text-green' : i === next ? 'border-gold' : 'border-foreground/25')}>{ok && <Check />}</span>
            <b className={cn('w-6 flex-none text-right tabular-nums', ok ? 'text-dim' : 'text-gold')}>{k + 1}.</b>
            <span className="w-16 flex-none truncate text-dim">{d.classes[cls].boards[p.refs[i].slot].name}</span>
            <span className={cn('min-w-0 flex-1 truncate', ok && 'line-through')}>{nodeText(d, cls, p, i)}</span>
            <span className="flex-none text-[11px] text-dim tabular-nums">{worthText(worth[i])}</span>
            <span className="flex-none text-[11px] text-dim tabular-nums">{p.g.nodes[i].cost}</span>
          </li>
        )
      })}
    </ol>
  </>
}

const worthText = (x: { dmg: number; ehp: number }) => [Math.abs(x.dmg) > 0.005 && `${t('dae.dmgShort')} ${pc(x.dmg)}`, Math.abs(x.ehp) > 0.005 && `${t('dae.ehpShort')} ${pc(x.ehp)}`].filter(Boolean).join(' · ') || t('dae.noValue')

function nodeText(d: DaeData, cls: string, p: PoolPlan, i: number) {
  const n = p.refs[i].n
  if (n[3] === 1) return (n[4] as [number, number][]).map(([s, a]) => `${label(d.stats[s])} ${amount(a, d.stats[s].pct)}`).join(', ')
  if (n[3] === 2) return `${label(d.classes[cls].skills[n[4] as number])} +1`
  return 'Start'
}

const ICON_URL = (icon: string) => `https://assets.playnccdn.com/static-aion2-gamedata/resources/${icon}.png`
/** Skill icon from NCSOFT's CDN (file name via aion2data); without one the initials. */
function SkillIcon({ sk, className }: { sk: Skill; className?: string }) {
  const [bad, setBad] = useState(false)
  if (sk.icon && !bad) return <img src={ICON_URL(sk.icon)} alt="" draggable={false} loading="lazy" onError={() => setBad(true)} className={cn('block rounded-[3px] object-cover', className)} />
  return <span className={cn('grid place-items-center rounded-[3px] bg-accent text-[9px] font-semibold text-muted-foreground', className)}>{sk.en.split(/\s+/).map(w => w[0]).join('').slice(0, 2)}</span>
}

/** Node state: owned now and kept, new in the plan, reset by the plan, free. */
const nodeState = (p: PoolPlan, i: number) => { const own = p.cur.has(i), plan = p.plan.owned.has(i); return own && plan ? 'own' : plan ? 'new' : own ? 'drop' : 'free' }
const RING = { own: 'border-green/80', new: 'border-gold shadow-[0_0_8px_-1px_var(--color-gold)]', drop: 'border-red', free: 'border-foreground/10' } as const
const GRADE = ['', 'border-foreground/25', 'border-cyan/50', 'border-gold/60', 'border-red/60']

/** One board, big: skill nodes with their icon, stat nodes as tiles (red = damage, cyan = defense), the start a
 *  diamond. Owned green, new gold (with its click number in "add" mode), reset red, the rest dimmed. */
function Board({ p, d, cls, slot, numbers: nums }: { p: PoolPlan; d: DaeData; cls: string; slot: string; numbers: boolean }) {
  const idx = p.refs.map((r, i) => [r, i] as const).filter(([r]) => r.slot === slot)
  const rs = idx.map(([r]) => r.n[0]), cs = idx.map(([r]) => r.n[1])
  const r0 = Math.min(...rs), c0 = Math.min(...cs), rows = Math.max(...rs) - r0 + 1, cols = Math.max(...cs) - c0 + 1
  const step = new Map(p.plan.order.filter(i => !p.cur.has(i)).map((i, k) => [i, k + 1]))
  const worth = nodeWorth(p), b = d.classes[cls].boards[slot], sk = d.classes[cls].skills
  const pins: Record<string, number> = settings().pin[cls] || {}, done: string[] = settings().done[charKey()] || []
  return (
    <div data-board={b.name} className="mx-auto grid w-full max-w-[520px] gap-[3px] self-start rounded-sm border bg-card p-2"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, auto)` }}>
      {idx.map(([r, i]) => {
        const n = r.n, st = n[3] === 0 ? 'start' : nodeState(p, i), no = nums ? step.get(i) : undefined, hot = V.daeHover === p.pool + i
        const key = pinKey(r), pin = pins[key], ticked = nums && st === 'new' && done.includes(key)
        // bought only to get through: worth (almost) nothing on its own
        const path = (st === 'new' || st === 'own') && n[3] !== 0 && Math.abs(worth[i].dmg) < 0.02 && Math.abs(worth[i].ehp) < 0.02
        const tip = n[3] ? [nodeText(d, cls, p, i), path ? t('dae.pathTip') : worthText(worth[i]), t('dae.boardPts', { n: n[2] }), step.get(i) ? `#${step.get(i)}` : '', t(pin === 1 ? 'dae.pin.want' : pin === -1 ? 'dae.pin.never' : 'dae.pin.tip')].filter(Boolean).join(' · ') : 'Start'
        const pos = { gridRow: n[0] - r0 + 1, gridColumn: n[1] - c0 + 1 }
        if (st === 'start') return <span key={i} data-node="start" data-tip={tip} style={pos} className="grid aspect-square place-items-center"><i className="size-1/2 rotate-45 rounded-[2px] bg-gold shadow-[0_0_10px_var(--color-gold)]" /></span>
        const c = n[3] === 1 ? cat(d.stats[(n[4] as [number, number][])[0][0]].key) : null
        const Icon = c === 'off' ? Swords : c === 'def' ? Shield : Sparkles
        return (
          <button key={i} data-tip={tip} data-node={st} data-path={path ? 'on' : undefined} data-pin={pin === 1 ? 'want' : pin === -1 ? 'never' : undefined} style={pos} onClick={() => togglePin(cls, key)}
            className={cn('relative grid aspect-square cursor-pointer place-items-center overflow-hidden rounded-[4px] border-2 bg-background/70 transition-[opacity,filter] hover:brightness-125',
              st === 'free' ? cn(GRADE[n[2]], pin === -1 ? 'opacity-25' : 'opacity-40 grayscale') : ticked ? 'border-green/80 opacity-60' : path ? 'border-dashed border-gold/50 opacity-60 shadow-none' : RING[st as keyof typeof RING],
              n[2] <= 1 && n[3] === 1 && 'scale-[0.82]', hot && 'z-10 scale-125 ring-2 ring-foreground')}>
            {n[3] === 2 ? <SkillIcon sk={sk[n[4] as number]} className="size-full" />
              : <Icon className={cn('size-[55%]', c === 'off' ? 'text-red/85' : c === 'def' ? 'text-cyan/85' : 'text-dim', n[2] === 4 && 'size-[65%] text-gold')} strokeWidth={2.2} />}
            {no != null && !ticked && <b className="absolute right-0 bottom-0 rounded-tl-[3px] bg-gold px-[2px] text-[8px] leading-tight font-bold text-primary-foreground tabular-nums">{no}</b>}
            {ticked && <Check className="absolute size-[60%] text-green drop-shadow" strokeWidth={3} />}
            {pin === 1 && <Pin className="absolute top-0 left-0 size-[38%] rounded-br-[3px] bg-gold p-[1px] text-primary-foreground" strokeWidth={2.5} />}
            {pin === -1 && <Ban className="absolute size-[70%] text-red" strokeWidth={2.5} />}
          </button>
        )
      })}
    </div>
  )
}

/** Skill levels and stat totals the plan has on one board (the side panel), with the change against now. */
function BoardSide({ p, d, cls, slot }: { p: PoolPlan; d: DaeData; cls: string; slot: string }) {
  const c = d.classes[cls], b = c.boards[slot]
  const set = new Set([...p.plan.owned].filter(i => p.refs[i].slot === slot)), now = new Set([...p.cur].filter(i => p.refs[i].slot === slot))
  const tp = totals(p, set), tn = totals(p, now)
  const skills = [...tp.skills].sort((x, y) => y[1] - x[1] || label(c.skills[x[0]]).localeCompare(label(c.skills[y[0]])))
  const stats = [...tp.stats].sort((x, y) => cat(d.stats[x[0]].key).localeCompare(cat(d.stats[y[0]].key)) || x[0] - y[0])
  let spent = 0, max = 0
  p.refs.forEach((r, i) => { if (r.slot === slot) { max += p.g.nodes[i].cost; if (set.has(i)) spent += p.g.nodes[i].cost } })
  const hasNow = p.cur.size > p.g.starts.length
  const delta = (a: number, was: number, pct: boolean) => hasNow && a !== was && <i className={cn('ml-1 text-[10.5px] not-italic', a > was ? 'text-green' : 'text-red')}>{amount(a - was, pct)}</i>
  const sub = (en: string, de: string) => lang() === 'de' && en !== de && <span className="truncate text-[10.5px] text-dim">{en}</span>
  return (
    <div data-board-side={b.name} className="min-w-0">
      <div className="flex items-baseline justify-between rounded-md border bg-card px-2.5 py-1.5">
        <b className="text-[13px] font-semibold">{b.name}</b><span className="text-[11px] text-dim tabular-nums">{t('dae.boardOf', { n: spent, max })}</span>
      </div>
      <p className="px-2.5 pt-1 text-[11.5px] text-muted-foreground">{rich(t('dae.poolPts', { pool: t('dae.pool.' + p.pool), n: [...p.plan.owned].reduce((x, i) => x + p.g.nodes[i].cost, 0) }))}</p>
      <Sect>{t('dae.sideSkills')}</Sect>
      {skills.length ? <div className={ROWS}>
        <TopN id="dae.side.skills" items={skills} n={5} more={k => t('dae.moreN', { n: k })} render={([si, k]) => (
          <div key={si} className={cn(ROW, 'min-h-8 gap-2')}>
            <SkillIcon sk={c.skills[si]} className="size-6 flex-none" />
            <span className="flex min-w-0 flex-1 flex-col leading-tight"><span className="truncate text-[12px]">{label(c.skills[si])}</span>{sub(c.skills[si].en, c.skills[si].de)}</span>
            <b className="font-semibold text-gold tabular-nums">+{k}{delta(k, tn.skills.get(si) || 0, false)}</b>
          </div>
        )} />
      </div> : <Note className="text-dim">{t('dae.nothing')}</Note>}
      <Sect>{t('dae.sideStats')}</Sect>
      {stats.length ? <div className={ROWS}>
        <TopN id="dae.side.stats" items={stats} n={5} more={k => t('dae.moreN', { n: k })} render={([i, a]) => (
          <div key={i} className={cn(ROW, 'min-h-8 gap-2')}>
            <i className={cn('size-1.5 flex-none rounded-full', CAT_DOT[cat(d.stats[i].key)])} />
            <span className="flex min-w-0 flex-1 flex-col leading-tight"><span className="truncate text-[12px]">{label(d.stats[i])}</span>{sub(d.stats[i].en, d.stats[i].de)}</span>
            <b className="font-semibold text-gold tabular-nums">{amount(a, d.stats[i].pct)}{delta(a, tn.stats.get(i) || 0, d.stats[i].pct)}</b>
          </div>
        )} />
      </div> : <Note className="text-dim">{t('dae.nothing')}</Note>}
    </div>
  )
}

/** In-game marks: on while this tab is open (no click needed), the switch turns them off; the status says what the
 *  host sees. */
function InGame({ d, cls, ps }: { d: DaeData; cls: string; ps: PoolPlan[] }) {
  const s = settings(), on = s.overlay !== false, st = overlayState()
  const payload = JSON.stringify(on ? overlayBoards(d, cls, ps, s.mode) : [])
  useEffect(() => { setLog(true); return () => { setLog(false); host({ type: 'daeOverlay', on: false, boards: [] }) } }, [])
  useEffect(() => { host({ type: 'daeOverlay', on, boards: JSON.parse(payload) }) }, [on, payload])
  const text = !on ? t('dae.ov.offText') : t('dae.ov.' + (st.state === 'off' ? 'search' : st.state), { board: st.slot ? d.classes[cls].boards[st.slot]?.name ?? '' : '' })
  const dot = !on ? 'bg-dim' : st.state === 'found' ? 'bg-green' : st.state === 'black' || st.state === 'error' ? 'bg-red' : 'bg-gold'
  return (
    <div data-ingame={on ? st.state : 'off'} className="mx-1.5 mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-background/40 px-2.5 py-1 text-[12px]">
      <MonitorUp className="size-3.5 flex-none text-muted-foreground" />
      <b className="font-semibold">{t('dae.ov.title')}</b>
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-muted-foreground"><i className={cn('size-1.5 flex-none rounded-full', dot)} /><span className="min-w-0">{text}</span></span>
      {on && st.state !== 'found' && st.state !== 'off' && <button className={SECT_BTN} data-tip={t('dae.ov.dumpTip')} onClick={() => host({ type: 'daeOverlayDump' })}><Save />{t('dae.ov.dump')}</button>}
      <Chip data-ingame-toggle on={on} onChange={x => save({ overlay: x })} className="h-5 px-1.5 text-[11px]">{t(on ? 'dae.ov.on' : 'dae.ov.off')}</Chip>
    </div>
  )
}


/** The board shown: the one open in the game (overlay), else the tile the player picked, else the first one usable. */
function selectedSlot(c: ClassData, ps: PoolPlan[]) {
  const s = settings(), poolOf = (slot: string) => ps.find(p => p.slots.includes(slot))
  const slots = Object.keys(c.boards).sort((a, b) => c.boards[a].level - c.boards[b].level || +a - +b)
  const want = V.daeBoardGame && poolOf(V.daeBoardGame) ? V.daeBoardGame : s.open.board
  return slots.includes(want) && poolOf(want) ? want : slots.find(k => poolOf(k)) ?? slots[0]
}

/** Boards: one tile per board (planned / all points, unlock level), the chosen board big with its side
 *  panel. */
function Boards({ d, cls, ps }: { d: DaeData; cls: string; ps: PoolPlan[] }) {
  const s = settings(), c = d.classes[cls], poolOf = (slot: string) => ps.find(p => p.slots.includes(slot))
  const slots = Object.keys(c.boards).sort((a, b) => c.boards[a].level - c.boards[b].level || +a - +b)
  const sel = selectedSlot(c, ps)
  const p = poolOf(sel)
  const pts = (slot: string) => {
    const q = poolOf(slot)
    let spent = 0, max = 0
    if (q) q.refs.forEach((r, i) => { if (r.slot === slot) { max += q.g.nodes[i].cost; if (q.plan.owned.has(i)) spent += q.g.nodes[i].cost } })
    else max = c.boards[slot].nodes.reduce((n, x) => n + x[2], 0)
    return { spent, max }
  }
  return <Panel title={t('dae.sect.boards')} sub={<Legend />} data-boards>
    <InGame d={d} cls={cls} ps={ps} />
    <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-1 px-1.5" data-board-tabs>
      {slots.map(k => {
        const b = c.boards[k], q = poolOf(k), x = pts(k)
        return (
          <button key={k} data-board-tab={b.name} disabled={!q} onClick={() => { V.daeBoardGame = null; save({ open: { ...s.open, board: k } }) }}
            className={cn('flex min-w-0 flex-col rounded-md border bg-background/40 px-2 py-1 text-left transition-colors', q ? 'hover:border-gold/40' : 'opacity-45',
              k === sel && 'border-gold/70 bg-gold/[0.07]')}>
            <b className="truncate text-[12px] font-semibold">{b.name}</b>
            <span className="text-[11px] font-semibold text-gold tabular-nums">{x.spent} / {x.max}</span>
            <span className="text-[10.5px] text-dim">{q ? t('dae.fromLv', { lv: b.level }) : t('dae.locked', { lv: b.level })}</span>
          </button>
        )
      })}
    </div>
    {p && <div className="grid gap-2 px-1.5 py-1.5 @min-[760px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <Board p={p} d={d} cls={cls} slot={sel} numbers={s.mode === 'add'} />
      <div className="min-w-0">
        <BoardSide p={p} d={d} cls={cls} slot={sel} />
        {s.mode === 'add' && <Order p={p} d={d} cls={cls} />}
      </div>
    </div>}
  </Panel>
}

/** Recommendations from the boards the character has now: respec or add, nodes without value. */
function Advice({ d, cls }: { d: DaeData; cls: string }) {
  const list = advice(), s = settings()
  if (!list.length) return null
  return <>
    <div data-advice className="flex flex-col gap-1 px-1.5 pt-1.5">
      {list.map(a => {
        // same points both ways: how much more a respec gives than only adding the free points (score ≈ percent)
        const more = Math.round((a.respec - a.add) * 10) / 10, worth = more >= 1
        const name = a.pool === 'pve' ? 'Nezekan–Triniel' : d.classes[cls].boards[a.pool === 'ariel' ? '5' : '6']?.name
        return (
          <div key={a.pool} data-advice-pool={a.pool} className={cn('rounded-md border px-2.5 py-1.5 text-[12px] leading-snug', worth ? 'border-gold/40 bg-gold/[0.06]' : 'border-border bg-card')}>
            <div className="flex items-baseline gap-2">
              <b className="font-semibold">{name}</b>
              {a.dead > 0 && <span className="ml-auto text-[11px] text-dim">{t('dae.adv.wasted', { n: a.deadPoints })}</span>}
            </div>
            <p className="mt-0.5 text-muted-foreground">
              {worth ? rich(t('dae.adv.respec', { g: fmt(more), r: a.resets, b: a.buys })) : rich(t('dae.adv.keep', { g: fmt(Math.max(0, more)) }))}
              {' '}
              {worth && s.mode !== 'respec' && <button className="text-gold underline underline-offset-2" onClick={() => save({ mode: 'respec' })}>{t('dae.adv.show')}</button>}
              {!worth && s.mode !== 'add' && <button className="text-gold underline underline-offset-2" onClick={() => save({ mode: 'add' })}>{t('dae.adv.showAdd')}</button>}
            </p>
            {a.dead > 0 && <p className="mt-1 text-[11.5px] text-muted-foreground">{t('dae.adv.dead', { n: a.dead, p: a.deadPoints })}</p>}
          </div>
        )
      })}
    </div>
  </>
}

const SWATCH = { own: 'border-green/80 bg-green/30', new: 'border-gold bg-gold/40', path: 'border-dashed border-gold/60 bg-transparent', drop: 'border-red bg-red/30', free: 'border-foreground/20 bg-background' }
function Legend() {
  return <span className="flex flex-wrap gap-x-2.5">{(Object.keys(SWATCH) as (keyof typeof SWATCH)[]).map(k => (
    <span key={k} className="inline-flex items-center gap-1"><i className={cn('size-2 rounded-[2px] border', SWATCH[k])} />{t('dae.st.' + k)}</span>
  ))}</span>
}

/** Skill name in the UI language; in German with the English name (the one players know) small behind it. */
function SkillName({ sk }: { sk: Skill }) {
  return <>{label(sk)}{lang() === 'de' && sk.de !== sk.en && <i className="ml-1 text-[10.5px] text-dim not-italic">{sk.en}</i>}</>
}

/** Per skill: used in the rotation, its share, its level without Daevanion, what +1 level gives, the
 *  specializations and what the plan buys. */
function Skills({ d, cls, p }: { d: DaeData; cls: string; p: PoolPlan }) {
  const s = settings(), w = weights(cls), c = d.classes[cls], l = live()
  const bases = skillBases(c, l && l.cls === cls ? l : undefined, w), marg = skillMarginals(p)
  const put = (key: 'use' | 'base', en: string, v: unknown) => {
    const m = { ...(s[key][cls] || {}) }
    if (v == null) delete m[en]; else m[en] = v
    save({ [key]: { ...s[key], [cls]: m } })
  }
  const bought = (si: number) => [...p.plan.owned].filter(i => p.refs[i].n[3] === 2 && p.refs[i].n[4] === si).length
  const order = c.skills.map((sk, si) => ({ sk, si })).sort((a, b) => (p.inp.ctx.skills[b.si].w - p.inp.ctx.skills[a.si].w) || Number(b.sk.active) - Number(a.sk.active) || label(a.sk).localeCompare(label(b.sk)))
  const b = 'grid size-5 flex-none place-items-center rounded-sm border text-[11px] text-muted-foreground hover:border-gold/50 hover:text-gold'
  return <>
    <Note className="text-dim">{t('dae.skillsSub')}</Note>
    <div className={ROWS} data-skills>
      {order.map(({ sk, si }) => {
        const used = w.use[sk.en] ?? defaultUse(cls, sk), base = bases[si], k = bought(si), m = marg[si], sw = p.inp.ctx.skills[si].w
        const known = !!(sk.dmg || sk.fx), lvNow = p.inp.lv[si] + k
        return (
          <div key={sk.en} data-skill={sk.en} className={cn('border-b border-border/40 px-2.5 py-1 text-[12.5px]', !used && 'opacity-60')}>
            <div className="flex min-w-0 items-center gap-1.5">
              <SkillIcon sk={sk} className="size-6 flex-none" />
              <span className="min-w-0 flex-1 truncate" data-tip={sk.dmg ? t(sk.dmg.kind === 'heal' ? 'dae.skHeal' : 'dae.skDmg', { f: fmt(Math.round(sk.dmg.flat[9] ?? 0)), p: sk.dmg.pct, cd: sk.cd ?? 0 }) : sk.fx ? sk.fx.cols.join(' · ') : t('dae.skNoData')}>
                <SkillName sk={sk} /> <i className="text-[10.5px] text-dim not-italic">{t(sk.active ? 'dae.active' : 'dae.passive')}</i>
              </span>
              {sw > 0 && <span className="text-[11px] text-dim tabular-nums" data-tip={t('dae.shareTip')}>{fmt(Math.round(sw * 1000) / 10)} %</span>}
              <button data-use={used ? 'on' : 'off'} data-tip={t('dae.useTip')} onClick={() => put('use', sk.en, !used)}
                className={cn(CHIP, 'h-5 px-1.5 text-[11px]', used ? CHIP_ON : 'border-red/50 bg-red/10 text-foreground')}>{t(used ? 'dae.used.on' : 'dae.used.off')}</button>
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1" data-tip={t('dae.baseTip')}>
                {t('dae.base')}
                <button className={b} onClick={() => put('base', sk.en, Math.max(1, base.lv - 1))}>−</button>
                <output data-base data-tip={base.src === 'guess' ? t('dae.baseGuess') : undefined}
                  className={cn('min-w-5 text-center font-semibold tabular-nums', base.src === 'guess' ? 'text-dim italic' : 'text-foreground')}>{base.lv}</output>
                <button className={b} onClick={() => put('base', sk.en, Math.min(30, base.lv + 1))}>+</button>
                {base.src === 'own' && <button className="text-dim hover:text-gold" data-tip={t('dae.baseReset')} onClick={() => put('base', sk.en, null)}>↺</button>}
                {base.src === 'page' && <i className="text-dim not-italic">plaync</i>}
              </span>
              {known ? <span data-lvworth className="flex items-center gap-1 tabular-nums" data-tip={t('dae.lvWorthTip', { lv: lvNow })}>{t('dae.plus1')} <DE dmg={m.dmg} ehp={m.ehp} className="inline-flex" /></span>
                : <i className="text-dim not-italic">{t('dae.skNoData')}</i>}
              {sk.spec && <span className="flex items-center gap-0.5" data-tip={t('dae.specTip')}>
                {Object.entries(sk.spec).sort((x, y) => +x[0] - +y[0]).map(([lvS, what]) => (
                  <span key={lvS} data-spec={lvS} data-tip={t('dae.lv', { n: lvS }) + ': ' + what.join(' · ')}
                    className={cn(CHIP, 'h-5 px-1 text-[11px] underline decoration-dotted underline-offset-2', lvNow >= +lvS && CHIP_ON)}>{lvS}</span>
                ))}
              </span>}
              {k > 0 && <span className="ml-auto font-semibold text-green tabular-nums">+{k} → {t('dae.lv', { n: lvNow })}</span>}
            </div>
          </div>
        )
      })}
    </div>
  </>
}

/** What one more unit of each board stat gives at the plan (per Common node amount and per 1 %), with "ignore";
 *  stats without effect (in this mode, or outside the model) folded away. */
function StatValues({ d, ps, cls }: { d: DaeData; ps: PoolPlan[]; cls: string }) {
  const s = settings(), w = weights(cls), all = s.open.statsAll ?? false, p = ps.find(x => x.pool === 'pve' && x.slots.length) ?? ps.find(x => x.slots.length)
  if (!p) return null
  const used = new Map<number, number>()
  for (const q of ps) for (const r of q.refs) if (r.n[3] === 1 && r.n[2] === 1) for (const [st, a] of r.n[4] as [number, number][]) used.set(st, Math.min(used.get(st) ?? Infinity, a))
  for (const q of ps) for (const r of q.refs) if (r.n[3] === 1) for (const [st, a] of r.n[4] as [number, number][]) if (!used.has(st)) used.set(st, a)
  const list = [...used].map(([i, a]) => ({ st: d.stats[i], a: d.stats[i].pct ? 1 : a, key: DAE_KEY[d.stats[i].key] }))
  const marg = new Map(marginals(p, list.filter(x => x.key).map(x => [x.key!, x.a])).map(x => [x.k, x]))
  const val = (m?: { dmg: number; ehp: number }) => (m ? w.off * m.dmg + (1 - w.off) * m.ehp : -1)
  const rows = list.map(x => ({ ...x, m: x.key ? marg.get(x.key) : undefined })).sort((a, b) => val(b.m) - val(a.m))
  const live = rows.filter(r => r.m && (Math.abs(r.m.dmg) > 0.005 || Math.abs(r.m.ehp) > 0.005)), rest = rows.filter(r => !live.includes(r))
  const max = maxOf(live.map(r => r.m!))
  const toggle = (k: Key) => save({ ignore: { ...s.ignore, [cls]: w.ignore.includes(k) ? w.ignore.filter(x => x !== k) : [...w.ignore, k] } })
  const row = ({ st, a, key, m }: (typeof rows)[number]) => {
    const off = key && w.ignore.includes(key)
    return (
      <div key={st.key} data-stat={st.key} className={cn(ROW, 'min-h-7 gap-1.5', off && 'opacity-50')}>
        <i className={cn('size-1.5 flex-none rounded-full', CAT_DOT[cat(st.key)])} />
        <span className="min-w-0 flex-1 truncate">{label(st)} <i className="text-[10.5px] text-dim not-italic">{amount(a, st.pct)}</i></span>
        {key && <button data-ignore={off ? 'on' : 'off'} data-tip={t('dae.ignoreTip')} onClick={() => toggle(key)} className={cn(CHIP, 'h-5 px-1.5 text-[10.5px]', off ? 'border-red/50 bg-red/10 text-foreground' : 'border-transparent text-dim hover:border-border')}>{t('dae.ignore')}</button>}
        {m ? <Vals dmg={m.dmg} ehp={m.ehp} max={max} /> : <i className="w-[9.45rem] flex-none text-right text-[11px] text-dim not-italic">{t('dae.notInModel')}</i>}
      </div>
    )
  }
  return (
    <div data-stats>
      <Note className="text-dim">{t('dae.statsSub', { mode: p.mode === 'pve' ? 'PvE' : 'PvP' })}</Note>
      <ValHead />
      <div className={ROWS}>{live.map(row)}</div>
      {rest.length > 0 && <button className={cn(SECT_BTN, 'mx-1.5 mt-1')} data-stats-rest onClick={() => save({ open: { ...s.open, statsAll: !all } })}>
        {all ? <ChevronUp /> : <ChevronDown />}{t('dae.noEffect', { n: rest.length })}</button>}
      {all && <div className={ROWS}>{rest.map(row)}</div>}
    </div>
  )
}

/** The five numbers that move the model most: always shown, the rest folded away. */
const QUICK: Key[] = ['atk', 'crit', 'speed', 'hp', 'def']
/** Model keys shown in the character panel (the ones a player can read in the character window). */
const SHEET: Key[] = ['atk', 'atkBonus', 'atkPct', 'wpn', 'crit', 'critPct', 'critDmg', 'dmg', 'pve', 'boss', 'pvp', 'double', 'perfect', 'multi',
  'speed', 'cdr', 'acc', 'hp', 'hpPct', 'def', 'defPct', 'eva', 'block', 'critRes', 'tol', 'pveTol', 'pvpTol', 'endurance', 'statusChance', 'statusRes']

/** The character's numbers the model uses (page or own entry) and the assumptions with their source. */
function Inputs({ d, cls, mode }: { d: DaeData; cls: string; mode: Mode }) {
  const s = settings(), char = charKey(), ct = charTotals(d, cls, char), w = weights(cls), a = assumeOf(w, mode)
  const setOwn = (k: Key, v: number | null) => {
    const m = { ...(s.own[char] || {}) }
    if (v == null) delete m[k]; else m[k] = v
    save({ own: { ...s.own, [char]: m } })
  }
  const setA = (k: keyof Assume, v: number | null) => {
    const byMode = { ...(s.assume[cls] || {}) }, m = { ...(byMode[mode] || {}) }
    if (v == null) delete m[k]; else m[k] = v
    save({ assume: { ...s.assume, [cls]: { ...byMode, [mode]: m } } })
  }
  return <div data-inputs>
    <>
      <Note className="text-dim">{rich(t(ct.live?.gear ? 'dae.inputsPage' : 'dae.inputsNoPage'))}</Note>
      <div className={ROWS} data-sheet>
        {(s.open.sheetAll ? [...QUICK, ...SHEET.filter(k => !QUICK.includes(k))] : QUICK).map(k => {
          const own = ct.own[k] != null, val = ct.all[k] ?? 0
          return (
            <div key={k} data-sheet-key={k} className={cn(ROW, 'min-h-7 gap-1.5')}>
              <span className="min-w-0 flex-1 truncate">{t('dae.k.' + k)}</span>
              <i className="text-[10.5px] text-dim not-italic">{own ? t('dae.src.own') : ct.page[k] != null ? 'plaync' : ct.typical[k] != null ? t('dae.src.typical') : '—'}</i>
              <NumField data={k} value={val} onCommit={v => setOwn(k, v)} />
              {own && <button className="text-dim hover:text-gold" data-tip={t('dae.baseReset')} onClick={() => setOwn(k, null)}>↺</button>}
            </div>
          )
        })}
      </div>
      <button className={cn(SECT_BTN, 'mx-1.5 mt-1')} data-sheet-all onClick={() => save({ open: { ...s.open, sheetAll: !s.open.sheetAll } })}>
        {s.open.sheetAll ? <ChevronUp /> : <ChevronDown />}{t(s.open.sheetAll ? 'dae.sheetLess' : 'dae.sheetAll', { n: SHEET.length - QUICK.length })}</button>
      <Sect sub={t('dae.assumeSub', { mode: mode === 'pve' ? 'PvE' : 'PvP' })}>{t('dae.sect.assume')}</Sect>
      <div className={ROWS} data-assume>
        {(Object.keys(ASSUME[mode]) as (keyof Assume)[]).filter(k => k !== 'healShare').map(k => {
          const changed = w.assume[mode]?.[k] != null
          return (
            <div key={k} data-assume-key={k} className={cn(ROW, 'min-h-7 gap-1.5')}>
              <span className="min-w-0 flex-1 truncate" data-tip={t('dae.a.' + k + 'Tip')}>{t('dae.a.' + k)}</span>
              <i className="text-[10.5px] text-dim not-italic">{t('dae.src.' + (changed ? 'own' : ASSUME_SRC[k]))}</i>
              <NumField data={k} value={a[k]} onCommit={v => setA(k, v)} />
              {changed && <button className="text-dim hover:text-gold" data-tip={t('dae.baseReset')} onClick={() => setA(k, null)}>↺</button>}
            </div>
          )
        })}
      </div>
    </>
  </div>
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
    const off = { ...s.off }, use = { ...s.use }, assume = { ...s.assume }, ignore = { ...s.ignore }
    delete off[cls]; delete use[cls]; delete assume[cls]; delete ignore[cls]
    save({ off, use, assume, ignore })
  }
  const bar = <>
    {nav}
    <BarInfo>{hasLive ? t('dae.info', { cls: className(c), spent }) : t('dae.infoNoLive', { cls: className(c) })}</BarInfo>
    <BarRight>
      {!hasLive && <AppSelect value={cls} tip={t('dae.class')} className="h-6 text-xs"
        options={Object.entries(d.classes).map(([k, x]) => ({ value: k, label: className(x) }))} onChange={v => save({ cls: v })} />}
      <Seg value={s.mode as 'respec' | 'add'} onChange={m => save({ mode: m })} item={m => ({ 'data-mode': m })}
        options={(['respec', 'add'] as const).map(m => ({ value: m, label: t('dae.mode.' + m), tip: t(`dae.mode.${m}Tip`) }))} />
    </BarRight>
  </>
  const pve = ps.find(p => p.pool === 'pve')!, open = ps.filter(p => p.slots.length)
  const cur = ps.find(p => p.slots.includes(selectedSlot(c, ps))) ?? pve, w = weights(cls)
  // first visit (no points yet): the setup opens and stays open until the player closes it
  if (!open.some(p => p.total > 0) && U.open?.['dae.setup'] == null) U.open = { ...U.open, 'dae.setup': true }
  const goalName = PRESETS.find(([, x]) => Math.abs(w.off - x) < 0.001)?.[0] ?? (Math.abs(w.off - (CLASS_DEF[cls]?.off ?? -1)) < 0.001 ? 'class' : 'custom')
  return (
    <Page w="rows" bar={bar}>
      <div className="grid items-start @min-[900px]:grid-cols-2 [&>*]:min-w-0">
        <div>
          <Summary p={cur} d={d} cls={cls} hasLive={hasLive} />
          {s.mode === 'respec' && hasLive && cur.spentNow > 0 && <Hint>{rich(t('dae.respecHint'))}</Hint>}
          <Advice d={d} cls={cls} />
        </div>
        <Panel className="pb-0.5">
          {LIVE && <LiveBlock />}
          <Disclosure id="dae.setup" title={t('dae.sect.setup')}
            sub={<span className="tabular-nums">{open.map(p => `${t('dae.pool.' + p.pool)} ${p.total}`).join(' · ')} · {t('dae.preset.' + goalName)}</span>}
            right={<button className={SECT_BTN} data-tip={t('dae.resetTip')} onClick={resetCls}><RotateCcw /></button>}>
            <div className={cn(ROWS, 'mt-1')}>
              {open.map(p => <PointsEdit key={p.pool} dataKey={p.pool} label={t('dae.pool.' + p.pool)} value={p.total} spent={hasLive ? p.spentNow : undefined}
                mode={w.mode[p.pool]} onMode={m => save({ pmode: { ...s.pmode, [p.pool]: m } })} onChange={v => save({ [POOL_KEY[p.pool]]: v })} />)}
            </div>
            <Goal cls={cls} />
          </Disclosure>
        </Panel>
      </div>
      <Boards d={d} cls={cls} ps={ps} />
      <Panel>
        <Disclosure id="dae.details" title={t('dae.sect.details')} sub={t('dae.detailsSub')}>
          <PanelTabs id="dae.panel" tabs={[{ value: 'why', label: t('dae.panel.why') }, { value: 'skills', label: t('dae.panel.skills') },
            { value: 'stats', label: t('dae.panel.stats') }, { value: 'inputs', label: t('dae.panel.inputs') }]}>
            {v => <div className="mx-auto w-full max-w-[860px] pb-1">
              {v === 'why' && <Why p={cur} d={d} cls={cls} />}
              {v === 'skills' && <Skills d={d} cls={cls} p={pve} />}
              {v === 'stats' && <StatValues d={d} ps={ps} cls={cls} />}
              {v === 'inputs' && <Inputs d={d} cls={cls} mode={pve.mode} />}
            </div>}
          </PanelTabs>
          <Foot>{t('dae.foot', { date: d.date })}</Foot>
        </Disclosure>
      </Panel>
    </Page>
  )
}
