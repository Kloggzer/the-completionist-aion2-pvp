// "Händler" tab: the Black Cloud Merchant's current offer (read from the game when its window opens, or entered by hand;
// cleared on the full hour) with a verdict per pet by the souls still missing to Lv 3, and the wish list of pets below
// Lv 3 in three sections (merchant only / hard / easy to farm), ranked by farm difficulty × missing souls. Clicking a
// pet shows its spawns in the Targets tab. Offer and wish list are portrait tiles (kit anatomy); the offer column sits
// left of the wish list grid from 900 px.
import { useEffect, useMemo, useState } from 'react'
import { Brain, Gamepad2, Leaf, MapPin, PawPrint, Sparkles, CircleHelp, X, type LucideIcon } from 'lucide-react'
import { U, V, bump, hasState, saveUi, useApp, type Any } from '@/core/state'
import { host } from '@/core/host'
import { emit } from '@/core/bus'
import { goTab } from '@/core/nav'
import { mapName, selectMap, petName } from '@/core/data'
import { fmt, t } from '@/core/i18n'
import { cn } from '@/lib/utils'
import { AppSelect } from '@/components/AppSelect'
import { BOX, BarInfo, BarRight, CHIP, CHIP_ON, Foot, Hint, Note, Page, Sect, SUB, T_BODY, T_FOOT, T_META, T_TITLE, TILE, TILE_CLICK, TILE_P, TileIcon, grid, rich } from '@/components/kit'
import { toggleMulti } from '@/features/pets/logic'
import {
  HARD, MAX_SOULS, OFFER_ORDER, SOULS_PER_BUY, bestZone, buyCount, buyInfo, diffOf, freshAlt, discount, eventPets, freshOffers, groupOf, mapsLoaded, merchantPets, msToNext,
  myFaction, offerKind, perSoul, petIcon, petLevel, priority, segments, soulsHave, soulsLeft, tierOf, wishlist, type Diff, type Group, type Offer, type OfferVerdict,
  type Offers,
} from './logic'

/** Name search: the shown name or the English one (lower-case query). */
const hit = (p: Any, q: string) => petName(p).toLowerCase().includes(q) || p.n.toLowerCase().includes(q)

/** Character whose offer is shown: another one picked in the chips (V.merchView), else the current one (U.merch). */
const viewAlt = (): string | null => (V.merchView != null && freshAlt(U.merchAlt, Date.now())[V.merchView] ? V.merchView : null)
const offers = (): Offers => { const c = viewAlt(); return freshOffers(c != null ? U.merchAlt[c] : U.merch, Date.now()) }
function setOffers(items: Offer[], save = true) {
  const c = viewAlt()
  if (c != null) { U.merchAlt = { ...U.merchAlt, [c]: { ...offers(), items } }; if (save) saveUi(['merchAlt']) }
  else { U.merch = { ...offers(), items }; if (save) saveUi(['merch']) }
  bump()
}

const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

/** Show the pet's spawns: Targets tab on the map with the most spawns, the pet selected. */
async function showOnMap(p: Any, d: Diff) {
  if (!d.best) return
  goTab('targets', `[data-pet="${p.id}"]`)
  if (U.map !== d.best.map) await selectMap(d.best.map)
  V.sel = null; V.multi.clear()
  toggleMulti(p.id)
  emit('fit')
}

// ---------------------------------------------------------------- portraits

// Pet portraits from aion2.app (the shop's own pet pictures), looked up by the pet's game id (petIds.json), else by its
// name in the item table. The host
// downloads each one on first request and caches it (GameData.PetIcon, /data/peticons/<file>). Until it has loaded, or
// when it is missing (offline, not in the table), the tile shows the category icon.
const CAT_ICON: Record<string, LucideIcon> = { Fera: PawPrint, Natura: Leaf, Cogni: Brain, Varian: Sparkles }
const iconOk = new Set<string>(), iconBad = new Set<string>()
const ICON_URL = '/data/peticons/'

/** Pet portrait: the tile's portrait column (hidden in narrow windows like every portrait tile), or a small square
 *  (`size` px) for lists. */
function PetPic({ p, size, className }: { p: Any | null; size?: number; className?: string }) {
  const icon = petIcon(p?.n, p?.id)
  const [, set] = useState(0)
  const ok = !!icon && iconOk.has(icon), bad = !icon || iconBad.has(icon)
  const Cat = !p ? CircleHelp : CAT_ICON[p.c] || PawPrint
  const img = !bad && <img src={ICON_URL + icon} alt="" draggable={false} data-peticon={icon}
    onLoad={() => { iconOk.add(icon!); set(n => n + 1) }} onError={() => { iconBad.add(icon!); set(n => n + 1) }}
    className={cn('absolute inset-0 size-full object-contain p-px', !ok && 'opacity-0')} />
  if (size) {
    return (
      <span data-tip={p?.c} className={cn('relative grid flex-none place-items-center overflow-hidden rounded-sm border border-foreground/10 bg-foreground/[0.04] text-dim/70', className)}
        style={{ width: size, height: size }}>
        {!ok && <Cat className="size-[60%]" strokeWidth={1.5} />}{img}
      </span>
    )
  }
  // TileIcon's own `grid` would override T_PORTRAIT's `hidden`: hide it in narrow windows like the portraits.
  // Full tile height (self-stretch), fixed width.
  return (
    <TileIcon icon={ok ? undefined : Cat} tone="dim" tip={p?.c} className={cn('hidden @min-[700px]:grid h-auto min-h-[44px] self-stretch overflow-hidden bg-foreground/[0.04]', className)}>
      {img}
    </TileIcon>
  )
}

// ---------------------------------------------------------------- small parts

/** Souls to Lv 3 as three level segments (5 / 25 / 75 souls, equally wide); `add` previews a purchase. */
function SoulBar({ have, add = 0 }: { have: number; add?: number }) {
  const now = segments(have), then = segments(have + add)
  return (
    <span data-souls={have} className="my-1 flex h-[4px] flex-none gap-[3px]">
      {now.map((f, i) => (
        <span key={i} className="relative flex-1 overflow-hidden rounded-[1px] bg-foreground/[0.08]">
          {then[i] > f && <i className="absolute inset-y-0 left-0 bg-gold/45" style={{ width: then[i] * 100 + '%' }} />}
          <i className={cn('absolute inset-y-0 left-0', f >= 1 ? 'bg-green/80' : 'bg-green/60')} style={{ width: f * 100 + '%' }} />
        </span>
      ))}
    </span>
  )
}

/** Farm effort as 1–3 dots; colour only for the top tier. */
function Tier({ d }: { d: Diff }) {
  const n = tierOf(d)
  return (
    <span data-tier={n} data-tip={t('merch.tier.' + n) + ' · ' + t('merch.score.tip', { n: d.score })} className="flex flex-none items-center gap-[3px] px-0.5">
      {[1, 2, 3].map(i => <i key={i} className={cn('size-[5px] rounded-full', i > n ? 'bg-foreground/12' : n === 3 ? 'bg-gold' : 'bg-muted-foreground/70')} />)}
    </span>
  )
}

const LvChip = ({ id }: { id: number }) =>
  <span className="flex-none rounded-[3px] border border-foreground/10 px-1 text-[10.5px] leading-[15px] font-medium text-muted-foreground tabular-nums">{t('merch.lv', { lv: petLevel(id) })}</span>

/** Where to farm, one muted line: (other faction's territory ·) map · zone · n spawns · the other reasons (Named, …). */
function whereLine(d: Diff): string {
  const txt = (k: string) => d.reasons.filter(x => (k === 'enemy') === (x.k === 'enemy') && x.k !== 'spawns' && x.k !== 'none')
    .map(x => t('merch.r.' + x.k, x.k === 'enemy' ? { fac: t('merch.fac.' + x.v!.fac) } : x.v))
  if (!d.best) return [t('merch.noMap'), ...txt('other')].join(' · ')
  const z = bestZone(d.best)
  return [...txt('enemy'), t('merch.where', { map: mapName(d.best.name), zone: z ? ' · ' + z : '', n: d.best.n }), ...txt('other')].join(' · ')
}

/** Text field that lets the overlay take the keyboard while focused (host 'typing'). */
function Field({ value, onChange, onKey, onBlur, placeholder, className, tip, ...rest }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'onBlur'> & {
  value: string; onChange: (v: string) => void; onKey?: (e: React.KeyboardEvent<HTMLInputElement>) => void; onBlur?: () => void
  tip?: string; [k: `data-${string}`]: string
}) {
  return <input value={value} placeholder={placeholder} spellCheck={false} data-tip={tip} {...rest}
    onFocus={() => host({ type: 'typing', on: true })} onBlur={() => { host({ type: 'typing', on: false }); onBlur?.() }}
    onChange={e => onChange(e.target.value)} onKeyDown={onKey}
    className={cn('h-7 min-w-0 rounded-sm border bg-background/60 px-2 text-[12.5px] text-foreground outline-none placeholder:text-dim focus:border-gold/60', className)} />
}

const VERDICT_PILL: Record<OfferVerdict, string> = {
  event: 'border-gold/60 text-gold', buy: 'border-gold bg-gold text-primary-foreground', opt: 'border-cyan/30 text-cyan', have: 'border-foreground/10 text-dim', unknown: 'border-foreground/10 text-dim',
}

/** Combobox over the pet names: type, arrows, Enter / click adds the pet to the offer. */
function Picker() {
  const [q, setQ] = useState(''), [hi, setHi] = useState(0)
  const taken = new Set(offers().items.map(o => o.id))
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    return [...new Map([...merchantPets(), ...eventPets()].map(p => [p.id, p])).values()].filter(p => !taken.has(p.id) && hit(p, s))
      .sort((a, b) => +!petName(a).toLowerCase().startsWith(s) - +!petName(b).toLowerCase().startsWith(s) || petName(a).localeCompare(petName(b))).slice(0, 8)
  }, [q, taken.size]) // eslint-disable-line react-hooks/exhaustive-deps
  const add = (p: Any) => { setOffers([...offers().items, { id: p.id }]); setQ(''); setHi(0) }
  const key = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { setHi(h => Math.min(h + 1, list.length - 1)); e.preventDefault() }
    else if (e.key === 'ArrowUp') { setHi(h => Math.max(h - 1, 0)); e.preventDefault() }
    else if (e.key === 'Enter' && list[hi]) add(list[hi])
    else if (e.key === 'Escape') setQ('')
  }
  return (
    <div className="relative px-1.5 pb-1">
      <Field value={q} onChange={v => { setQ(v); setHi(0) }} onKey={key} placeholder={t('merch.add')} tip={t('merch.add.tip')} className="h-6 w-full text-[12px]"
        role="combobox" aria-expanded={q ? 'true' : 'false'} data-merchpicker="" />
      {q.trim() && (
        <div role="listbox" className="absolute inset-x-1.5 top-7 z-20 overflow-hidden rounded-sm border bg-popover shadow-lg">
          {list.length ? list.map((p, i) => {
            const v = offerKind({ id: p.id }).v
            return (
              <div key={p.id} role="option" aria-selected={i === hi} onMouseDown={e => { e.preventDefault(); add(p) }} onMouseEnter={() => setHi(i)}
                className={cn('flex cursor-pointer items-center gap-2 px-2 py-1 text-[12.5px]', i === hi && 'bg-accent')}>
                <PetPic p={p} size={20} />
                <span className="min-w-0 flex-1 truncate">{petName(p)}</span>
                {p.c && <span className="text-[11px] text-dim">{p.c}</span>}
                <i className={cn('rounded-[3px] border px-1 text-[10.5px] font-semibold not-italic', VERDICT_PILL[v])}>{t('merch.v.' + v)}</i>
              </div>
            )
          }) : <div className="px-2 py-1 text-[12px] text-dim">{t('merch.noMatch')}</div>}
        </div>
      )}
    </div>
  )
}

const GameTag = () => <Gamepad2 data-game="" data-tip={t('merch.game.tip')} aria-label={t('merch.game')} className="size-3.5 flex-none text-dim" />

// ---------------------------------------------------------------- offer

function OfferTile({ o }: { o: Offer }) {
  const { p, name, v } = offerKind(o)
  const rest = p ? soulsLeft(o.id) : 0, d = p ? diffOf(p) : null
  const setPrice = (s: string) => {
    const n = parseInt(s.replace(/\D/g, ''), 10)
    setOffers(offers().items.map(x => (x.id === o.id ? { ...x, price: Number.isFinite(n) ? n : undefined } : x)), false)
  }
  const off = discount(o), have = soulsHave(rest), b = buyInfo(rest), click = !!(p && d?.best)
  return (
    <div data-offer={o.id} data-verdict={v} onClick={click ? () => showOnMap(p, d!) : undefined} data-tip={click ? t('merch.show') : undefined}
      className={cn(TILE, TILE_P, click && TILE_CLICK, (v === 'buy' || v === 'event') && 'border-gold/45 bg-gold/[0.04]', (v === 'have' || v === 'unknown') && 'opacity-70')}>
      <PetPic p={p ?? (name ? { n: name } : null)} />
      <div className={T_BODY}>
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cn(T_TITLE, 'min-w-0 flex-1')}>{name ?? t('merch.unknown', { id: o.item ?? o.id })}</span>
          {o.tab != null && <GameTag />}
          <span data-tip={t('merch.v.' + v + '.tip')}
            className={cn('flex-none rounded-sm border px-1.5 text-[10.5px] leading-[17px] font-bold tracking-wide', VERDICT_PILL[v])}>{t('merch.v.' + v)}</span>
        </div>
        <div className={cn(SUB, 'mt-0.5 truncate')}>
          {v === 'event' ? t('merch.event.sub') : !p || !d ? t('merch.v.unknown.tip')
            : v === 'have' ? t('merch.lv3')
              : <span data-missing={rest} data-buy={b.buys}>
                <span className={v === 'buy' ? 'text-foreground' : undefined}>{t('merch.buy', { s: SOULS_PER_BUY, n: soulsHave(b.after), max: MAX_SOULS })}</span>
                {' · '}{t('merch.buys', { buys: b.buys })}{' · '}{t('merch.lv', { lv: petLevel(o.id) })}
              </span>}
        </div>
        {p && d && v !== 'have' && <div className={cn(SUB, 'truncate text-dim')}>{p.ev ? t('merch.evOnly') : whereLine(d)}</div>}
        <div className={T_FOOT}>
          {p && <SoulBar have={have} add={v === 'have' ? 0 : SOULS_PER_BUY} />}
          <div className={T_META} onClick={e => e.stopPropagation()}>
            <span className="flex min-w-0 items-center gap-1.5">
              <Field value={o.price != null ? fmt(o.price) : ''} onChange={setPrice} onBlur={() => saveUi(['merch', 'merchAlt'])} onKey={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                placeholder={t('merch.price')} tip={t('merch.price.tip')} className="h-5 w-[72px] px-1 text-right text-[11.5px] tabular-nums" data-price="" />
              {off > 0 && <span data-discount={off} data-tip={t('merch.base', { n: fmt(o.base!) })}
                className={cn('flex-none rounded-[3px] border px-1 text-[10.5px] leading-[15px] font-semibold', v === 'buy' ? BOX.gold : BOX.dim)}>-{off} %</span>}
              {o.price ? <span data-persoul={perSoul(o.price)} data-tip={t('merch.perSoul.tip', { s: SOULS_PER_BUY })} className="truncate text-dim">{t('merch.perSoul', { n: fmt(perSoul(o.price)) })}</span> : null}
            </span>
            <button data-tip={t('merch.remove')} onClick={() => setOffers(offers().items.filter(x => x.id !== o.id))}
              className="grid size-5 flex-none place-items-center rounded-sm text-dim hover:bg-foreground/10 hover:text-foreground [&_svg]:size-3.5"><X /></button>
          </div>
        </div>
      </div>
    </div>
  )
}

const OFFER_GRID = grid('row')

/** Top picks of the wish list (shown while the offer is empty): what to look out for at the merchant. */
function Watch() {
  const top = wishlist().slice(0, 6)
  if (!top.length) return null
  return <>
    <Sect sub={'· ' + t('merch.watch.sub')}>{t('merch.watch')}</Sect>
    <div data-watch={top.length} className="flex flex-col px-1.5">
      {top.map(({ p, d, rest }) => (
        <div key={p.id} data-watchpet={p.id} onClick={() => showOnMap(p, d)} data-tip={d.best ? t('merch.show') : whereLine(d)}
          className={cn('flex min-h-8 min-w-0 items-center gap-2 rounded-sm px-1 text-[12.5px]', d.best && 'cursor-pointer hover:bg-foreground/5')}>
          <PetPic p={p} size={24} />
          <span className="min-w-0 flex-1 truncate font-medium">{petName(p)}</span>
          <span className="flex-none text-[11px] text-dim tabular-nums">{t('merch.souls', { n: soulsHave(rest), max: MAX_SOULS })}</span>
          <Tier d={d} />
        </div>
      ))}
    </div>
  </>
}

/** Bought offers: one muted row each, undo per row. */
function Bought({ list }: { list: Offer[] }) {
  return <section data-bought={list.length} className="opacity-75">
    <Sect sub={'· ' + list.length}>{t('merch.bought')}</Sect>
    <div className="flex flex-col px-1.5">
      {list.map(o => {
        const { p, name } = offerKind(o)
        const at = new Date(o.bought!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        return (
          <div key={o.id} data-boughtoffer={o.id} data-tip={t('merch.bought.tip', { t: at, s: SOULS_PER_BUY })}
            className="flex min-h-7 min-w-0 items-center gap-2 rounded-sm px-1 text-[12px] text-muted-foreground">
            <PetPic p={p ?? (name ? { n: name } : null)} size={20} />
            <span className="min-w-0 flex-1 truncate line-through decoration-white/25">{name ?? t('merch.unknown', { id: o.item ?? o.id })}</span>
            <span className="flex-none text-[11px] text-dim tabular-nums">
              {t('merch.bought.row', { s: SOULS_PER_BUY })}{o.price ? ' · ' + fmt(o.price) : ''}
            </span>
            <button data-tip={t('merch.bought.undo')} data-unbuy="" aria-label={t('merch.bought.undo')}
              onClick={() => setOffers(offers().items.map(x => (x.id === o.id ? { ...x, bought: undefined } : x)))}
              className="grid size-5 flex-none place-items-center rounded-sm text-dim hover:bg-foreground/10 hover:text-foreground [&_svg]:size-3.5"><X /></button>
          </div>
        )
      })}
    </div>
  </section>
}

/** Chips per character with an offer this hour (only when there is more than the current one). */
function CharChips() {
  const alt = freshAlt(U.merchAlt, Date.now())
  const names = Object.keys(alt).sort()
  if (!names.length) return null
  const cur = freshOffers(U.merch, Date.now()), view = viewAlt()
  const chip = (c: string | null, o: Offers) => {
    const name = (c ?? cur.c) || t('merch.char.none'), n = buyCount(o)
    return (
      <button key={c ?? ''} data-charchip={c ?? ''} data-active={view === c ? '' : undefined} onClick={() => { V.merchView = c; bump() }}
        data-tip={t('merch.char.tip', { c: name })} className={cn(CHIP, view === c && CHIP_ON)}>
        {n ? t('merch.char.buy', { c: name, n }) : t('merch.char.n', { c: name, n: o.items.filter(x => !x.bought).length })}
      </button>
    )
  }
  return <div data-charchips={names.length + 1} className="flex flex-wrap gap-1 px-1.5 pb-1">{chip(null, cur)}{names.map(c => chip(c, alt[c]))}</div>
}

function OfferList() {
  const cur = offers()
  const bought = cur.items.filter(o => o.bought).sort((a, b) => b.bought! - a.bought!)
  const items = cur.items.filter(o => !o.bought).map(o => {
    const { p, v } = offerKind(o)
    return { o, rank: OFFER_ORDER[v], prio: p ? priority(soulsLeft(p.id), diffOf(p)) : 0 }
  }).sort((a, b) => a.rank - b.rank || b.prio - a.prio)
  const other = cur.other || []
  return <div>
    <Sect sub={items.length ? '· ' + items.length : undefined}>{t('merch.offer')}</Sect>
    <CharChips />
    <Picker />
    {items.length ? <div className={cn(OFFER_GRID, '@min-[900px]:grid-cols-1')}>{items.map(x => <OfferTile key={x.o.id} o={x.o} />)}</div>
      : bought.length ? null : <div data-offerempty="" data-tip={t('merch.offer.help')} className="mx-1.5 rounded-sm border border-dashed border-foreground/10 px-2.5 py-2 text-[12px] leading-snug text-muted-foreground">
        {rich(t('merch.offer.none'))} <span className="text-dim tabular-nums">{t('merch.next', { t: mmss(msToNext(Date.now())) })}</span>
      </div>}
    {other.length > 0 && <div data-other={other.length} className="px-2.5 py-1 text-[11px] text-dim"
      data-tip={other.map(x => t('merch.otherItem', { id: x.item, price: fmt(x.price), off: discount(x) })).join(' · ')}>{t('merch.other', { n: other.length })}</div>}
    {bought.length > 0 && <Bought list={bought} />}
    {!items.length && <Watch />}
  </div>
}

// ---------------------------------------------------------------- wish list

function WishTile({ p, d, rest }: { p: Any; d: Diff; rest: number }) {
  const g = groupOf(d), have = soulsHave(rest)
  return (
    <div data-wish={p.id} data-score={d.score} data-group={g} onClick={() => showOnMap(p, d)} data-tip={d.best ? t('merch.show') : undefined}
      className={cn(TILE, TILE_P, d.best && TILE_CLICK)}>
      <PetPic p={p} />
      <div className={T_BODY}>
        <div className="flex min-w-0 items-center gap-1.5">
          <span data-name="" className={cn(T_TITLE, 'min-w-0 flex-1')}>{petName(p)}</span>
          <LvChip id={p.id} />
          {g !== 'none' && <Tier d={d} />}
        </div>
        <div className={cn(SUB, 'mt-0.5 truncate text-dim')}>{[p.c, p.ev ? t('merch.evOnly') : g !== 'none' && whereLine(d)].filter(Boolean).join(' · ')}</div>
        <div className={T_FOOT}>
          <SoulBar have={have} />
          <div className={T_META}>
            <span data-missing={rest} data-tip={t('merch.souls.tip', { n: have, max: MAX_SOULS })}>
              <b className="font-semibold text-foreground">{have}</b>/{MAX_SOULS}
            </span>
            {d.best && <MapPin className="size-3.5 flex-none text-dim" />}
          </div>
        </div>
      </div>
    </div>
  )
}

const GROUPS: Group[] = ['none', 'hard', 'easy']
const WISH_GRID = grid('row')

function Wishlist() {
  const all = wishlist(), q = (V.merchQ || '').trim().toLowerCase()
  const rows = all.filter(x => (!V.merchHard || x.d.score >= HARD) && (!q || hit(x.p, q)))
  return <div>
    <Sect sub={'· ' + t('merch.wish.sub', { n: all.length })}>{t('merch.wish')}</Sect>
    <div className="flex items-center gap-1 px-1.5 pb-1">
      <Field value={V.merchQ || ''} onChange={v => { V.merchQ = v; bump() }} placeholder={t('merch.search')} className="h-6 flex-1 text-[12px]" data-merchsearch="" />
      <button onClick={() => { V.merchHard = !V.merchHard; bump() }} data-tip={t('merch.hardOnly.tip', { n: HARD })} className={cn(CHIP, V.merchHard && CHIP_ON)}>{t('merch.hardOnly')}</button>
    </div>
    {!all.length ? <Note>{t('merch.wish.empty')}</Note> : !rows.length ? <Note>{t('merch.wish.none')}</Note> : GROUPS.map(g => {
      const list = rows.filter(x => groupOf(x.d) === g)
      if (!list.length) return null
      return (
        <section key={g} data-wishgroup={g} data-count={list.length}>
          <Sect sub={<><b className="font-semibold text-muted-foreground tabular-nums">{list.length}</b> · {t('merch.g.' + g + '.sub')}</>}
            className={g === 'hard' ? 'text-gold/80' : undefined}>{t('merch.g.' + g)}</Sect>
          <div className={WISH_GRID}>{list.map(x => <WishTile key={x.p.id} {...x} />)}</div>
        </section>
      )
    })}
  </div>
}

const FACS = ['all', 'Asmodian', 'Elyos']

export function MerchantTab() {
  useApp()
  const [, tick] = useState(0)
  useEffect(() => { const i = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(i) }, [])
  const fac = myFaction() || 'all'
  const bar = <>
    <BarInfo>{t('merch.next', { t: mmss(msToNext(Date.now())) })}</BarInfo>
    <BarRight>
      <AppSelect value={fac} tip={t('merch.fac.tip')} className="h-6 text-xs" options={FACS.map(f => ({ value: f, label: t('merch.fac.' + f) }))}
        onChange={v => { U.merchFac = v; saveUi(['merchFac']); bump() }} />
    </BarRight>
  </>
  return (
    <Page w="rows" bar={bar}>
      {!mapsLoaded() && <Hint tone="cyan">{t('merch.loading')}</Hint>}
      {!hasState() && <Hint>{t('merch.noState')}</Hint>}
      <div className="grid items-start gap-x-2 @min-[900px]:grid-cols-[minmax(0,330px)_minmax(0,1fr)] @min-[1300px]:grid-cols-[minmax(0,370px)_minmax(0,1fr)]">
        <OfferList />
        <Wishlist />
      </div>
      <Foot>{t('merch.how', { n: HARD })}</Foot>
    </Page>
  )
}
