import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { G, U, V, useApp, type Any } from '@/core/state'
import { zoneOfSpawn, petName } from '@/core/data'
import { relHeight } from '@/core/geo'
import { t } from '@/core/i18n'
import { cn } from '@/lib/utils'
import {
  attachCanvas, sizeCanvas, cubeDone, onTip, view, type Tip,
  pointerDown, pointerMove, pointerUp, pointerLeave, wheel, dblClick, zoomIn, zoomOut,
} from './engine'

// Small translucent pill over the map. The map section has the `dark` class (App.tsx), so these tokens are the dark set.
const pill = 'h-6 rounded-lg border border-border bg-popover/80 text-[11.5px] whitespace-nowrap text-muted-foreground shadow-(--shadow-card) backdrop-blur-sm transition-colors hover:text-foreground [&_svg]:size-3.5 [&_svg]:flex-none'
/** `pill` + `ICON_PILL`: icon-only buttons (aria-label = tooltip). */
const ICON_PILL = 'grid w-6 place-items-center'
/** Floating box over the map (tooltip). */
const HUD = 'rounded-lg border border-border bg-popover/90 px-2 py-1.5 text-[11.5px] shadow-(--shadow-card)'

function TipBox({ tip }: { tip: NonNullable<Tip> }) {
  const ref = useRef<HTMLDivElement>(null)
  // Position after measuring: right of the cursor, flipped above near the bottom edge.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.left = Math.min(view.w - r.width - 4, tip.x + 12) + 'px'
    el.style.top = (tip.y + 14 + r.height > view.h ? tip.y - r.height - 8 : tip.y + 14) + 'px'
  })
  const it = tip.it, m = G.md[U.map]
  let body
  if (it.farm) body = <><b className="font-semibold text-gold">{t('map.tipFarm')} #{it.farm.rank} {it.farm.name}</b><br /><span className="text-muted-foreground">{t('farm.spot.route', { n: it.farm.route.length, len: Math.round(it.farm.len), min: Math.max(1, Math.round(it.farm.secs / 60)) })}</span></>
  else if (it.spot) body = <><b className="font-semibold text-gold">#{it.spot.rank} {it.spot.name}</b><br /><span className="text-muted-foreground">{it.spot.pets.map((p: Any) => petName(p.t.p) + ' ' + p.n + '×').join(', ')}</span></>
  else if (it.cube) body = <><b className="font-semibold text-gold">{t('map.tipCube')}</b> {it.cube.name}<br /><span className="text-muted-foreground">{cubeDone(m).has(it.cube.key) ? t('map.tipFound') : t('map.tipOneOf', { n: it.cube.pts.length })}{relHeight(it.h) && <> · <b className="text-foreground">{relHeight(it.h)}</b></>}</span></>
  else body = <>
    <b className="font-semibold text-gold">{it.mob.n}</b> <span className="text-muted-foreground">Lv {it.mob.lv}{it.mob.named ? ' · ' + t('map.named') : it.mob.r !== 'Normal' ? ' · ' + it.mob.r : ''}</span><br />
    → {petName(it.t.p)} <span className="text-muted-foreground">{it.t.done ? 'Lv 3' : `${it.t.souls}/${it.t.need}`} · {zoneOfSpawn(m, it.i)}</span>
  </>
  return <div ref={ref} className={cn(HUD, 'pointer-events-none absolute z-[5] max-w-60 bg-popover/95')}>{body}</div>
}

export function MapView() {
  useApp()
  const wrap = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null)
  const [tip, setTip] = useState<Tip>(null)

  useEffect(() => {
    const cv = canvas.current!
    attachCanvas(cv)
    onTip(setTip)
    const ro = new ResizeObserver(() => sizeCanvas())
    ro.observe(wrap.current!)
    const opts = { passive: false } as const
    cv.addEventListener('pointerdown', pointerDown)
    cv.addEventListener('pointermove', pointerMove)
    cv.addEventListener('pointerup', pointerUp)
    cv.addEventListener('pointerleave', pointerLeave)
    cv.addEventListener('wheel', wheel, opts)
    cv.addEventListener('dblclick', dblClick)
    return () => {
      ro.disconnect()
      cv.removeEventListener('pointerdown', pointerDown)
      cv.removeEventListener('pointermove', pointerMove)
      cv.removeEventListener('pointerup', pointerUp)
      cv.removeEventListener('pointerleave', pointerLeave)
      cv.removeEventListener('wheel', wheel)
      cv.removeEventListener('dblclick', dblClick)
      onTip(() => {})
      attachCanvas(null)
    }
  }, [])

  // allowed exception: the backdrop behind the map art (sea colour of the map images), the same in both themes
  return (
    <div ref={wrap} className="absolute inset-0 min-h-[120px] overflow-hidden bg-[#1a3248]">
      <canvas ref={canvas} className="absolute inset-0 block size-full cursor-grab" />
      {V.mapMsg && <div className="pointer-events-none absolute inset-0 grid place-items-center p-5 text-center text-[15px] leading-relaxed font-semibold whitespace-pre-line text-gold [text-shadow:0_1px_4px_var(--background)]">{V.mapMsg}</div>}
      <div className="absolute top-1.5 right-1.5 flex flex-col gap-1">
        <button onClick={zoomIn} data-tip={t('map.zoomIn')} aria-label={t('map.zoomIn')} className={cn(pill, ICON_PILL)}><Plus /></button>
        <button onClick={zoomOut} data-tip={t('map.zoomOut')} aria-label={t('map.zoomOut')} className={cn(pill, ICON_PILL)}><Minus /></button>
      </div>
      {tip && <TipBox tip={tip} />}
    </div>
  )
}
