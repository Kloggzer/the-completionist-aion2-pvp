# The Completionist – Aion 2 overlay (PvP / traffic edition)

> [!CAUTION]
> ## ⚠️ USE AT YOUR OWN RISK – YOUR ACCOUNT MAY GET BANNED ⚠️
>
> **This is the unofficial traffic-reading edition.** It passively reads copies of the game's network packets (via Npcap)
> to show **other players' class, item level, CP and distance** (PvP list, enemy feed, enemy alarm).
>
> - This very likely **violates the Aion 2 Terms of Service**. NCSoft can **suspend or permanently ban** accounts using it.
> - It is **not affiliated with or endorsed by NCSoft**. No support, no warranty, no guarantees (see LICENSE).
> - The game client may change at any time; the app can break or show wrong data without notice.
> - **Do not use it on an account you are not willing to lose.**
>
> **DE:** Diese Version liest den Netzwerkverkehr des Spiels mit und zeigt Klasse, iLvl, CP und Entfernung anderer Spieler.
> Das verstößt sehr wahrscheinlich gegen die Nutzungsbedingungen von Aion 2 – **Sperre des Accounts möglich**.
> Nutzung **komplett auf eigenes Risiko**, ohne Support oder Gewähr. Nicht von NCSoft.
>
> **Updates:** the portable `TheCompletionist.exe` (from v1.1.2) checks this repo's releases at start and every 6 hours
> and shows an update button in the header: one click downloads, replaces the exe and restarts. Turn off "online
> updates" in the settings to skip the check.
>
> The clean, public version without PvP features lives at
> [Kloggzer/the-completionist-aion2](https://github.com/Kloggzer/the-completionist-aion2).


An overlay for **Aion 2** (Global/EU) in the style of DPS meters: always on top, translucent, hotkeys, click-through –
or, on a second screen, a normal dockable window. It helps you complete everything: soul pets, achievements,
dailies/weeklies, bosses and events. German and English.

**[Download the latest release](https://github.com/Kloggzer/the-completionist-aion2-pvp/releases/latest)** –
`TheCompletionist-Setup-x.y.z.exe` (installer: asks for the tracking mode, checks WebView2/Npcap, start menu entry,
uninstall via Windows settings) or the portable `TheCompletionist.exe` (no installation).

> Deutsch: Overlay für Aion 2 – Seelen-Pets, Farmspots, Hidden-Cube-Fundorte, Erfolge, Daily/Weekly-Checkliste pro
> Charakter, Feld- und Abyss-Bosse, Event-Kalender mit Ansagen. Liest nur passiv den eigenen Netzwerkverkehr mit,
> kein Eingriff ins Spiel. Download: siehe Releases.

## Features

- **Overview** – what's next (bosses, rifts, events), what's still open today, where to farm, achievements that are almost done, and "do now" warnings.
- **Soul pets** – which pets you still need on the current map, from which mobs, with live soul counting; select several pets and let the app find the best spot for exactly those.
- **Farm spots** – spawn clusters ranked by the souls *you* still need (explained in the app).
- **Map** – own position, nearby needed mobs, possible Hidden Cube spots; instance maps inside dungeons. Map style: a coloured map rendered from aion2maps' voxel blocks (one-time download per map) or a plain hill-shaded relief.
- **Achievements** – all account achievements sorted from easy to hard, with live progress.
- **Checklist** – dailies and weeklies per character and per server, partly counted automatically; charges (Odyle energy, Nightmare attempts, Invasion keys) with a traffic light before they overflow.
- **Bosses** – field and Abyss bosses with the exact respawn times the server sends.
- **Timers** – calendar of world bosses, rifts and events with announcer window, chimes and text-to-speech ("Gartua spawns in 5 minutes").
- **Boss helper** (off by default) – like DBM / WeakAuras for dungeon bosses: a callout in the middle of the screen and by voice when a big attack starts ("Raus!", "auf dich"), timer bars with phase, Frenzy and HP, countdown, phase warnings, and after the fight who did not play the mechanic. Skills are named and set up on the "Boss-Helfer" page (role, per boss on / bars / off, profile strings to share). Every dungeon visit is recorded locally (no names) so the timelines can grow – export as ZIP for the developer.
- **Market** – the skins you can buy on the market, cheapest first, the ones in your wardrobe hidden (read from the game), with their collection points; prices from aion2.exchange.

## Requirements

- Windows 10/11 (64-bit)
- [Npcap](https://npcap.com/#download) – only for the automatic mode (reading the game's traffic)
- Microsoft Edge WebView2 Runtime (included in Windows 11 and current Windows 10)
- Internet on the first start (game data from aion2maps.com); afterwards it works offline

Settings and data are stored in `%LOCALAPPDATA%\TheCompletionist`. Start the app before logging in (or relog once):
pet and achievement progress is sent by the server at login.

## Two modes

- **Automatic (Npcap)** – pets, achievements, character, position, bosses and charges come from the game's traffic.
- **Manual (no Npcap)** – since v1.1. Without Npcap the app always starts this way. Souls via **+** on a target tile,
  level/souls via **Lv**; achievements: tap a tile and set the counter or tick tiers; characters: Checklist → **+ Character**;
  bosses: **killed** starts the respawn estimate. Position and "nearby" need the automatic mode; map, spawns,
  spots and cube spots stay. Choose in the welcome card or under Settings → Live tracking.

## Is it safe?

The app works like a DPS meter: it **only reads copies of the game's own network packets** (server → client, via Npcap).
It does **not** read or modify game memory, inject anything, or send input to the game. All code is in this repository –
you can read it and build the exe yourself.

## Hotkeys (configurable)

| Hotkey | Action |
|---|---|
| Ctrl+Alt+M | Show / hide |
| Ctrl+Alt+C | Click-through on / off |
| Ctrl+Alt+W | aion2maps view |
| Ctrl+Alt+B | Boss marker: mark a moment in a dungeon fight (for naming the boss's skills later) |
| Ctrl+Alt+PageUp / PageDown | Opacity (also mouse wheel over the header) |
| Ctrl+Alt+Plus / Minus | Scale |

## Building

Requires the .NET 8 SDK and Node.js.

```
cd web
npm install
cd ..
dotnet publish -c Release -r win-x64 --self-contained -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o publish
```

The build compiles the UI (`web/`, React + Tailwind + shadcn) into `ui/` and embeds it into the exe.
Tests: `cd web && npm test` (unit) and `npm run test:e2e` (Playwright with a mocked host).

Layout: C# host (`OverlayForm.cs` window and WebView2, `Capture.cs`/`Protocol.cs` packet decoding, `GameData.cs` data cache),
UI in `web/src` (features per tab), analysis tools for captures in `tools/`.

## Credits

Map (terrain voxels), mob, pet, cube, portrait and instance data: **[aion2maps.com](https://aion2maps.com/)** – thank you!
Achievement data: [aion2.app](https://aion2.app/). Packet framing based on SkeeveAN/Aion-DPS-Meter (MIT).
Icons: [Lucide](https://lucide.dev/) (ISC).
Game icons and art © NCSOFT (AION 2), from NCSOFT's public asset CDN (assets.playnccdn.com); icon file names via
[aion2data.com](https://aion2data.com/). Unofficial fan tool, not affiliated with NCSOFT. They are bundled in
`web/public/icons` (regenerate with `python tools/fetch_icons.py`).

This is a fan project and not affiliated with NCSOFT. Aion is a trademark of NCSOFT Corporation.

## License

[MIT](LICENSE) for the code in this repository. Game data loaded from third-party sites remains subject to their terms.
