using System.Text.Json;

namespace PetOverlay;

sealed record SoulEvent(uint Pet, int Gained, int Level, int Souls, int Need, bool LevelUp);

// Own position in aion2maps metres (x, z on the map; y = height).
sealed record Position(float X, float Z, float Y, DateTime At, bool Est = false, float? Sigma = null); // Sigma: 1-σ radius (m) of an estimate

// Last known pet progress. The login frame is a full snapshot; live frames only add souls, so the
// level thresholds (5 / 25 / 75, counter resets on level-up) are applied here.
sealed class PetState
{
    public uint Active { get; set; }
    public Dictionary<uint, int> Levels { get; set; } = new();
    public Dictionary<uint, int> Souls { get; set; } = new();
    public DateTime? SyncedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public uint CharId { get; set; }
    public Position? Pos { get; set; }
    // Achievement id -> [counter, tier, last change unix ms] (from 0x8356 at login, kept current by 0x8456).
    public Dictionary<uint, long[]> Ach { get; set; } = new();
    public uint MapId { get; set; }
    // Weekly usage counters from the login (0xacff, id -> used) and the server time they were sent.
    public Dictionary<byte, uint> Usage { get; set; } = new();
    public long UsageAt { get; set; }
    public string CharName { get; set; } = "";

    public static int Need(int level) => level switch { 0 => 5, 1 => 25, 2 => 75, _ => 0 };

    public void Apply(PetList list, DateTime ts)
    {
        Active = list.Active;
        Levels = list.Levels;
        Souls = list.Souls;
        SyncedAt = UpdatedAt = ts;
    }

    public SoulEvent Gain(uint pet, int gained, DateTime ts)
    {
        int lv = Levels.GetValueOrDefault(pet), souls = Souls.GetValueOrDefault(pet) + gained;
        bool up = false;
        while (lv < 3 && souls >= Need(lv))
        {
            souls -= Need(lv);
            lv++;
            up = true;
        }
        if (lv >= 3) souls = 0;
        if (lv > 0) Levels[pet] = lv;
        Souls[pet] = souls;
        UpdatedAt = ts;
        return new SoulEvent(pet, gained, lv, souls, Need(lv), up);
    }

    /// Manual mode: level and souls set by hand (thresholds as in Gain; Lv3 has no counter).
    public void Set(uint pet, int level, int souls, DateTime ts)
    {
        level = Math.Clamp(level, 0, 3);
        souls = level >= 3 ? 0 : Math.Clamp(souls, 0, Need(level) - 1);
        if (level > 0) Levels[pet] = level; else Levels.Remove(pet);
        Souls[pet] = souls;
        UpdatedAt = ts;
    }

    public static PetState? Load(string path)
    {
        try { return File.Exists(path) ? JsonSerializer.Deserialize<PetState>(File.ReadAllText(path)) : null; }
        catch { return null; }
    }

    public void Save(string path)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
            File.WriteAllText(path, JsonSerializer.Serialize(this));
        }
        catch { }
    }
}
