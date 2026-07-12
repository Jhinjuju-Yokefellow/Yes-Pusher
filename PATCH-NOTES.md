# CoinPusher 41 — Railway duplicate-install fix

## Problem

Railpack already installs dependencies before the custom build command. The prior Railway build command ran `npm ci` again:

```text
npm ci && npm run build
```

Railpack caches Vite's `node_modules/.vite` directory. The second `npm ci` attempted to remove the already-mounted cache directory and failed with:

```text
EBUSY: resource busy or locked, rmdir '/app/node_modules/.vite'
```

## Fix

The Railway build command now runs only:

```text
npm run build
```

Railpack remains responsible for installing dependencies.

## Railway variable check

Remove `NPM_CONFIG_PRODUCTION` if it exists, or set it to `false`, so Vite remains available during the build.
