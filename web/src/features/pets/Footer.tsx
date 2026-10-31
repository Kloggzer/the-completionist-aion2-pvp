// Footer: how fresh the pet progress is (login snapshot + last live soul). Doubles as a window drag zone.
import { useEffect, useState } from 'react'
import { S, hasState, manual, useApp } from '@/core/state'
import { locale, t } from '@/core/i18n'
import { cn } from '@/lib/utils'

const agoTxt = (ms: number) => {
  const m = Math.round(ms / 60000)
  if (m < 1) return t('pets.age.now')
  if (m < 60) return t('pets.age.min', { n: m })
  if (m < 48 * 60) return t('pets.age.h', { n: Math.round(m / 60) })
  const d = Math.round(m / 1440)
  return t(d === 1 ? 'pets.age.d.one' : 'pets.age.d.other', { n: d })
}

function age() {
  const st = S.state
  if (manual()) {
    const u = st.updatedAt ? new Date(st.updatedAt).getTime() : 0
    return { text: u ? t('pets.age.manual', { ago: agoTxt(Date.now() - u) }) : t('pets.age.manualNone'), stale: false, tip: t('pets.age.manualTip') }
  }
  if (!hasState()) return { text: t(S.status.state === 'live' || S.replay ? 'pets.age.reading' : 'pets.age.off'), stale: true, tip: '' }
  const at = new Date(st.syncedAt).getTime(), u = new Date(st.updatedAt || st.syncedAt).getTime(), now = Date.now()
  const live = S.status.state === 'live' || S.status.state === 'replay'
  const when = new Date(at).toLocaleString(locale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  return {
    text: t('pets.age.login', { at: when, ago: agoTxt(now - at) }) + (u - at > 1000 ? t('pets.age.lastSoul', { ago: agoTxt(now - u) }) : ''),
    stale: !live && now - u > 6 * 3600e3,
    tip: t(live ? 'pets.age.liveTip' : 'pets.age.staleTip'),
  }
}

export function Footer() {
  useApp()
  const [, tick] = useState(0)
  useEffect(() => { const id = setInterval(() => tick(n => n + 1), 30000); return () => clearInterval(id) }, [])
  const a = age()
  return (
    <footer className="flex flex-none items-center justify-between gap-2 border-t bg-card py-1 pr-5 pl-2 text-[11px] text-dim">
      <span data-drag data-tip={a.tip || undefined} className={cn('min-w-0 flex-1 cursor-grab truncate', a.stale && 'text-gold')}>{a.text}</span>
    </footer>
  )
}
