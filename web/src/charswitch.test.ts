// Character switch: the host holds the full achievement list and the entry limits of a map load until the own
// character arrives (OverlayForm.HoldLogin), then sends 'char' before 'state' / 'entryCharges'. The page must count
// those for the new character only, and nothing in between may land in the old character's (or a nameless) slot.
import { describe, expect, it } from 'vitest'

// the session module sets the theme class on <html> when it loads
const g = globalThis as Record<string, unknown>
g.document ??= { documentElement: { classList: { toggle: () => false } } }
type Msg = Record<string, unknown>
let deliver: (m: Msg) => void = () => {}
g.chrome = { webview: { postMessage: () => {}, addEventListener: (_: string, f: (e: { data: Msg }) => void) => { deliver = m => f({ data: m }) } } }
const { S, U } = await import('@/core/state')
await import('@/core/session')
await import('@/features/progress')
const { startHost } = await import('@/core/host')
const { applyEntryCharges, CHARGES, chargeNow } = await import('@/features/progress/charges')
const { checkCount, lastReset, refreshBaselines } = await import('@/features/progress/checklist')
startHost()

const SUPPLY = 400100500 // Notfall-Versorgungsaufträge (daily, per character)
const after = () => lastReset('d').getTime() + 1000, before = () => lastReset('w').getTime() - 864e5
const state = (charName: string, ach: Record<number, number[]>) => ({ type: 'state', state: { levels: {}, souls: {}, charName, ach } })

describe('character switch', () => {
  it('counts the new login lists for the new character, not the old one', () => {
    U.checklist = { srv: {}, chars: {} }; U.checkBaselines = {}; U.charges = {}; U.entryBonus = {}
    // Testchar: baseline 10 before the reset, 11 after it -> 1 done
    deliver(state('Testchar', { [SUPPLY]: [10, 0, before()] }))
    deliver(state('Testchar', { [SUPPLY]: [11, 0, after()] }))
    expect(checkCount('supplyEmergency', 'char', 'd', 'Testchar')).toBe(1)
    applyEntryCharges([[4, 7, 0], [80000001, 2, 0]]) // Nightmare 7 left, Ascension trial 1 of 3 used
    // switch: 'char' first, then the held lists of Zweitchar (other counter values, other entry limits)
    deliver({ type: 'char', name: 'Zweitchar' })
    expect(S.state.ach).toEqual({}) // the old character's counters are gone until the new state
    refreshBaselines() // the 60 s timer in between must not count anything
    deliver(state('Zweitchar', { [SUPPLY]: [50, 0, before()] }))
    deliver({ type: 'entryCharges', list: [[4, 3, 0], [80000001, 0, 0]] })
    const nightmare = CHARGES.find(c => c.id === 'nightmare')!
    expect(checkCount('supplyEmergency', 'char', 'd', 'Testchar')).toBe(1)
    expect(checkCount('supplyEmergency', 'char', 'd', 'Zweitchar')).toBe(0)
    expect(U.checkBaselines['@Zweitchar'][SUPPLY].v).toBe(50)
    expect(U.checkBaselines['@Testchar'][SUPPLY].v).toBe(10)
    expect([chargeNow(nightmare, 'Testchar'), chargeNow(nightmare, 'Zweitchar')]).toEqual([7, 3])
    expect([checkCount('ascensionTrial', 'char', 'w', 'Testchar'), checkCount('ascensionTrial', 'char', 'w', 'Zweitchar')]).toEqual([1, 3])
  })

  it('without a character name nothing lands in a character slot', () => {
    U.checklist = { srv: {}, chars: {} }; U.checkBaselines = {}; U.charges = {}; U.entryBonus = {}
    deliver(state('', { [SUPPLY]: [10, 0, before()] }))
    deliver({ type: 'entryCharges', list: [[1, 5, 12], [4, 7, 0], [80000001, 2, 0]] })
    deliver({ type: 'charge', id: 4, left: 6 })
    deliver({ type: 'odyle', energy: 300, bonus: 10 })
    expect(Object.keys(U.checklist.chars)).toEqual([])
    expect(U.checkBaselines).toEqual({})
    expect(Object.keys(U.charges)).toEqual(['shugo|srv']) // server charges have no owner to mix up
  })
})
