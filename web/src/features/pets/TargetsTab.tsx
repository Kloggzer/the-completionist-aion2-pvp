// "Ziele" tab: missing soul pets on the current map as tiles, plus what is near the player.
import type { ReactNode } from 'react'
import { Check, Crosshair, Ghost, PawPrint, Star, Unlock } from 'lucide-react'
import { G, S, U, V, bump, hasState, manual, useApp, type Any } from '@/core/state'

import { emit } from '@/core/bus'
import { mapName, petName } from '@/core/data'
import { ago, dirTo, fmtDist, posAge } from '@/core/geo'
import { fmt, t } from '@/core/i18n'
import { cn } from '@/lib/utils'
import { Disclosure, Hint, Kpi, KpiRow, ListRow, Page, Panel, ROWS, T_BODY, T_FOOT, T_META, T_PORTRAIT, T_SUB, T_TITLE, TILE as KTILE, TILE_CLICK, TILE_P, TILE_SEL, TopN, Bar, grid } from '@/components/kit'
import { Portrait } from '@/components/Portrait'
import { lvTxt, mobGroups, toggleMulti } from './logic'
import { Dot, Empty, Pbar, PinBox, SelBar, rich } from './parts'
import { PetControls } from './manual'

// Portrait tiles (kit anatomy): portrait column left; title, two-line sub, bar and footer right.
const GRID = grid('pet'), TILE = cn(KTILE, TILE_CLICK, TILE_P), SEL = TILE_SEL
const more = (k: number) => t('common.moreN', { n: k })

// Click toggles the pet in the selection (several at once: map highlight + "find spot").
function selectPet(id: number) { V.sel = null; toggleMulti(id) }

function selectCube(key: string) {
  V.cube = V.cube === key ? null : key
  if (V.cube && !U.layers.cubes) U.layers.cubes = true
  emit('fit'); emit('draw'); bump()
}

function NoStateHint() {
  if (S.replay) return null
  return (
    <Hint>{rich(t(S.status.state === 'live' ? 'pets.login.live' : 'pets.login.off'))}</Hint>
  )
}

// Manual mode: how to enter progress, until the first soul is entered.
function ManualHint() {
  const st = S.state
  if (Object.keys(st.levels).length || Object.values<number>(st.souls).some(n => n > 0)) return null
  return <Hint tone="cyan">{rich(t('man.petsHint'))}</Hint>
}

/** Panel "near you": needed mobs within reach and live Hidden Cubes, nearest first (top 3, the rest behind TopN). */
function Near() {
  if (manual()) return null // needs the live position
  const n = V.near
  if (!n || (posAge() > 1800 && !S.replay) || (!n.close.length && !n.cubes.length && !V.live.size)) return null
  const p = S.pos
  // Candidate cube spots say little; only cubes the server reports are shown.
  const real = [...V.live.values()].filter((l: Any) => p && Math.hypot(l.x - p.x, l.z - p.z) < 1500)
  const rows: { key: string; node: ReactNode }[] = [
    ...real.map((l: Any) => ({ key: 'c' + l.c.key, node: (
      <ListRow key={'c' + l.c.key} data-cube={l.c.key} tip={t('pets.cube.realTip')} onClick={() => selectCube(l.c.key)} selected={V.cube === l.c.key}
        icon={<Star className="fill-current text-cube" />} title={<span className="font-semibold text-cube">{t('pets.cube.real')}</span>}
        sub={l.c.name + (l.out ? t('pets.cube.lastSeen') : '')}
        right={<span className="text-[12px] text-cyan">{fmtDist(Math.hypot(l.x - p.x, l.z - p.z))} {dirTo(l.x - p.x, l.z - p.z)}</span>} />
    ) })),
    ...n.close.map((o: Any) => ({ key: 'm' + o.t.p.id, node: (
      <ListRow key={'m' + o.t.p.id} data-pet={o.t.p.id} selected={V.multi.has(o.t.p.id)} onClick={() => selectPet(o.t.p.id)}
        tip={`${o.mob.n} → ${petName(o.t.p)} (${t('pets.lv', { lv: o.t.lv })})`}
        icon={<Portrait por={o.mob.por} size={22} className="-my-1" />}
        title={<span className="flex min-w-0 items-center gap-1.5"><Dot col={o.t.col} className="mt-0" /><span className="truncate">{o.mob.n}</span></span>}
        sub={<>{petName(o.t.p)} · <span className="tabular-nums">{o.t.souls}/{o.t.need}</span></>}
        right={<span className="text-[12px] text-cyan">{fmtDist(o.dist)} {o.dir}</span>} />
    ) })),
  ]
  if (!rows.length) return null
  return (
    <Panel title={t('pets.near')} sub={t('pets.nearPos', { est: S.pos?.est ? t('pets.nearEst') : '', ago: ago(posAge()) })} data-near>
      <div className={ROWS}><TopN id="pets.near" items={rows} n={3} more={more} render={r => r.node} /></div>
    </Panel>
  )
}

const tagTxt = (mob: Any) => [mob.named ? t('pets.tag.named') : mob.r === 'Hero' ? t('pets.tag.hero') : mob.r === 'Elite' ? t('pets.tag.elite') : '', mob.ag ? t('pets.tag.aggro') : '']
  .filter(Boolean).join(', ')

// Same size selected or not; the mob details are in the tooltip.
function TargetTile({ x }: { x: Any }) {
  const on = V.multi.has(x.p.id), groups = mobGroups(x), g0 = groups[0], man = manual()
  const where = `${g0.n} ${lvTxt(g0.lv)}${groups.length > 1 ? ` +${groups.length - 1}` : ''}${x.area.name ? ` · ${x.area.name}` : ''}`
  const tip = [`${petName(x.p)} (${x.p.c}, ${t('pets.lv', { lv: x.lv })})${x.area.name ? ' · ' + x.area.name : ''}`,
    ...groups.map(g => `${g.n} ${lvTxt(g.lv)} · ${g.count}× ${t('pets.spawnsTip')}${tagTxt(g.mob) ? ' · ' + tagTxt(g.mob) : ''}`),
    ...(V.multi.size ? [] : [t('pets.pin.hover')])].join('\n')
  return (
    <div data-pet={x.p.id} data-sel={on || undefined} className={cn(TILE, 'group', on && SEL, man && 'pr-0')} data-tip={tip} onClick={() => selectPet(x.p.id)}>
      <Portrait por={g0.mob.por} size={null} className={T_PORTRAIT} />
      <div className={T_BODY}>
        <div className="flex items-start gap-1.5"><Dot col={x.col} /><span className={T_TITLE}>{petName(x.p)}</span><PinBox on={on} hover={!V.multi.size} /></div>
        <div className={T_SUB}>{where}</div>
        <div className={T_FOOT}>
          {x.done ? <Bar frac={1} /> : <Pbar lv={x.lv} frac={x.souls / x.need} />}
          <div className={T_META}>
            <span data-tip={x.done ? undefined : t('pets.soulsTip', { n: x.souls, need: x.need, lv: x.lv + 1 })}>{x.done ? <Check data-done="" aria-label={t('pets.done')} className="size-3.5 text-green" /> : <><b className="font-semibold text-foreground">{x.souls}</b>/{x.need} {t('pets.soulsUnit')}</>}</span>
            <span>{t('pets.lv', { lv: x.lv })}</span>
          </div>
        </div>
      </div>
      {man && <PetControls x={x} />}
    </div>
  )
}

/** The answer: how many pets are missing here, how many to unlock, souls to Lv 3, the nearest needed mob. */
function Kpis({ m }: { m: Any }) {
  const open = V.targets.filter((x: Any) => !x.done), unlock = open.filter((x: Any) => x.lv === 0).length
  const souls = open.reduce((s: number, x: Any) => s + x.rest, 0)
  const mob = !manual() && (posAge() <= 1800 || S.replay) ? V.near?.mob : null
  return (
    <KpiRow>
      <Kpi icon={PawPrint} label={t('pets.kpi.missing')} value={fmt(open.length)} sub={mapName(m.name)} tip={t('pets.kpi.missingSub')} data-kpi="missing" />
      <Kpi icon={Unlock} label={t('pets.kpi.unlock')} value={fmt(unlock)} tone={unlock ? 'info' : undefined} sub={t('pets.kpi.unlockSub')} data-kpi="unlock" />
      <Kpi icon={Ghost} label={t('pets.kpi.souls')} value={fmt(souls)} sub={t('pets.kpi.soulsSub')} data-kpi="souls" />
      <Kpi icon={Crosshair} label={t('pets.kpi.nearest')} value={mob ? `${fmtDist(mob.dist)} ${mob.dir}` : '–'} tone={mob ? 'info' : undefined}
        sub={mob ? `${mob.mob.n} · ${petName(mob.t.p)}` : t('pets.kpi.noPos')} tip={t('pets.kpi.nearestTip')} data-kpi="nearest"
        onClick={mob ? () => { if (!V.multi.has(mob.t.p.id)) selectPet(mob.t.p.id) } : undefined} />
    </KpiRow>
  )
}

function Targets({ m }: { m: Any }) {
  const ts = V.targets
  if (!ts.length) {
    const filtered = U.hideNamed || U.lvMin > 1 || U.lvMax < 60
    return <Page><SelBar />{!hasState() && <NoStateHint />}
      <Empty>{hasState() ? rich(t('pets.empty.none', { map: mapName(m.name), filter: filtered ? t('pets.empty.filter') : '' })) : t('pets.empty.noPets')}</Empty></Page>
  }
  // With priority sort the tiles are grouped: unlock, level up, complete (the complete ones behind a closed disclosure).
  const sects: { group: string; items: Any[] }[] = []
  for (const x of ts) {
    const group = U.sort === 'prio' ? (x.done ? 'done' : x.lv === 0 ? 'unlock' : 'level') : 'all'
    if (!sects.length || sects[sects.length - 1].group !== group) sects.push({ group, items: [] })
    sects[sects.length - 1].items.push(x)
  }
  const tiles = (items: Any[]) => <div className={cn(GRID, 'pt-0.5 pb-2.5')}>{items.map(x => <TargetTile key={x.p.id} x={x} />)}</div>
  return <Page>
    <SelBar />
    {!hasState() && <NoStateHint />}
    {manual() && <ManualHint />}
    <Kpis m={m} />
    <Near />
    {sects.map(s => s.group === 'done'
      ? <Panel key={s.group} data-group={s.group} className="pb-1.5">
        <Disclosure id="pets.done" title={t('pets.group.done')} sub={t('pets.group.n', { n: s.items.length })}>{tiles(s.items)}</Disclosure>
      </Panel>
      : <Panel key={s.group} data-group={s.group} title={t('pets.group.' + s.group)} sub={t('pets.group.n', { n: s.items.length })}>{tiles(s.items)}</Panel>)}
  </Page>
}

export function TargetsTab() {
  useApp()
  const m = G.md[U.map]
  return m ? <Targets m={m} /> : <Empty>{t('data.loading')}</Empty>
}
