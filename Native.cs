using System.Diagnostics;
using System.Net;
using System.Runtime.InteropServices;

namespace PetOverlay;

static class Native
{
    public const int WM_HOTKEY = 0x0312;
    public const int WM_NCHITTEST = 0x0084;
    public const int WM_NCLBUTTONDOWN = 0x00A1;
    public const int HTCAPTION = 2;
    public const int HTLEFT = 10, HTRIGHT = 11, HTTOP = 12, HTTOPLEFT = 13, HTTOPRIGHT = 14,
                     HTBOTTOM = 15, HTBOTTOMLEFT = 16, HTBOTTOMRIGHT = 17;

    public const int WS_EX_LAYERED = 0x00080000;
    public const int WS_EX_TRANSPARENT = 0x00000020;
    public const int WS_EX_TOOLWINDOW = 0x00000080;
    public const int WS_EX_NOACTIVATE = 0x08000000;

    const uint MOD_ALT = 0x1, MOD_CONTROL = 0x2, MOD_SHIFT = 0x4, MOD_NOREPEAT = 0x4000;

    static readonly IntPtr HWND_TOPMOST = new(-1);
    const uint SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOACTIVATE = 0x10;

    [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint mods, uint vk);
    [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
    [DllImport("user32.dll")] public static extern bool ReleaseCapture();
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);

    /// Largest visible top-level window of a process, found by window enumeration (no process handle is opened).
    public static IntPtr MainWindowOf(string processName)
    {
        var pids = Process.GetProcessesByName(Path.GetFileNameWithoutExtension(processName)).Select(p => (uint)p.Id).ToHashSet();
        IntPtr best = IntPtr.Zero; long bestArea = 0;
        EnumWindows((h, _) =>
        {
            GetWindowThreadProcessId(h, out var pid);
            if (pids.Contains(pid) && IsWindowVisible(h))
            {
                if (GetWindowRect(h, out var rc)) { long a = (long)(rc.Right - rc.Left) * (rc.Bottom - rc.Top); if (a > bestArea) { bestArea = a; best = h; } }
            }
            return true;
        }, IntPtr.Zero);
        return best;
    }
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] static extern int GetSystemMetricsForDpi(int index, uint dpi);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr hWnd);

    /// Width/height of the (invisible) resize border of a sizable window at its DPI.
    public static (int x, int y) ResizeBorder(IntPtr hWnd)
    {
        uint dpi = GetDpiForWindow(hWnd);
        int pad = GetSystemMetricsForDpi(92, dpi); // SM_CXPADDEDBORDER
        return (GetSystemMetricsForDpi(32, dpi) + pad, GetSystemMetricsForDpi(33, dpi) + pad); // SM_CXSIZEFRAME, SM_CYSIZEFRAME
    }
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
    [DllImport("iphlpapi.dll")] static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool order, int af, int cls, uint reserved);

    // Starts a native move (HTCAPTION) or resize (HT* edge) while the mouse button is still down.
    public static void BeginDrag(IntPtr hWnd, int hit = HTCAPTION)
    {
        // lParam must carry the cursor's screen position: sizing measures from it (0,0 broke resizing).
        var p = Cursor.Position;
        ReleaseCapture();
        SendMessage(hWnd, WM_NCLBUTTONDOWN, hit, (IntPtr)((p.Y & 0xFFFF) << 16 | (p.X & 0xFFFF)));
    }

    /// Screen rectangle of a window (empty if it is gone).
    public static Rectangle WindowRect(IntPtr hWnd) =>
        hWnd != IntPtr.Zero && GetWindowRect(hWnd, out var r) ? Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom) : Rectangle.Empty;

    // ---- per-pixel alpha windows (WS_EX_LAYERED + UpdateLayeredWindow)
    [StructLayout(LayoutKind.Sequential)] struct PT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct SZ { public int W, H; }
    [StructLayout(LayoutKind.Sequential, Pack = 1)] struct BLEND { public byte Op, Flags, Alpha, Format; }
    [DllImport("user32.dll")] static extern bool UpdateLayeredWindow(IntPtr hWnd, IntPtr hdcDst, ref PT dst, ref SZ size, IntPtr hdcSrc, ref PT src, int key, ref BLEND blend, int flags);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hWnd);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hWnd, IntPtr hdc);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr hdc);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr hdc);
    [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);

    /// Shows a 32-bit ARGB bitmap as the whole content of a layered window at `pos` (per-pixel alpha, times `alpha`).
    public static void SetLayeredBitmap(IntPtr hWnd, Bitmap bmp, Point pos, byte alpha = 255)
    {
        IntPtr screen = GetDC(IntPtr.Zero), mem = CreateCompatibleDC(screen), hbmp = IntPtr.Zero, old = IntPtr.Zero;
        try
        {
            hbmp = bmp.GetHbitmap(Color.FromArgb(0)); // premultiplied DIB
            old = SelectObject(mem, hbmp);
            var size = new SZ { W = bmp.Width, H = bmp.Height };
            var dst = new PT { X = pos.X, Y = pos.Y };
            var src = new PT();
            var blend = new BLEND { Op = 0 /* AC_SRC_OVER */, Alpha = alpha, Format = 1 /* AC_SRC_ALPHA */ };
            UpdateLayeredWindow(hWnd, screen, ref dst, ref size, mem, ref src, 0, ref blend, 2 /* ULW_ALPHA */);
        }
        finally
        {
            ReleaseDC(IntPtr.Zero, screen);
            if (hbmp != IntPtr.Zero) { SelectObject(mem, old); DeleteObject(hbmp); }
            DeleteDC(mem);
        }
    }

    [DllImport("user32.dll")] static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint affinity);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hWnd, out RECT r);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hWnd, ref Point p);

    /// Leave a window out of screenshots and screen capture (WDA_EXCLUDEFROMCAPTURE, Windows 10 2004+).
    public static void ExcludeFromCapture(IntPtr hWnd, bool on) => SetWindowDisplayAffinity(hWnd, on ? 0x11u : 0u);

    /// Client area of a window in screen pixels.
    public static bool ClientRectOnScreen(IntPtr hWnd, out Rectangle r)
    {
        r = Rectangle.Empty;
        if (!GetClientRect(hWnd, out var c)) return false;
        var p = Point.Empty;
        if (!ClientToScreen(hWnd, ref p)) return false;
        r = new Rectangle(p.X, p.Y, c.Right - c.Left, c.Bottom - c.Top);
        return true;
    }

    // Games in borderless mode like to steal the top spot; re-assert it without stealing focus.
    public static void KeepOnTop(IntPtr hWnd) =>
        SetWindowPos(hWnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);

    // "Ctrl+Alt+M" -> (modifiers, virtual key)
    public static bool TryParseHotkey(string text, out uint mods, out uint vk)
    {
        mods = MOD_NOREPEAT;
        vk = 0;
        foreach (var part in text.Split('+', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            switch (part.ToLowerInvariant())
            {
                case "alt": mods |= MOD_ALT; break;
                case "ctrl" or "strg": mods |= MOD_CONTROL; break;
                case "shift": mods |= MOD_SHIFT; break;
                default:
                    if (!Enum.TryParse<Keys>(part, true, out var k)) return false;
                    vk = (uint)k;
                    break;
            }
        }
        return vk != 0;
    }

    // Local TCP ports of a process' outgoing connections (not loopback, not HTTPS/HTTP), plus the local addresses they
    // use (= the adapter that carries the game's traffic) and whether the game talks to a local proxy (VPN/booster tools).
    public static HashSet<int> GamePorts(string processName, out bool running, out HashSet<IPAddress> local, out bool proxied)
    {
        var ports = new HashSet<int>();
        local = new();
        running = proxied = false;
        var pids = Process.GetProcessesByName(Path.GetFileNameWithoutExtension(processName))
            .Select(p => p.Id).Where(id => id != Environment.ProcessId).ToHashSet();
        if (pids.Count == 0) return ports;
        running = true;
        foreach (var (pid, laddr, lport, remote, rport) in TcpRows(2, 24).Concat(TcpRows(23, 56)))
        {
            if (!pids.Contains(pid) || rport is 0 or 80 or 443) continue;
            if (IPAddress.IsLoopback(remote)) { proxied = true; continue; }
            ports.Add(lport);
            local.Add(laddr);
        }
        return ports;
    }

    static List<(int pid, IPAddress local, int lport, IPAddress remote, int rport)> TcpRows(int af, int rowSize)
    {
        var rows = new List<(int, IPAddress, int, IPAddress, int)>();
        int size = 0;
        GetExtendedTcpTable(IntPtr.Zero, ref size, false, af, 5 /* TCP_TABLE_OWNER_PID_ALL */, 0);
        size += 4096;
        var buf = Marshal.AllocHGlobal(size);
        try
        {
            if (GetExtendedTcpTable(buf, ref size, false, af, 5, 0) != 0) return rows;
            var raw = new byte[size];
            Marshal.Copy(buf, raw, 0, size);
            int n = BitConverter.ToInt32(raw, 0);
            static int Port(byte[] b, int o) => b[o] << 8 | b[o + 1];
            for (int i = 0; i < n; i++)
            {
                int o = 4 + i * rowSize;
                if (af == 2)
                    rows.Add((BitConverter.ToInt32(raw, o + 20), new IPAddress(raw[(o + 4)..(o + 8)]), Port(raw, o + 8), new IPAddress(raw[(o + 12)..(o + 16)]), Port(raw, o + 16)));
                else
                    rows.Add((BitConverter.ToInt32(raw, o + 52), new IPAddress(raw[o..(o + 16)]), Port(raw, o + 20), new IPAddress(raw[(o + 24)..(o + 40)]), Port(raw, o + 44)));
            }
        }
        finally { Marshal.FreeHGlobal(buf); }
        return rows;
    }
}
