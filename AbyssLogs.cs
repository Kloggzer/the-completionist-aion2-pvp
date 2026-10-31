using System.Text.Json.Nodes;

namespace PetOverlay;

// Read-only access to the fight history of the Abyss Logs DPS meter (%USERPROFILE%\.abyss-dps-meter\segments): the
// index of fights and single .abyss files (ABYS header + protobuf), decoded by the UI (web/src/features/build/abyss.ts).
// Only that folder, only file names that are GUIDs; nothing is written.
static class AbyssLogs
{
    static string Dir => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".abyss-dps-meter", "segments");

    /// <summary>Training dummy and boss fights from index.json, newest first (at most `max`), with the fields the UI
    /// lists; null when there is no history.</summary>
    public static string? Index(int max = 1500)
    {
        var path = Path.Combine(Dir, "index.json");
        if (!File.Exists(path)) return null;
        try
        {
            using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            if (JsonNode.Parse(fs) is not JsonArray all) return null;
            var keep = new JsonArray();
            foreach (var e in all.Reverse())
            {
                if (e is not JsonObject o || !((bool?)o["hasDummy"] == true || (bool?)o["hasBoss"] == true)) continue;
                var row = new JsonObject();
                foreach (var k in new[] { "id", "label", "startTime", "duration", "totalDamage", "playerCount", "recorderName", "hasDummy", "hasBoss", "zoneId", "runGroupId", "bossMobCode" })
                    if (o[k] is { } v) row[k] = v.DeepClone();
                keep.Add(row);
                if (keep.Count >= max) break;
            }
            return keep.ToJsonString();
        }
        catch { return null; }
    }

    /// <summary>One fight file as base64, or null.</summary>
    public static string? Segment(string id)
    {
        if (!Guid.TryParse(id, out var g)) return null;
        var path = Path.Combine(Dir, g.ToString("D") + ".abyss");
        try
        {
            if (!File.Exists(path) || new FileInfo(path).Length > 32 << 20) return null;
            using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var ms = new MemoryStream();
            fs.CopyTo(ms);
            return Convert.ToBase64String(ms.ToArray());
        }
        catch { return null; }
    }
}
