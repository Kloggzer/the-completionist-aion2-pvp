// Checklist dashboard: the reset countdown in the bar, number tiles (open daily / weekly), the warnings, the characters as compact
// rows, then the server/account items (shared by all characters); a character's own list on its page. Entries and
// charges are tiles: icon column left, name, bar + footer, −/+ column at the right edge; the explanation of an entry
// is in its tooltip, the explanation of the page in a closed "how it works".
import { useEffect, useState } from 'react'
import { CalendarDays, CheckCheck, ChevronLeft, Pencil, Plus, RefreshCw, RotateCcw, Server, Sun, Trash2, UserCheck } from 'lucide-react'
import { entryBonusKey } from './charges'
import { S, U, V, bump, manual, useApp } from '@/core/state'
import { t, hm } from '@/core/i18n'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CHECK, CHECK_GAME, CHECK_ICON, lastReset, CHECK_ICON_DEFAULT, TIER, TIER_TONE, resetIn, checkAuto, checkCount, checkSet, characters, nextReset, progressOf, removeChar, setAll, addChar, renameChar, selectChar, type Kind, type Per } from './checklist'
import { AppSelect } from '@/components/AppSelect'
import { ACCENT, AutoBadge, Disclosure, BOX, Bar, BarInfo, BarRight, Columns, HowTo, Kpi, KpiRow, Note, Page, Panel, ROW, ROWS, SECT_BTN, SUB, Sect, StepCol, T_BODY, T_FOOT, T_META, T_PORTRAIT, T_TITLE, TILE, TILE_P, TONE, TextEntry, TileIcon, TopN, grid, DoneMark } from '@/components/kit'
import { alertKey, alerts, ownerAlertsOf, ownerLevel } from './alerts'
import { AlertList, AlertRow, Charges, LIGHT_DOT } from './ChargeRows'
import { CharCards, ServerRow } from './CharCards'

const pct = (f: number) => Math.round(f * 100) + ' %'
const GRID = grid('row')

/** One entry: icon in the priority colour, name, bar, count + badges, −/+ column; the explanation is in the tooltip. */
function Entry({ id, max, per, kind, char }: { id: string; max: number; per: Per; kind: Kind; char?: string }) {
  const c = checkCount(id, per, kind, char), full = c >= max, auto = checkAuto(id, per, kind, char), tier = TIER[id] ?? 2
  // bonus entries from items (login list: Ascension trial, daily dungeons)
  const bonus = U.entryBonus?.[entryBonusKey(id, per, char)] ?? 0
  // arena modes: the wins this week beside the matches
  const wins = id === 'arena' || id === 'coopArena' ? U.pvpWins?.[id + '|' + (char ?? S.state.charName)] : null
  const winsNow = wins && wins.r === lastReset('w').getTime() ? wins.n : 0
  const tip = t('progress.item.' + id) + ' – ' + t('progress.tip.' + id) + (per === 'server' ? t('progress.perServer') : '') + (auto ? t('progress.isAuto') : '')
  return (
    <div data-check={id} data-done={full || undefined} data-tip={tip} className={cn(TILE, TILE_P, 'pr-0', full && 'border-green/30')}>
      <TileIcon icon={CHECK_ICON[id] || CHECK_ICON_DEFAULT} game={CHECK_GAME[id]} tone={full ? 'green' : TIER_TONE[tier]} tip={t('chk.tier.' + tier)} />
      <div className={T_BODY}>
        <span className={cn(T_TITLE, full && TONE.ok)}>{t('progress.item.' + id)}</span>
        <div className={T_FOOT}>
          <Bar frac={c / max} />
          <div className={T_META}>
            <span className="flex min-w-0 items-center gap-1.5">
              <b className={cn('font-semibold', full ? TONE.ok : 'text-foreground')}>{full && <><DoneMark /> </>}{c}/{max}</b>
              {auto && <AutoBadge tip={t('progress.autoTip')} />}
              {!!bonus && <span className="text-cyan" data-tip={t('charge.bonusTip')}>+{bonus} {t('charge.bonus')}</span>}
              {wins !== null && <span className="text-muted-foreground" data-tip={t('chk.winsTip')}>{t('chk.wins', { n: winsNow })}</span>}
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
          <span className={cn('flex-none', open.length ? TONE.warn : TONE.ok)}>{open.length ? t('chk.openN', { n: open.length }) : <><DoneMark /> {t('chk.complete')}</>}</span>
        </div>
      </div>
    </div>
  )
}

/** What an owner still needs, for the tooltip. */
const openList = (per: Per, char?: string) => CHECK.flatMap(([kind, items]) => items.filter(([id, max, p]) => p === per && checkCount(id, p, kind, char) < max)
  .map(([id, max, p]) => `${t('progress.item.' + id)} ${checkCount(id, p, kind, char)}/${max}`))
/** Number of open entries of an owner in one period. */
const openOf = (per: Per, kind: Kind, char?: string) =>
  CHECK.filter(([k]) => k === kind).flatMap(([, items]) => items).filter(([id, max, p]) => p === per && checkCount(id, p, kind, char) < max).length

const charName = (name: string) => (name === 'Standard' ? t('chk.unknownChar') : name)

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
    <Button size="xs" variant="ghost" className="h-6 text-muted-foreground" data-tip={t('chk.rename')} aria-label={t('chk.rename')} onClick={onRename}><Pencil /></Button>
  </>
}

/** Reset countdown of the bar (daily, then weekly). */
const resetTxt = () => `${t('chk.kpi.reset')} ${resetIn(nextReset('d'))} · ${t('home.kpi.weekly', { d: resetIn(nextReset('w')) })}`

/** One character's own page (reached from the dashboard): owner tile (daily / weekly split, open count) with remove,
 *  alerts, charges, lists. */
function CharPage({ name, live }: { name: string; live: boolean }) {
  const lvl = ownerLevel('char', name), man = manual(), [renaming, setRenaming] = useState(false)
  const right = man ? <ManualCharActions name={name} live={live} onRename={() => setRenaming(true)} /> : null
  return <>
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
        {open.length ? t('chk.openN', { n: open.length }) : <><DoneMark /> {t('chk.complete')}</>}
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
  // V.chkPage = the page chosen since (back, links, rename; undefined = none); a gone character shows the dashboard.
  const [first] = useState<string | null>(() => (V.chkPage !== undefined ? V.chkPage : !man && live && chars.includes(live) ? live : null))
  useEffect(() => () => { V.chkPage = undefined }, [])
  const want: string | null = V.chkPage !== undefined ? V.chkPage : first, page = want && chars.includes(want) ? want : null
  const warn = alerts()
  const more = (k: number) => t('common.moreN', { n: k })
  const sumOpen = (kind: Kind) => chars.reduce((s, c) => s + openOf('char', kind, c), openOf('server', kind))
  const dOpen = sumOpen('d'), wOpen = sumOpen('w')
  const bar = <>
    {page
      ? <Button variant="ghost" size="xs" className="h-6 text-[12px] text-muted-foreground" onClick={() => { V.chkPage = null; bump() }}><ChevronLeft />{t('chk.back')}</Button>
      : null}
    <BarInfo tip={t('chk.title')}><RefreshCw /> {resetTxt()}</BarInfo>
    {man && chars.length > 0 && <BarRight><AppSelect value={live && chars.includes(live) ? live : ''} tip={t('chk.activeSel')} className="h-6 max-w-40 text-xs"
      options={[...(live && chars.includes(live) ? [] : [{ value: '', label: '–' }]), ...chars.map(c => ({ value: c, label: charName(c) }))]}
      onChange={c => c && selectChar(c)} /></BarRight>}
  </>
  return (
    <Page w="rows" bar={bar}>
      {page ? <CharPage name={page} live={page === live} /> : <>
        <KpiRow>
          <Kpi icon={Sun} label={t('chk.kpi.daily')} value={dOpen || <DoneMark />} tone={dOpen ? undefined : 'ok'} sub={t('chk.kpi.openAll')} data-kpi="daily" />
          <Kpi icon={CalendarDays} label={t('chk.kpi.weekly')} value={wOpen || <DoneMark />} tone={wOpen ? undefined : 'ok'} sub={t('chk.kpi.openAll')} data-kpi="weekly" />
        </KpiRow>
        {warn.length > 0 && (
          <Panel title={t('alert.title')} sub={t('alert.sub')} data-chk-alerts>
            <div className={ROWS}><TopN id="chk.alerts" items={warn} n={3} more={more} render={a => <AlertRow key={alertKey(a)} a={a} flat />} /></div>
          </Panel>
        )}
        {/* the server's shared entries and keys in one row, then one card per character (click: its page) */}
        <ServerRow />
        <div data-chars="">
          <CharCards chars={chars} />
          {(man || !chars.length) && <div className="flex flex-wrap items-center gap-2 px-2.5 pt-2.5">
            {!chars.length && !adding && <Note>{t(man ? 'chk.noCharsManual' : 'chk.noChars')}</Note>}
            {man && (adding
              ? <div className={cn(ROW, 'flex-1 rounded-lg border bg-card py-1')}><NameEntry onDone={addChar} onCancel={() => setAdding(false)} /></div>
              : <button data-add-char className={SECT_BTN} data-tip={t('chk.addTip')} onClick={() => setAdding(true)}><Plus />{t('chk.add')}</button>)}
          </div>}
        </div>
        {/* counting the server entries by hand (manual mode, corrections): closed by default */}
        <div className="pt-2.5"><Panel className="pb-1.5">
          <Disclosure id="chk.serverEdit" title={t('chk.serverEdit')} sub={t('chk.serverEditSub')}>
            <ServerHead />
            <Columns><div><Lists per="server" only="d" /><Charges per="server" /></div><Lists per="server" only="w" /></Columns>
          </Disclosure>
        </Panel></div>
      </>}
      <div className="pt-2"><HowTo id="chk.how" title={t('chk.how')}>{t(man ? 'chk.hintManual' : 'chk.hint', { hh: hm(nextReset('d')) })}</HowTo></div>
    </Page>
  )
}
