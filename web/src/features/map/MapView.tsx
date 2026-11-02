import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Radar, Minus, Plus, Scan, CircleDot, Lock, LockOpen, LocateFixed } from 'lucide-react'
import { G, S, U, V, manual, useApp, type Any } from '@/core/state'
import { mapName, zoneOfSpawn, petName } from '@/core/data'
import { posAge, ago, fmtDist, relHeight } from '@/core/geo'
import { hkText } from '@/core/session'
import { t } from '@/core/i18n'
import { cn } from '@/lib/utils'
import {
  attachCanvas, sizeCanvas, fit, setRadar, onMap, cubeDone, onTip, view, type Tip,
  pointerDown, pointerMove, pointerUp, pointerLeave, wheel, dblClick, zoomIn, zoomOut,
} from './engine'
import { radarCfg, toggleMiniRadar, toggleRadarLock, centerRadar } from './miniRadar'

// Small translucent pill over the map (#11141ccc, thin border).
const pill = 'rounded-sm border border-white/10 bg-[#11141ccc] text-[11px] text-muted-foreground backdrop-blur-sm transition-colors hover:text-white'

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
    → {petName(it.t.p)} <span className="text-muted-foreground">{it.t.done ? 'Lv3' : `${it.t.souls}/${it.t.need}`} · {zoneOfSpawn(m, it.i)}</span>
  </>
  return <div ref={ref} className="pointer-events-none absolute z-[5] max-w-60 rounded-sm border border-[#3a4560] bg-[#0d1017ee] px-2 py-1.5 text-[11.5px] shadow-[0_4px_14px_#0008]">{body}</div>
}

function HudLine({ lbl, o, children }: { lbl: string; o: Any; children: React.ReactNode }) {
  if (!o) return null
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="w-8 flex-none text-[10.5px] tracking-wide text-dim uppercase">{lbl}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <b className="font-semibold text-cyan tabular-nums">{fmtDist(o.dist)} {o.dir}</b>
    </div>
  )
}

function RadarHud() {
  const m = G.md[U.map], p = S.pos
  if (!U.radar) return null
  const box = 'pointer-events-none absolute right-10 bottom-1.5 left-1.5 rounded-sm border border-white/10 bg-[#0d1017e0] px-2 py-1.5 text-[11.5px]'
  if (!p) return <div className={box}><div className="leading-relaxed text-gold">{t('map.noPos')}</div></div>
  if (m && !onMap(m, p)) {
    const [a, b] = t('map.offMap').split('{map}')
    return <div className={box}><div className="leading-relaxed text-gold">{a}<b>{mapName(m.name)}</b>{b}</div></div>
  }
  if (!U.radarHud) return null
  const n = V.near || {}, old = posAge() > 120
  return (
    <div className={box}>
      <HudLine lbl={t('map.hudMob')} o={n.mob}>{n.mob && <>{n.mob.mob.n} <i className="text-muted-foreground not-italic">→ {petName(n.mob.t.p)} {n.mob.t.souls}/{n.mob.t.need}</i></>}</HudLine>
      <HudLine lbl={t('map.hudSpot')} o={n.spot}>{n.spot && `#${n.spot.s.rank} ${n.spot.s.name}`}</HudLine>
      {U.layers.cubes && <HudLine lbl={t('map.hudCube')} o={n.cube}>{n.cube?.c.name}</HudLine>}
      <div className={cn('mt-0.5 text-[10.5px] text-dim', old && 'text-gold')}>{t('map.posAgo', { ago: ago(posAge()) })}{old && t('map.posOld')}</div>
    </div>
  )
}

// Mini radar window (RadarForm): on/off, and while on: unlock to move/resize, centre on the character.
function MiniRadarCtl() {
  const r = radarCfg(), hk = hkText('radarLock')
  return <>
    <button data-mini-radar={r.on ? 'on' : 'off'} onClick={toggleMiniRadar} data-tip={t('map.miniTip')}
      className={cn(pill, 'flex items-center gap-1 px-2 py-0.5', r.on && 'border-cyan/55 bg-[#0d2a30cc] text-cyan')}>
      <CircleDot className="size-3" /><span className="max-[360px]:hidden">{t('map.mini')}</span>
    </button>
    {r.on && <>
      <button data-mini-lock={r.locked ? 'locked' : 'unlocked'} onClick={toggleRadarLock}
        data-tip={(r.locked ? t('map.miniUnlock') : t('map.miniLock')) + (hk ? ` (${hk})` : '')}
        className={cn(pill, 'grid size-[22px] place-items-center', !r.locked && 'border-gold/55 text-gold')}>
        {r.locked ? <Lock className="size-3" /> : <LockOpen className="size-3" />}
      </button>
      <button data-mini-center onClick={centerRadar} data-tip={t('map.miniCenter')} className={cn(pill, 'grid size-[22px] place-items-center')}>
        <LocateFixed className="size-3" />
      </button>
    </>}
  </>
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

  const hk = hkText('radar'), radarTitle = hk ? `${t('map.radarTip')} (${hk})` : t('map.radarTip')
  return (
    <div ref={wrap} className="absolute inset-0 min-h-[120px] overflow-hidden bg-[#1a3248]">
      <canvas ref={canvas} className="absolute inset-0 block size-full cursor-grab" />
      {V.mapMsg && <div className="pointer-events-none absolute inset-0 grid place-items-center p-5 text-center text-[15px] leading-relaxed font-semibold whitespace-pre-line text-gold [text-shadow:0_1px_4px_#000]">{V.mapMsg}</div>}
      <div className="absolute top-1.5 left-1.5 flex gap-1">
        {manual()
          ? <span data-radar-off data-tip={t('map.radarManual')} className={cn(pill, 'flex items-center gap-1 px-2 py-0.5 text-dim hover:text-dim')}>
            <Radar className="size-3" /><s>{t('map.radar')}</s><span className="max-[420px]:hidden">· {t('map.manual')}</span>
          </span>
          : <button onClick={() => setRadar(!U.radar)} data-tip={radarTitle}
            className={cn(pill, 'flex items-center gap-1 px-2 py-0.5', U.radar && 'border-cyan/55 bg-[#0d2a30cc] text-cyan')}>
            <Radar className="size-3" />{t('map.radar')}
          </button>}
        {!manual() && <MiniRadarCtl />}
      </div>
      <RadarHud />
      <div className="absolute top-1.5 right-1.5 flex flex-col gap-1">
        <button onClick={zoomIn} data-tip={t('map.zoomIn')} className={cn(pill, 'grid size-6 place-items-center')}><Plus className="size-3.5" /></button>
        <button onClick={zoomOut} data-tip={t('map.zoomOut')} className={cn(pill, 'grid size-6 place-items-center')}><Minus className="size-3.5" /></button>
        {U.radar && <button onClick={() => fit()} data-tip={t('map.center')} className={cn(pill, 'grid size-6 place-items-center')}><Scan className="size-3.5" /></button>}
      </div>
      {tip && <TipBox tip={tip} />}
    </div>
  )
}
