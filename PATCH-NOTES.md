# CoinPusher 44 — Hosted connection recovery hardening

- Starts authoritative polling and live-stream retry even when the first Railway snapshot fails.
- Keeps polling until the live stream has delivered an actual world snapshot; stream headers alone no longer blank the machine.
- Uses bearer-token authentication without requiring cross-site cookies, avoiding browser privacy blocks between Vercel and Railway.
- Preserves the exact failed Railway URL and error while reconnecting.
- Visibility and reconnect attempts now reuse the same recovery loops instead of repeatedly restarting the client.
- Machine physics, layout, scoring, queue rules, persistence, and Yokefellow settlement behavior are unchanged.
