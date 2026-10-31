using System.Diagnostics;
using System.Text.Json.Nodes;

namespace PetOverlay;

// Update check against the PvP edition's GitHub releases (tag vX.Y.Z-pvp, asset TheCompletionist.exe). The portable
// single-file exe updates itself: download next to it, rename the running exe (Windows allows that), move the new one
// into place and start it; the single-instance mutex then closes this one (Program.cs). Other builds (publish folder,
// installer under Program Files, dev builds) only get the notice with the release page.
static class Updater
{
    public const string Repo = "Kloggzer/the-completionist-aion2-pvp";
    const string Asset = "TheCompletionist.exe";
    static readonly HttpClient http = CreateHttp();

    static HttpClient CreateHttp()
    {
        var h = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
        h.DefaultRequestHeaders.UserAgent.ParseAdd("TheCompletionist-Updater");
        return h;
    }

    /// Newer release than `current`: its version, release page and exe download (null = none attached).
    public record Info(string Version, string Page, string? Exe);

    /// The newest release if it is newer than `current` (null: up to date, offline or no release).
    public static async Task<Info?> Check(string current)
    {
        try
        {
            var j = JsonNode.Parse(await http.GetStringAsync($"https://api.github.com/repos/{Repo}/releases/latest"));
            string tag = (string?)j?["tag_name"] ?? "";
            string ver = tag.TrimStart('v', 'V').Split('-')[0];
            if (!System.Version.TryParse(ver, out var latest) || !System.Version.TryParse(current, out var cur) || latest <= cur) return null;
            string? exe = (j!["assets"] as JsonArray ?? []).OfType<JsonObject>()
                .FirstOrDefault(a => (string?)a["name"] == Asset)?["browser_download_url"]?.ToString();
            return new Info(ver, (string?)j["html_url"] ?? $"https://github.com/{Repo}/releases/latest", exe);
        }
        catch { return null; }
    }

    static string? ExePath => Environment.ProcessPath;

    /// Only the portable single-file exe can swap itself (a framework-dependent build needs its dll too).
    public static bool CanSelfUpdate => string.IsNullOrEmpty(typeof(Updater).Assembly.Location)
        && ExePath is { } p && Path.GetFileName(p).Equals(Asset, StringComparison.OrdinalIgnoreCase);

    /// Download, swap and start the new exe (throws on failure; the running exe stays as it was).
    public static async Task Apply(string url)
    {
        string exe = ExePath!, tmp = exe + ".new", old = exe + ".old";
        using (var res = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead))
        {
            res.EnsureSuccessStatusCode();
            await using var src = await res.Content.ReadAsStreamAsync();
            await using var dst = File.Create(tmp);
            await src.CopyToAsync(dst);
        }
        // sanity check: a Windows exe of plausible size
        var head = new byte[2];
        using (var f = File.OpenRead(tmp)) { f.ReadExactly(head); if (f.Length < 10_000_000 || head[0] != 'M' || head[1] != 'Z') throw new InvalidDataException("bad download"); }
        if (File.Exists(old)) File.Delete(old);
        File.Move(exe, old);
        try { File.Move(tmp, exe); }
        catch { File.Move(old, exe); throw; }
        Process.Start(new ProcessStartInfo(exe) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(exe) });
    }

    /// Remove the previous exe left by an update (it may still be closing: a few tries).
    public static async void Cleanup()
    {
        if (ExePath is not { } exe) return;
        string old = exe + ".old", tmp = exe + ".new";
        for (int i = 0; i < 10 && (File.Exists(old) || File.Exists(tmp)); i++)
        {
            try { if (File.Exists(old)) File.Delete(old); if (File.Exists(tmp)) File.Delete(tmp); }
            catch { await Task.Delay(1000); }
        }
    }
}
