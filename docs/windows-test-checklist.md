# TVShell — Windows Test Box Checklist (192.168.50.123)

## Remote access (one-time, needed for me to verify fixes remotely)
Pick ONE on the Windows box (as Administrator):

**Option A — OpenSSH server (preferred, works like ssh from here):**
```powershell
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Set-Service sshd -StartupType Automatic
Start-Service sshd
```
Then tell me the username, and either:
- add my key to `C:\Users\<user>\.ssh\authorized_keys` (I'll give you the public key), or
- plan on typing the password when I connect (less convenient).

**Option B — WinRM over HTTP (PowerShell remoting):**
```powershell
winrm quickconfig -quiet
Set-Item WSMan:\localhost\Client\TrustedHosts -Value "192.168.50.*" -Force
```
(Note: from Linux I'd use `evil-winrm`/pywinrm; needs your Windows credentials.)

**Option C — no remote access:** you test manually and paste me errors/screenshots. Slower loop but fine.

Current reachability from this machine: ping OK, port 445 open (SMB), SSH/WinRM/RDP closed.

## Install + first run
1. Copy `TVShell Setup 0.2.0.exe` to the box (I can push via SMB if you share a writable folder, or you download it).
2. Run it — it's one-click, machine-wide, and launches TVShell at the end.
3. It should open fullscreen on the primary display with the dark home screen.

## What to verify (10-minute remote-only pass — unplug mouse/keyboard after step 1 if you can)
- [ ] Boots fullscreen, no title bar, no taskbar visible
- [ ] On load: system volume jumps to 100% + unmuted (there's a toast when it does)
- [ ] Arrows move a clean highlight ring, one element at a time; weather top-left is NOT highlighted while you're elsewhere
- [ ] Enter = OK, Delete/Backspace = Back, End = Menu, Home = returns to home, PgUp/PgDn flip pages, Alt+S sleeps
- [ ] "+" box -> Add app: real Start Menu list, real icons appear after add; launching goes fullscreen; closing the app returns to TVShell, not the desktop
- [ ] Add command: type `notepad` -> tile launches it; tile Menu key -> Rename/Reorder/Delete work
- [ ] Add webapp: any URL -> opens Edge kiosk fullscreen; on close returns to TVShell; favicon shows on the tile
- [ ] Wi-Fi panel: shows current SSID, scans, connect to a network with on-screen keyboard
- [ ] Bluetooth panel: radio toggle + connected list reflects reality
- [ ] Settings: toggle autostart -> reboot PC -> app auto-launches; wallpaper single image (file picker) and folder rotation work; remap a key and it takes effect immediately
- [ ] Power menu: Sleep works (any key wakes to TVShell); Shutdown works; Exit program closes (autostart re-launches on next login)
- [ ] Reboot test: Windows -> auto-login lands in TVShell (see below)

## Known Windows caveats
- Bluetooth *pairing* of brand-new devices opens Windows Settings (Microsoft requires UI consent); connect/disconnect of paired devices stays in-app.
- "Never expose desktop" is app-disciplined (fullscreen relaunch, no taskbar interaction). Hard kiosk (block Win+D/Alt+Tab/TaskMgr) is a separate opt-in step — say the word and I'll add a registry policy pack to the installer.
- Auto-start = per-user registry Run key. For a true appliance boot-straight-to-TV experience, enable Windows auto-login: `netplwiz` (or Settings > Sign-in options) — one-time manual step.
