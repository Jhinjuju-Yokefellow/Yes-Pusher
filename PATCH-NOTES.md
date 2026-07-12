# CoinPusher 43 — Reliable hosted reconnect and polling fallback

## What changed

- The Vercel client still prefers the Railway live event stream.
- If that stream closes, the client immediately falls back to `/api/world` polling instead of disabling the machine.
- Queue and turn controls stay usable while fallback polling is healthy.
- The client continuously retries the live stream and automatically returns to it when available.
- Returning to the tab, restoring a page, or coming back online forces an immediate authoritative snapshot refresh.
- The status bar shows `FALLBACK SYNC` while polling and exposes the exact failed Railway request in its tooltip.
- Railway treats a recent polling client as connected, so a temporary stream failure does not remove that player from the queue.
- `/api/health` now separates `streamConnections` and `pollingClients` while `connections` reports the total active clients.

## Verification

A healthy stream reports `streamConnections: 1` or higher. Fallback mode can report `streamConnections: 0` and `pollingClients: 1`. Both use the same authoritative Railway world.
