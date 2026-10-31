# Odyle-Energie & Ressourcen – Analyse-Notizen

Captures: `20261006-184441` (Login 18:44, nur Login) und `20261006-205450` (anderer Char bis +1275 s, dann
Relog „Testdaevi“ 21:16, ~55 min Story-/Quest-Instanzen: Maps 320038 BoardPuzzle, 142014, 400002, 320005,
850013/840022/850014 `DQ…_INS_…`). Keine Marker. **Kein Odyle-Würfel, keine Expedition/Transzendenz im Capture.**

Parser: `python tools/resource_frames.py <capture> [--all]`

## Kandidaten (Login, S2C)

| Opcode | Layout | Werte (beide Logins identisch) | Deutung |
|---|---|---|---|
| 0x0be3 | u8 n; n × {u32 id, u32 value} | 2001=560, 2002=0, 4001=200 | **Odyle-Kandidat**: 2001 = 560 = Cap ohne Membership. 2002 evtl. Bonus/Membership-Anteil. 4001 unbekannt |
| 0xacff | u8 n; n × {u8 id, u32 value}; u64 ts_ms (= Login-Zeit) | 1=6, 2=14, 4=5 | Ladungs-Tabelle? 14 = Nightmare-Bank-Max / Shugo-Cap? |
| 0x3be3 | u8 n; n × {u32 id, u8 flag, u64 start_ms, u64 end_ms} | 1058..1066: 30.09.→30.10. ; 2092: 06.10. 14:16 → 05.11. | 30-Tage-Fenster: Season (1058–1066), 2092 evtl. Membership |
| 0x24e3 | u8 n; {u32 id, u32 cur, u32 max, u64 ts, Rest unklar} | 20044=50000/50000, 20045=15000/15000 | unbekannt |
| 0x62e2 | u8 ?, u8 n; n × {u8 id, u8 id, u64 used, u64 cap (‑1=keins), u64 ts}; u64 ts; u32 | id2: 0/500 000 000 | Limits (Kina-Handel?) |
| 0x2ae3 | u8 n; n × {u8 id, u32 value, 9 Byte 0} | 1..3 = 1500 | unbekannt |
| 0xa5ff / 0xa6ff | u64 value, u64 ts_ms | a5ff 255661 → 275796 | = Währung 930100031 − 76557 (beide Logins), a6ff = Live-Update |

Kein Live-Frame dieser Tabellen im Capture (0x0be3/0xacff nur beim Login). Suche nach −40/+15 und Werten
520/480/… in allen Post-Login-Frames: nichts.

## Verifiziert

- Währungen sind Items `0x377033xx` in 0x1156 (Login-Inventar) und 0x1b56 (Live-Update, Einträge à 40 Byte:
  u8 flag, u8, u32 uid, u8 0, u16, u8 0, u32 itemId, u64 count, …).
  930100001 = **Kina** (+15000 je Quest-Belohnung, passt zu 0x0161-Rewards). Weitere: 930100003, …011, …017, …023, …031.
- 0x0161 = Instanz-Belohnung (Map-ID u32 nach Byte 0, dann Item-Liste {u32 item, u64 count}).
- 0x0051 = Skill-Tabelle (a = b + c), keine Ladungen. 0x098d/0x108d = Quests. 0x0160 = stündliche Feld-Events.

## Für den nächsten Capture (bitte Marker tippen)

1. Beim Login im Spiel ablesen und als Marker tippen: Odyle-Energie, Membership ja/nein, Nightmare-Versuche,
   Shugo-Festa-Schlüssel, Dimensions-Invasion-Schlüssel, Abyss-Zeit.
2. Eine Expedition/Transzendenz-Instanz laufen, Würfel einlösen (−40) → Marker `odyle 560 -> 520`.
3. Je einen Nightmare-/Shugo-/Invasions-Eintritt verbrauchen → Marker mit altem/neuem Wert.
4. Optional: einmal ausloggen/einloggen danach, damit 0x0be3/0xacff mit den neuen Werten kommen.
