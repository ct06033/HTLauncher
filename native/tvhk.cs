// HTLauncher TV-view input bridge: low-level keyboard hook that maps
//   Escape -> browser back (Alt+Left), double-press at same page -> close window
//   Home   -> close window (=> back to launcher)
//   Backspace/Delete: PASSED THROUGH UNTOUCHED — sites' own in-page back
//     (Netflix/Spotify close overlays & step screens with it) stays ours.
// ONLY while an Edge app window (class Chrome_WidgetWin_1, title matching
// Spotify/Netflix) is the foreground window. Everything else passes through
// untouched. No Edge profile or policy changes — plain OS input, the same
// mechanism accessibility tools and remappers use.
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.IO;
using System.Threading;

class Tvhk {
  const int WH_KEYBOARD_LL = 13;
  const uint WM_KEYDOWN = 0x0100;
  const uint WM_CLOSE = 0x0010;
  static IntPtr hookId = IntPtr.Zero;
  static LowLevelKeyboardProc proc = HookCallback;   // rooted delegate, GC-safe
  static int lastBackMs = 0;
  static string lastTitle = "";
  static readonly object gate = new object();
  static string LogPath = Path.Combine(Path.GetTempPath(), "htlhook.log");

  [StructLayout(LayoutKind.Sequential)]
  struct KBDLLHOOKSTRUCT { public uint vkCode, scanCode, flags, time; IntPtr dwExtraInfo; }
  delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll", SetLastError = true)]
  static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool GetMessage(out MSG m, IntPtr h, uint a, uint b);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG m);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG m);
  [StructLayout(LayoutKind.Sequential)]
  struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam;
              public uint time; public int x, y; }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern IntPtr PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
  static ushort keybd_state {
    get {
      ushort s = 0;
      if ((GetAsyncKeyState(0x11) & 0x8000) != 0) s |= 0x4000;  // ctrl
      if ((GetAsyncKeyState(0x10) & 0x8000) != 0) s |= 0x8000;  // shift
      if ((GetAsyncKeyState(0x12) & 0x8000) != 0) s |= 0x2000;  // alt
      return s;
    }
  }
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);

  static string FgTitle(IntPtr h) {
    var sb = new StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString();
  }
  static bool IsTVView(IntPtr h) {
    if (h == IntPtr.Zero || !IsWindowVisible(h)) return false;
    var cb = new StringBuilder(256); GetClassName(h, cb, 256);
    if (cb.ToString() != "Chrome_WidgetWin_1") return false;
    var t = FgTitle(h).ToLower();
    return t.Contains("spotify") || t.Contains("netflix");
  }
  static void Log(string s) {
    try { File.AppendAllText(LogPath, DateTime.Now.ToString("HH:mm:ss.fff") + " " + s + "\n"); } catch {}
  }
  // UIA sees DOM focus across the single Chromium HWND: if the focused
  // element is a text field, Escape belongs to the page, not to us.
  static bool FocusIsEditText(IntPtr h) {
    // UIA reads cross-process accessibility focus (Chromium publishes its
    // DOM focus into the MSAA/UIA tree — screen readers rely on this).
    // Edit/ComboBox = real text control. Document (page body) must NOT
    // match or every Escape would pass through. CachedElement fallback:
    // AutomationElement.FocusedElement can throw right at focus changes.
    for (int attempt = 0; attempt < 2; attempt++) {
      try {
        var fe = System.Windows.Automation.AutomationElement.FocusedElement;
        if (fe == null) continue;
        var ct = fe.Current.ControlType;
        return ct == System.Windows.Automation.ControlType.Edit ||
               ct == System.Windows.Automation.ControlType.ComboBox;
      } catch { Thread.Sleep(20); }
    }
    return false;   // UIA unavailable -> treat as not-editing (remap wins)
  }
  static void AltLeft() {
    keybd_event(0x12, 0x38, 0, IntPtr.Zero);
    Thread.Sleep(20);
    keybd_event(0x25, 0x4B, 0, IntPtr.Zero);
    Thread.Sleep(40);
    keybd_event(0x25, 0x4B, 2, IntPtr.Zero);
    keybd_event(0x12, 0x38, 2, IntPtr.Zero);
  }

  static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
    if (nCode >= 0 && (uint)wParam == WM_KEYDOWN) {
      var info = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
      uint vk = info.vkCode;
      // Ignore anything with modifiers held (Ctrl+Esc etc.) and synthetic
      // injection (LLKHF_INJECTED) so our own Alt+Left can never loop back.
      if ((info.flags & 0x10) != 0) return CallNextHookEx(hookId, nCode, wParam, lParam);
      if ((keybd_state & 0xE000) != 0) return CallNextHookEx(hookId, nCode, wParam, lParam); // ctrl/shift/alt down
      // Backspace/Delete deliberately NOT hooked: pass through so the sites'
      // own in-app back/typing keeps working. We only claim Escape and Home.
      if (vk == 0x1B || vk == 0x24) {          // Esc / Home
        IntPtr h = GetForegroundWindow();
        if (IsTVView(h)) {
          // When the in-page on-screen keyboard is open, focus is an Edit
          // field, so FocusIsEditText() below passes Escape straight to the
          // page -> osk.js closes the OSK. Only once focus is NOT a text
          // control (OSK closed, not in search) does the remap take over.
          // If focus sits in a text field (search box, OSK), Escape must go
          // to the page untouched — the site closes its own search/overlay.
          if (vk == 0x1B && FocusIsEditText(h)) {
            Log("ESC in edit field -> passthrough");
            return CallNextHookEx(hookId, nCode, wParam, lParam);
          }
          if (vk == 0x24) {                                   // Home: always exit
            Log("HOME -> close " + h);
            PostMessage(h, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
            return (IntPtr)1;
          }
          lock (gate) {
            string title = FgTitle(h);
            int now = Environment.TickCount;
            bool samePageDbl = (now - lastBackMs < 2500) && title == lastTitle;
            lastBackMs = now; lastTitle = title;
            if (samePageDbl) {
              Log("DBL-BACK same page -> close, title=" + title.Substring(0, Math.Min(40, title.Length)));
              PostMessage(h, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
            } else {
              Log("BACK -> AltLeft, title=" + title.Substring(0, Math.Min(40, title.Length)));
              AltLeft();
            }
          }
          return (IntPtr)1;   // swallow keydown only; keyup passes harmlessly
        }
      }
    }
    return CallNextHookEx(hookId, nCode, wParam, lParam);
  }

  [STAThread]
  static void Main(string[] args) {
    bool fresh;
    using (var mut = new Mutex(true, "htl-tvhk-single", out fresh)) {
      if (!fresh) return;   // newer instance took over; exit quietly
      hookId = SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(null), 0);
      if (hookId == IntPtr.Zero) { Log("HOOK_FAIL"); return; }
      Log("HOOK_UP");
      MSG m;
      while (GetMessage(out m, IntPtr.Zero, 0, 0)) { TranslateMessage(ref m); DispatchMessage(ref m); }
    }
  }
}
