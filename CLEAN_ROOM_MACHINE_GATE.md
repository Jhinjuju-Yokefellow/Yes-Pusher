# YES DROP clean-room machine gate

This branch is mergeable only when all production machine integration paths satisfy these checks:

- Machine SDK requests authenticate with a Network-issued `yfk_` Bearer credential; no `YF_APP_API_KEY` or `X-YF-App-Key`.
- Network validates App identity and active Bucket/App authority before published Path execution.
- YES economy writes use Yokefellow Action Paths (`yes_drop.turn_spend`, `yes_drop.payout`, `yes_drop.skin_drop`, `yes_drop.toy_drop`).
- NFT ownership/state reads use the Network-backed Yokefellow SDK holdings projection.
- Player identity presentation uses Yokefellow Profile Card data for the active dropper wallet.
- No production code calls legacy Bucket catalog or wallet entitlements for ownership truth.
- No direct private-key NFT mint path is exposed by the YES DROP web service.
- Production presentation never fabricates a Player identity while canonical presentation is loading.
- Explicit presentation-test mode may retain deterministic fixtures for isolated YD-2 acceptance testing only.
- Bucket lifecycle errors such as `bucket_not_open_for_participation` are surfaced; they are not bypassed.

## Network App credential rollout

1. Deploy the website SDK Network verifier; keep old authorization enabled only for still-running clients during the migration.
2. In the Bucket's Network App connection panel, reveal or issue its existing `yfk_` credential through the signed Network control plane. Do not paste the key in a GitHub issue or log.
3. Set `YF_NETWORK_APP_API_KEY` on the Railway machine service and deploy the Network-auth branch. `YF_API_BASE_URL` remains the website SDK origin until full Action Path orchestration has moved into Network.
4. Verify `/v1/me` authorization via the SDK, paid-turn capture proof, payout, toy/skin NFT mints, and Network-backed holdings with two wallets.
5. Only after the live machine no longer uses `YF_APP_API_KEY`, remove that Railway variable, the old website credential verifier/rotation and legacy hash storage. Verify other SDK callers before deleting shared infrastructure.

Network-issued App credentials do **not** by themselves move Action Path flow evaluation from the website to Network; that remains an explicit separate runtime cutover.
