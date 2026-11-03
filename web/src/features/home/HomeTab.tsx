// Overview ("Übersicht"): four number tiles (reset, pets here, next boss, checklist), the urgent warnings, then panels
// "up next", "open today", "farm here" with the top few rows each; "almost done" behind a disclosure. Every block links
// to its tab; the common actions (+1, bell) work right here.
import { Clock, ListChecks, PawPrint, Plus, RefreshCw, Skull, Star, User, type LucideIcon } from 'lucide-react'
import { G, S, U, V, hasState, useApp, type Any } from '@/core/state'
import { selectMap, mapName, petName } from '@/core/data'
import { goTab } from '@/core/nav'
import { fmtDist } from '@/core/geo'
import { hm, fmt, t } from '@/core/i18n'
import { cn } from '@/lib/utils'
import { Bar, BarInfo, BellBtn, Disclosure, GameIcon, Kpi, KpiRow, META, More, Note, Page, Panel, ROW, ROW_CLICK, ROW_ICON, ROWS, SUB, TONE, TopN, DoneMark } from '@/components/kit'
import { Portrait } from '@/components/Portrait'
import { soulPets } from '@/features/pets/logic'
import { allBosses, fbStatus, occOn, occurrences, timerName, timerOn, timerWhere, toggleBossBell, toggleOnce } from '@/features/events/events'
import { KIND_ICON } from '@/features/events/TimerTab'
import { CHECK, CHECK_GAME, CHECK_ICON, CHECK_ICON_DEFAULT, TIER, TIER_TONE, charKey, checkCount, checkSet, nextReset, resetIn, type Kind, type Per } from '@/features/progress/checklist'
import { alerts } from '@/features/progress/alerts'
import { AlertRow } from '@/features/progress/ChargeRows'
import { achRows, loc } from '@/features/progress/achievements'

const leftTxt = (ms: number, now: number) => {
  const m = Math.round((ms - now) / 60000)
  return m <= 0 ? t('home.now') : m < 60 ? t('timer.inMin', { m }) : t('timer.inHMin', { h: Math.floor(m / 60), m: m % 60 })
}

// ---------------------------------------------------------------- data

type Next = { ms: number; key: string; Icon: LucideIcon; por?: number; name: string; where: string; due: boolean; go: () => void; bell: boolean; toggle: () => void; tip: string }

/** Enabled events and field bosses (current map + belled ones), by time. An event's bell here mutes / unmutes only
 *  that occurrence (toggleOnce), never the whole series; a muted occurrence of an enabled series stays listed. */
function upNext(now: number, n: number): Next[] {
  const evs = (G.timers || []).filter((ev: Any) => ev.kind !== 'reset')
    .flatMap((ev: Any) => occurrences(ev, now - 60e3, now + 864e5).filter(ms => occOn(ev, ms) || timerOn(ev)).map(ms => ({ ms, ev }))).sort((a: Any, b: Any) => a.ms - b.ms).slice(0, n)
  const bosses = nextBosses(n)
  return [
    ...evs.map(({ ms, ev }: Any) => ({ ms, key: ev.id + ms, Icon: KIND_ICON[ev.kind] || Clock, name: timerName(ev), where: timerWhere(ev), due: false,
      go: () => goTab('timer'), bell: occOn(ev, ms), toggle: () => toggleOnce(ev, ms), tip: occOn(ev, ms) ? t('home.onceOff') : t('home.onceOn') })),
    ...bosses.map(({ b, s }) => ({ ms: s.due!, key: b.key, Icon: Skull, por: bossPor(b), name: b.name, due: s.k === 'due',
      where: b.map === U.map ? '' : mapName(G.maps.find((m: Any) => m.key === b.map)?.name || ''),
      go: () => { if (b.map !== U.map) selectMap(b.map); goTab('boss') }, bell: !!U.bossBells?.[b.key], toggle: () => toggleBossBell(b.key),
      tip: U.bossBells?.[b.key] ? t('timer.bellOn') : t('timer.bellOff') })),
  ].sort((a, b) => a.ms - b.ms).slice(0, n)
}
/** Portrait index of a field boss (its species on the boss's map). */
const bossPor = (b: Any): number | undefined => G.md[b.map]?.species?.[b.id]?.por

function nextBosses(n: number) {
  return allBosses().filter(b => b.map === U.map || U.bossBells?.[b.key])
    .map(b => ({ b, s: fbStatus(b) })).filter(x => (x.s.k === 'wait' || x.s.k === 'due') && x.s.due)
    .sort((a, c) => a.s.due! - c.s.due!).slice(0, n)
}

/** Checklist entries of the logged-in character (own + server items). */
function checkItems() {
  const out: { id: string; max: number; per: Per; kind: Kind; c: number }[] = []
  for (const [kind, items] of CHECK) for (const [id, max, per] of items) out.push({ id, max, per, kind, c: checkCount(id, per, kind) })
  return out
}

// ---------------------------------------------------------------- blocks

const more = (k: number) => t('common.moreN', { n: k })
/** Panels side by side: one column on the overlay, two from 900 px, three from 1300 px. */
const PANELS = 'grid items-start gap-2.5 px-2.5 pt-2.5 @min-[900px]:grid-cols-2 @min-[1300px]:grid-cols-3 [&>*]:m-0 [&>*]:min-w-0'

function NextRows({ rows, now }: { rows: Next[]; now: number }) {
  if (!G.timers) return <Note>{t('timer.loading')}</Note>
  if (!rows.length) return <Note>{t('home.next.none')}</Note>
  return <div className={ROWS}><TopN id="home.next" items={rows} n={4} more={more} render={r => (
    <div key={r.key} className={cn(ROW, ROW_CLICK, 'pr-0')} onClick={r.go} data-tip={r.name + (r.where ? ' · ' + r.where : '')}>
      <b className="w-10 flex-none font-normal tabular-nums">{hm(r.ms)}</b>
      {r.por != null ? <Portrait por={r.por} size={22} className="-my-1" /> : <span className={cn(ROW_ICON, 'text-muted-foreground')}><r.Icon /></span>}
      <span className="min-w-0 flex-1 truncate">{r.name}{r.where && <i className="ml-1 text-[11px] not-italic text-dim">{r.where}</i>}</span>
      <span className={cn('flex-none text-[11px] whitespace-nowrap text-cyan tabular-nums', (r.due || r.ms - now < 10 * 60e3) && 'font-semibold text-gold')}>
        {r.due ? t('home.due') : leftTxt(r.ms, now)}
      </span>
      <BellBtn on={r.bell} onClick={e => { e.stopPropagation(); r.toggle() }} tip={r.tip} />
    </div>
  )} /></div>
}

function OpenToday({ all }: { all: ReturnType<typeof checkItems> }) {
  // Most important first: priority tier, then daily before weekly, then the most advanced.
  const open = all.filter(o => o.c < o.max)
    .sort((a, b) => (TIER[a.id] ?? 2) - (TIER[b.id] ?? 2) || (a.kind === b.kind ? 0 : a.kind === 'd' ? -1 : 1) || b.c / b.max - a.c / a.max)
  return (
    <Panel title={t('home.openToday')} sub={t('home.important')} right={<More onClick={() => goTab('check')}>{t('home.allN', { n: all.length })}</More>} data-home-open>
      <div className={ROWS}>
        {!open.length && <Note className={TONE.ok}><DoneMark /> {t('chk.everything')}</Note>}
        <TopN id="home.open" items={open} n={5} more={more} render={o => {
          const I = CHECK_ICON[o.id] || CHECK_ICON_DEFAULT, tier = TIER[o.id] ?? 2
          return (
            <div key={o.id} className={ROW} data-tip={[t('progress.sect.' + o.kind), t('chk.tier.' + tier), t('progress.tip.' + o.id)].filter(Boolean).join(' · ')}>
              <span className={cn(ROW_ICON, TIER_TONE[tier] === 'gold' ? 'text-gold' : TIER_TONE[tier] === 'cyan' ? 'text-cyan' : 'text-dim')}><GameIcon name={CHECK_GAME[o.id]} fallback={I} className="size-[18px]" fallbackClass="size-4" /></span>
              <span className="min-w-0 flex-1 truncate">{t('progress.item.' + o.id)}</span>
              <span className={META}>{o.c}/{o.max}</span>
              <button onClick={() => checkSet(o.id, o.per, o.kind, o.max, o.c + 1)} data-tip={t('home.plus')}
                className="-mr-1 grid size-6 flex-none place-items-center rounded-md border text-muted-foreground hover:border-gold/50 hover:text-gold"><Plus className="size-3.5" /></button>
            </div>
          )
        }} />
      </div>
    </Panel>
  )
}

function FarmHere() {
  const n = V.near, spot = V.spots[0], live = V.live.size
  return (
    <Panel title={t('home.farm')} right={<More onClick={() => goTab('targets')}>{t('tab.targets')}</More>} data-home-farm>
      <div className={ROWS}>
        {!hasState() && <p className={cn(SUB, 'px-3 py-1.5', TONE.warn)}>{t(S.status.state === 'live' || S.replay ? 'pets.age.reading' : 'pets.age.off')}</p>}
        {live > 0 && (
          <div className={cn(ROW, ROW_CLICK, 'text-gold')} onClick={() => goTab('targets')}>
            <Star className="size-3.5 flex-none fill-current" /><span className="min-w-0 flex-1 truncate font-semibold">{t('home.cube', { n: live })}</span>
          </div>
        )}
        {n?.mob && (
          <div className={cn(ROW, ROW_CLICK)} data-tip={`${n.mob.mob.n} → ${petName(n.mob.t.p)}`}
            onClick={() => { V.multi = new Set([n.mob.t.p.id]); V.spotsSel = false; V.spot = V.cube = null; goTab('targets', `[data-pet="${n.mob.t.p.id}"][data-sel]`) }}>
            <span className="w-10 flex-none text-[11.5px] text-dim">{t('map.hudMob')}</span>
            <Portrait por={n.mob.mob.por} size={22} className="-my-1" />
            <span className="min-w-0 flex-1 truncate">{n.mob.mob.n} <i className="text-muted-foreground not-italic">{n.mob.t.souls}/{n.mob.t.need}</i></span>
            <b className="flex-none text-[11px] font-semibold text-cyan tabular-nums">{fmtDist(n.mob.dist)} {n.mob.dir}</b>
          </div>
        )}
        {spot && (
          <div className={cn(ROW, ROW_CLICK)} data-tip={spot.pets.map((p: Any) => petName(p.t.p)).join(', ')}
            onClick={() => { V.spot = spot.rank; V.cube = null; goTab('spots', `[data-spot="${spot.rank}"]`) }}>
            <span className="w-10 flex-none text-[11.5px] text-dim">{t('map.hudSpot')}</span>
            <Portrait por={spot.pets[0]?.t.mobs[0]?.por} size={22} className="-my-1" />
            <span className="min-w-0 flex-1 truncate">{spot.name}</span>
            <span className={META}>{t('pets.spot.pets.other', { n: spot.pets.length })}</span>
          </div>
        )}
        {hasState() && !n?.mob && !spot && <Note>{t('home.farm.none')}</Note>}
      </div>
    </Panel>
  )
}

function AlmostDone({ rows }: { rows: Any[] }) {
  return (
    <Panel className="pb-1" data-home-almost>
      <Disclosure id="home.almost" title={t('home.almost')} sub={rows.length ? t('home.almostSub', { n: rows.length }) : undefined}
        right={<More onClick={() => goTab('ach')}>{t('tab.ach')}</More>}>
        <div className={cn(ROWS, 'mt-1')}>
          {!rows.length && <Note>{t('home.ach.none')}</Note>}
          <TopN id="home.almostAll" items={rows} n={5} more={more} render={r => (
            <div key={r.a.id} className={cn(ROW, ROW_CLICK)} data-tip={r.next ? loc(r.next, 'objective') : ''}
              onClick={() => { V.achSel = r.a.id; goTab('ach', `[data-ach="${r.a.id}"]`) }}>
              <span className="min-w-0 flex-1 truncate">{loc(r.a, 'name')}</span>
              <span className={META}><b className="font-semibold text-foreground">{fmt(r.val)}</b>/{fmt(r.next.goal)}</span>
              <Bar frac={r.frac} className="my-0 w-10" />
            </div>
          )} />
        </div>
      </Disclosure>
    </Panel>
  )
}

export function HomeTab() {
  useApp()
  const now = Date.now(), m = G.md[U.map]
  const sp = soulPets(), have = sp.filter((p: Any) => (S.state.levels[p.id] || 0) > 0).length
  const missing = V.targets.filter((x: Any) => !x.done).length
  const items = checkItems(), done = items.filter(o => o.c >= o.max).length, left = items.length - done
  const boss = nextBosses(1)[0]
  const rows = G.ach ? achRows() : []
  const close = rows.filter(r => !r.done && r.val > 0 && r.frac < 1).sort((a, b) => b.frac - a.frac)
  const warn = alerts()
  const name = S.state.charName || (charKey() === 'Standard' ? t('chk.unknownChar') : charKey())
  const tip = (tab: string) => t('home.open', { tab: t('tab.' + tab) })
  return (
    <Page w="rows" bar={<BarInfo><User /> {[name, m ? mapName(m.name) : ''].filter(Boolean).join(' · ')}</BarInfo>}>
      <KpiRow>
        <Kpi icon={RefreshCw} label={t('home.kpi.reset')} value={resetIn(nextReset('d'))} sub={t('home.kpi.weekly', { d: resetIn(nextReset('w')) })}
          onClick={() => goTab('check')} tip={tip('check')} data-kpi="reset" />
        <Kpi icon={PawPrint} label={t('home.kpi.pets')} value={hasState() ? t('home.missing', { n: missing }) : '–'} tone={hasState() && !missing ? 'ok' : undefined}
          sub={hasState() ? t('home.pets.have', { have, total: sp.length }) : t('home.kpi.noData')} onClick={() => goTab('targets')} tip={tip('targets')} data-kpi="pets" />
        <Kpi icon={Skull} label={t('home.kpi.boss')} value={boss ? (boss.s.k === 'due' ? t('home.due') : hm(boss.s.due!)) : '–'}
          tone={boss ? (boss.s.k === 'due' ? 'warn' : 'info') : undefined} sub={boss ? `${boss.s.k === 'due' ? hm(boss.s.due!) : leftTxt(boss.s.due!, now)} · ${boss.b.name}` : t('home.kpi.noBoss')}
          onClick={() => goTab('boss')} tip={tip('boss')} data-kpi="boss" />
        <Kpi icon={ListChecks} label={t('home.kpi.today')} value={left ? t('chk.openN', { n: left }) : <DoneMark />} tone={left ? undefined : 'ok'}
          sub={t('home.doneOf', { n: done, total: items.length })} onClick={() => goTab('check')} tip={tip('check')} data-kpi="check" />
      </KpiRow>
      {warn.length > 0 && (
        <Panel title={t('alert.title')} sub={t('alert.sub')} right={<More onClick={() => { V.chkPage = null; goTab('check') }}>{t('tab.check')}</More>} data-home-alerts>
          <div className={ROWS}><TopN id="home.alerts" items={warn} n={3} more={more} render={(a, i) => <AlertRow key={i} a={a} flat onOpen={() => goTab('check')} />} /></div>
        </Panel>
      )}
      <div className={PANELS}>
        <Panel title={t('home.next')} right={<More onClick={() => goTab('timer')}>{t('home.allTimers')}</More>} data-home-next>
          <NextRows rows={upNext(now, 12)} now={now} />
        </Panel>
        <OpenToday all={items} />
        <FarmHere />
        <AlmostDone rows={close} />
      </div>
    </Page>
  )
}
