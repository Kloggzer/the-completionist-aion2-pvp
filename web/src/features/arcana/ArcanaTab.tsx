import { useApp } from '@/core/state'
import { fmt, lang, t } from '@/core/i18n'
import { AppSelect } from '@/components/AppSelect'
import { BADGE, BarInfo, BarRight, CHIP, CHIP_ON, Columns, Empty, Foot, Hint, Note, Page, ROW, ROWS, Sect } from '@/components/kit'
import { cn } from '@/lib/utils'
import { className, data as daeData } from '@/features/daevanion/daevanion'
import { GRADES, KINDS, arcClass, arcData, arcSave, arcSettings, arcSkills, classId, skillName, type ArcData, type ArcSkill, type Kind } from './arcana'

const TIER_DOT = ['bg-red/70', 'bg-dim/60', 'bg-cyan/80', 'bg-gold'] as const
const TIER_TEXT = ['text-dim line-through', 'text-muted-foreground', 'text-foreground', 'text-gold'] as const
const GRADE_TEXT: Record<string, string> = { Common: 'text-muted-foreground', Rare: 'text-green', Epic: 'text-[#c792ff]', Unique: 'text-gold' }
const pct = (v: number) => fmt(v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + ' %'
const kindName = (k: string) => t('arc.kind.' + k)
const gradeName = (g: string) => t('arc.grade.' + g)

function SkillRow({ s }: { s: ArcSkill }) {
  const tip = GRADES.map((g, i) => `${gradeName(g)}: ${pct(s.chance[i])} · ${kindName('Chalice')} ${pct(s.chalice[i])}`).join('\n')
  return (
    <div data-arc-skill={s.en} className={cn(ROW, 'gap-1.5')} data-tip={(lang() === 'de' ? s.en + '\n' : '') + tip}>
      <span className={cn('size-2 flex-none rounded-full', TIER_DOT[s.tier])} data-tip={t('arc.tier.' + s.tier)} />
      <span className={cn('min-w-0 flex-1 truncate', TIER_TEXT[s.tier])}>{skillName(s)} <i className="text-[10.5px] text-dim not-italic">{t(s.active ? 'arc.active' : 'arc.passive')}</i></span>
      {s.need > 0 && <span className={cn(BADGE, 'text-gold')} data-tip={t('arc.needTip')}>{t('arc.need', { n: s.need })}</span>}
      <span data-kind={s.kind} className={cn(BADGE, 'w-[74px] text-center')}>{kindName(s.kind)}</span>
      <span className="w-12 flex-none text-right font-semibold text-gold tabular-nums" data-tip={t('arc.uniqueTip')}>{pct(s.chance[3])}</span>
      <span className="w-12 flex-none text-right text-muted-foreground tabular-nums" data-tip={t('arc.chaliceTip')}>{pct(s.chalice[3])}</span>
    </div>
  )
}

function CardBlock({ d, k, skills }: { d: ArcData; k: Kind; skills: ArcSkill[] }) {
  const c = d.cards[k]
  if (!c) return null
  const on = k === 'Chalice' ? skills : skills.filter(s => s.kind === k)
  const what = k === 'Chalice' ? t('arc.all') : on.every(s => s.active) ? t('arc.actives') : on.every(s => !s.active) ? t('arc.passives') : ''
  return <div data-card={k}>
    <Sect sub={[what, t('arc.listSize', { n: c.n })].filter(Boolean).join(' · ')}>{kindName(k)}</Sect>
    <Note>
      {GRADES.map(g => <span key={g} className={cn('mr-2 whitespace-nowrap', GRADE_TEXT[g])}>{gradeName(g)}: {t('arc.per', { n: c.per[g], top: c.top[g] })}</span>)}
    </Note>
    <Note>{c.main.join(' · ')}{c.drops.length > 0 && <> · <span className="text-cyan">{c.drops.join(', ')}</span></>}</Note>
    {k !== 'Chalice' && <div className="flex flex-wrap gap-1 px-2.5 pb-1.5">
      {on.map(s => <span key={s.en} className={cn(CHIP, 'h-5 px-1.5 text-[11px]', s.tier >= 2 && CHIP_ON, TIER_TEXT[s.tier])}>{skillName(s)}{s.need > 0 && <i className="text-gold not-italic">+{s.need}</i>}</span>)}
    </div>}
  </div>
}

function Drops({ d }: { d: ArcData }) {
  const dungeons = [...new Set(d.drops.map(x => x[0]))]
  return <>
    {dungeons.map(dn => {
      const rows = d.drops.filter(x => x[0] === dn), stages = [...new Set(rows.map(x => x[1]))].sort()
      return <div key={dn} data-drops={dn}>
        <Sect sub={t('arc.dropsSub')}>{dn}</Sect>
        <div className={ROWS}>
          {stages.map(st => (
            <div key={st} className={cn(ROW, 'flex-wrap gap-x-2 gap-y-0.5 py-1')}>
              <span className="w-8 flex-none font-semibold text-muted-foreground">{t('arc.stage', { n: st })}</span>
              {KINDS.filter(k => rows.some(x => x[1] === st && x[2] === k)).map(k => (
                <span key={k} className="text-[11.5px] whitespace-nowrap tabular-nums">
                  <span className="text-muted-foreground">{kindName(k)} </span>
                  {GRADES.flatMap(g => rows.filter(x => x[1] === st && x[2] === k && x[3] === g)).map((x, i) => (
                    <span key={x[3]} className={GRADE_TEXT[x[3]]} data-tip={gradeName(x[3])}>{i ? ' / ' : ''}{pct(x[4])}</span>
                  ))}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    })}
    {d.transmute && <Note>{t('arc.transmute', {
      grade: gradeName(d.transmute.grade), n: d.transmute.n, mat: d.transmute.material, kinah: fmt(d.transmute.kinah), picks: d.transmute.picks,
      en: d.transmute.extra?.materials ?? 0, ek: fmt(d.transmute.extra?.kinah ?? 0),
    })}</Note>}
  </>
}

export function ArcanaTab() {
  useApp()
  const d = arcData(), dae = daeData()
  if (d === null || dae === null) return <Empty>{t('arc.loading')}</Empty>
  if (!d || !dae) return <Empty>{t('arc.missing')}</Empty>
  const s = arcSettings(), cls = s.cls && dae.classes[s.cls] ? s.cls : classId()
  const all = arcSkills(d, cls), kind = s.kind as Kind | 'all', guide = !!s.guide
  const shown = all.filter(x => (kind === 'all' || kind === 'Chalice' || x.kind === kind) && (!guide || x.tier >= 2))
  const bar = <>
    <BarInfo>{t('arc.info', { cls: className(dae.classes[cls]), n: all.length })}</BarInfo>
    <BarRight>
      <AppSelect value={cls} tip={t('arc.class')} className="h-6 text-xs"
        options={Object.entries(dae.classes).filter(([k]) => arcClass(d, k)).map(([k, x]) => ({ value: k, label: className(x) }))} onChange={v => arcSave({ cls: v })} />
      {(['all', ...KINDS] as const).map(k => (
        <button key={k} data-kind-filter={k} onClick={() => arcSave({ kind: k })} className={cn(CHIP, kind === k && CHIP_ON)}>{k === 'all' ? t('arc.allCards') : kindName(k)}</button>
      ))}
      <button data-guide-filter onClick={() => arcSave({ guide: !guide })} data-tip={t('arc.guideTip')} className={cn(CHIP, guide && CHIP_ON)}>{t('arc.guide')}</button>
    </BarRight>
  </>
  return (
    <Page w="rows" bar={bar}>
      <Hint>{t('arc.hint')}</Hint>
      <Columns>
        <div>
          <Sect sub={<span className="flex gap-3"><span>{t('arc.colUnique')}</span><span>{t('arc.colChalice')}</span></span>}>{t('arc.sect.skills')}</Sect>
          <div className={ROWS}>{shown.map(x => <SkillRow key={x.en} s={x} />)}</div>
          <Note>
            {[3, 2, 1, 0].map(n => <span key={n} className="mr-3 inline-flex items-center gap-1"><span className={cn('size-2 rounded-full', TIER_DOT[n])} />{t('arc.tier.' + n)}</span>)}
          </Note>
        </div>
        <div>{(kind === 'all' ? KINDS : [kind]).map(k => <CardBlock key={k} d={d} k={k} skills={all} />)}</div>
        <div><Drops d={d} /></div>
      </Columns>
      <Foot>{t('arc.foot', { date: d.date })}</Foot>
    </Page>
  )
}
