// "Bosse" tab: field bosses of the current map, then the Abyss bosses (always shown, whatever map is selected).
import { Bell, Skull } from 'lucide-react'
import { G, U, manual, useApp, type Any } from '@/core/state'
import { mapName } from '@/core/data'
import { hm, t } from '@/core/i18n'
import { cn } from '@/lib/utils'
import { BarInfo, BarRight, BellBtn, Empty, LEAD, Page, Sect, T_BODY, T_FOOT, T_PORTRAIT, T_TITLE, TILE, TILE_P, grid } from '@/components/kit'
import { Portrait } from '@/components/Portrait'
import { ABYSS, abyssBosses, bossShort, fbServer, fbStatus, fieldBosses, killBoss, lead, toggleBossBell, whenTxt } from './events'

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
              className="flex h-5 w-5 flex-none items-center justify-center rounded-sm text-muted-foreground opacity-60 hover:bg-white/10 hover:opacity-100">
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

export function BossTab() {
  useApp()
  const m = G.md[U.map], field = fieldBosses(m), abyss = abyssBosses()
  const tbl = field.length ? U.bossTables?.[field[0].mapId] : null
  const note = manual() ? t('boss.manual') : tbl ? t('boss.server', { at: hm(tbl.at) }) : t('boss.estimate')
  const bar = <>
    <BarInfo>{m ? mapName(m.name) + ' · ' : ''}{note}</BarInfo>
    <BarRight><span className="inline-flex items-center gap-1 px-1 text-[11.5px]"><Bell className="size-3" />{t('boss.legend', { n: lead() })}</span></BarRight>
  </>
  return (
    <Page bar={bar}>
      {field.length > 0 && <>
        {abyss.length > 0 && <Sect sub={'· ' + t('boss.fieldSub')}>{m ? mapName(m.name) : ''}</Sect>}
        <div className={cn(grid('boss'), !abyss.length && LEAD)}>{sorted(field).map(({ b, s }) => <BossCard key={b.key} b={b} s={s} />)}</div>
      </>}
      {!field.length && U.map !== ABYSS && <Empty>{t('boss.none', { map: m ? mapName(m.name) : t('boss.thisMap') })}</Empty>}
      {abyss.length > 0 && <>
        <Sect sub={'· ' + mapName(G.md[ABYSS].name) + ' · ' + t('boss.abyssSub')}>{t('boss.abyss')}</Sect>
        <div className={grid('boss')}>{sorted(abyss).map(({ b, s }) => <BossCard key={b.key} b={b} s={s} />)}</div>
      </>}
    </Page>
  )
}
