// "Bosse" tab: number tiles (next boss here, alive, bells, next Abyss boss), the field bosses of the current map, then
// the Abyss bosses behind a disclosure (available whatever map is selected, open by default on the Abyss map).
import { BellRing, HeartPulse, Skull, Swords } from 'lucide-react'
import { G, U, manual, useApp, type Any } from '@/core/state'
import { mapName } from '@/core/data'
import { hm, t } from '@/core/i18n'
import { cn } from '@/lib/utils'
import { BarInfo, BellBtn, Disclosure, Empty, Kpi, KpiRow, Page, Sect, T_BODY, T_FOOT, T_PORTRAIT, T_TITLE, TILE, TILE_P, grid } from '@/components/kit'
import { Portrait } from '@/components/Portrait'
import { ABYSS, abyssBosses, allBosses, bossShort, fbServer, fbStatus, fieldBosses, killBoss, lead, toggleBossBell, whenTxt } from './events'

const ORDER = { due: 0, wait: 1, alive: 2, stale: 3, unknown: 4 }
// Tile accent per boss status.
const ACC: Record<string, string> = { alive: 'border-green/35', due: 'border-gold bg-gold/8', wait: '', stale: '', unknown: '' }
const TIME: Record<string, string> = { alive: 'text-green', wait: 'text-cyan', due: 'text-gold', stale: 'text-dim font-medium', unknown: 'text-dim font-medium' }

function BossCard({ b, s }: { b: Any; s: Any }) {
  const on = !!U.bossBells?.[b.key], drops = G.drops?.[b.id] || [], por = G.md[b.map]?.species?.[b.id]?.por
  const time = s.k === 'alive' ? t('boss.alive') : s.due ? whenTxt(s.due) : '–'
  const { short, rest } = bossShort(b)
  const tip = [b.name, `Lv ${b.lv}${b.where ? ' · ' + b.where : ''}`, s.t,
    ...drops.slice(0, 3).map((d: Any) => `${d.n}${d.g ? ' (' + d.g + ')' : ''}: iLvl ${d.il[0] === d.il[1] ? d.il[0] : d.il[0] + '–' + d.il[1]}`)].join('\n')
  const canKill = b.mins > 0 && !(s.exact || (s.k === 'alive' && fbServer(b)))
  const quiet = s.k === 'stale' || s.k === 'unknown'
  const sub = b.abyss ? [rest, b.where].filter(Boolean).join(' · ') : b.where
  return (
    <div data-boss={b.id} className={cn(TILE, TILE_P, 'pr-0', ACC[s.k])}>
      <Portrait por={por} size={null} className={cn(T_PORTRAIT, quiet && 'opacity-60 grayscale-[0.6]', s.k === 'alive' && 'border-green/50', s.k === 'due' && 'border-gold/70')} />
      <div data-tip={tip} className={cn(T_BODY, 'pr-0.5')}>
        <span className={T_TITLE}>{short} <i className="font-medium not-italic text-dim">({b.lv})</i></span>
        <span className="truncate text-[11px] leading-tight text-dim">{sub || ' '}</span>
        <div className={cn(T_FOOT, 'flex items-center justify-between text-[15px] leading-tight font-semibold tabular-nums', TIME[s.k])}>
          <span className="truncate">{time}</span>
          {canKill && (manual()
            // Manual mode: the kill time is the only source of the respawn – a labelled button, not a faint icon.
            ? <button data-kill onClick={() => killBoss(b.key)} data-tip={t('boss.kill')}
              className="flex h-6 flex-none items-center gap-1 rounded-sm border border-gold/45 bg-gold/10 px-1.5 text-[11px] font-semibold text-gold hover:bg-gold/20">
              <Skull className="size-3.5" />{!s.due && t('boss.killShort')}
            </button>
            : <button onClick={() => killBoss(b.key)} data-tip={t('boss.kill')}
              className="flex h-5 w-5 flex-none items-center justify-center rounded-sm text-muted-foreground opacity-60 hover:bg-foreground/10 hover:opacity-100">
              <Skull className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      {/* Bell: full-height column, easy to hit. */}
      <BellBtn on={on} onClick={() => toggleBossBell(b.key)} tip={on ? t('boss.bellOn') : t('boss.bellOff')} className={cn('-my-1 border-l', on && 'border-gold/30')} />
    </div>
  )
}

// Highest drop item level first; within the same level the boss that spawns next.
function sorted(bosses: Any[]) {
  const topIl = (b: Any) => Math.max(0, ...(G.drops?.[b.id] || []).map((d: Any) => d.il[1]))
  return bosses.map(b => ({ b, s: fbStatus(b), il: topIl(b) }))
    .sort((a, c) => c.il - a.il || ORDER[a.s.k as keyof typeof ORDER] - ORDER[c.s.k as keyof typeof ORDER] || (a.s.due || 0) - (c.s.due || 0) || a.b.key.localeCompare(c.b.key))
}

/** The boss that spawns next (waiting or due), with its status. */
function nextOf(list: { b: Any; s: Any }[]) {
  return list.filter(x => (x.s.k === 'wait' || x.s.k === 'due') && x.s.due).sort((a, c) => a.s.due - c.s.due)[0]
}
const leftTxt = (ms: number) => {
  const m = Math.round((ms - Date.now()) / 60000)
  return m <= 0 ? t('home.due') : m < 60 ? t('timer.inMin', { m }) : m < 1440 ? t('timer.inHMin', { h: Math.floor(m / 60), m: m % 60 }) : whenTxt(ms)
}
function NextKpi({ x, label, icon, none, ...rest }: { x?: { b: Any; s: Any }; label: string; icon: typeof Skull; none: string } & Record<`data-${string}`, string>) {
  return <Kpi icon={icon} label={label} value={x ? (x.s.k === 'due' ? t('home.due') : whenTxt(x.s.due)) : '–'} tone={x ? (x.s.k === 'due' ? 'warn' : 'info') : undefined}
    sub={x ? `${x.s.k === 'due' ? hm(x.s.due) : leftTxt(x.s.due)} · ${bossShort(x.b).short}` : none} tip={x?.b.name} {...rest} />
}

export function BossTab() {
  useApp()
  const m = G.md[U.map], field = fieldBosses(m), abyss = abyssBosses()
  const tbl = field.length ? U.bossTables?.[field[0].mapId] : null
  const note = manual() ? t('boss.manual') : tbl ? t('boss.server', { at: hm(tbl.at) }) : t('boss.estimate')
  const fs = sorted(field), as = sorted(abyss)
  const alive = fs.filter(x => x.s.k === 'alive').length, bells = allBosses().filter(b => U.bossBells?.[b.key]).length
  const bar = <BarInfo tip={note}>{m ? mapName(m.name) + ' · ' : ''}{note}</BarInfo>
  return (
    <Page bar={bar}>
      <KpiRow>
        <NextKpi x={nextOf(fs)} icon={Skull} label={t('boss.kpi.next')} none={field.length ? t('home.kpi.noBoss') : t('boss.kpi.noField')} data-kpi="next" />
        <Kpi icon={HeartPulse} label={t('boss.kpi.alive')} value={field.length ? alive : '–'} tone={alive ? 'ok' : undefined} sub={t('boss.kpi.ofN', { n: field.length })} data-kpi="alive" />
        <Kpi icon={BellRing} label={t('boss.kpi.bells')} value={bells} tone={bells ? 'warn' : undefined} sub={t('boss.kpi.lead', { n: lead() })} data-kpi="bells" />
        <NextKpi x={nextOf(as)} icon={Swords} label={t('boss.kpi.abyss')} none={t('home.kpi.noBoss')} data-kpi="abyss" />
      </KpiRow>
      {field.length > 0 && <>
        <Sect sub={t('boss.fieldSub')}>{m ? mapName(m.name) : ''}</Sect>
        <div className={grid('boss')}>{fs.map(({ b, s }) => <BossCard key={b.key} b={b} s={s} />)}</div>
      </>}
      {!field.length && U.map !== ABYSS && <Empty>{t('boss.none', { map: m ? mapName(m.name) : t('boss.thisMap') })}</Empty>}
      {abyss.length > 0 && <div className="pt-1.5">
        <Disclosure id="boss.abyss" defaultOpen={U.map === ABYSS} title={t('boss.abyss')} sub={mapName(G.md[ABYSS].name) + ' · ' + t('boss.abyssN', { n: abyss.length })}>
          <div className={cn(grid('boss'), 'pt-1')}>{as.map(({ b, s }) => <BossCard key={b.key} b={b} s={s} />)}</div>
        </Disclosure>
      </div>}
    </Page>
  )
}
