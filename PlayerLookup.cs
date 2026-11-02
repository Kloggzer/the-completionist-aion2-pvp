using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace PetOverlay;

// PvP overlay fallback when a player's spawn frame carried no combat power / item level (or for arena roster entries
// not in range yet): NCSOFT's public character website, the same two requests as the public build's character lookup
// (web/src/features/progress/plaync.ts): search by name -> exact name + server -> characterId -> detail (CP, class,
// item level). Only https to api-search.plaync.com / aion2.plaync.com, 15 s timeout, at most 2 requests at a time and
// ~4 per second. Results (also "not found") are cached in memory and in cache/plaync_players.json for 6 hours.
static partial class PlayerLookup
{
    public sealed record Info(bool Found, int Cp, int ItemLevel, string Cls, long At);

    static readonly TimeSpan Ttl = TimeSpan.FromHours(6), RetryAfterError = TimeSpan.FromMinutes(2);
    static readonly HttpClient http = new(new HttpClientHandler { AutomaticDecompression = System.Net.DecompressionMethods.All }) { Timeout = TimeSpan.FromSeconds(15) };
    static readonly SemaphoreSlim gate = new(2, 2);
    static readonly object sync = new();
    static readonly Dictionary<string, Task<Info?>> running = new();
    static readonly Dictionary<string, DateTime> failed = new();
    static Dictionary<string, Info>? cache;
    static DateTime nextSlot;
    static string CachePath => Path.Combine(GameData.CacheDir, "plaync_players.json");

    static PlayerLookup() =>
        http.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64) TheCompletionist/1.0");

    public static string Key(string name, int server) => $"{name}@{server}";

    /// NA-East servers are x1xx (1101.., 2101..), Europe x3xx.
    public static string Region(int server) => server / 100 % 10 == 1 ? "nae" : "eu";

    [GeneratedRegex("<[^>]*>")]
    private static partial Regex Tags();

    static Dictionary<string, Info> Cache()
    {
        if (cache != null) return cache;
        try { cache = File.Exists(CachePath) ? JsonSerializer.Deserialize<Dictionary<string, Info>>(File.ReadAllText(CachePath)) : null; }
        catch { }
        return cache ??= new();
    }

    static bool Fresh(Info i) => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - i.At < Ttl.TotalMilliseconds;

    /// Cached result if still fresh.
    public static Info? Cached(string name, int server)
    {
        lock (sync) return Cache().TryGetValue(Key(name, server), out var i) && Fresh(i) ? i : null;
    }

    /// Cached or fetched info; null = offline / error (retried after 2 minutes). Never throws, never blocks the caller.
    public static Task<Info?> Get(string name, int server)
    {
        var key = Key(name, server);
        lock (sync)
        {
            if (Cache().TryGetValue(key, out var hit) && Fresh(hit)) return Task.FromResult<Info?>(hit);
            if (running.TryGetValue(key, out var t)) return t;
            if (!GameData.Online || server == 0 || failed.TryGetValue(key, out var f) && DateTime.UtcNow - f < RetryAfterError)
                return Task.FromResult<Info?>(null);
            t = Task.Run(() => Fetch(name, server));
            running[key] = t;
            t.ContinueWith(r =>
            {
                lock (sync)
                {
                    running.Remove(key);
                    if (r.Result is { } info) { Cache()[key] = info; Save(); }
                    else failed[key] = DateTime.UtcNow;
                }
            });
            return t;
        }
    }

    static void Save()
    {
        try
        {
            Directory.CreateDirectory(GameData.CacheDir);
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var keep = Cache().Where(e => now - e.Value.At < Ttl.TotalMilliseconds * 4).ToDictionary();
            File.WriteAllText(CachePath + ".tmp", JsonSerializer.Serialize(keep));
            File.Move(CachePath + ".tmp", CachePath, true);
        }
        catch { }
    }

    static async Task<Info?> Fetch(string name, int server)
    {
        await gate.WaitAsync();
        try
        {
            TimeSpan wait;
            lock (sync)
            {
                var now = DateTime.UtcNow;
                if (nextSlot < now) nextSlot = now;
                wait = nextSlot - now;
                nextSlot += TimeSpan.FromMilliseconds(260);
            }
            if (wait > TimeSpan.Zero) await Task.Delay(wait);
            var region = Region(server);
            var search = await GetJson($"https://api-search.plaync.com/aion2global/search/v2/character?keyword={Uri.EscapeDataString(name)}&region={region}&localeInfo=en-US&size=50");
            if (search == null) return null;
            var hit = (search["list"] as JsonArray ?? []).FirstOrDefault(x =>
                x?["characterId"] != null && Tags().Replace((string?)x["name"] ?? "", "").Trim() == name && (int?)x["serverId"] == server);
            long at = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (hit == null) return new Info(false, 0, 0, "", at);
            // characterId comes URL-encoded from the search and goes into the detail URL as is
            var d = await GetJson($"https://aion2.plaync.com/api/character/info?lang=en-US&characterId={(string?)hit["characterId"]}&serverId={server}&region={region}");
            if (d == null) return null;
            var p = d["profile"];
            int il = (d["stat"]?["statList"] as JsonArray ?? []).Where(s => (string?)s?["type"] == "ItemLevel").Select(s => (int?)s?["value"] ?? 0).FirstOrDefault();
            int cp = (int?)p?["combatPower"] ?? 0;
            return new Info(cp > 0 || il > 0, cp, il, (string?)p?["className"] ?? "", at);
        }
        catch { return null; }
        finally { gate.Release(); }
    }

    /// <summary>Raw website answer for the UI (Daevanion boards, web/src/features/daevanion/source.ts): status + body,
    /// the same two hosts only; (0, null) on errors.</summary>
    public static async Task<(int Status, string? Body)> Raw(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var u) || u.Scheme != Uri.UriSchemeHttps
            || u.Host is not ("api-search.plaync.com" or "aion2.plaync.com")) return (0, null);
        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
            using var r = await http.GetAsync(u, cts.Token);
            if (!r.IsSuccessStatusCode) OverlayForm.Log($"PLAYNC HTTP {(int)r.StatusCode}: {u.AbsolutePath}");
            return ((int)r.StatusCode, await r.Content.ReadAsStringAsync(cts.Token));
        }
        catch (Exception e)
        {
            OverlayForm.Log($"PLAYNC {u.AbsolutePath}: {e.GetType().Name} {e.Message}");
            return (0, null);
        }
    }

    static async Task<JsonNode?> GetJson(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var u) || u.Scheme != Uri.UriSchemeHttps
            || u.Host is not ("api-search.plaync.com" or "aion2.plaync.com")) return null;
        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
            using var r = await http.GetAsync(u, cts.Token);
            if (!r.IsSuccessStatusCode) return null;
            return JsonNode.Parse(await r.Content.ReadAsStringAsync(cts.Token));
        }
        catch { return null; }
    }
}
