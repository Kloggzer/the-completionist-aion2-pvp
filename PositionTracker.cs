namespace PetOverlay;

// Own position between exact fixes. The server never echoes the player's own walking/flying; exact positions come only
// with combat/skill frames, server moves and teleports (PetFrames.OwnFix). In between: a small particle filter.
// - Every fix: 400 particles around it (σ 1 m).
// - Motion: random walk 6 m/√s between events (constant velocity was worse: it runs away when the player stops).
// - NPC / player / object spawns and "out of range" despawns lie on fixed interest radii around the player
//   (0x4136 36 m, 0x4536 32 m, 0x3436 56 m, 0x4236 reason 01 43 m at the entity's last position): ring likelihood
//   σ 4-5 m + a uniform part inside (respawns next to the player) + 15 % outliers (big entities, stale positions).
// - Mobs that hit the player in the last 10 s stay close: their movement frames weigh with a Gaussian σ 8 m.
// - Output: weighted mean, but the last fix is kept until the mean is ≥ 25 m away from it (standing still the rings
//   only add noise). Measured on 205450 (end of ≥ 4 s gaps without a fix): p50 13 / p75 25 / p90 50 m vs 19 / 45 / 78 m holding the fix.
// Port of Tracker in tools/own_position_track.py; constants and measurements in tools/notes_position.md.
sealed class PositionTracker(Action<float, float, float, int, DateTime> fix, Action<float, float, float, float, DateTime> estimate)
{
    const int N = 400;
    const double Diffusion = 6, Gate = 25, AggroSigma = 8, AggroWindow = 10;
    static readonly TimeSpan EmitEvery = TimeSpan.FromMilliseconds(250);

    readonly float[] px = new float[N], py = new float[N], rx = new float[N], ry = new float[N];
    readonly double[] w = new double[N];
    readonly Random rng = new(1);
    readonly Dictionary<uint, (float x, float y)> lastPos = new(); // entity -> last known position (m), for despawns
    readonly Dictionary<uint, double> aggro = new();                // entity -> last time it hit the player
    bool live;                  // particles exist (a fix arrived on this map)
    double t;                   // time of the particles (s)
    float fx, fy, fh;           // last fix (m)
    bool estimating, pending;   // estimate shown since the last fix / newer than the last emitted one
    DateTime lastEmit;
    float ex, ey, es;           // current output

    static double Sec(DateTime ts) => ts.Ticks / 1e7;

    /// One server frame. own = own id varint.
    public void Feed(int op, byte[] b, DateTime ts, byte[] own)
    {
        double now = Sec(ts);
        if (op is 0x0238 or 0x0438 or 0x0538 && HitsPlayer(b, own))
        {
            int o = 0;
            aggro[(uint)PetFrames.Varint(b, ref o)] = now; // caster hit the player
        }
        if (PetFrames.OwnFix(op, b, own) is { } p)
        {
            Reset(p.x / 100, p.y / 100, p.z / 100, now);
            fix(fx, fy, fh, op, ts);
            return;
        }
        switch (op)
        {
            case 0x1a37 or 0x1b37 or 0x1c37 or 0x1e37 or 0x1f37 or 0x2037 or 0x3f37:
                if (!PetFrames.MovePosition(b, out uint ent, out var m)) break;
                float mx = m.x / 100, my = m.y / 100;
                lastPos[ent] = (mx, my);
                if (live && aggro.TryGetValue(ent, out double hit) && now - hit < AggroWindow) Update(now, mx, my, 0);
                break;
            case 0x4136 or 0x4536:
                if (PetFrames.VarintLen(b, 0) == 0 || PetFrames.SpawnPosition(b) is not { } s) break;
                int so = 0;
                lastPos[(uint)PetFrames.Varint(b, ref so)] = (s.x / 100, s.y / 100);
                if (live) Update(now, s.x / 100, s.y / 100, op);
                break;
            case 0x3436:
                if (live && PetFrames.ObjectSpawn(b) is { } obj && PetFrames.Plausible(obj.x, obj.y, obj.z)) Update(now, obj.x / 100, obj.y / 100, op);
                break;
            case 0x4236:
                int k = PetFrames.VarintLen(b, 0);
                if (k == 0) break;
                int go = 0;
                uint gone = (uint)PetFrames.Varint(b, ref go);
                if (lastPos.Remove(gone, out var last) && k + 1 < b.Length && b[k + 1] == 1 && live) // 01 = left the interest range
                    Update(now, last.x, last.y, op);
                aggro.Remove(gone);
                break;
        }
        if (pending && ts - lastEmit >= EmitEvery)
        {
            pending = false; lastEmit = ts;
            estimate(ex, ey, fh, es, ts);
        }
    }

    /// New map: entity ids and aggro say nothing there. The particles stay until the 0x2336 fix replaces them.
    public void MapChanged()
    {
        lastPos.Clear(); aggro.Clear();
    }

    // 0x0238/0x0438/0x0538 with the own id in bytes 3-13 and a different caster at the start.
    static bool HitsPlayer(byte[] b, byte[] own)
    {
        if (b.Length < 4 || b.AsSpan().StartsWith(own)) return false;
        return b.AsSpan(3, Math.Min(b.Length, 14) - 3).IndexOf(own) >= 0;
    }

    void Reset(float x, float y, float h, double now)
    {
        fx = x; fy = y; fh = h;
        for (int i = 0; i < N; i++) { px[i] = x + (float)Gauss(1); py[i] = y + (float)Gauss(1); w[i] = 1.0 / N; }
        t = now; live = true;
        estimating = pending = false;
        if (lastPos.Count > 50000) lastPos.Clear(); // entities that died never send "out of range"
    }

    double Gauss(double sd)
    {
        double u = 1 - rng.NextDouble(), v = rng.NextDouble();
        return sd * Math.Sqrt(-2 * Math.Log(u)) * Math.Cos(2 * Math.PI * v);
    }

    void Predict(double now)
    {
        double dt = now - t;
        if (dt <= 0) return;
        double sd = Diffusion * Math.Sqrt(dt);
        for (int i = 0; i < N; i++) { px[i] += (float)Gauss(sd); py[i] += (float)Gauss(sd); }
        t = now;
    }

    // Ring likelihood of "entity spawned/despawned at distance d (m)": peak, σ, end of the uniform inside part (0 = none).
    static double RingLik(double d, int op)
    {
        var (peak, sig, rmax) = op switch
        {
            0x4136 => (36.0, 4.0, 42.0),
            0x4536 => (32.0, 4.0, 38.0),
            0x3436 => (56.0, 4.0, 62.0),
            _ => (43.0, 5.0, 0.0), // 0x4236
        };
        double q = (d - peak) / sig, g = Math.Exp(-0.5 * q * q) / (sig * 2.5066);
        if (rmax > 0)
        {
            double z = (d - rmax) / 1.5;
            g = 0.7 * g + (z < 50 ? 0.3 / rmax / (1 + Math.Exp(z)) : 0);
        }
        return 0.15 / 400 + 0.85 * g;
    }

    /// Weight the particles with an event at (x, y): op = ring opcode, 0 = aggro mob (Gaussian).
    void Update(double now, float x, float y, int op)
    {
        Predict(now);
        double tot = 0, s2 = 2 * AggroSigma * AggroSigma;
        for (int i = 0; i < N; i++)
        {
            double dx = px[i] - x, dy = py[i] - y, d2 = dx * dx + dy * dy;
            w[i] *= op == 0 ? 0.05 / 400 + Math.Exp(-d2 / s2) : RingLik(Math.Sqrt(d2), op);
            tot += w[i];
        }
        if (!(tot > 0)) { Array.Fill(w, 1.0); tot = N; }
        double ess = 0;
        for (int i = 0; i < N; i++) { w[i] /= tot; ess += w[i] * w[i]; }
        if (1 / ess < N / 2) Resample();
        Output();
    }

    // Systematic resampling + 0.5 m jitter.
    void Resample()
    {
        double step = 1.0 / N, u = rng.NextDouble() * step, c = w[0];
        for (int i = 0, j = 0; i < N; i++, u += step)
        {
            while (u > c && j < N - 1) c += w[++j];
            rx[i] = px[j] + (float)Gauss(0.5); ry[i] = py[j] + (float)Gauss(0.5);
        }
        Array.Copy(rx, px, N); Array.Copy(ry, py, N);
        Array.Fill(w, 1.0 / N);
    }

    void Output()
    {
        double mx = 0, my = 0;
        for (int i = 0; i < N; i++) { mx += px[i] * w[i]; my += py[i] * w[i]; }
        double v = 0;
        for (int i = 0; i < N; i++) { double dx = px[i] - mx, dy = py[i] - my; v += w[i] * (dx * dx + dy * dy); }
        // σ from the RMS distance of the particles from their mean. Once the rings pulled the mean away from the fix the
        // cloud is too narrow (resampled onto ring crossings): with 2 × spread + 5 m the true position lies inside in 54 % of the
        // cases (205450, end of ≥ 4 s gaps; plain spread: 26 %), about a 1-σ circle; next to the fix the spread already fits.
        double spread = Math.Sqrt(v);
        bool hold = Math.Sqrt((mx - fx) * (mx - fx) + (my - fy) * (my - fy)) < Gate;
        es = (float)Math.Max(5, hold ? spread : 2 * spread + 5);
        // Within the gate nothing is sent (the UI keeps the fix and its dead reckoning) – unless an estimate is already
        // shown, then the fix comes back as the estimate.
        if (hold && !estimating) return;
        estimating = true; pending = true;
        (ex, ey) = hold ? (fx, fy) : ((float)mx, (float)my);
    }
}
