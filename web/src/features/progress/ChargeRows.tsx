// Charge tiles (Odyle energy, Nightmare attempts, …) and the traffic-light warning list.
import { ChevronRight, Crown, Key, KeyRound, Moon, TriangleAlert, Zap, type LucideIcon } from 'lucide-react'
import { U, V, saveUi, bump } from '@/core/state'
import { t } from '@/core/i18n'
import { Slider } from '@/components/ui/slider'
import { ACCENT, AutoBadge, Bar, Chip, ROW, ROW_CLICK, Sect, StepCol, T_BODY, T_FOOT, T_META, T_SUB, T_TITLE, TILE, TILE_P, TONE, TileIcon, grid, type BoxTone } from '@/components/kit'
import { cn } from '@/lib/utils'
import { resetIn, type Per } from './checklist'
import { chargeAuto, chargeBonus, chargeFullIn, chargeLight, chargeNow, chargeReadAt, chargesOf, setChargeByHand, stepCharge, type ChargeDef, type Light } from './charges'
import { alertKey, type Alert } from './alerts'

export const LIGHT_DOT: Record<Light | 'red' | 'yellow', string> = {
  red: 'bg-red shadow-[0_0_6px_var(--red)]', yellow: 'bg-gold', green: 'bg-green', none: 'bg-dim',
}
export const CHARGE_ICON: Record<string, LucideIcon> = { odyle: Zap, nightmare: Moon, shugo: KeyRound, invasion: Key }
/** Game icon per charge (public/icons); the lucide icon is the fallback. */
export const CHARGE_GAME: Record<string, string> = { odyle: 'odyle', nightmare: 'nightmare', shugo: 'shugo', invasion: 'invasion' }
const LIGHT_TONE: Record<Light, BoxTone> = { red: 'red', yellow: 'gold', green: 'green', none: 'dim' }
const LIGHT_TXT: Record<Light, string> = { red: TONE.bad, yellow: TONE.warn, green: 'text-muted-foreground', none: 'text-muted-foreground' }

/** Charge tile: icon in the traffic-light colour, status, fill bar (Odyle: slider), value, −/+ column. */
function ChargeTile({ d, char }: { d: ChargeDef; char?: string }) {
  const v = chargeNow(d, char), cap = d.cap(), light = chargeLight(d, char), ms = chargeFullIn(d, char), bonus = chargeBonus(d, char)
  const status = v == null ? t('charge.enter') : ms === 0 ? t('alert.full') : t('alert.fullIn', { d: resetIn(new Date(Date.now() + ms!)) })
  const regen = d.every === 'day' ? t('charge.perDay', { n: d.regen }) : t('charge.perH', { n: d.regen, h: d.every / 3600e3 })
  // an old reading is projected forward: say how old, the value is an estimate (the game sends it only at login /
  // when the window opens, so a character that was not played since is not known exactly)
  const at = chargeReadAt(d, char), age = at == null ? 0 : Date.now() - at, old = age > 12 * 3600e3
  return (
    <div data-charge={d.id} data-tip={t('charge.tip.' + d.id)} className={cn(TILE, TILE_P, 'pr-0', ACCENT[light])}>
      <TileIcon icon={CHARGE_ICON[d.id]} game={CHARGE_GAME[d.id]} tone={LIGHT_TONE[light]} tip={light === 'red' || light === 'yellow' ? t('alert.' + light) : undefined} />
      <div className={T_BODY}>
        <div className="flex min-w-0 items-center gap-1.5"><span className={T_TITLE}>{t('charge.' + d.id)}</span>{chargeAuto(d, char) && <AutoBadge tip={t('charge.autoTip')} />}</div>
        <div className={cn(T_SUB, LIGHT_TXT[light])}>
          {status}
          {!!bonus && <span className="text-cyan" data-tip={t('charge.bonusTip')}> · +{bonus} {t('charge.bonus')}</span>}
          {old && <span className="text-dim" data-tip={t('charge.oldTip')} data-old> · {t('charge.old', { t: resetIn(new Date(Date.now() + age)) })}</span>}
        </div>
        <div className={T_FOOT}>
          {/* Odyle has large values: a slider sets it in one move (keyboard input needs focus, the overlay never takes it). */}
          {d.step > 1
            ? <Slider className="my-[3px]" min={0} max={cap} step={5} value={[v ?? 0]} onValueChange={x => setChargeByHand(d, Array.isArray(x) ? x[0] : x, char)} />
            : <Bar frac={(v ?? 0) / cap} tone={light === 'red' ? 'red' : light === 'yellow' ? 'gold' : 'cyan'} />}
          <div className={T_META}>
            <span className="font-semibold text-foreground">{v ?? '–'}/{cap}</span>
            <span className="truncate text-dim">{regen}</span>
          </div>
        </div>
      </div>
      <StepCol onStep={dir => stepCharge(d, dir, char)} minus={(v ?? 0) > 0} plus={v == null || v < cap} tips={[`−${d.step}`, `+${d.step}`]} />
    </div>
  )
}

/** "Vorräte" section of an owner, with the membership switch on the server section (caps depend on it). */
export function Charges({ per, char }: { per: Per; char?: string }) {
  const list = chargesOf(per)
  if (!list.length) return null
  return <div>
    <Sect sub={t('charge.sub')} right={per === 'server' &&
      <Chip on={!!U.member} onChange={on => { U.member = on; saveUi(['member']); bump() }} tip={t('charge.memberTip')} className="h-6 px-2 text-[11.5px]" data-member={U.member ? 'on' : 'off'}>
        <Crown />{t('charge.member')}
      </Chip>}>{t('charge.title')}</Sect>
    <div className={grid('row')}>{list.map(d => <ChargeTile key={d.id} d={d} char={char} />)}</div>
  </div>
}

/** One warning; clicking it opens the character's checklist page. `flat` = a row inside a panel instead of a card. */
export function AlertRow({ a, showChar = true, flat, onOpen }: { a: Alert; showChar?: boolean; flat?: boolean; onOpen?: (char: string | null) => void }) {
  return (
    <button onClick={() => { V.chkPage = a.char ?? null; onOpen?.(a.char); bump() }} data-tip={`${a.char ?? t('chk.server')}: ${a.text}
${t('alert.' + a.level)}`} data-alert={a.level}
      className={cn('group w-full text-left',
        flat ? cn(ROW, ROW_CLICK, a.level === 'red' && 'bg-red/[0.06]')
          : cn('flex min-h-9 min-w-0 items-center gap-2 rounded-lg border bg-card px-2.5 py-1 text-[12.5px] transition-colors hover:bg-foreground/5', ACCENT[a.level]))}>
      <TriangleAlert className={cn('size-3.5 flex-none', a.level === 'red' ? TONE.bad : TONE.warn)} />
      {/* the open items come first and may take two lines (360 px); the owner is the sub line */}
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 whitespace-normal [overflow-wrap:anywhere]">{a.text}</span>
        {showChar && <span className="block truncate text-[11.5px] text-muted-foreground">{a.char ?? t('chk.server')}</span>}
      </span>
      <ChevronRight className="size-3.5 flex-none text-dim transition-colors group-hover:text-gold" />
    </button>
  )
}

/** Warning cards (checklist pages). */
export function AlertList({ alerts, showChar = true, onOpen }: { alerts: Alert[]; showChar?: boolean; onOpen?: (char: string | null) => void }) {
  if (!alerts.length) return null
  return <div className="flex flex-col gap-1.5 px-2.5">{alerts.map(a => <AlertRow key={alertKey(a)} a={a} showChar={showChar} onOpen={onOpen} />)}</div>
}
