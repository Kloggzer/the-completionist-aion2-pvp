// Manual mode (no Npcap): onboarding, mode choice, hand-entered pets / achievements / characters.
export default {
  de: {
    'status.manual': 'Manuell',

    'welcome.title': 'Willkommen bei The Completionist',
    'welcome.intro': 'Dein Begleiter für Seelen-Pets, Erfolge, Checkliste, Bosse und Timer in Aion 2. Wie soll die App deinen Fortschritt erfahren?',
    'welcome.auto': 'Automatisch (Npcap mitlesen)',
    'welcome.auto.text': 'Liest passiv eine Kopie des Netzwerkverkehrs von Aion 2 mit – wie Wireshark, ohne Eingriff ins Spiel. Pets, Erfolge, Charakter, Position, Hidden Cubes, Bosse und Ladungen kommen von selbst.',
    'welcome.auto.ok': '✓ Npcap ist installiert',
    'welcome.auto.missing': 'Npcap ist nicht installiert – kostenlos auf {link} herunterladen und die App neu starten.',
    'welcome.manual': 'Manuell (ohne Npcap)',
    'welcome.manual.text': 'Du trägst Pet-Seelen, Erfolge und deinen Charakter selbst ein. Karte, Spawns, Farmspots, Checkliste, Vorräte, Timer und Boss-Respawns (ab deinem Kill) funktionieren genauso – nur Radar, Position und Live-Cubes brauchen den automatischen Modus.',
    'welcome.pick': 'Auswählen',
    'welcome.later': 'Jederzeit änderbar unter Einstellungen → Live-Tracking.',

    'npcap.notice': 'Npcap ist nicht installiert – die App läuft deshalb im **manuellen Modus**: Du trägst deinen Fortschritt selbst ein. Für automatisches Tracking Npcap von {link} installieren und die App neu starten.',
    'npcap.ok': 'Verstanden',

    'set.mode': 'Modus', 'set.mode.auto': 'Automatisch (Npcap mitlesen)', 'set.mode.manual': 'Manuell (ohne Npcap)',
    'set.mode.sub.auto': 'Passiv: liest nur Kopien der Pakete von {proc}, kein Eingriff ins Spiel.',
    'set.mode.sub.manual': 'Pets, Erfolge und Charakter trägst du selbst ein. Radar, Position und Live-Cubes sind aus.',
    'set.mode.noNpcap': 'Npcap ist nicht installiert – ohne Npcap läuft die App immer manuell. Download: {link}',
    'set.g.about': 'Über', 'set.version': 'Version',

    'man.soul.tip': '+1 Seele für {name}',
    'man.edit': 'Lv und Seelen von Hand setzen',
    'man.level': 'Lv', 'man.souls': 'Seelen', 'man.max': 'Lv 3 – komplett', 'man.zero': 'Auf 0',
    'man.petsHint': '**Manueller Modus:** **+** auf einer Kachel zählt eine Seele, über den **Stift** setzt du Lv und Seelen direkt. Fertige Pets siehst du mit „Lv 3 zeigen".',
    'pets.age.manual': 'Manuell gepflegt · zuletzt geändert {ago}',
    'pets.age.manualNone': 'Manuell – Seelen über + und Lv auf den Kacheln eintragen',
    'pets.age.manualTip': 'Manueller Modus: nichts wird aus dem Spiel gelesen.',

    'map.radarManual': 'Radar braucht den automatischen Modus (Npcap) – im manuellen Modus gibt es keine Live-Position.',
    'map.manual': 'Manuell · keine Live-Position',

    'ach.manualHint': '**Manueller Modus:** Erfolg antippen, dann den Zähler mit −/+ setzen oder Stufen abhaken.',
    'ach.faction': 'Fraktion', 'ach.faction.all': 'Beide Fraktionen', 'ach.faction.Elyos': 'Elyos', 'ach.faction.Asmodian': 'Asmodier',
    'ach.set': 'Fortschritt', 'ach.kinah': '{n} Kinah', 'ach.tickTip': 'Stufe abhaken (Zähler auf {goal})', 'ach.untickTip': 'Haken entfernen (Zähler auf {goal})',

    'chk.add': 'Charakter', 'chk.addTip': 'Charakter von Hand anlegen', 'chk.addPh': 'Name des Charakters',
    'chk.ok': 'OK', 'chk.cancel': 'Abbrechen', 'chk.exists': 'Den Namen gibt es schon',
    'chk.active': 'Aktiver Charakter', 'chk.activeSub': 'aktiv · Übersicht und Vorräte zählen für ihn', 'chk.inactiveSub': 'wird von Hand gepflegt',
    'chk.select': 'Aktiv setzen', 'chk.selectTip': 'Diesen Charakter als aktiven wählen', 'chk.rename': 'Umbenennen', 'chk.activeSel': 'Aktiven Charakter wählen',
    'chk.noCharsManual': 'Noch kein Charakter – leg mit „+ Charakter" deinen ersten an.',
    'chk.hintManual': 'Reset: täglich {hh} Uhr, wöchentlich mittwochs {hh} Uhr. Manueller Modus: alles wird von Hand gezählt. Prozent = Durchschnitt aller Einträge.',

    'boss.killShort': 'getötet',
    'boss.manual': 'Manuell: nach dem Kill auf „getötet" tippen – der Respawn wird geschätzt',
  },
  en: {
    'status.manual': 'Manual',

    'welcome.title': 'Welcome to The Completionist',
    'welcome.intro': 'Your companion for soul pets, achievements, checklist, bosses and timers in Aion 2. How should the app learn your progress?',
    'welcome.auto': 'Automatic (read with Npcap)',
    'welcome.auto.text': 'Passively reads a copy of Aion 2\'s network traffic – like Wireshark, never touching the game. Pets, achievements, character, position, hidden cubes, bosses and charges arrive by themselves.',
    'welcome.auto.ok': '✓ Npcap is installed',
    'welcome.auto.missing': 'Npcap is not installed – download it for free from {link} and restart the app.',
    'welcome.manual': 'Manual (without Npcap)',
    'welcome.manual.text': 'You enter pet souls, achievements and your character yourself. Map, spawns, farm spots, checklist, supplies, timers and boss respawns (from your kill) work the same – only radar, position and live cubes need the automatic mode.',
    'welcome.pick': 'Choose',
    'welcome.later': 'You can change this any time under Settings → Live tracking.',

    'npcap.notice': 'Npcap is not installed, so the app runs in **manual mode**: you enter your progress yourself. For automatic tracking install Npcap from {link} and restart the app.',
    'npcap.ok': 'Got it',

    'set.mode': 'Mode', 'set.mode.auto': 'Automatic (read with Npcap)', 'set.mode.manual': 'Manual (without Npcap)',
    'set.mode.sub.auto': 'Passive: only reads copies of the packets of {proc}, never touches the game.',
    'set.mode.sub.manual': 'You enter pets, achievements and character yourself. Radar, position and live cubes are off.',
    'set.mode.noNpcap': 'Npcap is not installed – without Npcap the app always runs manually. Download: {link}',
    'set.g.about': 'About', 'set.version': 'Version',

    'man.soul.tip': '+1 soul for {name}',
    'man.edit': 'Set level and souls by hand',
    'man.level': 'Level', 'man.souls': 'Souls', 'man.max': 'Lv 3 – complete', 'man.zero': 'To 0',
    'man.petsHint': '**Manual mode:** **+** on a tile counts one soul, the **pencil** sets level and souls directly. Finished pets show up with "Show Lv 3".',
    'pets.age.manual': 'Tracked by hand · last change {ago}',
    'pets.age.manualNone': 'Manual – enter souls with + and Lv on the tiles',
    'pets.age.manualTip': 'Manual mode: nothing is read from the game.',

    'map.radarManual': 'The radar needs the automatic mode (Npcap) – manual mode has no live position.',
    'map.manual': 'Manual · no live position',

    'ach.manualHint': '**Manual mode:** tap an achievement, then set its counter with −/+ or tick tiers.',
    'ach.faction': 'Faction', 'ach.faction.all': 'Both factions', 'ach.faction.Elyos': 'Elyos', 'ach.faction.Asmodian': 'Asmodian',
    'ach.set': 'Progress', 'ach.kinah': '{n} Kinah', 'ach.tickTip': 'Tick tier (counter to {goal})', 'ach.untickTip': 'Untick (counter to {goal})',

    'chk.add': 'Character', 'chk.addTip': 'Add a character by hand', 'chk.addPh': 'Character name',
    'chk.ok': 'OK', 'chk.cancel': 'Cancel', 'chk.exists': 'That name already exists',
    'chk.active': 'Active character', 'chk.activeSub': 'active · overview and supplies count for it', 'chk.inactiveSub': 'tracked by hand',
    'chk.select': 'Make active', 'chk.selectTip': 'Choose this character as the active one', 'chk.rename': 'Rename', 'chk.activeSel': 'Choose the active character',
    'chk.noCharsManual': 'No character yet – add your first one with "+ Character".',
    'chk.hintManual': 'Reset: daily at {hh}, weekly on Wednesday at {hh}. Manual mode: everything is counted by hand. Percent = average of all entries.',

    'boss.killShort': 'killed',
    'boss.manual': 'Manual: tap "killed" after the kill – the respawn is estimated',
  },
}
