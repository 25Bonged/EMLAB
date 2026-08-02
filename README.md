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
