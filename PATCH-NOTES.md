# CoinPusher 40 — Force Public npm Registry

- Adds a project `.npmrc` pointing npm to `https://registry.npmjs.org/`.
- Sets `replace-registry-host=always` so stale lockfile hosts are replaced during install.
- Makes Vercel run `npm ci --registry=https://registry.npmjs.org/ --replace-registry-host=always`.
- Includes the corrected `package-lock.json` with public npm tarball URLs.
