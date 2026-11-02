// Runs solve() off the UI thread (daevanion.ts posts { id, inp }, gets { id, out }).
import { solve, type SolveIn } from './solve'

self.onmessage = (e: MessageEvent<{ id: number; inp: SolveIn }>) => {
  self.postMessage({ id: e.data.id, out: solve(e.data.inp) })
}
