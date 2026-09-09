# TVShell — Google TV-like Windows Experience

**Goal:** A standalone, remote-control-driven "TV shell" for Windows that never exposes the desktop, validated first as a web app, shipped as an NSIS installer.

**Architecture:** Electron app. All UI lives in a frameless fullscreen renderer written in vanilla HTML/CSS/JS. A `bridge` abstraction lets the renderer run in a plain browser against a **mock service backend** (Phase 1: UI validation) and in Electron against **real Windows services** over IPC (Phase 2: native + exe). Windows integration via PowerShell/netsh/child_process from the main process.

**Tech stack:** Electron 33+, vanilla JS/CSS, electron-builder (NSIS), Open-Meteo (weather, no API key), Edge kiosk for webapps.

---

## Requirement mapping

| PRD area | Approach |
|---|---|
| Fullscreen, no chrome | Frameless, kiosk-boundary Electron window on primary display |
| Never expose desktop | Shell owns focus; launched apps/webapps run fullscreen; Exit paths return to TV home, never Explorer |
| No mouse/keyboard needed | Spatial focus navigation engine; every control reachable by arrow keys; OK=Enter, Back=Del, Home, Menu=End, PgUp/PgDn pages |
| Remote key map | Default map per PRD, editable in Settings (capture-style remap UI) |
| Volume 100%/unmute on load | Core Audio via PowerShell in main process (mock in web mode) |
| On-screen keyboard | Grid OSK: letters, specials, shift, backspace, enter, minimize, submit |
| Home screen | Top bar (BT, Wi-Fi, Settings, Power, clock/date, weather 5-day popup) + pages (HOME + up to 3) + 7-across scrollable tile grid with always-visible "+" box |
| Add app | Enumerate Start Menu + AppsFolder via PowerShell; list picker |
| Add command | Name + run-dialog command; launches via cmd |
| Add webapp | `msedge --kiosk <url> --edge-kiosk-type=fullscreen`; favicon extracted server-side |
| Tile menu | Rename / Reorder / Edit (cmd+webapp only) / Delete; new tiles insert at front |
| Wi-Fi panel | `netsh wlan` scan/connect + connection info; LAN vs Wi-Fi icon state |
| Bluetooth panel | PnP devices via CIM; connect/disconnect basic UI |
| Settings | Auto-start toggle (registry Run key), key remap, °F/°C, 12H/24H, wallpaper (single image or random directory rotation w/ interval) |
| Power | Sleep (`SetSuspendState`), Shutdown (`shutdown.exe`), Exit program |
| Updates | Daily check via electron-updater (generic feed URL — TBD where you host) |
| Installer | NSIS, silent-capable, auto-launch after install |

## Phases

- **P1 Foundation:** scaffold, navigation engine, mock bridge (browser-runnable).
- **P2 Home UI:** top bar, weather, clock, tile grid, pages, wallpaper rotation.
- **P3 Panels:** OSK, Wi-Fi, Bluetooth, Settings, Power.
- **P4 Add/Launch:** add-app, add-command, add-webapp, tile context menu, fullscreen launch.
- **P5 Native services:** IPC bridge for real Windows (volume, power, netsh, PnP, start-menu enum, autostart, updater).
- **P6 Package:** NSIS installer build (cross-compiled with wine), hand-off checklist for your Windows test box.

**Gate:** after P2–P4 you review the running web app in a browser and approve before P5–P6 start.

## Risks / open questions
- Update hosting: need a URL (GitHub Releases works) to point electron-updater at — decide before P6.
- "Never expose desktop" fully watertight (Win+D, Alt+Tab suppression, taskbar) needs Windows shell-level tricks (KioskMode via registry / keyboard hooks). Phase 1 does app-level discipline; hard kiosk lock is optional P6 stretch.
- NSIS cross-build from Linux needs wine; fallback = build script you run once on the Windows box.
- Bluetooth pairing (as opposed to connect/disconnect of known devices) is genuinely painful via CLI; will ship connect/disconnect + deep-link to Windows pairing on request.
