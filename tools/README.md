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

## Boss-Helfer: Kämpfe aufzeichnen und Timelines bauen

Die App zeichnet Bosskämpfe selbst auf (Einstellungen → Benachrichtigungen → Boss-Helfer → „Bosskämpfe aufzeichnen“, an
per Default): jeder Kampf mit NPCs im Dungeon (Feldbosse nicht). Pro Kampf eine Datei in
`%LOCALAPPDATA%\TheCompletionist\encounters\` (`<datum-zeit>_<npc>.enc.gz`, ~1 MB pro Boss), dazu `index.jsonl`.
`Strg+Alt+B` setzt im Kampf einen Marker (Moment merken, z. B. „jetzt kam der Sprung“). „Als ZIP exportieren“ legt alles
auf den Desktop.

Timelines (`web/public/bossmods.json`) aus Aufnahmen und/oder pcaps, mit Boss-HP aus Abyss Logs:

```bash
python tools/boss_timeline.py <encounters-ordner | export.zip | captures/<datum-zeit>> [...]
```

`pip install lz4` beschleunigt pcaps stark. Aufnahmen und Mitschnitte nie committen, nur das erzeugte `bossmods.json`.
