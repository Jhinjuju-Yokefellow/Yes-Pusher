# Wallet Identity and Turn Settlement

## Wallet identity

The browser requests the connected EVM account and asks the world server for a short-lived challenge. The player signs a plain-text message containing:

- wallet address
- game origin
- nonce
- issue and expiration times
- current chain ID when available

The server verifies the signature and creates a 24-hour HTTP-only session cookie. The wallet address becomes the authoritative player ID:

```text
wallet:0x...
```

The signed message explicitly states that it does not spend YES or submit a transaction.

Unsigned visitors may still watch the shared machine. With `YES_PUSHER_REQUIRE_WALLET=true`, only a verified wallet session can join the queue, leave the queue, or start a turn. A query-string player ID beginning with `wallet:` is downgraded to a guest identity and cannot impersonate a signed wallet.

Challenges are single-use and expire after five minutes. Sessions currently live in server memory, so restarting the server requires the wallet to sign in again. Machine state, player progress, and settlement records remain persisted.

## Settlement lifecycle

Every finalized turn produces one durable record keyed by the turn ID:

```text
turn id
wallet
bucket id
coins dropped
coins won
lifetime coins won
skin milestone result
resolved milestone number
YES amount owed in raw units
credit status
turn-event status
random-skin-drop status
selected output / request / mint references
attempt count
last error
external responses
```

The server saves this record before it attempts external submission.

### Credit statuses

- `wallet_required` — the turn was not owned by a verified wallet
- `no_payout` — no physical coins scored
- `recorded` — the YES amount is owed but no credit route is configured
- `pending` — configured submission is waiting or in progress
- `confirmed` — the configured Yokefellow credit route accepted the idempotent grant
- `failed` — the last attempt failed and will retry after backoff

The result panel uses the same distinction. `recorded` never appears as confirmed.

## Existing Yokefellow event connection

When these values are configured:

```dotenv
YF_API_BASE_URL=https://example.com/api/sdk/v1
YF_APP_KEY=...
YF_BUCKET_ID=...
YES_PUSHER_APP_SLUG=yes-pusher
YES_PUSHER_SKIN_DROP_TRIGGER_KEY=coin_pusher.random_skin_drop
YES_PUSHER_SKIN_DROP_OFFERING_NAME=Random Coin Skin Drop
```

the server submits to:

```text
POST /buckets/{bucketId}/offering-events
```

### Completed-turn event

Every completed wallet-owned turn sends `turn_completed`. Metrics include coins dropped, won, lost, lifetime total, and skin milestone state. `meta.eventId` is the permanent YES Pusher turn reference.

### Random skin-drop event

When one 50-coin milestone resolves, the server sends a second event with this exact event type:

```text
coin_pusher.random_skin_drop
```

The request includes:

```json
{
  "wallet": "0x...",
  "appSlug": "yes-pusher",
  "eventType": "coin_pusher.random_skin_drop",
  "metrics": {
    "skinDropEarned": 1,
    "milestoneNumber": 1,
    "milestoneEvery": 50,
    "lifetimeCoinsWon": 50,
    "coinsWonThisTurn": 7,
    "pendingSkinMilestones": 0
  },
  "meta": {
    "eventId": "yes-pusher:skin-drop:TURN_ID:milestone:1",
    "triggerKey": "coin_pusher.random_skin_drop",
    "offeringName": "Random Coin Skin Drop",
    "turnId": "TURN_ID",
    "turnNumber": 12,
    "milestoneNumber": 1,
    "externalRef": "yes-pusher:skin-drop:TURN_ID:milestone:1"
  }
}
```

The game deliberately sends no `selectedOutputId`. Yokefellow owns random selection through the `Random Coin Skin Drop` offering and returns the selected output/class UUID, request ID, mint job ID, and mint ID when available. The server then reads the bucket catalog and maps the selected class/output back to the known `yes_drop.*` key, display name, and image.

The offering must be configured as:

```text
Name: Random Coin Skin Drop
Mode: earned
Selection: random
App/integration trigger key: coin_pusher.random_skin_drop
Claim policy: once_per_event
Outputs: the 15 active yes_drop.* skin outputs
```

Use `auto_mint` fulfillment when a matched event should immediately create/queue the NFT mint. The outbox treats a successful API response with no matched offering as a configuration failure and retries it instead of falsely claiming that a skin was issued.

## YES bucket-credit connection

The supplied Yokefellow repo has internal bucket-credit functions but no app-authenticated direct grant route in its SDK surface. YES Pusher therefore does not claim a credit transfer unless an operator explicitly configures:

```dotenv
YF_CREDIT_GRANT_URL=https://example.com/api/sdk/v1/bucket-credit/grant
```

The route must accept an app key and this JSON body:

```json
{
  "bucketId": "bucket UUID",
  "wallet": "0x...",
  "amountYesRaw": "3000000000000000000",
  "source": "yes-pusher",
  "externalRef": "yes-pusher:turn:TURN_ID",
  "memo": "YES Pusher turn 12: 3 coins won",
  "meta": {
    "turnId": "TURN_ID",
    "turnNumber": 12,
    "coinsDropped": 5,
    "coinsWon": 3,
    "lifetimeCoinsWon": 63
  }
}
```

It receives these headers:

```text
x-yf-app-key: APP_KEY
x-idempotency-key: yes-pusher:turn:TURN_ID
```

Required route behavior:

1. Authenticate the app key.
2. Validate bucket, wallet, amount, and source.
3. Enforce the bucket’s configured earned/granted credit posture.
4. Reject operator access to credit belonging to the participant.
5. Use `externalRef` as a unique idempotency key.
6. Return the existing result for a duplicate request instead of issuing credit twice.
7. Return `{ "ok": true, ... }` only after the credit record is committed.

Until that route exists, `settlements.json` is the durable owed-credit ledger. When the route is configured later, previously recorded owed settlements automatically become pending without recalculating or duplicating their original amounts.

## Retry behavior

Turn events, skin-drop events, and credit requests use separate idempotency keys. Failed requests use exponential backoff capped at five minutes. A restart preserves the next retry time. Successful event submission and successful YES-credit submission are tracked independently.
