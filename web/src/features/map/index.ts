// Map feature: host messages and bus events (registered at import).
import { onHost } from '@/core/host'
import { on } from '@/core/bus'
import { S, manual } from '@/core/state'
import { draw, fit, updateNear, onPos, onZone, mergeSiteCubes } from './engine'

export { draw, fit, updateNear, cubeDone } from './engine'

// Manual mode has no live data: late messages from a capture that just stopped are ignored.
onHost('pos', m => { if (!manual()) onPos(m.pos) })
onHost('zone', m => onZone(m.id))
onHost('siteCubes', m => mergeSiteCubes(m.cubes))

on('draw', draw)
on('fit', fit)
on('zoneCheck', () => onZone(S.state.mapId ?? S.zone))
on('initPos', p => onPos(p, true))
// The pets feature rebuilds V.targets / V.spots on 'recompute' too: run after it.
on('recompute', () => queueMicrotask(() => { updateNear(); draw() }))
