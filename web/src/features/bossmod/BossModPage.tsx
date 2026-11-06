// "Boss-Helfer" page: the last fights with the Petze (who was hit by avoidable attacks) and your markers, the dungeon
// bosses with a timeline (bossmods.json), and per boss its timeline and the skill editor (name, what to do, callout,
// banner / voice / bar / Petze, warning lead; U.bossSkills). A test pull plays a boss's timeline (index.ts testPull).
import { ChevronLeft, Play, Skull, Swords } from 'lucide-react'
import { G, U, V, bump, saveUi, useApp } from '@/core/state'
import { hm, t } from '@/core/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { AppSelect } from '@/components/AppSelect'
import { CHIP, CHIP_ON, Empty, META, Page, Panel, ROW, ROW_CLICK, SUB, TITLE } from '@/components/kit'
import { KINDS, alertOn, avoidable, barOn, findBoss, isBig, kindCol, phaseHp, predictable, skillName, voiceOn, warnLead, type BossMods, type BossStat, type Kind, type SkillCfg, type SkillStat } from './logic'
import { cfgs, guide, ownCfgs, testPull, type FightLog } from './index'

const mods = () => G.bossMods as BossMods | undefined
const dur = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
const dungeon = (zone?: number) => (zone && G.instances?.get(zone)?.name) || (zone ? `Dungeon ${zone}` : '–')
/** Skills worth showing first: big, predictable, phase skills and the ones with own settings. */
const important = (id: string, s: SkillStat) => isBig(s) || predictable(s) || phaseHp(s) !== null || !!cfgs()[id]

/** Change the player's own settings of a skill (the guide's stay underneath, index.ts cfgs). */
function setCfg(id: string, patch: Partial<SkillCfg>) {
  const all = { ...ownCfgs() }, next: SkillCfg = { ...all[id], ...patch }
  for (const k of Object.keys(next) as (keyof SkillCfg)[]) if (next[k] === undefined || next[k] === '') delete next[k]
  if (Object.keys(next).length) all[id] = next
  else delete all[id]
  U.bossSkills = all
  saveUi(['bossSkills'])
  bump()
}

function Chip({ on, onClick, children, tip }: { on: boolean; onClick: () => void; children: React.ReactNode; tip?: string }) {
  return <button onClick={onClick} data-tip={tip} aria-pressed={on} className={cn(CHIP, 'h-6 px-2 text-[11.5px]', on && CHIP_ON)}>{children}</button>
}

// ---------------------------------------------------------------- overview

function FightRow({ f, i }: { f: FightLog; i: number }) {
  const open = () => { V.bmBoss = f.npc; V.bmFight = i; bump() }
  return (
    <div data-fight={i} className={cn(ROW, ROW_CLICK, 'min-h-11 flex-wrap gap-y-1 py-1.5')} onClick={open}>
      <Skull className={cn('size-4 flex-none', f.died ? 'text-green' : 'text-dim')} />
      <div className="min-w-0 flex-[1_1_12rem]">
        <div className={TITLE}>{f.name}</div>
        <div className={META}>{dur(f.dur)} · {hm(f.at)} · {f.died ? t('bm.died') : t('bm.wipe')}{f.marks.length ? ` · ${f.marks.length} ⚑` : ''}</div>
      </div>
      <div className="flex min-w-0 flex-wrap gap-1">
        {f.blame.length === 0
          ? <span className="text-[11.5px] text-green">{t('bm.clean')}</span>
          : f.blame.slice(0, 5).map(b => (
            <span key={b.name} data-blame={b.name} data-tip={b.skills.map(s => `${s.name} ${s.n}×`).join('\n')}
              className={cn('rounded-md border px-1.5 py-0.5 text-[11.5px] tabular-nums', b.me ? 'border-red/50 text-red' : 'border-gold/40 text-gold')}>
              {b.name} {t('bm.hits', { n: b.hits })}
            </span>
          ))}
      </div>
    </div>
  )
}

function Overview() {
  const d = mods(), fights: FightLog[] = U.bossFights || []
  const byZone = new Map<number, [string, BossStat][]>()
  for (const [id, b] of Object.entries(d?.bosses || {})) {
    const z = b.zone || 0
    byZone.set(z, [...(byZone.get(z) || []), [id, b]])
  }
  return <>
    <Panel title={t('bm.last')} data-bm-last="">
      {fights.length ? fights.map((f, i) => <FightRow key={f.at + ':' + i} f={f} i={i} />) : <Empty>{t('bm.noFights')}</Empty>}
    </Panel>
    {[...byZone.entries()].map(([z, list]) => (
      <Panel key={z} title={dungeon(z)}>
        {list.map(([id, b]) => {
          const n = Object.entries(b.skills).filter(([k, s]) => alertOn(s, cfgs()[k])).length
          return (
            <div key={id} data-bm-boss={id} className={cn(ROW, ROW_CLICK, 'min-h-11')} onClick={() => { V.bmBoss = +id; V.bmFight = null; bump() }}>
              <Swords className="size-4 flex-none text-dim" />
              <div className="min-w-0 flex-1">
                <div className={TITLE}>{b.name}</div>
                <div className={META}>{t('bm.fights', { n: b.fights })} · {t('bm.alerts', { n })}</div>
              </div>
            </div>
          )
        })}
      </Panel>
    ))}
  </>
}

// ---------------------------------------------------------------- boss detail

/** Timeline: per important skill a lane with its casts (of the chosen fight, else the typical ones), your markers as
 *  vertical lines. */
function Timeline({ b, fight }: { b: BossStat; fight?: FightLog }) {
  const ids = Object.entries(b.skills).filter(([id, s]) => important(id, s)).map(([id]) => id)
  const end = fight?.dur || Math.max(60, ...b.dur)
  const casts = (id: string): number[] => {
    if (fight) return fight.casts.filter(c => String(c[0]) === id).map(c => c[1])
    const s = b.skills[id], out: number[] = []
    for (let i = 0, at = s.first; i < Math.round(s.n) && at <= end; i++, at += s.gap?.[1] ?? end) out.push(at)
    return out
  }
  const W = 600, lane = 16, top = 6, h = top + ids.length * lane + 18
  const x = (s: number) => 110 + (Math.max(0, s) / end) * (W - 120)
  return (
    <svg viewBox={`0 0 ${W} ${h}`} className="w-full text-muted-foreground" data-bm-timeline="" role="img" aria-label={t('bm.timeline')}>
      {ids.map((id, i) => {
        const y = top + i * lane + lane / 2, cfg = cfgs()[id]
        return (
          <g key={id}>
            <text x={4} y={y + 4} fontSize="10" fill="currentColor">{skillName(+id, cfg).slice(0, 18)}</text>
            <line x1={110} x2={W - 10} y1={y} y2={y} stroke="currentColor" strokeOpacity="0.15" />
            {casts(id).map((at, k) => <circle key={k} cx={x(at)} cy={y} r={4} fill={kindCol(cfg)} fillOpacity={cfg?.kind ? 1 : 0.7}><title>{`${skillName(+id, cfg)} · ${Math.round(at)} s`}</title></circle>)}
          </g>
        )
      })}
      {(fight?.marks || []).map((m, i) => (
        <g key={'m' + i}>
          <line x1={x(m)} x2={x(m)} y1={0} y2={h - 14} stroke="var(--color-gold, #d9a441)" strokeDasharray="3 2" />
          <text x={x(m) + 2} y={h - 4} fontSize="9" fill="var(--color-gold, #d9a441)">⚑ {Math.round(m)} s</text>
        </g>
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map(f => <text key={f} x={x(f * end)} y={h - 4} fontSize="9" textAnchor="middle" fill="currentColor" fillOpacity="0.6">{dur(f * end)}</text>)}
    </svg>
  )
}

function SkillRow({ id, s, nearMark }: { id: string; s: SkillStat; nearMark: boolean }) {
  const cfg = cfgs()[id], own = ownCfgs()[id], ph = phaseHp(s)
  const facts = [t('bm.stat', { n: s.n, first: Math.round(s.first) }), s.gap && t('bm.gap', { gap: Math.round(s.gap[1]) }),
    s.cast && t('bm.cast', { s: s.cast }), s.hp && t('bm.hp', { a: s.hp[0], b: s.hp[1] }), ph !== null && t('bm.phase', { hp: ph }),
    predictable(s) && t('bm.pred')].filter(Boolean).join(' · ')
  const kinds = [{ value: '', label: t('boss.k.none') }, ...KINDS.map(k => ({ value: k, label: t('boss.k.' + k) }))]
  const lead = warnLead(s, cfg)
  return (
    <div data-bm-skill={id} className={cn('flex flex-col gap-1.5 border-b border-border/50 px-3 py-2', nearMark && 'bg-gold/[0.05]')}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="h-3 w-1.5 flex-none rounded-sm" style={{ background: kindCol(cfg) }} />
        <input value={own?.name ?? ''} placeholder={cfg?.name || `Skill ${id}`} aria-label={t('bm.name')} data-bm-name={id}
          onChange={e => setCfg(id, { name: e.target.value })}
          className="h-7 min-w-0 flex-[1_1_10rem] rounded-md border bg-background px-2 text-[13px] font-semibold outline-none focus:border-gold/60" />
        <AppSelect value={cfg?.kind ?? ''} options={kinds} className="w-32 flex-none" onChange={v => setCfg(id, { kind: (v || undefined) as Kind | undefined })} />
      </div>
      <div className={cn(SUB, 'text-[11.5px]')}>{nearMark && '⚑ '}{facts} · <span className="tabular-nums">#{id}</span></div>
      <div className="flex flex-wrap items-center gap-1">
        <input value={own?.text ?? ''} placeholder={cfg?.text || t('bm.textPh')} aria-label={t('bm.text')} onChange={e => setCfg(id, { text: e.target.value })}
          className="h-6 min-w-0 flex-[1_1_12rem] rounded-md border bg-background px-2 text-[12px] outline-none focus:border-gold/60" />
        <Chip on={alertOn(s, cfg)} onClick={() => setCfg(id, { alert: !alertOn(s, cfg) })}>{t('bm.alert')}</Chip>
        <Chip on={voiceOn(cfg)} onClick={() => setCfg(id, { voice: !voiceOn(cfg) })}>{t('bm.voice')}</Chip>
        {predictable(s) && <Chip on={barOn(s, cfg)} onClick={() => setCfg(id, { bar: !barOn(s, cfg) })}>{t('bm.bar')}</Chip>}
        {predictable(s) && <Chip on={lead > 0} tip={t('bm.warn')} onClick={() => setCfg(id, { warn: lead > 0 ? 0 : 5 })}>{t('bm.warn')}{lead > 0 ? ` ${lead} s` : ''}</Chip>}
        <Chip on={avoidable(s, cfg)} onClick={() => setCfg(id, { avoid: !avoidable(s, cfg) })}>{t('bm.avoid')}</Chip>
      </div>
    </div>
  )
}

/** The guide (bossguide.json): Frenzy, phases, mechanics with what to do and their skill ids; placeholders marked. */
function GuidePanel({ npc }: { npc: number }) {
  const g = guide(npc)
  const todo = <span className="ml-1.5 rounded-sm bg-gold/15 px-1 text-[10.5px] font-semibold text-gold">{t('bm.todo')}</span>
  if (!g) return <Panel title={t('bm.guide')}><Empty>{t('bm.noGuide')}</Empty></Panel>
  return (
    <Panel title={t('bm.guide')} sub={g.frenzy ? t('bm.frenzy', { t: dur(g.frenzy) }) : undefined} data-bm-guide="">
      {g.phases.map(p => (
        <div key={p.name + p.hp} className={cn(ROW, 'min-h-8')}>
          <span className="w-12 flex-none text-right font-semibold tabular-nums text-gold">{p.hp} %</span>
          <span className="min-w-0 flex-1 truncate">{p.name}{p.todo && todo}</span>
        </div>
      ))}
      {/* mechanics as compact chips: colour = what to do, the hint / cast / skill ids in the tooltip, dot = values follow */}
      <div className="flex flex-wrap gap-1.5 px-3 py-2.5" data-bm-mechs="">
        {g.mechanics.map(m => (
          <span key={m.name} data-bm-mech={m.name}
            data-tip={[m.hint, m.cast ? t('bm.cast', { s: m.cast }) : '', m.skills.length ? t('bm.mechSkills', { ids: m.skills.join(', ') }) : t('bm.mechNoSkills'), m.todo ? t('bm.todo') : ''].filter(Boolean).join('\n')}
            className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-[12px]">
            <span className="size-2 flex-none rounded-full" style={{ background: kindCol({ kind: m.kind }) }} />
            <span className="truncate">{m.name}</span>
            {m.kind && <span className="flex-none text-[10.5px] font-semibold text-muted-foreground uppercase">{t('boss.k.' + m.kind)}</span>}
            {m.todo && <span className="size-1.5 flex-none rounded-full bg-gold" aria-label={t('bm.todo')} />}
          </span>
        ))}
      </div>
    </Panel>
  )
}

function Detail({ npc }: { npc: number }) {
  const b = findBoss(mods(), npc)
  const fights: FightLog[] = U.bossFights || []
  const fight = V.bmFight != null ? fights[V.bmFight] : fights.find(f => f.npc === npc)
  const back = <Button size="sm" variant="ghost" onClick={() => { V.bmBoss = null; V.bmFight = null; bump() }}><ChevronLeft />{t('bm.back')}</Button>
  if (!b) return <Panel>{back}<Empty>{t('bm.noFights')}</Empty></Panel>
  const all = !!V.bmAll
  const list = Object.entries(b.skills).filter(([id, s]) => all || important(id, s))
  // skills cast within 3 s before a marker: the likely ones to name
  const near = new Set((fight?.marks || []).flatMap(m => (fight?.casts || []).filter(c => m - c[1] >= -1 && m - c[1] <= 3).map(c => String(c[0]))))
  return <>
    <Panel title={b.name} sub={dungeon(b.zone)} right={<div className="flex gap-1">{back}
      <Button size="sm" variant="outline" data-bm-test="" data-tip={t('bm.testTip')} onClick={() => testPull(npc)}><Play />{t('bm.test')}</Button></div>}>
      <div className="px-3 pb-2"><Timeline b={b} fight={fight?.npc === npc ? fight : undefined} /></div>
      {fight?.npc === npc && fight.blame.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pb-2.5" data-bm-blame="">
          <span className={cn(META, 'mr-1')}>{t('bm.blame')}:</span>
          {fight.blame.map(x => <span key={x.name} className={cn('rounded-md border px-1.5 py-0.5 text-[11.5px]', x.me ? 'border-red/50 text-red' : 'border-gold/40 text-gold')}>
            {x.name} {x.skills.map(s => `${s.name} ${s.n}×`).join(', ')}</span>)}
        </div>
      )}
    </Panel>
    <GuidePanel npc={npc} />
    <Panel title={t('bm.skills')} right={<Button size="sm" variant="ghost" onClick={() => { V.bmAll = !all; bump() }}>
      {all ? t('bm.showMain') : t('bm.showAll', { n: Object.keys(b.skills).length })}</Button>}>
      {list.map(([id, s]) => <SkillRow key={id} id={id} s={s} nearMark={near.has(id)} />)}
    </Panel>
  </>
}

export function BossModTab() {
  useApp()
  return (
    <Page w="rows">
      {!U.bossMod && (
        <Panel>
          <div className="flex items-center gap-3 px-3 py-2.5">
            <span className="flex-1 text-[13px]">{t('bm.off')}</span>
            <Button size="sm" onClick={() => { U.bossMod = true; saveUi(['bossMod']); bump() }}>{t('bm.on')}</Button>
          </div>
        </Panel>
      )}
      {U.bossMod && !U.tts && (
        <Panel data-bm-tts-off="">
          <div className="flex items-center gap-3 px-3 py-2.5">
            <span className="flex-1 text-[13px]">{t('bm.ttsOff')}</span>
            <Button size="sm" onClick={() => { U.tts = true; saveUi(['tts']); bump() }}>{t('bm.ttsOn')}</Button>
          </div>
        </Panel>
      )}
      {V.bmBoss ? <Detail npc={V.bmBoss} /> : <Overview />}
    </Page>
  )
}
