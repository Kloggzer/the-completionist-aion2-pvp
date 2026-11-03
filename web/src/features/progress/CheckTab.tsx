// Checklist dashboard: number tiles (open daily / weekly, characters, reset), the warnings, the characters as compact
// rows, then the server/account items (shared by all characters); a character's own list on its page. Entries and
// charges are tiles: icon column left, name, bar + footer, −/+ column at the right edge; the explanation of an entry
// is in its tooltip, the explanation of the page in a closed "how it works".
import { useEffect, useState } from 'react'
import { CalendarDays, CheckCheck, ChevronLeft, ChevronRight, Pencil, Plus, RefreshCw, RotateCcw, Server, Sun, Trash2, UserCheck, Users, Zap } from 'lucide-react'
import { chargeLight, chargesOf } from './charges'
import { S, U, V, bump, manual, useApp } from '@/core/state'
import { t, hm } from '@/core/i18n'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CHECK, CHECK_ICON, charKey, CHECK_ICON_DEFAULT, TIER, TIER_TONE, resetIn, checkAuto, checkCount, checkSet, characters, nextReset, progressOf, removeChar, setAll, addChar, renameChar, selectChar, type Kind, type Per } from './checklist'
import { AppSelect } from '@/components/AppSelect'
import { ACCENT, AutoBadge, BOX, Bar, BarInfo, BarRight, Columns, HowTo, Kpi, KpiRow, META, Note, Page, Panel, ROW, ROW_CLICK, ROWS, SECT_BTN, SUB, Sect, StepCol, T_BODY, T_FOOT, T_META, T_PORTRAIT, T_TITLE, TILE, TILE_P, TONE, TextEntry, TileIcon, TopN, grid } from '@/components/kit'
import { alerts, ownerAlertsOf, ownerLevel } from './alerts'
import { AlertList, AlertRow, Charges, LIGHT_DOT } from './ChargeRows'

const pct = (f: number) => Math.round(f * 100) + ' %'
const GRID = grid('row')

/** One entry: icon in the priority colour, name, bar, count + badges, −/+ column; the explanation is in the tooltip. */
function Entry({ id, max, per, kind, char }: { id: string; max: number; per: Per; kind: Kind; char?: string }) {
  const c = checkCount(id, per, kind, char), full = c >= max, auto = checkAuto(id, per, kind, char), tier = TIER[id] ?? 2
  // bonus entries from items (login list), only the Ascension trial so far
  const bonus = id === 'ascensionTrial' ? U.entryBonus?.['ascension|' + (char ?? charKey())] ?? 0 : 0
  const tip = t('progress.item.' + id) + ' – ' + t('progress.tip.' + id) + (per === 'server' ? t('progress.perServer') : '') + (auto ? t('progress.isAuto') : '')
  return (
    <div data-check={id} data-done={full || undefined} data-tip={tip} className={cn(TILE, TILE_P, 'pr-0', full && 'border-green/30')}>
      <TileIcon icon={CHECK_ICON[id] || CHECK_ICON_DEFAULT} tone={full ? 'green' : TIER_TONE[tier]} tip={t('chk.tier.' + tier)} />
      <div className={T_BODY}>
        <span className={cn(T_TITLE, full && TONE.ok)}>{t('progress.item.' + id)}</span>
        <div className={T_FOOT}>
          <Bar frac={c / max} />
          <div className={T_META}>
            <span className="flex min-w-0 items-center gap-1.5">
              <b className={cn('font-semibold', full ? TONE.ok : 'text-foreground')}>{full ? '✓ ' : ''}{c}/{max}</b>
              {auto && <AutoBadge tip={t('progress.autoTip')} />}
              {!!bonus && <span className="text-cyan" data-tip={t('charge.bonusTip')}>+{bonus} {t('charge.bonus')}</span>}
            </span>
            <span className={cn('truncate', full ? TONE.off : tier === 1 ? TONE.warn : tier === 2 ? TONE.info : TONE.off)}>{t('chk.tier.' + tier)}</span>
          </div>
        </div>
      </div>
      <StepCol onStep={d => checkSet(id, per, kind, max, c + d, char)} minus={c > 0} plus={!full} tips={['−1', '+1']} />
    </div>
  )
}

/** Daily + weekly blocks of one owner (one <Columns> cell each), each a section line with progress and an "all done" / "reset" action. */
function Lists({ per, char, only }: { per: Per; char?: string; only?: Kind }) {
  return <>
    {CHECK.map(([kind, all]) => {
      const items = all.filter(i => i[2] === per)
      if (!items.length || (only && kind !== only)) return null
      const done = items.filter(([id, max]) => checkCount(id, per, kind, char) >= max).length, allDone = done === items.length
      return (
        <div key={kind}>
          <Sect sub={<span className={cn(allDone && TONE.ok)}>{t('progress.doneOf', { n: done, total: items.length })}</span>} right={
            <button className={SECT_BTN} onClick={() => setAll(per, kind, !allDone, char)} data-tip={allDone ? t('chk.resetTip') : t('chk.allDoneTip')}>
              {allDone ? <><RotateCcw />{t('chk.reset')}</> : <><CheckCheck />{t('chk.allDone')}</>}
            </button>}>{t('progress.sect.' + kind)}</Sect>
          <div className={GRID}>{items.map(([id, max]) => <Entry key={id} id={id} max={max} per={per} kind={kind} char={char} />)}</div>
        </div>
      )
    })}
  </>
}

/** Completion ring with the percentage inside, in a portrait-sized box (the "portrait" of an owner tile). */
function RingBox({ frac, level, live, icon: I }: { frac: number; level: 'red' | 'yellow' | null; live?: boolean; icon?: typeof Server }) {
  const size = 44, r = size / 2 - 3, c = 2 * Math.PI * r, col = frac >= 1 ? 'var(--green)' : frac > 0 ? 'var(--gold)' : 'var(--dim)'
  return (
    <span className={cn(T_PORTRAIT, 'relative grid flex-none place-items-center rounded-sm border', frac >= 1 ? BOX.green : level === 'red' ? BOX.red : level === 'yellow' ? BOX.gold : live ? BOX.cyan : BOX.dim)}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="stroke-foreground/10" strokeWidth="3.5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${c * frac} ${c}`} />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[11px] font-bold text-foreground tabular-nums">
        {I ? <I className="size-4 text-muted-foreground" strokeWidth={1.75} /> : Math.round(frac * 100)}
      </span>
    </span>
  )
}

/** Small completion ring of a list row. */
function MiniRing({ frac }: { frac: number }) {
  const size = 20, r = 7.5, c = 2 * Math.PI * r, col = frac >= 1 ? 'var(--green)' : frac > 0 ? 'var(--gold)' : 'var(--dim)'
  return (
    <svg width={size} height={size} className="flex-none -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="stroke-foreground/10" strokeWidth="3" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${c * frac} ${c}`} />
    </svg>
  )
}

/** Owner tile body (character page head): name (live dot, alert dot), status, daily/weekly split, open entries. */
function OwnerBody({ name, live, level, per, char, right }: { name: string; live?: boolean; level: 'red' | 'yellow' | null; per: Per; char?: string; right?: React.ReactNode }) {
  const d = progressOf(per, char, 'd'), w = progressOf(per, char, 'w'), open = openList(per, char)
  return (
    <div className={T_BODY}>
      <span className="flex min-w-0 items-center gap-1.5">
        {live && <i className="size-1.5 flex-none rounded-full bg-green shadow-[0_0_5px_var(--green)]" data-tip={t(manual() ? 'chk.active' : 'chk.live')} />}
        <span className={cn(T_TITLE, 'text-[13px]')}>{name}</span>
        {level && <i className={cn('size-2 flex-none rounded-full', LIGHT_DOT[level])} data-tip={t('alert.' + level)} />}
        {right && <span className="ml-auto flex flex-none items-center gap-1">{right}</span>}
      </span>
      <div className={cn(SUB, 'mt-0.5 truncate')}>{manual() ? t(live ? 'chk.activeSub' : 'chk.inactiveSub') : live ? t('chk.liveSub') : t('chk.manualSub')}</div>
      <div className={T_FOOT}>
        <Bar frac={progressOf(per, char)} />
        <div className={T_META}>
          <span className="truncate">{t('progress.sect.d')} {pct(d)} · {t('progress.sect.w')} {pct(w)}</span>
          <span className={cn('flex-none', open.length ? TONE.warn : TONE.ok)}>{open.length ? t('chk.openN', { n: open.length }) : '✓ ' + t('chk.complete')}</span>
        </div>
      </div>
    </div>
  )
}

/** What an owner still needs, for the tooltip. */
const openList = (per: Per, char?: string) => CHECK.flatMap(([kind, items]) => items.filter(([id, max, p]) => p === per && checkCount(id, p, kind, char) < max)
  .map(([id, max, p]) => `${t('progress.item.' + id)} ${checkCount(id, p, kind, char)}/${max}`))
/** Number of open entries of an owner in one period. */
const countOf = (per: Per, kind: Kind) => CHECK.filter(([k]) => k === kind).flatMap(([, items]) => items).filter(i => i[2] === per).length
const openOf = (per: Per, kind: Kind, char?: string) =>
  CHECK.filter(([k]) => k === kind).flatMap(([, items]) => items).filter(([id, max, p]) => p === per && checkCount(id, p, kind, char) < max).length

const charName = (name: string) => (name === 'Standard' ? t('chk.unknownChar') : name)

// Character row on the dashboard: small completion ring, name + status dots, split, open count. Opens the character's page.
function CharRow({ name, live }: { name: string; live: boolean }) {
  const open = openList('char', name), lvl = ownerLevel('char', name)
  return (
    <button data-char={name} data-tip={open.length ? `${t('chk.open')}: ${open.join(', ')}` : t('chk.everything')} onClick={() => { V.chkPage = name; bump(); document.querySelector('[data-list]')?.scrollTo(0, 0) }}
      className={cn('group w-full text-left', ROW, ROW_CLICK, lvl === 'red' && 'bg-red/[0.06]')}>
      <MiniRing frac={progressOf('char', name)} />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="truncate font-semibold">{charName(name)}</span>
        {live && <i className="size-1.5 flex-none rounded-full bg-green shadow-[0_0_5px_var(--green)]" data-tip={t(manual() ? 'chk.active' : 'chk.live')} />}
        {lvl && <i className={cn('size-2 flex-none rounded-full', LIGHT_DOT[lvl])} data-tip={t('alert.' + lvl)} />}
      </span>
      <span className={cn(META, 'hidden flex-none @min-[480px]:inline')}>{t('progress.sect.d')} {pct(progressOf('char', name, 'd'))} · {t('progress.sect.w')} {pct(progressOf('char', name, 'w'))}</span>
      <span className={cn('w-16 flex-none text-right text-[12px] tabular-nums', open.length ? TONE.warn : TONE.ok)}>{open.length ? t('chk.openN', { n: open.length }) : '✓'}</span>
      <ChevronRight className="size-4 flex-none text-dim transition-colors group-hover:text-gold" />
    </button>
  )
}

// Two clicks instead of a confirm() dialog (dialogs need an activated window, the overlay never takes focus).
function RemoveButton({ name }: { name: string }) {
  const [armed, setArmed] = useState(false)
  return (
    <Button variant={armed ? 'destructive' : 'ghost'} size="xs" className={cn('h-6 text-[11px]', !armed && 'text-muted-foreground hover:text-red')}
      data-tip={t('chk.remove')} onMouseLeave={() => setArmed(false)} onClick={() => (armed ? removeChar(name) : setArmed(true))}>
      <Trash2 />{armed ? t('chk.removeAsk') : t('chk.remove')}
    </Button>
  )
}

/** Name field for adding / renaming a character (manual mode). */
function NameEntry({ init = '', onDone, onCancel }: { init?: string; onDone: (name: string) => boolean; onCancel: () => void }) {
  const [v, setV] = useState(init), [bad, setBad] = useState(false)
  const ok = () => { if (onDone(v)) onCancel(); else setBad(true) }
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1" onClick={e => e.stopPropagation()}>
      <TextEntry value={v} onChange={x => { setV(x); setBad(false) }} onSubmit={ok} onCancel={onCancel} placeholder={t('chk.addPh')} className={cn('w-40 flex-1', bad && 'border-red')} />
      <Button size="xs" variant="outline" disabled={!v.trim()} onClick={ok}>{t('chk.ok')}</Button>
      <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={onCancel}>{t('chk.cancel')}</Button>
      {bad && <span className="w-full text-[11px] text-red">{t('chk.exists')}</span>}
    </span>
  )
}

/** Manual mode: make active / rename on a character's page. */
function ManualCharActions({ name, live, onRename }: { name: string; live: boolean; onRename: () => void }) {
  return <>
    {!live && <Button size="xs" variant="outline" className="h-6 text-[11px]" data-tip={t('chk.selectTip')} onClick={() => selectChar(name)}><UserCheck />{t('chk.select')}</Button>}
    <Button size="xs" variant="ghost" className="h-6 text-muted-foreground" data-tip={t('chk.rename')} onClick={onRename}><Pencil /></Button>
  </>
}

/** Reset countdown tile (daily, weekly below). */
const ResetKpi = () => <Kpi icon={RefreshCw} label={t('chk.kpi.reset')} value={resetIn(nextReset('d'))} sub={t('home.kpi.weekly', { d: resetIn(nextReset('w')) })} data-kpi="reset" />

/** One character's own page (reached from the dashboard): owner tile with remove, alerts, charges, lists. */
function CharPage({ name, live }: { name: string; live: boolean }) {
  const lvl = ownerLevel('char', name), man = manual(), [renaming, setRenaming] = useState(false)
  const right = man ? <ManualCharActions name={name} live={live} onRename={() => setRenaming(true)} /> : null
  const d = openOf('char', 'd', name), w = openOf('char', 'w', name), nd = countOf('char', 'd'), nw = countOf('char', 'w')
  // charges: the worst light decides the tile (their own tiles below say the details)
  const lights = chargesOf('char').map(c => chargeLight(c, name)), full = lights.filter(l => l === 'red').length, soon = lights.filter(l => l === 'yellow').length
  return <>
    <KpiRow>
      <Kpi icon={Sun} label={t('chk.kpi.daily')} value={d || '✓'} tone={d ? undefined : 'ok'} sub={d ? t('chk.kpi.ofN', { n: nd }) : t('chk.kpi.allDone', { n: nd })} data-kpi="daily" />
      <Kpi icon={CalendarDays} label={t('chk.kpi.weekly')} value={w || '✓'} tone={w ? undefined : 'ok'} sub={w ? t('chk.kpi.ofN', { n: nw }) : t('chk.kpi.allDone', { n: nw })} data-kpi="weekly" />
      <Kpi icon={Zap} label={t('chk.kpi.charges')} value={full ? t('chk.kpi.full', { n: full }) : soon ? t('chk.kpi.soon', { n: soon }) : '✓'}
        tone={full ? 'bad' : soon ? 'warn' : 'ok'} sub={t('chk.kpi.chargesSub')} data-kpi="charges" />
      <ResetKpi />
    </KpiRow>
    <div className="px-2.5 pt-2.5">
      <div className={cn(TILE, TILE_P, live && 'border-green/30', lvl && ACCENT[lvl])}>
        <RingBox frac={progressOf('char', name)} level={lvl} live={live} />
        {renaming
          ? <NameEntry init={name === 'Standard' ? '' : name} onCancel={() => setRenaming(false)}
            onDone={to => { const ok = renameChar(name, to); if (ok) { V.chkPage = to.trim(); bump() } return ok }} />
          : <OwnerBody name={charName(name)} live={live} level={lvl} per="char" char={name} right={right} />}
      </div>
    </div>
    {/* charge warnings are left out here: the charge tiles below show them */}
    <div className="pt-1.5"><AlertList alerts={ownerAlertsOf('char', name).filter(a => !a.charge)} showChar={false} /></div>
    {/* daily first (the most frequent), charges next to it, the weekly list in its own column */}
    <Columns><div><Lists per="char" char={name} only="d" /><Charges per="char" char={name} /></div><Lists per="char" char={name} only="w" /></Columns>
    {!live && <div className="flex justify-end px-2.5 pt-3"><RemoveButton name={name} /></div>}
  </>
}

/** Server block header: one section line with icon, share, progress and open count. */
function ServerHead() {
  const lvl = ownerLevel('server', null), open = openList('server')
  return (
    <Sect className="pt-4" sub={<>{t('chk.serverSub')} · {pct(progressOf('server'))}</>}
      right={<span data-tip={open.length ? `${t('chk.open')}: ${open.join(', ')}` : undefined} className={cn('flex items-center gap-1.5 text-[12px]', open.length ? TONE.warn : TONE.ok)}>
        {lvl && <i className={cn('size-2 flex-none rounded-full', LIGHT_DOT[lvl])} data-tip={t('alert.' + lvl)} />}
        {open.length ? t('chk.openN', { n: open.length }) : '✓ ' + t('chk.complete')}
      </span>}>
      <span data-server className="flex items-center gap-1.5 text-[13px] text-foreground"><Server className="size-3.5 text-cyan" />{t('chk.server')}</span>
    </Sect>
  )
}

export function CheckTab() {
  useApp()
  const [adding, setAdding] = useState(false)
  const chars = characters(), live = S.state.charName, man = manual()
  // default page (once per visit, so nothing jumps while the dashboard is in use): the logged-in character's own page;
  // the dashboard is one click away ("All characters"). null = the dashboard was chosen (back, links).
  if (V.chkPage === undefined) V.chkPage = !man && live && chars.includes(live) ? live : null
  useEffect(() => () => { V.chkPage = undefined }, [])
  if (V.chkPage && !chars.includes(V.chkPage)) V.chkPage = null
  const warn = alerts()
  const more = (k: number) => t('common.moreN', { n: k })
  const sumOpen = (kind: Kind) => chars.reduce((s, c) => s + openOf('char', kind, c), openOf('server', kind))
  const dOpen = sumOpen('d'), wOpen = sumOpen('w'), complete = chars.filter(c => progressOf('char', c) >= 1).length
  const bar = <>
    {V.chkPage
      ? <Button variant="ghost" size="xs" className="h-6 text-[12px] text-muted-foreground" onClick={() => { V.chkPage = null; bump() }}><ChevronLeft />{t('chk.back')}</Button>
      : <BarInfo>{t('chk.title')}</BarInfo>}
    {V.chkPage && <span data-drag className="h-6 min-w-2 flex-1 cursor-grab" />}
    {man && chars.length > 0 && <BarRight><AppSelect value={live && chars.includes(live) ? live : ''} tip={t('chk.activeSel')} className="h-6 max-w-40 text-xs"
      options={[...(live && chars.includes(live) ? [] : [{ value: '', label: '–' }]), ...chars.map(c => ({ value: c, label: charName(c) }))]}
      onChange={c => c && selectChar(c)} /></BarRight>}
  </>
  return (
    <Page w="rows" bar={bar}>
      {V.chkPage ? <CharPage name={V.chkPage} live={V.chkPage === live} /> : <>
        <KpiRow>
          <Kpi icon={Sun} label={t('chk.kpi.daily')} value={dOpen || '✓'} tone={dOpen ? undefined : 'ok'} sub={t('chk.kpi.openAll')} data-kpi="daily" />
          <Kpi icon={CalendarDays} label={t('chk.kpi.weekly')} value={wOpen || '✓'} tone={wOpen ? undefined : 'ok'} sub={t('chk.kpi.openAll')} data-kpi="weekly" />
          <Kpi icon={Users} label={t('chk.kpi.done')} value={chars.length ? `${complete}/${chars.length}` : '–'} tone={chars.length && complete === chars.length ? 'ok' : undefined} sub={t('chk.kpi.charsDone')} data-kpi="chars" />
          <ResetKpi />
        </KpiRow>
        {warn.length > 0 && (
          <Panel title={t('alert.title')} sub={t('alert.sub')} data-chk-alerts>
            <div className={ROWS}><TopN id="chk.alerts" items={warn} n={3} more={more} render={(a, i) => <AlertRow key={i} a={a} flat />} /></div>
          </Panel>
        )}
        <Panel title={t('chk.chars')} right={man && !adding && <button data-add-char className={SECT_BTN} data-tip={t('chk.addTip')} onClick={() => setAdding(true)}><Plus />{t('chk.add')}</button>} data-chars>
          <div className={ROWS}>
            {adding && <div className={cn(ROW, 'py-1')}><NameEntry onDone={addChar} onCancel={() => setAdding(false)} /></div>}
            {chars.map(c => <CharRow key={c} name={c} live={c === live} />)}
            {!chars.length && !adding && <Note>{t(man ? 'chk.noCharsManual' : 'chk.noChars')}</Note>}
          </div>
        </Panel>
        <ServerHead />
        <Columns><div><Lists per="server" only="d" /><Charges per="server" /></div><Lists per="server" only="w" /></Columns>
      </>}
      <div className="pt-2"><HowTo id="chk.how" title={t('chk.how')}>{t(man ? 'chk.hintManual' : 'chk.hint', { hh: hm(nextReset('d')) })}</HowTo></div>
    </Page>
  )
}
