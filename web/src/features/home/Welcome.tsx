// First start: welcome card with the two tracking modes. Later starts without Npcap: a one-time notice that the
// app runs manually (instead of an error status).
import { Hand, Radio, X, type LucideIcon } from 'lucide-react'
import { S, U, saveUi, bump, useApp } from '@/core/state'
import { t } from '@/core/i18n'
import { Button } from '@/components/ui/button'
import { NpcapLink, SUB, TITLE, rich } from '@/components/kit'
import { setMode } from '@/core/session'
import { cn } from '@/lib/utils'

function done(mode: 'auto' | 'manual') {
  U.welcomed = 1; U.npcapHint = 1
  saveUi(['welcomed', 'npcapHint'])
  setMode(mode)
}

function Choice({ mode, icon: I, title, text, status, disabled }: {
  mode: 'auto' | 'manual'; icon: LucideIcon; title: string; text: string; status?: React.ReactNode; disabled?: boolean
}) {
  const cur = (S.settings.mode === 'manual' || S.settings.npcap === false ? 'manual' : 'auto') === mode
  return (
    <div data-mode={mode} className={cn('flex flex-col gap-1.5 rounded-sm border bg-card p-2.5', cur && 'border-gold/50')}>
      <div className="flex items-center gap-2">
        <span className={cn('grid size-8 flex-none place-items-center rounded-sm border', mode === 'auto' ? 'border-green/30 bg-green/10 text-green' : 'border-cyan/25 bg-cyan/10 text-cyan')}><I className="size-4.5" /></span>
        <b className={cn(TITLE, 'text-[13px]')}>{title}</b>
      </div>
      <p className={cn(SUB, 'leading-snug')}>{text}</p>
      {status && <p className="text-[11.5px] leading-snug">{status}</p>}
      <Button size="sm" variant={cur ? 'default' : 'outline'} className="mt-auto self-start" disabled={disabled} onClick={() => done(mode)}>
        {t('welcome.pick')}
      </Button>
    </div>
  )
}

export function Welcome() {
  useApp()
  if (!S.settings || S.replay || U.welcomed) return null
  const npcap = S.settings.npcap !== false
  return (
    <div data-welcome className="@container absolute inset-x-0 top-10 bottom-0 z-40 overflow-y-auto bg-background/95 p-3 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[640px] flex-col gap-2.5">
        <div>
          <h1 className="text-[15px] font-semibold tracking-wide text-gold">{t('welcome.title')}</h1>
          <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">{t('welcome.intro')}</p>
        </div>
        <div className="grid gap-2 @min-[520px]:grid-cols-2">
          <Choice mode="auto" icon={Radio} title={t('welcome.auto')} text={t('welcome.auto.text')} disabled={!npcap}
            status={npcap ? <span className="text-green">{t('welcome.auto.ok')}</span> : <span className="text-gold">{rich(t('welcome.auto.missing'), { link: <NpcapLink /> })}</span>} />
          <Choice mode="manual" icon={Hand} title={t('welcome.manual')} text={t('welcome.manual.text')} />
        </div>
        <p className="text-[11.5px] text-dim">{t('welcome.later')}</p>
      </div>
    </div>
  )
}

/** Npcap missing although the automatic mode is set (e.g. after an update): say once that the app runs manually. */
export function NpcapNotice() {
  useApp()
  const st = S.settings
  if (!st || S.replay || !U.welcomed || U.npcapHint || st.npcap !== false || st.mode === 'manual') return null
  const ok = () => { U.npcapHint = 1; saveUi(['npcapHint']); bump() }
  return (
    <div data-npcap-notice className="flex flex-none items-start gap-2 border-b border-cyan/25 bg-cyan/[0.06] px-2.5 py-1.5 text-[12px] leading-snug text-muted-foreground">
      <span className="min-w-0 flex-1">{rich(t('npcap.notice'), { link: <NpcapLink /> })}</span>
      <Button size="xs" variant="outline" onClick={ok}>{t('npcap.ok')}</Button>
      <button className="grid size-5 flex-none place-items-center text-dim hover:text-foreground" data-tip={t('common.close')} onClick={ok}><X className="size-3.5" /></button>
    </div>
  )
}
