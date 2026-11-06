using System.Security.Cryptography;
using System.Text;

namespace PetOverlay;

// Market prices for the Markt page (web/src/features/market): a narrow GET proxy to aion2.exchange (unofficial, behind
// Cloudflare, no documented API terms): only https://aion2.exchange/api/servers, /api/items?... (the list of one server)
// and /api/items/<key>/prices?... (one item's history), one request at a time and at most one per second, an honest user
// agent, 15 s timeout. Answers are cached on disk (cache/market/): the list for 10 minutes, a history for an hour; a
// failed request answers with the last cached copy if there is one (status 200 and its age).
static class MarketLookup
{
    static readonly HttpClient http = new(new HttpClientHandler { AutomaticDecompression = System.Net.DecompressionMethods.All })
    {
        Timeout = TimeSpan.FromSeconds(15),
        DefaultRequestHeaders = { { "User-Agent", "TheCompletionist (Aion 2 companion app; market prices for the skins page)" } },
    };
    static readonly SemaphoreSlim gate = new(1, 1);
    static DateTime last = DateTime.MinValue;
    static string Dir => Path.Combine(GameData.CacheDir, "market");

    /// Allowed paths only: /api/servers, /api/items?server=N[&...] and /api/items/<digits>/prices?server=N[&...].
    static bool Allowed(string path) => path == "/api/servers" ||
        System.Text.RegularExpressions.Regex.IsMatch(path, @"^/api/items(/\d+/prices)?\?server=\d+(&[A-Za-z_]+=[\w:.\-]*)*$");

    /// <summary>(status, body, age of the answer in seconds); (0, null, 0) if not allowed or nothing could be had.</summary>
    public static async Task<(int Status, string? Body, double Age)> Get(string path)
    {
        if (!Allowed(path)) return (0, null, 0);
        var ttl = path == "/api/servers" ? TimeSpan.FromDays(1) : path.Contains("/prices") ? TimeSpan.FromHours(1) : TimeSpan.FromMinutes(10);
        var file = Path.Combine(Dir, Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(path)))[..16] + ".json");
        (string body, DateTime at)? cached = null;
        try { if (File.Exists(file)) cached = (await File.ReadAllTextAsync(file), File.GetLastWriteTimeUtc(file)); } catch { }
        if (cached is { } c && DateTime.UtcNow - c.at < ttl) return (200, c.body, (DateTime.UtcNow - c.at).TotalSeconds);
        await gate.WaitAsync();
        try
        {
            var wait = last.AddSeconds(1) - DateTime.UtcNow;
            if (wait > TimeSpan.Zero) await Task.Delay(wait);
            last = DateTime.UtcNow;
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
            using var r = await http.GetAsync("https://aion2.exchange" + path, cts.Token);
            var body = await r.Content.ReadAsStringAsync(cts.Token);
            if (r.IsSuccessStatusCode)
            {
                try { Directory.CreateDirectory(Dir); await File.WriteAllTextAsync(file, body); } catch { }
                return (200, body, 0);
            }
            OverlayForm.Log($"Markt HTTP {(int)r.StatusCode}: {path}");
            return cached is { } s ? (200, s.body, (DateTime.UtcNow - s.at).TotalSeconds) : ((int)r.StatusCode, null, 0);
        }
        catch (Exception e)
        {
            OverlayForm.Log($"Markt {path}: {e.GetType().Name} {e.Message}");
            return cached is { } s ? (200, s.body, (DateTime.UtcNow - s.at).TotalSeconds) : (0, null, 0);
        }
        finally { gate.Release(); }
    }
}
