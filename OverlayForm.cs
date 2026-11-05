using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace PetOverlay;

sealed class OverlayForm : Form
{
    const string AppHost = "https://app.petoverlay/";
    // Resizing only via the native frame around the page: a resize started inside the WebView loses the mouse to the
    // browser as soon as the cursor moves back over the page (growing worked, shrinking did not). Bottom is a grip bar.
    const int Grip = 6, GripBottom = 11;
    static readonly Color Bg = Color.FromArgb(17, 20, 28);
    static readonly Color BgClickThrough = Color.FromArgb(110, 40, 48);
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    readonly Settings settings;
    readonly WebView2 ui = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Bg };
    WebView2? site;
    AlertForm? alert;
    EnemyFeedForm? feedForm;
    AnnounceForm? announce;
    BoardOverlay? board;
    RadarForm? radar;
    PvpForm? pvp;
    // PvP overlay data (PlayerFrames via PetSource), sent to the UI as 'pvp' snapshots at most 4x per second.
    readonly Dictionary<uint, PvpPlayer> pvpPlayers = new();
    List<RosterEntry>? pvpRoster;
    DateTime pvpRosterAt;
    OwnInfo? pvpOwn;
    int pvpOwnCp;
    readonly Dictionary<string, PartyMember> pvpParty = new(); // own party / alliance by name (self included)
    PointF? pvpMe; // own position incl. arenas (PlayerFrames.OwnFix), map metres
    DateTime pvpMeAt;
    bool pvpDirty;
    readonly HashSet<string> pvpLogged = new();
    string pvpLastLog = "", pvpLastOdds = "";
    readonly System.Windows.Forms.Timer pvpTimer = new() { Interval = 250 };
    HashSet<uint> trackedNpcs = new();
    HashSet<uint> bossModNpcs = new();
    bool bossLearn; // boss mod: every npc's casts into boss-casts.log
    readonly BossRecorder recorder = new();
    BossBarsForm? bossBars;
    BossCallForm? bossCall;
    string? bossBarsLog; // replay: the bars' boss, logged once per boss
    bool autoShown; // overlay was shown by a cube alert and hides again afterwards
    bool instHidden; // overlay hidden because the player is in an instance
    readonly NotifyIcon tray = new();
    readonly System.Windows.Forms.Timer topTimer = new() { Interval = 2000 };
    readonly System.Windows.Forms.Timer saveTimer = new() { Interval = 1500 };
    // update check (Updater.cs): at the start and every 6 hours; the newest release found, if newer
    readonly System.Windows.Forms.Timer updTimer = new() { Interval = 6 * 3600 * 1000 };
    Updater.Info? update;
    // While click-through is on, the header stays clickable: Cursor.Position polling (no input hook).
    readonly System.Windows.Forms.Timer ctTimer = new() { Interval = 80 };
    bool ctHeader;
    readonly string? replayDir;
    readonly double replaySpeed;
    readonly string? startView;
    string statePath;
    readonly string[] hotkeyIds = Settings.DefaultHotkeys.Keys.ToArray();
    readonly Dictionary<string, bool> hotkeyOk = new();

    PetState state;
    PetSource? source;
    (string state, string text) status = ("off", "Live-Tracking aus");
    bool clickThrough, siteMode, uiReady, typing;
    bool npcap = NpcapInstalled();
    static readonly string Version = typeof(OverlayForm).Assembly.GetName().Version is { } v ? $"{v.Major}.{v.Minor}.{v.Build}" : "";
    bool? dataOk;
    DateTime lastPosSave, lastPosPost;

    float DpiScale => DeviceDpi / 96f;

    public OverlayForm(string? replayDir, double replaySpeed, string? startView = null)
    {
        this.startView = startView;
        this.replayDir = replayDir;
        this.replaySpeed = replaySpeed;
        if (replayDir != null) Settings.FileName = "settings.replay.json";
        settings = Settings.Load();
        recorder.Version = Application.ProductVersion;
        if (replayDir != null) recorder.Dir = Path.Combine(Settings.DataDir, "encounters-replay");
        recorder.Saved += line => BeginInvoke(() =>
        {
            if (replayDir != null) Log("Boss-Aufnahme: " + line);
            Post(new { type = "bossRec", rec = JsonNode.Parse(line) });
            PostBossRecs();
        });
        if (settings.LastOwnRace > 0 && replayDir == null)
        {
            pvpOwn = new OwnInfo(settings.LastOwnName, settings.LastOwnServer, settings.LastOwnPc, settings.LastOwnRace, settings.LastOwnLevel, settings.LastOwnIl);
            pvpOwnGuessed = true;
        }
        else if (settings.PvpFaction > 0 && replayDir == null)
        {
            pvpOwn = new OwnInfo("", settings.PvpFaction * 1000, 0, settings.PvpFaction, 0, 0);
            pvpOwnGuessed = true;
        }
        if ((string?)settings.Ui["lang"] is "de" or "en") L.De = (string?)settings.Ui["lang"] == "de";
        statePath = replayDir != null ? Path.Combine(Settings.DataDir, "pet_state.replay.json") : settings.EffectiveStatePath;
        if (replayDir != null) File.Delete(statePath);
        state = PetState.Load(statePath) ?? new PetState();

        Text = "The Completionist";
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? PawIcon();
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        BackColor = Bg;
        Padding = new Padding(Grip, Grip, Grip, GripBottom);
        Opacity = Math.Clamp(settings.Opacity, 0.3, 1.0);
        AutoScaleMode = AutoScaleMode.None;

        if (settings.Width < 0) { settings.Width = (int)(440 * DpiScale); settings.Height = (int)(720 * DpiScale); }
        MinimumSize = new Size((int)(220 * DpiScale), (int)(40 * DpiScale));
        var wa = Screen.PrimaryScreen!.WorkingArea;
        Size = new Size(settings.Width, settings.Height);
        // -1/-1 = never placed. Other negative values are valid: monitors left of / above the primary one.
        var pos = settings.X != -1 || settings.Y != -1 ? new Point(settings.X, settings.Y) : new Point(wa.Right - Width - (int)(24 * DpiScale), wa.Top + (int)(80 * DpiScale));
        Location = Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(new Rectangle(pos, new Size(60, 30)))) ? pos : new Point(wa.Left + 40, wa.Top + 40);

        windowMode = DecideWindowMode();
        TopMost = !windowMode;
        if (windowMode) Opacity = 1.0;
        Controls.Add(ui);
        BuildTray();
        topTimer.Tick += (_, _) =>
        {
            ApplyWindowMode();
            if (Visible && !windowMode) Native.KeepOnTop(Handle);
            if (radar is { Visible: true }) Native.KeepOnTop(radar.Handle);
            if (pvp is { Visible: true }) Native.KeepOnTop(pvp.Handle);
        };
        pvpTimer.Tick += (_, _) =>
        {
            PvpSweep();
            if (pvpDirty) PostPvp();
        };
        saveTimer.Tick += (_, _) => { saveTimer.Stop(); SaveSettings(); };
        loginTimer.Tick += (_, _) => ReleaseLogin();
        ctTimer.Tick += (_, _) =>
        {
            var p = PointToClient(Cursor.Position);
            bool over = p.X >= 0 && p.X < ClientSize.Width && p.Y >= 0 && p.Y < Grip + (int)(32 * ui.ZoomFactor * DpiScale);
            if (over != ctHeader) { ctHeader = over; UpdateStyles(); }
        };
    }

    // Never take focus from the game, except in the aion2maps view, which needs the keyboard.
    // CreateParams is read by the base constructor already, before the settings are loaded.
    bool windowMode;
    bool WindowMode => windowMode;
    protected override bool ShowWithoutActivation => !WindowMode;

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            // Layered (see-through) only as overlay: for layered windows Windows draws no border or shadow in the
            // resize zone around a normal window, which then shows the desktop.
            if (!WindowMode) cp.ExStyle |= Native.WS_EX_LAYERED;
            if (WindowMode)
            {
                // Frame styles make Windows treat it as a normal window (snap to edges/halves, Win+arrows, maximize);
                // WM_NCCALCSIZE removes the title bar again. APPWINDOW: own taskbar button.
                cp.Style |= WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;
                cp.ExStyle |= WS_EX_APPWINDOW;
            }
            else
            {
                cp.ExStyle |= Native.WS_EX_TOOLWINDOW;
                // Text fields (manual mode: character names) need the keyboard, like the aion2maps view.
                if (!siteMode && !typing) cp.ExStyle |= Native.WS_EX_NOACTIVATE;
            }
            if (clickThrough && !ctHeader) cp.ExStyle |= Native.WS_EX_TRANSPARENT;
            return cp;
        }
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        KeepOnScreen();
        RegisterHotkeys();
        topTimer.Start();
        if (settings.RadarVisible) Radar(); // shows itself once the UI sends a position
        pvpTimer.Start();
        if (!settings.Visible && replayDir == null) BeginInvoke(Hide);

        try
        {
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Settings.DataDir, "WebView2"));
            await ui.EnsureCoreWebView2Async(env);
        }
        catch (Exception ex)
        {
            MessageBox.Show("WebView2 konnte nicht gestartet werden:\n" + ex.Message, Text);
            Close();
            return;
        }

        var core = ui.CoreWebView2;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.AreDevToolsEnabled = Debugger.IsAttached || Environment.GetEnvironmentVariable("PETOVERLAY_DEVTOOLS") == "1";
        core.AddWebResourceRequestedFilter(AppHost + "*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += async (_, a) =>
        {
            // pet portrait not cached yet: download it first (deferred response), then serve it like any /data/ file
            var uri = a.Request.Uri;
            var icon = Uri.UnescapeDataString(new Uri(uri).AbsolutePath);
            if (icon.StartsWith("/data/peticons/") && GameData.PetIconPath(icon[15..]) is { } iconPath && !File.Exists(iconPath))
            {
                var wait = a.GetDeferral();
                try { await GameData.EnsurePetIcon(icon[15..]); a.Response = ServeApp(core.Environment, uri); }
                catch { }
                finally { wait.Complete(); }
                return;
            }
            a.Response = ServeApp(core.Environment, uri);
        };
        core.NewWindowRequested += (_, a) => { a.Handled = true; OpenExternal(a.Uri); };
        core.WebMessageReceived += (_, a) => OnUiMessage(a.WebMessageAsJson);
        ui.ZoomFactor = settings.Zoom;
        core.Navigate(AppHost + "index.html");

        _ = Task.Run(async () =>
        {
            GameData.Online = settings.OnlineUpdates;
            bool ok = await GameData.EnsureBase();
            BeginInvoke(() => { dataOk = ok; Post(new { type = "dataReady", ok }); });
        });
        StartSource();
    }

    // ---------------------------------------------------------------- UI bridge

    CoreWebView2WebResourceResponse ServeApp(CoreWebView2Environment env, string uri)
    {
        var path = Uri.UnescapeDataString(new Uri(uri).AbsolutePath.TrimStart('/'));
        Stream? stream = null;
        if (path.StartsWith("data/"))
        {
            var full = Path.GetFullPath(Path.Combine(GameData.CacheDir, path[5..]));
            if (full.StartsWith(GameData.CacheDir, StringComparison.OrdinalIgnoreCase) && File.Exists(full))
                stream = new MemoryStream(File.ReadAllBytes(full));
        }
        else stream = typeof(OverlayForm).Assembly.GetManifestResourceStream("ui/" + path);

        if (stream == null) return env.CreateWebResourceResponse(null, 404, "Not Found", "");
        var mime = Path.GetExtension(path) switch
        {
            ".html" => "text/html; charset=utf-8", ".js" => "text/javascript; charset=utf-8", ".css" => "text/css; charset=utf-8",
            ".json" => "application/json; charset=utf-8", ".png" => "image/png", ".webp" => "image/webp", ".svg" => "image/svg+xml", ".woff2" => "font/woff2", ".woff" => "font/woff", ".ttf" => "font/ttf", _ => "application/octet-stream",
        };
        return env.CreateWebResourceResponse(stream, 200, "OK", $"Content-Type: {mime}\nCache-Control: no-store");
    }

    void Post(object msg)
    {
        if (uiReady) ui.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(msg, Json));
    }

    object SettingsView() => new
    {
        settings.Opacity, settings.Zoom, settings.OnlineUpdates, settings.ProcessName, settings.Dock,
        StatePath = statePath, settings.Hotkeys, HotkeyOk = hotkeyOk, settings.Ui, settings.Mode, Npcap = npcap, Version,
        Radar = RadarView(), Pvp = PvpView(),
    };

    // ---------------------------------------------------------------- mini radar (RadarForm)

    object RadarView() => new
    {
        on = settings.RadarVisible, locked = radar?.Locked ?? true, range = settings.RadarRange,
        disc = settings.RadarDisc, rim = settings.RadarRim, alpha = settings.RadarAlpha, size = radar?.Width ?? settings.RadarSize, arrow = settings.RadarArrow, offY = settings.RadarOffsetY,
    };

    void PostRadar() => Post(new { type = "radarWin", radar = RadarView() });

    RadarForm Radar()
    {
        if (radar != null) return radar;
        radar = new RadarForm(settings);
        radar.Changed += () => { SaveSoon(); PostRadar(); };
        return radar;
    }

    void ShowRadar(bool on)
    {
        settings.RadarVisible = on;
        if (!on) Radar().SetLocked(true);
        Radar().Apply();
        SaveSoon();
        PostRadar();
    }

    void ToggleRadarLock()
    {
        // Unlocking a hidden radar shows it (that is what the hotkey is for: move it into place).
        if (!settings.RadarVisible) { settings.RadarVisible = true; Radar().SetLocked(false); SaveSoon(); }
        else Radar().SetLocked(!Radar().Locked);
        Radar().Apply();
        PostRadar();
    }

    static Color HexColor(string? hex)
    {
        try { if (hex is { Length: 7 } && hex[0] == '#') return Color.FromArgb(Convert.ToInt32(hex[1..], 16) | unchecked((int)0xFF000000)); }
        catch { }
        return Color.FromArgb(95, 208, 224);
    }

    static PointF? Pt(JsonNode? n) => n is JsonArray a && a.Count >= 2 ? new PointF((float?)a[0] ?? 0, (float?)a[1] ?? 0) : null;

    void OnRadarData(JsonNode m)
    {
        if (radar == null && !settings.RadarVisible) return;
        bool ok = (bool?)m["ok"] ?? false;
        var dots = (m["dots"] as JsonArray ?? []).OfType<JsonArray>().Where(a => a.Count >= 3).Take(400)
            .Select(a => new RadarForm.Dot((float?)a[0] ?? 0, (float?)a[1] ?? 0, HexColor((string?)a[2]), ((int?)a.ElementAtOrDefault(3) ?? 0) != 0)).ToArray();
        var cubes = (m["cubes"] as JsonArray ?? []).Select(Pt).OfType<PointF>().Take(50).ToArray();
        Radar().SetData(ok, (float?)m["heading"], dots, cubes, Pt(m["nearest"]), (float?)m["sigma"]);
    }

    // ---------------------------------------------------------------- PvP overlay (PvpForm)

    sealed class PvpPlayer(PlayerSpawn p)
    {
        public readonly PlayerSpawn P = p;
        public float X = p.X / 100, Z = p.Y / 100;
        /// Out of range / dead: listed for PvpLinger more (greyed), then dropped. Killer from 0x048d.
        public DateTime? GoneAt;
        public bool Dead;
        public string By = "";
        public int BySrv;
    }

    /// Kill seen around (0x048d with a player victim): the feed of the PvP window.
    sealed record PvpKill(DateTime At, string Victim, int VictimSrv, int VictimRace, string Killer, int KillerSrv);
    readonly List<PvpKill> pvpKills = new();
    static readonly TimeSpan PvpLinger = TimeSpan.FromSeconds(5), PvpKillAge = TimeSpan.FromSeconds(90);
    // Abyss points this session (since the app started): first value seen, last value, the part gained right after a
    // player kill around (0xa9ff follows the kill credit 0x048d within the same burst) = PvP.
    long apStart = -1, apLast = -1, apPvp;
    DateTime pvpPlayerKillAt;
    (string Name, int Srv) pvpLastKiller;
    /// The own character is only a guess (no 0x3336 / 0x5636 since the start): replaced as soon as the game reports it.
    bool pvpOwnGuessed;

    // Without the own character nobody counts as an enemy. It comes only at login / zone changes, so after an app start
    // mid-session it is guessed: the last saved one (Settings.LastOwn*), the killer of a player kill that brought us
    // Abyss points right after, or the faction of the own party. Server key -> faction: 1xxx Elyos (1), 2xxx Asmodian (2).
    void GuessOwn(string name, int srv, string why)
    {
        if (pvpOwn != null && !pvpOwnGuessed) return;
        int race = srv / 1000 == 1 ? 1 : srv / 1000 == 2 ? 2 : 0;
        if (race == 0 || (pvpOwn != null && pvpOwn.Race == race && (name.Length == 0 || pvpOwn.Name == name))) return;
        pvpOwn = new OwnInfo(name.Length > 0 ? name : pvpOwn?.Name ?? settings.LastOwnName, srv, pvpOwn?.PcId ?? 0, race, pvpOwn?.Level ?? 0, pvpOwn?.ItemLevel ?? 0);
        pvpOwnGuessed = true; pvpDirty = true;
        Log($"Eigener Charakter geschätzt ({why}): {pvpOwn.Name} Server {srv} Rasse {race}");
        // remembered for the next start (the game's own report replaces it whenever it comes)
        if (replayDir == null && (settings.LastOwnRace != race || settings.LastOwnServer != srv || (name.Length > 0 && settings.LastOwnName != name)))
        {
            if (name.Length > 0) settings.LastOwnName = name;
            (settings.LastOwnServer, settings.LastOwnRace) = (srv, race);
            SaveSoon();
        }
    }

    object PvpView() => new
    {
        on = settings.PvpOn, locked = !winEdit, auto = settings.PvpAuto, scale = settings.PvpScale, alpha = settings.PvpAlpha,
        limit = settings.PvpLimit, all = settings.PvpAll, team = settings.PvpTeam, teamLimit = settings.PvpTeamLimit,
        alarm = settings.PvpAlarm, alarmSound = settings.PvpAlarmSound, alarmRange = settings.PvpAlarmRange, self = settings.PvpSelf, idle = settings.PvpIdle, compact = settings.PvpCompact, faction = settings.PvpFaction,
        feed = settings.FeedOn, feedScale = settings.FeedScale, feedLimit = settings.FeedLimit,
    };

    readonly Dictionary<uint, long> invCount = new();
    void PostPvpWin() => Post(new { type = "pvpWin", pvp = PvpView() });

    PvpForm Pvp()
    {
        if (pvp != null) return pvp;
        pvp = new PvpForm(settings);
        pvp.Changed += () => { SaveSoon(); PostPvpWin(); };
        pvp.CloseClicked += () => { SetWinEdit(false); ShowPvp(false); };
        pvp.LockClicked += () => SetWinEdit(!winEdit);
        pvp.SettingsClicked += () =>
        {
            if (siteMode) SetSiteMode(false, null, null);
            if (!Visible) ToggleVisible();
            Post(new { type = "openSettings", cat = "map" });
        };
        return pvp;
    }

    void ShowPvp(bool on)
    {
        settings.PvpOn = on;
        if (on) pvp?.Undismiss();
        Pvp().Apply();
        SaveSoon();
        PostPvpWin();
    }

    // ---------------------------------------------------------------- edit mode of the small overlay windows

    // PvP list, event announcer and alert banner: locked = click-through; edit mode (lock icon of the PvP list, hotkey
    // "winEdit", settings) = clickable, framed, dragged anywhere; positions are saved and restored onto a visible screen.
    bool winEdit;

    void SetWinEdit(bool on)
    {
        winEdit = on;
        var screen = Screen.FromControl(this);
        if (settings.PvpOn || !on) Pvp().SetLocked(!on);
        Announcer().SetEdit(on, screen);
        Alert().SetEdit(on, screen);
        if (settings.FeedOn || !on) Feed().SetEdit(on);
        if (bossBars != null || on) BossBars().SetEdit(on);
        if (bossCall != null || on) BossCall().SetEdit(on);
        if (!on) SaveSoon();
        PostPvpWin();
    }

    BossBarsForm BossBars()
    {
        if (bossBars != null) return bossBars;
        bossBars = new BossBarsForm(settings);
        bossBars.Moved += SaveSoon;
        return bossBars;
    }

    BossCallForm BossCall()
    {
        if (bossCall != null) return bossCall;
        bossCall = new BossCallForm(settings);
        bossCall.Moved += SaveSoon;
        return bossCall;
    }

    /// Boss helper sounds by name (page: per mechanic kind).
    static void BossSound(string? name)
    {
        switch (name)
        {
            case "alarm": Chime.Enemy(); break;
            case "close": Chime.EnemyClose(); break;
            case "timer": Chime.Timer(); break;
            case "pling": Chime.Pling(); break;
            case "plong": Chime.Plong(); break;
        }
    }

    EnemyFeedForm Feed()
    {
        if (feedForm != null) return feedForm;
        feedForm = new EnemyFeedForm(settings);
        feedForm.Moved += SaveSoon;
        return feedForm;
    }

    AnnounceForm Announcer()
    {
        if (announce != null) return announce;
        announce = new AnnounceForm();
        if (settings.AnnounceX != int.MinValue) announce.SavedLocation = new Point(settings.AnnounceX, settings.AnnounceY);
        announce.Moved += p => { settings.AnnounceX = p.X; settings.AnnounceY = p.Y; SaveSoon(); };
        return announce;
    }

    AlertForm Alert()
    {
        if (alert != null) return alert;
        alert = new AlertForm { Anchor = () => settings.FeedOn ? Feed().Bounds : null };
        if (settings.AlertX != int.MinValue) alert.SavedLocation = new Point(settings.AlertX, settings.AlertY);
        alert.Moved += p => { settings.AlertX = p.X; settings.AlertY = p.Y; SaveSoon(); };
        return alert;
    }

    void OnPvpData(JsonNode m)
    {
        static PvpForm.Row[] Rows(JsonNode? a) => (a as JsonArray ?? []).OfType<JsonObject>().Take(50).Select(r => new PvpForm.Row(
            (string?)r["c"] ?? "", (int?)r["k"] ?? 0, HexColor((string?)r["cc"]), (string?)r["n"] ?? "", (string?)r["sub"] ?? "",
            (string?)r["cp"] ?? "", HexColor((string?)r["col"]), HexColor((string?)r["bar"] ?? (string?)r["col"]), (string?)r["d"] ?? "",
            (float?)r["f"] ?? 0, ((int?)r["me"] ?? 0) != 0, ((int?)r["dim"] ?? 0) != 0,
            (string?)r["dc"] is { Length: > 0 } dcs ? HexColor(dcs) : null, (string?)r["il"] ?? "")).ToArray();
        static PvpForm.Line Line(JsonNode? l) => new((string?)l?["t"] ?? "", HexColor((string?)l?["col"]));
        var rows = Rows(m["rows"]);
        PvpForm.Line? odds = m["odds"] is JsonObject o ? Line(o) : null;
        var feed = (m["feed"] as JsonArray ?? []).OfType<JsonObject>().Take(5).Select(l => Line(l)).ToArray();
        var team = m["team"] is JsonArray ? Rows(m["team"]) : null; // null = team section off
        static string Txt(PvpForm.Row[] rs) => string.Join(", ", rs.Select(r => $"{r.Cls} {r.Name} ({r.Sub}{(r.Il.Length > 0 ? " · iLvl " + r.Il : "")}) {r.Cp} {r.Dist}"));
        if (replayDir != null && Txt(rows) + (team != null ? " | Team: " + Txt(team) : "") is var txt && txt != pvpLastLog)
            Log($"PvP-Liste ({(string?)m["title"]}): {pvpLastLog = txt}");
        if (replayDir != null && odds is { } od && od.Text != pvpLastOdds) Log($"PvP-Chancen: {pvpLastOdds = od.Text}");
        if (settings.FeedOn || feedForm != null) Feed().SetData(rows, (int?)m["urg"] ?? 0);
        if (!settings.PvpOn && pvp == null) return; // list off: only the enemy feed
        if (pvp == null && rows.Length == 0 && feed.Length == 0 && m["panel"] is not JsonArray { Count: > 0 } && settings.PvpAuto) return; // nothing to show yet: no window needed
        Pvp().SetData((string?)m["title"] ?? "PvP", (string?)m["empty"] ?? "", rows, team, (string?)m["enemyHead"] ?? "", (string?)m["teamHead"] ?? "",
            (string?)m["foot"] ?? "", (string?)m["footCls"] ?? "", (int?)m["footK"] ?? 0,
            HexColor((string?)m["footCol"]), (string?)m["status"] ?? "", HexColor((string?)m["statusCol"]),
            odds, feed, (string?)m["feedHead"] ?? "", (int?)m["urg"] ?? 0, (long?)m["alarmAt"] ?? 0,
            (m["panel"] as JsonArray ?? []).OfType<JsonObject>().Take(24).Select(p => new PvpForm.PanelSec((string?)p["h"] ?? "",
                (p["l"] as JsonArray ?? []).OfType<JsonObject>().Take(8).Select(l => Line(l)).ToArray(), (string?)p["tab"] ?? "")).ToArray());
    }

    void PostPvp()
    {
        pvpDirty = false;
        Post(new
        {
            type = "pvp",
            own = pvpOwn == null ? null : new { name = pvpOwn.Name, srv = pvpOwn.Server, pc = pvpOwn.PcId, race = pvpOwn.Race, lv = pvpOwn.Level, il = pvpOwn.ItemLevel, cp = pvpOwnCp },
            // own position as [x, z, age ms]: arenas included (the map's 'pos' skips coordinates around 0/0)
            me = pvpMe is { } me ? new object[] { MathF.Round(me.X, 1), MathF.Round(me.Y, 1), (int)(DateTime.UtcNow - pvpMeAt).TotalMilliseconds } : null,
            roster = pvpRoster?.Select(r => new { name = r.Name, srv = r.Server, pc = r.PcId, race = r.Race, lv = r.Level, team = r.Team }),
            // own party / alliance: [name, server, pcId, level, item level, CP]
            party = pvpParty.Values.Select(p => new object[] { p.Name, p.Server, p.PcId, p.Level, p.ItemLevel, p.Cp }),
            // [entity, name, server, pcId, race, level, item level, CP, x, z (map metres, like 'pos'),
            //  gone (0 here, 1 out of range, 2 dead), killer, killer server]
            players = pvpPlayers.Values.Select(v => new object[] { v.P.Ent, v.P.Name, v.P.Server, v.P.PcId, v.P.Race, v.P.Level, v.P.ItemLevel, v.P.Cp,
                MathF.Round(v.X, 1), MathF.Round(v.Z, 1), v.Dead ? 2 : v.GoneAt != null ? 1 : 0, v.By, v.BySrv }),
            // kills around, newest first: [age ms, victim, victim server, victim race, killer, killer server]
            // Abyss points: [current, gained this session, of which right after player kills] (null = none seen yet)
            ap = apLast < 0 ? null : new[] { apLast, apLast - apStart, apPvp },
            kills = pvpKills.Select(k => new object[] { (int)(DateTime.UtcNow - k.At).TotalMilliseconds, k.Victim, k.VictimSrv, k.VictimRace, k.Killer, k.KillerSrv }),
        });
    }

    /// pvpTimer: drop players gone longer than PvpLinger and old kills.
    void PvpSweep()
    {
        var now = DateTime.UtcNow;
        foreach (var (ent, v) in pvpPlayers.ToList())
            if (v.GoneAt is { } at && now - at > PvpLinger) { pvpPlayers.Remove(ent); pvpDirty = true; }
        if (pvpKills.RemoveAll(k => now - k.At > PvpKillAge) > 0) pvpDirty = true;
    }

    // Abyss Logs fight history (Build tab): file = null -> the index, else one fight file (base64); answered as 'abyss'.
    async void Abyss(int id, string? file)
    {
        var body = await Task.Run(() => file == null ? AbyssLogs.Index() : AbyssLogs.Segment(file));
        Post(new { type = "abyss", id, body });
    }

    // Website request of the page (Daevanion boards): answered as 'plaync' with the request id.
    async void PlayNc(int id, string url)
    {
        var (status, body) = await PlayerLookup.Raw(url); // resumes on the UI thread
        Post(new { type = "plaync", id, status, body });
    }

    async void PvpLookup(string name, int srv)
    {
        var info = PlayerLookup.Cached(name, srv);
        if (info == null)
        {
            Post(new { type = "pvpWeb", name, srv, state = "busy" });
            info = await PlayerLookup.Get(name, srv); // resumes on the UI thread
        }
        Post(new { type = "pvpWeb", name, srv, state = info == null ? "err" : info.Found ? "ok" : "none", cp = info?.Cp ?? 0, il = info?.ItemLevel ?? 0, cls = info?.Cls ?? "" });
        if (info != null && replayDir != null) Log($"PLAYNC {name}@{srv}: {(info.Found ? $"{info.Cls} CP {info.Cp} iLvl {info.ItemLevel}" : "nicht gefunden")}");
    }

    // Boss mod: casts of the npcs the page has timelines for go to the page (web/src/features/bossmod); while learning,
    // every npc's spawn / casts / end go into boss-casts.log (for tools/boss_timeline.py-like analysis without a capture).
    void WireBossMod(PetSource src)
    {
        src.BossModNpcs = bossModNpcs;
        src.BossModAll = bossLearn;
        src.Recorder = recorder;
        static long Ms(DateTime ts) => new DateTimeOffset(ts).ToUnixTimeMilliseconds();
        static string T(DateTime ts) => ts.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss.fff");
        // players by entity: the PvP list's (spawns in range, the party in a dungeon) and oneself
        uint Own() => src.OwnId is { } id ? PetFrames.VarintValue(id) : 0;
        string Who(uint ent) => ent == Own() ? pvpOwn?.Name ?? "" : pvpPlayers.TryGetValue(ent, out var p) ? p.P.Name : "";
        src.NpcSpawned += (npc, ent, ts) =>
        {
            if (bossLearn) BossLog($"{T(ts)} spawn npc {npc} ent {ent}");
            if (bossModNpcs.Contains(npc)) BeginInvoke(() => Post(new { type = "bossSpawn", npc, ent, at = Ms(ts) }));
        };
        src.NpcCast += (npc, ent, skill, seq, tgt, ts) =>
        {
            if (bossLearn) BossLog($"{T(ts)} cast npc {npc} ent {ent} skill {skill} seq {seq} tgt {tgt}");
            if (!bossModNpcs.Contains(npc)) return;
            if (replayDir != null) Log($"Boss-Cast: npc {npc} skill {skill} ({T(ts)})");
            BeginInvoke(() => Post(new { type = "bossCast", npc, ent, skill, seq, tgt, me = tgt != 0 && tgt == Own(), name = Who(tgt), at = Ms(ts) }));
        };
        src.NpcCastEnd += (npc, ent, skill, seq, ts) =>
        {
            if (bossLearn) BossLog($"{T(ts)} end npc {npc} ent {ent} skill {skill} seq {seq}");
            if (bossModNpcs.Contains(npc)) BeginInvoke(() => Post(new { type = "bossCastEnd", npc, ent, skill, seq, at = Ms(ts) }));
        };
        src.NpcHp += (npc, ent, hp, ts) =>
        {
            if (bossModNpcs.Contains(npc)) BeginInvoke(() => Post(new { type = "bossHp", npc, ent, hp, at = Ms(ts) }));
        };
        src.NpcTarget += (npc, ent, tgt, ts) =>
        {
            if (bossModNpcs.Contains(npc)) BeginInvoke(() => Post(new { type = "bossTarget", npc, ent, tgt, me = tgt == Own(), name = Who(tgt), at = Ms(ts) }));
        };
        src.NpcHit += (npc, ent, skill, seq, tgt, flags, ts) =>
        {
            if (bossModNpcs.Contains(npc)) BeginInvoke(() => Post(new { type = "bossHit", npc, ent, skill, seq, tgt, flags, me = tgt == Own(), name = Who(tgt), at = Ms(ts) }));
        };
        src.NpcGone += (npc, ent, died, ts) =>
        {
            if (bossLearn) BossLog($"{T(ts)} gone npc {npc} ent {ent} died {(died ? 1 : 0)}");
            if (bossModNpcs.Contains(npc)) BeginInvoke(() => Post(new { type = "bossGone", npc, ent, died, at = Ms(ts) }));
        };
    }

    void PostBossRecs()
    {
        var (n, bytes) = recorder.Stats();
        Post(new { type = "bossRecs", n, mb = Math.Round(bytes / 1048576.0, 1), on = recorder.On });
    }

    /// Hotkey: marker into the running fight recording (the page notes it for the "last fight" list).
    void BossMark()
    {
        var at = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        bool ok = recorder.Mark($"marker {at}");
        if (ok) Chime.Pling();
        Post(new { type = "bossMark", at, ok });
    }

    void WirePvp(PetSource src)
    {
        src.PlayerSpawned += p => BeginInvoke(() =>
        {
            pvpPlayers[p.Ent] = new PvpPlayer(p);
            pvpDirty = true;
            if (replayDir != null || pvpLogged.Add(p.Name))
                Log(FormattableString.Invariant($"Spieler: {p.Name} Server {p.Server} pc {p.PcId} Rasse {p.Race} Lv{p.Level} iLvl {p.ItemLevel} CP {p.Cp} @ {p.X / 100:F0},{p.Y / 100:F0}"));
        });
        src.PlayerMoved += (ent, x, y, _) => BeginInvoke(() =>
        {
            if (!pvpPlayers.TryGetValue(ent, out var v)) return;
            v.X = x / 100; v.Z = y / 100;
            pvpDirty = true;
        });
        src.PlayerGone += (ent, reason) => BeginInvoke(() =>
        {
            if (!pvpPlayers.TryGetValue(ent, out var v)) return;
            v.GoneAt = DateTime.UtcNow;
            v.Dead |= reason == PlayerFrames.GoneDied;
            pvpDirty = true;
        });
        src.PlayerKilled += (victim, killer, srv, name) => BeginInvoke(() =>
        {
            PvpKill k;
            if (pvpPlayers.TryGetValue(victim, out var v))
            {
                v.Dead = true; v.By = name; v.BySrv = srv;
                k = new PvpKill(DateTime.UtcNow, v.P.Name, v.P.Server, v.P.Race, name, srv);
                pvpPlayerKillAt = DateTime.UtcNow;
                pvpLastKiller = (name, srv);
            }
            else if (pvpOwn != null) k = new PvpKill(DateTime.UtcNow, pvpOwn.Name, pvpOwn.Server, pvpOwn.Race, name, srv); // self
            else return;
            pvpKills.Insert(0, k);
            if (pvpKills.Count > 8) pvpKills.RemoveAt(pvpKills.Count - 1);
            pvpDirty = true;
            Log($"Kill: {k.Victim} ({k.VictimSrv}) von {name} ({srv})");
        });
        src.RosterReceived += list => BeginInvoke(() =>
        {
            pvpRoster = list; pvpRosterAt = DateTime.UtcNow; pvpDirty = true;
            Log("Arena-Roster: " + string.Join(", ", list.Select(r => $"T{r.Team} {r.Name} ({r.Server}, pc {r.PcId}, Lv{r.Level}, Wertung {r.Rating})")));
        });
        src.OwnInfoReceived += o => BeginInvoke(() =>
        {
            if (pvpOwn != o) Log($"Eigener Charakter: {o.Name} Server {o.Server} pc {o.PcId} Rasse {o.Race} Lv{o.Level} iLvl {o.ItemLevel}");
            pvpOwn = o; pvpOwnGuessed = false; pvpDirty = true;
            if (replayDir == null && (settings.LastOwnName != o.Name || settings.LastOwnServer != o.Server || settings.LastOwnRace != o.Race || settings.LastOwnLevel != o.Level || settings.LastOwnIl != o.ItemLevel))
            {
                (settings.LastOwnName, settings.LastOwnServer, settings.LastOwnPc, settings.LastOwnRace, settings.LastOwnLevel, settings.LastOwnIl) = (o.Name, o.Server, o.PcId, o.Race, o.Level, o.ItemLevel);
                SaveSoon();
            }
        });
        src.PartyReceived += (list, full) => BeginInvoke(() =>
        {
            if (full) pvpParty.Clear();
            foreach (var p in list) pvpParty[p.Name] = p;
            // the own party has our faction
            if (pvpOwn == null && list.FirstOrDefault(p => p.Server > 0) is { } pm) GuessOwn("", pm.Server, "Gruppe");
            pvpDirty = true;
            if (full || replayDir != null) Log("Gruppe: " + string.Join(", ", pvpParty.Values.Select(p => $"{p.Name} ({p.Server}, pc {p.PcId}, iLvl {p.ItemLevel}, CP {p.Cp})")));
        });
        src.PartyLeft += () => BeginInvoke(() => { pvpParty.Clear(); pvpDirty = true; Log("Gruppe verlassen"); });
        src.OwnCpReceived += cp => BeginInvoke(() => { pvpOwnCp = cp; pvpDirty = true; });
        // loot: per item uid the last count; a count that rose is a gain, a new uid only with a small stack (1-3: a
        // drop) – zone changes resend stacks under new uids (captures/20261027-170912: 5 M Kina, scroll stacks), and the
        // login sends the whole inventory (10+ records). Sent to the UI as 'loot' (dungeon panel: loot per run).
        src.InventoryReceived += inv => BeginInvoke(() =>
        {
            var gain = new JsonArray();
            foreach (var (uid, id, count) in inv)
            {
                long d = invCount.TryGetValue(uid, out var old) ? count - old : count <= 3 ? count : 0;
                invCount[uid] = count;
                if (d > 0 && inv.Count < 10) gain.Add(new JsonArray(id, d));
            }
            if (gain.Count > 0) Post(new JsonObject { ["type"] = "loot", ["items"] = gain });
        });
        src.ApReceived += ap => BeginInvoke(() =>
        {
            if (apStart < 0) apStart = ap;
            if (apLast >= 0 && ap > apLast && DateTime.UtcNow - pvpPlayerKillAt < TimeSpan.FromSeconds(2))
            {
                apPvp += ap - apLast;
                // Abyss points right after a player kill: we (or our party) killed – the killer's faction is ours
                if ((pvpOwn == null || pvpOwnGuessed) && pvpLastKiller.Srv > 0) GuessOwn(pvpLastKiller.Name, pvpLastKiller.Srv, "Kill + Abyss-Punkte");
            }
            if (ap != apLast) Log($"Abyss-Punkte: {ap} (Session +{ap - apStart}, PvP +{apPvp})");
            apLast = ap; pvpDirty = true;
        });
        src.OwnPvpPos += (x, y, _) => BeginInvoke(() => { pvpMe = new PointF(x / 100, y / 100); pvpMeAt = DateTime.UtcNow; pvpDirty = true; });
        src.MapChanged += _ => BeginInvoke(() =>
        {
            // Everyone around is gone after a map change; the arena roster arrives together with the arena's map change.
            pvpPlayers.Clear();
            if (DateTime.UtcNow - pvpRosterAt > TimeSpan.FromSeconds(5)) pvpRoster = null;
            pvpDirty = true;
        });
    }

    /// Manual mode: chosen, or Npcap is missing (replays always read their capture).
    bool Manual => replayDir == null && (settings.Mode == "manual" || !npcap);

    static bool NpcapInstalled()
    {
        var sys = Environment.SystemDirectory;
        return File.Exists(Path.Combine(sys, "Npcap", "wpcap.dll")) || File.Exists(Path.Combine(sys, "wpcap.dll"));
    }

    void PostState() => Post(new { type = "state", state, replay = replayDir != null });

    async void OnUiMessage(string json)
    {
        JsonNode? m;
        try { m = JsonNode.Parse(json); } catch { return; }
        if (m == null) return;
        switch ((string?)m["type"])
        {
            case "ready":
                if (!uiReady) { Updater.Cleanup(); CheckUpdate(); updTimer.Tick += (_, _) => CheckUpdate(); updTimer.Start(); }
                uiReady = true;
                Post(new { type = "init", settings = SettingsView(), state, replay = replayDir != null, view = startView, status = new { state = status.state, text = status.text } });
                if (dataOk is { } d) Post(new { type = "dataReady", ok = d });
                PostDock();
                PostUpdate();
                PostDaevanion();
                break;
            case "drag": Native.BeginDrag(Handle); break;
            case "resize":
                // Edge zones in the page (the native 3 px border is hard to hit on high-DPI screens).
                Native.BeginDrag(Handle, (string?)m["edge"] switch
                {
                    "l" => Native.HTLEFT, "r" => Native.HTRIGHT, "t" => Native.HTTOP, "b" => Native.HTBOTTOM,
                    "bl" => Native.HTBOTTOMLEFT, "tl" => Native.HTTOPLEFT, "tr" => Native.HTTOPRIGHT, _ => Native.HTBOTTOMRIGHT,
                });
                break;
            case "hide": ToggleVisible(); break;
            case "clickThrough": ToggleClickThrough(); break;
            case "opacity":
                settings.Opacity = Math.Clamp((double?)m["v"] ?? 0.9, 0.3, 1.0);
                if (!windowMode) Opacity = settings.Opacity;
                Post(new { type = "opacity", v = settings.Opacity });
                SaveSoon();
                break;
            case "zoom":
                ui.ZoomFactor = settings.Zoom = Math.Clamp((double?)m["v"] ?? 1, 0.6, 2.0);
                SaveSoon();
                break;
            case "ui":
                if (m["patch"] is JsonObject patch)
                    foreach (var (k, v) in patch) settings.Ui[k] = v?.DeepClone();
                SaveSoon();
                break;
            case "hotkey":
                if ((string?)m["action"] is { } act && settings.Hotkeys.ContainsKey(act))
                {
                    settings.Hotkeys[act] = (string?)m["combo"] ?? "";
                    RegisterHotkeys();
                    SaveSoon();
                    Post(new { type = "settings", settings = SettingsView() });
                }
                break;
            case "online":
                GameData.Online = settings.OnlineUpdates = (bool?)m["on"] ?? true;
                SaveSoon();
                break;
            case "mode":
                settings.Mode = (string?)m["mode"] == "manual" ? "manual" : "auto";
                npcap = NpcapInstalled(); // may have been installed in the meantime
                SaveSoon();
                StartSource();
                Post(new { type = "settings", settings = SettingsView() });
                break;
            // ---- manual mode: progress entered by hand, stored like the values read from the game
            case "setPet":
                if ((uint?)m["id"] is uint setId and > 0)
                {
                    state.Set(setId, (int?)m["level"] ?? 0, (int?)m["souls"] ?? 0, DateTime.UtcNow);
                    StateChanged();
                }
                break;
            case "addSoul":
                if ((uint?)m["id"] is uint addId and > 0)
                {
                    var ev = state.Gain(addId, Math.Clamp((int?)m["n"] ?? 1, 1, 75), DateTime.UtcNow);
                    Post(new { type = "soul", ev });
                    StateChanged();
                }
                break;
            case "setAch":
                if ((uint?)m["id"] is uint achId and > 0)
                {
                    long val = Math.Max(0, (long?)m["val"] ?? 0), tier = Math.Max(0, (long?)m["tier"] ?? 0), ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                    state.Ach[achId] = [val, tier, ts];
                    state.Save(statePath);
                    Post(new { type = "achUpd", items = new[] { new long[] { achId, val, tier, ts } } });
                }
                break;
            case "setChar":
                var charName = ((string?)m["name"] ?? "").Trim();
                if (charName.Length > 40) charName = charName[..40];
                state.CharName = charName;
                state.Save(statePath);
                Post(new { type = "char", name = charName });
                break;
            case "typing":
                typing = (bool?)m["on"] ?? false;
                UpdateStyles();
                if (typing && !windowMode) Activate();
                break;
            case "needMap":
                var key = (string?)m["key"] ?? "";
                bool ok = key.StartsWith("dng:") ? await GameData.EnsureDungeon(key[4..], (bool?)m["force"] ?? false)
                                                 : await GameData.EnsureMap(key, (bool?)m["force"] ?? false);
                Post(new { type = "mapReady", key, ok });
                break;
            case "needArt":
                var artKey = (string?)m["key"] ?? "";
                var art = await GameData.EnsureTerrain(artKey, (bool?)m["force"] ?? false);
                Post(new { type = "artReady", key = artKey, file = art });
                break;
            case "refresh":
                bool okBase = await GameData.EnsureBase(true);
                Post(new { type = "dataReady", ok = okBase, refreshed = true });
                break;
            case "pickState": PickStatePath(); break;
            case "site": SetSiteMode((bool?)m["on"] ?? !siteMode, (string?)m["map"], (string?)m["search"]); break;
            case "openUrl": OpenExternal((string?)m["url"] ?? ""); break;
            case "updateNow": ApplyUpdate(); break;
            case "quit": Close(); break;
            case "lang":
                var de = (string?)m["lang"] == "de";
                if (de != L.De) { L.De = de; BuildTrayMenu(); }
                break;
            case "log": Log((string?)m["msg"] ?? ""); break;
            case "dock":
                settings.Dock = (string?)m["dock"] is "overlay" or "window" ? (string)m["dock"]! : "auto";
                SaveSettings();
                ApplyWindowMode();
                PostDock();
                break;
            case "instCheck":
                Post(new { type = "instScreen", same = OnGameScreen() });
                break;
            case "instHide":
                // Instance/dungeon: get out of the way until the player leaves (UI sends instShow) – only when the
                // overlay sits on the game's monitor; on a second screen it doesn't cover anything.
                if (Visible && OnGameScreen()) { Hide(); instHidden = true; }
                break;
            case "instShow":
                if (instHidden && !Visible) { Show(); BringUp(); }
                instHidden = false;
                break;
            case "cubeFocus":
                // An optional local module wants the map in view: bring the overlay up, even when hidden.
                if (!Visible) { Show(); BringUp(); autoShown = true; }
                break;
            case "cubeDone":
                if (autoShown) { autoShown = false; Hide(); }
                break;
            case "trackNpcs":
                trackedNpcs = new HashSet<uint>((m["ids"] as JsonArray ?? []).Select(v => (uint?)v ?? 0));
                if (source != null) source.TrackedNpcs = trackedNpcs;
                break;
            case "bossMod":
                bossModNpcs = new HashSet<uint>((m["ids"] as JsonArray ?? []).Select(v => (uint?)v ?? 0));
                bossLearn = (bool?)m["learn"] == true;
                if (source != null) { source.BossModNpcs = bossModNpcs; source.BossModAll = bossLearn; }
                recorder.Npcs = bossModNpcs;
                recorder.All = (bool?)m["inst"] == true;
                recorder.On = (bool?)m["rec"] == true;
                if (!recorder.On) recorder.Stop();
                PostBossRecs();
                break;
            case "bossBars":
                {
                    var rows = (m["rows"] as JsonArray ?? []).OfType<JsonArray>().Take(8).Select(r => new BossBarsForm.Bar(
                        (string?)r[0] ?? "", (double?)r[1] ?? 0, (double?)r[2] ?? 0, HexColor((string?)r[3]), (string?)r[4] ?? "")).ToArray();
                    if (rows.Length == 0 && m["title"] == null && bossBars == null) break; // nothing shown yet: no window needed
                    if (replayDir != null && (string?)m["title"] is { } bt && bt != bossBarsLog)
                        Log($"Boss-Balken: {bossBarsLog = bt} · HP {(int?)m["hp"]} % · {string.Join(", ", rows.Select(r => $"{r.Name} {r.Left:0}/{r.Total:0} s"))}");
                    BossBars().SetData((string?)m["title"] ?? "", (string?)m["phase"] ?? "", (int?)m["hp"] ?? 100,
                        (m["phases"] as JsonArray ?? []).Select(v => (int?)v ?? 0).ToArray(), (double?)m["frenzy"] ?? -1,
                        (string?)m["target"] ?? "", (bool?)m["me"] == true, rows,
                        (m["foot"] as JsonArray ?? []).OfType<JsonArray>().Take(4).Select(l => new PvpForm.Line((string?)l[0] ?? "", HexColor((string?)l[1]))).ToArray());
                    break;
                }
            case "bossCall":
                BossSound((string?)m["sound"]);
                if (replayDir != null) Log($"Boss-Ansage: {(string?)m["title"]} | {(string?)m["sub"]}");
                if ((string?)m["title"] is { Length: > 0 } ct)
                    BossCall().Call(ct, (string?)m["sub"] ?? "", HexColor((string?)m["col"]), (double?)m["seconds"] ?? 0, (bool?)m["danger"] == true);
                else bossCall?.Clear();
                break;
            case "bossExport":
                var zip = await recorder.Export();
                if (zip != null) try { System.Diagnostics.Process.Start("explorer.exe", $"/select,\"{zip}\""); } catch { }
                Post(new { type = "bossExported", path = zip });
                break;
            case "chime":
                if ((string?)m["kind"] == "plong") Chime.Plong();
                else Chime.Pling();
                break;
            case "announce":
                if ((bool?)m["sound"] == true) Chime.Timer();
                Announcer().Announce((string?)m["key"] ?? "", (string?)m["title"] ?? "", (string?)m["sub"] ?? "",
                    DateTimeOffset.FromUnixTimeMilliseconds((long?)m["at"] ?? 0).UtcDateTime, Screen.FromControl(this));
                break;
            case "radar2": OnRadarData(m); break;
            case "pvp2": OnPvpData(m); break;
            case "pvpWin": ShowPvp((bool?)m["on"] ?? !settings.PvpOn); break;
            case "winEdit": SetWinEdit((bool?)m["on"] ?? !winEdit); break;
            case "pvpCfg":
                if ((int?)m["limit"] is int lim) settings.PvpLimit = Math.Clamp(lim, 1, 30);
                if ((bool?)m["all"] is bool all) settings.PvpAll = all;
                if ((bool?)m["team"] is bool team) settings.PvpTeam = team;
                if ((int?)m["teamLimit"] is int tlim) settings.PvpTeamLimit = Math.Clamp(tlim, 1, 30);
                if ((bool?)m["alarm"] is bool alarm) settings.PvpAlarm = alarm;
                if ((bool?)m["alarmSound"] is bool asnd) settings.PvpAlarmSound = asnd;
                if ((int?)m["alarmRange"] is int arange) settings.PvpAlarmRange = Math.Clamp(arange, 10, 200);
                if ((bool?)m["self"] is bool self) settings.PvpSelf = self;
                if ((bool?)m["compact"] is bool compact) settings.PvpCompact = compact;
                if ((int?)m["faction"] is int fac and >= 0 and <= 2)
                {
                    settings.PvpFaction = fac;
                    // by hand: used at once while the game has not reported the character
                    if (fac > 0 && (pvpOwn == null || pvpOwnGuessed)) GuessOwn(pvpOwn?.Name ?? settings.LastOwnName, fac * 1000 + (pvpOwn?.Server ?? settings.LastOwnServer) % 1000, "eingestellt");
                }
                if ((bool?)m["feed"] is bool feedOn) settings.FeedOn = feedOn;
                if ((double?)m["feedScale"] is double fsc) settings.FeedScale = Math.Clamp(Math.Round(fsc, 2), 0.6, 2);
                if ((int?)m["feedLimit"] is int flim) settings.FeedLimit = Math.Clamp(flim, 1, 10);
                feedForm?.Apply();
                if ((string?)m["idle"] is "bar" or "dim" or "hide") settings.PvpIdle = (string)m["idle"]!;
                if ((bool?)m["auto"] is bool auto) settings.PvpAuto = auto;
                if ((double?)m["alpha"] is double palpha) settings.PvpAlpha = Math.Clamp(Math.Round(palpha, 2), 0.2, 1);
                if ((double?)m["scale"] is double scale) settings.PvpScale = Math.Clamp(Math.Round(scale, 2), PvpForm.MinScale, PvpForm.MaxScale);
                pvp?.Apply();
                SaveSoon();
                PostPvpWin();
                break;
            case "plaync": PlayNc((int?)m["id"] ?? 0, (string?)m["url"] ?? ""); break;
            case "abyss": Abyss((int?)m["id"] ?? 0, (string?)m["file"]); break;
            case "pvpLookup":
                if ((string?)m["name"] is { Length: > 0 } lname && (int?)m["srv"] is int lsrv) PvpLookup(lname, lsrv);
                break;
            case "radarWin": ShowRadar((bool?)m["on"] ?? !settings.RadarVisible); break;
            case "radarLock":
                if ((bool?)m["locked"] is bool lk && settings.RadarVisible) { Radar().SetLocked(lk); PostRadar(); }
                else ToggleRadarLock();
                break;
            case "radarCenter":
                if (!settings.RadarVisible) ShowRadar(true);
                Radar().CenterOnCharacter();
                break;
            case "radarCfg":
                if ((int?)m["range"] is int rng) settings.RadarRange = Math.Clamp(rng, RadarForm.MinRange, RadarForm.MaxRange);
                if ((double?)m["alpha"] is double alpha) settings.RadarAlpha = Math.Clamp(Math.Round(alpha, 2), 0.2, 1);
                if ((int?)m["size"] is int side) Radar().SetSide(side);
                if ((double?)m["disc"] is double disc) settings.RadarDisc = Math.Clamp(Math.Round(disc, 2), 0, 0.9);
                if ((double?)m["rim"] is double rim) settings.RadarRim = Math.Clamp(Math.Round(rim, 2), 0, 1);
                if ((bool?)m["arrow"] is bool arrow) settings.RadarArrow = arrow;
                if ((int?)m["offY"] is int offY)
                {
                    settings.RadarOffsetY = Math.Clamp(offY, -400, 400);
                    if (radar != null) radar.CenterOnCharacter(); // the offset only means something relative to the centre
                }
                radar?.Apply();
                SaveSoon();
                PostRadar();
                break;
            case "alertHide": alert?.HideDanger(); break;
            case "daeOverlay":
                // Daevanion marks in the game (BoardOverlay): on/off and the marks per board
                if (board == null)
                {
                    board = new BoardOverlay(Post, () => Visible && WindowState != FormWindowState.Minimized ? Bounds : null, () => settings.ProcessName);
                    board.OverlayLog = Log;
                }
                board.Update(m);
                break;
            case "daeOverlayDump":
                Post(new { type = "daeOverlayDump", path = board?.Dump() });
                break;
            case "daeLog":
                // Daevanion research: log every frame with node ids of the own boards (daevanion-packets.log)
                if (source != null) source.DaeLog = (bool?)m["on"] == true;
                Log("Daevanion-Mitschnitt " + ((bool?)m["on"] == true ? "an" : "aus"));
                DaeOps($"{DateTime.Now:HH:mm:ss.fff} log {((bool?)m["on"] == true ? "on" : "off")}");
                break;
            case "alert":
                switch ((string?)m["sound"])
                {
                    case "cube": Chime.Cube(); break;
                    case "opened": Chime.Opened(); break;
                    case "pvp": Chime.Enemy(); break;
                    case "pvpClose": Chime.EnemyClose(); break;
                    default: BossSound((string?)m["sound"]); break;
                }
                // The in-page toast is enough while the full overlay is visible; otherwise use the banner.
                if ((bool?)m["danger"] == true && settings.FeedOn) feedForm?.Flash();
                if (replayDir != null) Log($"Banner: {(string?)m["title"]} | {(string?)m["sub"]}");
                if (!Visible || (bool?)m["always"] == true)
                    Alert().ShowAlert((string?)m["title"] ?? "", (string?)m["sub"] ?? "", Screen.FromControl(this), (int?)m["seconds"] ?? 8, (bool?)m["danger"] == true);
                break;
        }
    }

    void SaveSoon()
    {
        saveTimer.Stop();
        saveTimer.Start();
    }

    void SaveSettings()
    {
        if (WindowState == FormWindowState.Normal)
        {
            settings.X = Left; settings.Y = Top;
            settings.Width = Width; settings.Height = Height;
        }
        settings.Save();
    }

    /// Ask GitHub for a newer release (not with online updates off, not in replays) and tell the page.
    async void CheckUpdate()
    {
        if (!settings.OnlineUpdates || replayDir != null) return;
        if (await Updater.Check(Version) is not { } info) return;
        update = info;
        PostUpdate();
    }

    // last own Daevanion boards from the game (sent again when the page reloads)
    Dictionary<int, uint[]>? daeBoards;
    Dictionary<int, int>? daePoints;
    void PostDaevanion()
    {
        if (uiReady && daeBoards != null) Post(new { type = "daeGame", boards = daeBoards.ToDictionary(b => b.Key.ToString(), b => b.Value) });
        if (uiReady && daePoints != null) Post(new { type = "daePoints", pools = daePoints.ToDictionary(p => p.Key.ToString(), p => p.Value) });
    }

    void PostUpdate()
    {
        if (uiReady && update is { } info) Post(new { type = "update", version = info.Version, page = info.Page, auto = Updater.CanSelfUpdate && info.Exe != null });
    }

    /// Update button: portable exe swaps itself and restarts, anything else opens the release page.
    async void ApplyUpdate()
    {
        if (update is not { } info) return;
        if (!Updater.CanSelfUpdate || info.Exe == null) { OpenExternal(info.Page); return; }
        try { await Updater.Apply(info.Exe); } // the new exe closes this one (single instance)
        catch (Exception e)
        {
            Log("Update fehlgeschlagen: " + e.Message);
            Post(new { type = "updateFailed" });
            OpenExternal(info.Page);
        }
    }

    static void OpenExternal(string url)
    {
        if (Uri.TryCreate(url, UriKind.Absolute, out var u) && u.Scheme == "https" && (u.Host.EndsWith("aion2maps.com") || u.Host is "npcap.com" or "www.npcap.com"
            || u.Host == "github.com" && u.AbsolutePath.StartsWith("/" + Updater.Repo + "/")))
            Process.Start(new ProcessStartInfo(u.ToString()) { UseShellExecute = true });
    }

    // ---------------------------------------------------------------- pet tracking

    void ApplyAchievements(List<(uint id, uint val, byte tier, long ts)> items, bool full)
    {
        if (full) state.Ach.Clear();
        foreach (var (id, val, tier, ts) in items) state.Ach[id] = [val, tier, ts];
        if (full) { Log($"Erfolge: {items.Count} Einträge"); state.Save(statePath); PostState(); }
        else
        {
            if (DateTime.UtcNow - lastPosSave > TimeSpan.FromSeconds(30)) { lastPosSave = DateTime.UtcNow; state.Save(statePath); }
            Post(new { type = "achUpd", items = items.Select(i => new long[] { i.id, i.val, i.tier, i.ts }) });
        }
    }

    // Every map load (login, teleport, instance) sends the full achievement list (0x8356), the entry limits (0x0b61)
    // and the counters ~8 s before the own character (0x3336). They are held until then: after a character switch
    // they belong to the new character, and the page would credit them to the old one. Without 0x3336 within 30 s
    // they are applied anyway.
    List<Action>? loginHeld;
    readonly System.Windows.Forms.Timer loginTimer = new() { Interval = 30_000 };
    string lastEntryLog = "";

    void StartLogin()
    {
        loginHeld ??= [];
        loginTimer.Stop();
        loginTimer.Start();
    }

    void HoldLogin(Action a)
    {
        if (loginHeld != null) loginHeld.Add(a); else a();
    }

    void ReleaseLogin()
    {
        loginTimer.Stop();
        var held = loginHeld;
        loginHeld = null;
        if (held != null) foreach (var a in held) a();
    }

    /// One 0x2ce3 match for the page; fields of an unexpected kind read as 0 / "".
    static object PvpMatch(JsonElement m)
    {
        static long Num(JsonElement o, string k) => o.ValueKind == JsonValueKind.Object && o.TryGetProperty(k, out var v)
            && v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var n) ? n : 0;
        static string Str(JsonElement o, string k) => o.ValueKind == JsonValueKind.Object && o.TryGetProperty(k, out var v)
            && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
        object[] members = m.ValueKind == JsonValueKind.Object && m.TryGetProperty("member", out var ms) && ms.ValueKind == JsonValueKind.Array
            ? ms.EnumerateArray().Select(x => (object)new { name = Str(x, "name"), srv = (int)Num(x, "server_id"), team = (int)Num(x, "team") }).ToArray()
            : [];
        return new { start = Num(m, "start_time"), cid = (int)Num(m, "contents_id"), win = (int)Num(m, "winning_team"), members };
    }

    void StartSource()
    {
        source?.Dispose();
        source = null;
        ReleaseLogin();
        if (replayDir != null) source = new ReplayCapture(replayDir, replaySpeed);
        else if (Manual)
        {
            SetStatus("manual", npcap ? L.T("Manueller Modus – Fortschritt von Hand", "Manual mode – progress by hand")
                                      : L.T("Manueller Modus – Npcap ist nicht installiert", "Manual mode – Npcap is not installed"));
            return;
        }
        else source = new LiveCapture(settings.ProcessName);
        source.StatusChanged += (s, t) => BeginInvoke(() => SetStatus(s, t));
        if (state.CharId != 0) source.OwnId = PetFrames.VarintBytes(state.CharId);
        source.CharNameReceived += name => BeginInvoke(() =>
        {
            if (name != null && state.CharName != name)
            {
                state.CharName = name;
                Log($"Charakter: {name}");
                state.Save(statePath);
                Post(new { type = "char", name });
                ReleaseLogin(); // the own character is known now: the lists held since the map load belong to it
                PostState();    // the page dropped the previous character's counters with "char"
            }
            else ReleaseLogin();
        });
        source.CharIdReceived += id => BeginInvoke(() =>
        {
            if (state.CharId != id) state.Pos = null;
            state.CharId = id;
            state.Save(statePath);
        });
        // Replay debugging: PETOVERLAY_POSLOG=<file> writes every own position as CSV, same columns as
        // tools/own_position_track.py --csv: unix ts, kind (fix | est), source opcode, x, z, height, sigma (metres).
        var posLog = Environment.GetEnvironmentVariable("PETOVERLAY_POSLOG");
        void LogPos(string kind, int op, float x, float z, float y, float sigma, DateTime ts)
        {
            if (posLog == null) return;
            double t = (ts - DateTime.UnixEpoch).TotalSeconds;
            File.AppendAllText(posLog, FormattableString.Invariant($"{t:F3},{kind},{(op != 0 ? $"0x{op:x4}" : "")},{x:F2},{z:F2},{y:F2},{sigma:F1}") + "\n");
        }
        source.PositionReceived += (x, z, y, ts, op) => BeginInvoke(() =>
        {
            LogPos("fix", op, x, z, y, 1, ts);
            state.Pos = new Position(x, z, y, ts);
            if (DateTime.UtcNow - lastPosSave > TimeSpan.FromSeconds(30)) { lastPosSave = DateTime.UtcNow; state.Save(statePath); }
            if (DateTime.UtcNow - lastPosPost < TimeSpan.FromMilliseconds(150)) return;
            lastPosPost = DateTime.UtcNow;
            Post(new { type = "pos", pos = state.Pos });
        });
        source.TrackedNpcs = trackedNpcs;
        WirePvp(source);
        WireBossMod(source);
        source.BossEvent += (npc, died) => BeginInvoke(() => Post(new { type = "boss", id = npc, died }));
        source.BossTable += (map, list) => BeginInvoke(() =>
            Post(new { type = "bossTable", map, list = list.Select(e => new object[] { e.id, e.alive, e.x, e.z, e.ts }) }));
        source.ObjectSpawned += (ent, env, x, z, y) => BeginInvoke(() => Post(new { type = "obj", ent, env, x, z, y }));
        source.ObjectRemoved += (ent, reason) => BeginInvoke(() => Post(new { type = "objGone", ent, reason }));
        source.MapChanged += id => BeginInvoke(() =>
        {
            state.MapId = id;
            Log($"Kartenwechsel: {id}");
            Post(new { type = "zone", id });
        });
        source.PvpHistoryReceived += matches => BeginInvoke(() =>
        {
            // only what the checklist needs: start, contents id, winning team, the members' names, servers and teams.
            // Projected here (not lazily inside Post) so a field of an unexpected kind cannot throw on the UI thread.
            object[] list;
            try { list = matches.Select(PvpMatch).ToArray(); }
            catch (Exception ex) { Log("PvP-Verlauf nicht lesbar: " + ex.Message); return; }
            HoldLogin(() =>
            {
                // own server (a real server id, not the faction guess): a namesake on another server does not count
                int ownSrv = pvpOwn is { } o && o.Name == state.CharName && o.Server % 1000 != 0 ? o.Server : 0;
                Post(new { type = "pvpHistory", ownSrv, matches = list });
            });
        });
        source.EntryChargesReceived += list => BeginInvoke(() =>
        {
            // sent with every map load: log only a changed list
            var line = string.Join(", ", list.Where(x => x.left > 0 || x.bonus > 0).Select(x => $"{x.id}={x.left}+{x.bonus}"));
            if (line != lastEntryLog) { lastEntryLog = line; Log("Eintrittslimits: " + line); }
            HoldLogin(() => Post(new { type = "entryCharges", list = list.Select(x => new[] { (long)x.id, x.left, x.bonus }).ToArray() }));
        });
        source.ChargeReceived += (id, left) => BeginInvoke(() =>
        {
            Log($"Ladungen: Inhalt {id} = {left}");
            HoldLogin(() => Post(new { type = "charge", id, left }));
        });
        source.MerchantReceived += (tab, items) => BeginInvoke(() =>
        {
            Log($"Händler (Tab {tab}): " + string.Join(", ", items.Select(i => $"Item {i.Item} {i.Price}/{i.Base}{(i.Sold ? " sold" : i.Count != 1 ? $" x{i.Count}" : "")}")));
            Post(new { type = "merchant", tab, at = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                items = items.Select(i => new { item = i.Item, count = i.Count, tier = i.Tier, @base = i.Base, price = i.Price, sold = i.Sold }) });
        });
        source.DaeNodeFrame += (op, body, ids) => BeginInvoke(() =>
        {
            var line = $"{DateTime.Now:HH:mm:ss.fff} op 0x{op:x4} len {body.Length} ids {string.Join(",", ids)} | {Convert.ToHexString(body.AsSpan(0, Math.Min(body.Length, 600)))}";
            try { File.AppendAllText(Path.Combine(Settings.DataDir, "daevanion-packets.log"), line + "\n"); } catch { }
            Post(new { type = "daeLogHit", op = $"0x{op:x4}", ids, at = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() });
        });
        // research capture (all frames but the high-rate ones, with bodies): on while research.on exists in the data
        // folder, live capture only (a replay would write its old frames into the log again)
        source.Research = source is LiveCapture && File.Exists(Path.Combine(Settings.DataDir, "research.on"));
        source.ResearchFrame += (op, body, ts) => Research($"{ts.ToLocalTime():HH:mm:ss.fff} op 0x{op:x4} len {body.Length} | {Convert.ToHexString(body.AsSpan(0, Math.Min(body.Length, 4000)))}");
        // opcode timeline (no bodies) next to the board detection's found / gone, buffered, at most 30 MB
        source.DaeOpFrame += (op, len) => DaeOps($"{DateTime.Now:HH:mm:ss.fff} op 0x{op:x4} len {len}");
        source.DaeLoginFrames += frames =>
        {
            var lines = frames.Select(f => $"{f.ts.ToLocalTime():HH:mm:ss.fff} op 0x{f.op:x4} len {f.body.Length} | {Convert.ToHexString(f.body.AsSpan(0, Math.Min(f.body.Length, 60000)))}");
            try { File.WriteAllLines(Path.Combine(Settings.DataDir, "daevanion-login.log"), lines); } catch { }
            BeginInvoke(() => Log($"Daevanion: Login-Mitschnitt ({frames.Count} Pakete) gespeichert"));
        };
        source.DaevanionPoints += pts => BeginInvoke(() =>
        {
            daePoints = pts;
            Post(new { type = "daePoints", pools = pts.ToDictionary(p => p.Key.ToString(), p => p.Value) });
        });
        source.DaevanionChanged += (bought, reset) => BeginInvoke(() =>
        {
            Log($"Daevanion: gekauft {string.Join(",", bought)} zurückgesetzt {string.Join(",", reset)}");
            // keep the login boards current (sent again when the page reloads)
            if (daeBoards != null)
                foreach (var id in bought.Concat(reset))
                {
                    int b = (int)(id / 10000);
                    var set = (daeBoards.TryGetValue(b, out var cur) ? cur : []).ToHashSet();
                    if (bought.Contains(id)) set.Add(id); else set.Remove(id);
                    daeBoards[b] = set.ToArray();
                }
            Post(new { type = "daeNodes", bought, reset });
        });
        source.DaevanionReceived += boards => BeginInvoke(() =>
        {
            Log("Daevanion: " + string.Join(", ", boards.Select(b => $"Brett {b.Key} {b.Value.Length} offen")));
            daeBoards = boards;
            PostDaevanion();
        });
        source.OdyleReceived += (energy, bonus) => BeginInvoke(() =>
        {
            Log($"Odyle-Energie: {energy} + {bonus} Bonus");
            HoldLogin(() => Post(new { type = "odyle", energy, bonus }));
        });
        source.UsageReceived += (usage, at) => BeginInvoke(() => HoldLogin(() =>
        {
            state.Usage = usage; state.UsageAt = at;
            Log("Wochen-Verbrauch: " + string.Join(", ", usage.Select(u => $"{u.Key}={u.Value}")));
            state.Save(statePath); PostState();
        }));
        source.AchievementsReceived += (items, full) => BeginInvoke(() =>
        {
            if (full) StartLogin();
            HoldLogin(() => ApplyAchievements(items, full));
        });
        source.PositionEstimated += (x, z, y, sigma, ts) => BeginInvoke(() =>
        {
            LogPos("est", 0, x, z, y, sigma, ts);
            // Spawn-centroid estimate: only after 20 s without a real fix, at most once per second (Capture.OnSpawn).
            state.Pos = new Position(x, z, y, ts, true, MathF.Round(sigma, 1));
            Post(new { type = "pos", pos = state.Pos });
        });
        source.PetListReceived += (list, ts) => BeginInvoke(() =>
        {
            state.Apply(list, ts);
            Log($"Login-Daten: {list.Levels.Count} Pets freigeschaltet, {list.Souls.Count} Seelen-Zähler");
            StateChanged();
        });
        source.SoulsReceived += (pet, gained, ts) => BeginInvoke(() =>
        {
            if (state.SyncedAt == null && state.Levels.Count == 0) return; // no baseline yet: a delta alone means nothing
            var ev = state.Gain(pet, gained, ts);
            Log($"+{gained} Seele Pet {pet} -> Lv{ev.Level} {ev.Souls}/{ev.Need}{(ev.LevelUp ? " LEVEL-UP" : "")}");
            Post(new { type = "soul", ev });
            StateChanged();
        });
        source.Start();
    }

    // Overlay: back on top of the game. Window mode: a normal window, no forced top-most.
    void BringUp() { if (!windowMode) Native.KeepOnTop(Handle); }

    // ---------------------------------------------------------------- overlay vs. normal window

    bool DecideWindowMode() => settings.Dock switch
    {
        "window" => true,
        "overlay" => false,
        _ => Native.MainWindowOf(settings.ProcessName) is var g && (g == IntPtr.Zero || Screen.FromHandle(g).DeviceName != Screen.FromRectangle(Bounds).DeviceName),
    };

    /// Switch between overlay and normal window in place (styles + top-most), e.g. after moving to another monitor.
    void ApplyWindowMode()
    {
        if (!IsHandleCreated || Capture || MouseButtons != MouseButtons.None) return; // not in the middle of a drag
        bool w = DecideWindowMode();
        if (w == windowMode) return;
        if (!w && WindowState != FormWindowState.Normal) WindowState = FormWindowState.Normal;
        windowMode = w;
        bool vis = Visible;
        if (vis) Hide(); // the taskbar picks up the APPWINDOW change only on show
        Opacity = w ? 1.0 : settings.Opacity; // also toggles the layered style
        UpdateStyles();
        TopMost = !w;
        if (vis) { Show(); BringUp(); }
        Log(w ? "Fenster-Modus" : "Overlay-Modus");
        PostDock();
    }
    void PostDock() => Post(new { type = "dock", dock = settings.Dock, window = windowMode });

    bool OnGameScreen()
    {
        var game = Native.MainWindowOf(settings.ProcessName);
        return game == IntPtr.Zero || Screen.FromHandle(game).DeviceName == Screen.FromControl(this).DeviceName;
    }

    void SetStatus(string s, string text)
    {
        if (status != (s, text)) Log($"Status: {s} – {text}");
        status = (s, text);
        Post(new { type = "status", state = s, text });
        tray.Text = Truncate($"The Completionist – {text}", 63);
    }

    void StateChanged()
    {
        state.Save(statePath);
        PostState();
        SyncSite();
    }

    void PickStatePath()
    {
        if (replayDir != null) return;
        using var dlg = new SaveFileDialog
        {
            Title = L.T("Speicherort für den Pet-Status", "Location of the pet status file"), Filter = "JSON (*.json)|*.json", FileName = Path.GetFileName(settings.EffectiveStatePath),
            InitialDirectory = Path.GetDirectoryName(settings.EffectiveStatePath), OverwritePrompt = false,
        };
        if (dlg.ShowDialog(this) != DialogResult.OK) return;
        settings.StatePath = statePath = dlg.FileName;
        SaveSettings();
        if (PetState.Load(statePath) is { } loaded) state = loaded;
        else state.Save(statePath);
        PostState();
        Post(new { type = "settings", settings = SettingsView() });
    }

    static readonly object logLock = new();
    static readonly object bossLogLock = new();
    static readonly System.Text.StringBuilder bossLog = new();
    static DateTime bossLogFlush = DateTime.UtcNow;
    /// Boss mod learning log (boss-casts.log): appended in batches, stops at 50 MB; null flushes (exit).
    internal static void BossLog(string? line)
    {
        lock (bossLogLock)
        {
            if (line != null) bossLog.Append(line).Append('\n');
            if (bossLog.Length == 0 || line != null && bossLog.Length < 64_000 && DateTime.UtcNow - bossLogFlush < TimeSpan.FromSeconds(2)) return;
            bossLogFlush = DateTime.UtcNow;
            try
            {
                var f = Path.Combine(Settings.DataDir, "boss-casts.log");
                if (!File.Exists(f) || new FileInfo(f).Length < 50_000_000) File.AppendAllText(f, bossLog.ToString());
            }
            catch { }
            bossLog.Clear();
        }
    }

    // Also called from the capture threads (Capture.cs: adapter, diagnosis).
    static readonly object daeOpsLock = new();
    static readonly System.Text.StringBuilder daeOps = new();
    static DateTime daeOpsFlush = DateTime.UtcNow;
    static readonly object researchLock = new();
    static readonly System.Text.StringBuilder research = new();
    static DateTime researchFlush = DateTime.UtcNow;
    /// Research capture (research-packets.log): appended in batches, stops at 200 MB.
    internal static void Research(string? line)
    {
        lock (researchLock)
        {
            if (line != null) research.Append(line).AppendLine(); // null: flush now (exit)
            if (research.Length == 0 || line != null && research.Length < 64_000 && DateTime.UtcNow - researchFlush < TimeSpan.FromSeconds(1)) return;
            researchFlush = DateTime.UtcNow;
            try
            {
                var f = Path.Combine(Settings.DataDir, "research-packets.log");
                if (!File.Exists(f) || new FileInfo(f).Length < 200_000_000) File.AppendAllText(f, research.ToString());
            }
            catch { }
            research.Clear();
        }
    }

    /// Daevanion research timeline (daevanion-ops.log): appended in batches, stops at 30 MB.
    internal static void DaeOps(string line)
    {
        lock (daeOpsLock)
        {
            daeOps.Append(line).Append('\n');
            if (daeOps.Length < 64_000 && DateTime.UtcNow - daeOpsFlush < TimeSpan.FromSeconds(2)) return;
            daeOpsFlush = DateTime.UtcNow;
            try
            {
                var f = Path.Combine(Settings.DataDir, "daevanion-ops.log");
                if (!File.Exists(f) || new FileInfo(f).Length < 30_000_000) File.AppendAllText(f, daeOps.ToString());
            }
            catch { }
            daeOps.Clear();
        }
    }

    internal static void Log(string line)
    {
        lock (logLock)
            try { File.AppendAllText(Path.Combine(Settings.DataDir, "log.txt"), $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {line}\n"); }
            catch { }
    }

    // ---------------------------------------------------------------- aion2maps view

    // Keeps the site's own "pets complete" list (localStorage vox.petdone, per store) in step with the
    // tracked Lv3 pets, shows our soul progress next to its pet buttons, and reports its Hidden Cube ticks.
    const string SiteScript = """
        (() => {
          if (window.__a2po) return;
          const store = (new URLSearchParams(location.search).get('store') || '').replace(/[^\w-]/g, '').slice(0, 32);
          const SK = k => store ? `${k}@${store}` : k;
          const need = l => [5, 25, 75][l] || 0;
          let data = null, timer = 0;
          const badges = () => {
            if (!data) return;
            for (const b of document.querySelectorAll('button.pdone[data-pdone]')) {
              const id = b.dataset.pdone, lv = data.levels[id] || 0, s = data.souls[id] || 0;
              let el = b.previousElementSibling;
              if (!el || !el.classList.contains('a2po-lv')) { el = document.createElement('span'); el.className = 'a2po-lv'; b.before(el); }
              const t = lv >= 3 ? 'Lv3 ✓' : `Lv${lv} ${s}/${need(lv)}`;
              if (el.textContent !== t) { el.textContent = t; el.title = 'The Completionist: dein Fortschritt'; el.dataset.lv = lv; }
            }
          };
          window.__a2po = {
            update(d) {
              data = d;
              const key = SK('vox.petdone');
              let cur = [];
              try { const v = JSON.parse(localStorage.getItem(key) || '[]'); if (Array.isArray(v)) cur = v.map(Number); } catch {}
              const merged = [...new Set([...cur, ...d.done])];
              if (merged.length !== cur.length) {
                try { localStorage.setItem(key, JSON.stringify(merged)); } catch {}
                dispatchEvent(new Event('vox-pets'));
              }
              badges();
              return merged.length;
            },
            search(q) {
              const i = document.querySelector('input[type=search], input[placeholder*="monster" i]');
              if (!i) return false;
              i.focus(); i.value = q;
              i.dispatchEvent(new Event('input', { bubbles: true }));
              for (const t of ['keydown', 'keyup']) i.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
              return true;
            },
          };
          const start = () => {
            const st = document.createElement('style');
            st.textContent = '.a2po-lv{font:600 11px/1 system-ui;padding:3px 6px;margin:auto 4px;border-radius:9px;background:#2a2340;color:#e8c872;white-space:nowrap;align-self:center}.a2po-lv[data-lv="0"]{color:#9fb3c8;background:#1d2a38}.a2po-lv[data-lv="3"]{color:#7ee0a0;background:#173226}';
            document.head.appendChild(st);
            new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(badges, 120); })
              .observe(document.body, { childList: true, subtree: true });
            // Read-only: Hidden Cubes ticked on the site (vt-done keys "hc:<spawner>", map prefix except Verteron).
            const cubes = {};
            try {
              for (const k of JSON.parse(localStorage.getItem(SK('vt-done')) || '[]')) {
                const m = /^([A-Za-z]\w*_\w+):(.*)$/.exec(k), map = m ? m[1] : 'World_L_A', rest = m ? m[2] : k;
                if (rest.startsWith('hc:')) (cubes[map] ||= []).push(rest.slice(3));
              }
            } catch {}
            window.chrome.webview.postMessage({ type: 'a2po-ready', cubes });
          };
          document.readyState === 'loading' ? addEventListener('DOMContentLoaded', start) : start();
        })();
        """;

    async void SetSiteMode(bool on, string? map, string? search)
    {
        if (on && site == null)
        {
            site = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Bg, Visible = false };
            Controls.Add(site);
            site.BringToFront();
            await site.EnsureCoreWebView2Async(ui.CoreWebView2.Environment);
            site.CoreWebView2.Settings.AreDevToolsEnabled = false;
            site.CoreWebView2.NewWindowRequested += (_, a) => { a.Handled = true; OpenExternal(a.Uri); };
            site.CoreWebView2.WebMessageReceived += (_, a) =>
            {
                if (!a.Source.StartsWith("https://aion2maps.com/")) return;
                try
                {
                    var msg = JsonNode.Parse(a.WebMessageAsJson);
                    if ((string?)msg?["type"] != "a2po-ready") return;
                    SyncSite();
                    Post(new { type = "siteCubes", cubes = msg["cubes"] });
                }
                catch { }
            };
            await site.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(SiteScript);
        }
        if (site == null) return;

        siteMode = on;
        UpdateStyles();
        if (on)
        {
            var url = $"https://aion2maps.com/map/?map={Uri.EscapeDataString(map ?? "World_D_A")}";
            if (site.Source == null || !site.Source.ToString().Contains("map=" + map)) site.CoreWebView2.Navigate(url);
            ui.Dock = DockStyle.Top;
            ui.Height = (int)(38 * ui.ZoomFactor * DpiScale);
            site.Visible = true;
            if (!string.IsNullOrEmpty(search)) _ = SiteSearch(search);
        }
        else
        {
            site.Visible = false;
            ui.Dock = DockStyle.Fill;
        }
        Post(new { type = "siteMode", on });
    }

    async Task SiteSearch(string q)
    {
        for (int i = 0; i < 40 && site != null; i++)
        {
            await Task.Delay(500);
            var r = await site.CoreWebView2.ExecuteScriptAsync($"window.__a2po ? __a2po.search({JsonSerializer.Serialize(q)}) : false");
            if (r == "true") return;
        }
    }

    async void SyncSite()
    {
        if (site?.CoreWebView2 == null) return;
        var done = state.Levels.Where(kv => kv.Value >= 3).Select(kv => kv.Key).ToArray();
        var levels = state.Levels.ToDictionary(kv => kv.Key.ToString(), kv => kv.Value);
        var souls = state.Souls.ToDictionary(kv => kv.Key.ToString(), kv => kv.Value);
        var json = JsonSerializer.Serialize(new { done, levels, souls });
        var r = await site.CoreWebView2.ExecuteScriptAsync($"window.__a2po ? __a2po.update({json}) : -1");
        Log($"aion2maps-Sync: {done.Length} Pets auf Lv3, vox.petdone enthält jetzt {r}");
    }

    // ---------------------------------------------------------------- window behaviour

    void BuildTray()
    {
        tray.Icon = Icon;
        tray.Text = "The Completionist";
        tray.Visible = true;
        BuildTrayMenu();
        tray.MouseClick += (_, e) => { if (e.Button == MouseButtons.Left) ToggleVisible(); };
    }

    void BuildTrayMenu()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add(L.T("Ein-/Ausblenden", "Show / hide"), null, (_, _) => ToggleVisible());
        menu.Items.Add(L.T("Click-through umschalten", "Toggle click-through"), null, (_, _) => ToggleClickThrough());
        menu.Items.Add(L.T("Position zurücksetzen", "Reset position"), null, (_, _) =>
        {
            var wa = Screen.PrimaryScreen!.WorkingArea;
            Location = new Point(wa.Right - Width - (int)(24 * DpiScale), wa.Top + (int)(80 * DpiScale));
            if (!Visible) ToggleVisible();
            if (clickThrough) ToggleClickThrough();
        });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(L.T("Beenden", "Quit"), null, (_, _) => Close());
        // Without this the menu can open behind the taskbar, since the overlay never activates.
        menu.Opened += (_, _) => Native.KeepOnTop(menu.Handle);
        var old = tray.ContextMenuStrip;
        tray.ContextMenuStrip = menu;
        old?.Dispose();
    }

    void RegisterHotkeys()
    {
        for (int i = 0; i < hotkeyIds.Length; i++)
        {
            Native.UnregisterHotKey(Handle, i + 1);
            var combo = settings.Hotkeys.GetValueOrDefault(hotkeyIds[i], "");
            hotkeyOk[hotkeyIds[i]] = string.IsNullOrEmpty(combo) ||
                (Native.TryParseHotkey(combo, out var mods, out var vk) && Native.RegisterHotKey(Handle, i + 1, mods, vk));
        }
    }

    void OnHotkey(string id)
    {
        switch (id)
        {
            case "toggle": ToggleVisible(); break;
            case "click": ToggleClickThrough(); break;
            case "site": SetSiteMode(!siteMode, (string?)settings.Ui["map"], null); break;
            case "radar":
                if (siteMode) SetSiteMode(false, null, null);
                if (!Visible) ToggleVisible();
                Post(new { type = "radar" });
                break;
            case "radarLock": ToggleRadarLock(); break;
            case "pvp": ShowPvp(!settings.PvpOn); break;
            case "winEdit": SetWinEdit(!winEdit); break;
            case "bossMark": BossMark(); break;
            case "opaUp": ChangeOpacity(0.05); break;
            case "opaDown": ChangeOpacity(-0.05); break;
            case "zoomIn": ChangeZoom(0.1); break;
            case "zoomOut": ChangeZoom(-0.1); break;
        }
    }

    void ToggleVisible()
    {
        if (Visible) Hide();
        else { Show(); BringUp(); }
        autoShown = false;
        settings.Visible = Visible;
        SaveSoon();
    }

    void ToggleClickThrough()
    {
        clickThrough = !clickThrough;
        ctHeader = false;
        ctTimer.Enabled = clickThrough;
        BackColor = clickThrough ? BgClickThrough : Bg;
        UpdateStyles();
        Post(new { type = "clickThrough", on = clickThrough });
    }

    void ChangeOpacity(double delta)
    {
        settings.Opacity = Math.Clamp(settings.Opacity + delta, 0.3, 1.0);
        if (!windowMode) Opacity = settings.Opacity;
        Post(new { type = "opacity", v = settings.Opacity });
        SaveSoon();
    }

    void ChangeZoom(double delta)
    {
        ui.ZoomFactor = settings.Zoom = Math.Clamp(Math.Round(settings.Zoom + delta, 2), 0.6, 2.0);
        Post(new { type = "zoom", v = settings.Zoom });
        SaveSoon();
    }

    const int WS_CAPTION = 0x00C00000, WS_THICKFRAME = 0x00040000, WS_SYSMENU = 0x00080000, WS_MINIMIZEBOX = 0x00020000, WS_MAXIMIZEBOX = 0x00010000;
    const int WM_NCCALCSIZE = 0x0083, WS_EX_APPWINDOW = 0x00040000;

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_NCCALCSIZE && WindowMode && m.WParam != IntPtr.Zero)
        {
            // No title bar, but keep the (invisible) resize borders outside the content: Windows doesn't draw
            // anything there, so content under them would let the desktop show through. DWM then draws the thin
            // native border and shadow. Maximized windows overhang the screen by that border on all sides.
            var r = Marshal.PtrToStructure<Native.RECT>(m.LParam);
            var (fx, fy) = Native.ResizeBorder(Handle);
            r.Left += fx; r.Right -= fx; r.Bottom -= fy;
            if (WindowState == FormWindowState.Maximized) r.Top += fy;
            Marshal.StructureToPtr(r, m.LParam, false);
            m.Result = IntPtr.Zero;
            return;
        }
        if (m.Msg == Native.WM_HOTKEY)
        {
            int i = (int)m.WParam - 1;
            if (i >= 0 && i < hotkeyIds.Length) OnHotkey(hotkeyIds[i]);
            return;
        }

        base.WndProc(ref m);

        // Resize via the thin border around the WebView.
        if (m.Msg == Native.WM_NCHITTEST && (int)m.Result == 1)
        {
            var p = PointToClient(new Point((short)(m.LParam.ToInt64() & 0xFFFF), (short)((m.LParam.ToInt64() >> 16) & 0xFFFF)));
            // Only uncovered form area reaches here (the frame, or a strip the page has not painted yet while resizing):
            // anything near an edge resizes instead of moving the window.
            int e = Math.Max(Grip, (int)(14 * DpiScale));
            bool l = p.X < e, r = p.X >= ClientSize.Width - e, t = p.Y < Grip, b = p.Y >= ClientSize.Height - Math.Max(GripBottom, e);
            // The bar's right end is the corner grip, a comfortable target for both directions.
            if (b && p.X >= ClientSize.Width - (int)(40 * DpiScale)) r = true;
            m.Result = (IntPtr)((t, b, l, r) switch
            {
                (true, _, true, _) => Native.HTTOPLEFT,
                (true, _, _, true) => Native.HTTOPRIGHT,
                (_, true, true, _) => Native.HTBOTTOMLEFT,
                (_, true, _, true) => Native.HTBOTTOMRIGHT,
                (true, _, _, _) => Native.HTTOP,
                (_, true, _, _) => Native.HTBOTTOM,
                (_, _, true, _) => Native.HTLEFT,
                (_, _, _, true) => Native.HTRIGHT,
                _ => Native.HTCAPTION,
            });
        }
    }

    // Grip bar under the page: a short centred handle, so the resize edge is visible.
    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        var g = e.Graphics;
        g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        using var b = new SolidBrush(Color.FromArgb(95, 105, 125));
        int y = ClientSize.Height - GripBottom / 2 - 1, w = (int)(36 * DpiScale);
        g.FillRectangle(b, (ClientSize.Width - w) / 2, y - 1, w, 2);
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        Invalidate(new Rectangle(0, ClientSize.Height - GripBottom, ClientSize.Width, GripBottom));
    }

    protected override void OnResizeEnd(EventArgs e)
    {
        base.OnResizeEnd(e);
        if (WindowState == FormWindowState.Normal) KeepOnScreen();
        SaveSoon();
        BeginInvoke(ApplyWindowMode); // moved to / away from the game's monitor
    }

    // The whole window stays inside its monitor's work area: an edge pushed off-screen can no longer be grabbed.
    void KeepOnScreen()
    {
        var wa = Screen.FromControl(this).WorkingArea;
        int w = Math.Min(Width, wa.Width), h = Math.Min(Height, wa.Height);
        int x = Math.Clamp(Left, wa.Left, wa.Right - w), y = Math.Clamp(Top, wa.Top, wa.Bottom - h);
        if (x != Left || y != Top || w != Width || h != Height) Bounds = new Rectangle(x, y, w, h);
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        saveTimer.Stop();
        SaveSettings();
        source?.Dispose();
        Research(null);
        BossLog(null);
        recorder.Stop();
        if (state.Pos != null) state.Save(statePath);
        for (int i = 0; i < hotkeyIds.Length; i++) Native.UnregisterHotKey(Handle, i + 1);
        tray.Visible = false;
        tray.Dispose();
        base.OnFormClosing(e);
    }

    static string Truncate(string s, int n) => s.Length > n ? s[..n] : s;

    // Gold paw on a dark rounded square, drawn so no .ico file is needed.
    static Icon PawIcon()
    {
        using var bmp = new Bitmap(32, 32);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            using var bg = new SolidBrush(Color.FromArgb(30, 26, 44));
            using var path = new System.Drawing.Drawing2D.GraphicsPath();
            path.AddArc(0, 0, 12, 12, 180, 90); path.AddArc(19, 0, 12, 12, 270, 90);
            path.AddArc(19, 19, 12, 12, 0, 90); path.AddArc(0, 19, 12, 12, 90, 90);
            g.FillPath(bg, path);
            using var gold = new SolidBrush(Color.FromArgb(240, 200, 100));
            g.FillEllipse(gold, 9, 15, 14, 11);
            g.FillEllipse(gold, 5, 9, 6, 7); g.FillEllipse(gold, 11, 4, 6, 8);
            g.FillEllipse(gold, 17, 4, 6, 8); g.FillEllipse(gold, 22, 9, 6, 7);
        }
        return Icon.FromHandle(bmp.GetHicon());
    }
}
