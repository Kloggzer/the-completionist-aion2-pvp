// "Ziele" tab: missing soul pets on the current map as tiles, plus what is near the player.
import { Star } from 'lucide-react'
import { G, S, U, V, bump, hasState, manual, useApp, type Any } from '@/core/state'

import { emit } from '@/core/bus'
import { mapName } from '@/core/data'
import { ago, dirTo, fmtDist, posAge } from '@/core/geo'
import { t } from '@/core/i18n'
import { cn } from '@/lib/utils'
import { Bar, Hint, LEAD, Page, T_BODY, T_FOOT, T_META, T_PORTRAIT, T_SUB, T_TITLE, TILE as KTILE, TILE_CLICK, TILE_P, TILE_SEL, grid } from '@/components/kit'
import { Portrait } from '@/components/Portrait'
import { lvTxt, mobGroups, toggleMulti } from './logic'
import { Dot, Empty, Pbar, PinBox, SelBar, Sect, rich } from './parts'
import { PetControls } from './manual'

// Portrait tiles (kit anatomy): portrait column left; title, two-line sub, bar and footer right.
const GRID = grid('pet'), TILE = cn(KTILE, TILE_CLICK, TILE_P), SEL = TILE_SEL

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

function Near() {
  if (manual()) return null // needs the live position
  const n = V.near
  if (!n || (posAge() > 1800 && !S.replay) || (!n.close.length && !n.cubes.length && !V.live.size)) return null
  const p = S.pos
  // Candidate cube spots say little; only cubes the server reports are shown.
  const real = [...V.live.values()].filter((l: Any) => p && Math.hypot(l.x - p.x, l.z - p.z) < 1500)
  return <>
    <Sect sub={'· ' + t('pets.nearPos', { est: S.pos?.est ? t('pets.nearEst') : '', ago: ago(posAge()) })}>{t('pets.near')}</Sect>
    <div className={GRID}>
      {n.close.map((o: Any) => (
        <div key={'m' + o.t.p.id} data-pet={o.t.p.id} className={cn(TILE, V.multi.has(o.t.p.id) && SEL)} data-tip={`${o.mob.n} → ${o.t.p.n} (Lv${o.t.lv})`} onClick={() => selectPet(o.t.p.id)}>
          <Portrait por={o.mob.por} size={null} className={T_PORTRAIT} />
          <div className={T_BODY}>
            <div className="flex items-start gap-1.5"><Dot col={o.t.col} /><span className={T_TITLE}>{o.mob.n}</span></div>
            <div className={T_SUB}>{o.t.p.n}</div>
            <div className={T_FOOT}>
              <Pbar lv={o.t.lv} frac={o.t.souls / o.t.need} />
              <div className={T_META}>
                <span><b className="font-semibold text-foreground">{o.t.souls}</b>/{o.t.need}</span>
                <b className="font-semibold text-cyan tabular-nums">{fmtDist(o.dist)} {o.dir}</b>
              </div>
            </div>
          </div>
        </div>
      ))}
      {real.map((l: Any) => (
        <div key={'c' + l.c.key} data-cube={l.c.key} data-tip={t('pets.cube.realTip')} onClick={() => selectCube(l.c.key)}
          className={cn(TILE, 'border-[#ffd25e] bg-[linear-gradient(135deg,#5a4410,#2c2410)] shadow-[0_0_10px_#ffd25e66] hover:border-[#ffd25e] hover:bg-[linear-gradient(135deg,#6a5214,#342b12)]', V.cube === l.c.key && 'ring-2 ring-gold')}>
          <span className={cn(T_PORTRAIT, 'grid flex-none place-items-center rounded-sm border border-[#ffd25e]/40 bg-black/25 text-[#ffd25e]')}><Star className="size-1/2 fill-current" /></span>
          <div className={T_BODY}>
            <span className={cn(T_TITLE, 'text-[#ffd25e]')}>{t('pets.cube.real')}</span>
            <div className={T_SUB}>{l.c.name}{l.out ? t('pets.cube.lastSeen') : ''}</div>
            <div className={T_FOOT}>
              <Bar frac={0} className="invisible" />
              <div className={cn(T_META, 'justify-end')}><b className="font-semibold text-cyan tabular-nums">{fmtDist(Math.hypot(l.x - p.x, l.z - p.z))} {dirTo(l.x - p.x, l.z - p.z)}</b></div>
            </div>
          </div>
        </div>
      ))}
    </div>
  </>
}

const tagTxt = (mob: Any) => [mob.named ? t('pets.tag.named') : mob.r === 'Hero' ? t('pets.tag.hero') : mob.r === 'Elite' ? t('pets.tag.elite') : '', mob.ag ? t('pets.tag.aggro') : '']
  .filter(Boolean).join(', ')

// Same size selected or not; the mob details are in the tooltip.
function TargetTile({ x }: { x: Any }) {
  const on = V.multi.has(x.p.id), groups = mobGroups(x), g0 = groups[0], man = manual()
  const where = `${g0.n} ${lvTxt(g0.lv)}${groups.length > 1 ? ` +${groups.length - 1}` : ''}${x.area.name ? ` · ${x.area.name}` : ''}`
  const tip = [`${x.p.n} (${x.p.c}, Lv${x.lv})${x.area.name ? ' · ' + x.area.name : ''}`,
    ...groups.map(g => `${g.n} ${lvTxt(g.lv)} · ${g.count}× ${t('pets.spawnsTip')}${tagTxt(g.mob) ? ' · ' + tagTxt(g.mob) : ''}`)].join('\n')
  return (
    <div data-pet={x.p.id} data-sel={on || undefined} className={cn(TILE, on && SEL, man && 'pr-0')} data-tip={tip} onClick={() => selectPet(x.p.id)}>
      <Portrait por={g0.mob.por} size={null} className={T_PORTRAIT} />
      <div className={T_BODY}>
        <div className="flex items-start gap-1.5"><Dot col={x.col} /><span className={T_TITLE}>{x.p.n}</span>{V.multi.size > 0 && <PinBox on={on} />}</div>
        <div className={T_SUB}>{where}</div>
        <div className={T_FOOT}>
          {x.done ? <Bar frac={1} /> : <Pbar lv={x.lv} frac={x.souls / x.need} />}
          <div className={T_META}>
            <span>{x.done ? <b className="text-green">✓</b> : <><b className="font-semibold text-foreground">{x.souls}</b>/{x.need}</>}</span>
            <span>Lv{x.lv}</span>
          </div>
        </div>
      </div>
      {man && <PetControls x={x} />}
    </div>
  )
}

function Targets({ m }: { m: Any }) {
  const ts = V.targets
  if (!ts.length) {
    const filtered = U.hideNamed || U.lvMin > 1 || U.lvMax < 60
    return <Empty>{hasState() ? rich(t('pets.empty.none', { map: mapName(m.name), filter: filtered ? t('pets.empty.filter') : '' })) : t('pets.empty.noPets')}</Empty>
  }
  // With priority sort the tiles are grouped: unlock, level up, complete.
  const sects: { group: string; items: Any[] }[] = []
  for (const x of ts) {
    const group = U.sort === 'prio' ? t(x.done ? 'pets.group.done' : x.lv === 0 ? 'pets.group.unlock' : 'pets.group.level') : ''
    if (!sects.length || sects[sects.length - 1].group !== group) sects.push({ group, items: [] })
    sects[sects.length - 1].items.push(x)
  }
  return <Page>
    <SelBar />
    {!hasState() && <NoStateHint />}
    {manual() && <ManualHint />}
    <Near />
    {sects.map((s, i) => (
      <div key={i}>
        {s.group && <Sect>{s.group}</Sect>}
        <div className={cn(GRID, !s.group && LEAD)}>{s.items.map(x => <TargetTile key={x.p.id} x={x} />)}</div>
      </div>
    ))}
  </Page>
}

export function TargetsTab() {
  useApp()
  const m = G.md[U.map]
  return m ? <Targets m={m} /> : <Empty>{t('data.loading')}</Empty>
}
