# YES Pusher rebuild

This directory is the clean replacement path. It is intentionally isolated from the current hosted bootstraps and prototype patches.

## Non-negotiable boundaries

- The machine core never imports wallet, NFT, HTTP, Railway, Vercel, settlement, replay, or Yokefellow modules.
- The physical pusher continues moving even when no player owns a scoring session.
- DROP becomes a local command accepted by the core immediately.
- Physics objects carry compact visual keys, never image URLs or NFT JSON.
- Browser rendering resolves visual keys into textures and models.
- Inventory, reward settlement, and minting run outside the gameplay loop.
- The current live application is not switched to this path until the acceptance gates pass.

## Milestones

1. **Stable machine core**
   - Continuous pusher and physics.
   - Sequential play sessions.
   - Compact object identity and transforms.
   - Boundary persistence.
   - 100-play stress harness.

2. **Authoritative server**
   - One command queue.
   - Immediate DROP acknowledgement.
   - Compact spawn/remove/payout events.
   - Moving-object transform deltas.
   - No external API calls in gameplay requests.

3. **Browser renderer**
   - Interpolation only; no authoritative physics.
   - Visual registry for coin skins and toy models.
   - Both physical cabinets show the active player's owned toy NFTs.

4. **External workers**
   - Cached inventory lookup.
   - Durable YES/NFT reward jobs.
   - Retryable settlement that cannot pause the machine.

5. **Hosted acceptance**
   - One Railway deployment serves browser and server from the same commit.
   - Two-browser synchronization.
   - Refresh and restart recovery.
   - Delayed inventory and failed mint fault tests.
   - Ten consecutive players and 100 consecutive plays without a freeze.

## Commands

```bash
npm run test:rebuild
npm run stress:rebuild
```

The stress command defaults to 100 one-coin plays. A different count may be supplied as the first argument.
