// Achievements: number tiles (open, close to done, title rewards still open, done), then one panel per difficulty
// band with the first few tiles (rest behind "show all"); completed ones wait in a closed disclosure.
import { Award, Castle, Check, CheckCheck, Clock, Coins, Compass, Crown, Flame, Gamepad2, Gem, Hammer, HeartCrack, Hourglass, LayoutGrid, ListChecks, ListTodo, LogIn, PawPrint, Pickaxe, ScrollText, Shield, Skull, Sparkles, Sprout, Square, SquareCheck, Star, Swords, Tornado, TrendingUp, Trophy, Users, type LucideIcon } from 'lucide-react'
import { S, U, G, V, bump, saveUi, manual, useApp, type Any } from '@/core/state'
import { Portrait } from '@/components/Portrait'
import { t, fmt } from '@/core/i18n'
import { cn } from '@/lib/utils'
import { ACH_BANDS, achFaction, achRows, loc, setAch, type AchRow } from './achievements'
import { AppSelect } from '@/components/AppSelect'
import { Bar, BarInfo, BarRight, Chip, Disclosure, Empty, GameIcon, Hint, Kpi, KpiRow, Page, Panel, Seg, Stepper, TopN, rich, T_BODY, T_FOOT, T_META, T_PORTRAIT, T_SUB, T_TITLE, TILE, TILE_CLICK, TILE_P, TILE_SEL, TileIcon, grid, type BoxTone } from '@/components/kit'

const more = (k: number) => t('common.moreN', { n: k })
/** Share of the next tier from which an achievement counts as "close to done". */
const CLOSE = 0.75

function LoginHint() {
  if (manual()) return <Hint tone="cyan">{rich(t('ach.manualHint'))}</Hint>
  return <Hint>{rich(t('progress.achLogin'))}</Hint>
}

/** Manual mode, expanded tile: counter −/+ (and ±10 where there is room). Tiers are ticked in the tier list below. */
function AchEdit({ r }: { r: AchRow }) {
  const max = r.a.tiers.at(-1)?.goal ?? 0
  return (
    <div data-ach-edit className="mt-1.5 flex items-center gap-1.5 rounded-md border border-cyan/25 bg-cyan/[0.04] px-1.5 py-1 text-[12px]" onClick={e => e.stopPropagation()}>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{t('ach.set')}</span>
      <Stepper value={r.val} max={max} big={max >= 20 ? 10 : undefined} onChange={v => setAch(r.a, v)} />
    </div>
  )
}

// Icon per objective type; colour per category. Field boss / NPC kills show the boss portrait when the target
// can be matched to a species of a loaded map (the target name is German, species names English: the boss's own
// name is the last word in both, e.g. "Schweigender Dartan" / "Silent Dartan").
const TYPE_ICON: Record<string, LucideIcon> = {
  Explore: Compass, DungeonClear: Castle, DungeonTask: ListChecks, KillNpc: Skull, KillFieldBoss: Crown, KillPlayer: Swords,
  Enhance: Sparkles, Pet: PawPrint, Collect: Gem, Craft: Hammer, MiniGame: Gamepad2, Gather: Pickaxe, Quest: ScrollText,
  Daevanion: Star, Economy: Coins, Social: Users, Death: HeartCrack, PCLevel: TrendingUp, Login: LogIn, PlayTime: Clock,
  ItemLevel: Shield, Invasion: Tornado,
}
const CAT: Record<string, { tone: BoxTone; key: string; icon: LucideIcon }> = {
  Abenteuer: { tone: 'cyan', key: 'adv', icon: Compass },
  Leben: { tone: 'green', key: 'life', icon: Sprout },
  Kampf: { tone: 'red', key: 'fight', icon: Swords },
  Herausforderung: { tone: 'purple', key: 'chal', icon: Flame },
}
let porByName: Map<string, number> | null = null, porMaps = 0
function bossPortrait(a: Any): number | null {
  if (!a.target || (a.objective_type !== 'KillFieldBoss' && a.objective_type !== 'KillNpc')) return null
  const n = Object.keys(G.md).length
  if (!porByName || porMaps !== n) {
    porByName = new Map(); porMaps = n
    for (const m of Object.values<Any>(G.md)) for (const sp of Object.values<Any>(m.species || {}))
      if ((sp.named || sp.r !== 'Normal') && sp.por != null) porByName.set(String(sp.n).split(' ').pop()!.toLowerCase(), sp.por)
  }
  return porByName.get(String(a.target).split(' ').pop()!.toLowerCase()) ?? null
}

function AchIcon({ a }: { a: Any }) {
  const por = bossPortrait(a)
  if (por != null) return <Portrait por={por} size={null} className={T_PORTRAIT} />
  return <TileIcon icon={TYPE_ICON[a.objective_type] || Trophy} tone={CAT[a.category_de]?.tone || 'gold'} />
}

/** One dot per tier: reached green, current cyan, open dim. */
function Pips({ n, reached }: { n: number; reached: number }) {
  return <span className="flex items-center gap-[3px]">{Array.from({ length: n }, (_, i) =>
    <i key={i} className={cn('size-[5px] rounded-full', i < reached ? 'bg-green' : i === reached ? 'bg-cyan' : 'bg-foreground/15')} />)}</span>
}

const kinahShort = (n: number) => (n >= 1000 ? t('ach.kinahK', { n: fmt(Math.round(n / 1000)) }) : fmt(n))

function Tile({ r }: { r: AchRow }) {
  const a = r.a, sel = V.achSel === a.id, x = r.next, title = x?.rewards?.title, kina = x?.rewards?.kina, man = manual()
  const tip = [`${loc(a, 'name')} – ${loc(a, 'category')}`, x && loc(x, 'objective'),
    title && `${t('progress.titleReward')}: ${title.name}${title.stats ? ' (' + Object.entries(title.stats).map(([k, v]) => k + ' ' + v).join(', ') + ')' : ''}`,
    kina && t('ach.kinah', { n: fmt(kina) }),
    a.tags?.length ? a.tags.map((g: string) => t('progress.tag.' + g)).join(' · ') : ''].filter(Boolean).join('\n')
  return (
    <div data-ach={a.id} data-tip={tip} onClick={() => { V.achSel = sel ? null : a.id; bump() }}
      className={cn(TILE, TILE_CLICK, TILE_P, r.done && 'opacity-55', sel && cn(TILE_SEL, 'col-span-full opacity-100'))}>
      <AchIcon a={a} />
      <div className={T_BODY}>
        <span className={cn(T_TITLE, sel && 'whitespace-normal')}>{loc(a, 'name')}</span>
        <div className={cn(T_SUB, sel && 'line-clamp-none')}>{x ? loc(x, 'objective') : t('progress.achAll')}</div>
        <div className={T_FOOT}>
          <Bar frac={r.frac} />
          <div className={T_META}>
            <span>{x ? <><b className="font-semibold text-foreground">{fmt(r.val)}</b>/{fmt(x.goal)}</> : <Check className="size-3.5 text-green" aria-label={t('progress.band.done')} />}</span>
            <span className="flex min-w-0 items-center gap-1.5">
              {title && <Award className="size-3.5 flex-none text-gold" aria-label={t('progress.titleReward')} />}
              {!!kina && <span className="flex flex-none items-center gap-0.5 whitespace-nowrap text-dim"><GameIcon name="kinah" fallback={Coins} className="size-3.5" />{kinahShort(kina)}</span>}
              <Pips n={a.tiers.length} reached={r.reached} />
            </span>
          </div>
        </div>
        {sel && man && <AchEdit r={r} />}
        {sel && (
          <div className="mt-1.5 flex flex-col gap-0.5 text-[11.5px] text-muted-foreground">
            {a.tiers.map((y: Any, i: number) => {
              const ok = i < r.reached, now = i === r.reached
              // Manual mode: a tier row ticks the tier (counter = its goal); the last reached one unticks (previous goal).
              const back = i ? a.tiers[i - 1].goal : 0, tick = man && (!ok || i === r.reached - 1)
              const I = man ? (ok ? SquareCheck : Square) : ok ? Check : null
              return (
                <div key={i} data-tier={man ? i + 1 : undefined} data-ok={ok ? 'on' : 'off'} data-tip={tick ? t(ok ? 'ach.untickTip' : 'ach.tickTip', { goal: fmt(ok ? back : y.goal) }) : undefined}
                  onClick={tick ? e => { e.stopPropagation(); setAch(a, ok ? back : y.goal) } : undefined}
                  className={cn('flex flex-wrap items-center gap-x-1.5 gap-y-0.5', ok && 'text-dim', now && 'text-foreground', tick && 'cursor-pointer rounded-sm hover:bg-foreground/5')}>
                  <span className={cn('grid w-3.5 flex-none place-items-center font-semibold text-dim tabular-nums', ok && 'text-green', now && 'text-cyan')}>
                    {I ? <I className="size-3.5" /> : y.tier}
                  </span>
                  {loc(y, 'objective')} <span className="text-foreground tabular-nums">{fmt(y.goal)}</span>
                  {y.rewards?.title && <em className="flex items-center gap-1 text-gold not-italic"><Award className="size-3.5" /> {y.rewards.title.name}</em>}
                  {y.rewards?.kina ? <span className="flex items-center gap-0.5 text-dim"><GameIcon name="kinah" fallback={Coins} className="size-3.5" />{t('ach.kinah', { n: fmt(y.rewards.kina) })}</span> : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/** Tiles of one band: the first `n`, the rest behind "show all"; the selected tile always stays visible. */
function Tiles({ id, rows, n }: { id: string; rows: AchRow[]; n: number }) {
  const at = rows.findIndex(r => r.a.id === V.achSel)
  return (
    <div className={cn(grid('pet'), 'pt-0.5')}>
      <TopN id={id} items={rows} n={Math.max(n, at + 1)} more={more} moreClass="col-span-full px-1" render={r => <Tile key={r.a.id} r={r} />} />
    </div>
  )
}

const CATS = ['', ...Object.values(CAT).map(c => c.key)]
const CAT_ICON: Record<string, LucideIcon> = { '': LayoutGrid, ...Object.fromEntries(Object.values(CAT).map(c => [c.key, c.icon])) }

export function AchTab() {
  useApp()
  if (!G.ach) return <Empty>{t('progress.achLoading')}</Empty>
  const has = Object.keys(S.state.ach || {}).length > 0
  let rows = achRows()
  if (U.achCat) rows = rows.filter(r => CAT[r.a.category_de]?.key === U.achCat)
  const open = rows.filter(r => !r.done), done = rows.length - open.length
  const close = open.filter(r => r.frac >= CLOSE).length
  const titles = open.filter(r => r.a.tiers.slice(r.reached).some((y: Any) => y.rewards?.title)).length
  open.sort((x, y) => x.diff - y.diff || y.frac - x.frac)
  // group the open ones into difficulty bands (rows are sorted by difficulty)
  const bands: { b: number; rows: AchRow[] }[] = []
  for (const r of open) {
    const b = ACH_BANDS.findIndex(([max]) => r.diff < max)
    if (bands.at(-1)?.b !== b) bands.push({ b, rows: [] })
    bands.at(-1)!.rows.push(r)
  }
  const doneRows = rows.filter(r => r.done)
  const cat = U.achCat || ''
  const bar = <>
    <BarInfo>{t('progress.achSort')}</BarInfo>
    <BarRight>
      {manual() && <AppSelect value={U.faction || achFaction() || 'all'} tip={t('ach.faction')} className="h-6 text-xs"
        options={['all', 'Elyos', 'Asmodian'].map(f => ({ value: f, label: t('ach.faction.' + f) }))}
        onChange={v => { U.faction = v; saveUi(['faction']); bump() }} />}
      <Seg size="sm" value={cat} labelClass="@max-[520px]/main:hidden" item={k => ({ 'data-cat': k || 'all' })}
        options={CATS.map(k => ({ value: k, icon: CAT_ICON[k], label: t('progress.cat.' + (k || 'all')), tip: t('progress.cat.' + (k || 'all')) }))}
        onChange={k => { U.achCat = k || null; saveUi(['achCat']); bump() }} />
      <Chip on={!!U.achDone} onChange={on => { U.achDone = on; saveUi(['achDone']); bump() }} tip={t('progress.achShowDoneTip')} className="h-6 px-2 text-[11.5px]">
        <CheckCheck />{t('progress.achShowDone')}
      </Chip>
    </BarRight>
  </>
  return (
    <Page bar={bar}>
      {!has && <LoginHint />}
      <KpiRow>
        <Kpi icon={ListTodo} label={t('ach.kpi.open')} value={fmt(open.length)} sub={cat ? t('progress.cat.' + cat) : t('ach.kpi.openSub')} data-kpi="open" />
        <Kpi icon={Hourglass} label={t('ach.kpi.close')} value={fmt(close)} sub={t('ach.kpi.closeSub', { n: Math.round(CLOSE * 100) })} tone={close ? 'ok' : undefined} data-kpi="close" />
        <Kpi icon={Award} label={t('ach.kpi.titles')} value={fmt(titles)} sub={t('ach.kpi.titlesSub')} data-kpi="titles" />
        <Kpi icon={Trophy} label={t('ach.kpi.done')} value={`${fmt(done)} / ${fmt(rows.length)}`} sub={t('ach.kpi.doneSub', { n: rows.length ? Math.round(done / rows.length * 100) : 0 })} data-kpi="done" />
      </KpiRow>
      {!open.length && !U.achDone && <Panel><Empty>{t('ach.allDone')}</Empty></Panel>}
      {bands.map(({ b, rows }) => (
        <Panel key={b} title={t(ACH_BANDS[b][1])} sub={t('ach.bandN', { n: fmt(rows.length) })} data-band={String(b)} className="pb-1">
          <Tiles id={'ach.band.' + b} rows={rows} n={6} />
        </Panel>
      ))}
      {U.achDone && doneRows.length > 0 && (
        <Panel className="pb-1.5" data-band="done">
          <Disclosure id="ach.done" title={t('progress.band.done')} sub={t('ach.bandN', { n: fmt(doneRows.length) })}>
            <div className="pt-1"><Tiles id="ach.band.done" rows={doneRows} n={6} /></div>
          </Disclosure>
        </Panel>
      )}
    </Page>
  )
}
