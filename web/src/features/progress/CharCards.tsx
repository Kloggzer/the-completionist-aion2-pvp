// Checklist dashboard as cards (like shugo.gg's character overview): on top the server's shared entries and keys as one
// row of chips, then one card per character side by side – name, class · level, CP / item level, playing now / last
// played; the Odyle energy as a bar with "full at …"; rings for today / this week; then compact chips: STOCK (Nightmare
// tickets), TODAY, WEEK – what is done stays in place, struck through. A click on a card opens the character's page.
import { Check } from 'lucide-react'
import { V, bump } from '@/core/state'
import { t } from '@/core/i18n'
import { cn } from '@/lib/utils'
import { GameIcon, META } from '@/components/kit'
import { CHARGES, chargeFullIn, chargeNow, chargesOf, type ChargeDef } from './charges'
import { CHECK, CHECK_GAME, CHECK_ICON, CHECK_ICON_DEFAULT, checkCount, progressOf, resetIn, type Kind, type Per } from './checklist'
import { charInfo, playingNow } from './charinfo'
import { ownerLevel } from './alerts'
import { CHARGE_GAME, CHARGE_ICON } from './ChargeRows'

const charName = (name: string) => (name === 'Standard' ? t('chk.unknownChar') : name)
const fmtK = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n))

/** "vor 13 h" / "vor 2 T" / "gerade eben". */
function ago(ms: number) {
  const m = Math.round(ms / 60000)
  if (m < 2) return t('card.justNow')
  if (m < 60) return t('card.agoMin', { n: m })
  if (m < 48 * 60) return t('card.agoH', { n: Math.round(m / 60) })
  return t('card.agoD', { n: Math.round(m / 1440) })
}

/** Small completion ring with "done/total" inside. */
function Ring({ done, total, label }: { done: number; total: number; label: string }) {
  const f = total ? done / total : 0, size = 34, r = 13.5, c = 2 * Math.PI * r
  const col = f >= 1 ? 'var(--green)' : f > 0 ? 'var(--gold)' : 'var(--dim)'
  return (
    <div className="flex flex-col items-center gap-0.5" data-ring={label}>
      <div className="relative">
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="stroke-foreground/10" strokeWidth="3" />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${c * f} ${c}`} />
        </svg>
        <span className="absolute inset-0 grid place-items-center"><span className="text-[10.5px] font-semibold whitespace-nowrap tabular-nums">{done}<span className="text-[9px] font-normal text-dim">/{total}</span></span></span>
      </div>
      <span className="text-[10.5px] text-dim">{label}</span>
    </div>
  )
}

/** One entry as a chip: icon, name, count; done = struck through and dimmed. */
function EntryChip({ id, c, max, extra }: { id: string; c: number; max: number; extra?: string }) {
  const done = c >= max, I = CHECK_ICON[id] || CHECK_ICON_DEFAULT
  return (
    <span data-chip={id} data-done={done || undefined} data-tip={t('progress.tip.' + id)}
      className={cn('inline-flex max-w-full min-w-0 items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[11.5px]', done && 'border-transparent bg-transparent text-dim')}>
      {done ? <Check className="size-3 flex-none text-green" /> : <GameIcon name={CHECK_GAME[id]} fallback={I} className="size-3.5 flex-none" fallbackClass="size-3 flex-none text-muted-foreground" />}
      <span className={cn('truncate', done && 'line-through')}>{t('progress.item.' + id)}</span>
      {!done && <b className="flex-none font-semibold tabular-nums text-gold">{c}/{max}</b>}
      {extra && <span className="flex-none text-muted-foreground">{extra}</span>}
    </span>
  )
}

/** A charge as a chip (stock row, server row): value / cap, red when full. */
function ChargeChip({ d, char }: { d: ChargeDef; char?: string }) {
  const v = chargeNow(d, char), cap = d.cap(), full = v != null && v >= cap
  return (
    <span data-chip={d.id} data-tip={t('charge.tip.' + d.id)}
      className={cn('inline-flex max-w-full min-w-0 items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[11.5px]', full && 'border-red/40 text-red')}>
      <GameIcon name={CHARGE_GAME[d.id]} fallback={CHARGE_ICON[d.id]} className="size-3.5 flex-none" fallbackClass="size-3 flex-none text-muted-foreground" />
      <span className="truncate">{t('charge.' + d.id)}</span>
      <b className={cn('flex-none font-semibold tabular-nums', full ? 'text-red' : 'text-foreground')}>{v ?? '–'}<span className="font-normal text-dim">/{cap}</span></b>
      {full && <span className="flex-none text-[10px] font-semibold">{t('card.full')}</span>}
    </span>
  )
}

/** Entries of an owner in one period: [id, count, max]. */
const entries = (per: Per, kind: Kind, char?: string): [string, number, number][] =>
  CHECK.filter(([k]) => k === kind).flatMap(([, items]) => items).filter(i => i[2] === per).map(([id, max]) => [id, checkCount(id, per, kind, char), max])

/** Section of a card: a small label left, the chips right (wrapping). */
function Sect({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 gap-2 py-0.5">
      <span className="w-12 flex-none pt-1 text-[9.5px] font-semibold tracking-wide text-dim uppercase">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1">{children}</div>
    </div>
  )
}

const odyle = CHARGES.find(d => d.id === 'odyle')!

function CharCard({ name, onOpen }: { name: string; onOpen: () => void }) {
  const info = charInfo(name), now = playingNow(name), lvl = ownerLevel('char', name)
  const d = entries('char', 'd', name), w = entries('char', 'w', name)
  const done = (l: [string, number, number][]) => l.filter(([, c, m]) => c >= m).length
  const ov = chargeNow(odyle, name), cap = odyle.cap(), full = chargeFullIn(odyle, name)
  const stock = chargesOf('char').filter(x => x.id !== 'odyle')
  return (
    <button onClick={onOpen} data-char={name}
      className={cn('flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-3 text-left shadow-(--shadow-card) transition-colors hover:border-gold/40',
        now && 'border-green/45', lvl === 'red' && 'border-red/45')}>
      {/* head: name, class · level, CP / item level, playing now / last played */}
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold">{charName(name)}</div>
          <div className={cn(META, 'truncate')}>{[info?.cls ? t('card.cls.' + info.cls) : '', info?.lv ? t('card.lv', { n: info.lv }) : ''].filter(Boolean).join(' · ') || t('card.noInfo')}</div>
          {info && (info.cp > 0 || info.il > 0) && <div className="mt-1 flex gap-1 text-[10.5px] tabular-nums">
            {info.cp > 0 && <span className="rounded-sm border px-1 text-muted-foreground" data-tip="CP">CP <b className="font-semibold text-foreground">{fmtK(info.cp)}</b></span>}
            {info.il > 0 && <span className="rounded-sm border px-1 text-muted-foreground" data-tip={t('card.il')}>iLvl <b className="font-semibold text-foreground">{info.il}</b></span>}
          </div>}
        </div>
        <span className={cn('flex-none text-[11px]', now ? 'text-green' : 'text-dim')}>
          {now ? <><i className="mr-1 inline-block size-1.5 rounded-full bg-green align-middle shadow-[0_0_5px_var(--green)]" />{t('card.playing')}</>
            : info?.seen ? t('card.played', { ago: ago(Date.now() - info.seen) }) : ''}
        </span>
      </div>
      {/* Odyle energy: value (+bonus) / cap, bar, full at */}
      <div className="rounded-lg border bg-background/60 px-2.5 py-1.5" data-odyle="">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[16px] font-bold tabular-nums">{ov ?? '–'}</span><span className="text-[11px] text-dim">/{cap}</span>
          <span className="ml-auto text-[11px] text-muted-foreground">{ov == null ? t('charge.enter') : full === 0 ? t('alert.full') : full != null ? t('alert.fullIn', { d: resetIn(new Date(Date.now() + full)) }) : ''}</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-foreground/10">
          <div className={cn('h-full rounded-full', full === 0 ? 'bg-red' : 'bg-cyan')} style={{ width: `${Math.min(100, ((ov ?? 0) / cap) * 100)}%` }} />
        </div>
      </div>
      {/* today / this week */}
      <div className="flex items-center gap-3">
        <Ring done={done(d)} total={d.length} label={t('card.today')} />
        <Ring done={done(w)} total={w.length} label={t('card.week')} />
        <span className="ml-auto text-[11px] text-muted-foreground">{Math.round(progressOf('char', name) * 100)} %</span>
      </div>
      <div className="flex flex-col gap-0.5 border-t border-border/50 pt-1.5">
        {stock.length > 0 && <Sect label={t('card.stock')}>{stock.map(x => <ChargeChip key={x.id} d={x} char={name} />)}</Sect>}
        <Sect label={t('card.today')}>{d.map(([id, c, m]) => <EntryChip key={id} id={id} c={c} max={m} />)}</Sect>
        <Sect label={t('card.week')}>{w.map(([id, c, m]) => <EntryChip key={id} id={id} c={c} max={m} />)}</Sect>
      </div>
    </button>
  )
}

/** The server's shared entries and keys: one wrapping row of chips. */
export function ServerRow() {
  const items = [...entries('server', 'd'), ...entries('server', 'w')]
  return (
    <div data-server-row="" className="mx-2.5 mt-2.5 flex flex-wrap items-center gap-1 rounded-xl border bg-card px-3 py-2 shadow-(--shadow-card)">
      <span className="mr-1 rounded-sm bg-gold/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-gold uppercase">{t('chk.server')}</span>
      {chargesOf('server').map(x => <ChargeChip key={x.id} d={x} />)}
      {items.map(([id, c, m]) => <EntryChip key={id} id={id} c={c} max={m} />)}
    </div>
  )
}

/** The characters as cards, side by side (as many columns as fit). */
export function CharCards({ chars }: { chars: string[] }) {
  return (
    <div data-cards="" className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] items-start gap-2.5 px-2.5 pt-2.5">
      {chars.map(c => <CharCard key={c} name={c} onOpen={() => { V.chkPage = c; bump(); document.querySelector('[data-list]')?.scrollTo(0, 0) }} />)}
    </div>
  )
}
