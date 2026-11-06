using System.IO.Compression;
using System.Text;
using System.Text.Json;

namespace PetOverlay;

// Dungeon recorder for the boss helper: every visit of a dungeon is written in full, from entering to leaving (trash,
// bosses, wipes), so timelines, HP phases, debuffs and anything found later can be read from it again
// (tools/boss_timeline.py). The page switches it on when the map is a dungeon (On); everything since the map change is
// buffered (BufferFor), so the frames of entering (spawns of the bosses!) are in the file although the page answers a
// moment later. A change to another map ends the file (the same map again – respawn, teleport inside – does not); very
// long visits are split (Longest).
//
// File encounters\<yyyyMMdd-HHmmss>_<map>.enc.gz (gzip): "ABENC1\n", a JSON header line, then records
// { u8 kind (0 frame, 1 marker), u32 ms since start, u16 op, varint length, body } (marker: op 0, body = UTF-8 note).
// encounters\index.jsonl gets one line per file (map, duration, npcs that cast with their casts and HP, main boss).
// Privacy: the frames that carry character names (player spawn, own character, party, arena roster / history) are left
// out (Personal); the rest has entity ids only. Recordings stay local (never commit them).
// A write error (disk full ...) drops the file and stops recording until the next map change (no retry storm).
sealed class BossRecorder
{
    public string Dir { get; set; } = Path.Combine(Settings.DataDir, "encounters");
    /// Record this map (the page: a dungeon and recording switched on).
    public bool On { get; set; }
    public string Version { get; set; } = "";
    /// A file was saved: index line as JSON.
    public event Action<string>? Saved;

    static bool Personal(int op) => op is 0x4536 or 0x3336 or 0x92 or 0xd92 or 0x2292 or 0x19e3 or 0x2ce3;
    static readonly TimeSpan BufferFor = TimeSpan.FromSeconds(60), Longest = TimeSpan.FromHours(2);
    const int BufferMax = 150_000; // frames
    const long MaxTotal = 2L << 30; // oldest files go above 2 GB

    readonly object sync = new();
    readonly Dictionary<uint, uint> npcs = new(); // entity -> npc id
    readonly Dictionary<uint, long> maxHp = new(); // entity -> highest HP seen (this file)
    readonly Dictionary<uint, int> casts = new(); // npc id -> casts (this file)
    readonly Dictionary<uint, uint> casters = new(); // entity -> npc id of the npcs that cast (this file)
    readonly Queue<(int op, byte[] body, DateTime ts)> buffer = new(); // since the map change, until recording starts
    uint map;
    string? path;
    GZipStream? gz;
    bool failed; // a write / create error: no more tries until the next map change
    DateTime start, lastTs; // lastTs: packet time of the latest frame (markers, duration)
    int frames, markers;

    public bool Recording { get { lock (sync) return gz != null; } }

    public void Frame(int op, byte[] body, DateTime ts)
    {
        lock (sync)
        {
            if (op == 0x0036 || Personal(op)) return; // server tick (20/s), names
            lastTs = ts;
            if (op == 0x0140)
            {
                uint next = body.Length >= 4 ? BitConverter.ToUInt32(body, 0) : 0;
                // the same map again (respawn after a death, a teleport inside the dungeon): the visit goes on
                if (gz != null && next == map) { Write(0, op, body, ts); return; } // entities stay (no new spawns)
                End();
                On = false; // until the page says what this map is
                failed = false;
                npcs.Clear();
                buffer.Clear();
                map = next;
                buffer.Enqueue((op, body, ts));
                return;
            }
            if (op == 0x4136 && PetFrames.NpcSpawn(body) is { } sp) npcs[sp.ent] = sp.npc;
            else if (op == 0x0238 && gz != null && PetFrames.CastStart(body) is { } c && npcs.TryGetValue(c.ent, out var npc))
            {
                casts[npc] = casts.GetValueOrDefault(npc) + 1;
                casters[c.ent] = npc;
            }
            else if (op == 0x008d && gz != null && PetFrames.NpcHp(body) is { } hp && npcs.ContainsKey(hp.ent))
                maxHp[hp.ent] = Math.Max(maxHp.GetValueOrDefault(hp.ent), hp.hp);

            if (gz == null && On && !failed) Begin();
            if (gz == null)
            {
                buffer.Enqueue((op, body, ts));
                while (buffer.Count > BufferMax || buffer.Count > 1 && ts - buffer.Peek().ts > BufferFor) buffer.Dequeue();
                return;
            }
            Write(0, op, body, ts);
            if (gz != null && ts - start > Longest) { End(); Begin(); } // split very long visits
        }
    }

    /// Player marker (hotkey) into the running recording; false = nothing is being recorded.
    public bool Mark(string note)
    {
        lock (sync)
        {
            if (gz == null) return false;
            Write(1, 0, Encoding.UTF8.GetBytes(note), lastTs);
            markers++;
            return true;
        }
    }

    /// The page says this map is a dungeon and recording is on: start, but only if it is still the current map (its
    /// message can come after the next map change).
    public void StartFor(uint forMap) { lock (sync) if (forMap == map) On = true; }

    /// Close the running recording (exit, recorder switched off).
    public void Stop() { lock (sync) { End(); On = false; } }

    void Begin()
    {
        try
        {
            Directory.CreateDirectory(Dir);
            Prune();
            // a crash / kill leaves an unfinished file (no gzip end): such files are of no use
            foreach (var part in Directory.GetFiles(Dir, "*.part")) try { File.Delete(part); } catch { }
            start = buffer.Count > 0 ? buffer.Peek().ts : lastTs;
            path = Path.Combine(Dir, $"{start.ToLocalTime():yyyyMMdd-HHmmss}_{map}.enc.gz.part");
            var fs = File.Create(path);
            try { gz = new GZipStream(fs, CompressionLevel.Fastest); }
            catch { fs.Dispose(); throw; }
            var head = JsonSerializer.Serialize(new { v = 2, start = start.ToString("O"), map, app = Version });
            gz.Write(Encoding.ASCII.GetBytes("ABENC1\n"));
            gz.Write(Encoding.UTF8.GetBytes(head + "\n"));
            frames = markers = 0;
            casts.Clear();
            casters.Clear();
            maxHp.Clear();
            foreach (var (op, body, t) in buffer) Write(0, op, body, t);
            buffer.Clear();
        }
        catch (Exception ex) { Fail("Boss-Aufnahme: " + ex.Message); }
    }

    void Write(byte kind, int op, byte[] body, DateTime ts)
    {
        if (gz == null) return;
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
            gz.Write(h[..n]);
            gz.Write(body);
            frames++;
        }
        catch (Exception ex) { Fail("Boss-Aufnahme abgebrochen: " + ex.Message); }
    }

    /// Drop the unfinished file and stop until the next map change.
    void Fail(string why)
    {
        OverlayForm.Log(why);
        try { gz?.Dispose(); } catch { }
        gz = null;
        if (path != null) try { File.Delete(path); } catch { }
        path = null;
        failed = true;
    }

    void End()
    {
        if (gz == null || path == null) return;
        try { gz.Dispose(); }
        catch (Exception ex) { Fail("Boss-Aufnahme: " + ex.Message); return; }
        gz = null;
        // main npc: the casting npc with the most HP (the boss among adds and trash)
        long Hp(uint n) => casters.Where(e => e.Value == n).Select(e => maxHp.GetValueOrDefault(e.Key)).DefaultIfEmpty(0).Max();
        uint main = casts.Count == 0 ? 0 : casts.Keys.MaxBy(n => (Hp(n), casts[n]));
        var final = path[..^".part".Length];
        try
        {
            File.Move(path, final, true);
            var line = JsonSerializer.Serialize(new
            {
                file = Path.GetFileName(final), start = start.ToString("O"), dur = Math.Round((lastTs - start).TotalSeconds, 1), map, npc = main,
                hp = Hp(main), npcs = casts.OrderByDescending(e => Hp(e.Key)).Take(20).ToDictionary(e => e.Key.ToString(), e => new { casts = e.Value, hp = Hp(e.Key) }),
                frames, markers,
            });
            File.AppendAllText(Path.Combine(Dir, "index.jsonl"), line + "\n");
            Saved?.Invoke(line);
        }
        catch (Exception ex) { OverlayForm.Log("Boss-Aufnahme: " + ex.Message); }
        path = null;
    }

    /// Delete the oldest recordings above MaxTotal and their index lines.
    void Prune()
    {
        var files = new DirectoryInfo(Dir).GetFiles("*.enc.gz").OrderBy(f => f.Name).ToList();
        long total = files.Sum(f => f.Length);
        var gone = new HashSet<string>();
        foreach (var f in files)
        {
            if (total <= MaxTotal) break;
            total -= f.Length;
            try { f.Delete(); gone.Add(f.Name); } catch { }
        }
        var index = Path.Combine(Dir, "index.jsonl");
        if (gone.Count == 0 || !File.Exists(index)) return;
        try { File.WriteAllLines(index, File.ReadAllLines(index).Where(l => !gone.Any(g => l.Contains($"\"{g}\"")))); } catch { }
    }

    /// All finished recordings (and the index) as a ZIP on the desktop, off the UI thread and without the lock (finished
    /// files never change); null if there are none or it failed (logged, the half ZIP deleted).
    public Task<string?> Export() => Task.Run(() =>
    {
        string? zip = null;
        try
        {
            if (!Directory.Exists(Dir)) return null;
            var files = Directory.GetFiles(Dir).Where(f => f.EndsWith(".enc.gz") || f.EndsWith("index.jsonl")).ToList();
            if (!files.Any(f => f.EndsWith(".enc.gz"))) return null;
            var desk = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            zip = Path.Combine(desk, $"boss-aufnahmen-{DateTime.Now:yyyyMMdd-HHmmss}.zip");
            for (int i = 2; File.Exists(zip); i++) zip = Path.Combine(desk, $"boss-aufnahmen-{DateTime.Now:yyyyMMdd-HHmmss}-{i}.zip");
            using (var z = ZipFile.Open(zip, ZipArchiveMode.Create))
                foreach (var f in files.Where(File.Exists)) // Prune may have deleted one meanwhile
                    z.CreateEntryFromFile(f, Path.GetFileName(f), CompressionLevel.NoCompression);
            return zip;
        }
        catch (Exception ex)
        {
            OverlayForm.Log("Boss-Export: " + ex.Message);
            if (zip != null) try { File.Delete(zip); } catch { }
            return null;
        }
    });

    /// Count and size of the recordings.
    public (int n, long bytes) Stats()
    {
        if (!Directory.Exists(Dir)) return (0, 0);
        var fs = new DirectoryInfo(Dir).GetFiles("*.enc.gz");
        return (fs.Length, fs.Sum(f => f.Length));
    }
}
