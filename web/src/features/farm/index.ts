// Farm feature: recompute hotspots when the map, the filters or the chosen resource change.
import { on, emit } from '@/core/bus'
import { V } from '@/core/state'
import { recomputeFarm } from './logic'

V.farmRes ??= []; V.farmPts ??= []; V.farmSpots ??= []; V.farmSpot ??= null

on('recompute', () => { recomputeFarm().then(() => emit('draw')) })
on('mapShown', () => { V.farmSpot = null })
