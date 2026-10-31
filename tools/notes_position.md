# Eigene Position – Analyse-Notizen

Captures: `20261006-205450` (Testdaevi, ~58 min ab +1288 s), `20261007-115530` (~5 min, meist stehend),
`20261007-122754` (~5 h, 19 Map-Wechsel). Nur S2C. Tool: `python tools/own_position_track.py <capture> --eval --csv out.csv`
(laufende Captures vorher nach %TEMP% kopieren; `--frames dump.jsonl` nutzt einen `analyze_capture.py --dump`).

## Kernaussage

- Der Server schickt die eigene Bewegung **nicht** zurück (kein 0x1c37/0x1b37/0x2937 o. ä. mit eigener ID beim Laufen/Fliegen).
  Eigene Koordinaten stehen nur in Kampf-/Skill-Frames, in seltenen Server-Bewegungen (Knockback/Dash) und beim Teleport.
- Zusätzliche exakte Quellen verdoppeln die Fixes **im Kampf** (Median-Abstand 1,25 s → 0,40 s), helfen außerhalb aber kaum
  (Zeit in Lücken > 5 s: 2170 s → 2095 s auf 205450).
- Außerhalb des Kampfes bleibt nur Schätzung: Spawn/Despawn-Ereignisse liegen auf festen Interest-Radien um den Spieler.
  Partikelfilter darauf halbiert ungefähr den p75-Fehler gegenüber „letzten Fix halten“.

## Opcodes mit eigener Position (verifiziert = Abstand zu 0x2a38-Fix innerhalb ±0,5 s)

| Opcode | Layout (own = eigene ID-Varint) | Fixes 205450 / 122754 | Fehler p50 / p90 | Status |
|---|---|---|---|---|
| 0x2a38 | Effekt: target varint, …, u64 ts_ms, **caster varint** (Idx 24–27), dann x,y,z f32 cm bei +4 (kurz) oder +8 | 1075 / 3418 | Referenz | verifiziert; Position = **Caster**, nicht Ziel |
| 0x2b38 | gleiches Layout wie 0x2a38 (Caster bei Idx ≈25, xyz +8) | 227 / 690 | 0,3 / 1,2 m | verifiziert |
| 0x0238 | caster varint, 00, u32 skill, u8, u8, **target varint** (Idx 9–10), f32 Winkel, x,y,z | 447 / 1659 | 0,4–0,8 / 2–3,6 m | verifiziert (nur wenn own = **Ziel**; own am Anfang = Skillziel, unbrauchbar) |
| 0x0938 | wie 0x0238 (target bei Idx 10, Winkel, xyz) | 151 / 271 | 0,3 / 1,6 m | verifiziert |
| 0x0e38 | ent varint, 02, **caster varint** (Idx 4), u32 skill, u8, target varint, x,y,z | 103 / 273 | 0,4 / 1,2 m | verifiziert |
| 0x1a37 / 0x1e37 / 0x3f37 | own am Frame-Anfang, 0–4 Byte, x,y,z (Server bewegt den Spieler: Knockback, Dash, Stop) | 47 / 40 | 0 m, einzelne bis 60 m (Ziel-/Endpunkt) | verifiziert, selten |
| 0x2336 | Teleport: 6 Byte, x,y,z | 24 / 33 | exakt | bekannt |
| 0x0338 own@0 +15 | Skill-Startpunkt? | – | 5,7 / ~10 m | verworfen (zu ungenau) |
| 0x1438 own@3 +6 | ? | – | 5,4 m | verworfen |

Winkel in 0x0238/0x0938: f32 Grad = `atan2(Y_ziel − Y_caster, X_ziel − X_caster)` (Abweichung 0,0001°, 348 Treffer) –
Trefferrichtung, **keine** Blickrichtung des Spielers. Eine eigene Heading-Quelle wurde nicht gefunden.

Weitere Opcodes mit eigener ID, aber **ohne** Koordinaten: 0x008d (Stats/HP, häufigster, auch außerhalb des Kampfes),
0x0438/0x0538 (Schaden, own bei Idx 4–5), 0x0638, 0x2c38, 0x3538, 0x4437, 0x4a36, 0x4137/0x4237/0x4637, 0x2237, 0x3836/0x3a36.
0x0036 = Server-Tick (u64 ms, alle 50 ms).

## Pet / Begleiter

Kein Entity folgt dem Spieler: Ranking aller Bewegungs-Entities nach Abstand zu den Fixes (205450, 115530) zeigt nur den
Spieler selbst (23/25 < 5 m) und Mobs im Kampf (≈ 50 % < 5 m). Keine Bewegung mit Owner-Feld = eigene ID. → Kein Pet-Proxy
(in diesen Captures; ob ein Beschwörer-Summon Updates bekommt, ist ungetestet).

## Mobs mit Aggro

Mobs, die den Spieler in den letzten 10 s getroffen haben (0x0238/0x0438/0x0538 mit own als Ziel, Caster am Anfang):
deren Bewegungs-Frames liegen p50 6–8,5 m / p90 15–21 m vom Spieler. Nur im Kampf, wird im Filter als schwache Messung (σ 8 m) genutzt.

## Interest-Radien (Spawn/Despawn ↔ Fix, verifiziert, ~3000 Ereignisse)

| Ereignis | Peak | Bemerkung |
|---|---|---|
| 0x4136 NPC-Spawn | 35–40 m (p50 35) | ~20 % näher (Respawns), ~5 % > 100 m (große Entities) |
| 0x4536 Spieler-Spawn | 30–35 m | |
| 0x3436 Objekt-Spawn | 55–60 m | zweiter Peak ~105 m |
| 0x4236 Grund 01 (out of range) | 40–45 m | Position = letzte bekannte des Entities |

## Algorithmus (in `own_position_track.py`, `Tracker`)

1. Fix aus allen Opcodes der Tabelle → Partikel (N 400) um den Fix (σ 1 m).
2. Ohne Fix: Random Walk 6 m/√s (Konstant-Geschwindigkeit war schlechter: Extrapolation läuft weg, wenn der Spieler stehen bleibt).
3. Jedes Spawn/Despawn-Ereignis gewichtet mit Ring-Likelihood (Peak σ 4 m + Gleichverteilung innen + 15 % Ausreißer);
   Aggro-Mob-Bewegung mit Gauß σ 8 m.
4. Ausgabe = gewichtetes Mittel, aber **letzten Fix halten, solange das Mittel < 25 m davon entfernt ist** (sonst zieht Respawn-Rauschen
   einen stehenden Spieler ~12 m weg; 115530).

Fehler direkt vor einem 0x2a38-Fix, der eine Lücke ≥ 4 s ohne jeden Fix beendet (Meter, p50 / p75 / p90):

| Capture | Quellen | Letzten Fix halten | Filter |
|---|---|---|---|
| 205450 | nur 0x2a38 | 16 / 41 / 75 | 12 / 23 / 42 |
| 205450 | alle Fix-Opcodes | 19 / 45 / 78 | 14 / 25 / 50 |
| 122754 | nur 0x2a38 | 13 / 49 / 94 | 12 / 27 / 78 |
| 122754 | alle Fix-Opcodes | 21 / 61 / 114 | 15 / 44 / 101 |
| 115530 | (stehend) | 3 / 4 / 9 | identisch (Gate) |

Fix-Abstände (s): 205450 p50/p90 1,25/6,2 (nur 0x2a38) → 0,40/3,1 (alle); 122754 0,40/3,6 → 0,25/1,8.

## Umsetzung in der App

- `PetFrames.OwnFix` (Protocol.cs): alle Fix-Opcodes der Tabelle (ohne 0x0338/0x1438), Layouts wie `own_fix`.
- `PositionTracker.cs`: Port von `Tracker` (Partikel ohne Allokation, systematisches Resampling). Sendet eine Schätzung
  (`PositionEstimated`, max. 4/s) erst, wenn das Mittel das 25-m-Gate verlässt; σ = Partikel-Streuung, außerhalb des Gates
  2 × Streuung + 5 m (die Wolke ist nach dem Resampling auf Ring-Schnittpunkten zu schmal; Fehler ≤ σ in 54 % statt 26 %).
- Prüfen: Replay mit `PETOVERLAY_POSLOG=app.csv`, dann `python tools/eval_poslog.py app.csv py.csv` (py.csv aus
  `own_position_track.py --csv`). 205450: Fixes identisch (2074, gleiche Quellen, ≤ 0,01 m), Fehler am Ende von Lücken ≥ 4 s
  p50 / p75 / p90 13 / 25 / 50 m (letzten Fix halten 19 / 45 / 78 m).

## Offen / geraten

- Bedeutung von 0x2a38/0x2b38 (Effekt angewendet/entfernt?) und der Felder zwischen Ziel und Caster: geraten.
- 0x1c38 (own@0, zwei Positionsblöcke, Konstante a69b943f) und 0x3c37: unklar, selten.
- Interest-Radius evtl. abhängig von Map/Instanz; nur in offenen Gebieten gemessen.
