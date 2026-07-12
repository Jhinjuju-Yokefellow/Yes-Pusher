# CoinPusher 42 — Persistent authoritative world

- Railway now advances the pusher and physics continuously, even with zero browser connections.
- Hiding or changing tabs no longer determines whether the machine runs.
- A hosted build with `VITE_WORLD_SERVER_URL` never silently drops into local mode after a cold start or temporary network failure.
- A Vercel build missing `VITE_WORLD_SERVER_URL` now shows the exact configuration error instead of pretending to be a working local machine.
- The frontend keeps retrying the configured Railway server and reconnects when the tab becomes visible.
- Initial Railway connection timeout increased to eight seconds to tolerate service startup.
- `/api/health` now reports whether a world was loaded from disk, the data directory, the last confirmed save time, and continuous-physics status.
- Confirmed world, player progress, and settlement state continue saving atomically after turns and every ten seconds while ready.
- Machine geometry, payout layout, timer, queue rules, and Yokefellow event behavior are unchanged.
