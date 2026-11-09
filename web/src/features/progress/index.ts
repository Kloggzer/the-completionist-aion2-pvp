// Progress feature: daily/weekly checklist and achievements.
import { U, bump } from '@/core/state'
import { onHost } from '@/core/host'
import { on } from '@/core/bus'
import { applyPvpHistory, refreshBaselines } from './checklist'
import { onAchUpd } from './achievements'
import { noteOwn } from './charinfo'

onHost('achUpd', m => onAchUpd(m.items))
// the logged-in character's class, level, item level, CP and last played time for the checklist cards
onHost('pvp', m => noteOwn(m.own))
onHost('pvpHistory', m => applyPvpHistory(m.matches || [], m.ownSrv || 0))
on('state', refreshBaselines)
on('init', refreshBaselines)
setInterval(refreshBaselines, 60000)
// keeps the reset countdowns in the checklist header current
setInterval(() => { if (U.tab === 'check') bump() }, 60000)
