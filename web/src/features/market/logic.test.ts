import { describe, expect, it } from 'vitest'
import data from '../../../public/skins.json'
import { DEAL, FAIR, catWeight, fashion, histOf, judge, rows, serverId, type Listing, type Point, type Skin, type SkinData } from './logic'

const skins = data as unknown as SkinData
const skin = (over: Partial<Skin> = {}): Skin => ({ item: 1, skin: 1, name: 'Test', cat: 'Helm', grade: 'Epic', pts: 3, stat: '', ...over })
const listing = (price: number | null, listings = 5, key = 1): Listing => ({ item_key: key, name: 'x', price, listings, last_price: price, captured_at: '' })
const hist = (med: number, gone = 2) => ({ med, low: med / 2, gone, days: 14 })
const pt = (h: number, close: number, listings: number, min = listings, max = listings): Point =>
  ({ ts: new Date(Date.UTC(2026, 10, 1, h)).toISOString(), low: close, close, listings, listings_min: min, listings_max: max })

describe('market skins data', () => {
  it('has the tradeable skin unlock items with points and stats (aion2data)', () => {
    expect(skins.total).toBeGreaterThan(1000)
    expect(skins.items.length).toBeGreaterThan(40)
    const apple = skins.items.find(s => s.name === 'Apple Candy')!
    expect(apple).toMatchObject({ item: 516010007, cat: 'Helm', grade: 'Epic', pts: 3 })
    expect(skins.items.every(s => s.pts > 0)).toBe(true)
  })
})

describe('market logic', () => {
  it('history: usual = median close, listings gone per day like craftprofit', () => {
    const h = histOf([pt(0, 500, 10), pt(1, 400, 8), pt(2, 450, 9, 7, 9), pt(3, 10, 9)], Date.UTC(2026, 10, 2, 0))
    expect(h.med).toBe(425) // the 10 Kinah misprint does not drag it down
    expect(h.low).toBe(10)
    // 10 -> 8: 2 gone; 8 -> 9 with 7..9 inside the hour: 2 - 1 = 1 gone; 9 -> 9: 0
    expect(h.gone).toBeCloseTo(3 / 1, 5)
  })

  it('verdicts: owned, not listed, too dear, fair, bargain', () => {
    expect(judge(skin(), listing(400), hist(400), true).kind).toBe('have')
    expect(judge(skin(), listing(null, 0), hist(400), false).kind).toBe('watch')
    expect(judge(skin(), listing(400 * FAIR + 1), hist(400), false).kind).toBe('wait')
    expect(judge(skin(), listing(400), hist(400), false).kind).toBe('buy')
    expect(judge(skin(), listing(400 * DEAL), hist(400), false).kind).toBe('deal')
  })

  it('jewellery counts fully, armor half: Kinah per point', () => {
    expect(catWeight('Earrings')).toBe(1)
    expect(catWeight('Helm')).toBe(0.5)
    expect(judge(skin({ cat: 'Earrings' }), listing(300_000), hist(300_000), false).kpp).toBe(100_000)
    expect(judge(skin({ cat: 'Helm' }), listing(300_000), hist(300_000), false).kpp).toBe(200_000)
  })

  it('rows: bargains first, then fair ones by value per Kinah, owned last', () => {
    const d: SkinData = { total: 4, items: [
      skin({ item: 1, name: 'Fair helm' }), skin({ item: 2, name: 'Cheap earring', cat: 'Earrings' }),
      skin({ item: 3, name: 'Bargain helm' }), skin({ item: 4, name: 'Owned' })] }
    const list = [listing(400_000, 5, 1), listing(400_000, 5, 2), listing(300_000, 5, 3), listing(100, 5, 4)]
    const h = { 1: hist(400_000), 2: hist(400_000), 3: hist(500_000), 4: hist(400_000) }
    expect(rows(d, list, h, { 4: true }).map(r => r.name)).toEqual(['Bargain helm', 'Cheap earring', 'Fair helm', 'Owned'])
  })

  it('Fashionista: next tier and server ids', () => {
    expect(fashion(0)).toEqual({ n: 0, next: 10 })
    expect(fashion(57)).toEqual({ n: 57, next: 100 })
    expect(fashion(1000).next).toBeNull()
    expect(serverId(2306)).toBe(12306)
    expect(serverId(0)).toBe(0)
  })
})
