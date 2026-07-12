# CoinPusher 38 — Vercel Hosted Test Deployment

- Prepared the Vite browser game for Vercel.
- Added a Railway configuration for the always-on authoritative world server.
- Added `VITE_WORLD_SERVER_URL` so the browser can use a hosted world server instead of localhost.
- Replaced native EventSource with an authenticated fetch stream so hosted wallet sessions do not rely on third-party cookies.
- Added bearer-session support while preserving same-origin cookies for local development.
- Added an explicit server origin allowlist for the Vercel deployment.
- Bound wallet challenges to the actual browser origin when the frontend and server use different domains.
- Added Railway volume instructions for persistent world, player, and settlement files.
- Kept the machine geometry, physics, loaded starting field, turn rules, and skin milestone rules unchanged.
