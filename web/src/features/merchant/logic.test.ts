import { afterEach, describe, expect, it } from 'vitest'
import { G, S } from '@/core/state'
import { HARD, HOUR, catPet, extraPets, merchantPets, offerKind, soulsLeft, freshAlt, markBought, soulGain, soulTotal, switchChar, MAX_SOULS, SOULS_PER_BUY, buyInfo, groupOf, segments, soulsHave, tierOf, difficulty, discount, perSoul, freshOffers, hourStart, eventPets, isPetItem, itemName, mergeGame, petIcon, msToNext, petOfItem, priority, verdict, type GameItem, type MapInfo, type Offers } from './logic'

// Minimal map data: species + byId (spawn indices per npc id), like buildMap() in core/data.ts.
function md(spawns: Record<number, number>, species: Record<number, object> = {}) {
  const byId = new Map<number, number[]>(), sp: Record<number, object> = {}
  let i = 0
  for (const [id, n] of Object.entries(spawns)) {
    byId.set(+id, Array.from({ length: n }, () => i++))
    sp[+id] = { n: 'Mob ' + id, lv: 20, r: 'Normal', named: false, fb: false, ...species[+id] }
  }
  return { species: sp, byId }
}

const MAPS: MapInfo[] = [
  { key: 'World_D_A', name: 'Altgard', faction: 'Asmodian' },
  { key: 'World_D_Starter', name: 'Ishalgen', faction: 'Asmodian' },
  { key: 'World_L_A', name: 'Verteron', faction: 'Elyos' },
  { key: 'Abyss', name: 'Reshanta', faction: 'Abyss' },
]
const DATA = {
  World_D_A: md({ 1: 120, 2: 3, 4: 2 }, { 4: { named: true, lv: 45 } }),
  World_D_Starter: md({ 1: 80 }),
  World_L_A: md({ 3: 150, 1: 40 }),
  Abyss: md({ 5: 30 }),
}
const pet = (...npc: number[]) => ({ id: 1, n: 'Pet', npc })

describe('difficulty', () => {
  it('rates a rare pet harder than a common one', () => {
    const common = difficulty(pet(1), MAPS, DATA, 'Asmodian'), rare = difficulty(pet(2), MAPS, DATA, 'Asmodian')
    expect(common.spawns).toBe(240)
    expect(common.maps).toBe(3)
    expect(common.score).toBeLessThan(HARD)
    expect(rare.score).toBeGreaterThanOrEqual(HARD)
    expect(rare.score).toBeGreaterThan(common.score)
    expect(rare.reasons.map(r => r.k)).toEqual(['spawns', 'oneMap'])
    expect(rare.reasons[0].v).toEqual({ n: 3 })
  })

  it('gives pets without any known spawn the top score', () => {
    const d = difficulty(pet(999), MAPS, DATA, 'Asmodian')
    expect(d.score).toBe(100)
    expect(d.best).toBeNull()
    expect(d.reasons.map(r => r.k)).toEqual(['none'])
    expect(difficulty(pet(), MAPS, DATA, null).score).toBe(100)
  })

  it('treats spawns only in the other faction\'s territory as a time window, not as hard', () => {
    const asmo = difficulty(pet(3), MAPS, DATA, 'Asmodian'), ely = difficulty(pet(3), MAPS, DATA, 'Elyos'), none = difficulty(pet(3), MAPS, DATA, null)
    // only in its time window: a note (+5), the rarity decides whether it is hard
    expect(asmo.reasons[0]).toMatchObject({ k: 'enemy', v: { fac: 'Elyos' }, tone: 'cyan' })
    expect(asmo.score).toBe(ely.score + 5)
    expect(asmo.score).toBeLessThan(HARD)
    expect(ely.score).toBeLessThan(HARD)
    expect(none.score).toBe(ely.score)
    // a pet that also spawns on own maps: the best place is on an own map
    expect(difficulty(pet(1), MAPS, DATA, 'Asmodian').best?.map).toBe('World_D_A')
    expect(difficulty(pet(1), MAPS, DATA, 'Elyos').best?.map).toBe('World_L_A')
  })

  it('adds named, Abyss-only and high-level reasons', () => {
    const named = difficulty(pet(4), MAPS, DATA, 'Asmodian')
    expect(named.reasons.map(r => r.k)).toEqual(['spawns', 'named', 'oneMap', 'lv'])
    expect(named.score).toBeGreaterThan(difficulty(pet(2), MAPS, DATA, 'Asmodian').score)
    expect(difficulty(pet(5), MAPS, DATA, 'Asmodian').reasons.map(r => r.k)).toContain('abyss')
  })
})

describe('verdict', () => {
  const hard = difficulty(pet(2), MAPS, DATA, 'Asmodian'), easy = difficulty(pet(1), MAPS, DATA, 'Asmodian')
  it('by the souls missing to Lv 3: buy = missing and hard, optional = missing and easy, done = Lv 3', () => {
    expect(verdict(105, hard)).toBe('buy')
    expect(verdict(3, hard)).toBe('buy')
    expect(verdict(105, easy)).toBe('opt')
    expect(verdict(0, hard)).toBe('have')
    expect(verdict(0, easy)).toBe('have')
  })
  it('counts purchases to Lv 3 and Kinah per soul', () => {
    expect(SOULS_PER_BUY).toBe(5)
    expect(buyInfo(105)).toEqual({ after: 100, buys: 21 })
    expect(buyInfo(12)).toEqual({ after: 7, buys: 3 })
    expect(buyInfo(3)).toEqual({ after: 0, buys: 1 })
    expect(buyInfo(0)).toEqual({ after: 0, buys: 0 })
    expect(perSoul(80000)).toBe(16000)
  })
  it('weighs difficulty by the missing souls', () => {
    expect(priority(100, hard)).toBeGreaterThan(priority(10, hard))
    expect(priority(50, hard)).toBeGreaterThan(priority(50, easy))
    expect(priority(0, hard)).toBe(0)
  })
})

// 0x9156 samples as Protocol.cs ParseMerchant decodes them: TAB1 from capture 20261014-055236, TAB2 = the in-game shop
// the user screenshotted (names per item from aion2.app/db/items). Pets by name from a pets.json excerpt (real ids).
const g = (item: number, base: number, price: number, tier = 1): GameItem => ({ item, count: 1, tier, base, price })
const PETS = [[1175, 'Faded Predator'], [1209, 'Thin Agrint'], [1005, 'Klaw'], [1159, 'Parasite Swarm'], [1002, 'Forest Specter'],
  [1084, 'Kalgolem'], [1095, 'Superior Wind Spirit'], [1132, 'Ashen Lupyllini'], [1136, 'Rafflesia'], [1167, 'Flame Stone Guardian Statue'],
  [1186, 'Poison Blood'], [1217, 'Congealed Drana'], [1181, 'Brax'], [1180, 'Faded Mutant'], [1210, 'Dry Leaf Agrint']].map(([id, n]) => ({ id, n }))
const TAB1: GameItem[] = [g(535810569, 48000, 43200, 0), g(533850010, 960000, 768000), g(534760200, 100000, 70000, 2), g(535710046, 96000, 76800),
  g(533850005, 1920000, 1536000), g(534760111, 100000, 80000), g(533840017, 3600000, 2880000), g(533840014, 2400000, 2160000, 0),
  g(534760004, 100000, 80000), g(534760110, 100000, 80000)]
const TAB2: GameItem[] = [g(534760083, 100000, 50000, 3), g(534760094, 100000, 90000, 0), g(534760163, 100000, 70000, 2), g(534760167, 100000, 70000, 2),
  g(534760130, 100000, 80000), g(534760185, 100000, 90000, 0), g(534760187, 100000, 70000, 2), g(534760197, 100000, 80000),
  g(534760201, 100000, 80000), g(534760222, 100000, 70000, 2)]

describe('game offer', () => {
  it('maps merchant items to pets by name', () => {
    expect(petOfItem(534760083, PETS)).toBe(1084) // Kalgolem, not 1083
    expect(petOfItem(534760163, PETS)).toBe(1132)
    expect(petOfItem(534760222, PETS)).toBe(1210)
    expect(itemName(534760008)).toBe('Kernon')
    expect(petOfItem(534760008, PETS)).toBe(1009) // merchant / event pet: not in pets.json, game id from petIds.json
    expect(petOfItem(534760183, PETS)).toBeNull() // Golden Baikron: no game id known
    expect(itemName(534760018)).toBeUndefined() // not in the table
    expect(petOfItem(535810569, PETS)).toBeNull()
    expect(isPetItem(534760018)).toBe(true)
    expect(isPetItem(533850010)).toBe(false)
    expect(eventPets(PETS).some(x => x.id === 1009 && x.n === 'Kernon')).toBe(true)
    expect(eventPets(PETS).some(x => x.id === 534760183 && x.n === 'Golden Baikron')).toBe(true)
    expect(eventPets(PETS).some(x => x.n === 'Kalgolem')).toBe(false)
  })

  it('finds the pet portrait by name, case-insensitive', () => {
    expect(petIcon('Kalgolem')).toBe('UT_Vehicle_Portrait_Kalgolem_01.webp')
    expect(petIcon('  kALGOLEM ')).toBe('UT_Vehicle_Portrait_Kalgolem_01.webp')
    expect(petIcon('Krall Laborer')).toBe('UT_Vehicle_Portrait_KrallReg_01.webp')
    expect(petIcon('No such pet')).toBeUndefined()
    expect(petIcon(null)).toBeUndefined()
    expect(petIcon('')).toBeUndefined()
  })

  it('finds the portrait by the game pet id first, then by name', () => {
    expect(petIcon('Kernon', 1009)).toBe('UT_Vehicle_Portrait_Keneir_01.webp')
    expect(petIcon(null, 1001)).toBe('UT_Vehicle_Portrait_BlackDragon_01.webp') // Black Dragon: not in the item table
    expect(petIcon('Kalgolem', 999999)).toBe('UT_Vehicle_Portrait_Kalgolem_01.webp')
    expect(petIcon('Pet #1299', 1299)).toBeUndefined()
  })

  it('shows the discount of the tiers', () => {
    expect([90000, 80000, 70000, 50000].map(price => discount({ base: 100000, price }))).toEqual([10, 20, 30, 50])
    expect(discount({ price: 1000 })).toBe(0)
    expect(discount({ base: 48000, price: 43200 })).toBe(10)
  })

  it('takes over a tab: pets with prices, other goods counted, hand entries kept', () => {
    const o: Offers = { h: 1, items: [{ id: 1005, price: 1 }, { id: 1002 }] }
    const { offers, added } = mergeGame(o, 1353, TAB1, PETS)
    expect(offers.h).toBe(1)
    expect(offers.items.map(x => x.id).sort()).toEqual([1002, 1005, 1159, 1175, 1209])
    expect(offers.items.find(x => x.id === 1005)).toEqual({ id: 1005, item: 534760004, price: 80000, base: 100000, tab: 1353 })
    expect(offers.items.find(x => x.id === 1002)).toEqual({ id: 1002 })
    expect(offers.items.find(x => x.id === 1175)).toMatchObject({ price: 70000, tab: 1353 })
    expect(offers.other?.map(x => x.item)).toEqual([535810569, 533850010, 535710046, 533850005, 533840017, 533840014])
    expect(added.sort()).toEqual([1005, 1159, 1175, 1209])
  })

  it('keeps merchant / event pets and unlisted pet items under their item id', () => {
    const { offers } = mergeGame({ h: 1, items: [] }, 7, [g(534760008, 100000, 80000), g(534760018, 100000, 90000), g(534760083, 100000, 50000, 3)], PETS)
    expect(offers.items.map(x => x.id)).toEqual([1009, 534760018, 1084])
    expect(offers.other).toEqual([])
  })

  it('keeps the other tab, replaces its own tab on reopen and reports only new pets', () => {
    let o: Offers = { h: 1, items: [] }
    o = mergeGame(o, 1353, TAB1, PETS).offers
    const second = mergeGame(o, 1356, TAB2, PETS)
    expect(second.offers.items).toHaveLength(14)
    expect(second.added).toHaveLength(10)
    expect(second.offers.other).toHaveLength(6)
    // reopen of tab 1356: nothing new; a pet that left the tab drops out, the other tab stays
    const again = mergeGame(second.offers, 1356, TAB2, PETS)
    expect(again.added).toEqual([])
    expect(again.offers.items).toHaveLength(14)
    const fewer = mergeGame(second.offers, 1356, TAB2.slice(1), PETS)
    expect(fewer.offers.items.some(x => x.id === 1084)).toBe(false)
    expect(fewer.offers.items.filter(x => x.tab === 1353)).toHaveLength(4)
    expect(fewer.offers.other).toHaveLength(6)
  })
})

describe('hourly offer', () => {
  const t0 = new Date(2026, 9, 14, 13, 42, 10).getTime()
  it('keeps the offer within the hour and clears it on the full hour', () => {
    const o = { h: hourStart(t0), items: [{ id: 1, price: 50000 }] }
    expect(hourStart(t0)).toBe(new Date(2026, 9, 14, 13, 0, 0).getTime())
    expect(msToNext(t0)).toBe((17 * 60 + 50) * 1000)
    expect(freshOffers(o, t0 + msToNext(t0) - 1)).toBe(o)
    const next = freshOffers(o, t0 + msToNext(t0))
    expect(next.items).toEqual([])
    expect(next.h).toBe(hourStart(t0) + HOUR)
    expect(freshOffers(undefined, t0).items).toEqual([])
  })
})

describe('wish list display', () => {
  const d = (score: number, spawns: number) => ({ score, spawns, maps: spawns ? 1 : 0, minLv: 0, reasons: [], best: null })
  it('groups by known spawns and farm effort, three calm tiers', () => {
    expect(groupOf(d(100, 0))).toBe('none')
    expect(groupOf(d(HARD, 3))).toBe('hard')
    expect(groupOf(d(HARD - 1, 30))).toBe('easy')
    expect([tierOf(d(100, 0)), tierOf(d(65, 1)), tierOf(d(64, 1)), tierOf(d(HARD, 1)), tierOf(d(10, 50))]).toEqual([3, 3, 2, 2, 1])
  })
  it('splits the souls to Lv 3 into the three level segments', () => {
    expect(MAX_SOULS).toBe(105)
    expect(soulsHave(105)).toBe(0)
    expect(soulsHave(0)).toBe(105)
    expect(segments(0)).toEqual([0, 0, 0])
    expect(segments(5)).toEqual([1, 0, 0])
    expect(segments(10)).toEqual([1, 0.2, 0])
    expect(segments(105)).toEqual([1, 1, 1])
  })
})

describe('purchases', () => {
  const known = (id: number) => PETS.some(p => p.id === id)
  const base = () => mergeGame({ h: 1, items: [] }, 1356, TAB2, PETS).offers
  it('marks the offer of a pet that gains 5 souls at once, not a kill (+1) or a pet not offered', () => {
    const o = base()
    expect(markBought(o, 1095, 1, 99, known)).toBeNull()
    expect(markBought(o, 1005, 5, 99, known)).toBeNull() // Klaw: not in this offer
    const r = markBought(o, 1095, 5, 99, known)!
    expect(r.id).toBe(1095)
    expect(r.offers.items.find(x => x.id === 1095)?.bought).toBe(99)
    expect(r.offers.items.filter(x => x.bought)).toHaveLength(1)
    expect(markBought(r.offers, 1095, 5, 100, known)).toBeNull() // already marked
  })

  it('merchant / event pets with a game id: marked exactly by that id', () => {
    const cat = (id: number) => !!catPet(id, PETS)
    const o = mergeGame(base(), 7, [g(534760008, 100000, 80000), g(534760183, 100000, 80000)], PETS).offers // Kernon, Golden Baikron
    expect(markBought(o, 1009, 1, 1, cat)).toBeNull()
    const r = markBought(o, 1009, 5, 1, cat)!
    expect(r.id).toBe(1009)
    expect(r.offers.items.filter(x => x.bought).map(x => x.id)).toEqual([1009])
    expect(markBought(r.offers, 1009, 5, 2, cat)).toBeNull() // already marked, Golden Baikron untouched
    expect(markBought(o, 1146, 5, 2, cat)).toBeNull() // Gatekeeper Pinopi: known, not offered
  })

  it('fallback for ids still unknown: the only unbought offer under an item id, nothing when unclear', () => {
    const cat = (id: number) => !!catPet(id, PETS)
    const one = mergeGame(base(), 7, [g(534760183, 100000, 80000)], PETS).offers // Golden Baikron
    expect(markBought(one, 1095, 5, 1, cat)?.id).toBe(1095)
    const r = markBought(one, 4242, 5, 2, cat)!
    expect(r.id).toBe(534760183)
    expect(markBought(r.offers, 4243, 5, 3, cat)).toBeNull()
    const two = mergeGame(one, 7, [g(534760183, 100000, 80000), g(534760018, 100000, 90000)], PETS).offers
    expect(markBought(two, 4242, 5, 2, cat)).toBeNull()
    expect(markBought(base(), 4242, 5, 2, cat)).toBeNull()
  })

  it('a re-sent merchant packet keeps the mark, also when the game drops the bought pet', () => {
    const r = markBought(base(), 1084, 5, 50, known)!
    const again = mergeGame(r.offers, 1356, TAB2, PETS)
    expect(again.offers.items.find(x => x.id === 1084)?.bought).toBe(50)
    expect(again.added).toEqual([])
    const without = mergeGame(r.offers, 1356, TAB2.slice(1), PETS)
    expect(without.offers.items.find(x => x.id === 1084)?.bought).toBe(50)
    expect(without.offers.items).toHaveLength(10)
    // the other tab does not touch it; a hand entry marked bought becomes a game entry with its mark
    expect(mergeGame(r.offers, 1353, TAB1, PETS).offers.items.find(x => x.id === 1084)?.bought).toBe(50)
    const hand = mergeGame({ h: 1, items: [{ id: 1095, bought: 7 }] }, 1356, TAB2, PETS)
    expect(hand.offers.items.find(x => x.id === 1095)).toMatchObject({ tab: 1356, bought: 7 })
    expect(hand.added).not.toContain(1095)
  })

  it('soul gain: the host delta, else from the state before', () => {
    expect(soulTotal(0, 3)).toBe(3)
    expect(soulTotal(1, 21)).toBe(26)
    expect(soulTotal(3, 0)).toBe(105)
    expect(soulGain({ gained: 5 })).toBe(5)
    expect(soulGain({ level: 2, souls: 1, prev: { level: 1, souls: 21 } })).toBe(5) // "+5 -> Lv2 1/75 LEVEL-UP"
    expect(soulGain({ level: 1, souls: 13, prev: { level: 1, souls: 12 } })).toBe(1)
    expect(soulGain({ level: 1, souls: 13 })).toBe(0)
  })
})

describe('offers per character', () => {
  const now = new Date(2026, 9, 14, 13, 20).getTime(), h = hourStart(now)
  const offer = (c: string | undefined, ...ids: number[]): Offers => ({ h, items: ids.map(id => ({ id })), ...(c ? { c } : {}) })
  it('adopts an offer without character, keeps each own one on a switch', () => {
    expect(switchChar(offer(undefined, 1), {}, '', now)).toBeNull()
    const a = switchChar(offer(undefined, 1), {}, 'Main', now)!
    expect(a.merch).toEqual(offer('Main', 1))
    expect(switchChar(a.merch, a.alt, 'Main', now)).toBeNull()
    const b = switchChar(a.merch, a.alt, 'Twink', now)!
    expect(b.merch).toEqual({ h, items: [], c: 'Twink' })
    expect(b.alt).toEqual({ Main: offer('Main', 1) })
    const c = switchChar({ ...b.merch, items: [{ id: 2, bought: 5 }] }, b.alt, 'Main', now)!
    expect(c.merch).toEqual(offer('Main', 1))
    expect(c.alt.Twink.items).toEqual([{ id: 2, bought: 5 }])
  })
  it('the hourly reset applies to every character', () => {
    const alt = { Old: { ...offer('Old', 1), h: h - HOUR }, Twink: offer('Twink', 2), Empty: offer('Empty') }
    expect(Object.keys(freshAlt(alt, now))).toEqual(['Twink'])
    const s = switchChar(offer('Main', 3), alt, 'Old', now)!
    expect(s.merch).toEqual({ h, items: [], c: 'Old' })
    expect(Object.keys(s.alt).sort()).toEqual(['Main', 'Twink'])
    expect(freshOffers(offer('Main', 3), now + HOUR)).toEqual({ h: h + HOUR, items: [], c: 'Main' })
  })
})

describe('pet catalog', () => {
  afterEach(() => { G.pets = []; S.state = { levels: {}, souls: {} } })
  it('adds the merchant / event pets of petIds.json to pets.json, without spawns', () => {
    const extra = extraPets(PETS)
    expect(extra.find(p => p.id === 1009)).toMatchObject({ n: 'Kernon', c: 'Fera', npc: [], ev: 1 })
    expect(extra.some(p => p.id === 1084)).toBe(false) // Kalgolem: in pets.json
    expect(catPet(1084, PETS)).toBe(PETS.find(p => p.id === 1084))
    expect(catPet(1044, PETS)?.n).toBe("Aultross's Doppelganger")
    expect(catPet(1299, PETS)).toBeUndefined()
  })

  it('Kernon (1009) gets its progress from the state and a normal verdict', () => {
    G.pets = PETS
    S.state = { levels: { 1009: 1 }, souls: { 1009: 3 } }
    expect(soulsLeft(1009)).toBe(97)
    expect(offerKind({ id: 1009 })).toMatchObject({ name: 'Kernon', v: 'buy' })
    S.state = { levels: { 1009: 3 }, souls: {} }
    expect(offerKind({ id: 1009 }).v).toBe('have')
    expect(offerKind({ id: 534760183 })).toMatchObject({ p: null, name: 'Golden Baikron', v: 'event' })
  })

  it('wish list pets: event pets in the item table or owned, unknown owned ids as "Pet #id"', () => {
    G.pets = PETS
    S.state = { levels: { 1146: 1, 1299: 2 }, souls: {} }
    const ids = merchantPets().map(p => p.id)
    expect(ids).toContain(1009) // in the item table
    expect(ids).toContain(1146) // owned
    expect(merchantPets().find(p => p.id === 1299)?.n).toBe('Pet #1299')
    expect(new Set(ids).size).toBe(ids.length)
  })
})
