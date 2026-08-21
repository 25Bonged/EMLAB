# EMLAB Outlook Attachment Downloader

This optional Windows companion downloads `*_REPORT.pdf` and `*_TRACES.xlsm`
attachments from Classic Outlook emails and saves them into EMLAB's watched
program folders.

The downloader only saves a complete same-stem pair from an accepted email:
`*_REPORT.pdf` plus the matching `*_TRACES.xlsm`. If the email has only one of
those files, nothing from that set is saved.

It does not open attachments, execute macros, store mailbox passwords, bypass
Defender, require Python, or require administrator rights. The shipped runner
uses Windows PowerShell and Classic Outlook's signed-in profile.

## Setup

1. Run `run_emlab_downloader.bat` once. It creates the runtime config at
   `%APPDATA%\EMLAB\outlook-downloader\config.json` if it is missing.
2. Set `output_root` to the same local EMLAB root folder used by the app,
   usually:

   ```json
   "%APPDATA%\\EMLAB\\Programs"
   ```

3. Create the project/program inside EMLAB first, for example `STLA` and
   `RNTBCI`. The downloader saves into those existing project folders. If a
   matching folder is missing, files go to
   `_email_downloads_needs_program` for manual review.
4. Add exact sender addresses in `allowed_senders` before daily use. The
   downloader and scheduled-task installer intentionally fail while this list
   is empty.
5. Validate the config without touching Outlook:

   ```bat
   powershell -NoProfile -ExecutionPolicy Bypass -File download_emlab_attachments.ps1 -Config "%APPDATA%\EMLAB\outlook-downloader\config.json" -CheckConfig
   ```

## Scheduling

Run `install_scheduled_task.bat` to create the scheduled task, or create one
manually that runs `run_emlab_downloader.bat` every 5 minutes. Use "Run only
when user is logged on" so Classic Outlook's existing signed-in profile is
available. Set "If the task is already running" to "Do not start a new
instance"; the script also keeps its own lock file.

## Project Mapping

By default, the project is extracted from filename rules:

- `CITROEN` or `AIRCROSS` routes to `STLA`.
- `RNTBCI`, `DUSTER`, `TRIBER`, `HR10`, or `HR13` routes to `RNTBCI`.

For:

```text
CITROEN_AIRCROSS_MT_9740_5099_2026-08-19_23-55-26_REPORT.pdf
```

the downloader targets:

```text
%APPDATA%\EMLAB\Programs\STLA\MT\CITROEN_AIRCROSS_MT
```

For:

```text
RNTBCI_DUSTER_DCT_0095_5104_2026-08-19_19-33-41_REPORT.pdf
```

the downloader targets:

```text
%APPDATA%\EMLAB\Programs\RNTBCI\AT\RNTBCI_DUSTER_DCT
```

Use `project_rules` when a new vehicle name should map to a project. Use
`route_layout` if you want flatter storage such as `project/vehicle`.

If a future client/program folder already exists in EMLAB, the downloader also
uses that folder name as a project hint. For example, a `Honda` program folder
plus `HONDA_CITY_MT_..._REPORT.pdf` routes to `Honda` without editing
`project_rules`.

Check routing without touching Outlook:

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File download_emlab_attachments.ps1 -Config "%APPDATA%\EMLAB\outlook-downloader\config.json" -RouteFilename CITROEN_AIRCROSS_MT_9740_5099_2026-08-19_23-55-26_REPORT.pdf
```
