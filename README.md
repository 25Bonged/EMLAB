# EMLAB

[![Test](https://github.com/25Bonged/EMLAB/actions/workflows/test.yml/badge.svg)](https://github.com/25Bonged/EMLAB/actions/workflows/test.yml)
[![Release](https://github.com/25Bonged/EMLAB/actions/workflows/release.yml/badge.svg)](https://github.com/25Bonged/EMLAB/actions/workflows/release.yml)
[![Latest release](https://img.shields.io/github/v/release/25Bonged/EMLAB)](https://github.com/25Bonged/EMLAB/releases/latest)

A desktop dashboard for compiling and reviewing vehicle emissions test results. It watches a
local folder of test reports (`*_REPORT.pdf` + `*_TRACES.xlsm` pairs), parses and indexes them,
and gives engineers overview, compliance, trend, and comparison views across programs without
manual spreadsheet work.

## Install (Windows)

1. Download the latest `EMLAB.Setup.*.exe` from [Releases](https://github.com/25Bonged/EMLAB/releases/latest).
2. Run it — it's a per-user install, no admin rights required.
3. Windows SmartScreen may warn that the app is from an unrecognized publisher, since it isn't
   code-signed yet. Click **More info → Run anyway** to proceed. If your organization blocks
   this entirely (no "Run anyway" option appears), that's an IT-managed policy — see your admin.

A macOS `.dmg` build is also produced by the release pipeline.

## Features

- Drag-and-drop or folder-watched intake of report/trace pairs into per-program folders
- Automatic parsing of PDF reports and XLSM drive-trace workbooks
- Overview, Compliance, Trends, Compare, and Master Table views across programs
- Per-test detail and exportable reports
- Optional [Outlook attachment automation](scripts/outlook-downloader) for Windows/Classic
  Outlook users, so incoming test emails are picked up without manual saving

## Development

The app is a Node.js/Hono server (serving the built dashboard from the same origin) wrapped in
Electron for the desktop build — there is no separate backend service.

```sh
npm --prefix dashboard ci
npm --prefix dashboard run build
./scripts/start_emlab.sh
```

`./scripts/setup_emlab.sh` runs the first two steps for you.

To build the desktop installer locally:

```sh
cd dashboard
npm run dist:win   # or dist:mac
```

Output lands in `dashboard/release/`.

### Releasing

Pushing a tag matching `v*` (e.g. `v1.2.3`) triggers [`.github/workflows/release.yml`](.github/workflows/release.yml),
which runs the test suite and builds + publishes signed-ready Windows and macOS installers to a
GitHub Release automatically. Bump `dashboard/package.json`'s `version` to match before tagging.

## Optional Outlook attachment downloader

For Windows machines using Classic Outlook, `scripts/outlook-downloader/` contains an optional
companion that saves emailed `*_REPORT.pdf` and `*_TRACES.xlsm` attachments into existing EMLAB
program folders. It stores no mailbox password and never opens or executes attachments. See
[`scripts/outlook-downloader/README.md`](scripts/outlook-downloader/README.md) before scheduling it.
