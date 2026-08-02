# Packaging and CI/CD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the Electron app from plan 2 into a macOS `.dmg` (arm64 + x64) and a Windows NSIS `.exe`, and stand up GitHub Actions so tests run on every push and installers build automatically on a version tag — without requiring code-signing secrets to exist.

**Architecture:** `electron-builder` reads a `dashboard/electron-builder.yml` describing what to package (`dist/` + `build-electron/`) and how (dmg/nsis targets). Two workflows: `test.yml` (Ubuntu, every push) and `release.yml` (a `macos-latest` + `windows-latest` matrix, triggered on `v*` tags, uploading installers to a GitHub Release). Signing is opportunistic — `electron-builder` signs automatically when `CSC_LINK`/`CSC_KEY_PASSWORD` (mac) or `WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD` (win) secrets are present, and silently skips when they are not.

**Tech Stack:** `electron-builder` (config verified against installed `app-builder-lib` typings), GitHub Actions.

**Precondition:** Plan 2 is complete — `npm run build && npm run build:electron` produces a runnable `build-electron/electron-main/index.js`.

---

## Verified environment facts

- `app-builder-lib`'s `Configuration` type (what `electron-builder.yml` is validated against) has top-level `directories`, `mac`, `dmg`, `win`, `nsis` keys, and `npmRebuild: boolean` — confirmed by reading `node_modules/app-builder-lib/out/configuration.d.ts` against the installed `electron-builder@26.15.3`.
- The backend has **zero native Node modules** (`node:sqlite` is built into Node/Electron; `hono`, `exceljs`, `chokidar`-equivalent logic are all pure JS) — per the design spec's driver choice. Setting `npmRebuild: false` is therefore correct and skips a rebuild step that would otherwise try to recompile nothing, shaving real time off every CI run. If a future dependency introduces a native module, this must be revisited.
- No `.github/` directory exists in this repository today (checked at spec time) and the remote is `git@github.com:25Bonged/EMLAB.git`.

## File structure

| File | Responsibility |
|---|---|
| `dashboard/electron-builder.yml` | What to package, mac/win targets |
| `dashboard/build/icon.icns`, `dashboard/build/icon.ico` | App icons (placeholder, see Task 1) |
| `.github/workflows/test.yml` | Lint, typecheck, test — every push |
| `.github/workflows/release.yml` | Build + upload installers — on `v*` tag push |

---

### Task 1: App icon placeholders

electron-builder requires an `.icns` (mac) and `.ico` (win) or it falls back to Electron's default icon, which is fine to ship initially but must not silently stay that way forever — this task creates the directory and documents the gap rather than blocking on real artwork.

**Files:**
- Create: `dashboard/build/README.md`

- [ ] **Step 1: Create the build assets directory with a note**

```bash
mkdir -p dashboard/build
```

Create `dashboard/build/README.md`:

```markdown
# Build assets

Place `icon.icns` (macOS, 1024×1024 source) and `icon.ico` (Windows, multi-size)
here before the first real release. Until they exist, `electron-builder` uses
Electron's default icon — the app still builds and runs correctly, it just
looks generic. This is a deliberate placeholder, not a bug.
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/build/README.md
git commit -m "chore: add build assets directory with icon placeholder note"
```

---

### Task 2: electron-builder configuration

**Files:**
- Create: `dashboard/electron-builder.yml`
- Modify: `dashboard/package.json`

- [ ] **Step 1: Create `dashboard/electron-builder.yml`**

```yaml
appId: com.emlab.daily-fev-library
productName: EMLAB
directories:
  output: release
  buildResources: build
files:
  - build-electron/**/*
  - dist/**/*
  - package.json
extraMetadata:
  main: build-electron/electron-main/index.js
npmRebuild: false
mac:
  category: public.app-category.developer-tools
  target:
    - target: dmg
      arch:
        - arm64
        - x64
  icon: build/icon.icns
dmg:
  contents:
    - x: 130
      y: 220
    - x: 410
      y: 220
      type: link
      path: /Applications
win:
  target:
    - target: nsis
      arch:
        - x64
  icon: build/icon.ico
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

`extraMetadata.main` overrides `package.json`'s `main` field (which stays `electron-main/index.ts` for `npm run electron:dev`, per plan 2 Task 1) so the **packaged** app points at the compiled entry point instead.

- [ ] **Step 2: Add packaging scripts to `dashboard/package.json`**

```json
    "predist": "npm run build && npm run build:electron",
    "dist:mac": "electron-builder --mac --config electron-builder.yml",
    "dist:win": "electron-builder --win --config electron-builder.yml",
```

`predist` runs automatically before both `dist:*` scripts (npm's lifecycle convention — no separate wiring needed).

- [ ] **Step 3: Verify the config is well-formed**

```bash
cd dashboard && npx electron-builder --help >/dev/null && node -e "require('js-yaml').load(require('fs').readFileSync('electron-builder.yml','utf-8')); console.log('YAML OK')"
```

If `js-yaml` is not present as a transitive dependency, install it as a dev dependency for this one check: `npm install -D js-yaml`, run the check, then it may remain — `electron-builder` itself depends on a YAML parser at runtime already, so this does not add packaging weight.

Expected: `YAML OK` printed, no parse errors.

- [ ] **Step 4: Build the mac target locally**

```bash
cd dashboard && npm run dist:mac
```

Expected: exits 0, and `dashboard/release/` contains `EMLAB-<version>-arm64.dmg` and `EMLAB-<version>.dmg` (or `x64` variants, depending on the runner's default arch — both are requested via the `arch` list). This step can only be verified on macOS; the Windows NSIS target is built and verified in CI (Task 4), not locally, since this repository's development machine is a Mac.

- [ ] **Step 5: Add the build output to `.gitignore`**

Confirm `dashboard/release/` is ignored (add it to `dashboard/.gitignore` if not already covered by an existing `dist`/`build` pattern):

```bash
grep -q '^release/' dashboard/.gitignore || echo 'release/' >> dashboard/.gitignore
grep -q '^build-electron/' dashboard/.gitignore || echo 'build-electron/' >> dashboard/.gitignore
```

- [ ] **Step 6: Commit**

```bash
git add dashboard/electron-builder.yml dashboard/package.json dashboard/package-lock.json dashboard/.gitignore
git commit -m "feat: add electron-builder configuration for dmg and nsis targets"
```

---

### Task 3: CI — tests on every push

**Files:**
- Create: `.github/workflows/test.yml`

- [ ] **Step 1: Create `.github/workflows/test.yml`**

```yaml
name: Test

on:
  push:
    branches: ['**']
  pull_request:
    branches: ['**']

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: dashboard/package-lock.json

      - name: Install dependencies
        working-directory: dashboard
        run: npm ci

      - name: Typecheck
        working-directory: dashboard
        run: npx tsc -b

      - name: Lint
        working-directory: dashboard
        run: npm run lint

      - name: Test
        working-directory: dashboard
        run: npm test
```

- [ ] **Step 2: Verify the YAML is well-formed**

```bash
node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/test.yml','utf-8')); console.log('YAML OK')"
```

Expected: `YAML OK`. (True end-to-end verification happens once this is pushed and Actions runs it — there is no local GitHub Actions emulator in this plan's scope.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: run typecheck, lint, and tests on every push"
```

---

### Task 4: CD — release builds on a version tag

The matrix that cannot be replicated locally: `windows-latest` produces the NSIS installer, `macos-latest` produces both dmg architectures, both upload to a GitHub Release keyed by the pushed tag. Signing env vars are passed through unconditionally — `electron-builder` itself checks whether they're set and no-ops signing when they aren't, so the workflow needs no conditional logic to stay "unsigned-safe."

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  release:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-latest
            script: dist:mac
          - os: windows-latest
            script: dist:win
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
          cache-dependency-path: dashboard/package-lock.json

      - name: Install dependencies
        working-directory: dashboard
        run: npm ci

      - name: Test
        working-directory: dashboard
        run: npm test

      - name: Build installer
        working-directory: dashboard
        run: npm run ${{ matrix.script }}
        env:
          # macOS signing + notarization — no-ops if these secrets are unset.
          CSC_LINK: ${{ secrets.CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          # Windows signing — no-op if unset.
          WIN_CSC_LINK: ${{ secrets.WIN_CSC_LINK }}
          WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Upload installers to the release
        uses: softprops/action-gh-release@v2
        with:
          files: |
            dashboard/release/*.dmg
            dashboard/release/*.exe
          fail_on_unmatched_files: false
```

`fail_on_unmatched_files: false` because each matrix leg only produces one of the two file types — the mac job's glob for `*.exe` legitimately matches nothing, and vice versa.

- [ ] **Step 2: Verify the YAML is well-formed**

```bash
node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/release.yml','utf-8')); console.log('YAML OK')"
```

Expected: `YAML OK`.

- [ ] **Step 3: Document the signing secrets as an explicit open item**

Add a section to `dashboard/build/README.md` (created in Task 1):

```markdown

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
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml dashboard/build/README.md
git commit -m "ci: build and publish mac/windows installers on version tags, unsigned until certs are added"
```

---

### Task 5: End-to-end dry run

The one verification that requires actually pushing to GitHub — everything before this is either local or YAML-syntax-checked.

**Files:** none (verification only)

- [ ] **Step 1: Push the branch and confirm the test workflow runs**

```bash
git push origin main
```

Then check `gh run list --workflow=test.yml --limit 1` (or the Actions tab) for a green run.

- [ ] **Step 2: Tag a release candidate and confirm the release workflow runs**

Only do this once the user has reviewed the change — a tag push is a real, visible action. Confirm with the user before running:

```bash
git tag v0.1.0-rc1
git push origin v0.1.0-rc1
```

Then check `gh run list --workflow=release.yml --limit 1`. Expected: both matrix legs succeed, and a draft/published release at `v0.1.0-rc1` has a `.dmg` (×2, arm64+x64) and a `.exe` attached.

- [ ] **Step 3: Download and smoke-test at least the macOS artifact locally**

```bash
gh release download v0.1.0-rc1 -p '*arm64.dmg' -D /tmp/emlab-release-check
open /tmp/emlab-release-check/*.dmg
```

Drag to Applications, launch, confirm the first-run folder picker appears and the window loads. This is the final proof the whole pipeline — port, shell, packaging, CI — produces a working double-clickable app.

---

## Definition of done for this plan

- `dashboard/electron-builder.yml` builds a mac dmg locally via `npm run dist:mac`.
- `.github/workflows/test.yml` runs typecheck + lint + test on every push.
- `.github/workflows/release.yml` builds mac and Windows installers on a `v*` tag and attaches them to a GitHub Release.
- Both workflows build successfully with no signing secrets present; signing activates automatically once secrets are added, with no workflow-file change required.
- The signing gap is documented in `dashboard/build/README.md`, not silently absent.

## Self-review notes

- **Spec coverage:** dmg (arm64+x64) + nsis targets → Task 2. `npmRebuild: false` reflecting the zero-native-modules driver choice → Task 2, justified in "Verified environment facts". Test CI → Task 3. Release CD → Task 4. Unsigned-safe-by-default, signing activates on secret presence → Task 4 Step 1 (no conditional needed — electron-builder handles this itself), documented as an explicit open item in Task 4 Step 3 matching the spec's stance. Auto-update explicitly out of scope, consistent with the spec.
- **Placeholder scan:** the app icon is a genuine placeholder (Electron's default) — called out explicitly as deliberate, with a task documenting what replaces it, not left as a silent TODO.
- **Dependency on plan 2:** `extraMetadata.main: build-electron/electron-main/index.js` in Task 2 matches exactly the output path plan 2 Task 9 produces (`tsconfig.build.json`'s `outDir: ./build-electron` with `rootDir: .`, so `electron-main/index.ts` → `build-electron/electron-main/index.js`). If plan 2's `outDir` changes, this path must change with it.
