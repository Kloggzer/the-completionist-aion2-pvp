// Progress feature: daily/weekly checklist and achievements.
import { U, bump } from '@/core/state'
import { onHost } from '@/core/host'
import { on } from '@/core/bus'
import { refreshBaselines } from './checklist'
import { onAchUpd } from './achievements'

onHost('achUpd', m => onAchUpd(m.items))
on('state', refreshBaselines)
on('init', refreshBaselines)
setInterval(refreshBaselines, 60000)
// keeps the reset countdowns in the checklist header current
setInterval(() => { if (U.tab === 'check') bump() }, 60000)
