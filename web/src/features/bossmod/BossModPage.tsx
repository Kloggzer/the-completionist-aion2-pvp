// "Boss-Helfer" pages (the sidebar's Dungeon area: the overview and one page per dungeon, bossmod/dungeons.ts). The bar is a
// path: Boss-Helfer › dungeon › boss, with the helper's voice and on / off at the right. Overview: setup, the last fights,
// the export. Dungeon: its bosses (stages of one boss are one entry). Boss: one panel – name, mode (on / bars only / off),
// test pull, the stage switch if it has stages – and two tabs: "Ablauf" (timeline, typical or a kept fight with markers;
// phases and mechanics from the guide) and "Skills" (per skill one row: colour, name, what to do, icon switches for
// banner / voice / bar / warning; the callout text below; the profile string to share at the end).
import { useState } from 'react'
import { AlarmClock, BarChart3, ChevronRight, ClipboardCopy, Flag, Play, Skull, Square, Swords, Volume2, VolumeX, type LucideIcon } from 'lucide-react'
import { G, U, V, bump, saveUi, useApp } from '@/core/state'
import { emit } from '@/core/bus'
import { host } from '@/core/host'
import { hm, locale, t } from '@/core/i18n'
import { hkText } from '@/core/session'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { AppSelect } from '@/components/AppSelect'
import { BarRight, Empty, META, Page, Panel, PanelTabs, ROW, ROW_CLICK, SUB, Seg, TITLE } from '@/components/kit'
import { toggleWinEdit } from '@/features/pvp'
import { KINDS, alertOn, avoidable, barOn, findBoss, isBig, kindCol, phaseHp, predictable, skillName, voiceOn, warnLead, type BossMods, type BossStat, type Kind, type Role, type SkillCfg, type SkillStat } from './logic'
import { bossName, currentDungeon, dungeonName, dungeons, entryOf } from './dungeons'
import { BLAME, blameActive, blameOf, bossMode, canon, cfgs, guide, ownCfgs, role, stopTest, testPull, type BossMode, type FightLog } from './index'

const mods = () => G.bossMods as BossMods | undefined
const dur = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
const num = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: 1 })
const dungeon = (zone?: number) => (zone && G.instances?.get(zone)?.name) || (zone ? `Dungeon ${zone}` : '–')
/** Skills worth showing first: big, predictable, phase skills and the ones with settings. */
const important = (id: string, s: SkillStat) => !s.common && (isBig(s) || predictable(s) || phaseHp(s) !== null || !!cfgs()[id])
const PROFILE = 'TCBH1:' // profile strings: prefix + base64 of { npc, skills }

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
const setU = (k: string, v: unknown) => { U[k] = v; saveUi([k]); emit('recompute'); bump() }

/** Icon switch of a skill row (banner, voice, bar, warning): constant width, the meaning in the tooltip. */
function IconSwitch({ on, onClick, icon: I, tip, label, ...rest }: { on: boolean; onClick: () => void; icon: LucideIcon; tip: string; label?: string } & Record<`data-${string}`, string>) {
  return (
    <button onClick={onClick} data-tip={tip} aria-label={tip} aria-pressed={on} {...rest}
      className={cn('flex h-7 min-w-7 flex-none items-center justify-center gap-1 rounded-md border px-1.5 text-[11.5px] tabular-nums transition-colors [&_svg]:size-3.5',
        on ? 'border-gold/45 bg-gold/15 text-gold' : 'border-border text-dim hover:text-foreground')}>
      <I />{label}
    </button>
  )
}
function Note({ children, action, ...rest }: { children: React.ReactNode; action?: React.ReactNode } & Record<`data-${string}`, string>) {
  return (
    <Panel {...rest}>
      <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
        <span className="min-w-0 flex-[1_1_14rem] text-[13px]">{children}</span>
        {action}
      </div>
    </Panel>
  )
}
const copy = (text: string) => navigator.clipboard?.writeText(text).catch(() => {})

// ---------------------------------------------------------------- setup

const ROLES: Role[] = ['auto', 'tank', 'heal', 'dps']
function RoleSelect() {
  return <AppSelect value={role()} options={ROLES.map(r => ({ value: r, label: t('bm.role.' + r) }))} className="w-36" onChange={v => setU('bossRole', v)} />
}

/** First steps until dismissed: role, voice, place the two windows. */
function Setup() {
  const step = (n: number, label: string, done: boolean, ctl: React.ReactNode) => (
    <div className={cn(ROW, 'min-h-11 flex-wrap gap-y-1.5 py-1.5')}>
      <span className={cn('grid size-6 flex-none place-items-center rounded-full border text-[12px] font-semibold', done ? 'border-green/50 text-green' : 'border-gold/50 text-gold')}>{n}</span>
      <span className="min-w-0 flex-[1_1_12rem] text-[13px]">{label}</span>
      {ctl}
    </div>
  )
  return (
    <Panel title={t('bm.setup')} right={<Button size="sm" variant="ghost" onClick={() => setU('bossSetupDone', true)}>{t('bm.setupDone')}</Button>} data-bm-setup="">
      {step(1, t('bm.setup.role'), role() !== 'auto', <RoleSelect />)}
      {step(2, t('bm.setup.tts'), !!U.tts, U.tts
        ? <span className="text-[12px] text-green">{t('bm.setup.ttsOk')}</span>
        : <Button size="sm" onClick={() => setU('tts', true)}>{t('bm.ttsOn')}</Button>)}
      {step(3, t('bm.setup.win', { key: hkText('winEdit') || '–' }), false, <Button size="sm" variant="outline" onClick={toggleWinEdit}>{t('bm.setup.winBtn')}</Button>)}
    </Panel>
  )
}

// ---------------------------------------------------------------- overview

function BlameChips({ log, limit = 5 }: { log: FightLog; limit?: number }) {
  if (!BLAME) return null
  const bl = blameOf(log)
  if (!blameActive(log.npc)) return <span className="text-[11.5px] text-dim" data-blame-off="">{t('bm.blameOff')}</span>
  if (!bl.length) return <span className="text-[11.5px] text-green">{t('bm.clean')}</span>
  return <>{bl.slice(0, limit).map(b => (
    <span key={b.name} data-blame={b.name} data-tip={b.skills.map(s => `${s.name} ${s.n}×`).join('\n')}
      className={cn('rounded-md border px-1.5 py-0.5 text-[11.5px] tabular-nums', b.me ? 'border-red/50 text-red' : 'border-gold/40 text-gold')}>
      {b.name} {t('bm.hits', { n: b.hits })}
    </span>
  ))}</>
}

/** Outcome of a kept fight: killed, or the wipe's lowest HP and phase. */
const outcome = (f: FightLog) => f.died ? t('bm.died') : f.low !== undefined ? t('bm.wipeAt', { hp: f.low, phase: f.phase ? ' · ' + f.phase : '' }) : t('bm.wipe')

function FightRow({ f, i }: { f: FightLog; i: number }) {
  const open = () => openBoss(canon(f.npc), i)
  return (
    <div data-fight={i} className={cn(ROW, ROW_CLICK, 'min-h-11 flex-wrap gap-y-1 py-1.5')} onClick={open}>
      <Skull className={cn('size-4 flex-none', f.died ? 'text-green' : 'text-red')} />
      <div className="min-w-0 flex-[1_1_12rem]">
        <div className={TITLE}>{f.name}</div>
        <div className={META}>{dur(f.dur)} · {hm(f.at)} · <span className={f.died ? 'text-green' : 'text-red'}>{outcome(f)}</span>{f.marks.length ? ` · ${f.marks.length} ⚑` : ''}</div>
      </div>
      <div className="flex min-w-0 flex-wrap gap-1"><BlameChips log={f} /></div>
    </div>
  )
}

function Overview() {
  const fights: FightLog[] = U.bossFights || [], here = currentDungeon()
  return <>
    <Panel title={t('bm.dungeons')} data-bm-dungeons="">
      {dungeons().map(d => (
        <div key={d.name} data-bm-dng={d.name} className={cn(ROW, ROW_CLICK, 'group min-h-10')} onClick={() => toPage(d.name)}>
          <span className="min-w-0 flex-1 truncate">{d.name}</span>
          {here === d.name && <i data-tip={t('nav.here')} className="size-1.5 flex-none rounded-full bg-green shadow-[0_0_5px_var(--green)]" />}
          <span className={META}>{t('bm.bossN', { n: d.bosses.length })}</span>
          <ChevronRight className="size-4 flex-none text-dim transition-colors group-hover:text-gold" />
        </div>
      ))}
    </Panel>
    <Panel title={t('bm.last')} data-bm-last="">
      {fights.length ? fights.map((f, i) => <FightRow key={f.at + ':' + i} f={f} i={i} />) : <Empty>{t('bm.noFights')}</Empty>}
    </Panel>
    <Note data-bm-export="" action={<Button size="sm" variant="outline" disabled={!V.bossRecs?.n} onClick={() => host({ type: 'bossExport' })}>{t('set.bossExport.btn')}</Button>}>
      <b>{t('bm.export')}</b> · {V.bossRecs ? t('set.bossExport.sub', { n: V.bossRecs.n, mb: num(V.bossRecs.mb) }) : '–'}
      <div className={cn(SUB, 'mt-0.5')}>{t('bm.exportSub')}</div>
    </Note>
  </>
}

/** One dungeon: its bosses (a boss with stages is one row). */
function DungeonPage({ name }: { name: string }) {
  const d = dungeons().find(x => x.name === name)
  if (!d) return <Empty>{t('bm.noFights')}</Empty>
  return (
    <Panel title={t('bm.bosses')} data-bm-dungeon={name}>
      {d.bosses.map(e => {
        const id = e.ids[0], b = findBoss(mods(), id)!, mode = bossMode(id)
        const n = Object.entries(b.skills).filter(([k, s]) => alertOn(s, cfgs()[k])).length
        return (
          <div key={id} data-bm-boss={id} className={cn(ROW, ROW_CLICK, 'group min-h-11')} onClick={() => openBoss(id)}>
            <Swords className={cn('size-4 flex-none', mode === 'off' ? 'text-dim' : 'text-gold')} />
            <div className="min-w-0 flex-1">
              <div className={TITLE}>{e.name}</div>
              <div className={META}>{t('bm.fights', { n: e.fights })} · {t('bm.alerts', { n })}{e.ids.length > 1 ? ' · ' + t('bm.stages', { n: e.ids.length }) : ''}{mode !== 'on' ? ' · ' + t('bm.mode.' + mode) : ''}</div>
            </div>
            <ChevronRight className="size-4 flex-none text-dim transition-colors group-hover:text-gold" />
          </div>
        )
      })}
    </Panel>
  )
}

// ---------------------------------------------------------------- boss detail

const goSkill = (id: string) => {
  U.open = { ...U.open, 'bm.tab': 'skills' }
  V.bmFocus = id
  if (!V.bmAll && !document.querySelector(`[data-bm-skill="${id}"]`)) V.bmAll = true
  bump()
  requestAnimationFrame(() => document.querySelector(`[data-bm-skill="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
}

/** Timeline: per important skill a lane with its casts (of the chosen fight, else the typical ones), your markers as
 *  vertical lines; a click on a cast jumps to its skill in the editor. */
function Timeline({ b, fight, ids }: { b: BossStat; fight?: FightLog; ids: string[] }) {
  const end = fight?.dur || Math.max(60, ...b.dur)
  const casts = (id: string): number[] => {
    if (fight) return fight.casts.filter(c => String(c[0]) === id).map(c => c[1])
    const s = b.skills[id], out: number[] = []
    for (let i = 0, at = s.first; i < Math.round(s.n) && at <= end; i++, at += s.gap?.[1] ?? end) out.push(at)
    return out
  }
  const W = 1000, lane = 20, top = 6, h = top + ids.length * lane + 20
  const x = (s: number) => 150 + (Math.max(0, s) / end) * (W - 160)
  return (
    <svg viewBox={`0 0 ${W} ${h}`} className="w-full text-muted-foreground" data-bm-timeline="" role="img" aria-label={t('bm.timeline')}>
      {ids.map((id, i) => {
        const y = top + i * lane + lane / 2, cfg = cfgs()[id]
        return (
          <g key={id}>
            <text x={4} y={y + 4} fontSize="11" fill="currentColor" className="cursor-pointer" onClick={() => goSkill(id)}>{skillName(+id, cfg).slice(0, 22)}</text>
            <line x1={120} x2={W - 10} y1={y} y2={y} stroke="currentColor" strokeOpacity="0.15" />
            {casts(id).map((at, k) => (
              <circle key={k} cx={x(at)} cy={y} r={5} fill={kindCol(cfg)} fillOpacity={cfg?.kind ? 1 : 0.7} className="cursor-pointer" onClick={() => goSkill(id)}>
                <title>{`${skillName(+id, cfg)} · ${dur(at)}`}</title>
              </circle>
            ))}
          </g>
        )
      })}
      {(fight?.marks || []).map((m, i) => (
        <g key={'m' + i}>
          <line x1={x(m)} x2={x(m)} y1={0} y2={h - 16} stroke="var(--color-gold, #d9a441)" strokeDasharray="3 2" />
          <text x={x(m) + 3} y={10} fontSize="10" fill="var(--color-gold, #d9a441)">⚑ {dur(m)}</text>
        </g>
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map(f => <text key={f} x={x(f * end)} y={h - 4} fontSize="10" textAnchor="middle" fill="currentColor" fillOpacity="0.6">{dur(f * end)}</text>)}
    </svg>
  )
}

function SkillRow({ id, s, near }: { id: string; s: SkillStat; near?: number }) {
  const cfg = cfgs()[id], own = ownCfgs()[id], ph = phaseHp(s)
  const facts = [t('bm.stat', { n: num(s.n), first: Math.round(s.first) }), s.gap && t('bm.gap', { gap: Math.round(s.gap[1]) }),
    s.cast && t('bm.cast', { s: num(s.cast) }), s.hp && t('bm.hp', { a: s.hp[0], b: s.hp[1] }), ph !== null && t('bm.phase', { hp: ph }),
    predictable(s) && t('bm.pred')].filter(Boolean).join(' · ')
  const kinds = [{ value: '', label: t('boss.k.none') }, ...KINDS.map(k => ({ value: k, label: t('boss.k.' + k) }))]
  const lead = warnLead(s, cfg)
  return (
    <div data-bm-skill={id} className={cn('flex flex-col gap-1 border-b border-border/50 px-3 py-2', near !== undefined && 'bg-gold/[0.06]', V.bmFocus === id && 'ring-1 ring-gold/60 ring-inset')}>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="size-2.5 flex-none rounded-full" style={{ background: kindCol(cfg) }} />
        <input value={own?.name ?? ''} placeholder={cfg?.name || `Skill ${id}`} aria-label={t('bm.name')} data-bm-name={id}
          onChange={e => setCfg(id, { name: e.target.value })}
          className="h-7 min-w-0 flex-[1_1_9rem] rounded-md border border-transparent bg-transparent px-1.5 text-[13px] font-semibold outline-none hover:border-border focus:border-gold/60 focus:bg-background" />
        <AppSelect value={cfg?.kind ?? ''} options={kinds} tip={t('bm.kind')} className="h-7 w-28 flex-none text-xs" onChange={v => setCfg(id, { kind: (v || undefined) as Kind | undefined })} />
        <span className="flex flex-none items-center gap-1" data-bm-switches="">
          <IconSwitch icon={Flag} on={alertOn(s, cfg)} tip={t('bm.alert')} onClick={() => setCfg(id, { alert: !alertOn(s, cfg) })} />
          <IconSwitch icon={voiceOn(cfg) ? Volume2 : VolumeX} on={voiceOn(cfg)} tip={t('bm.voice')} onClick={() => setCfg(id, { voice: !voiceOn(cfg) })} />
          {predictable(s) && <IconSwitch icon={BarChart3} on={barOn(s, cfg)} tip={t('bm.bar')} onClick={() => setCfg(id, { bar: !barOn(s, cfg) })} />}
          {predictable(s) && <IconSwitch icon={AlarmClock} on={lead > 0} tip={t('bm.warnTip')} label={lead > 0 ? `${lead}s` : undefined} onClick={() => setCfg(id, { warn: lead > 0 ? 0 : 5 })} />}
          {BLAME && <IconSwitch icon={Skull} on={avoidable(s, cfg)} tip={t('bm.avoidTip')} onClick={() => setCfg(id, { avoid: !avoidable(s, cfg) })} />}
        </span>
      </div>
      {near !== undefined && <div className="pl-4 text-[11.5px] font-semibold text-gold" data-bm-near="">⚑ {t('bm.nearMark', { at: dur(near) })}</div>}
      <div className={cn(SUB, 'pl-4 text-[11.5px]')}>{facts} · <span className="tabular-nums">#{id}</span></div>
      <input value={own?.text ?? ''} placeholder={cfg?.text || (cfg?.kind ? t('boss.k.' + cfg.kind) : t('bm.textPh'))} aria-label={t('bm.text')} onChange={e => setCfg(id, { text: e.target.value })}
        className="ml-4 h-7 min-w-0 rounded-md border bg-background px-2 text-[12px] outline-none focus:border-gold/60" />
    </div>
  )
}

/** The guide (bossguide.json): Frenzy, phases, mechanics with what to do and their skill ids; placeholders marked.
 *  Nothing when the boss has no guide or an empty one. */
function Guide({ npc }: { npc: number }) {
  const g = guide(npc)
  const todo = <span className="ml-1.5 rounded-sm bg-gold/15 px-1 text-[10.5px] font-semibold text-gold">{t('bm.todo')}</span>
  if (!g || !g.phases.length && !g.mechanics.length && !g.frenzy) return null
  return (
    <div data-bm-guide="" className="border-t border-border/50 pt-1">
      <div className={cn(META, 'px-3 pt-1.5')}>{t('bm.guide')}{g.frenzy ? ' · ' + t('bm.frenzy', { t: dur(g.frenzy) }) : ''}</div>
      {g.phases.map(p => (
        <div key={p.name + p.hp} className={cn(ROW, 'min-h-8')}>
          <span className="w-12 flex-none text-right font-semibold tabular-nums text-gold">{p.hp} %</span>
          <span className="min-w-0 flex-1 truncate">{p.name}{p.todo && todo}</span>
        </div>
      ))}
      {/* mechanics as compact chips: colour + badge = what to do, the hint below, dot = values follow */}
      {g.mechanics.length > 0 && <div className="flex flex-wrap gap-1.5 px-3 py-2.5" data-bm-mechs="">
        {g.mechanics.map(m => (
          <span key={m.name} data-bm-mech={m.name}
            data-tip={[m.hint, m.cast ? t('bm.cast', { s: num(m.cast) }) : '', m.skills.length ? t('bm.mechSkills', { ids: m.skills.join(', ') }) : t('bm.mechNoSkills'), m.todo ? t('bm.todo') : ''].filter(Boolean).join('\n')}
            className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-[12px]">
            <span className="size-2 flex-none rounded-full" style={{ background: kindCol({ kind: m.kind }) }} />
            <span className="truncate">{m.name}</span>
            {m.kind && <span className="flex-none text-[10.5px] font-semibold text-muted-foreground uppercase">{t('boss.k.' + m.kind)}</span>}
            {m.todo && <span className="size-1.5 flex-none rounded-full bg-gold" aria-label={t('bm.todo')} />}
          </span>
        ))}
      </div>}
    </div>
  )
}

/** Profile string of a boss's own skill settings (like WeakAuras strings): copy / paste to share with the group. */
function Share({ npc, b }: { npc: number; b: BossStat }) {
  const [text, setText] = useState('')
  const [msg, setMsg] = useState('')
  const exp = () => {
    const skills = Object.fromEntries(Object.entries(ownCfgs()).filter(([id]) => b.skills[id]))
    copy(PROFILE + btoa(unescape(encodeURIComponent(JSON.stringify({ npc, skills })))))
    setMsg(t('bm.share.copied', { n: Object.keys(skills).length }))
  }
  const imp = () => {
    try {
      const d = JSON.parse(decodeURIComponent(escape(atob(text.trim().slice(PROFILE.length)))))
      if (!text.trim().startsWith(PROFILE) || typeof d?.skills !== 'object') throw new Error()
      const skills = Object.fromEntries(Object.entries(d.skills as Record<string, SkillCfg>).filter(([id]) => b.skills[id]))
      U.bossSkills = { ...ownCfgs(), ...skills }
      saveUi(['bossSkills'])
      setText('')
      setMsg(t('bm.share.done', { n: Object.keys(skills).length }))
      bump()
    } catch { setMsg(t('bm.share.bad')) }
  }
  return (
    <div data-bm-share="" className="border-t border-border/50 px-3 pt-2 pb-2.5">
      <div className={cn(META, 'pb-1.5')}>{t('bm.share')}{msg ? ' · ' + msg : ''}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="outline" onClick={exp}><ClipboardCopy />{t('bm.share.copy')}</Button>
        <input value={text} onChange={e => setText(e.target.value)} placeholder={t('bm.share.ph')} aria-label={t('bm.share.ph')} data-bm-import=""
          className="h-8 min-w-0 flex-[1_1_12rem] rounded-md border bg-background px-2 text-[12px] outline-none focus:border-gold/60" />
        <Button size="sm" variant="outline" disabled={!text.trim()} onClick={imp}>{t('bm.share.import')}</Button>
      </div>
    </div>
  )
}

function Detail({ npc }: { npc: number }) {
  const b = findBoss(mods(), npc)
  const fights: FightLog[] = U.bossFights || []
  const fight = V.bmFight != null ? fights[V.bmFight] : fights.find(f => canon(f.npc) === npc)
  if (!b) return <Panel><Empty>{t('bm.noFights')}</Empty></Panel>
  const shown = fight && canon(fight.npc) === npc ? fight : undefined
  // skills cast within 3 s before one of your markers: the likely ones to name – always listed, first
  const near = new Map<string, number>()
  for (const m of shown?.marks || []) for (const [sk, at] of shown!.casts) if (m - at >= -1 && m - at <= 3 && !b.skills[sk]?.common && !near.has(String(sk))) near.set(String(sk), at)
  const all = !!V.bmAll
  const list = Object.entries(b.skills).filter(([id, s]) => all || important(id, s) || near.has(id))
    .sort((x, y) => Number(near.has(y[0])) - Number(near.has(x[0])))
  const lanes = Object.entries(b.skills).filter(([id, s]) => important(id, s) || near.has(id)).map(([id]) => id)
  const testing = V.bmTest?.npc === npc
  const mode = bossMode(npc)
  const setMode = (v: BossMode) => { U.bossBoss = { ...U.bossBoss, [canon(npc)]: v }; saveUi(['bossBoss']); bump() }
  const head = <div className="flex flex-wrap items-center gap-1.5">
    <Seg size="sm" value={mode} onChange={setMode} item={v => ({ 'data-bm-mode': v })}
      options={(['on', 'bars', 'off'] as BossMode[]).map(v => ({ value: v, label: t('bm.mode.' + v), tip: t('bm.mode') }))} />
    {testing
      ? <Button size="sm" variant="outline" data-bm-stop="" onClick={stopTest}><Square />{t('bm.testStop')}</Button>
      : <Button size="sm" variant="outline" data-bm-test="" data-tip={t('bm.testTip')} onClick={() => testPull(npc)}><Play />{t('bm.test')}</Button>}
  </div>
  const stages = entryOf(npc)?.boss.ids ?? [npc]
  return (
    <Panel title={bossName(npc, b)} sub={dungeon(b.zone)} right={head} data-bm-detail={String(npc)}>
      {stages.length > 1 && <div className="flex items-center gap-2 px-3 pb-2">
        <span className={META}>{t('bm.stage')}</span>
        <Seg size="sm" value={String(npc)} onChange={v => openBoss(+v)} item={v => ({ 'data-bm-stage': v })}
          options={stages.map((id, i) => ({ value: String(id), label: String(i + 1) }))} />
      </div>}
      <PanelTabs id="bm.tab" tabs={[{ value: 'flow', label: t('bm.tab.flow') }, { value: 'skills', label: t('bm.tab.skills', { n: list.length }) }]}>
        {tab => tab === 'flow'
          ? <>
            <div className="px-3 pt-2 pb-2">
              {/* a kept fight, else the typical times (first use of each skill, over all recorded fights) */}
              <div className={cn(META, 'pb-1')}>{shown
                ? <>{t('bm.tab.fight', { at: hm(shown.at), dur: dur(shown.dur) })} · <span className={shown.died ? 'text-green' : 'text-red'}>{outcome(shown)}</span></>
                : t('bm.tab.typical', { n: b.fights })}</div>
              <Timeline b={b} fight={shown} ids={lanes} />
            </div>
            {shown && BLAME && (
              <div className="flex flex-wrap items-center gap-1 px-3 pb-2.5" data-bm-blame="">
                <span className={cn(META, 'mr-1')}>{t('bm.blame')}:</span>
                <BlameChips log={shown} limit={10} />
                {blameOf(shown).length > 0 && (
                  <Button size="sm" variant="ghost" data-tip={t('bm.blameCopyTip')}
                    onClick={() => copy(t('boss.sayBlame', { list: blameOf(shown).map(x => `${x.name} ${x.hits}×`).join(', ') }))}><ClipboardCopy /></Button>
                )}
              </div>
            )}
            <Guide npc={npc} />
          </>
          : <>
            {list.map(([id, s]) => <SkillRow key={id} id={id} s={s} near={near.get(id)} />)}
            <div className="flex justify-end px-3 py-1.5">
              <Button size="sm" variant="ghost" onClick={() => { V.bmAll = !all; bump() }}>
                {all ? t('bm.showMain') : t('bm.showAll', { n: Object.keys(b.skills).length })}</Button>
            </div>
            <Share npc={npc} b={b} />
          </>}
      </PanelTabs>
    </Panel>
  )
}

// ---------------------------------------------------------------- navigation

/** Open a boss (optionally with one of the kept fights); its dungeon page becomes the current one. */
function openBoss(npc: number, fight: number | null = null) {
  V.bmBoss = npc; V.bmFight = fight; V.bmFocus = null
  V.bmDungeon = entryOf(npc)?.dungeon.name ?? V.bmDungeon ?? null
  bump()
}
const toPage = (dng: string | null) => { V.bmDungeon = dng; V.bmBoss = V.bmFight = V.bmFocus = null; bump() }

/** The bar: the path Boss-Helfer › dungeon › boss (each step goes back there), the helper's voice and on / off at the right. */
function NavBar() {
  const b = V.bmBoss ? findBoss(mods(), V.bmBoss) : undefined, dng: string | null = V.bmDungeon ?? (b ? dungeonName(b.zone) : null)
  const crumb = 'flex h-6 min-w-0 flex-none items-center truncate rounded-md px-1.5 text-[12px] text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
  const last = 'font-semibold text-foreground'
  const voice = !!U.tts && !U.ttsOff?.bossmod
  const sep = <ChevronRight className="size-3.5 flex-none text-dim" />
  return <>
    <nav className="flex min-w-0 flex-[1_1_12rem] items-center gap-0.5" aria-label={t('bm.path')}>
      <button onClick={() => toPage(null)} data-bm-nav="overview" className={cn(crumb, !dng && last)}>{t('tab.bossmod')}</button>
      {dng && <>{sep}<button onClick={() => toPage(dng)} data-bm-nav="dungeon" className={cn(crumb, 'max-w-48', !b && last)}>{dng}</button></>}
      {b && <>{sep}<span data-bm-nav="boss" className={cn(crumb, 'max-w-48 hover:bg-transparent', last)}>{bossName(V.bmBoss, b)}</span></>}
    </nav>
    <BarRight>
      <IconSwitch icon={voice ? Volume2 : VolumeX} on={voice} tip={t('set.bossVoice')} data-bm-voice={voice ? 'on' : 'off'}
        onClick={() => { U.ttsOff = { ...U.ttsOff, bossmod: voice }; if (!voice) U.tts = true; saveUi(['tts', 'ttsOff']); bump() }} />
      <Button size="xs" variant={U.bossMod ? 'ghost' : 'default'} data-bm-power={U.bossMod ? 'on' : 'off'}
        className={cn(U.bossMod && 'text-green')} onClick={() => setU('bossMod', !U.bossMod)}>
        {U.bossMod ? t('bm.isOn') : t('bm.on')}
      </Button>
    </BarRight>
  </>
}

export function BossModTab() {
  useApp()
  return (
    <Page w="rows" bar={<NavBar />}>
      {!U.bossMod && <Note action={<Button size="sm" onClick={() => setU('bossMod', true)}>{t('bm.on')}</Button>}>{t('bm.off')}</Note>}
      {U.bossMod && !U.bossSetupDone && !V.bmDungeon && !V.bmBoss && <Setup />}
      {U.bossMod && U.bossSetupDone && !U.tts && (
        <Note data-bm-tts-off="" action={<Button size="sm" onClick={() => setU('tts', true)}>{t('bm.ttsOn')}</Button>}>{t('bm.ttsOff')}</Note>
      )}
      {V.bmBoss ? <Detail npc={V.bmBoss} /> : V.bmDungeon ? <DungeonPage name={V.bmDungeon} /> : <Overview />}
    </Page>
  )
}
