// "Händler" tab: number tiles (next offer, worth buying now, missing pets, hard to farm), the Black Cloud Merchant's
// current offer (read from the game when its window opens, or entered by hand; cleared on the full hour) with a verdict
// per pet by the souls still missing to Lv 3, and the missing pets (below Lv 3) in three panels (merchant only / hard /
// easy to farm, the easy one closed), ranked by farm difficulty × missing souls. Clicking a pet shows its spawns in the
// Targets tab. Offers are portrait tiles (kit anatomy), the missing pets list rows; the offer column sits left of the
// list from 900 px.
import { useEffect, useState } from 'react'
import { Brain, CircleHelp, Clock, Gamepad2, Leaf, MapPin, Mountain, PawPrint, Plus, Search, ShoppingCart, Sparkles, Store, Undo2, X, type LucideIcon } from 'lucide-react'
import { U, V, bump, hasState, saveUi, useApp, type Any } from '@/core/state'
import { emit } from '@/core/bus'
import { goTab } from '@/core/nav'
import { mapName, selectMap, petName } from '@/core/data'
import { fmt, t } from '@/core/i18n'
import { cn } from '@/lib/utils'
import { AppSelect } from '@/components/AppSelect'
import { BOX, BarInfo, BarRight, Chip, Disclosure, Field, Hint, HowTo, Kpi, KpiRow, ListRow, Note, Page, Panel, ROWS, SUB, Seg, T_BODY, T_FOOT, T_META, T_TITLE, TILE, TILE_CLICK, TILE_P, TileIcon, TopN, grid, rich } from '@/components/kit'
import { Button } from '@/components/ui/button'
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

/** Farm effort as a readable badge (easy / hard / very hard); the score is in the tooltip. */
function Tier({ d }: { d: Diff }) {
  const n = tierOf(d)
  return (
    <span data-tier={n} data-tip={t('merch.tier.' + n) + ' · ' + t('merch.score.tip', { n: d.score })}
      className={cn('flex-none rounded-md border px-1.5 text-[11px] leading-[18px] font-semibold', n === 3 ? BOX.gold : n === 2 ? 'border-foreground/15 text-foreground' : BOX.dim)}>
      {t('merch.tierShort.' + n)}
    </span>
  )
}

/** Where to farm, one muted line: (other faction's territory ·) map · zone · n spawns · the other reasons (Named, …). */
function whereLine(d: Diff): string {
  const txt = (k: string) => d.reasons.filter(x => (k === 'enemy') === (x.k === 'enemy') && x.k !== 'spawns' && x.k !== 'none')
    .map(x => t('merch.r.' + x.k, x.k === 'enemy' ? { fac: t('merch.fac.' + x.v!.fac) } : x.v))
  if (!d.best) return [t('merch.noMap'), ...txt('other')].join(' · ')
  const z = bestZone(d.best)
  return [...txt('enemy'), t('merch.where', { map: mapName(d.best.name), zone: z ? ' · ' + z : '', n: d.best.n }), ...txt('other')].join(' · ')
}

const VERDICT_PILL: Record<OfferVerdict, string> = {
  event: 'border-gold/60 text-gold', buy: 'border-gold bg-gold text-primary-foreground', opt: 'border-cyan/30 text-cyan', have: 'border-foreground/10 text-dim', unknown: 'border-foreground/10 text-dim',
}

/** Combobox over the pet names: type, arrows, Enter / click adds the pet to the offer. */
function Picker() {
  const [q, setQ] = useState(''), [hi, setHi] = useState(0)
  const taken = new Set(offers().items.map(o => o.id))
  // computed on every render (a few hundred names): a memo keyed on the query went stale when the offer or the pet
  // data changed
  const s = q.trim().toLowerCase()
  const list = !s ? [] : [...new Map([...merchantPets(), ...eventPets()].map(p => [p.id, p])).values()].filter(p => !taken.has(p.id) && hit(p, s))
    .sort((a, b) => +!petName(a).toLowerCase().startsWith(s) - +!petName(b).toLowerCase().startsWith(s) || petName(a).localeCompare(petName(b))).slice(0, 8)
  const add = (p: Any) => { setOffers([...offers().items, { id: p.id }]); setQ(''); setHi(0) }
  const key = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { setHi(h => Math.min(h + 1, list.length - 1)); e.preventDefault() }
    else if (e.key === 'ArrowUp') { setHi(h => Math.max(h - 1, 0)); e.preventDefault() }
    else if (e.key === 'Enter' && list[hi]) add(list[hi])
    else if (e.key === 'Escape') setQ('')
  }
  return (
    <div className="relative px-2.5 pb-2">
      <span className="relative flex items-center">
        <Plus className="pointer-events-none absolute left-2 size-3.5 text-dim" />
        <Field value={q} onChange={v => { setQ(v); setHi(0) }} onKey={key} placeholder={t('merch.add')} tip={t('merch.add.tip')} className="w-full pl-7"
          role="combobox" aria-expanded={q ? 'true' : 'false'} data-merchpicker="" />
      </span>
      {q.trim() && (
        <div role="listbox" className="absolute inset-x-2.5 top-8 z-20 overflow-hidden rounded-lg border bg-popover shadow-lg">
          {list.length ? list.map((p, i) => {
            const v = offerKind({ id: p.id }).v
            return (
              <div key={p.id} role="option" aria-selected={i === hi} onMouseDown={e => { e.preventDefault(); add(p) }} onMouseEnter={() => setHi(i)}
                className={cn('flex cursor-pointer items-center gap-2 px-2 py-1 text-[12.5px]', i === hi && 'bg-accent')}>
                <PetPic p={p} size={20} />
                <span className="min-w-0 flex-1 truncate">{petName(p)}</span>
                {p.c && <span className="text-[11px] text-dim">{p.c}</span>}
                <i className={cn('rounded-[3px] border px-1 text-[11px] font-semibold not-italic', VERDICT_PILL[v])}>{t('merch.v.' + v)}</i>
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

/** Offer tile: name + verdict, what one purchase brings + Kinah per soul, the soul bar, price field. Buy count, where
 *  to farm and the base price are in the tooltip. */
function OfferTile({ o }: { o: Offer }) {
  const { p, name, v } = offerKind(o)
  const rest = p ? soulsLeft(o.id) : 0, d = p ? diffOf(p) : null
  const setPrice = (s: string) => {
    const n = parseInt(s.replace(/\D/g, ''), 10)
    setOffers(offers().items.map(x => (x.id === o.id ? { ...x, price: Number.isFinite(n) ? n : undefined } : x)), false)
  }
  const off = discount(o), have = soulsHave(rest), b = buyInfo(rest), click = !!(p && d?.best)
  const tip = [t('merch.v.' + v + '.tip'),
    p && d && v !== 'have' && v !== 'event' ? t('merch.buys', { buys: b.buys }) + ' · ' + t('merch.lv', { lv: petLevel(o.id) }) : '',
    p && d && v !== 'have' ? (p.ev ? t('merch.evOnly') : whereLine(d)) : '',
    off > 0 ? t('merch.base', { n: fmt(o.base!) }) : '',
    click ? t('merch.show') : ''].filter(Boolean).join('\n')
  return (
    <div data-offer={o.id} data-verdict={v} onClick={click ? () => showOnMap(p, d!) : undefined} data-tip={tip}
      className={cn(TILE, TILE_P, click && TILE_CLICK, (v === 'buy' || v === 'event') && 'border-gold/45 bg-gold/[0.04]', (v === 'have' || v === 'unknown') && 'opacity-70')}>
      <PetPic p={p ?? (name ? { n: name } : null)} />
      <div className={T_BODY}>
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cn(T_TITLE, 'min-w-0 flex-1')}>{name ?? t('merch.unknown', { id: o.item ?? o.id })}</span>
          {o.tab != null && <GameTag />}
          <span className={cn('flex-none rounded-md border px-1.5 text-[11px] leading-[18px] font-semibold', VERDICT_PILL[v])}>{t('merch.v.' + v)}</span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-baseline gap-1.5">
          <span className={cn(SUB, 'min-w-0 flex-1 truncate')}>
            {v === 'event' ? t('merch.event.sub') : !p || !d ? t('merch.v.unknown.tip')
              : v === 'have' ? t('merch.lv3')
                : <span data-missing={rest} data-buy={b.buys} className={v === 'buy' ? 'text-foreground' : undefined}>{t('merch.buy', { s: SOULS_PER_BUY, n: soulsHave(b.after), max: MAX_SOULS })}</span>}
          </span>
          {o.price ? <span data-persoul={perSoul(o.price)} data-tip={t('merch.perSoul.tip', { s: SOULS_PER_BUY })}
            className={cn('flex-none text-[12px] font-semibold tabular-nums', v === 'buy' ? 'text-gold' : 'text-muted-foreground')}>{t('merch.perSoul', { n: fmt(perSoul(o.price)) })}</span> : null}
        </div>
        <div className={T_FOOT}>
          {p && <SoulBar have={have} add={v === 'have' ? 0 : SOULS_PER_BUY} />}
          <div className={T_META} onClick={e => e.stopPropagation()}>
            <span className="flex min-w-0 items-center gap-1.5">
              <Field value={o.price != null ? fmt(o.price) : ''} onChange={setPrice} onBlur={() => saveUi(['merch', 'merchAlt'])} onKey={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                placeholder={t('merch.price')} tip={t('merch.price.tip')} className="h-6 w-[78px] px-1.5 text-right text-[11.5px] tabular-nums" data-price="" />
              {off > 0 && <span data-discount={off} data-tip={t('merch.base', { n: fmt(o.base!) })} className="flex-none text-dim">-{off} %</span>}
            </span>
            <Button variant="ghost" size="icon-xs" data-tip={t('merch.remove')} aria-label={t('merch.remove')} className="text-dim"
              onClick={() => setOffers(offers().items.filter(x => x.id !== o.id))}><X /></Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Top picks of the missing pets (shown while the offer is empty): what to look out for at the merchant. */
function Watch() {
  const top = wishlist().slice(0, 8)
  if (!top.length) return null
  return (
    <Panel title={t('merch.watch')} sub={t('merch.watch.sub')} data-watch={String(Math.min(4, top.length))}>
      <div className={ROWS}>
        <TopN id="merch.watch" items={top} n={4} more={more} render={({ p, d, rest }) => (
          <ListRow key={p.id} data-watchpet={String(p.id)} onClick={d.best ? () => showOnMap(p, d) : undefined} tip={d.best ? t('merch.show') : whereLine(d)}
            icon={<PetPic p={p} size={22} />} title={petName(p)}
            meta={<span data-tip={t('merch.souls.tip', { n: soulsHave(rest), max: MAX_SOULS })}>{t('merch.souls', { n: soulsHave(rest), max: MAX_SOULS })}</span>}
            right={d.spawns ? <Tier d={d} /> : <Store data-tip={t('merch.g.none') + ' · ' + t('merch.g.none.sub')} aria-label={t('merch.g.none')} className="size-3.5 text-dim" />} />
        )} />
      </div>
    </Panel>
  )
}

/** Bought offers: one muted row each, undo per row; closed by default. */
function Bought({ list }: { list: Offer[] }) {
  return (
    <Panel className="pb-1.5" data-bought={String(list.length)}>
      <Disclosure id="merch.bought" title={t('merch.bought')} sub={t('merch.bought.n', { n: list.length })}>
        <div className={cn(ROWS, 'mt-1')}>
          {list.map(o => {
            const { p, name } = offerKind(o)
            const at = new Date(o.bought!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            return (
              <ListRow key={o.id} data-boughtoffer={String(o.id)} tip={t('merch.bought.tip', { t: at, s: SOULS_PER_BUY })} className="text-muted-foreground"
                icon={<PetPic p={p ?? (name ? { n: name } : null)} size={20} />}
                title={<span className="line-through decoration-foreground/25">{name ?? t('merch.unknown', { id: o.item ?? o.id })}</span>}
                meta={t('merch.bought.row', { s: SOULS_PER_BUY }) + (o.price ? ' · ' + fmt(o.price) : '')}
                right={<Button variant="ghost" size="icon-xs" data-tip={t('merch.bought.undo')} data-unbuy="" aria-label={t('merch.bought.undo')} className="text-dim"
                  onClick={() => setOffers(offers().items.map(x => (x.id === o.id ? { ...x, bought: undefined } : x)))}><Undo2 /></Button>} />
            )
          })}
        </div>
      </Disclosure>
    </Panel>
  )
}

/** Characters with an offer this hour (only when there is more than the current one): a Seg for up to three, else a dropdown. */
function CharChips() {
  const alt = freshAlt(U.merchAlt, Date.now())
  const names = Object.keys(alt).sort()
  if (!names.length) return null
  const cur = freshOffers(U.merch, Date.now()), view = viewAlt()
  const label = (c: string | null, o: Offers) => {
    const name = (c ?? cur.c) || t('merch.char.none'), n = buyCount(o)
    return n ? t('merch.char.buy', { c: name, n }) : t('merch.char.n', { c: name, n: o.items.filter(x => !x.bought).length })
  }
  const opts = [{ value: '', label: label(null, cur), tip: t('merch.char.tip', { c: cur.c || t('merch.char.none') }) },
    ...names.map(c => ({ value: c, label: label(c, alt[c]), tip: t('merch.char.tip', { c }) }))]
  const pick = (v: string) => { V.merchView = v || null; bump() }
  return (
    <div data-charchips={names.length + 1} className="flex px-2.5 pb-2">
      {opts.length <= 3
        ? <Seg size="sm" value={view ?? ''} onChange={pick} options={opts} className="w-full [&>*]:flex-1"
          item={c => ({ 'data-charchip': c, 'data-active': (view ?? '') === c ? '' : undefined })} />
        : <AppSelect value={view ?? ''} options={opts} onChange={pick} tip={t('merch.char.pick')} className="h-7 w-full text-xs" />}
    </div>
  )
}

function OfferList() {
  const cur = offers()
  const bought = cur.items.filter(o => o.bought).sort((a, b) => b.bought! - a.bought!)
  const items = cur.items.filter(o => !o.bought).map(o => {
    const { p, v } = offerKind(o)
    return { o, rank: OFFER_ORDER[v], prio: p ? priority(soulsLeft(p.id), diffOf(p)) : 0 }
  }).sort((a, b) => a.rank - b.rank || b.prio - a.prio)
  const other = cur.other || []
  return <div className="min-w-0">
    <Panel title={t('merch.offer')} sub={items.length ? t('merch.offer.n', { n: items.length }) : undefined} className="overflow-visible" data-offers={String(items.length)}>
      <CharChips />
      <Picker />
      {items.length ? <div className={cn(grid('row'), '@min-[900px]:grid-cols-1 pb-2.5')}>{items.map(x => <OfferTile key={x.o.id} o={x.o} />)}</div>
        : bought.length ? null : <p data-offerempty="" data-tip={t('merch.offer.help')} className={cn(SUB, 'px-3 pb-2.5 leading-snug')}>
          {rich(t('merch.offer.none'))} <span className="text-dim tabular-nums">{t('merch.next', { t: mmss(msToNext(Date.now())) })}</span>
        </p>}
      {other.length > 0 && <div data-other={other.length} className="px-3 pb-2 text-[11.5px] text-dim"
        data-tip={other.map(x => t('merch.otherItem', { id: x.item, price: fmt(x.price), off: discount(x) })).join(' · ')}>{t('merch.other', { n: other.length })}</div>}
    </Panel>
    {!items.length && <Watch />}
    {bought.length > 0 && <Bought list={bought} />}
  </div>
}

// ---------------------------------------------------------------- missing pets

function WishRow({ p, d, rest }: { p: Any; d: Diff; rest: number }) {
  const g = groupOf(d), have = soulsHave(rest)
  const where = [p.c, p.ev ? t('merch.evOnly') : g !== 'none' && whereLine(d)].filter(Boolean).join(' · ')
  return (
    <ListRow data-wish={String(p.id)} data-score={String(d.score)} data-group={g} onClick={() => showOnMap(p, d)}
      tip={[petName(p) + ' · ' + t('merch.lv', { lv: petLevel(p.id) }), where, d.best ? t('merch.show') : ''].filter(Boolean).join('\n')}
      icon={<PetPic p={p} size={22} />}
      title={<span data-name="">{petName(p)}</span>} sub={where || undefined}
      meta={<span data-souls={have} data-missing={rest} data-tip={t('merch.souls.tip', { n: have, max: MAX_SOULS })}>
        <b className="font-semibold text-foreground">{have}</b>/{MAX_SOULS}
      </span>}
      right={<>{g !== 'none' && <Tier d={d} />}{d.best ? <MapPin className="size-3.5 text-dim" /> : <span className="w-3.5" />}</>} />
  )
}

const GROUPS: Group[] = ['none', 'hard', 'easy']

function Wishlist() {
  const all = wishlist(), q = (V.merchQ || '').trim().toLowerCase()
  const rows = all.filter(x => (!V.merchHard || x.d.score >= HARD) && (!q || hit(x.p, q)))
  return <div className="min-w-0">
    <div className="flex flex-wrap items-center gap-1.5 px-2.5 pt-2.5">
      <span className="flex min-w-0 flex-[1_1_10rem] items-center gap-1.5 px-0.5 text-[12px] font-semibold text-muted-foreground">
        <span className="flex-none">{t('merch.wish')}</span><span className="min-w-0 truncate font-normal">{t('merch.wish.sub', { n: all.length })}</span>
      </span>
      <span className="ml-auto flex min-w-0 flex-[1_1_14rem] items-center gap-1.5">
        <span className="relative flex min-w-0 flex-1 items-center">
          <Search className="pointer-events-none absolute left-2 size-3.5 text-dim" />
          <Field value={V.merchQ || ''} onChange={v => { V.merchQ = v; bump() }} placeholder={t('merch.search')} className="w-full pl-7" data-merchsearch="" />
        </span>
        <Chip on={!!V.merchHard} onChange={v => { V.merchHard = v; bump() }} tip={t('merch.hardOnly.tip', { n: HARD })}><Mountain />{t('merch.hardOnly')}</Chip>
      </span>
    </div>
    {!all.length ? <Panel><Note className="py-2.5">{t('merch.wish.empty')}</Note></Panel>
      : !rows.length ? <Panel><Note className="py-2.5">{t('merch.wish.none')}</Note></Panel>
        : GROUPS.map(g => {
          const list = rows.filter(x => groupOf(x.d) === g)
          if (!list.length) return null
          const body = <div className={ROWS}><TopN id={'merch.top.' + g} items={list} n={5} more={more} render={x => <WishRow key={x.p.id} {...x} />} /></div>
          const sub = t('merch.g.n', { n: list.length }) + ' · ' + t('merch.g.' + g + '.sub')
          return g === 'easy'
            ? <Panel key={g} className="pb-1.5" data-wishgroup={g} data-count={String(list.length)}>
              <Disclosure id="merch.g.easy" title={t('merch.g.' + g)} sub={sub}><div className="mt-1">{body}</div></Disclosure>
            </Panel>
            : <Panel key={g} title={<span className={g === 'hard' ? 'text-gold' : undefined}>{t('merch.g.' + g)}</span>} sub={sub} data-wishgroup={g} data-count={String(list.length)}>{body}</Panel>
        })}
  </div>
}

const FACS = ['all', 'Asmodian', 'Elyos']
const more = (k: number) => t('common.moreN', { n: k })

/** The answer: countdown to the next offer, what to buy now, how many pets are missing, how many are hard to farm. */
function Kpis() {
  const cur = offers(), all = wishlist()
  const buy = buyCount(cur), open = cur.items.filter(x => !x.bought).length, hard = all.filter(x => groupOf(x.d) === 'hard').length
  return (
    <KpiRow>
      <Kpi icon={Clock} label={t('merch.kpi.next')} value={mmss(msToNext(Date.now()))} sub={t('merch.kpi.nextSub')} data-kpi="next" />
      <Kpi icon={ShoppingCart} label={t('merch.kpi.buy')} value={open ? fmt(buy) : '–'} tone={buy ? 'warn' : undefined}
        sub={open ? t('merch.kpi.buySub', { n: open }) : t('merch.kpi.noOffer')} data-kpi="buy" />
      <Kpi icon={PawPrint} label={t('merch.kpi.missing')} value={fmt(all.length)} sub={t('merch.kpi.missingSub')} data-kpi="missing" />
      <Kpi icon={Mountain} label={t('merch.kpi.hard')} value={fmt(hard)} sub={t('merch.kpi.hardSub', { n: HARD })} tip={t('merch.hardOnly.tip', { n: HARD })} data-kpi="hard" />
    </KpiRow>
  )
}

export function MerchantTab() {
  useApp()
  const [, tick] = useState(0)
  useEffect(() => { const i = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(i) }, [])
  const fac = myFaction() || 'all', who = viewAlt() ?? offers().c
  const bar = <>
    <BarInfo tip={t('tab.merchant.tip')}>{who ? t('merch.bar.c', { c: who }) : t('merch.bar')}</BarInfo>
    <BarRight>
      <AppSelect value={fac} tip={t('merch.fac.tip')} className="h-6 text-xs" options={FACS.map(f => ({ value: f, label: t('merch.fac.' + f) }))}
        onChange={v => { U.merchFac = v; saveUi(['merchFac']); bump() }} />
    </BarRight>
  </>
  return (
    <Page w="rows" bar={bar}>
      {!mapsLoaded() && <Hint tone="cyan">{t('merch.loading')}</Hint>}
      {!hasState() && <Hint>{t('merch.noState')}</Hint>}
      <Kpis />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start @min-[900px]:grid-cols-[minmax(0,360px)_minmax(0,1fr)] @min-[1300px]:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
        <OfferList />
        <Wishlist />
      </div>
      <Panel className="pb-1.5">
        <HowTo id="merch.how" title={t('merch.howTitle')}>{t('merch.how', { n: HARD })}</HowTo>
      </Panel>
    </Page>
  )
}
