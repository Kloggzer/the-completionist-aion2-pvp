// "Boss-Helfer" page: setup card (role, voice, place the windows), the last fights with the Petze (counted again with
// today's settings) and wipe info, the dungeon bosses with a timeline (bossmods.json), and per boss: on / bars only /
// off, timeline with your markers (click a cast: its skill), guide (phases, mechanics), skill editor (name, what to
// do, callout, banner / voice / bar / warning / Petze; U.bossSkills), a profile string to share, test pull, export.
import { useState } from 'react'
import { ChevronLeft, ClipboardCopy, Play, Skull, Square, Swords } from 'lucide-react'
import { G, U, V, bump, saveUi, useApp } from '@/core/state'
import { emit } from '@/core/bus'
import { host } from '@/core/host'
import { hm, locale, t } from '@/core/i18n'
import { hkText } from '@/core/session'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { AppSelect } from '@/components/AppSelect'
import { CHIP, CHIP_ON, Empty, META, Page, Panel, ROW, ROW_CLICK, SUB, Seg, TITLE } from '@/components/kit'
import { toggleWinEdit } from '@/features/pvp'
import { KINDS, alertOn, avoidable, barOn, findBoss, isBig, kindCol, phaseHp, predictable, skillName, voiceOn, warnLead, type BossMods, type BossStat, type Kind, type Role, type SkillCfg, type SkillStat } from './logic'
import { blameActive, blameOf, bossMode, canon, cfgs, guide, ownCfgs, role, stopTest, testPull, type BossMode, type FightLog } from './index'

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

function Chip({ on, onClick, children, tip }: { on: boolean; onClick: () => void; children: React.ReactNode; tip?: string }) {
  return <button onClick={onClick} data-tip={tip} aria-pressed={on} className={cn(CHIP, 'h-6 px-2 text-[11.5px]', on && CHIP_ON)}>{children}</button>
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
  const open = () => { V.bmBoss = canon(f.npc); V.bmFight = i; bump() }
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
          const n = Object.entries(b.skills).filter(([k, s]) => alertOn(s, cfgs()[k])).length, mode = bossMode(+id)
          return (
            <div key={id} data-bm-boss={id} className={cn(ROW, ROW_CLICK, 'min-h-11')} onClick={() => { V.bmBoss = +id; V.bmFight = null; bump() }}>
              <Swords className={cn('size-4 flex-none', mode === 'off' ? 'text-dim' : 'text-gold')} />
              <div className="min-w-0 flex-1">
                <div className={TITLE}>{b.name}</div>
                <div className={META}>{t('bm.fights', { n: b.fights })} · {t('bm.alerts', { n })}{mode !== 'on' ? ' · ' + t('bm.mode.' + mode) : ''}</div>
              </div>
            </div>
          )
        })}
      </Panel>
    ))}
    <Note data-bm-export="" action={<Button size="sm" variant="outline" disabled={!V.bossRecs?.n} onClick={() => host({ type: 'bossExport' })}>{t('set.bossExport.btn')}</Button>}>
      <b>{t('bm.export')}</b> · {V.bossRecs ? t('set.bossExport.sub', { n: V.bossRecs.n, mb: num(V.bossRecs.mb) }) : '–'}
      <div className={cn(SUB, 'mt-0.5')}>{t('bm.exportSub')}</div>
    </Note>
  </>
}

// ---------------------------------------------------------------- boss detail

const goSkill = (id: string) => {
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
  const W = 600, lane = 18, top = 6, h = top + ids.length * lane + 20
  const x = (s: number) => 120 + (Math.max(0, s) / end) * (W - 130)
  return (
    <svg viewBox={`0 0 ${W} ${h}`} className="w-full text-muted-foreground" data-bm-timeline="" role="img" aria-label={t('bm.timeline')}>
      {ids.map((id, i) => {
        const y = top + i * lane + lane / 2, cfg = cfgs()[id]
        return (
          <g key={id}>
            <text x={4} y={y + 4} fontSize="11" fill="currentColor" className="cursor-pointer" onClick={() => goSkill(id)}>{skillName(+id, cfg).slice(0, 18)}</text>
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
    <div data-bm-skill={id} className={cn('flex flex-col gap-1.5 border-b border-border/50 px-3 py-2', near !== undefined && 'bg-gold/[0.06]', V.bmFocus === id && 'ring-1 ring-gold/60 ring-inset')}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="h-3 w-1.5 flex-none rounded-sm" style={{ background: kindCol(cfg) }} />
        <input value={own?.name ?? ''} placeholder={cfg?.name || `Skill ${id}`} aria-label={t('bm.name')} data-bm-name={id}
          onChange={e => setCfg(id, { name: e.target.value })}
          className="h-7 min-w-0 flex-[1_1_10rem] rounded-md border bg-background px-2 text-[13px] font-semibold outline-none focus:border-gold/60" />
        <AppSelect value={cfg?.kind ?? ''} options={kinds} className="w-32 flex-none" onChange={v => setCfg(id, { kind: (v || undefined) as Kind | undefined })} />
      </div>
      {near !== undefined && <div className="text-[11.5px] font-semibold text-gold" data-bm-near="">⚑ {t('bm.nearMark', { at: dur(near) })}</div>}
      <div className={cn(SUB, 'text-[11.5px]')}>{facts} · <span className="tabular-nums">#{id}</span></div>
      <div className="flex flex-wrap items-center gap-1">
        <input value={own?.text ?? ''} placeholder={cfg?.text || (cfg?.kind ? t('boss.k.' + cfg.kind) : t('bm.textPh'))} aria-label={t('bm.text')} onChange={e => setCfg(id, { text: e.target.value })}
          className="h-6 min-w-0 flex-[1_1_12rem] rounded-md border bg-background px-2 text-[12px] outline-none focus:border-gold/60" />
        <Chip on={alertOn(s, cfg)} onClick={() => setCfg(id, { alert: !alertOn(s, cfg) })}>{t('bm.alert')}</Chip>
        <Chip on={voiceOn(cfg)} onClick={() => setCfg(id, { voice: !voiceOn(cfg) })}>{t('bm.voice')}</Chip>
        {predictable(s) && <Chip on={barOn(s, cfg)} onClick={() => setCfg(id, { bar: !barOn(s, cfg) })}>{t('bm.bar')}</Chip>}
        {predictable(s) && <Chip on={lead > 0} tip={t('bm.warn')} onClick={() => setCfg(id, { warn: lead > 0 ? 0 : 5 })}>{t('bm.warn')}{lead > 0 ? ` ${lead} s` : ''}</Chip>}
        <Chip on={avoidable(s, cfg)} tip={t('bm.avoidTip')} onClick={() => setCfg(id, { avoid: !avoidable(s, cfg) })}>{t('bm.avoid')}</Chip>
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
      {/* mechanics as compact chips: colour + badge = what to do, the hint below, dot = values follow */}
      <div className="flex flex-wrap gap-1.5 px-3 py-2.5" data-bm-mechs="">
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
      </div>
    </Panel>
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
    <Panel title={t('bm.share')} sub={msg || undefined} data-bm-share="">
      <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2.5">
        <Button size="sm" variant="outline" onClick={exp}><ClipboardCopy />{t('bm.share.copy')}</Button>
        <input value={text} onChange={e => setText(e.target.value)} placeholder={t('bm.share.ph')} aria-label={t('bm.share.ph')} data-bm-import=""
          className="h-8 min-w-0 flex-[1_1_12rem] rounded-md border bg-background px-2 text-[12px] outline-none focus:border-gold/60" />
        <Button size="sm" variant="outline" disabled={!text.trim()} onClick={imp}>{t('bm.share.import')}</Button>
      </div>
    </Panel>
  )
}

function Detail({ npc }: { npc: number }) {
  const b = findBoss(mods(), npc)
  const fights: FightLog[] = U.bossFights || []
  const fight = V.bmFight != null ? fights[V.bmFight] : fights.find(f => canon(f.npc) === npc)
  const back = <Button size="sm" variant="ghost" onClick={() => { V.bmBoss = null; V.bmFight = null; V.bmFocus = null; bump() }}><ChevronLeft />{t('bm.back')}</Button>
  if (!b) return <Panel>{back}<Empty>{t('bm.noFights')}</Empty></Panel>
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
  return <>
    <Panel title={b.name} sub={dungeon(b.zone)} right={<div className="flex flex-wrap gap-1">{back}
      {testing
        ? <Button size="sm" variant="outline" data-bm-stop="" onClick={stopTest}><Square />{t('bm.testStop')}</Button>
        : <Button size="sm" variant="outline" data-bm-test="" data-tip={t('bm.testTip')} onClick={() => testPull(npc)}><Play />{t('bm.test')}</Button>}
    </div>}>
      <div className="flex flex-wrap items-center gap-2 px-3 pb-2">
        <span className={META}>{t('bm.mode')}</span>
        <Seg size="sm" value={mode} onChange={setMode} item={v => ({ 'data-bm-mode': v })}
          options={(['on', 'bars', 'off'] as BossMode[]).map(v => ({ value: v, label: t('bm.mode.' + v) }))} />
      </div>
      <div className="px-3 pb-2"><Timeline b={b} fight={shown} ids={lanes} /></div>
      {shown && (
        <div className="flex flex-wrap items-center gap-1 px-3 pb-2.5" data-bm-blame="">
          <span className={cn(META, 'mr-1')}>{outcome(shown)} · {t('bm.blame')}:</span>
          <BlameChips log={shown} limit={10} />
          {blameOf(shown).length > 0 && (
            <Button size="sm" variant="ghost" data-tip={t('bm.blameCopyTip')}
              onClick={() => copy(t('boss.sayBlame', { list: blameOf(shown).map(x => `${x.name} ${x.hits}×`).join(', ') }))}><ClipboardCopy /></Button>
          )}
        </div>
      )}
    </Panel>
    <GuidePanel npc={npc} />
    <Panel title={t('bm.skills')} right={<Button size="sm" variant="ghost" onClick={() => { V.bmAll = !all; bump() }}>
      {all ? t('bm.showMain') : t('bm.showAll', { n: Object.keys(b.skills).length })}</Button>}>
      {list.map(([id, s]) => <SkillRow key={id} id={id} s={s} near={near.get(id)} />)}
    </Panel>
    <Share npc={npc} b={b} />
  </>
}

export function BossModTab() {
  useApp()
  return (
    <Page w="rows">
      {!U.bossMod && <Note action={<Button size="sm" onClick={() => setU('bossMod', true)}>{t('bm.on')}</Button>}>{t('bm.off')}</Note>}
      {U.bossMod && !U.bossSetupDone && <Setup />}
      {U.bossMod && U.bossSetupDone && !U.tts && (
        <Note data-bm-tts-off="" action={<Button size="sm" onClick={() => setU('tts', true)}>{t('bm.ttsOn')}</Button>}>{t('bm.ttsOff')}</Note>
      )}
      {V.bmBoss ? <Detail npc={V.bmBoss} /> : <Overview />}
    </Page>
  )
}
