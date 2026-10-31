// Event timers + field bosses: data loading, host messages, announcer intervals.
import { on } from '@/core/bus'
import { onHost } from '@/core/host'
import { U, saveUi, bump } from '@/core/state'
import { announceBosses, announceTick, loadDrops, loadTimers, onBoss, trackBosses } from './events'

on('base', loadTimers)
on('allMaps', trackBosses)
onHost('boss', m => onBoss(m.id, m.died))
onHost('bossTable', m => { (U.bossTables ||= {})[m.map] = { at: Date.now(), list: m.list }; saveUi(['bossTables']); bump() })

loadDrops()
setInterval(announceTick, 10000)
setInterval(announceBosses, 10000)
// Countdown refresh ("in 12 min") while a time list is visible.
setInterval(() => { if (U.tab === 'timer' || U.tab === 'boss' || U.tab === 'home') bump() }, 20000)
