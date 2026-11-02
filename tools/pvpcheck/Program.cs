// Checks PlayerFrames (PvP overlay decoders) against captures/20261019-201703 (arena + open world) and
// captures/20261023-011739 (Abyss + city), dumped with
// tools/analyze_capture.py --dump. Expected values: arena history JSON (0x2ce3) and NCSOFT's character website.
using System.Drawing;
using System.Text.Json;
using PetOverlay;

int fails = 0;
void Check(bool ok, string what) { if (!ok) { fails++; Console.WriteLine("FAIL " + what); } }

// ---- Placement: saved window positions are restored onto a visible screen (multi-monitor)
{
    Rectangle[] two = [new(0, 0, 1920, 1040), new(1920, -200, 2560, 1400)]; // primary + a taller monitor right of it
    var r = new Rectangle(100, 100, 300, 200);
    Check(Placement.Clamp(r, two) == r, "fully visible: unchanged");
    Check(Placement.Clamp(new Rectangle(2500, -150, 300, 200), two) == new Rectangle(2500, -150, 300, 200), "on the second monitor (negative y): unchanged");
    Check(Placement.Clamp(new Rectangle(1800, 900, 300, 200), two) == new Rectangle(1920, 900, 300, 200), "across the edge: onto the screen it overlaps most");
    Check(Placement.Clamp(new Rectangle(1700, 900, 300, 200), two) == new Rectangle(1620, 840, 300, 200), "more on the primary: into the primary");
    Check(Placement.Clamp(new Rectangle(1850, -190, 300, 200), two) == new Rectangle(1920, -190, 300, 200), "mostly on monitor 2: pushed onto it");
    Check(Placement.Clamp(new Rectangle(6000, 500, 300, 200), two) == new Rectangle(4180, 500, 300, 200), "monitor gone: onto the nearest one");
    Check(Placement.Clamp(new Rectangle(-900, -900, 300, 200), [two[0]]) == new Rectangle(0, 0, 300, 200), "single screen, far off: top-left corner");
    Check(Placement.Clamp(new Rectangle(10, 10, 3000, 1200), [two[0]]) == new Rectangle(0, 0, 1920, 1040), "larger than the screen: shrunk");
    Check(Placement.Restore(Placement.Unset, Placement.Unset, new Size(300, 200), new Point(24, 208), two) == new Point(24, 208), "nothing saved: fallback");
    Check(Placement.Restore(-5000, 300, new Size(300, 200), new Point(24, 208), two) == new Point(0, 300), "saved off-screen: clamped");
    Check(Placement.Clamp(r, []) == r, "no screens: unchanged");
    Console.WriteLine(fails == 0 ? "Placement OK" : $"Placement: {fails} FAILED");
}
// ---- Daevanion boards (0x26e2): u8 n, n x {u32 board, varint count, count x u32 node id}
{
    static byte[] Frame(params (int board, uint[] ids)[] bs)
    {
        var m = new List<byte> { (byte)bs.Length };
        foreach (var (board, ids) in bs) { m.AddRange(BitConverter.GetBytes(board)); m.Add((byte)ids.Length); foreach (var i in ids) m.AddRange(BitConverter.GetBytes(i)); }
        return [.. m];
    }
    var d = PetFrames.ParseDaevanion(Frame((21, [210113, 210033]), (26, [260113])));
    Check(d != null && d[21].SequenceEqual(new uint[] { 210113, 210033 }) && d[26].Length == 1, "Daevanion: two boards");
    Check(PetFrames.ParseDaevanion(Frame((21, [220113]))) == null, "Daevanion: node of another board rejected");
    Check(PetFrames.ParseDaevanion([.. Frame((21, [210113])), 0]) == null, "Daevanion: trailing bytes rejected");
    var real = Environment.GetEnvironmentVariable("DAE_HEX"); // optional: hex of a real 0x26e2 frame
    if (real != null && PetFrames.ParseDaevanion(Convert.FromHexString(File.ReadAllText(real).Trim())) is var rd)
        Console.WriteLine("real frame: " + (rd == null ? "null" : string.Join(", ", rd.Select(b => $"{b.Key}:{b.Value.Length}"))));
    Console.WriteLine(fails == 0 ? "Daevanion OK" : $"Daevanion: {fails} FAILED");
}
if (args.Length == 0) return fails == 0 ? 0 : 1;
var path = args[0];

var spawns = new List<PlayerSpawn>();
var rosters = new List<List<RosterEntry>>();
var owns = new List<OwnInfo>();
var ownCps = new List<int>();
var moves = new Dictionary<int, int>();
var gone = 0;
var died = new List<uint>();
var aps = new List<long>();
var kills = new List<(uint victim, uint killer, int server, string name)>();
var players = new HashSet<uint>();
byte[] own = [0xfa, 0x12]; // own entity varint of the first arena session (0x3336)
var arenaFixes = new List<(float x, float y)>();
var parties = new List<(int op, List<PartyMember> m)>();
foreach (var line in File.ReadLines(path))
{
    var f = JsonDocument.Parse(line).RootElement;
    if (f.GetProperty("dir").GetString() != "S2C") continue;
    int op = f.GetProperty("op").GetInt32();
    var b = Convert.FromHexString(f.GetProperty("hex").GetString()!);
    if (op is 0x2a38 or 0x2336 && PlayerFrames.OwnFix(op, b, own) is { } me && Math.Abs(me.x) < 10000 && Math.Abs(me.y) < 10000)
        arenaFixes.Add((me.x / 100, me.y / 100));
    if (op == 0x4536 && PlayerFrames.ParsePlayer(b) is { } p) { spawns.Add(p); players.Add(p.Ent); }
    else if (op == 0x4536) Check(false, "0x4536 not decoded: " + Convert.ToHexString(b.AsSpan(0, 24)));
    else if (op == 0x19e3 && b.Length > 64 && PlayerFrames.ParseRoster(b) is { } r) rosters.Add(r);
    else if (op == 0x3336 && PlayerFrames.ParseOwn(b) is { } o) owns.Add(o);
    else if (op is 0x92 or 0xd92 or 0x2292 or 0x1f92) parties.Add((op, op == 0x1f92 ? [] : PlayerFrames.ParseParty(b)));
    else if (op == 0x5636 && PlayerFrames.OwnCp(b) is > 0 and var cp) ownCps.Add(cp);
    else if (op == 0x4736 && PlayerFrames.Gone(b) is { } g && players.Contains(g.ent))
    {
        gone++;
        if (g.reason == PlayerFrames.GoneDied) died.Add(g.ent);
    }
    else if (op == 0xa9ff && PlayerFrames.Ap(b) is >= 0 and var ap) { if (aps.Count == 0 || aps[^1] != ap) aps.Add(ap); }
    else if (op == 0x048d && PlayerFrames.ParseKill(b) is { } k && players.Contains(k.victim)) kills.Add(k);
    else if (PlayerFrames.MoveOffset(op) is >= 0 and var skip && PlayerFrames.Move(b, skip, out uint ent, out _) && players.Contains(ent))
        moves[op] = moves.GetValueOrDefault(op) + 1;
}

foreach (var s in spawns)
    Console.WriteLine(FormattableString.Invariant($"{s.Name,-14} ent {s.Ent,6} srv {s.Server} pc {s.PcId,2} race {s.Race} Lv{s.Level,2} iLvl {s.ItemLevel,4} CP {s.Cp,6} @ {s.X / 100:F1},{s.Y / 100:F1},{s.Z / 100:F1}"));
foreach (var r in rosters) Console.WriteLine("Roster: " + string.Join(", ", r.Select(e => $"T{e.Team} {e.Name}/{e.Server}/pc{e.PcId}/r{e.Rating}")));
Console.WriteLine($"Own: {string.Join(" | ", owns.Distinct())}  CP {string.Join(",", ownCps.Distinct())}");
Console.WriteLine($"Moves: {string.Join(", ", moves.Select(m => $"0x{m.Key:x4}={m.Value}"))}  gone: {gone}  died: {died.Count}");
foreach (var k in kills) Console.WriteLine($"Kill: {spawns.LastOrDefault(s => s.Ent == k.victim)?.Name} by {k.name} ({k.server}, ent {k.killer})");

// captures/20261023-011739 (Testdaevi): Abyss maps 20 / 504001-504003 (spawn flag 17 instead of 07, one byte more after the
// gender), then the city. Expected values: NCSOFT's character website (Kagu's CP changed slightly since the capture).
if (owns.Any(o => o.Name == "Testdaevi"))
{
    Check(spawns.Count == 130, $"spawns {spawns.Count} != 130");
    Check(spawns.All(s => s.Server > 0 && s.Level > 0 && s.ItemLevel > 0 && s.Cp > 0), "every spawn has server, level, item level and CP");
    Check(spawns.First(s => s.Name == "Kagu") is { Race: 1, Gender: 2, Server: 1306, PcId: 6, Level: 45, ItemLevel: 2634, Cp: 132199 }, "Kagu (Elyos in the Abyss)");
    Check(spawns.First(s => s.Name == "Neerchen") is { Race: 2, Server: 2306, PcId: 36, Level: 45, ItemLevel: 1161, Cp: 65037 }, "Neerchen (Abyss)");
    Check(spawns.First(s => s.Name == "Nakali") is { Level: 18, ItemLevel: 233, Cp: 21245 }, "Nakali Lv18 CP without the small u32");
    Check(spawns.Count(s => s.Race == 1) == 1, "one Elyos");
    Check(moves.Values.Sum() > 1000, "player moves decoded");
    Check(gone >= 100, $"despawns {gone}");
    // the only player kill: Ipop (ent 680) by the Elyos Boika (Ariel, never in range), then gone with reason 04
    Check(kills.Count == 1 && kills[0] == (680u, 1755u, 1306, "Boika"), "kill Ipop by Boika: " + string.Join(";", kills));
    Check(died.SequenceEqual([680u]), "only Ipop died: " + string.Join(",", died));
    // Abyss points (0xa9ff): only Abyss guard kills raise them
    Check(aps.Take(3).SequenceEqual([8058L, 8061L, 8067L]), "Abyss points " + string.Join(",", aps));
}
else
{
    Check(spawns.Count == 52, $"spawns {spawns.Count} != 52");
    // name -> server, pcId, item level, CP (website / history; CP exact where the website was up to date)
    var expect = new Dictionary<string, (int srv, int pc, int il, int cp)>
    {
        ["Maestro"] = (2306, 15, 2567, 131827), ["Ley"] = (2303, 12, 2785, 142671), ["LaGuente"] = (2303, 12, 2805, 152349),
        ["Animuz"] = (2312, 7, 2565, 130428), ["Senbonzakura"] = (2312, 16, 2165, 93474), ["Miranda"] = (1308, 30, 1595, 85849),
        ["Kanapenia"] = (2307, 32, 2666, 144611), ["Hieii"] = (2303, 8, 2796, 164468), ["shanfen"] = (2304, 23, 2500, 120936),
        ["SamAdriel"] = (1306, 9, 1052, 57829), ["Chika7ilo"] = (1306, 29, 940, 40913), ["Kathe"] = (2310, 32, 2660, 157402),
        ["Airye"] = (2310, 20, 2562, 147558), ["Crueli"] = (2310, 36, 2535, 138842), ["Skyu"] = (2310, 36, 2617, 140329),
        ["Bioniko"] = (2306, 7, 473, 25808), ["Pinkgaeheal"] = (2306, 31, 618, 29326),
    };
    foreach (var (name, e) in expect)
        foreach (var s in spawns.Where(s => s.Name == name))
            Check((s.Server, s.PcId, s.ItemLevel, s.Cp) == e, $"{name}: got {(s.Server, s.PcId, s.ItemLevel, s.Cp)} want {e}");
    Check(spawns.All(s => s.Server > 0 && s.Level > 0 && s.ItemLevel > 0 && s.Cp > 0), "every spawn has server, level, item level and CP");
    Check(spawns.Single(s => s.Name == "Maestro" && s.X < 0) is { Race: 2, Gender: 1 } m && Math.Abs(m.X / 100 + 69.7) < 0.1, "Maestro race/gender/position");
    Check(spawns.Single(s => s.Name == "Miranda").Race == 1, "Miranda is Elyos");
    Check(spawns.Single(s => s.Name == "RunaPhai").Level == 21, "RunaPhai level 21");

    Check(rosters.Count == 2, $"rosters {rosters.Count} != 2");
    if (rosters.Count == 2)
    {
        var t1 = rosters[0].Where(e => e.Team == 1).Select(e => e.Name).ToArray();
        var t2 = rosters[0].Where(e => e.Team == 2).Select(e => e.Name).ToArray();
        Check(t1.SequenceEqual(["Testdaeva", "Maestro", "Ley", "LaGuente", "Hieii"]), "roster 1 team 1: " + string.Join(",", t1));
        Check(t2.SequenceEqual(["Kanapenia", "Miranda", "Animuz", "Senbonzakura", "shanfen"]), "roster 1 team 2: " + string.Join(",", t2));
        Check(rosters[0].Single(e => e.Name == "shanfen").Server == 2304, "shanfen server 2304 (home 2301)");
        Check(rosters[0].Single(e => e.Name == "Miranda") is { Server: 1308, Race: 1, PcId: 30 }, "Miranda roster entry");
        Check(rosters[1].Where(e => e.Team == 1).Select(e => e.Name).SequenceEqual(["Airye", "Kathe", "Crueli", "Fallstar", "Skyu"]), "roster 2 team 1");
        Check(rosters[1].Single(e => e.Name == "Testdaeva").Team == 2, "roster 2: Testdaeva in team 2");
    }
    Check(owns.Count > 0 && owns.All(o => o == new OwnInfo("Testdaeva", 2306, 12, 2, 45, 2592)), "own info Testdaeva 2306 Templar Lv45 iLvl 2592");
    Check(ownCps.Contains(138355), "own CP 138355 (0x5636)");
    Check(moves.Values.Sum() > 2000, "player moves decoded");
    Check(gone >= 40, $"despawns {gone}");
    // own position in the arena (around 0/0, rejected by PetFrames.Plausible): teleport in at -73.6/-1.8, later e.g. 25/1
    Console.WriteLine($"Own arena fixes: {arenaFixes.Count}, first {arenaFixes.FirstOrDefault()}");
    Check(arenaFixes.Count > 20 && Math.Abs(arenaFixes[0].x + 73.6) < 0.2 && Math.Abs(arenaFixes[0].y + 1.8) < 0.2, "own arena position from 0x2336 / 0x2a38");
    Check(arenaFixes.All(f => Math.Abs(f.x) < 90 && Math.Abs(f.y) < 40), "own arena fixes inside the arena");

    // own party: 0x92 list + 0xd92 / 0x2292 members, 0x1f92 left (arena party of 5 -> duo Testdaeva + Maestro)
    foreach (var (op, pm) in parties) Console.WriteLine($"Party 0x{op:x4}: " + string.Join(", ", pm.Select(e => $"{e.Name}/{e.Server}/pc{e.PcId}/Lv{e.Level}/iLvl{e.ItemLevel}/CP{e.Cp}")));
    Check(parties.Count(p => p.op == 0x92) == 8 && parties.Where(p => p.op != 0x1f92).All(p => p.m.Count > 0), "every party frame has members");
    Check(parties.Count(p => p.op == 0x1f92) == 2, "party left twice (two arena ends)");
    var party = new Dictionary<string, PartyMember>();
    var states = new List<string>();
    foreach (var (op, pm) in parties)
    {
        if (op is 0x92 or 0x1f92) party.Clear();
        foreach (var e in pm) party[e.Name] = e;
        states.Add(string.Join(",", party.Keys.Order(StringComparer.Ordinal)));
    }
    Check(states[4] == "Hieii,LaGuente,Ley,Maestro,Testdaeva", "arena party of 5: " + states[4]);
    Check(states.Last() == "Maestro,Testdaeva", "after the arena: duo " + states.Last());
    foreach (var e in parties.SelectMany(p => p.m))
        if (expect.TryGetValue(e.Name, out var x)) Check((e.Server, e.PcId, e.ItemLevel, e.Cp) == x, $"party {e.Name}: {(e.Server, e.PcId, e.ItemLevel, e.Cp)} want {x}");
        else Check(e.Name == "Testdaeva" && e is { Server: 2306, PcId: 12, Level: 45, ItemLevel: 2592, Cp: 138355 }, "party member " + e);

}
Console.WriteLine(fails == 0 ? "OK" : $"{fails} FAILED");
return fails == 0 ? 0 : 1;
