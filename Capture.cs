using System.Text.Json;
using SharpPcap;
using SharpPcap.LibPcap;

namespace PetOverlay;

// Passive only: reads copies of the game's packets via Npcap, never touches the game process.
abstract class PetSource : IDisposable
{
    readonly Dictionary<string, TcpStream> streams = new();
    readonly Queue<(DateTime at, DateTime ts, byte[] data)> pending = new();
    HashSet<int> ports = new();
    protected readonly object Sync = new();
    protected int LinkType = 1;
    /// Diagnostics (LiveCapture status): segments of the game's connections seen / frames decoded from them.
    protected long GameSegments, GameFrames;

    public event Action<PetList, DateTime>? PetListReceived;
    public event Action<List<(uint id, uint val, byte tier, long ts)>, bool>? AchievementsReceived; // items, full list (login)
    public event Action<uint, int, DateTime>? SoulsReceived;
    public event Action<string, string>? StatusChanged; // (live|waiting|off|error|replay, text)
    public event Action<uint>? CharIdReceived;
    public event Action<string?>? CharNameReceived; // after CharIdReceived on every 0x3336; null = name not readable
    public event Action<float, float, float, DateTime, int>? PositionReceived; // map x, map z, height (metres), source opcode
    // No own position while flying/running (the server only reports it on combat/skills). New mobs, players and objects
    // spawn ~35-60 m around the player, so the centroid of the last spawns estimates it (follows flying well; the
    // particle filter of PositionTracker was more accurate on average but lagged behind fast movement). Map x, z, height, σ.
    public event Action<float, float, float, float, DateTime>? PositionEstimated;
    // World objects (gather nodes, chests, ...): 0x3436 spawn in range, 0x3536 gone (04 = used/opened, 01 = out of range).
    public event Action<uint, uint, float, float, float>? ObjectSpawned; // entity, EnvObj id, map x, map z, height
    public event Action<uint, int>? ObjectRemoved;                       // entity, reason
    // 0x0140 on every map change (login, teleport, instance): u32 map id (aion2maps map_id, e.g. 1110 = Altgard;
    // instances/dungeons have their own ids). 0x2336 carries the new position: 6 bytes, x, y, z float32 cm.
    public event Action<uint>? MapChanged;
    // Field bosses (ids given by the UI): 0x4136 spawn carries the NpcData id after the entity varint + 3 bytes;
    // 0x4236 = entity gone: varint entity, 00, reason (03 = died in combat, 01 = out of range).
    public event Action<uint, bool>? BossEvent; // npc id, died (false = seen/spawned)
    public event Action<uint, List<(uint id, bool alive, float x, float z, long ts)>>? BossTable;
    // Weekly usage counters at login (0xacff): id -> used this period; id 2 = daily dungeon entries (14 per week).
    public event Action<Dictionary<byte, uint>, long>? UsageReceived;
    // Odyle energy (0x0c61 type 0c/01): regenerating energy and the bonus pool from Odyle items.
    public event Action<int, int>? OdyleReceived;
    // Entry charges (0x0c61 type 04): u32 content id, u8 charges left, u8 ? (2 / 3, not the bonus entries: those only come
    // with 0x0b61). Verified: 4 = Nightmare, 8 = Dimensional Invasion.
    public event Action<uint, int>? ChargeReceived;
    // PvP match history when its window opens (0x2ce3): JSON per match (start, contents id, winning team, members).
    public event Action<List<JsonElement>>? PvpHistoryReceived;
    // Every entry limit (0x0b61): content id, charges left, bonus entries. Sent with every map load (login, teleport,
    // instance), i.e. every few minutes, ~8 s before the own character (0x3336).
    public event Action<List<(uint id, int left, int bonus)>>? EntryChargesReceived;
    // Black Cloud Merchant offer (0x9156) whenever its window/tab opens: tab id, offered items.
    public event Action<int, List<MerchantItem>>? MerchantReceived;
    /// Own Daevanion boards (0x26e2 at login): board id -> open node ids.
    public event Action<Dictionary<int, uint[]>>? DaevanionReceived;
    /// Own Daevanion nodes bought (0x03e5, 0x28e2) or reset (0x2be2; 0x29e2 = a whole board, as its Start node id)
    /// while playing: (bought, reset).
    public event Action<uint[], uint[]>? DaevanionChanged;
    /// Spent Daevanion points per pool (0x2ee2, on every buy / reset): pool -> points.
    public event Action<Dictionary<int, int>>? DaevanionPoints;
    /// Daevanion research (on while the tab asks for it): every other frame that carries node ids of the own boards
    /// (u32 board * 10000 + 1..225 at any offset), to find the frames of buying and resetting a node. (op, body, ids)
    public event Action<int, byte[], uint[]>? DaeNodeFrame;
    /// Research, same switch: every frame's opcode and length (to find what opening the board window sends).
    public event Action<int, int>? DaeOpFrame;
    public volatile bool DaeLog;
    /// Research capture: every frame except the high-rate ones (HighRate), with its body (research-packets.log); for
    /// finding new counters. Live capture only (OverlayForm).
    public volatile bool Research;
    public event Action<int, byte[], DateTime>? ResearchFrame;
    HashSet<int> daeBoardIds = new();
    /// Research (where are the total Daevanion points?): the frames around the login, written when 0x26e2 arrives: the
    /// last RingSize frames before it and everything in the LoginAfter after it. (op, body, time) per frame.
    public event Action<List<(int op, byte[] body, DateTime ts)>>? DaeLoginFrames;
    readonly Queue<(int op, byte[] body, DateTime ts)> ring = new();
    List<(int op, byte[] body, DateTime ts)>? loginDump;
    DateTime loginUntil;
    const int RingSize = 4000;
    static readonly TimeSpan LoginAfter = TimeSpan.FromSeconds(15);
    // Other players (PvP overlay, PlayerFrames): spawn in range (0x4536), moves (0x1a37 family), gone (0x4736),
    // killed (0x048d, killer also out of range), arena roster at match start (0x19e3), own character (0x3336) and own
    // combat power (0x5636).
    public event Action<PlayerSpawn>? PlayerSpawned;
    public event Action<uint, float, float, float>? PlayerMoved; // entity, x, y, z (cm)
    public event Action<uint, int>? PlayerGone;                  // entity, reason (PlayerFrames.Gone)
    public event Action<uint, uint, int, string>? PlayerKilled;   // victim (player around or self), killer entity, server, name
    public event Action<List<RosterEntry>>? RosterReceived;
    public event Action<OwnInfo>? OwnInfoReceived;
    public event Action<int>? OwnCpReceived;
    public event Action<long>? ApReceived; // own Abyss points (0xa9ff), after every kill credit
    public event Action<List<(uint Uid, uint Id, long Count)>>? InventoryReceived; // own inventory update (0x1b56): loot
    public event Action<float, float, float>? OwnPvpPos; // own position incl. arenas (PlayerFrames.OwnFix), cm
    // Own party / alliance: members (full list = 0x92, else single members 0xd92 / 0x2292); 0x1f92 = party left.
    public event Action<List<PartyMember>, bool>? PartyReceived;
    public event Action? PartyLeft;
    readonly HashSet<uint> players = new();
    byte[]? lastBossTable;
    public HashSet<uint> TrackedNpcs { get; set; } = new();
    readonly Dictionary<uint, uint> bossEntities = new();
    // Boss mod (web/src/features/bossmod): the npcs it has timelines for (ids given by the UI); BossModAll = every npc
    // (learning: boss-casts.log). Entity -> npc from the 0x4136 spawn (NpcData id after the entity varint + 3 bytes),
    // skills from 0x0238 / 0x0638 (PetFrames.CastStart / CastEnd), gone / died from 0x4236.
    public HashSet<uint> BossModNpcs { get; set; } = new();
    public bool BossModAll { get; set; }
    public event Action<uint, uint, uint, byte, uint, DateTime>? NpcCast; // npc, entity, skill, cast counter, target
    public event Action<uint, uint, uint, byte, DateTime>? NpcCastEnd; // npc, entity, skill, cast counter
    public event Action<uint, uint, bool, DateTime>? NpcGone; // npc, entity, died
    public event Action<uint, uint, DateTime>? NpcSpawned; // npc, entity
    // HP (0x008d, at most every 250 ms per entity), aggro target (0x3538), hits of its skills (0x0438: who got hit).
    public event Action<uint, uint, long, DateTime>? NpcHp; // npc, entity, hp
    public event Action<uint, uint, uint, DateTime>? NpcTarget; // npc, entity, target entity
    public event Action<uint, uint, uint, byte, uint, byte, DateTime>? NpcHit; // npc, entity, skill, cast counter, target entity, flags
    readonly Dictionary<uint, uint> modEntities = new();
    readonly Dictionary<uint, DateTime> hpSent = new();
    int BossErrors;
    /// Fight recordings for the boss mod (BossRecorder.cs), null = off.
    public BossRecorder? Recorder { get; set; }
    readonly HashSet<uint> objects = new();
    readonly PositionTracker tracker;
    readonly Queue<(DateTime ts, float x, float y, float z)> spawns = new();
    DateTime lastOwnPos, lastEstimate;
    public byte[]? OwnId { get; set; }

    protected PetSource()
    {
        // aion2maps: x = X/100, z = Y/100. Only the tracker's exact fixes are used; the estimate is the spawn centroid.
        tracker = new((x, y, z, op, ts) =>
        {
            lastOwnPos = ts;
            if (op == 0x2336) spawns.Clear(); // teleport: the old surroundings say nothing about the new place
            PositionReceived?.Invoke(x, y, z, ts, op);
        }, (_, _, _, _, _) => { });
    }

    protected void SetStatus(string state, string text) => StatusChanged?.Invoke(state, text);

    // Server->client segments of the game's connections feed the frame decoder; packets of not-yet-known
    // connections wait 15 s, because the socket table lags behind the connection start (login frame!).
    protected void Packet(DateTime ts, byte[] data, bool buffer = true)
    {
        if (Packets.Parse(data, LinkType) is not { } s) return;
        if (ports.Contains(s.DstPort))
        {
            GameSegments++;
            var key = $"{s.Src}:{s.SrcPort}>{s.DstPort}";
            if (!streams.TryGetValue(key, out var st)) streams[key] = st = new TcpStream();
            st.Add(s.Seq, s.Flags, data.AsSpan(s.Offset, s.Length), (op, body) => Frame(op, body, ts));
        }
        else if (buffer && !ports.Contains(s.SrcPort) && pending.Count < 50000)
            pending.Enqueue((DateTime.UtcNow, ts, data));
    }

    /// Node ids of the own boards in a frame (any byte offset); before the login frame: any board of any class.
    uint[] NodeIds(byte[] b)
    {
        List<uint>? found = null;
        for (int o = 0; o + 4 <= b.Length; o++)
        {
            uint v = BitConverter.ToUInt32(b, o);
            int board = (int)(v / 10000), idx = (int)(v % 10000);
            if (idx is < 1 or > 225 || board is < 11 or > 106 || board % 10 is < 1 or > 6) continue;
            if (daeBoardIds.Count > 0 && !daeBoardIds.Contains(board)) continue;
            (found ??= new()).Add(v);
        }
        return found?.Distinct().ToArray() ?? [];
    }

    protected void SetPorts(HashSet<int> now)
    {
        bool added = !now.IsSubsetOf(ports);
        ports.UnionWith(now);
        while (pending.Count > 0 && DateTime.UtcNow - pending.Peek().at > TimeSpan.FromSeconds(15)) pending.Dequeue();
        if (!added) return;
        var items = pending.ToArray();
        pending.Clear();
        foreach (var (at, ts, data) in items) Packet(ts, data, DateTime.UtcNow - at < TimeSpan.FromSeconds(15));
    }

    /// Movement, combat and other frames sent many times a second (most of a research log without this filter:
    /// 0x0638, 0x1b37, 0x1a37, 0x0538, 0x2c38, 0x0338 …). Kept out of the login ring and the research capture.
    static bool HighRate(int op) => op is 0x0036 or 0x2a38 or 0x1d37 or 0x1c37 or 0x1338 or 0x0438 or 0x0238 or 0x2b38 or 0x008d
        or 0x0638 or 0x1b37 or 0x1a37 or 0x0538 or 0x2c38 or 0x0338;

    void Frame(int op, byte[] body, DateTime ts)
    {
        GameFrames++;
        // login research: keep the recent frames; after 0x26e2 collect LoginAfter (15 s) more, then hand them over.
        // High-rate frames would push the login sequence out of the ring.
        if (!HighRate(op))
        {
            ring.Enqueue((op, body, ts));
            if (ring.Count > RingSize) ring.Dequeue();
        }
        if (loginDump != null)
        {
            if (!HighRate(op)) loginDump.Add((op, body, ts));
            if (ts > loginUntil) { DaeLoginFrames?.Invoke(loginDump); loginDump = null; }
        }
        else if (op == 0x26e2) { loginDump = ring.ToList(); loginUntil = ts + LoginAfter; }
        if (Research && !HighRate(op)) ResearchFrame?.Invoke(op, body, ts);
        if (DaeLog)
        {
            DaeOpFrame?.Invoke(op, body.Length);
            // research: currency / inventory changes (free points may be a currency) and the spent points, in full
            if (op is 0x1d56 or 0x8456 or 0x1b56 or 0x2ee2) DaeNodeFrame?.Invoke(op, body, []);
            else if (op != 0x26e2 && DaeNodeFrame != null && NodeIds(body) is { Length: > 0 } ids) DaeNodeFrame(op, body, ids);
        }
        if (OwnId != null) tracker.Feed(op, body, ts, OwnId); // own position: exact fixes (its estimate is not used)
        PlayerFrame(op, body);
        // boss helper: a malformed frame must never stop the packet processing
        try { NpcFrame(op, body, ts); Recorder?.Frame(op, body, ts); }
        catch (Exception ex) { BossErrors++; if (BossErrors <= 5) OverlayForm.Log($"Boss-Helfer: Frame 0x{op:x4} ({body.Length} B): {ex.Message}"); }
        if (op == Frames.OpPetList && PetFrames.ParseList(body) is { } list)
            PetListReceived?.Invoke(list, ts);
        else if (op == 0x0191 && (lastBossTable == null || !body.AsSpan().SequenceEqual(lastBossTable)))
        {
            lastBossTable = body; // sent every 3 s, usually unchanged
            if (PetFrames.ParseBossTable(body) is { } t) BossTable?.Invoke(t.map, t.list);
        }
        else if (op == 0x0140 && body.Length >= 4)
        {
            tracker.MapChanged();
            MapChanged?.Invoke(BitConverter.ToUInt32(body, 0));
        }
        else if (op == 0x2ee2 && PetFrames.ParseDaePoints(body) is { } pts)
            DaevanionPoints?.Invoke(pts);
        else if (op == 0x03e5 && PetFrames.ParseDaeBought(body) is { } bought)
            DaevanionChanged?.Invoke(bought, []);
        else if (op == 0x28e2 && PetFrames.ParseDaeNode(body) is { } one)
            DaevanionChanged?.Invoke([one], []);
        else if (op == 0x2be2 && PetFrames.ParseDaeNode(body) is { } reset)
            DaevanionChanged?.Invoke([], [reset]);
        else if (op == 0x29e2 && PetFrames.ParseDaeBoardReset(body) is { } boards)
            DaevanionChanged?.Invoke([], boards);
        else if (op == 0x26e2 && PetFrames.ParseDaevanion(body) is { } dae)
        {
            daeBoardIds = dae.Keys.ToHashSet();
            DaevanionReceived?.Invoke(dae);
        }
        else if (op == 0x9156 && PetFrames.ParseMerchant(body) is { } merch)
            MerchantReceived?.Invoke(merch.tab, merch.items);
        else if (op == 0x2ce3 && body.Length > 100 && PetFrames.PvpHistory(body) is { Count: > 0 } matches)
            PvpHistoryReceived?.Invoke(matches);
        else if (op == 0x0b61 && PetFrames.ParseEntryCharges(body) is { } entries)
            EntryChargesReceived?.Invoke(entries);
        else if (op == 0x0c61 && body.Length == 8 && body[1] == 0x04)
            ChargeReceived?.Invoke(BitConverter.ToUInt32(body, 2), body[6]);
        else if (op == 0x0c61 && body.Length == 7 && body[1] == 0x00)
            ChargeReceived?.Invoke(BitConverter.ToUInt32(body, 2), 0); // short form: none left (Nightmare 1 -> 0 verified)
        else if (op == 0x0c61 && body.Length >= 6 && body[1] == 0x0c && body[2] == 0x01)
        {
            // u8 ?, 0c, 01, varint id, varint energy, varint bonus, … (verified: 60 → bonus 135+10 after using a +10 item; 540/160)
            try
            {
                int o = 3;
                PetFrames.Varint(body, ref o);
                int energy = PetFrames.Varint(body, ref o), bonus = PetFrames.Varint(body, ref o);
                if (energy is >= 0 and <= 2000 && bonus is >= 0 and <= 1_000_000) OdyleReceived?.Invoke(energy, bonus);
            }
            catch (IndexOutOfRangeException) { }
        }
        else if (op == 0xacff && body.Length >= 9 && body.Length == 1 + body[0] * 5 + 8)
        {
            // u8 n; n × {u8 id, u32 used}; u64 server time ms
            var usage = new Dictionary<byte, uint>();
            for (int i = 0; i < body[0]; i++) usage[body[1 + i * 5]] = BitConverter.ToUInt32(body, 2 + i * 5);
            UsageReceived?.Invoke(usage, BitConverter.ToInt64(body, 1 + body[0] * 5));
        }
        else if (op is 0x8356 or 0x8456 && PetFrames.ParseProgress(body) is { Count: > 0 } ach)
            AchievementsReceived?.Invoke(ach, op == 0x8356);
        else if (op == Frames.OpPetSouls && PetFrames.ParseSouls(body) is { } gains)
            foreach (var (pet, g) in gains) SoulsReceived?.Invoke(pet, g, ts);
        else if (op == 0x3336 && PetFrames.CharId(body) is { } id)
        {
            OwnId = id;
            CharIdReceived?.Invoke(PetFrames.VarintValue(id));
            CharNameReceived?.Invoke(PetFrames.CharName(body));
        }
        else if (op is 0x4136 or 0x4536 && PetFrames.SpawnPosition(body) is { } sp)
        {
            OnSpawn(ts, sp.x, sp.y, sp.z);
            if (op != 0x4136 || TrackedNpcs.Count == 0) return;
            int o = 0;
            uint ent = (uint)PetFrames.Varint(body, ref o);
            if (o + 7 <= body.Length && BitConverter.ToUInt32(body, o + 3) is var npc && TrackedNpcs.Contains(npc))
            {
                bossEntities[ent] = npc;
                BossEvent?.Invoke(npc, false);
            }
        }
        else if (op == 0x4236 && bossEntities.Count > 0 && body.Length >= 3)
        {
            int o = 0;
            uint ent = (uint)PetFrames.Varint(body, ref o);
            if (o + 1 < body.Length && bossEntities.Remove(ent, out var npc)) BossEvent?.Invoke(npc, body[o + 1] == 3);
        }
        else if (op == 0x3436 && PetFrames.ObjectSpawn(body) is { } obj)
        {
            objects.Add(obj.ent);
            ObjectSpawned?.Invoke(obj.ent, obj.env, obj.x / 100, obj.y / 100, obj.z / 100);
            OnSpawn(ts, obj.x, obj.y, obj.z);
        }
        else if (op == 0x3536 && body.Length >= 2)
        {
            int o = 0;
            uint ent = (uint)PetFrames.Varint(body, ref o);
            if (o < body.Length && objects.Remove(ent)) ObjectRemoved?.Invoke(ent, body[o]);
        }
    }

    void NpcFrame(int op, byte[] body, DateTime ts)
    {
        if (op == 0x0140) { modEntities.Clear(); hpSent.Clear(); return; }
        if (op is not (0x4136 or 0x0238 or 0x0638 or 0x4236 or 0x0438 or 0x008d or 0x3538) || BossModNpcs.Count == 0 && !BossModAll) return;
        if (op == 0x4136)
        {
            if (PetFrames.NpcSpawn(body) is not { } sp) return;
            var (ent, id) = sp;
            if (!BossModAll && !BossModNpcs.Contains(id)) return;
            modEntities[ent] = id;
            NpcSpawned?.Invoke(id, ent, ts);
        }
        else if (modEntities.Count == 0) return;
        else if (op == 0x0238 && PetFrames.CastStart(body) is { } c && modEntities.TryGetValue(c.ent, out var npc))
            NpcCast?.Invoke(npc, c.ent, c.skill, c.seq, c.target, ts);
        else if (op == 0x0638 && PetFrames.CastEnd(body) is { } e && modEntities.TryGetValue(e.ent, out npc))
            NpcCastEnd?.Invoke(npc, e.ent, e.skill, e.seq, ts);
        else if (op == 0x0438 && PetFrames.Hit(body) is { } h && modEntities.TryGetValue(h.caster, out npc) && !modEntities.ContainsKey(h.target))
            NpcHit?.Invoke(npc, h.caster, h.skill, h.seq, h.target, h.flags, ts);
        else if (op == 0x008d && PetFrames.NpcHp(body) is { } hp && modEntities.TryGetValue(hp.ent, out npc)
                 && (!hpSent.TryGetValue(hp.ent, out var last) || ts - last >= TimeSpan.FromMilliseconds(250)))
        {
            hpSent[hp.ent] = ts;
            NpcHp?.Invoke(npc, hp.ent, hp.hp, ts);
        }
        else if (op == 0x3538 && PetFrames.Target(body) is { } tg && modEntities.TryGetValue(tg.ent, out npc))
            NpcTarget?.Invoke(npc, tg.ent, tg.target, ts);
        else if (op == 0x4236 && PetFrames.VarintLen(body, 0) is > 0 and var k && k + 1 < body.Length)
        {
            int o = 0;
            uint ent = (uint)PetFrames.Varint(body, ref o);
            hpSent.Remove(ent);
            if (o + 1 < body.Length && modEntities.Remove(ent, out npc)) NpcGone?.Invoke(npc, ent, body[o + 1] == 3, ts);
        }
    }

    void PlayerFrame(int op, byte[] body)
    {
        if (op is 0x2a38 or 0x2336 && OwnId != null && PlayerFrames.OwnFix(op, body, OwnId) is { } me) OwnPvpPos?.Invoke(me.x, me.y, me.z);
        if (PlayerFrames.MoveOffset(op) is >= 0 and var skip)
        {
            if (players.Count > 0 && PlayerFrames.Move(body, skip, out uint ent, out var p) && players.Contains(ent))
                PlayerMoved?.Invoke(ent, p.x, p.y, p.z);
        }
        else if (op == 0x4536 && PlayerFrames.ParsePlayer(body) is { } pl)
        {
            players.Add(pl.Ent);
            PlayerSpawned?.Invoke(pl);
        }
        else if (op == 0x4736 && PlayerFrames.Gone(body) is { } gone && players.Remove(gone.ent)) PlayerGone?.Invoke(gone.ent, gone.reason);
        else if (op == 0x048d && PlayerFrames.ParseKill(body) is { } kill
                 && (players.Contains(kill.victim) || OwnId != null && kill.victim == PetFrames.VarintValue(OwnId)))
            PlayerKilled?.Invoke(kill.victim, kill.killer, kill.server, kill.name);
        else if (op == 0x19e3 && body.Length > 64 && PlayerFrames.ParseRoster(body) is { } roster) RosterReceived?.Invoke(roster);
        else if (op == 0x3336 && PlayerFrames.ParseOwn(body) is { } own) OwnInfoReceived?.Invoke(own);
        else if (op == 0x5636 && PlayerFrames.OwnCp(body) is > 0 and var cp) OwnCpReceived?.Invoke(cp);
        else if (op == 0xa9ff && PlayerFrames.Ap(body) is >= 0 and var ap) ApReceived?.Invoke(ap);
        else if (op == 0x1b56 && PlayerFrames.Inventory(body) is { Count: > 0 } inv) InventoryReceived?.Invoke(inv);
        else if (op is 0x92 or 0xd92 or 0x2292 && PlayerFrames.ParseParty(body) is { Count: > 0 } party) PartyReceived?.Invoke(party, op == 0x92);
        else if (op == 0x1f92 && body.Length == 1) PartyLeft?.Invoke();
        else if (op == 0x0140) players.Clear();
    }

    void OnSpawn(DateTime ts, float x, float y, float z)
    {
        spawns.Enqueue((ts, x, y, z));
        // 10 s / 2 spawns incl. world objects: ~90 % coverage, median error ~19 m (measured on a 30 min capture).
        while (spawns.Count > 0 && ts - spawns.Peek().ts > TimeSpan.FromSeconds(10)) spawns.Dequeue();
        if (ts - lastOwnPos < TimeSpan.FromSeconds(20) || ts - lastEstimate < TimeSpan.FromSeconds(1) || spawns.Count < 2) return;
        lastEstimate = ts;
        float sx = 0, sy = 0, sz = 0;
        foreach (var e in spawns) { sx += e.x; sy += e.y; sz += e.z; }
        int n = spawns.Count;
        PositionEstimated?.Invoke(sx / n / 100, sy / n / 100, sz / n / 100, 25, ts);
    }

    public abstract void Start();
    public virtual void Dispose() { }
}

sealed class LiveCapture(string processName) : PetSource
{
    LibPcapLiveDevice? device;
    System.Threading.Timer? poll;
    readonly object open = new();
    // Status diagnosis: since when the game has connections on the current adapter, and the counters at that point.
    DateTime connAt;
    long segAt, frameAt;
    string? lastStatus;
    static readonly TimeSpan Silence = TimeSpan.FromSeconds(30);

    public override void Start()
    {
        System.Net.IPAddress? local = null;
        try { local = LocalAddress(); }
        catch (Exception ex) { OverlayForm.Log("Capture: keine Standard-Route – " + ex.Message); }
        if (local != null && !Open(local, out var err)) { Status("error", err); return; }
        poll = new System.Threading.Timer(_ => Poll(), null, 0, 1000);
    }

    /// Opens the Npcap adapter with this address in place of the current one; false + reason if it cannot.
    bool Open(System.Net.IPAddress ip, out string err)
    {
        err = "";
        lock (open)
        {
            LibPcapLiveDevice? next;
            try { next = LibPcapLiveDeviceList.Instance.FirstOrDefault(d => d.Addresses.Any(a => Equals(a.Addr?.ipAddress, ip))); }
            catch (Exception ex) when (ex is not OutOfMemoryException)
            {
                err = ex is DllNotFoundException || ex.InnerException is DllNotFoundException
                    ? L.T("Npcap nicht gefunden – bitte Npcap installieren.", "Npcap not found – please install Npcap.") : ex.Message;
                OverlayForm.Log("Capture: Npcap-Fehler – " + ex);
                return false;
            }
            if (next == null)
            {
                err = L.T($"Kein Npcap-Adapter mit IP {ip} – VPN oder virtueller Adapter?", $"No Npcap adapter with IP {ip} – VPN or virtual adapter?");
                OverlayForm.Log($"Capture: kein Adapter mit {ip}; vorhanden: " + string.Join(" | ", LibPcapLiveDeviceList.Instance
                    .Select(d => $"{d.Description} [{string.Join(", ", d.Addresses.Select(a => a.Addr?.ipAddress).Where(a => a != null))}]")));
                return false;
            }
            try
            {
                Close();
                next.OnPacketArrival += (_, e) =>
                {
                    var raw = e.GetPacket();
                    lock (Sync) Packet(raw.Timeval.Date, raw.Data.ToArray());
                };
                next.Open(new DeviceConfiguration { Mode = DeviceModes.MaxResponsiveness, ReadTimeout = 200, BufferSize = 16 << 20 });
                LinkType = (int)next.LinkType;
                next.Filter = "tcp and not net 127.0.0.0/8";
                next.StartCapture();
                device = next;
                connAt = default;
                OverlayForm.Log($"Capture: Adapter {next.Description} ({ip}), Link-Typ {LinkType}{(Packets.Supported(LinkType) ? "" : " – nicht unterstützt")}");
                return true;
            }
            catch (Exception ex) when (ex is not OutOfMemoryException)
            {
                err = ex.Message;
                OverlayForm.Log($"Capture: Adapter {next.Description} ({ip}) nicht geöffnet – {ex}");
                return false;
            }
        }
    }

    bool OnDevice(System.Net.IPAddress ip) => device?.Addresses.Any(a => Equals(a.Addr?.ipAddress, ip)) == true;

    void Poll()
    {
        HashSet<int> now;
        HashSet<System.Net.IPAddress> local;
        bool run, proxied;
        try { now = Native.GamePorts(processName, out run, out local, out proxied); }
        catch (Exception ex) { Status("error", L.T("Verbindungen des Spiels nicht lesbar: ", "Cannot read the game's connections: ") + ex.Message); return; }
        lock (Sync) SetPorts(now);

        // the game's traffic runs over another adapter than the default route (VPN, second network card): follow it
        if (local.Count > 0 && !local.Any(OnDevice))
        {
            var ip = local.First();
            OverlayForm.Log($"Capture: Spiel nutzt {ip}, aktueller Adapter {device?.Description ?? "keiner"} – wechsle");
            if (!Open(ip, out var err)) { Status("error", err); return; }
        }

        if (!run) { connAt = default; Status("waiting", L.T("Warte auf Aion 2 …", "Waiting for Aion 2 …")); return; }
        if (now.Count == 0)
        {
            connAt = default;
            if (proxied) Status("error", L.T("Aion 2 verbindet über einen lokalen Proxy (ExitLag, NoPing o.ä.) – Spieldaten nicht lesbar.",
                                             "Aion 2 connects through a local proxy (ExitLag, NoPing etc.) – game data not readable."));
            else Status("live", L.T("Live – Aion 2 erkannt", "Live – Aion 2 detected"));
            return;
        }
        long seg, frames;
        lock (Sync) (seg, frames) = (GameSegments, GameFrames);
        if (connAt == default) (connAt, segAt, frameAt) = (DateTime.UtcNow, seg, frames);
        bool due = DateTime.UtcNow - connAt > Silence;
        if (due && seg == segAt)
            Status("error", L.T($"Keine Spieldaten auf Adapter {device?.Description} – VPN/Firewall? Details in log.txt.",
                                $"No game data on adapter {device?.Description} – VPN/firewall? Details in log.txt."));
        else if (due && frames == frameAt)
            Status("error", L.T("Spieldaten kommen an, sind aber nicht lesbar (neue Spielversion?).", "Game data arrives but cannot be read (new game version?)."));
        else
        {
            Status("live", L.T("Live – Aion 2 erkannt", "Live – Aion 2 detected"));
            if (due) (connAt, segAt, frameAt) = (DateTime.UtcNow, seg, frames); // next window
        }
    }

    void Status(string state, string text)
    {
        if (lastStatus == state + text) return;
        lastStatus = state + text;
        SetStatus(state, text);
    }

    static System.Net.IPAddress LocalAddress()
    {
        // UDP connect sends nothing; it only asks the routing table which local address would be used.
        using var s = new System.Net.Sockets.Socket(System.Net.Sockets.AddressFamily.InterNetwork,
            System.Net.Sockets.SocketType.Dgram, System.Net.Sockets.ProtocolType.Udp);
        s.Connect("8.8.8.8", 53);
        return ((System.Net.IPEndPoint)s.LocalEndPoint!).Address;
    }

    void Close()
    {
        try { device?.StopCapture(); device?.Close(); } catch { }
        device = null;
    }

    public override void Dispose()
    {
        poll?.Dispose();
        lock (open) Close();
    }
}

// Plays a capture_logger.py recording (game.pcap + connections.jsonl) through the same decoder.
sealed class ReplayCapture(string dir, double speed) : PetSource
{
    public override void Start() => Task.Run(() =>
    {
        try
        {
            var conns = File.ReadLines(Path.Combine(dir, "connections.jsonl"))
                .Select(l => JsonDocument.Parse(l).RootElement)
                .Where(c => c.GetProperty("proto").GetString() == "tcp"
                            && c.TryGetProperty("rport", out var rp) && rp.GetInt32() is not (0 or 80 or 443)
                            && !(c.GetProperty("remote").GetString() ?? "").StartsWith("127."))
                .Select(c => c.GetProperty("lport").GetInt32()).ToHashSet();
            var packets = Packets.ReadPcap(Path.Combine(dir, "game.pcap"), out LinkType);
            SetStatus("replay", $"Replay: {Path.GetFileName(dir.TrimEnd('\\', '/'))}");
            lock (Sync) SetPorts(conns);
            // Replay clock: capture time / speed, idle gaps capped at 5 s.
            DateTime? prev = null;
            var due = DateTime.UtcNow;
            foreach (var (ts, data) in packets)
            {
                if (speed > 0 && prev is { } p && ts > p)
                {
                    due += TimeSpan.FromTicks((long)Math.Min((ts - p).Ticks / speed, TimeSpan.TicksPerSecond * 5));
                    if (due - DateTime.UtcNow is { TotalMilliseconds: > 15 } wait) Thread.Sleep(wait);
                }
                prev = ts;
                lock (Sync) Packet(ts, data, false);
            }
            SetStatus("replay", L.T("Replay fertig: ", "Replay finished: ") + $"{Path.GetFileName(dir.TrimEnd('\\', '/'))}");
        }
        catch (Exception ex) { SetStatus("error", L.T("Replay fehlgeschlagen: ", "Replay failed: ") + ex.Message); }
    });
}
