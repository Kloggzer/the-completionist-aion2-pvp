using System.IO.Compression;
using System.Text;
using System.Text.Json;

namespace PetOverlay;

// Combat recorder for the boss mod (dungeon bosses): every fight with npcs inside a dungeon (the page switches it on
// there: On + All; outside only Npcs, if it is ever on) is written in full, so timelines, HP phases, debuffs and anything found later can be read from it again
// (tools/boss_timeline.py). Fight = first npc cast (0x0238) to Quiet without any npc cast, or a map change (0x0140).
// At the pull the spawn frames (0x4136) of the npcs around are written first, then the 5 s before the pull.
//
// File encounters\<yyyyMMdd-HHmmss>_<npc>.enc.gz (gzip): "ABENC1\n", a JSON header line, then records
// { u8 kind (0 frame, 1 marker), u32 ms since start, u16 op, varint length, body } (marker: op 0, body = UTF-8 note).
// Main npc = the casting npc with the most HP (0x008d). encounters\index.jsonl gets one line per fight. No player
// names are written by the recorder itself (frames carry entity ids; a frame may contain names, files stay local).
sealed class BossRecorder
{
    public string Dir { get; set; } = Path.Combine(Settings.DataDir, "encounters");
    public bool On { get; set; }
    /// Inside a dungeon (set by the page): every npc fight; otherwise only Npcs.
    public bool All { get; set; }
    public HashSet<uint> Npcs { get; set; } = new();
    public string Version { get; set; } = "";
    /// A fight was saved: index line as JSON.
    public event Action<string>? Saved;

    static readonly TimeSpan Quiet = TimeSpan.FromSeconds(20), Pre = TimeSpan.FromSeconds(5), Longest = TimeSpan.FromMinutes(15);
    const long MaxTotal = 2L << 30; // oldest files go above 2 GB

    readonly object sync = new();
    readonly Dictionary<uint, uint> npcs = new(); // entity -> npc id
    readonly Dictionary<uint, (byte[] body, DateTime ts)> spawned = new(); // entity -> its 0x4136, written at the pull
    readonly Dictionary<uint, long> maxHp = new(); // entity -> highest HP seen
    readonly Dictionary<uint, int> casts = new(); // npc id -> casts in this fight
    readonly Queue<(int op, byte[] body, DateTime ts)> pre = new();
    uint map;
    string? path;
    GZipStream? gz;
    DateTime start, lastCast;
    int frames, markers;

    public bool Recording { get { lock (sync) return gz != null; } }

    public void Frame(int op, byte[] body, DateTime ts)
    {
        lock (sync)
        {
            if (op == 0x0036) return; // server tick, 20/s
            if (op == 0x0140)
            {
                End();
                npcs.Clear();
                spawned.Clear();
                if (body.Length >= 4) map = BitConverter.ToUInt32(body, 0);
                return;
            }
            if (op == 0x4136)
            {
                int o = 0;
                uint ent = (uint)PetFrames.Varint(body, ref o);
                if (o + 7 <= body.Length) { npcs[ent] = BitConverter.ToUInt32(body, o + 3); spawned[ent] = (body, ts); }
            }
            else if (op == 0x4236 && gz == null && body.Length >= 2)
            {
                int o = 0;
                uint ent = (uint)PetFrames.Varint(body, ref o);
                npcs.Remove(ent); // during a fight entities stay known (the boss's death frame comes after it)
                spawned.Remove(ent);
            }
            else if (op == 0x0238 && On && PetFrames.CastStart(body) is { } c && npcs.TryGetValue(c.ent, out var npc)
                     && (All || Npcs.Contains(npc)))
            {
                if (gz == null) Begin(ts);
                lastCast = ts;
                casts[npc] = casts.GetValueOrDefault(npc) + 1;
            }
            else if (op == 0x008d && PetFrames.NpcHp(body) is { } hp && npcs.ContainsKey(hp.ent))
                maxHp[hp.ent] = Math.Max(maxHp.GetValueOrDefault(hp.ent), hp.hp);

            if (gz == null)
            {
                if (!On) return;
                pre.Enqueue((op, body, ts));
                while (pre.Count > 0 && ts - pre.Peek().ts > Pre) pre.Dequeue();
                return;
            }
            Write(0, op, body, ts);
            if (ts - lastCast > Quiet || ts - start > Longest) End(); // longest: npcs that never stop casting
        }
    }

    /// Player marker (hotkey) into the running fight; false = nothing is being recorded.
    public bool Mark(string note)
    {
        lock (sync)
        {
            if (gz == null) return false;
            Write(1, 0, Encoding.UTF8.GetBytes(note), DateTime.UtcNow);
            markers++;
            return true;
        }
    }

    /// Close the running fight (exit, recorder switched off).
    public void Stop() { lock (sync) End(); }

    void Begin(DateTime ts)
    {
        try
        {
            Directory.CreateDirectory(Dir);
            Prune();
            start = pre.Count > 0 ? pre.Peek().ts : ts;
            path = Path.Combine(Dir, $"{start.ToLocalTime():yyyyMMdd-HHmmss}.enc.gz.part");
            gz = new GZipStream(File.Create(path), CompressionLevel.Fastest);
            var head = JsonSerializer.Serialize(new { v = 1, start = start.ToString("O"), map, app = Version });
            gz.Write(Encoding.ASCII.GetBytes("ABENC1\n"));
            gz.Write(Encoding.UTF8.GetBytes(head + "\n"));
            frames = markers = 0;
            casts.Clear();
            maxHp.Clear();
            // the npcs around (the boss spawned long before the pull), then the last seconds
            foreach (var (body, t) in spawned.Values) if (t < start) Write(0, 0x4136, body, start);
            foreach (var (op, body, t) in pre) Write(0, op, body, t);
            pre.Clear();
        }
        catch (Exception ex)
        {
            OverlayForm.Log("Boss-Aufnahme: " + ex.Message);
            gz = null;
        }
    }

    void Write(byte kind, int op, byte[] body, DateTime ts)
    {
        Span<byte> h = stackalloc byte[12];
        h[0] = kind;
        BitConverter.TryWriteBytes(h[1..], (uint)Math.Max(0, (ts - start).TotalMilliseconds));
        BitConverter.TryWriteBytes(h[5..], (ushort)op);
        int n = 7;
        for (uint v = (uint)body.Length; ; v >>= 7)
        {
            if (v < 0x80) { h[n++] = (byte)v; break; }
            h[n++] = (byte)(v | 0x80);
        }
        try
        {
            gz!.Write(h[..n]);
            gz.Write(body);
            frames++;
        }
        catch { }
    }

    void End()
    {
        if (gz == null || path == null) return;
        try { gz.Dispose(); } catch { }
        gz = null;
        // main npc: the casting npc with the most HP (the boss among its adds), else the one casting most
        uint main = casts.Keys.MaxBy(n => (npcs.Where(e => e.Value == n).Select(e => maxHp.GetValueOrDefault(e.Key)).DefaultIfEmpty(0).Max(), casts[n]));
        var dur = (lastCast - start).TotalSeconds;
        var final = Path.Combine(Dir, $"{start.ToLocalTime():yyyyMMdd-HHmmss}_{main}.enc.gz");
        try
        {
            File.Move(path, final, true);
            var line = JsonSerializer.Serialize(new
            {
                file = Path.GetFileName(final), start = start.ToString("O"), dur = Math.Round(dur, 1), map, npc = main,
                hp = npcs.Where(e => e.Value == main).Select(e => maxHp.GetValueOrDefault(e.Key)).DefaultIfEmpty(0).Max(),
                casts, frames, markers,
            });
            File.AppendAllText(Path.Combine(Dir, "index.jsonl"), line + "\n");
            Saved?.Invoke(line);
        }
        catch (Exception ex) { OverlayForm.Log("Boss-Aufnahme: " + ex.Message); }
        path = null;
    }

    void Prune()
    {
        var files = new DirectoryInfo(Dir).GetFiles("*.enc.gz").OrderBy(f => f.Name).ToList();
        long total = files.Sum(f => f.Length);
        foreach (var f in files)
        {
            if (total <= MaxTotal) break;
            total -= f.Length;
            try { f.Delete(); } catch { }
        }
    }

    /// All recordings (and the index) as a ZIP on the desktop; null if there are none.
    public string? Export()
    {
        lock (sync)
        {
            if (!Directory.Exists(Dir) || Directory.GetFiles(Dir, "*.enc.gz").Length == 0) return null;
            var zip = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), $"boss-aufnahmen-{DateTime.Now:yyyyMMdd-HHmm}.zip");
            using var z = ZipFile.Open(zip, ZipArchiveMode.Create);
            foreach (var f in Directory.GetFiles(Dir).Where(f => f.EndsWith(".enc.gz") || f.EndsWith("index.jsonl")))
                z.CreateEntryFromFile(f, Path.GetFileName(f), CompressionLevel.NoCompression);
            return zip;
        }
    }

    /// Count and size of the recordings.
    public (int n, long bytes) Stats()
    {
        if (!Directory.Exists(Dir)) return (0, 0);
        var fs = new DirectoryInfo(Dir).GetFiles("*.enc.gz");
        return (fs.Length, fs.Sum(f => f.Length));
    }
}
