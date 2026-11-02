# YES DROP workshop state: staged Network cutover

This change moves equipped skins and community contribution records out of the Coin Drop web server's temporary JSON file and into Network's SQLite store. Network owns the only durable writer; Coin Drop web instances access it using the server-side App API key. The browser never receives that key.

## Required configuration

Network:
- `YF_NETWORK_DB_PATH` must resolve to Network's **persistent** Railway volume, not the container filesystem. Verify the actual resolved path and test restore before enabling writes.
- `YF_WORKSHOP_API_ENABLED=1` enables `/v1/workshop/*`. Defaults to disabled.
- The App key and App-to-Bucket binding must be present and active in Network's `v1_apps` local projection. Workshop routes use that projection; they do **not** request blockchain status per visitor.

YES DROP web:
- `YF_NETWORK_API_URL` must point to the Network HTTPS service base URL (not V3's `/api/sdk/v1` path).
- `YF_NETWORK_APP_API_KEY` remains server-only. Do not embed it in Godot exports or browser JavaScript.
- `YF_API_BASE_URL` continues to serve the V3 ownership/action-path requests independently.
- `YES_PUSHER_COMMUNITY_BUILD_STATE_PATH` is no longer used by the new code.

## No automatic backfill

The new Network tables start empty. **Do not deploy Coin Drop over a live web instance until the existing JSON file has been inspected and preserved.** A deployment may replace the container before the file can be recovered. Export the current preferences and contribution references, reconcile their existing confirmed action-path executions, and import them once with idempotent reference IDs. The planned historical NFT ownership updater is not involved.

No migration or live database operation is performed by this PR.

## Safe activation order

1. Keep production Neon disconnected during development. Use a separate Network SQLite file and mocked V3 responses for tests.
2. Confirm the Network persistent volume location, backup and successful restoration. Review the unrelated production staged deletion independently.
3. Enable the Network flag in **staging only** and verify the active Coin Drop App credential resolves from the local App projection. No Base RPC should occur on workshop reads.
4. Run the JSON export/reconciliation/import if any existing workshop records need preservation. Compare original and imported counts and reference IDs.
5. Configure Coin Drop staging with `YF_NETWORK_API_URL`; verify one state request per wallet, coalesced community reads, authenticated writes, duplicate reference handling, and action-path settlement recovery.
6. Stress-test 100 users across several Coin Drop web instances. Network remains the **single SQLite writer**; horizontally scaling Network itself requires an external shared store and coordinated leadership.
7. Only after passing these checks, enable production Network endpoints, deploy the Coin Drop web change, and monitor request rates, memory, action errors, and storage snapshots.

## Rollback

Keep both old and new stores intact until verification. If Coin Drop must roll back after writing to Network, do not silently send new writes to the old file: it will be stale. Restore from the authoritative Network records or temporarily disable workshop mutations until the rollout is corrected.

## Important limitations

- Workshop records are App-attested. An authenticated App server reports that an action-path contribution was confirmed; Network fixes the points/rarity values and rejects duplicate reference IDs. A separate cross-check against the actual execution receipt should be completed before community progress triggers an economically meaningful reward.
- Network's SQLite volume remains a single-writer dependency. It must be backed up and cannot simply be duplicated into independent Railway replicas.
- Hourly blockchain ownership refresh and per-login ownership caching are separate work. This change neither starts blockchain reads nor modifies the existing V3 holdings projection.

## Signed-session read cache

- `/app/state` now passes the verified YES DROP session ID and expiry into the workshop service.
- First state request per session fetches that wallet's projected holdings, workshop preference/summary, and account credit. Concurrent first requests coalesce.
- Further state requests in that same authenticated session read the bounded in-memory snapshot; no hourly App-side refresh timer exists.
- A new independently signed Coin Drop session gets its own snapshot. A successful craft or contribution invalidates the affected session snapshot because those confirmed actions can change NFT inventory. Equipping a skin updates the existing session cache in place.
- A separate Network worker updates the authoritative ownership projection hourly. This cache does **not** read Base or write ownership records.
- Cache entries expire at signed-session expiry and the per-process map is limited to 1,024 entries; server restarts simply cause a new cold read.
- Account-credit changes initiated outside this service may remain stale until reauthentication or an explicit settlement-triggered invalidation; verify that part before production.
- Simulated test: 100 users, two `/app/state` requests each -> exactly 100 projected-holdings reads, 100 Network workshop reads and 100 credit reads. Real database and RPC counts must be checked in staging.
