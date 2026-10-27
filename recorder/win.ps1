# Windows helpers for screen recording: list windows, find/activate a window, log the
# mouse (position + left button) until a stop file appears, and drive mouse/keyboard for
# desktop scenarios (-Mode drive reads one JSON command per stdin line). Output is JSON or CSV.
param(
  [Parameter(Mandatory = $true)][ValidateSet('windows', 'screens', 'rect', 'mouselog', 'drive')][string]$Mode,
  [string]$Title,
  [switch]$Activate,
  [string]$Out,
  [string]$Stop
)

$ErrorActionPreference = 'Stop'
# Node reads stdout as UTF-8; the console default (OEM code page) garbles non-Latin titles.
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class Win {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr p);

  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc f, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
  [DllImport("winmm.dll")] public static extern uint timeBeginPeriod(uint ms);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, int d, IntPtr e);
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);

  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputUnion u; }

  static void Send(ushort vk, ushort scan, uint flags) {
    var i = new INPUT { type = 1 };
    i.u.ki = new KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags };
    SendInput(1, new[] { i }, Marshal.SizeOf(typeof(INPUT)));
  }
  // Virtual-key down/up; navigation keys need the extended flag or they act as numpad keys.
  public static void Key(ushort vk, bool up) {
    bool ext = (vk >= 0x21 && vk <= 0x2E) || vk == 0x5B;
    Send(vk, 0, (up ? 2u : 0u) | (ext ? 1u : 0u));
  }
  // Any text, Cyrillic included, regardless of the keyboard layout.
  public static void Char(char c) { Send(0, c, 4); Send(0, c, 4 | 2); }

  // Mean absolute difference of two equally sized BGRA buffers, 0..255.
  public static double Diff(byte[] a, byte[] b) {
    long s = 0;
    for (int i = 0; i < a.Length; i++) s += Math.Abs(a[i] - b[i]);
    return (double)s / a.Length;
  }

  // Eased glide to (x, y) along a slight arc, like a hand moving a mouse.
  public static void Glide(int x, int y, int ms) {
    POINT p; GetCursorPos(out p);
    double dx = x - p.X, dy = y - p.Y, bow = Math.Min(0.08 * Math.Sqrt(dx * dx + dy * dy), 40);
    var sw = System.Diagnostics.Stopwatch.StartNew();
    while (true) {
      double k = ms <= 0 ? 1 : Math.Min(1, sw.Elapsed.TotalMilliseconds / ms);
      double e = k < 0.5 ? 4 * k * k * k : 1 - Math.Pow(-2 * k + 2, 3) / 2;
      double len = Math.Max(1, Math.Sqrt(dx * dx + dy * dy)), off = Math.Sin(Math.PI * e) * bow;
      SetCursorPos((int)Math.Round(p.X + dx * e - dy / len * off), (int)Math.Round(p.Y + dy * e + dx / len * off));
      if (k >= 1) break;
      System.Threading.Thread.Sleep(4);
    }
  }

  // Visible, non-cloaked top-level windows with a title, using the DWM frame bounds
  // (without the invisible resize border) so the rectangle matches what is on screen.
  // Minimized windows are included only on request (their rectangle is meaningless).
  public static List<object[]> List(bool minimized = false) {
    var list = new List<object[]>();
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h) || (IsIconic(h) && !minimized)) return true;
      int cloaked; DwmGetWindowAttribute(h, 14, out cloaked, 4);
      if (cloaked != 0) return true;
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
      if (sb.Length == 0) return true;
      RECT r; DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT)));
      if (!IsIconic(h) && (r.Right - r.Left < 80 || r.Bottom - r.Top < 60)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      list.Add(new object[] { h.ToInt64(), sb.ToString(), (int)pid, r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top });
      return true;
    }, IntPtr.Zero);
    return list;
  }
}
'@

# Per-monitor DPI awareness v2, so window rects and cursor positions are physical pixels like ffmpeg's.
[void][Win]::SetProcessDpiAwarenessContext([IntPtr](-4))

function Get-Windows([switch]$Minimized) {
  [Win]::List($Minimized.IsPresent) | ForEach-Object {
    $p = Get-Process -Id $_[2] -ErrorAction SilentlyContinue
    [pscustomobject]@{ handle = $_[0]; title = $_[1]; process = $p.ProcessName; x = $_[3]; y = $_[4]; width = $_[5]; height = $_[6] }
  }
}

switch ($Mode) {
  'windows' { @(Get-Windows) | ConvertTo-Json -Compress -AsArray }
  'screens' {
    Add-Type -AssemblyName System.Windows.Forms
    $i = 0
    @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
      [pscustomobject]@{ index = $i++; primary = $_.Primary; x = $_.Bounds.X; y = $_.Bounds.Y; width = $_.Bounds.Width; height = $_.Bounds.Height }
    }) | ConvertTo-Json -Compress -AsArray
  }
  'rect' {
    # title first, then process name ("Notes", "Figma"); minimized windows are restored
    $all = Get-Windows -Minimized
    $w = @($all | Where-Object { $_.title -like "*$Title*" }) + @($all | Where-Object { $_.process -like "*$Title*" }) | Select-Object -First 1
    if (-not $w) { Write-Output 'null'; exit 0 }
    if ($Activate -or $w.x -le -30000) {
      [void][Win]::ShowWindow([IntPtr]$w.handle, 9)
      [void][Win]::SetForegroundWindow([IntPtr]$w.handle)
      Start-Sleep -Milliseconds 350
      $w = Get-Windows -Minimized | Where-Object { $_.handle -eq $w.handle } | Select-Object -First 1
    }
    $w | ConvertTo-Json -Compress
  }
  'mouselog' {
    # CSV: first line "start,<unix ms>", then "<ms since start>,<x>,<y>,<down 0/1>" every ~8 ms.
    [void][Win]::timeBeginPeriod(1)   # 1 ms sleeps, so samples really come every ~8 ms
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $startMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $writer = [System.IO.StreamWriter]::new($Out, $false)
    $writer.WriteLine("start,$startMs")
    $pt = New-Object Win+POINT
    $n = 0
    while (-not (Test-Path $Stop)) {
      [void][Win]::GetCursorPos([ref]$pt)
      $down = if (([Win]::GetAsyncKeyState(1) -band 0x8000) -ne 0) { 1 } else { 0 }
      $writer.WriteLine("$($sw.ElapsedMilliseconds),$($pt.X),$($pt.Y),$down")
      if ((++$n % 60) -eq 0) { $writer.Flush() }
      Start-Sleep -Milliseconds 8
    }
    $writer.Close()
  }
  'drive' {
    # One JSON command per line on stdin, one JSON reply per line on stdout once it is done.
    # Coordinates are screen pixels. ops: move {x,y,ms} | down/up {button} | click {button,count}
    # | wheel {notches} | text {text,cps} | key {combo} | still {x,y,w,h,quiet,timeout,threshold,change,changeTimeout}
    [void][Win]::timeBeginPeriod(1)
    Add-Type -AssemblyName System.Drawing
    $VK = @{
      enter = 0x0D; return = 0x0D; tab = 0x09; esc = 0x1B; escape = 0x1B; space = 0x20; backspace = 0x08; delete = 0x2E; del = 0x2E
      insert = 0x2D; home = 0x24; end = 0x23; pageup = 0x21; pagedown = 0x22; left = 0x25; up = 0x26; right = 0x27; down = 0x28
      ctrl = 0x11; control = 0x11; shift = 0x10; alt = 0x12; win = 0x5B; meta = 0x5B; cmd = 0x5B
      mod = 0x11   # the shortcut modifier: Ctrl here, Cmd on macOS
    }
    for ($i = 1; $i -le 12; $i++) { $VK["f$i"] = 0x6F + $i }
    $BTN = @{ left = @(0x02, 0x04); right = @(0x08, 0x10); middle = @(0x20, 0x40) }
    function Thumb($x, $y, $w, $h) {
      $big = [System.Drawing.Bitmap]::new([int]$w, [int]$h)
      $g = [System.Drawing.Graphics]::FromImage($big)
      $g.CopyFromScreen([int]$x, [int]$y, 0, 0, $big.Size)
      $small = [System.Drawing.Bitmap]::new($big, 96, 60)
      $d = $small.LockBits([System.Drawing.Rectangle]::new(0, 0, 96, 60), 'ReadOnly', 'Format32bppArgb')
      $buf = [byte[]]::new($d.Stride * 60)
      [System.Runtime.InteropServices.Marshal]::Copy($d.Scan0, $buf, 0, $buf.Length)
      $small.UnlockBits($d); $small.Dispose(); $g.Dispose(); $big.Dispose()
      , $buf
    }
    [Console]::Out.WriteLine('{"ready":true}'); [Console]::Out.Flush()
    while ($null -ne ($line = [Console]::In.ReadLine())) {
      if (-not $line.Trim()) { continue }
      $c = $line | ConvertFrom-Json
      $reply = @{ ok = $true }
      try {
        switch ($c.op) {
          'move' { [Win]::Glide([int]$c.x, [int]$c.y, [int]$c.ms) }
          'down' { [Win]::mouse_event($BTN[[string]($c.button ?? 'left')][0], 0, 0, 0, [IntPtr]::Zero) }
          'up' { [Win]::mouse_event($BTN[[string]($c.button ?? 'left')][1], 0, 0, 0, [IntPtr]::Zero) }
          'click' {
            $b = $BTN[[string]($c.button ?? 'left')]
            for ($k = 0; $k -lt [int]($c.count ?? 1); $k++) {
              [Win]::mouse_event($b[0], 0, 0, 0, [IntPtr]::Zero); Start-Sleep -Milliseconds 70
              [Win]::mouse_event($b[1], 0, 0, 0, [IntPtr]::Zero); Start-Sleep -Milliseconds 60
            }
          }
          'wheel' {
            $n = [int]$c.notches
            for ($k = 0; $k -lt [Math]::Abs($n); $k++) { [Win]::mouse_event(0x0800, 0, 0, -120 * [Math]::Sign($n), [IntPtr]::Zero); Start-Sleep -Milliseconds 110 }
          }
          'text' {
            $gap = [int](1000 / [double]($c.cps ?? 14))
            foreach ($ch in ([string]$c.text).ToCharArray()) {
              if ($ch -eq [char]10) { [Win]::Key(0x0D, $false); [Win]::Key(0x0D, $true) } else { [Win]::Char($ch) }
              Start-Sleep -Milliseconds $gap
            }
          }
          'key' {
            $codes = foreach ($part in ([string]$c.combo).ToLower() -split '\+') {
              if ($VK.ContainsKey($part)) { $VK[$part] }
              elseif ($part.Length -eq 1) { [int][char]$part.ToUpper() }
              else { throw "unknown key '$part'" }
            }
            foreach ($k in $codes) { [Win]::Key([uint16]$k, $false) }
            Start-Sleep -Milliseconds 40
            [array]::Reverse($codes); foreach ($k in $codes) { [Win]::Key([uint16]$k, $true) }
          }
          'still' {
            # With change > 0, first wait until the region differs that much from how it looked at
            # the start (apps take a moment before a page switch even begins), then until it has not
            # changed for `quiet` ms (page loaded, animation over).
            $sw = [System.Diagnostics.Stopwatch]::StartNew()
            $prev = Thumb $c.x $c.y $c.w $c.h
            $base = $prev
            $reply.changed = $false
            if ([double]$c.change -gt 0) {
              while ($sw.ElapsedMilliseconds -lt [int]$c.changeTimeout) {
                Start-Sleep -Milliseconds 60
                $prev = Thumb $c.x $c.y $c.w $c.h
                if ([Win]::Diff($base, $prev) -gt [double]$c.change) { $reply.changed = $true; break }
              }
            }
            $calm = [System.Diagnostics.Stopwatch]::StartNew()
            $reply.settled = $false
            while ($sw.ElapsedMilliseconds -lt [int]$c.timeout) {
              Start-Sleep -Milliseconds 90
              $cur = Thumb $c.x $c.y $c.w $c.h
              if ([Win]::Diff($prev, $cur) -gt [double]$c.threshold) { $calm.Restart() }
              $prev = $cur
              if ($calm.ElapsedMilliseconds -ge [int]$c.quiet) { $reply.settled = $true; break }
            }
            $reply.waited = $sw.ElapsedMilliseconds
          }
          default { throw "unknown op '$($c.op)'" }
        }
      } catch { $reply = @{ ok = $false; error = "$_" } }
      [Console]::Out.WriteLine(($reply | ConvertTo-Json -Compress)); [Console]::Out.Flush()
    }
  }
}
