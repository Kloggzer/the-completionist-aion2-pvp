import { useEffect } from 'react'
import { Layers, MapPin, Swords, Wine } from 'lucide-react'
import { goTab } from '@/core/nav'
import { U, useApp } from '@/core/state'
import { fmt, lang, t } from '@/core/i18n'
import { AppSelect } from '@/components/AppSelect'
import { BADGE, BarInfo, BarRight, BAR_GAME_ICON, GameIcon, Chip, Columns, Disclosure, Empty, Foot, Hint, HowTo, Kpi, KpiRow, Note, Page, Panel, ROW, ROWS, Sect, TopN, rich } from '@/components/kit'
import { cn } from '@/lib/utils'
import { charKey, classIcon, className, data as daeData, live } from '@/features/daevanion/daevanion'
import { advise, refetchCards } from './advise'
import { GRADES, KINDS, arcClass, arcData, arcSave, arcSettings, arcSkills, classId, skillName, type ArcData, type ArcSkill, type Kind } from './arcana'

const TIER_DOT = ['bg-red/70', 'bg-dim/60', 'bg-cyan/80', 'bg-gold'] as const
const TIER_TEXT = ['text-dim line-through', 'text-muted-foreground', 'text-foreground', 'text-gold'] as const
const GRADE_TEXT: Record<string, string> = { Common: 'text-muted-foreground', Rare: 'text-green', Epic: 'text-purple', Unique: 'text-gold' }
/** Card frame in the grade colour (token version of the game's grade colours). */
const GRADE_BORDER: Record<string, string> = { Common: 'border-foreground/25', Rare: 'border-green/70', Epic: 'border-purple/70', Unique: 'border-gold/80' }
/** Card art of a kind (public/icons, the same for every grade): the magic set has its own picture, else the vigor set's. */
const cardArt = (kind: string, set?: string) => `arcana-${kind.toLowerCase()}-${/magi/i.test(set ?? '') ? 'defenceset2' : 'pveset2'}`
const pct = (v: number) => fmt(v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + ' %'
const kindName = (k: string) => t('arc.kind.' + k)
const gradeName = (g: string) => t('arc.grade.' + g)

function SkillRow({ s }: { s: ArcSkill }) {
  const tip = GRADES.map((g, i) => `${gradeName(g)}: ${pct(s.chance[i])} · ${kindName('Chalice')} ${pct(s.chalice[i])}`).join('\n')
  return (
    <div data-arc-skill={s.en} className={cn(ROW, 'gap-1.5')} data-tip={(lang() === 'de' ? s.en + '\n' : '') + tip}>
      <span className={cn('size-2 flex-none rounded-full', TIER_DOT[s.tier])} data-tip={t('arc.tier.' + s.tier)} />
      <span className={cn('min-w-0 flex-1 truncate', TIER_TEXT[s.tier])}>{skillName(s)} <i className="text-[11px] text-dim not-italic">{t(s.active ? 'arc.active' : 'arc.passive')}</i></span>
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
      {on.map(s => <span key={s.en} className={cn(BADGE, 'font-normal', TIER_TEXT[s.tier])}>{skillName(s)}{s.need > 0 && <i className="text-gold not-italic">+{s.need}</i>}</span>)}
    </div>}
  </div>
}

function Drops({ d }: { d: ArcData }) {
  const dungeons = [...new Set(d.drops.map(x => x[0]))]
  return <>
    {dungeons.map(dn => {
      const rows = d.drops.filter(x => x[0] === dn), stages = [...new Set(rows.map(x => x[1]))].sort((a, b) => a - b)
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

const sign = (v: number) => (v >= 0 ? '+' : '−') + fmt(Math.round(Math.abs(v) * 1000) / 10) + ' %'
/** "almost every clear" / "1 in 4 clears" from the chance of an upgrade per clear. */
const every = (p: number) => { const n = Math.round(1 / Math.max(p, 1e-3)); return n <= 1 ? t('arc.adv.every1') : t('arc.adv.every', { n }) }
const enName = (cls: string, en: string) => {
  const s = daeData()?.classes[cls]?.skills.find(x => x.en === en)
  return s && lang() === 'de' ? s.de : en
}

/** For the own character: the cards and their worth, where to farm, Transmute. */
function Advice({ d, cls }: { d: ArcData; cls: string }) {
  const a = advise(d, cls)
  if (!a) return null
  const best = a.farm[0], tm = a.transmute
  const chalice = tm.filter(x => x.kind === 'Chalice').sort((x, y) => y.mean - x.mean)[0]
  const tmBest = [...tm].sort((x, y) => y.mean - x.mean)
  const have = a.slots.filter(s => s.card), worth = have.reduce((x, s) => x * (1 + s.cur), 1) - 1
  return <>
    {a.m.state !== 'cards' && <Hint tone="cyan">{t({ loading: 'arc.adv.loading', other: 'arc.adv.other', none: 'arc.adv.noLive' }[a.m.state])}</Hint>}
    <KpiRow>
      <Kpi icon={MapPin} label={t('arc.kpi.best')} value={best ? sign(best.gain) : '–'} sub={best ? `${best.dungeon} · ${t('arc.stage', { n: best.stage })}` : undefined}
        tip={best ? t('arc.adv.gainTip') : undefined} onClick={best ? () => goTab('arc', '[data-arc-farm]') : undefined} data-kpi="best" />
      <Kpi icon={Wine} label={t('arc.kpi.chalice')} value={chalice ? sign(chalice.mean) : '–'} data-kpi="chalice"
        sub={chalice ? t(chalice.mean > 0.001 ? 'arc.kpi.pays' : 'arc.kpi.paysNot') : undefined} tip={chalice ? t('arc.adv.meanTip') : undefined} />
      <Kpi icon={Layers} label={t('arc.kpi.cards')} value={`${have.length} / ${a.slots.length}`} sub={t(a.m.state === 'cards' ? 'arc.kpi.fromPage' : 'arc.kpi.noCards')} data-kpi="cards" />
      <Kpi icon={Swords} label={t('arc.kpi.worth')} value={have.length ? sign(worth) : '–'} sub={t('arc.kpi.worthSub')} tip={t('arc.adv.worthTip')} data-kpi="worth" />
    </KpiRow>
    {best && <Panel title={t('arc.adv.title')} sub={t('arc.adv.sub')} data-arc-advice>
      <div className="px-2.5 pb-2 text-[12.5px]" data-arc-best>
        {rich(t('arc.adv.best', { d: best.dungeon, st: t('arc.adv.st', { n: best.stage }), g: sign(best.gain), n: every(best.p) }))}
        {chalice && <div className="mt-1" data-arc-chalice={chalice.mean > 0.001 ? 'yes' : 'no'}>
          {rich(t(chalice.mean > 0.001 ? 'arc.adv.chaliceYes' : 'arc.adv.chaliceNo', {
            picks: chalice.picks.map(i => enName(cls, a.m.names[i])).join(' + '), g: sign(chalice.mean), p: Math.round(chalice.p * 100), mats: chalice.mats, kinah: fmt(chalice.kinah),
          }))}
        </div>}
      </div>
    </Panel>}
    <Panel title={t('arc.adv.cards')} sub={t('arc.adv.cardsSub')} data-arc-cards>
      <div className={ROWS}>
        {a.slots.map(s => (
          <div key={s.kind} data-arc-slot={s.kind} className={cn(ROW, 'gap-1.5')}>
            <GameIcon name={cardArt(s.kind, s.card?.set?.name)} fallback={Layers} className={cn('size-6 rounded-[3px] border', s.card ? GRADE_BORDER[s.card.grade] : 'border-foreground/10 opacity-40 grayscale')}
              fallbackClass="size-4 text-dim" tip={s.card ? `${gradeName(s.card.grade)} ${s.card.name}` : undefined} />
            <span className="w-[74px] min-w-0 flex-[0_1_auto] truncate text-muted-foreground">{kindName(s.kind)}</span>
            {s.card ? <>
              <span className={cn('w-20 min-w-0 flex-[0_1_auto] truncate text-[11.5px]', GRADE_TEXT[s.card.grade])}>{gradeName(s.card.grade)} +{s.card.enchant}</span>
              <span className="min-w-0 flex-1 truncate text-[11.5px]" data-tip={s.card.set ? t(s.card.set.count === 1 ? 'arc.adv.set1' : 'arc.adv.set', { s: s.card.set.name, n: s.card.set.count }) : undefined}>
                {s.card.skills.map(x => `${enName(cls, x.name)} +${x.level}`).join(' · ')}
              </span>
            </> : <span className="min-w-0 flex-1 truncate text-dim">{t('arc.adv.empty')}</span>}
            <span className="w-16 flex-none text-right font-semibold whitespace-nowrap text-gold tabular-nums" data-tip={t('arc.adv.worthTip')}>{s.card ? sign(s.cur) : '—'}</span>
          </div>
        ))}
      </div>
    </Panel>
    <Panel title={t('arc.adv.farm')} sub={t('arc.adv.farmSub')} data-arc-farm>
      <div className={ROWS}>
        <TopN id="arc.farm" items={a.farm} n={4} more={k => t('arc.moreN', { n: k })} render={f => (
          <div key={f.dungeon + f.stage} data-farm={f.dungeon + ' ' + f.stage} className={cn(ROW, 'gap-1.5')}>
            <span className="min-w-0 flex-1 truncate">{f.dungeon} <span className="text-muted-foreground">{t('arc.stage', { n: f.stage })}</span></span>
            <span className="min-w-0 flex-[0_1_auto] truncate text-right text-[11.5px] text-muted-foreground tabular-nums" data-tip={t('arc.adv.pTip')}>{every(f.p)}</span>
            <span className="w-16 flex-none text-right font-semibold whitespace-nowrap text-gold tabular-nums" data-tip={t('arc.adv.gainTip')}>{sign(f.gain)}</span>
          </div>
        )} />
      </div>
    </Panel>
    <Panel title={t('arc.adv.tm')} sub={t('arc.adv.tmSub')} data-arc-tm>
      <div className={ROWS}>
        <TopN id="arc.tm" items={tmBest} n={4} more={k => t('arc.moreN', { n: k })} render={x => (
          // narrow: the cost goes into the row tooltip, the text columns truncate, the numbers stay whole
          <div key={x.kind + x.n} data-tm={x.kind + x.n} className={cn(ROW, 'gap-1.5')}
            data-tip={x.picks.map(i => enName(cls, a.m.names[i])).join(' + ') + '\n' + t('arc.adv.cost', { n: x.mats, k: fmt(x.kinah / 1e6) })}>
            <span className="w-[74px] min-w-0 flex-[0_1_auto] truncate text-muted-foreground">{kindName(x.kind)}</span>
            <span className="min-w-0 flex-1 truncate text-[11.5px]">{x.picks.map(i => enName(cls, a.m.names[i])).join(' + ')}</span>
            <span className="hidden flex-none text-right text-[11px] whitespace-nowrap text-dim tabular-nums @min-[420px]:inline">{t('arc.adv.cost', { n: x.mats, k: fmt(x.kinah / 1e6) })}</span>
            <span className="w-11 flex-none text-right text-[11.5px] whitespace-nowrap text-muted-foreground tabular-nums" data-tip={t('arc.adv.betterTip')}>{Math.round(x.p * 100)} %</span>
            <span className={cn('w-16 flex-none text-right font-semibold whitespace-nowrap tabular-nums', x.mean > 0 ? 'text-gold' : 'text-red')} data-tip={t('arc.adv.meanTip')}>{sign(x.mean)}</span>
          </div>
        )} />
      </div>
    </Panel>
  </>
}

export function ArcanaTab() {
  useApp()
  const char = charKey(), l = live(char), hasLive = !!l, hasCards = !!l?.gear?.arcana
  // again when the live data arrives (the page is read after the tab opened) or its cards are gone
  useEffect(() => refetchCards(char), [char, hasLive, hasCards])
  const d = arcData(), dae = daeData()
  if (d === null || dae === null) return <Empty>{t('arc.loading')}</Empty>
  if (!d || !dae) return <Empty>{t('arc.missing')}</Empty>
  const s = arcSettings(), cls = s.cls && dae.classes[s.cls] ? s.cls : classId()
  const all = arcSkills(d, cls), kind = s.kind as Kind | 'all', guide = !!s.guide
  const shown = all.filter(x => (kind === 'all' || kind === 'Chalice' || x.kind === kind) && (!guide || x.tier >= 2))
  const bar = <>
    <BarInfo><GameIcon name={classIcon(dae.classes[cls])} className={BAR_GAME_ICON} />{t('arc.info', { cls: className(dae.classes[cls]), n: all.length })}</BarInfo>
    <BarRight>
      <AppSelect value={cls} tip={t('arc.class')} className="h-6 text-xs"
        options={Object.entries(dae.classes).filter(([k]) => arcClass(d, k)).map(([k, x]) => ({ value: k, label: className(x), game: classIcon(x) }))} onChange={v => arcSave({ cls: v })} />
    </BarRight>
  </>
  // the filters only change the lists in the disclosure: they sit in its header and show while it is open. Six kinds:
  // a dropdown (more than 4 options)
  const kinds = (['all', ...KINDS] as const).map(k => ({ value: k, label: k === 'all' ? t('arc.allCards') : kindName(k) }))
  const filters = U.open?.['arc.all'] && <span className="ml-auto flex max-w-full min-w-0 flex-wrap items-center justify-end gap-1">
    <span data-kind-select><AppSelect value={kind} tip={t('arc.kindTip')} className="h-6 text-xs" options={kinds} onChange={k => arcSave({ kind: k as Kind | 'all' })} item={k => ({ 'data-kind-filter': k })} /></span>
    <Chip on={guide} onChange={v => arcSave({ guide: v })} tip={t('arc.guideTip')} className="h-6" data-guide-filter="">{t('arc.guide')}</Chip>
  </span>
  return (
    <Page w="rows" bar={bar}>
      <Advice d={d} cls={cls} />
      <Panel>
      <Disclosure id="arc.all" title={t('arc.sect.all')} sub={t('arc.allSub')} right={filters}>
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
      </Disclosure>
      </Panel>
      <Panel className="pb-1.5"><HowTo id="arc.how" title={t('arc.how')}>{t('arc.hint')}</HowTo></Panel>
      <Foot>{t('arc.foot', { date: d.date })}</Foot>
    </Page>
  )
}
