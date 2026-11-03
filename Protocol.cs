using System.Buffers.Binary;
using System.Text.Json;
using K4os.Compression.LZ4;

namespace PetOverlay;

// Game framing: LEB128 length L, frame = L + varint_len - 4 bytes, opcode = 2 bytes big-endian after the varint.
// 0xFFFF = LZ4 bundle (u32 LE raw size + raw LZ4 block of more frames). See tools/analyze_capture.py.
static class Frames
{
    public const int OpPetList = 0x0090, OpPetSouls = 0x0d90, OpBundle = 0xFFFF;

    static long Varint(byte[] b, int pos, int end, out int len)
    {
        long v = 0;
        for (int n = 0; n < 5; n++)
        {
            if (pos + n >= end) break;
            byte x = b[pos + n];
            v |= (long)(x & 0x7F) << (7 * n);
            if ((x & 0x80) == 0) { len = n + 1; return v; }
        }
        len = 0;
        return -1;
    }

    // Emits complete frames and returns how many bytes were consumed; an incomplete tail stays for the next call.
    public static int Split(byte[] buf, int pos, int end, Action<int, byte[]> emit)
    {
        while (pos < end)
        {
            if (buf[pos] == 0) { pos++; continue; } // padding between frames
            if (buf[pos] == 0x17)
            {
                if (pos + 5 > end) break;
                if (buf[pos + 1] == 3 && buf[pos + 2] == 3) // TLS record on a side channel
                {
                    int rec = 5 + (buf[pos + 3] << 8 | buf[pos + 4]);
                    if (pos + rec > end) break;
                    pos += rec;
                    continue;
                }
            }
            long L = Varint(buf, pos, end, out int n);
            if (n == 0)
            {
                if (end - pos >= 5) { pos++; continue; }
                break;
            }
            long total = L + n - 4;
            if (total < n + 2 || total > 1 << 20) { pos++; continue; } // resync
            if (pos + total > end) break;
            emit(buf[pos + n] << 8 | buf[pos + n + 1], buf.AsSpan(pos + n + 2, (int)total - n - 2).ToArray());
            pos += (int)total;
        }
        return pos;
    }

    public static void Expand(int op, byte[] body, Action<int, byte[]> emit, int depth = 0)
    {
        if (op == OpBundle && body.Length >= 4 && depth < 4)
        {
            int size = BinaryPrimitives.ReadInt32LittleEndian(body);
            if (size > 0 && size <= 1 << 24)
            {
                var raw = new byte[size];
                if (LZ4Codec.Decode(body, 4, body.Length - 4, raw, 0, size) == size)
                {
                    Split(raw, 0, raw.Length, (o, b) => Expand(o, b, emit, depth + 1));
                    return;
                }
            }
        }
        emit(op, body);
    }
}

// In-order payload of one TCP direction, cut into game frames.
sealed class TcpStream
{
    uint? next;
    readonly Dictionary<uint, byte[]> ooo = new();
    byte[] buf = new byte[64 * 1024];
    int len;

    public void Add(uint seq, byte flags, ReadOnlySpan<byte> data, Action<int, byte[]> emit)
    {
        if ((flags & 0x02) != 0) { next = seq + 1; return; } // SYN
        if (data.IsEmpty) return;
        next ??= seq; // joined mid-stream; framing resyncs on its own
        if (seq - next.Value >= 0x80000000) // old data / partial retransmit
        {
            uint skip = next.Value - seq;
            if (skip >= data.Length) return;
            data = data[(int)skip..];
            seq = next.Value;
        }
        if (seq != next)
        {
            ooo[seq] = data.ToArray();
            // A segment the capture never saw would stall the stream forever: jump the gap and resync.
            if (ooo.Count > 200)
            {
                next = ooo.Keys.MinBy(k => k - next.Value);
                len = 0;
                Flush(emit);
            }
            return;
        }
        Append(data);
        next = seq + (uint)data.Length;
        Flush(emit);
    }

    void Flush(Action<int, byte[]> emit)
    {
        while (ooo.Remove(next!.Value, out var d))
        {
            Append(d);
            next += (uint)d.Length;
        }
        int used = Frames.Split(buf, 0, len, (op, body) => Frames.Expand(op, body, emit));
        Buffer.BlockCopy(buf, used, buf, 0, len - used);
        len -= used;
        if (len > 4 << 20) len = 0;
    }

    void Append(ReadOnlySpan<byte> d)
    {
        if (len + d.Length > buf.Length) Array.Resize(ref buf, Math.Max(buf.Length * 2, len + d.Length));
        d.CopyTo(buf.AsSpan(len));
        len += d.Length;
    }
}

readonly record struct TcpSegment(string Src, int SrcPort, string Dst, int DstPort, uint Seq, byte Flags, int Offset, int Length);

static class Packets
{
    /// Link types Parse understands: null/loopback (0), Ethernet (1), raw IP (12 / 101, e.g. VPN tunnel adapters).
    public static bool Supported(int linkType) => linkType is 0 or 1 or 12 or 101;

    // Ethernet (+VLAN) / IPv4 / IPv6 -> TCP segment, else null.
    public static TcpSegment? Parse(byte[] p, int linkType)
    {
        try
        {
            int off;
            int etype;
            if (linkType == 1)
            {
                etype = p[12] << 8 | p[13];
                off = 14;
                if (etype == 0x8100) { etype = p[16] << 8 | p[17]; off = 18; }
            }
            else if (linkType == 0) { etype = p[0] == 2 ? 0x0800 : 0x86DD; off = 4; }
            else if (linkType is 12 or 101) { etype = p[0] >> 4 == 4 ? 0x0800 : 0x86DD; off = 0; }
            else return null;

            int t, end;
            string src, dst;
            if (etype == 0x0800)
            {
                if (p[off + 9] != 6) return null;
                src = string.Join('.', p[(off + 12)..(off + 16)]);
                dst = string.Join('.', p[(off + 16)..(off + 20)]);
                t = off + (p[off] & 15) * 4;
                end = off + (p[off + 2] << 8 | p[off + 3]);
            }
            else if (etype == 0x86DD)
            {
                if (p[off + 6] != 6) return null;
                src = Convert.ToHexString(p, off + 8, 16);
                dst = Convert.ToHexString(p, off + 24, 16);
                t = off + 40;
                end = t + (p[off + 4] << 8 | p[off + 5]);
            }
            else return null;

            end = Math.Min(end, p.Length);
            int data = t + (p[t + 12] >> 4) * 4;
            return new TcpSegment(src, p[t] << 8 | p[t + 1], dst, p[t + 2] << 8 | p[t + 3],
                BinaryPrimitives.ReadUInt32BigEndian(p.AsSpan(t + 4)), p[t + 13], data, Math.Max(0, end - data));
        }
        catch (IndexOutOfRangeException) { return null; }
        catch (ArgumentException) { return null; }
    }

    public static IEnumerable<(DateTime ts, byte[] data)> ReadPcap(string path, out int linkType)
    {
        var b = File.ReadAllBytes(path);
        linkType = BinaryPrimitives.ReadInt32LittleEndian(b.AsSpan(20));
        bool nano = BinaryPrimitives.ReadUInt32LittleEndian(b) == 0xA1B23C4D;
        return Records(b, nano);
    }

    static IEnumerable<(DateTime, byte[])> Records(byte[] b, bool nano)
    {
        for (int o = 24; o + 16 <= b.Length;)
        {
            uint sec = BinaryPrimitives.ReadUInt32LittleEndian(b.AsSpan(o));
            uint frac = BinaryPrimitives.ReadUInt32LittleEndian(b.AsSpan(o + 4));
            int cap = BinaryPrimitives.ReadInt32LittleEndian(b.AsSpan(o + 8));
            var ts = DateTime.UnixEpoch.AddSeconds(sec).AddTicks(nano ? frac / 100 : frac * 10L);
            yield return (ts, b[(o + 16)..Math.Min(b.Length, o + 16 + cap)]);
            o += 16 + cap;
        }
    }
}

sealed record PetList(uint Active, Dictionary<uint, int> Levels, Dictionary<uint, int> Souls);

static class PetFrames
{
    /// The match objects of a 0x2ce3 history frame: each is a JSON object starting with {"start_time" (length-prefixed,
    /// so they are cut out by brace depth). Contents ids seen: 22 = arena, 44 = coop arena, 55 = battlefield.
    public static List<JsonElement> PvpHistory(byte[] b)
    {
        var list = new List<JsonElement>();
        var key = "{\"start_time\""u8.ToArray();
        for (int i = 0; i + key.Length < b.Length; i++)
        {
            if (!b.AsSpan(i).StartsWith(key)) continue;
            int depth = 0, j = i;
            bool str = false;
            for (; j < b.Length; j++)
            {
                byte c = b[j];
                if (str) { if (c == (byte)'\\') j++; else if (c == (byte)'"') str = false; continue; }
                if (c == (byte)'"') str = true;
                else if (c == (byte)'{') depth++;
                else if (c == (byte)'}' && --depth == 0) break;
            }
            if (j >= b.Length) break;
            try { using var doc = JsonDocument.Parse(b.AsMemory(i, j - i + 1)); list.Add(doc.RootElement.Clone()); } catch { }
            i = j;
        }
        return list;
    }

    public static int Varint(byte[] b, ref int o)
    {
        int v = 0, s = 0;
        while (true)
        {
            byte x = b[o++];
            v |= (x & 0x7F) << s;
            s += 7;
            if ((x & 0x80) == 0 || s > 28) return v;
        }
    }

    static uint U32(byte[] b, int o) => BinaryPrimitives.ReadUInt32LittleEndian(b.AsSpan(o));

    // 0x0090: u32 active; n x {u32 id, u32 id, u32 level}; m x {u32 id, u32 souls}; ...
    public static PetList? ParseList(byte[] b)
    {
        try
        {
            uint active = U32(b, 0);
            int o = 4, n = Varint(b, ref o);
            if (n is < 1 or > 2000) return null;
            var levels = new Dictionary<uint, int>();
            for (int i = 0; i < n; i++, o += 12)
            {
                uint id = U32(b, o), lv = U32(b, o + 8);
                if (lv > 3 || U32(b, o + 4) != id) return null;
                levels[id] = (int)lv;
            }
            int m = Varint(b, ref o);
            if (m > 2000) return null;
            var souls = new Dictionary<uint, int>();
            for (int i = 0; i < m; i++, o += 8)
            {
                uint cnt = U32(b, o + 4);
                if (cnt > 1000) return null;
                souls[U32(b, o)] = (int)cnt;
            }
            return new PetList(active, levels, souls);
        }
        catch (ArgumentOutOfRangeException) { return null; }
        catch (IndexOutOfRangeException) { return null; }
    }

    // 0x3336 (login): own character id as a varint at the start.
    public static byte[]? CharId(byte[] b)
    {
        for (int n = 0; n < 5 && n < b.Length; n++)
            if ((b[n] & 0x80) == 0) return n == 0 && b[0] == 0 ? null : b[..(n + 1)];
        return null;
    }

    // 0x3336 (own character, at login and every map change): own id varint, a few bytes, then the name as
    // u8 length + UTF-8 (e.g. "07" + a 7-letter name at offset 7). First length-prefixed alphanumeric run wins.
    public static string? CharName(byte[] b)
    {
        for (int o = 1; o < 30 && o < b.Length; o++)
        {
            int len = b[o];
            if (len is < 2 or > 24 || o + 1 + len > b.Length) continue;
            try
            {
                var s = new System.Text.UTF8Encoding(false, true).GetString(b, o + 1, len);
                if (s.All(char.IsLetterOrDigit) && s.Any(char.IsLetter)) return s;
            }
            catch (System.Text.DecoderFallbackException) { }
        }
        return null;
    }

    public static byte[] VarintBytes(uint v)
    {
        var o = new List<byte>();
        do { byte x = (byte)(v & 0x7F); v >>= 7; o.Add((byte)(v != 0 ? x | 0x80 : x)); } while (v != 0);
        return o.ToArray();
    }

    public static uint VarintValue(byte[] b)
    {
        uint v = 0;
        for (int i = 0; i < b.Length; i++) v |= (uint)(b[i] & 0x7F) << (7 * i);
        return v;
    }

    // Plausible map coordinates (cm): Aion 2 maps span roughly ±4 km, heights -200..800 m.
    public static bool Plausible(float x, float y, float z) =>
        float.IsFinite(x) && float.IsFinite(y) && float.IsFinite(z) && Math.Abs(x) is >= 1000 and < 400000
        && Math.Abs(y) is >= 1000 and < 400000 && z is > -20000 and < 80000;

    static bool Xyz(byte[] b, int o, out (float x, float y, float z) p)
    {
        p = default;
        if (o < 0 || o + 12 > b.Length) return false;
        p = (BitConverter.ToSingle(b, o), BitConverter.ToSingle(b, o + 4), BitConverter.ToSingle(b, o + 8));
        return Plausible(p.x, p.y, p.z);
    }

    // Own position (x, y, z float32 cm) from the frames that carry it; verified against 0x2a38 within ±0.5 s on two
    // captures (tools/notes_position.md, tools/own_position_track.py own_fix):
    //  0x2a38 / 0x2b38  effect: target, ..., u64 ts, caster varint at 20+ (= own), x,y,z 4 (short form) or 8 bytes after it.
    //  0x0238 / 0x0938  skill hit: caster, 00, u32 skill, u8, u8, target varint (= own, idx 5-14), f32 angle, x,y,z.
    //                   Own id as the caster (frame start) gives the skill target point instead: 5-300 m off, not used.
    //  0x0e38           projectile: ent varint, 02, caster varint (= own, idx 2-6), u32 skill, u8, target varint, x,y,z.
    //  0x1a37 / 0x1e37 / 0x3f37  the server moves the player (knock-back, dash, stop): own id at the start, 0-4 bytes, x,y,z.
    //  0x2336           teleport / map change: 6 bytes, x,y,z.
    // Rejected: 0x0338 (own at the start, xyz +15: 5.7 m p50) and 0x1438 (own at 3, +6: 5.4 m).
    public static (float x, float y, float z)? OwnFix(int op, byte[] b, byte[] own)
    {
        // Only the two sources that proved reliable in practice: 0x2a38 (own id from index 8, x, y, z 4 or 8 bytes after
        // it) and the teleport 0x2336. More fix opcodes (0x2b38, 0x0238/0x0938 as target, 0x0e38, 0x1a37/0x1e37/0x3f37)
        // were tried (tools/notes_position.md) but made the position worse in play.
        (float x, float y, float z) p;
        if (op == 0x2a38)
            for (int i = b.AsSpan().IndexOf(own); i >= 0;)
            {
                if (i >= 8 && (Xyz(b, i + 4, out p) || Xyz(b, i + 8, out p))) return p;
                int next = b.AsSpan(i + 1).IndexOf(own);
                i = next < 0 ? -1 : i + 1 + next;
            }
        else if (op == 0x2336 && b.Length >= 18 && Xyz(b, 6, out p)) return p;
        return null;
    }

    /// Length of the varint at o (1-5), 0 if it runs past the end or is longer.
    public static int VarintLen(byte[] b, int o)
    {
        for (int n = 0; n < 5; n++)
        {
            if (o + n >= b.Length) return 0;
            if ((b[o + n] & 0x80) == 0) return n + 1;
        }
        return 0;
    }

    /// Entity varint at the frame start + the first plausible x, y, z 0-4 bytes after it (movement frames 0x1a37-0x3f37).
    public static bool MovePosition(byte[] b, out uint ent, out (float x, float y, float z) p)
    {
        p = default; ent = 0;
        int k = VarintLen(b, 0);
        if (k == 0) return false;
        int o = 0;
        ent = (uint)Varint(b, ref o);
        for (int d = 0; d < 5; d++)
            if (Xyz(b, k + d, out p)) return true;
        return false;
    }

    // 0x4136 (npc spawn) / 0x4536 (player spawn): entity varint, a few header bytes, then x, y, z as float32 cm.
    public static (float x, float y, float z)? SpawnPosition(byte[] b)
    {
        for (int o = 4; o <= 24 && o + 12 <= b.Length; o++)
            if (Xyz(b, o, out var p)) return p;
        return null;
    }

    // 0x3436 (world object spawn): entity varint, kind u8, u8, u32 EnvObj id, x, y, z float32 cm.
    public static (uint ent, uint env, float x, float y, float z)? ObjectSpawn(byte[] b)
    {
        try
        {
            int o = 0;
            uint ent = (uint)Varint(b, ref o);
            if (o + 18 > b.Length) return null;
            uint env = BitConverter.ToUInt32(b, o + 2);
            float x = BitConverter.ToSingle(b, o + 6), y = BitConverter.ToSingle(b, o + 10), z = BitConverter.ToSingle(b, o + 14);
            if (!float.IsFinite(x) || !float.IsFinite(y) || Math.Abs(x) is < 1000 or >= 400000 || Math.Abs(y) is < 1000 or >= 400000) return null;
            return (ent, env, x, y, z);
        }
        catch { return null; }
    }

    // 0x8356 (login, full list) / 0x8456 (live update): varint n, n x {u32 id, u32 counter, u64 time ms, u8 tier}.
    // The list mixes quests and achievements; achievements are the 9-digit 3xx/4xx ids (Elyos/Asmodian, aion2.app).
    public static List<(uint id, uint val, byte tier, long ts)>? ParseProgress(byte[] b)
    {
        try
        {
            int o = 0, n = Varint(b, ref o);
            var list = new List<(uint, uint, byte, long)>();
            for (int i = 0; i < n && o + 17 <= b.Length; i++, o += 17)
            {
                uint id = BitConverter.ToUInt32(b, o);
                if (id is >= 300_000_000 and < 500_000_000)
                    list.Add((id, BitConverter.ToUInt32(b, o + 4), b[o + 16], BitConverter.ToInt64(b, o + 8))); // ts = last change, unix ms
            }
            return list;
        }
        catch { return null; }
    }

    // Daevanion changes while playing (from a capture: buying and resetting nodes on a Chanter's Nezekan board):
    //   0x03e5 nodes bought along a path: u16 0, u32 board id, u8 n, n x u32 node id
    //   0x28e2 one node bought:            u16 0, u32 node id
    //   0x2be2 one node reset:             u16 0, u32 node id
    // Each comes after 0x2ee2 and the cost / refund frames.
    //   0x2ee2 spent points per point pool: u8 n, n x {u8 pool, u16 spent}; pool 1 = Nezekan-Triniel, 2 = Ariel,
    //          3 = Azphel (checked against the open nodes of a login: 416 / 71 / 0); also sent at login, right
    //          before 0x26e2; it rises by the node cost on every buy, falls on a reset
    public static uint[]? ParseDaeBought(byte[] b)
    {
        if (b.Length < 7 || BitConverter.ToUInt16(b, 0) != 0) return null;
        int board = (int)BitConverter.ToUInt32(b, 2), n = b[6];
        if (board is < 11 or > 109 || b.Length != 7 + n * 4) return null;
        var ids = new uint[n];
        for (int k = 0; k < n; k++)
        {
            ids[k] = BitConverter.ToUInt32(b, 7 + k * 4);
            if (ids[k] / 10000 != board || ids[k] % 10000 is < 1 or > 225) return null;
        }
        return ids;
    }
    public static Dictionary<int, int>? ParseDaePoints(byte[] b)
    {
        if (b.Length < 1 || b.Length != 1 + b[0] * 3) return null;
        var d = new Dictionary<int, int>();
        for (int k = 0; k < b[0]; k++) d[b[1 + k * 3]] = BitConverter.ToUInt16(b, 2 + k * 3);
        return d;
    }
    // 0x0b61 (login): every entry limit of the character: u8 n, n x {u8 field mask, u32 content id, fields}; mask 01 =
    // u64 (time), 02 = varint (?), 04 = varint charges left, 08 = varint bonus entries (a missing field = 0). Checked
    // against the game's windows: 1 = Shugo keys 0+12, 4 = Nightmare 0+21, 80000001 = Ascension trial 0+13.
    public static List<(uint id, int left, int bonus)>? ParseEntryCharges(byte[] b)
    {
        try
        {
            int o = 0, n = b[o++];
            var list = new List<(uint, int, int)>();
            for (int k = 0; k < n; k++)
            {
                int m = b[o++];
                uint id = BitConverter.ToUInt32(b, o); o += 4;
                int left = 0, bonus = 0;
                if ((m & 1) != 0) o += 8;
                if ((m & 2) != 0) Varint(b, ref o);
                if ((m & 4) != 0) left = Varint(b, ref o);
                if ((m & 8) != 0) bonus = Varint(b, ref o);
                if ((m & ~15) != 0 || o > b.Length) return null;
                list.Add((id, left, bonus));
            }
            return list;
        }
        catch { return null; }
    }

    // 0x29e2: whole boards reset: u8 n, n x u32 Start node id of the board (board * 10000 + 113)
    public static uint[]? ParseDaeBoardReset(byte[] b)
    {
        if (b.Length < 5 || b.Length != 1 + b[0] * 4) return null;
        var ids = new uint[b[0]];
        for (int k = 0; k < ids.Length; k++)
        {
            ids[k] = BitConverter.ToUInt32(b, 1 + k * 4);
            if (ids[k] / 10000 is < 11 or > 109 || ids[k] % 10000 != 113) return null;
        }
        return ids;
    }
    public static uint? ParseDaeNode(byte[] b)
    {
        if (b.Length != 6 || BitConverter.ToUInt16(b, 0) != 0) return null;
        uint id = BitConverter.ToUInt32(b, 2);
        return id / 10000 is >= 11 and <= 109 && id % 10000 is >= 1 and <= 225 ? id : null;
    }

    // 0x26e2 (login): own Daevanion boards: u8 n, n x {u32 board id (class * 10 + slot), varint count, count x u32 open
    // node id (board * 10000 + (row - 1) * 15 + col, the Start node included)}. Same ids as the plaync website's nodeId.
    public static Dictionary<int, uint[]>? ParseDaevanion(byte[] b)
    {
        try
        {
            int o = 0, n = b[o++];
            if (n is < 1 or > 8) return null;
            var boards = new Dictionary<int, uint[]>();
            for (int i = 0; i < n; i++)
            {
                int board = (int)BitConverter.ToUInt32(b, o); o += 4;
                int cnt = Varint(b, ref o);
                if (board is < 11 or > 109 || cnt is < 0 or > 225 || o + cnt * 4 > b.Length) return null;
                var ids = new uint[cnt];
                for (int k = 0; k < cnt; k++, o += 4)
                {
                    ids[k] = BitConverter.ToUInt32(b, o);
                    if (ids[k] / 10000 != board || ids[k] % 10000 is < 1 or > 225) return null;
                }
                boards[board] = ids;
            }
            return o == b.Length ? boards : null;
        }
        catch { return null; }
    }

    // 0x0191 (every ~3 s): field boss table of the current map, as the client shows it.
    // u16 ?, u32 map id, u8 n, n x {u8 alive, varint boss id (= map id * 100 + index in the map's boss list + 1),
    // if alive: x, y, z float32 cm; [optional u8]; u64 unix ms: alive since / respawn at}.
    public static (uint map, List<(uint id, bool alive, float x, float z, long ts)> list)? ParseBossTable(byte[] b)
    {
        try
        {
            uint map = BitConverter.ToUInt32(b, 2);
            int n = b[6], o = 7;
            var list = new List<(uint, bool, float, float, long)>();
            for (int i = 0; i < n; i++)
            {
                bool alive = b[o++] != 0;
                uint id = (uint)Varint(b, ref o);
                float x = 0, z = 0;
                if (alive) { x = BitConverter.ToSingle(b, o) / 100; z = BitConverter.ToSingle(b, o + 4) / 100; o += 12; }
                int skip = 0;
                while (skip < 3 && BitConverter.ToInt64(b, o + skip) is < 1_700_000_000_000 or > 2_500_000_000_000) skip++;
                if (skip == 3) return null;
                list.Add((id, alive, x, z, BitConverter.ToInt64(b, o + skip)));
                o += skip + 8;
            }
            return (map, list);
        }
        catch { return null; }
    }

    // 0x0d90: n x {u32 id, u32 gained}
    public static List<(uint pet, int gained)>? ParseSouls(byte[] b)
    {
        try
        {
            int o = 0, n = Varint(b, ref o);
            if (n is < 1 or > 64 || b.Length < o + n * 8) return null;
            var list = new List<(uint, int)>();
            for (int i = 0; i < n; i++, o += 8)
            {
                uint id = U32(b, o), g = U32(b, o + 4);
                if (id is 0 or > 100000 || g is 0 or > 100) return null;
                list.Add((id, (int)g));
            }
            return list;
        }
        catch (IndexOutOfRangeException) { return null; }
    }

    // 0x9156 (S2C): Black Cloud Merchant offer, sent whenever its window/tab opens (one frame per tab).
    // varint tab id (c9 0a = 1353, cc 0a = 1356), then records of u32 slot, u32 item, u64 count, u8 discount tier
    // (0..3 = -10/-20/-30/-50 %), u8 0x5d, u64 base price, u64 sale price. A flag byte sits before every 4th record
    // (55 55 05 in both samples), a 12-byte trailer follows (00 2a9138a101.., no timestamp). Records are found by their
    // shape (0x5d required, else a record shifted by the flag byte passes too), not by a fixed stride.
    // Pet items (534760xxx) are mapped to pets by the UI (item id -> pet name table, web/src/features/merchant/petItems.json);
    // other items (skins, boxes, ...) are kept with their prices. Count 0 is accepted and flagged "sold" (unverified guess
    // for "Sold Out"; a purchase showed up as an unchanged record so far – the UI detects purchases by the +5 souls).
    public static (int tab, List<MerchantItem> items)? ParseMerchant(byte[] b)
    {
        const int Rec = 34;
        try
        {
            int o = 0, tab = Varint(b, ref o);
            var items = new List<MerchantItem>();
            while (o + Rec <= b.Length)
            {
                uint item = U32(b, o + 4);
                long count = BinaryPrimitives.ReadInt64LittleEndian(b.AsSpan(o + 8));
                long full = BinaryPrimitives.ReadInt64LittleEndian(b.AsSpan(o + 18)), sale = BinaryPrimitives.ReadInt64LittleEndian(b.AsSpan(o + 26));
                if (item >= 100_000_000 && count is >= 0 and <= 999 && b[o + 16] <= 9 && b[o + 17] == 0x5d && full is > 0 and < 1_000_000_000_000 && sale > 0 && sale <= full)
                {
                    items.Add(new(item, (int)count, b[o + 16], full, sale));
                    o += Rec;
                }
                else o++;
            }
            return items.Count > 0 ? (tab, items) : null;
        }
        catch (IndexOutOfRangeException) { return null; }
    }
}

sealed record MerchantItem(uint Item, int Count, int Tier, long Base, long Price)
{
    public bool Sold => Count == 0;
}
