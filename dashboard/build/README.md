# Build assets

Place `icon.icns` (macOS, 1024×1024 source) and `icon.ico` (Windows, multi-size)
here before the first real release. Until they exist, `electron-builder` uses
Electron's default icon — the app still builds and runs correctly, it just
looks generic. This is a deliberate placeholder, not a bug.

## Code signing (not yet configured)

Release builds run unsigned until these repository secrets are added
(Settings → Secrets and variables → Actions):

- `CSC_LINK`, `CSC_KEY_PASSWORD` — Developer ID Application certificate (.p12), base64-encoded, for macOS signing
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` — for notarization
- `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` — code signing certificate (.pfx), base64-encoded, for Windows

Until these exist, macOS installs require right-click → Open on first launch,
and Windows shows a SmartScreen warning. Auto-update (not yet implemented)
cannot be added before macOS signing is in place — unsigned auto-update
silently fails on macOS. This is a purchasing decision (Apple Developer
Program, ~$99/yr; a Windows OV certificate, ~$200–400/yr), not an engineering
gap — see `docs/superpowers/specs/2026-08-02-electron-desktop-app-design.md`.
