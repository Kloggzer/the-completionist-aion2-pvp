// Merchant feature: strings, the hourly offer reset (also while the tab is not shown), fresh scores once all maps are in,
// the offer the game sends when the merchant window/tab opens (host 'merchant', Protocol.cs ParseMerchant), purchases
// (a +5 soul update for an offered pet, host 'soul') and one offer per character (host 'char' / 'state').
import { S, U, V, bump, saveUi, type Any } from '@/core/state'
import { on } from '@/core/bus'
import { onHost } from '@/core/host'
import { addStrings, t } from '@/core/i18n'
import { toast } from '@/core/toast'
import { freshAlt, freshOffers, hourStart, markBought, mergeGame, offerKind, soulGain, switchChar, type GameItem } from './logic'
import strings from './strings'

addStrings(strings)

/** Clear the saved offers (every character's) once their hour is over. */
export function rollOffers(now = Date.now()) {
  const o = U.merch, alt = U.merchAlt
  if (o && o.h !== hourStart(now)) { U.merch = freshOffers(o, now); saveUi(['merch']); bump() }
  if (alt && Object.keys(alt).length !== Object.keys(freshAlt(alt, now)).length) { U.merchAlt = freshAlt(alt, now); saveUi(['merchAlt']); bump() }
}

/** Keep U.merch on the current character's offer (S.state.charName), the others in U.merchAlt. */
export function syncChar(now = Date.now()) {
  const r = switchChar(freshOffers(U.merch, now), U.merchAlt || {}, S.state?.charName || '', now)
  if (!r) return
  U.merch = r.merch; U.merchAlt = r.alt; V.merchView = null
  saveUi(['merch', 'merchAlt']); bump()
}

/** A soul update: a gain of 5+ for an offered pet = bought there (markBought). */
export function onSoul(ev: Any, now = Date.now()) {
  syncChar(now)
  const r = markBought(freshOffers(U.merch, now), +ev?.pet, soulGain(ev), now)
  if (r) { U.merch = r.offers; saveUi(['merch']); bump() }
}

/** Take over a merchant tab read from the game; toast newly offered pets worth buying (toast() honours U.toasts). */
export function gameOffer(tab: number, items: GameItem[], now = Date.now()) {
  syncChar(now)
  const { offers, added } = mergeGame(freshOffers(U.merch, now), tab, items)
  U.merch = offers; saveUi(['merch']); bump()
  const buy = added.map(id => offerKind({ id })).filter(k => k.v === 'buy' || k.v === 'event')
  if (buy.length) toast(t('merch.toast', { n: buy.length }), buy.map(k => k.name).join(', '), 1, true)
}

on('init', () => { rollOffers(); syncChar() })
on('state', () => syncChar())
onHost('char', () => syncChar())
onHost('soul', m => onSoul(m.ev))
on('allMaps', bump)
onHost('merchant', m => gameOffer(m.tab ?? 0, m.items || []))
setInterval(() => rollOffers(), 1000)
