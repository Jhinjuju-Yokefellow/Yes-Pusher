# YES DROP clean-room machine gate

This branch is mergeable only when all production machine integration paths satisfy these checks:

- YES economy writes use Yokefellow Action Paths (`yes_drop.turn_spend`, `yes_drop.payout`, `yes_drop.skin_drop`, `yes_drop.toy_drop`).
- NFT ownership/state reads use the Network-backed Yokefellow SDK holdings projection.
- Player identity presentation uses Yokefellow Profile Card data for the active dropper wallet.
- No production code calls legacy Bucket catalog or wallet entitlements for ownership truth.
- No direct private-key NFT mint path is exposed by the YES DROP web service.
- Production presentation never fabricates a Player identity while canonical presentation is loading.
- Explicit presentation-test mode may retain deterministic fixtures for isolated YD-2 acceptance testing only.
- Bucket lifecycle errors such as `bucket_not_open_for_participation` are surfaced; they are not bypassed.
