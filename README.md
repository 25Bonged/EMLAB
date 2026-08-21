# EMLAB
emission analysis compilations

## Running

The backend is a plain Node.js server (Hono) that also serves the built dashboard from the same origin — there is no Python component.

```sh
npm --prefix dashboard ci
npm --prefix dashboard run build
./scripts/start_emlab.sh
```

`./scripts/setup_emlab.sh` runs the first two steps for you.

## Optional Outlook attachment downloader

For Windows machines using Classic Outlook, `scripts/outlook-downloader/` contains
an optional companion that can save emailed `*_REPORT.pdf` and `*_TRACES.xlsm`
attachments into existing EMLAB program folders. It stores no mailbox password
and does not open or execute attachments. See
`scripts/outlook-downloader/README.md` before scheduling it.
