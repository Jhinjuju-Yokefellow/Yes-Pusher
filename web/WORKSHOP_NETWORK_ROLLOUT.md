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

The new Network tables start empty. **The inspected current Coin Drop deployment has no workshop JSON file** at its configured `/tmp/yd4-recovery-workshop-state.json` path; the operator confirmed that no skin was equipped and no Large Toy was contributed on this deployment. There are therefore no workshop records from this current deployment to export. This does **not** verify records from earlier deployments, nor does it change the two existing V3 NFT ownership records. If another deployed instance or backup contains workshop records, preserve and reconcile them before replacing it. The planned historical NFT ownership updater is not involved.

A dry-run-first importer is included in Network PR #95 (`scripts/import-legacy-coin-drop-workshop.mjs`). On `--apply` it backs up the Network SQLite database *before* writing and preserves each original JSON record in `app_workshop_legacy_import`. It imports equipped-skin preferences, but legacy contribution flags never grant points without a matching Network-confirmed action receipt. Only run the importer if a separate legacy source is actually found; do not generate a placeholder file or backfill ownership.

## Safe activation order

1. Keep production Neon disconnected during development. Use a separate Network SQLite file and mocked V3 responses for tests.
2. Confirm the Network persistent volume location, backup and successful restoration. Review the unrelated production staged deletion independently.
3. Enable the Network flag in **staging only** and verify the active Coin Drop App credential resolves from the local App projection. No Base RPC should occur on workshop reads.
4. The inspected current deployment has no JSON to import. If a *different* deployment or backup contains workshop records, reconcile and import those once; otherwise skip legacy import.
5. Configure Coin Drop staging with `YF_NETWORK_API_URL`; verify one state request per wallet, coalesced community reads, authenticated writes, duplicate reference handling, and action-path settlement recovery.
6. Stress-test 100 users across several Coin Drop web instances. Network remains the **single SQLite writer**; horizontally scaling Network itself requires an external shared store and coordinated leadership.
7. Only after passing these checks, enable production Network endpoints, deploy the Coin Drop web change, and monitor request rates, memory, action errors, and storage snapshots.

## Rollback

Keep both old and new stores intact until verification. If Coin Drop must roll back after writing to Network, do not silently send new writes to the old file: it will be stale. Restore from the authoritative Network records or temporarily disable workshop mutations until the rollout is corrected.

## Important limitations

- The new Network endpoint requires an internally confirmed ledger action with matching App/Bucket/request/wallet/toy/transaction hash before adding any contribution points. **V3's Action Path execute route stores executions in V3's `actionPathExecutions` table, while this draft verifier currently searches Network's independent `network_actions` ledger. No receipt replication is established.** V3 already offers an App-scoped, wallet-scoped read-only `/api/sdk/v1/buckets/{bucketId}/action-paths/{pathKey}/executions/{requestId}?wallet=...` recovery endpoint. Build and test a server-to-server proof adapter that verifies the exact V3 execution status, consuming transaction hash, wallet, Bucket, App and choice before awarding points. Until then contributions are expected to fail with `409 workshop_action_unverified`. Do not use community progress for valuable rewards or promote this cutover until that V3-to-Network proof bridge is tested.
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

## November 2 release gates: still pending

1. **Current workshop-file check complete:** Railway SSH returned `YES_PUSHER_COMMUNITY_BUILD_STATE_PATH=/tmp/yd4-recovery-workshop-state.json`. Listing `/tmp` showed no workshop JSON, and `/app/.local` did not exist. The operator confirmed no equip or community contribution occurred on this deployment. No current-deployment JSON export is needed. Future writes **still require** Network durable state and a tested backup; do not treat missing data as evidence that past deployments were preserved.
2. **Confirm actual SQLite location:** Network has a Railway volume mounted at `/data` and a `YF_NETWORK_DB_PATH` variable whose value is redacted by the OAuth connector. The draft API now refuses startup with `YF_WORKSHOP_API_ENABLED=1` on Railway if the resolved SQLite path is not *inside the mounted volume*. Check the `workshop_storage_gate` startup log. Never infer durability from the volume attachment alone.
3. **Import dry-run:** `node scripts/import-legacy-coin-drop-workshop.mjs --source /absolute/path/legacy.json`. For the explicit apply, also supply `--db-path /absolute/path/network.sqlite --backup-dir /absolute/path/backup --app-id 0x... --bucket-id 0x... --apply`. Requires existing database, volume and backup directory. Re-run the preview and compare record counts before applying. This is workshop preservation, **not** NFT ownership backfill.
4. **Redis opt-in:** the Network draft now accepts `YF_NETWORK_SHARED_REDIS=1`, `YF_NETWORK_REDIS_REST_URL`, and `YF_NETWORK_REDIS_REST_TOKEN`. One atomic Upstash REST `EVAL` enforces global, remote-IP, per-App-credential and credential-scoped wallet request budgets across replicas **before a local App credential lookup**. Redis failure returns `503`, never an unbounded fallback. The Redis store has not yet been provisioned or tested live. Per-credential limits can differ from a true per-App limit when an App holds multiple keys.
5. **Load tests:** Network `scripts/verify-shared-redis-admission.mjs` exercises 100 real localhost HTTP requests distributed over two servers with a *simulated* common Redis response. Coin Drop includes `web/scripts/loadtest-network-staging.mjs` for real staging HTTPS requests and `scripts/loadtest_spectators.gd` for 100 real Godot `WebSocketMultiplayerPeer` spectators. No real staging stress run has occurred; production URLs are rejected by both harnesses.
6. **Backups/recovery:** exercise a restore of the pre-import Network backup into an isolated staging SQLite file, then verify all original preferences and audit records and that unverified contributions earn zero. A successful backup API call alone is **not** a restoration test. Inspect Network/Redis/Alchemy/Neon usage after bounded tests before production.
7. **Deployment:** merge and deploy Network before Coin Drop, with the flags off initially. Bring up separate staging services and credentials, validate receipt proof and Redis there, then enable workshop in staging and exercise recovery, and *only then* consider a guarded production rollout. The Network production environment contains an unrelated staged resource deletion; **never use Railway accept-deploy on that patch during this migration.**
