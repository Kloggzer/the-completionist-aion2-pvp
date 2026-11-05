using System.Text.Json;
using System.Text.Json.Nodes;

namespace PetOverlay;

sealed class Settings
{
    public int X { get; set; } = -1;
    public int Y { get; set; } = -1;
    public int Width { get; set; } = -1;
    public int Height { get; set; } = -1;
    public bool Visible { get; set; } = true;
    public double Opacity { get; set; } = 0.92;
    public double Zoom { get; set; } = 1.0;
    // "auto": read the game's traffic via Npcap; "manual": no Npcap, the user tracks everything by hand.
    // Without Npcap the app always runs manual.
    public string Mode { get; set; } = "auto";
    public bool OnlineUpdates { get; set; } = true;
    // "auto": overlay on the game's monitor, normal window (snap/dock, taskbar, not on top) elsewhere or without the game;
    // "overlay" / "window": fixed.
    public string Dock { get; set; } = "auto";
    public int AnnounceX { get; set; } = int.MinValue;
    public int AnnounceY { get; set; } = int.MinValue;
    // Alert banner (AlertForm): saved centre-top point (int.MinValue = centred near the top of the screen).
    public int AlertX { get; set; } = int.MinValue;
    public int AlertY { get; set; } = int.MinValue;
    // Mini radar (RadarForm): separate always-on-top window. X/Y = top-left corner (int.MinValue = centre it on the
    // character on first show), Size = edge length in px, Range in metres, Disc = opacity of the dark disc (0 = dots only),
    // Rim = opacity of the gold rim (the dashed half-range ring follows it), Alpha = opacity of the whole window (20-100 %), OffsetY = logical px below the game window's centre that "centre on character" uses (the feet sit lower).
    public bool RadarVisible { get; set; }
    public int RadarX { get; set; } = int.MinValue;
    public int RadarY { get; set; } = int.MinValue;
    public int RadarSize { get; set; } = -1;
    public int RadarRange { get; set; } = 100;
    public double RadarDisc { get; set; } = 0.15;
    public double RadarRim { get; set; } = 0.2;
    public double RadarAlpha { get; set; } = 1.0;
    public bool RadarArrow { get; set; } = true;
    public int RadarOffsetY { get; set; }
    // PvP overlay (PvpForm): list of nearby enemy players. On = window enabled (hotkey), Auto = only shown while enemies
    // are listed, X/Y = top-left corner (int.MinValue = left edge of the game's screen on first show), Width in px
    // (-1 = default), Scale = size factor, Alpha = window opacity, Collapsed = header only, Limit = max rows,
    // All = every player instead of enemies only, Team = second section with the own team (arena team / party, self
    // included), TeamLimit = max rows there.
    public bool PvpOn { get; set; } = true;
    public bool PvpAuto { get; set; } = true;
    public int PvpX { get; set; } = int.MinValue;
    public int PvpY { get; set; } = int.MinValue;
    public int PvpWidth { get; set; } = -1;
    public double PvpScale { get; set; } = 1.0;
    public double PvpAlpha { get; set; } = 0.95;
    public bool PvpCollapsed { get; set; }
    public int PvpLimit { get; set; } = 8;
    public bool PvpAll { get; set; }
    public bool PvpTeam { get; set; } = true;
    public int PvpTeamLimit { get; set; } = 6;
    // Enemy alarm (web/src/features/pvp/alarm.ts): banner + sound (+ voice) when an enemy comes into range / close.
    public bool PvpAlarm { get; set; } = true;
    public bool PvpAlarmSound { get; set; } = true;
    public int PvpAlarmRange { get; set; } = 60;
    /// Oneself as a row of the team section (else only in the footer).
    public bool PvpSelf { get; set; }
    /// With "only with enemies" (PvpAuto) and nobody around: "bar" = folded to the header, "dim" = 10 % visible, "hide".
    public string PvpIdle { get; set; } = "bar";
    /// Compact PvP window (to sit under the character): lower header and rows, one line per player, no kill feed,
    /// footer or "no enemies" line; locked, only the sound / team / lock buttons.
    public bool PvpCompact { get; set; }
    // Nearby enemy feed (EnemyFeedForm): only the enemies around, invisible without any.
    public bool FeedOn { get; set; } = true;
    // Last own character the game reported (0x3336 / 0x5636 come only at login and zone changes): used at the next start
    // until a fresh one arrives, so the enemy alarm and the PvP list know your faction after an app restart.
    public string LastOwnName { get; set; } = "";
    public int LastOwnServer { get; set; }
    public int LastOwnPc { get; set; }
    public int LastOwnRace { get; set; }
    public int LastOwnLevel { get; set; }
    public int LastOwnIl { get; set; }
    /// Own faction set by hand (PvP settings): 0 = automatic, 1 Elyos, 2 Asmodian; used while the game has not
    /// reported the character and nothing was saved or guessed.
    public int PvpFaction { get; set; }
    public int FeedX { get; set; } = int.MinValue;
    public int FeedY { get; set; } = int.MinValue;
    public double FeedScale { get; set; } = 1.0;
    public int FeedLimit { get; set; } = 5;
    // Boss helper: timer panel (BossBarsForm) and centre callout (BossCallForm): top-left corner (int.MinValue = default
    // spot) and size (mouse wheel in the edit mode).
    public int BossBarsX { get; set; } = int.MinValue;
    public int BossBarsY { get; set; } = int.MinValue;
    public double BossBarsScale { get; set; } = 1.0;
    public int BossCallX { get; set; } = int.MinValue;
    public int BossCallY { get; set; } = int.MinValue;
    public double BossCallScale { get; set; } = 1.0;
    public string ProcessName { get; set; } = "AION2.exe";
    public string StatePath { get; set; } = "";
    public Dictionary<string, string> Hotkeys { get; set; } = new();
    // UI-only preferences (map, sort, filters, ticked cubes, ...), owned by the web UI (web/src).
    public JsonObject Ui { get; set; } = new();

    public static readonly Dictionary<string, string> DefaultHotkeys = new()
    {
        // Ctrl+Alt: plain Alt+letter combos are partly game shortcuts (Alt+C wings, Alt+V, Alt+H, ...).
        ["toggle"] = "Ctrl+Alt+M", ["click"] = "Ctrl+Alt+C", ["radar"] = "Ctrl+Alt+R", ["site"] = "Ctrl+Alt+W",
        ["opaUp"] = "Ctrl+Alt+PageUp", ["opaDown"] = "Ctrl+Alt+PageDown", ["zoomIn"] = "Ctrl+Alt+Oemplus", ["zoomOut"] = "Ctrl+Alt+OemMinus",
        ["radarLock"] = "Ctrl+Alt+E", ["pvp"] = "Ctrl+Alt+P", ["winEdit"] = "Ctrl+Alt+L", ["bossMark"] = "Ctrl+Alt+B",
    };

    public static string DataDir { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TheCompletionist");

    public string EffectiveStatePath => string.IsNullOrWhiteSpace(StatePath) ? Path.Combine(DataDir, "pet_state.json") : StatePath;

    // Replay runs (tests) keep their own settings so they never touch the real ones.
    public static string FileName { get; set; } = "settings.json";
    static string FilePath => Path.Combine(DataDir, FileName);

    public static Settings Load()
    {
        Settings s;
        try { s = File.Exists(FilePath) ? JsonSerializer.Deserialize<Settings>(File.ReadAllText(FilePath)) ?? new() : FromInstaller(); }
        catch { s = new(); }
        foreach (var (k, v) in DefaultHotkeys) s.Hotkeys.TryAdd(k, v);
        return s;
    }

    // First start after the installer: it leaves the chosen tracking mode next to the exe ({ "mode": "auto" | "manual" }).
    static Settings FromInstaller()
    {
        var s = new Settings();
        try
        {
            var f = Path.Combine(AppContext.BaseDirectory, "setup.json");
            var mode = File.Exists(f) ? JsonNode.Parse(File.ReadAllText(f))?["mode"]?.GetValue<string>() : null;
            if (mode is "auto" or "manual") s.Mode = mode;
        }
        catch { }
        return s;
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(DataDir);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch { }
    }
}
