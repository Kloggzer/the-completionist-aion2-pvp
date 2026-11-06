# Capture-Logger

Passiv, nur Npcap + Python (keine Pakete nötig). Schreibt nur den Traffic des Aion-Prozesses mit.

```bash
python tools/capture_logger.py
```

Optionen: `--process <regex>` (default `aion`), `--seconds N`, `--list-devices`, `--device <name>`.

## Mitschnitt für die Pet-Analyse

1. Logger starten **bevor** Aion 2 gestartet bzw. eingeloggt wird (Pet-Liste kommt vermutlich beim Login).
2. Einloggen bis ingame → `Ctrl+Alt+5`.
3. Pets-Tab öffnen → `Ctrl+Alt+1`, schließen → `Ctrl+Alt+2`.
4. Pet-Monster töten; sobald eine Soul kommt → `Ctrl+Alt+3`. Unlock/Level-up → `Ctrl+Alt+4`.
5. Pets-Tab nochmal öffnen/schließen (1/2), dann Logger mit `Ctrl+C` beenden.

Zusätzlich hilfreich: in die Konsole tippen, was passiert ist, z. B. `Ursus 4 -> 5 souls` + Enter.

Ausgabe in `captures/<datum-zeit>/`: `game.pcap` (Wireshark-kompatibel), `markers.jsonl`, `connections.jsonl`.

## Boss-Helfer: Dungeons aufzeichnen und Timelines bauen

Die App zeichnet jeden Dungeon-Besuch komplett auf, vom Betreten bis zum Verlassen (Einstellungen → Benachrichtigungen →
Boss-Helfer → „Dungeons aufzeichnen“, an per Default, auch bei ausgeschaltetem Helfer). Pro Besuch eine Datei in
`%LOCALAPPDATA%\TheCompletionist\encounters\` (`<datum-zeit>_<karte>.enc.gz`, ~2–5 MB pro Run), dazu `index.jsonl`;
Pakete mit Charakternamen werden weggelassen, höchstens 2 GB (älteste fliegen raus). `Strg+Alt+B` setzt im Kampf einen
Marker. „Als ZIP exportieren“ (Einstellungen oder Seite Boss-Helfer) legt alles auf den Desktop.

Timelines (`web/public/bossmods.json`) aus Aufnahmen und/oder pcaps, mit Boss-HP aus Abyss Logs; jeder Kampf landet im
Cache `tools/boss_fights.cache.json` (nicht committen), neue Aufnahmen ergänzen die alten:

```bash
python tools/boss_timeline.py <encounters-ordner | export.zip | captures/<datum-zeit>> [...]
python tools/boss_guide.py
```

`boss_guide.py` ergänzt `web/public/bossguide.json` (Phasen, Mechaniken, Raserei; Platzhalter `todo`) ohne Handarbeit zu
überschreiben. `pip install lz4` beschleunigt pcaps stark. Aufnahmen und Mitschnitte nie committen.
