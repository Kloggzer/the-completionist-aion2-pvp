using System.Buffers.Binary;

namespace PetOverlay;

/// Another player as the server describes it when it comes into range (0x4536). 0 = unknown.
sealed record PlayerSpawn(uint Ent, string Name, int PcId, int Race, int Gender, float X, float Y, float Z,
    int Server, int Level, int ItemLevel, int Cp);

/// One member of an arena match roster (0x19e3). Team 1/2 in the order the roster lists them.
sealed record RosterEntry(string Name, int Server, int PcId, int Race, int Level, int Team, int Rating);

/// Member of the own party / alliance (0x92 list, 0xd92 / 0x2292 single member). 0 = unknown.
sealed record PartyMember(string Name, int Server, int PcId, int Level, int ItemLevel, int Cp);

/// Own character from 0x3336 (sent at login and on every map change).
sealed record OwnInfo(string Name, int Server, int PcId, int Race, int Level, int ItemLevel);

// Other players (PvP overlay). Verified on captures/20261019-201703 (arena 5v5 + Azphel open world, 52 spawns) against
// the arena history JSON (0x2ce3) and NCSOFT's character website (CP, item level, class, server exact for 40+ players).
static class PlayerFrames
{
    static uint U32(byte[] b, int o) => BinaryPrimitives.ReadUInt32LittleEndian(b.AsSpan(o));
    static int U16(byte[] b, int o) => BinaryPrimitives.ReadUInt16LittleEndian(b.AsSpan(o));

    /// Server keys: 1xxx Elyos / 2xxx Asmodian, x1xx NA-East (1101.., 2101..), x3xx Europe (1301.., 2301..).
    public static bool ValidServer(int v) => v / 100 is 11 or 13 or 21 or 23 && v % 100 is >= 1 and <= 99;

    /// Plausible coordinates of another player (cm). Looser than PetFrames.Plausible: arenas sit around 0/0.
    static bool Pos(float x, float y, float z) =>
        float.IsFinite(x) && float.IsFinite(y) && float.IsFinite(z) && Math.Abs(x) < 400000 && Math.Abs(y) < 400000
        && z is > -20000 and < 80000 && !(x == 0 && y == 0);

    static string? Name(byte[] b, int o, int len)
    {
        if (len is < 1 or > 48 || o + len > b.Length) return null;
        try
        {
            var s = new System.Text.UTF8Encoding(false, true).GetString(b, o, len);
            return s.Length > 0 && s.All(char.IsLetterOrDigit) ? s : null;
        }
        catch (System.Text.DecoderFallbackException) { return null; }
    }

    // 0x4536 player spawn:
    //   varint entity, 4 bytes ?, 07, u8 len + UTF-8 name, u32 pcId (class + look: class = ceil(pcId / 4),
    //   e.g. 12 Templar, 15/16 Ranger), u8 race (1 Elyos, 2 Asmodian), u8 gender, 2 bytes ?, x, y, z float32 cm,
    //   ... stats (ends "a0860100 a0860100", 2 u32), title ids, u16 server (followed by "xx 10..13", or by a legion:
    //   u32 id, u16 0, u16 server, u8 len + legion name), ... "f4 ff ff", u8 level, 7 x 00, u32 item level, ...,
    //   near the end: u32 ?, u32 small (1..255), [1 byte], u32 combat power, 5-6 trailing bytes.
    public static PlayerSpawn? ParsePlayer(byte[] b)
    {
        try
        {
            int o = 0;
            uint ent = (uint)PetFrames.Varint(b, ref o);
            o += 4;
            // 07 in towns / open world / arena, 17 in the Abyss: flag 0x10 adds one byte after the gender
            if (o + 2 >= b.Length || (b[o] & 0xef) != 7) return null;
            int extra = (b[o] & 0x10) != 0 ? 1 : 0;
            int len = b[o + 1];
            if (Name(b, o + 2, len) is not { } name) return null;
            o += 2 + len;
            if (o + 20 + extra > b.Length) return null;
            int pc = (int)U32(b, o), race = b[o + 4], gender = b[o + 5];
            if (pc is < 1 or > 200 || race is not (1 or 2)) return null;
            o += extra;
            float x = BitConverter.ToSingle(b, o + 8), y = BitConverter.ToSingle(b, o + 12), z = BitConverter.ToSingle(b, o + 16);
            if (!Pos(x, y, z)) return null;
            int stats = b.AsSpan(o + 20).IndexOf(StatMark);
            int lv = LevelItem(b, out int il);
            return new PlayerSpawn(ent, name, pc, race, gender, x, y, z,
                Server(b, stats >= 0 ? o + 20 + stats + StatMark.Length : o + 20), lv, il, Cp(b));
        }
        catch (Exception e) when (e is IndexOutOfRangeException or ArgumentOutOfRangeException) { return null; }
    }

    static readonly byte[] StatMark = [0xa0, 0x86, 0x01, 0x00, 0xa0, 0x86, 0x01, 0x00];

    static int Server(byte[] b, int from)
    {
        for (int i = from; i < Math.Min(from + 64, b.Length - 10); i++)
        {
            int v = U16(b, i);
            if (ValidServer(v) && (b[i + 3] is >= 0x10 and <= 0x13 || U16(b, i + 8) == v)) return v;
        }
        return 0;
    }

    static readonly byte[] LvMark = [0xf4, 0xff, 0xff];

    static int LevelItem(byte[] b, out int il)
    {
        il = 0;
        for (int i = b.AsSpan().LastIndexOf(LvMark); i >= 0; i = b.AsSpan(0, i).LastIndexOf(LvMark))
            if (i + 15 <= b.Length && b[i + 3] is >= 1 and <= 99 && b.AsSpan(i + 4, 7).IndexOfAnyExcept((byte)0) < 0)
            {
                uint v = U32(b, i + 11);
                if (v is > 0 and < 20000) { il = (int)v; return b[i + 3]; }
            }
        return 0;
    }

    static readonly byte[] CpMark = [0xf4, 0xcb, 0x1f];

    static int Cp(byte[] b)
    {
        foreach (int end in new[] { b.Length - 9, b.Length - 10 })
        {
            if (end < 8) continue;
            uint small = U32(b, end - 4), a = U32(b, end - 8);
            if (small is < 1 or > 255 || a is < 100 or > 65535) continue;
            if (U32(b, end) is >= 1 and <= 3_000_000 and var cp) return (int)cp;
            if (end + 5 <= b.Length && U32(b, end + 1) is >= 1 and <= 3_000_000 and var cp2) return (int)cp2;
        }
        // "f4 cb 1f", u32 ?, [u32 small], u32 combat power, 5-6 bytes: low-level characters (Lv18/19, city) lack the small u32
        int m = b.AsSpan().LastIndexOf(CpMark);
        if (m >= 0 && b.Length - m == 16 && U32(b, m + 3) is >= 100 and <= 65535 && U32(b, m + 7) is >= 1 and <= 3_000_000 and var cp3)
            return (int)cp3;
        return 0;
    }

    // 0x19e3 (S2C) arena roster at match start: header, then per team {u8 team, u64 avg rating, u32 ?, u8 count,
    // u64 0, count x player}; player = u32 id, u16 0, u16 home server, u8 len + name, u32 pcId, u8 race, u8 level,
    // 7 x 00, u16 server, u64 rating, 02, u64 rating, u8, u8, 00, u32 ?, 00 (then u64 0 before the next player).
    // Players are found by their shape; a gap longer than the 8-byte separator starts the next team.
    public static List<RosterEntry>? ParseRoster(byte[] b)
    {
        var list = new List<RosterEntry>();
        int team = 1, prevEnd = -1;
        try
        {
            for (int i = 0; i + 9 < b.Length;)
            {
                int len = b[i + 8];
                if (len is >= 2 and <= 48 && b[i + 4] == 0 && b[i + 5] == 0 && i + 9 + len + 23 <= b.Length && Name(b, i + 9, len) is { } name)
                {
                    int o = i + 9 + len;
                    int pc = (int)U32(b, o), race = b[o + 4], lv = b[o + 5];
                    if (pc is >= 1 and <= 200 && race is 1 or 2 && lv is >= 1 and <= 99 && b.AsSpan(o + 6, 7).IndexOfAnyExcept((byte)0) < 0)
                    {
                        int srv = U16(b, o + 13);
                        if (!ValidServer(srv)) srv = U16(b, i + 6);
                        if (prevEnd >= 0 && i - prevEnd > 12) team++;
                        int rating = (int)Math.Min(U32(b, o + 15), 99999);
                        list.Add(new RosterEntry(name, ValidServer(srv) ? srv : 0, pc, race, lv, team, rating));
                        prevEnd = o + 13 + 27;
                        i = o + 13;
                        continue;
                    }
                }
                i++;
            }
        }
        catch (Exception e) when (e is IndexOutOfRangeException or ArgumentOutOfRangeException) { }
        return list.Count >= 2 && team == 2 ? list : null;
    }

    // 0x3336: own id varint, a few bytes, u8 len + name, u16 server, u32 pcId, u8 race, u32 level, u32 item level.
    public static OwnInfo? ParseOwn(byte[] b)
    {
        for (int o = 1; o < 30 && o < b.Length; o++)
        {
            int len = b[o];
            if (len is < 2 or > 48 || o + 1 + len + 15 > b.Length || Name(b, o + 1, len) is not { } name || !name.Any(char.IsLetter)) continue;
            int p = o + 1 + len, srv = U16(b, p), pc = (int)U32(b, p + 2), race = b[p + 6];
            uint lv = U32(b, p + 7), il = U32(b, p + 11);
            if (race is not (1 or 2) || pc is < 1 or > 200) return null;
            return new OwnInfo(name, ValidServer(srv) ? srv : 0, pc, race, lv is >= 1 and <= 99 ? (int)lv : 0, il is > 0 and < 20000 ? (int)il : 0);
        }
        return null;
    }

    // Own party / alliance (checked on captures/20261019-201703: arena party of 5, afterwards the duo Testdaeva + Maestro):
    //   0x92 full list (u8 0, u32 ?, u32 ?, u32 leader char id, ..., then the members), 0xd92 one member added or
    //   changed, 0x2292 one member's status, 0x1f92 (1 byte) own party left / dissolved (arena end, before the new list).
    //   Member: 03, u8 slot, u32 entity (0 = not around), u16 server, u16 ?, u8 36 + GUID text, u32 char id, u16 0,
    //   u16 server, u8 len + name, u32 pcId, hp / mp, map, x, y, z, u8 ?, u8 len + legion name, u32 ?, u32 level,
    //   8 x 00, u32 item level, u32 combat power, ...
    public static List<PartyMember> ParseParty(byte[] b)
    {
        var list = new List<PartyMember>();
        try
        {
            for (int i = 0; i + 37 < b.Length; i++)
            {
                if (b[i] != 0x24 || !Guid(b, i + 1)) continue;
                int o = i + 37;
                if (o + 9 > b.Length || U16(b, o + 4) != 0) continue;
                int srv = U16(b, o + 6), len = b[o + 8];
                if (Name(b, o + 9, len) is not { } name || o + 9 + len + 4 > b.Length) continue;
                int p = o + 9 + len, pc = (int)U32(b, p);
                if (pc is < 1 or > 200) continue;
                int lv = 0, il = 0, cp = 0;
                for (int k = p + 4; k + 21 <= b.Length && k < p + 200; k++)
                {
                    uint a = U32(b, k), l = U32(b, k + 4), ilv = U32(b, k + 12);
                    if (a is < 1 or > 15 || l is < 1 or > 99 || U32(b, k + 8) != 0 || ilv is < 1 or >= 20000) continue;
                    // the combat power directly after the item level, or one byte later (seen once in a 0x92 list)
                    uint c = U32(b, k + 16) is >= 1 and <= 3_000_000 and var c0 ? c0 : U32(b, k + 17);
                    if (c is >= 1 and <= 3_000_000) { lv = (int)l; il = (int)ilv; cp = (int)c; break; }
                }
                list.Add(new PartyMember(name, ValidServer(srv) ? srv : 0, pc, lv, il, cp));
                i = p + 3;
            }
        }
        catch (Exception e) when (e is IndexOutOfRangeException or ArgumentOutOfRangeException) { }
        return list;
    }

    /// "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX" (upper-case hex) at o.
    static bool Guid(byte[] b, int o)
    {
        if (o + 36 > b.Length) return false;
        for (int j = 0; j < 36; j++)
        {
            byte c = b[o + j];
            bool dash = j is 8 or 13 or 18 or 23;
            if (dash ? c != (byte)'-' : !(c is >= (byte)'0' and <= (byte)'9' or >= (byte)'A' and <= (byte)'F')) return false;
        }
        return true;
    }

    /// 0xa9ff (16 bytes): own Abyss points as u64, then u64 2,000,000 (the cap). Sent after every kill credit; on
    /// captures/20261023-011739 it only rose for Abyss guards (8058 -> 8061 -> 8067), not for normal mobs. -1 = no match.
    public static long Ap(byte[] b) =>
        b.Length == 16 && BinaryPrimitives.ReadInt64LittleEndian(b.AsSpan(8)) is > 0 and var max && BinaryPrimitives.ReadInt64LittleEndian(b) is >= 0 and var ap && ap <= max ? ap : -1;

    /// 0x5636 (16 bytes, several times while the client recalculates): own combat power as the first u32.
    public static int OwnCp(byte[] b) => b.Length == 16 && U32(b, 0) is >= 1 and <= 3_000_000 and var cp ? (int)cp : 0;

    // Movement of other entities: varint entity, 2 (or 1) bytes, x, y, z float32 cm. Checked on the player entities of
    // the capture (4-25 m/s); 0x1e37 / 0x1f37 have other layouts and are not used.
    public static int MoveOffset(int op) => op switch
    {
        0x1a37 or 0x1b37 or 0x1c37 or 0x2837 or 0x2937 => 2,
        0x2f37 => 1,
        _ => -1,
    };

    public static bool Move(byte[] b, int skip, out uint ent, out (float x, float y, float z) p)
    {
        p = default; ent = 0;
        int k = PetFrames.VarintLen(b, 0);
        if (k == 0 || k + skip + 12 > b.Length) return false;
        int o = 0;
        ent = (uint)PetFrames.Varint(b, ref o);
        p = (BitConverter.ToSingle(b, k + skip), BitConverter.ToSingle(b, k + skip + 4), BitConverter.ToSingle(b, k + skip + 8));
        return Pos(p.x, p.y, p.z);
    }

    /// Own position for distances, like PetFrames.OwnFix (0x2a38 own id from index 8, x, y, z 4 or 8 bytes after it;
    /// 0x2336 teleport) but with the looser check of other players: arenas lie around 0/0, which PetFrames.Plausible
    /// rejects (|x|, |y| >= 10 m), so the map features get no own position there. 1 cm minimum keeps out the
    /// "u32 0 + shifted x, y" reading of the long 0x2a38 form.
    public static (float x, float y, float z)? OwnFix(int op, byte[] b, byte[] own)
    {
        static bool At(byte[] b, int o, out (float x, float y, float z) p)
        {
            p = default;
            if (o < 0 || o + 12 > b.Length) return false;
            p = (BitConverter.ToSingle(b, o), BitConverter.ToSingle(b, o + 4), BitConverter.ToSingle(b, o + 8));
            return Pos(p.x, p.y, p.z) && Math.Abs(p.x) >= 1 && Math.Abs(p.y) >= 1;
        }
        (float x, float y, float z) p;
        if (op == 0x2a38)
            for (int i = b.AsSpan().IndexOf(own); i >= 0;)
            {
                if (i >= 8 && (At(b, i + 4, out p) || At(b, i + 8, out p))) return p;
                int next = b.AsSpan(i + 1).IndexOf(own);
                i = next < 0 ? -1 : i + 1 + next;
            }
        else if (op == 0x2336 && b.Length >= 18 && At(b, 6, out p)) return p;
        return null;
    }

    /// 0x4736: player gone (varint entity, reason: 01 out of range, 04 died, 0a left / logged out, 02 ? (often in the
    /// Abyss, e.g. teleported away), then one more byte). Reason 0 = missing.
    public static (uint ent, int reason)? Gone(byte[] b)
    {
        int k = PetFrames.VarintLen(b, 0);
        if (k == 0 || b.Length > k + 4) return null;
        int o = 0;
        uint ent = (uint)PetFrames.Varint(b, ref o);
        return (ent, o < b.Length ? b[o] : 0);
    }

    /// 0x4736 reason: died.
    public const int GoneDied = 4;

    // 0x048d (S2C) kill credit when something dies: varint victim, 3 bytes ?, 00, varint killer, u16 killer server,
    // u8 len + killer name, u8 len + legion, ... Verified on captures/20261023-011739: the Asmodian Ipop killed by the
    // Elyos Boika (Ariel 1306, never in range himself, Ipop gone 2.8 s later with reason 04); NPC kills credited to the
    // own character or to the player who killed them.
    public static (uint victim, uint killer, int server, string name)? ParseKill(byte[] b)
    {
        try
        {
            int o = 0;
            uint victim = (uint)PetFrames.Varint(b, ref o);
            o += 3;
            if (b[o++] != 0) return null;
            uint killer = (uint)PetFrames.Varint(b, ref o);
            int srv = U16(b, o);
            if (!ValidServer(srv) || Name(b, o + 3, b[o + 2]) is not { } name) return null;
            return (victim, killer, srv, name);
        }
        catch (Exception e) when (e is IndexOutOfRangeException or ArgumentOutOfRangeException) { return null; }
    }

    // 0x1b56 own inventory update (checked on all 7 captures: 15373 frames, 16516 of 16522 records are item ids of
    // aion2data's item list): u8 record count, then per record u8 ?, u8 ?, u32 item uid (slot instance), 3 bytes ?,
    // u8 0, u32 item id, i64 count, then a variable tail (34-48 bytes for stacks, ~100 for equipment with stats). The
    // records are found by splitting the frame into `count` parts whose heads look like one (uid < 2^24, id 10^8..10^9
    // with a non-zero low half, count < 2^32). Login sends the whole inventory this way; a loot = a count that rose or
    // a new uid. Kina and Abyss points are items too.
    public static List<(uint Uid, uint Id, long Count)>? Inventory(byte[] b)
    {
        if (b.Length < 23 || b[0] == 0) return null;
        int n = b[0];
        bool Head(int q)
        {
            if (q + 22 > b.Length || b[q + 5] != 0 || b[q + 6] != 0 || b[q + 9] != 0) return false;
            uint id = U32(b, q + 10);
            long c = BinaryPrimitives.ReadInt64LittleEndian(b.AsSpan(q + 14));
            return id is >= 100_000_000 and < 1_000_000_000 && (id & 0xffff) != 0 && c is >= 0 and < 1L << 32;
        }
        var dead = new HashSet<(int, int)>();
        var starts = new List<int>();
        bool Go(int p, int k)
        {
            if (k == n) return p == b.Length;
            if (dead.Contains((p, k)) || !Head(p)) return false;
            starts.Add(p);
            for (int len = 34; len < 400 && p + len <= b.Length; len++)
                if (Go(p + len, k + 1)) return true;
            starts.RemoveAt(starts.Count - 1);
            dead.Add((p, k));
            return false;
        }
        if (!Go(1, 0)) return null;
        return starts.Select(q => (U32(b, q + 2), U32(b, q + 10), BinaryPrimitives.ReadInt64LittleEndian(b.AsSpan(q + 14)))).ToList();
    }
}
