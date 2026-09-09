# TVShell — Building on Linux

## One-time setup (already applied on this machine)
Cross-building the NSIS installer from Linux uses wine to stamp version
resources into TVShell.exe. First-run wine prefix init HANGS on mono/gecko
prompt logic in headless environments. Fixes (already in use):

    export WINEPREFIX=$HOME/.wine-tvshell      # fresh prefix (old ~/.wine is stuck/junk)
    export WINEDLLOVERRIDES="mscoree,mshtml="  # never load mono/gecko (the hang)
    export WINEDEBUG=-all                      # keep logs sane

## Build
    cd /home/caspar/tvshell
    npm install                 # electron + electron-builder (dev deps)
    npx electron-builder --win nsis

Output: dist/TVShell Setup <version>.exe  (one-click NSIS, perMachine, runAfterFinish)

## Release flow (versioning policy)
1. Bump "version" in package.json — semver:
   - patch 0.2.x: bug fixes
   - minor 0.x.0: features
   - major: reserved for the 1.0 appliance release
2. Commit everything, tag:
    git tag -a v0.2.0 -m "what shipped"
   (web-revision approvals get tags too, e.g. v0.1.0 = approved UI)
3. Build installer (above). Installer name embeds the version automatically.
4. Update channel (TODO): host dist/*.exe + latest.yml on a GitHub Release
   for electron-updater; wire svc:check-updates/svc:install-update to it
   (P5-2). Until then checkForUpdates returns "up to date" — harmless.

## Local smoke test (Linux)
    npx electron . --no-sandbox
Renders the same UI; PowerShell services fail open to safe defaults.

## Gotchas
- web/ assets are version-quoted (?v=NN). Bump every script tag when you
  change JS/CSS or the browser cache will serve stale code (bit us during
  the P4 bug hunt — a "fix" looked broken for an hour).
- Python http.server sends 304s aggressively; use ?v= busting or hard-refresh.
- Services PowerShell here-strings must not contain backticks (JS template
  conflict). Use [char]10 for newlines inside PS scripts.
- If wine still wedges: delete $WINEPREFIX and re-run (prefixes are disposable).
