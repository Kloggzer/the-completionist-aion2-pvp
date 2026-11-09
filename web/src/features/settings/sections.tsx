// Contents of the settings categories.
import { useEffect, useReducer } from 'react'
import { Box, Monitor, Moon, Star, Sun } from 'lucide-react'
import { DEF_UI, G, S, U, V, saveUi, bump, type Any } from '@/core/state'
import { host, onHost } from '@/core/host'
import { emit } from '@/core/bus'
import { t, osLang } from '@/core/i18n'
import { HK_IDS, hkText, keyText, modText, setMode, syncLang } from '@/core/session'
import { TTS_KINDS, say, voices } from '@/core/tts'
import { AppSelect } from '@/components/AppSelect'
import { loadMapArt } from '@/core/data'
import { ext } from '@/core/ext'
import { Button } from '@/components/ui/button'
import { Fine, Group, Row, Toggle, Stepper } from './parts'
import { NpcapLink, SUB, Seg, rich } from '@/components/kit'
import { applyTheme } from '@/core/theme'
import { pvpCfg, setPvpCfg, togglePvp, toggleWinEdit } from '@/features/pvp'
import { cn } from '@/lib/utils'
import { BossRecRow, BossRoleRow } from '@/features/bossmod/SettingsRow'
import { BLAME } from '@/features/bossmod'

const pct = (v: number) => Math.round(v * 100) + ' %'

/** Generic stepper rule: snap to step, clamp, 2 decimals. */
function stepVal(cur: number, d: number, step: number, min: number, max: number) {
  const v = Math.round((cur + step * d) / step) * step
  return Math.min(max, Math.max(min, Math.round(v * 100) / 100))
}

const close = () => { V.settingsOpen = false; bump() }
// autoMap/soundCube/soundTimer default to on (undefined = on).
const DEF_ON = ['autoMap', 'soundCube', 'soundTimer', 'startChime', 'bossRec', 'bossBars', 'bossBlame', 'bossCount', 'bossTargetMe']
const isOn = (k: string) => (DEF_ON.includes(k) ? U[k] !== false : !!U[k])
function flip(k: string) {
  U[k] = DEF_ON.includes(k) ? U[k] === false : !U[k]
  saveUi([k]); emit('recompute'); bump()
}
const UToggle = ({ k, sub }: { k: string; sub?: React.ReactNode }) =>
  <Toggle label={t('set.' + k)} sub={sub ?? (t('set.' + k + '.sub') !== 'set.' + k + '.sub' ? t('set.' + k + '.sub') : undefined)} on={isOn(k)} onChange={() => flip(k)} />

// ---------------------------------------------------------------- general

export function General() {
  const st = S.settings
  const langs = [
    { value: 'auto', label: t('set.lang.auto', { lang: t('set.lang.' + osLang()) }) },
    { value: 'de', label: t('set.lang.de') }, { value: 'en', label: t('set.lang.en') },
  ]
  const setOpacity = (d: number) => { const v = stepVal(st.opacity, d, 0.05, 0.3, 1); st.opacity = v; host({ type: 'opacity', v }); bump() }
  const setZoom = (d: number) => { const v = stepVal(st.zoom, d, 0.05, 0.7, 1.6); st.zoom = v; host({ type: 'zoom', v }); bump() }
  return <>
    <Group title={t('set.g.display')}>
      <Row label={t('set.lang')}>
        <AppSelect value={U.lang === 'de' || U.lang === 'en' ? U.lang : 'auto'} options={langs} className="w-52 max-w-full"
          onChange={v => { U.lang = v; saveUi(['lang']); syncLang(); bump() }} />
      </Row>
      <Row label={t('set.theme')} sub={t('set.theme.sub')}>
        <Seg value={U.theme || 'system'} onChange={v => { U.theme = v; saveUi(['theme']); applyTheme(); bump() }} item={v => ({ 'data-theme': v })}
          options={[{ value: 'light', label: t('set.theme.light'), icon: Sun }, { value: 'dark', label: t('set.theme.dark'), icon: Moon }, { value: 'system', label: t('set.theme.system'), icon: Monitor }]} />
      </Row>
      <Stepper label={t('set.opacity')} sub={t('set.opacity.sub')} value={pct(st.opacity)} onStep={setOpacity} minus={st.opacity > 0.3} plus={st.opacity < 1} />
      <Stepper label={t('set.zoom')} value={pct(st.zoom)} onStep={setZoom} minus={st.zoom > 0.7} plus={st.zoom < 1.6} />
      <UToggle k="toasts" />
    </Group>
    <Group title={t('set.g.window')}>
      <Row label={t('set.windowMode')} sub={t('set.windowMode.sub')}>
        <AppSelect value={S.settings.dock || 'auto'} onChange={v => { S.settings.dock = v; host({ type: 'dock', dock: v }); bump() }}
          options={['auto', 'overlay', 'window'].map(v => ({ value: v, label: t('dock.opt.' + v) }))} className="w-44" />
      </Row>
      <Row label={t('set.click')} sub={t('set.click.sub', { key: hkText('click') })}>
        <Button size="sm" variant="outline" onClick={() => { close(); host({ type: 'clickThrough' }) }}>{t('set.click.btn')}</Button>
      </Row>
      <Row label={t('set.site')} sub={hkText('site') || undefined}>
        <Button size="sm" variant="outline" onClick={() => { close(); host({ type: 'site', on: true, map: U.map }) }}>{t('set.site.btn')}</Button>
      </Row>
    </Group>
    <Group title={t('set.g.app')}>
      <Row label={t('set.quit')}>
        <Button size="sm" variant="destructive" onClick={() => host({ type: 'quit' })}>{t('set.quit.btn')}</Button>
      </Row>
    </Group>
  </>
}

// ---------------------------------------------------------------- map

export function MapSettings() {
  // The cube layer explains its two symbols (tokens close to the fixed map colours in engine.ts).
  const cubeSub = <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
    {ext.features.has('liveCubes') && <span className="inline-flex items-center gap-1"><Star className="size-3.5 fill-cube text-cube" />{t('set.l.cubes.real')}</span>}
    <span className="inline-flex items-center gap-1"><Box className="size-3.5 text-purple" />{t('set.l.cubes.spot')}</span>
  </span>
  const layer = (l: string) =>
    <Toggle key={l} label={t('set.l.' + l)} sub={l === 'cubes' ? cubeSub : undefined} on={!!U.layers[l]} onChange={() => { U.layers[l] = !U.layers[l]; saveUi(['layers']); emit('draw'); bump() }} />
  return <>
    <Group title={t('set.g.layers')}>
      <Row label={t('set.mapStyle')} sub={t('set.mapStyle.sub')}>
        <AppSelect value={U.mapStyle === 'relief' ? 'relief' : 'map'} options={['map', 'relief'].map(k => ({ value: k, label: t('set.mapStyle.' + k) }))} className="w-32"
          onChange={v => { U.mapStyle = v; saveUi(['mapStyle']); loadMapArt(U.map); emit('draw'); bump() }} />
      </Row>
      {['spawns', 'spots', 'cubes', 'labels'].map(layer)}
      <UToggle k="autoMap" />
    </Group>
    <PvpOverlay />
  </>
}

/** Edit mode of the small overlay windows (PvP list, event announcer, alert banner). */
function WinEdit() {
  const c = pvpCfg(), hk = hkText('winEdit')
  return (
    <Row label={t('set.winEdit')} sub={t('set.winEdit.sub') + (hk ? ` · ${hk}` : '')}>
      <Button size="sm" variant="outline" data-win-edit={c.locked ? 'locked' : 'edit'} onClick={toggleWinEdit}>{t(c.locked ? 'set.winEdit.unlock' : 'set.winEdit.lock')}</Button>
    </Row>
  )
}

function PvpOverlay() {
  const c = pvpCfg(), team = c.team ?? true
  return (
    <Group title={t('set.g.pvp')}>
      <Toggle label={t('set.pvp')} sub={t('set.pvp.sub') + (hkText('pvp') ? ` · ${hkText('pvp')}` : '')} on={!!c.on} onChange={togglePvp} />
      <Toggle label={t('set.feed')} sub={t('set.feed.sub')} on={c.feed !== false} onChange={() => setPvpCfg({ feed: c.feed === false })} />
      <Toggle label={t('set.pvpAuto')} sub={t('set.pvpAuto.sub')} on={!!c.auto} onChange={() => setPvpCfg({ auto: !c.auto })} />
      <Toggle label={t('set.pvpAll')} sub={t('set.pvpAll.sub')} on={!!c.all} onChange={() => setPvpCfg({ all: !c.all })} />
      <Row label={t('set.pvpFaction')} sub={t('set.pvpFaction.sub')}>
        <AppSelect value={String(c.faction ?? 0)} options={['0', '1', '2'].map(k => ({ value: k, label: t('set.pvpFaction.' + k) }))} className="w-40"
          onChange={v => setPvpCfg({ faction: Number(v) })} />
      </Row>
      <Toggle label={t('set.pvpAlarm')} sub={t('set.pvpAlarm.sub')} on={c.alarm !== false} onChange={() => setPvpCfg({ alarm: c.alarm === false })} />
      <Toggle label={t('set.pvpTeam')} sub={t('set.pvpTeam.sub')} on={team} onChange={() => setPvpCfg({ team: !team })} />
      <WinEdit />
      <Fine id="set.pvp.fine" sub={t('set.pvp.fineSub')}>
        <Toggle label={t('set.pvpCompact')} sub={t('set.pvpCompact.sub')} on={!!c.compact} onChange={() => setPvpCfg({ compact: !c.compact })} />
        <Stepper label={t('set.pvpLimit')} sub={t('set.pvpLimit.sub')} value={String(c.limit)} minus={c.limit > 1} plus={c.limit < 30}
          onStep={d => setPvpCfg({ limit: Math.max(1, Math.min(30, c.limit + d)) })} />
        {team && <Toggle label={t('set.pvpSelf')} sub={t('set.pvpSelf.sub')} on={!!c.self} onChange={() => setPvpCfg({ self: !c.self })} />}
        {team && <Stepper label={t('set.pvpTeamLimit')} sub={t('set.pvpTeamLimit.sub')} value={String(c.teamLimit ?? 6)}
          minus={(c.teamLimit ?? 6) > 1} plus={(c.teamLimit ?? 6) < 30}
          onStep={d => setPvpCfg({ teamLimit: Math.max(1, Math.min(30, (c.teamLimit ?? 6) + d)) })} />}
        {!!c.auto && <Row label={t('set.pvpIdle')} sub={t('set.pvpIdle.sub')}>
          <AppSelect value={c.idle || 'bar'} options={['bar', 'dim', 'hide'].map(k => ({ value: k, label: t('set.pvpIdle.' + k) }))} className="w-44"
            onChange={v => setPvpCfg({ idle: v })} />
        </Row>}
        {c.alarm !== false && <>
          <Toggle label={t('set.pvpAlarmSound')} sub={t('set.pvpAlarmSound.sub')} on={c.alarmSound !== false} onChange={() => setPvpCfg({ alarmSound: c.alarmSound === false })} />
          <Stepper label={t('set.pvpAlarmRange')} sub={t('set.pvpAlarmRange.sub')} value={(c.alarmRange ?? 60) + ' m'} minus={(c.alarmRange ?? 60) > 10} plus={(c.alarmRange ?? 60) < 200}
            onStep={d => setPvpCfg({ alarmRange: Math.max(10, Math.min(200, (c.alarmRange ?? 60) + d * 10)) })} />
        </>}
        {c.feed !== false && <>
          <Stepper label={t('set.feedLimit')} value={String(c.feedLimit ?? 5)} minus={(c.feedLimit ?? 5) > 1} plus={(c.feedLimit ?? 5) < 10}
            onStep={d => setPvpCfg({ feedLimit: Math.max(1, Math.min(10, (c.feedLimit ?? 5) + d)) })} />
          <Stepper label={t('set.feedScale')} value={pct(c.feedScale ?? 1)} minus={(c.feedScale ?? 1) > 0.6} plus={(c.feedScale ?? 1) < 2}
            onStep={d => setPvpCfg({ feedScale: stepVal(c.feedScale ?? 1, d, 0.05, 0.6, 2) })} />
        </>}
        <Stepper label={t('set.pvpScale')} value={pct(c.scale ?? 1)} minus={(c.scale ?? 1) > 0.6} plus={(c.scale ?? 1) < 2}
          onStep={d => setPvpCfg({ scale: stepVal(c.scale ?? 1, d, 0.05, 0.6, 2) })} />
        <Stepper label={t('set.pvpAlpha')} value={pct(c.alpha ?? 0.9)} minus={(c.alpha ?? 0.9) > 0.2} plus={(c.alpha ?? 0.9) < 1}
          onStep={d => setPvpCfg({ alpha: stepVal(c.alpha ?? 0.9, d, 0.05, 0.2, 1) })} />
      </Fine>
    </Group>
  )
}

// ---------------------------------------------------------------- targets & filters

const SORT_KEYS = ['prio', 'near', 'spawns', 'name']

function stepLv(k: 'lvMin' | 'lvMax', d: number) {
  const cur = U[k]
  let v = stepVal(cur, d, 5, 1, 60)
  if (k === 'lvMin' && cur === 1 && v > 1) v = 5 // 1 → 5 → 10 …
  U[k] = Math.max(1, v)
  if (U.lvMin > U.lvMax) { if (k === 'lvMin') U.lvMax = U.lvMin; else U.lvMin = U.lvMax }
  saveUi(['lvMin', 'lvMax']); emit('recompute'); bump()
}

export function Filters() {
  return <>
    <Group title={t('set.g.list')}>
      <Row label={t('set.sort')}>
        <AppSelect value={U.sort} options={SORT_KEYS.map(k => ({ value: k, label: t('set.sort.' + k) }))} className="w-40"
          onChange={v => { U.sort = v; saveUi(['sort']); emit('recompute'); bump() }} />
      </Row>
      <UToggle k="hideNamed" />
      <UToggle k="showLv3" />
    </Group>
    <Group title={t('set.g.level')}>
      <Stepper label={t('set.lvMin')} value={U.lvMin} onStep={d => stepLv('lvMin', d)} minus={U.lvMin > 1} plus={U.lvMin < 60} />
      <Stepper label={t('set.lvMax')} value={U.lvMax} onStep={d => stepLv('lvMax', d)} minus={U.lvMax > 1} plus={U.lvMax < 60} />
    </Group>
    <Group>
      <Row label={t('set.reset')} sub={t('set.reset.sub')}>
        <Button size="sm" variant="outline" onClick={() => {
          Object.assign(U, { sort: DEF_UI.sort, hideNamed: DEF_UI.hideNamed, showLv3: DEF_UI.showLv3, lvMin: DEF_UI.lvMin, lvMax: DEF_UI.lvMax })
          saveUi(['sort', 'hideNamed', 'showLv3', 'lvMin', 'lvMax']); emit('recompute'); bump()
        }}>{t('set.reset.btn')}</Button>
      </Row>
    </Group>
  </>
}

// ---------------------------------------------------------------- notifications

/** Re-render when the Windows voices arrive (getVoices() is empty at first). */
function useVoices() {
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    if (!window.speechSynthesis) return
    speechSynthesis.addEventListener('voiceschanged', force)
    return () => speechSynthesis.removeEventListener('voiceschanged', force)
  }, [])
  return voices()
}

export function Notify() {
  const vs = useVoices()
  const vol = U.ttsVol ?? 0.8, rate = U.ttsRate ?? 1.05, lead = U.timerLead ?? 10
  const voiceOpts = vs.map(v => ({ value: v.name, label: v.name.replace(/^Microsoft /, '').replace(/ - .*$/, '') }))
  const voice = vs.find(v => v.name === U.ttsVoice)?.name ?? vs[0]?.name ?? ''
  return <>
    <Group title={t('set.g.windows')}>
      <WinEdit />
    </Group>
    <Group title={t('set.g.sound')}>
      {ext.features.has('liveCubes') && <UToggle k="soundCube" />}
      <UToggle k="soundTimer" />
      <UToggle k="startChime" />
    </Group>
    <Group title={t('set.g.tts')}>
      <Toggle label={t('set.tts')} sub={t('set.tts.sub')} on={!!U.tts}
        onChange={() => { U.tts = !U.tts; saveUi(['tts']); bump(); if (U.tts) say('test', t('set.say.on')) }} />
      {U.tts && <>
        <Stepper label={t('set.ttsVol')} value={pct(vol)} minus={vol > 0.1} plus={vol < 1} onStep={d => {
          U.ttsVol = Math.min(1, Math.max(0.1, Math.round((vol + 0.1 * d) * 10) / 10)); saveUi(['ttsVol']); bump(); say('test', t('set.say.vol'))
        }} />
        {window.speechSynthesis && (
          <Row label={t('set.ttsVoice')} sub={vs.length ? undefined : t('set.ttsVoice.none')}>
            {vs.length > 0 && <AppSelect value={voice} options={voiceOpts} className="w-48 max-w-full"
              onChange={v => { U.ttsVoice = v; saveUi(['ttsVoice']); bump(); say('test', t('set.say.voice')) }} />}
          </Row>
        )}
        <Stepper label={t('set.ttsRate')} value={pct(rate)} minus={rate > 0.7} plus={rate < 1.6} onStep={d => {
          U.ttsRate = Math.min(1.6, Math.max(0.7, Math.round((rate + 0.05 * d) * 100) / 100)); saveUi(['ttsRate']); bump(); say('test', t('set.say.rate'))
        }} />
      </>}
    </Group>
    {U.tts && (
      <Group title={t('set.g.ttsKinds')}>
        {TTS_KINDS.map(k => (
          <Toggle key={k} label={t('set.tts.' + k)} on={!U.ttsOff?.[k]} onChange={() => {
            U.ttsOff ||= {}; U.ttsOff[k] = !U.ttsOff[k]; saveUi(['ttsOff']); bump(); if (!U.ttsOff[k]) say(k, t('set.say.test'))
          }} />
        ))}
      </Group>
    )}
    <Group title={t('set.g.bossMod')}>
      <UToggle k="bossMod" />
      {U.bossMod && <>
        <BossRoleRow />
        <UToggle k="bossBars" /><UToggle k="bossCount" /><UToggle k="bossTargetMe" /><UToggle k="bossDangerOnly" />
        {BLAME && <><UToggle k="bossBlame" /><UToggle k="bossBlameLive" /></>}
      </>}
      <UToggle k="bossRec" sub={t('set.bossRec.sub', { key: hkText('bossMark') || '–' })} />
      <BossRecRow />
    </Group>
    <Group title={t('set.g.timer')}>
      <Stepper label={t('set.timerLead')} sub={t('set.timerLead.sub')} value={lead + ' min'} minus={lead > 1} plus={lead < 30}
        onStep={d => { U.timerLead = Math.min(30, Math.max(1, lead + d)); saveUi(['timerLead']); bump() }} />
    </Group>
  </>
}

// ---------------------------------------------------------------- hotkeys

const KEYS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', ...'0123456789'.split('').map(d => 'D' + d), ...Array.from({ length: 12 }, (_, i) => 'F' + (i + 1)), 'PageUp', 'PageDown', 'Home', 'End', 'Insert', 'Delete', 'Oemplus', 'OemMinus']
const MODS = ['Alt', 'Ctrl', 'Shift', 'Ctrl+Alt', 'Ctrl+Shift', 'Alt+Shift', '']

function HotkeyRow({ id }: { id: string }) {
  const st = S.settings
  const combo: string = st.hotkeys?.[id] || '', parts = combo.split('+'), key = parts.pop() || '', mod = parts.join('+')
  const bad = !!combo && st.hotkeyOk?.[id] === false
  const send = (m: string, k: string) => host({ type: 'hotkey', action: id, combo: k ? (m ? m + '+' : '') + k : '' })
  return (
    <Row label={t('hk.' + id)} sub={bad ? t('hk.taken') : undefined} subClass="text-red">
      <AppSelect value={mod} tip={t('set.hk.mod')} options={MODS.map(m => ({ value: m, label: modText(m) }))} onChange={m => send(m, key)}
        className={cn('w-28', bad && 'border-red')} />
      <AppSelect value={key} tip={t('set.hk.key')} options={[{ value: '', label: '–' }, ...KEYS.map(k => ({ value: k, label: keyText(k) }))]} onChange={k => send(mod, k)}
        className={cn('w-20', bad && 'border-red')} />
    </Row>
  )
}

export function Hotkeys() {
  return <Group>{HK_IDS.map(id => <HotkeyRow key={id} id={id} />)}</Group>
}

// ---------------------------------------------------------------- live tracking

export function Live() {
  const st = S.settings, mode = st.mode === 'manual' ? 'manual' : 'auto', noNpcap = st.npcap === false
  return (
    <Group>
      <Row label={t('set.mode')} sub={noNpcap ? <span className="text-gold">{rich(t('set.mode.noNpcap'), { link: <NpcapLink /> })}</span>
        : mode === 'auto' ? t('set.mode.sub.auto', { proc: st.processName || '' }) : t('set.mode.sub.manual')}>
        <AppSelect value={mode} options={['auto', 'manual'].map(v => ({ value: v, label: t('set.mode.' + v) }))} className="w-60 max-w-full"
          onChange={v => setMode(v === 'manual' ? 'manual' : 'auto')} />
      </Row>
      <Row label={t('set.status')} sub={S.status.text || '–'} />
      <Row label={t('set.statePath')} sub={<span className="font-mono text-[11px] break-all">{st.statePath}</span>}>
        <Button size="sm" variant="outline" disabled={S.replay} onClick={() => host({ type: 'pickState' })}>{t('set.statePath.btn')}</Button>
      </Row>
    </Group>
  )
}

// ---------------------------------------------------------------- data

// "Lädt …" on the refresh button until the host reports the data again.
let refreshing = false
onHost('dataReady', () => { refreshing = false; bump() })

export function Data() {
  const st = S.settings
  return <>
    <Group>
      <Toggle label={t('set.online')} sub={t('set.online.sub')} on={!!st.onlineUpdates}
        onChange={() => { st.onlineUpdates = !st.onlineUpdates; host({ type: 'online', on: st.onlineUpdates }); bump() }} />
      <Row label={t('set.refresh')} sub={t('set.refresh.sub')}>
        <Button size="sm" variant="outline" disabled={!st.onlineUpdates}
          onClick={() => { refreshing = true; host({ type: 'refresh' }); G.md = {} as Any; bump() }}>
          {refreshing ? t('set.refresh.busy') : t('set.refresh.btn')}
        </Button>
      </Row>
    </Group>
    <Group title={t('set.g.about')}>
      <Row label={t('set.version')} sub={`The Completionist ${st.version || '–'}`} />
    </Group>
    <Group title={t('set.credit.title')}>
      <div className={cn(SUB, 'px-3 pt-2 pb-2.5 leading-relaxed')}>
        {t('set.credit.data')} <a href="https://aion2maps.com/" target="_blank" rel="noreferrer" className="text-gold hover:underline">aion2maps.com</a> {t('set.credit.thanks')}<br />
        <span data-credit-icons>{t('set.credit.icons')}</span><br />
        {t('set.credit.safe')}
      </div>
    </Group>
  </>
}
