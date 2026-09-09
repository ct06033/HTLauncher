/* HTLauncher Windows services. All OS touchpoints live here, behind IPC names
 * that mirror the web bridge mock API exactly (web/js/bridge.js).
 * PowerShell does the heavy lifting: ps() encodes scripts as UTF-16
 * -EncodedCommand (no quoting issues) and parses JSON from stdout.
 * NOTE: PowerShell code here must not contain backticks (JS template conflict)
 * — use [char]10 for newlines. */
const { execFile, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const IS_WIN = process.platform === "win32";
const PS_EXE = "powershell.exe";
const PS_ARGS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"];

let lastWebApp = null;

function ps(script, timeoutMs = 20000) {
  return new Promise((resolve) => {
    if (!IS_WIN) return resolve({ ok: false, error: "not-windows" });
    // UTF-16LE WITHOUT BOM — a leading BOM becomes a literal '?' char and
    // breaks the first cmdlet (verified on the Windows test box).
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    execFile(PS_EXE, [...PS_ARGS, "-EncodedCommand", encoded],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = (stdout || "").trim();
        if (!out) { resolve({ ok: false, error: (stderr || (err && err.message) || "no output").slice(0, 300) }); return; }
        try { resolve({ ok: true, data: JSON.parse(out) }); }
        catch (e) { resolve({ ok: true, data: out }); }
      });
  });
}
const q = (s) => String(s).replace(/'/g, "''");          // SQL-style quote escape for PS literals
const parse = (r, fb) => (r.ok && typeof r.data === "object" ? r.data : fb);

/* ================= volume ================= */
// Windows Core Audio via inline C# (MMDevice API).
// GUIDs + vtable order verified against the mingw-w64 IDL (mmdeviceapi.idl,
// endpointvolume.idl) AND tested live on the Windows box (2026-09-09).
// IAudioEndpointVolume order: 1 RegisterCCN 2 UnregisterCCN 3 GetChannelCount
// 4 SetMasterVolumeLevel 5 SetMasterVolumeLevelScalar 6 GetMasterVolumeLevel
// 7 GetMasterVolumeLevelScalar 8-11 channel methods 12 SetMute 13 GetMute.
// NOTE: REFGUID marshals as `ref Guid`, and the coclass needs [ComImport].
const VOL_CS = `
using System;using System.Runtime.InteropServices;
[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume {
  void RegisterControlChangeNotify(IntPtr pNotify);
  void UnregisterControlChangeNotify(IntPtr pNotify);
  void GetChannelCount(out uint chanCount);
  void SetMasterVolumeLevel(float db, ref Guid ctx);
  void SetMasterVolumeLevelScalar(float lvl, ref Guid ctx);
  void GetMasterVolumeLevel(out float db);
  void GetMasterVolumeLevelScalar(out float lvl);
  void SetChannelVolumeLevel(uint n, float db, ref Guid ctx);
  void SetChannelVolumeLevelScalar(uint n, float lvl, ref Guid ctx);
  void GetChannelVolumeLevel(uint n, out float db);
  void GetChannelVolumeLevelScalar(uint n, out float lvl);
  void SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
  void GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
  void Activate(ref Guid iid, uint ctx, IntPtr p, [MarshalAs(UnmanagedType.Interface)] out IAudioEndpointVolume pp);
}
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMEnum {
  [return: MarshalAs(UnmanagedType.Interface)] object EnumAudioEndpoints(uint flow, uint stateMask);
  [return: MarshalAs(UnmanagedType.Interface)] object GetDefaultAudioEndpoint(uint flow, uint role);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] public class MMDeviceEnumeratorCo { }
public static class Vol {
  static readonly string Q = ((char)34).ToString();   // avoid quote-escaping through PS layers
  static IAudioEndpointVolume EP() {
    var en = (IMMEnum)new MMDeviceEnumeratorCo();
    var dev = (IMMDevice)en.GetDefaultAudioEndpoint(0u, 1u);
    var iid = typeof(IAudioEndpointVolume).GUID; IAudioEndpointVolume v;
    dev.Activate(ref iid, 1u, IntPtr.Zero, out v); return v;
  }
  public static string Get(){ var v=EP(); float l; bool m;
    v.GetMasterVolumeLevelScalar(out l); v.GetMute(out m);
    return "{"+Q+"level"+Q+":"+(int)Math.Round(l*100)+","+Q+"muted"+Q+":"+(m?"true":"false")+"}";
  }
  public static void SetMax(){ var v=EP(); var g=new Guid();
    v.SetMute(false, ref g); v.SetMasterVolumeLevelScalar(1f, ref g); }
}
`;
async function volumeGet() {
  const r = await ps("Add-Type -TypeDefinition @'\n" + VOL_CS + "'@\n[Vol]::Get()");
  if (r.ok && typeof r.data === "string") { try { return JSON.parse(r.data); } catch (e) {} }
  return { level: 100, muted: false };              // fail open
}
async function volumeSetMax() {
  await ps("Add-Type -TypeDefinition @'\n" + VOL_CS + "'@\n[Vol]::SetMax()");
  return { ok: true };
}

/* ================= network ================= */
async function netStatus() {
  const script = `
$ErrorActionPreference='SilentlyContinue'
$ipCfg = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1
$ip = if ($ipCfg) { $ipCfg.IPv4Address.IPAddress } else { '' }
$adapter = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Sort-Object LinkSpeed -Descending | Select-Object -First 1
$isWifi = $adapter -and $adapter.PhysicalMediaType -match '802.11|Native 802'
$ssid = ''
$wlanOk = $false
$t = netsh wlan show interfaces | Out-String
if ($t -match '(?im)^\\s*State\\s*:\\s*connected') {
  $wlanOk = $true
  $m = [regex]::Match($t, '(?im)^\\s*SSID\\s*:\\s*(.+)')
  if ($m.Success) { $ssid = $m.Groups[1].Value.Trim() }
}
$type = 'none'
if ($wlanOk -or $isWifi) { $type = 'wifi' }
elseif ($ipCfg -or $adapter) { $type = 'lan' }
$sig = 4
if ($type -eq 'wifi' -and $t -match '(?im)^\\s*Signal\\s*:\\s*(\\d+)%') { $sig = [Math]::Min(4,[Math]::Ceiling([int]$Matches[1]/25)) }
'{"type":"' + $type + '","ssid":"' + ($ssid -replace '"','') + '","ip":"' + $ip + '","signal":' + $sig + '}'
`;
  const r = await ps(script);
  const d = r.ok && typeof r.data === "string" ? safeJson(r.data) : (r.ok ? r.data : null);
  return d || { type: "none", ssid: "", ip: "", signal: 0 };
}

async function netScan() {
  const script = `
$ErrorActionPreference='SilentlyContinue'
$txt = netsh wlan show networks mode=bssid | Out-String
$blocks = $txt -split ([char]10 + [char]10) | Where-Object { $_ -match '(?im)^\\s*SSID\\s*\\d+\\s*:' }
$seen = @{}
$res = foreach ($b in $blocks) {
  $ssid = ($b | Select-String -Pattern '(?im)^\\s*SSID\\s*\\d+\\s*:\\s*(.+)' | ForEach-Object { $_.Matches[0].Groups[1].Value } | Select-Object -First 1)
  if (-not $ssid -or $seen[$ssid]) { continue }
  $seen[$ssid] = $true
  $sec = $b -notmatch '(?im)Authentication\\s*:\\s*Open'
  $sig = 3; if ($b -match '(?im)^\\s*Signal\\s*:\\s*(\\d+)%') { $sig = [Math]::Min(4,[Math]::Ceiling([int]$Matches[1]/25)) }
  [pscustomobject]@{ ssid=$ssid; secured=$sec; signal=$sig }
}
 ConvertTo-Json -Compress -InputObject @($res)
`;
  const r = await ps(script);
  return Array.isArray(r.data) ? r.data : (r.ok && r.data ? [r.data] : []);
}
async function netConnect(ssid, password) {
  const tmp = path.join(os.tmpdir(), "tvshell-wifi-" + Date.now() + ".xml");
  const enc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const sec = password
    ? `<MSM><security><authEncryption><authentication>WPA2PSK</authentication><encryption>AES</encryption><useOneX>false</useOneX></authEncryption><sharedKey><keyType>passPhrase</keyType><plaintext>true</plaintext><keyMaterial>${enc(password)}</keyMaterial></sharedKey></security></MSM>`
    : `<MSM><security><authEncryption><authentication>open</authentication><encryption>none</encryption><useOneX>false</useOneX></authEncryption></security></MSM>`;
  const xml = `<?xml version="1.0"?><WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1"><name>${enc(ssid)}</name><SSIDConfig><SSID><name>${enc(ssid)}</name></SSID></SSIDConfig><connectionType>ESS</connectionType><connectionMode>manual</connectionMode>${sec}</WLANProfile>`;
  fs.writeFileSync(tmp, xml, "utf8");
  const script = `
$ErrorActionPreference='Stop'
try {
  netsh wlan add profile filename='${q(tmp)}' user=all | Out-Null
  netsh wlan connect name='${q(ssid)}' | Out-Null
  Start-Sleep -Seconds 7
  $t = netsh wlan show interfaces | Out-String
  if ($t -match '(?im)^\\s*State\\s*:\\s*connected') { '{"ok":true}' }
  else { '{"ok":false,"error":"Association failed (check password/security type)"}' }
} catch { $e=$_.Exception.Message -replace '"',''; '{"ok":false,"error":"'+$e+'"}' }
finally { Remove-Item -ErrorAction SilentlyContinue '${q(tmp)}' }
`;
  const r = await ps(script, 30000);
  return parse(r, { ok: false, error: "connect failed" });
}

/* ================= bluetooth ================= */
async function btStatus() {
  const script = `
$ErrorActionPreference='SilentlyContinue'
$bt = @(Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue | Where-Object { $_.Present })
$on = @($bt | Where-Object { $_.Status -eq 'OK' }).Count -gt 0
$conn = @()
# Connected peripherals = children of the Bluetooth Enumerator device(s).
$enums = $bt | Where-Object { $_.FriendlyName -match 'Enumerator' }
foreach ($e in $enums) {
  $kids = Get-PnpDeviceProperty -InstanceId $e.InstanceId -KeyName 'DEVPKEY_Device_Children' -ErrorAction SilentlyContinue
  if (-not $kids -or -not $kids.Data) { continue }
  foreach ($cid in $kids.Data) {
    $d = Get-PnpDevice -InstanceId $cid -ErrorAction SilentlyContinue
    if (-not $d -or -not $d.FriendlyName) { continue }
    # the device itself is Class=Bluetooth directly under the enumerator;
    # its child faces (HID/Audio/GATT/profiles) are noisier — skip them
    if ($d.Class -ne 'Bluetooth') { continue }
    if ($d.FriendlyName -match 'Enumerator|Adapter|Radio|Profile|Service|UUID|Control|Sink|Watchdog|iAP|vCard|AVRCP|Hands-Free|LE Link|Microsoft|Generic|Notification|Proxy|Function|Button|Digitizer|Keyboard #|Composite') { continue }
    $myKids = Get-PnpDeviceProperty -InstanceId $cid -KeyName 'DEVPKEY_Device_Children' -ErrorAction SilentlyContinue
    $kind = 'hid'
    if ($myKids -and $myKids.Data) {
      foreach ($k2 in $myKids.Data) {
        if ((Get-PnpDevice -InstanceId $k2 -ErrorAction SilentlyContinue).Class -match 'Audio|Media') { $kind = 'audio'; break }
      }
    }
    $conn += [pscustomobject]@{ name=$d.FriendlyName; kind=$kind }
  }
}
$conn = @($conn | Group-Object name | ForEach-Object { [pscustomobject]@{ name=$_.Name; kind=($_.Group[0].kind) } })
if ($on) { $onStr = 'true' } else { $onStr = 'false' }   # PS 5.1 has no ternary
'{"adapterOn":' + $onStr + ',"connected":' + ((ConvertTo-Json -Compress -InputObject $conn) -replace '^null$','[]') + '}'
`;
  const r = await ps(script);
  const d = r.ok && typeof r.data === "string" ? safeJson(r.data) : r.ok ? r.data : null;
  return d || { adapterOn: false, connected: [] };
}
function safeJson(s) { try { return JSON.parse(s); } catch (e) { return null; } }
async function btKnown() {
  const script = `
$ErrorActionPreference='SilentlyContinue'
$enums = @(Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -match 'Enumerator' -and $_.Present })
$list = @()
foreach ($e in $enums) {
  $kids = Get-PnpDeviceProperty -InstanceId $e.InstanceId -KeyName 'DEVPKEY_Device_Children' -ErrorAction SilentlyContinue
  if (-not $kids -or -not $kids.Data) { continue }
  foreach ($cid in $kids.Data) {
    $d = Get-PnpDevice -InstanceId $cid -ErrorAction SilentlyContinue
    if (-not $d -or -not $d.FriendlyName) { continue }
    if ($d.Status -ne 'OK' -and $d.Enabled) {
      $list += [pscustomobject]@{ name=$d.FriendlyName; kind='hid' }
    }
  }
}
# also paired-but-absent devices (phantom entries PnP keeps)
$phantom = @(Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue | Where-Object { $_.Present -eq $false -and $_.FriendlyName -and $_.FriendlyName -notmatch 'Enumerator|Adapter|Radio' } | ForEach-Object { [pscustomobject]@{ name=$_.FriendlyName; kind='hid' } })
ConvertTo-Json -Compress -InputObject @(@($list; $phantom) | Group-Object name | ForEach-Object { $_.Group[0] })
`;
  const r = await ps(script);
  const list = Array.isArray(r.data) ? r.data : (r.data ? [r.data] : []);
  return list.filter(Boolean);
}
async function btToggle(on) {
  const script = `
$ErrorActionPreference='Stop'
try {
  $r = Get-PnpDevice -Class Bluetooth -ErrorAction Stop | Where-Object { $_.Present } | Select-Object -First 1
  if ($${on ? 'true' : 'false'}) { Enable-PnpDevice -InstanceId $r.InstanceId -Confirm:$false }
  else { Disable-PnpDevice -InstanceId $r.InstanceId -Confirm:$false }
  '{"ok":true}'
} catch { $e=$_.Exception.Message -replace '"',''; '{"ok":false,"error":"'+$e+'"}' }
`;
  const r = await ps(script);
  return parse(r, { ok: false, error: "toggle failed" });
}
async function btConnect(name) {
  await ps("Start-Process 'ms-settings:bluetooth'");
  return { ok: false, error: "Windows requires the pairing page (opened now) — pair once, then it appears here" };
}
async function btDisconnect(name) {
  const script = `
$ErrorActionPreference='Stop'
try {
  $d = Get-PnpDevice -ErrorAction Stop | Where-Object { $_.FriendlyName -eq '${q(name)}' } | Select-Object -First 1
  if (-not $d) { '{"ok":false,"error":"device not found"}' }
  else { Disable-PnpDevice -InstanceId $d.InstanceId -Confirm:$false; '{"ok":true}' }
} catch { $e=$_.Exception.Message -replace '"',''; '{"ok":false,"error":"'+$e+'"}' }
`;
  const r = await ps(script);
  return parse(r, { ok: false, error: "disconnect failed" });
}

/* ================= start menu + launching ================= */
async function listStartMenu() {
  const script = `
$ErrorActionPreference='SilentlyContinue'
$dirs = @(
  (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'),
  (Join-Path $env:ProgramData 'Microsoft\\Windows\\Start Menu\\Programs')
) | Where-Object { $_ -and (Test-Path $_) }
$seen=@{}
$res = foreach ($dir in $dirs) {
  Get-ChildItem -Path $dir -Recurse -Filter '*.lnk' -ErrorAction SilentlyContinue | ForEach-Object {
    $k = $_.BaseName.ToLower()
    if (-not $seen[$k] -and $_.BaseName -notmatch '^(Uninstall|Change|Modify|Repair)') {
      $seen[$k] = $true
      [pscustomobject]@{ name=$_.BaseName; lnk=$_.FullName }
    }
  }
}
ConvertTo-Json -Compress -InputObject @($res)
`;
  const r = await ps(script, 60000);
  const list = Array.isArray(r.data) ? r.data : (r.data ? [r.data] : []);
  return list.filter(Boolean).map(a => ({ name: a.name, path: a.lnk, lnk: a.lnk }));
}
async function launchApp(app) {
  try {
    const child = spawn("cmd.exe", ["/c", "start", "", app.path || app.name], { detached: true, windowsHide: false });
    child.unref();
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}
async function runCommand(cmd) {
  try {
    const child = spawn("cmd.exe", ["/c", "start", "", cmd], { detached: true, windowsHide: false });
    child.unref();
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}
async function openWebApp(url) {
  const args = ["--kiosk", url, "--edge-kiosk-type=fullscreen", "--no-first-run",
    "--disable-pinch", "--overscroll-history-navigation=0"];
  try {
    const child = spawn("msedge.exe", args, { detached: true, windowsHide: false });
    child.unref();
    lastWebApp = child;
    return { ok: true };
  } catch (e) {
    // fallback: edge via cmd start (PATH-less machines)
    try { const c2 = spawn("cmd.exe", ["/c", "start", "msedge", "--kiosk", url], { detached: true }); c2.unref(); return { ok: true }; }
    catch (e2) { return { ok: false, error: e2.message }; }
  }
}

/* ================= favicon + app icons ================= */
function httpGet(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const lib = url.startsWith("https:") ? require("https") : require("http");
    const req = lib.get(url, { timeout: timeoutMs, headers: { "User-Agent": "HTLauncher" } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        return httpGet(new URL(res.headers.location, url).href, timeoutMs).then(resolve);
      }
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}
function cacheDir() {
  const d = path.join(process.env.APPDATA || os.tmpdir(), "HTLauncher", "icons");
  fs.mkdirSync(d, { recursive: true });
  return d;
}
async function faviconFor(url) {
  try {
    const origin = new URL(url).origin;
    const cache = cacheDir();
    const html = await httpGet(url);
    let iconUrl = null;
    if (html && html.body) {
      const head = html.body.slice(0, 64 * 1024).toString("utf8");
      const m = head.match(/<link[^>]+rel=["'](?:apple-touch-icon|shortcut icon|icon)["'][^>]*href=["']([^"']+)["']/i)
             || head.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["'](?:apple-touch-icon|shortcut icon|icon)["']/i);
      if (m) iconUrl = new URL(m[1], url).href;
    }
    const candidates = [iconUrl, origin + "/favicon.ico", origin + "/apple-touch-icon.png"].filter(Boolean);
    for (const cand of candidates) {
      const img = await httpGet(cand);
      if (img && img.status === 200 && img.body.length > 64) {
        const file = path.join(cache, hash(url) + extFor(cand, img.headers));
        fs.writeFileSync(file, img.body);
        return { iconUrl: "file:///" + file.replace(/\\/g, "/") };
      }
    }
    return { iconUrl: null };
  } catch (e) { return { iconUrl: null }; }
}
function hash(s) { let h = 0; for (const c of s) h = ((h << 5) - h + c.charCodeAt(0)) >>> 0; return h.toString(16); }
function extFor(url, headers) {
  const ct = (headers && headers["content-type"]) || "";
  if (ct.includes("png")) return ".png"; if (ct.includes("jpeg")) return ".jpg"; if (ct.includes("svg")) return ".svg";
  if (/\.(png|jpe?g|svg|ico|webp)/i.test(url)) return path.extname(url.split("?")[0]);
  return ".ico";
}
async function appIconFor(lnkPath) {
  // Extract icon from .lnk/.exe via .NET Icon.ExtractAssociatedIcon -> PNG file
  const script = `
$ErrorActionPreference='Stop'
try {
  Add-Type -AssemblyName System.Drawing
  $lnk = '${q(lnkPath)}'
  $sh = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
  $src = if ($sh.TargetPath -and (Test-Path $sh.TargetPath)) { $sh.TargetPath } else { $lnk }
  $ico = [System.Drawing.Icon]::ExtractAssociatedIcon($src)
  $bmp = $ico.ToBitmap()
  $out = Join-Path '${cacheDir().replace(/'/g, "''")}' ((Get-Item $src).BaseName + '.png')
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $uri = ('file:///' + ($out -replace '\\\\','/')) -replace ' ', '%20'
  '{"iconPath":"' + $uri + '"}'
} catch { '{"iconPath":null}' }
`;
  const r = await ps(script);
  return parse(r, { iconPath: null });
}

/* ================= power / autostart / wallpaper / updates ================= */
async function power(kind) {
  if (kind === "sleep") {
    // rundll32 SetSuspendState with hibernate=false forces sleep. If
    // hibernation is enabled on the box this hybrid-suspends instead;
    // checklist notes how to disable (powercfg /h off).
    execFile("rundll32.exe", ["powrprof.dll,SetSuspendState", "0,1,0"], { windowsHide: true }, () => {});
    return { ok: true };
  }
  if (kind === "shutdown") { execFile("shutdown.exe", ["/s", "/t", "3"], () => {}); return { ok: true }; }
  if (kind === "exit") { return { ok: true }; }   // main process handles app.quit()
  return { ok: false, error: "unknown power kind" };
}
async function setAutostart(on) {
  const exe = process.env["TVSHELL_EXE"] || process.execPath;
  const script = `
$ErrorActionPreference='Stop'
try {
  $run = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
  if ($${on ? 'true' : 'false'}) { Set-ItemProperty -Path $run -Name 'HTLauncher' -Value '"${q(exe)}"' }
  else { Remove-ItemProperty -Path $run -Name 'HTLauncher' -ErrorAction SilentlyContinue }
  '{"ok":true}'
} catch { '{"ok":false,"error":"'+($_.Exception.Message -replace '"','')+'"}' }
`;
  const r = await ps(script);
  return parse(r, { ok: false });
}
async function pickWallpaper() {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.OpenFileDialog
$dlg.Filter = 'Images|*.jpg;*.jpeg;*.png;*.webp;*.bmp|All|*.*'
$dlg.Title = 'Choose wallpaper'
if ($dlg.ShowDialog() -eq 'OK') { '{"path":"' + ($dlg.FileName -replace '\\\\','/') + '"}' } else { '{"path":null}' }
`;
  const r = await ps(script, 120000);
  return parse(r, { path: null });
}
async function listWallpaperDir(dir) {
  const script = `
$ErrorActionPreference='SilentlyContinue'
Get-ChildItem -Path '${q(dir)}' -Include *.jpg,*.jpeg,*.png,*.webp,*.bmp -Recurse:$false |
  ForEach-Object { $_.FullName -replace '\\\\','/' } | ConvertTo-Json -Compress
`;
  const r = await ps(script);
  let list = r.ok && r.data ? r.data : [];
  if (!Array.isArray(list)) list = [list];
  return list.filter(Boolean).map(p => "file:///" + p.replace(/^\//, ""));
}
async function checkForUpdates() { return { available: false, version: app_version() }; }
function app_version() {
  try { return require("../package.json").version; } catch (e) { return "0.0.0"; }
}

/* ================= IPC registration ================= */
function registerIpc(ipcMain, getWindow, getUpdater) {
  const h = (ch, fn) => ipcMain.handle(ch, async (_e, ...args) => {
    try { return await fn(...args); }
    catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });
  h("svc:volume-get", volumeGet);
  h("svc:volume-set-max", volumeSetMax);
  h("svc:net-status", netStatus);
  h("svc:net-scan", netScan);
  h("svc:net-connect", (ssid, pw) => netConnect(ssid || "", pw || ""));
  h("svc:bt-status", btStatus);
  h("svc:bt-known", btKnown);
  h("svc:bt-toggle", btToggle);
  h("svc:bt-connect", btConnect);
  h("svc:bt-disconnect", btDisconnect);
  h("svc:startmenu", listStartMenu);
  h("svc:launch-app", launchApp);
  h("svc:run-cmd", runCommand);
  h("svc:open-webapp", openWebApp);
  h("svc:favicon", faviconFor);
  h("svc:app-icon", appIconFor);
  h("svc:pick-wallpaper", pickWallpaper);
  h("svc:wp-dir", listWallpaperDir);
  h("svc:autostart", setAutostart);
  h("svc:check-updates", async () => {
    const u = getUpdater && getUpdater();
    if (!u) return { available: false, version: app_version() };
    try {
      const r = await u.checkForUpdates();
      return { available: !!(r && r.updateInfo && r.updateInfo.version !== app_version()),
               version: r && r.updateInfo ? r.updateInfo.version : app_version() };
    } catch (e) { return { available: false, version: app_version() }; }
  });
  h("svc:install-update", async () => {
    const u = getUpdater && getUpdater();
    if (!u) return { ok: false, error: "updater unavailable" };
    try { u.quitAndInstall(); return { ok: true }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
  h("svc:power", async (kind) => {
    const r = await power(kind);
    if (kind === "exit") { const w = getWindow(); if (w) w.close(); }
    return r;
  });
}

module.exports = { registerIpc, ps, volumeGet, volumeSetMax, netStatus, netScan, netConnect,
  btStatus, btKnown, btToggle, btConnect, btDisconnect, listStartMenu, launchApp, runCommand,
  openWebApp, faviconFor, appIconFor, power, setAutostart, pickWallpaper, listWallpaperDir };
