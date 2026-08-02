# Build assets

Place `icon.icns` (macOS, 1024×1024 source) and `icon.ico` (Windows, multi-size)
here before the first real release. Until they exist, `electron-builder` uses
Electron's default icon — the app still builds and runs correctly, it just
looks generic. This is a deliberate placeholder, not a bug.
