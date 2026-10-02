# YES drop Railway deployment — YD-8

YES drop uses two Railway services from the same repository:

- **yes-pusher-web** — browser shell, YokefellowNetwork participant login proxy,
  Network holdings/workshop/funding bridge, and static Godot web build.
- **yes-pusher-machine** — continuously running authoritative Godot machine,
  paid-turn capture, payout settlement, Skin/Toy issuance, App events, and
  multiplayer state.

Neither service holds an NFT mint private key or a Toy burn private key.
All shared Yokefellow mutations execute through YokefellowNetwork.

## Prerequisites

Before production cutover:

1. The **YES drop** Bucket is activated and registered with YokefellowNetwork.
2. The existing `coin-pusher` App connection is active for that stable Network Bucket.
3. The Rainbow's End YES Skin V3 collection is deployed/recognized and all five
   Skin Classes are configured/active.
4. The Rainbow's End Toys V3 collection is deployed/recognized and all fifteen
   Toy Classes are configured/active.
5. Coin Skin Drop, Catch a Toy, and all ten 3→1 craft Paths are live and their
   Network capabilities are configured.
6. The five Large-Toy community contribution burn capabilities are configured.
7. `yes_drop.turn.capture` and `yes_drop.turn.payout` are configured.
8. The Network V3 participant-credit rail is active with the YES drop funding
   policy set to capture-on-action + withdrawable participant credit.
9. The YES drop Bucket reserve is funded for faucet payouts.

## Railway variables

Create the two services and use:

- `railway.web.toml` for the web service
- `railway.machine.toml` for the machine service

Attach a persistent volume at `/data` to the machine service. Attach a
persistent volume to the web service as well if community-build projection
state is expected to survive service replacement.

Copy variables from:

- `deploy/web.railway.env.example`
- `deploy/machine.railway.env.example`

Both server-side services need the same:

```text
YF_NETWORK_BASE_URL
YF_NETWORK_BUCKET_ID
YF_NETWORK_APP_API_KEY
```

The App API key must never be exposed to browser JavaScript.

No YD-8 deployment uses:

```text
SESSION_SECRET
YF_API_BASE_URL
YF_BUCKET_ID
YF_APP_API_KEY
YF_NFT_MINT_PRIVATE_KEY
YF_INSTANT_MINT_SECRET
YF_CONTRIBUTION_BURN_PRIVATE_KEY
```

## Domain connection

Web:

```text
PUBLIC_ORIGIN=https://YOUR-WEB-DOMAIN
GAME_SERVER_URL=wss://YOUR-MACHINE-DOMAIN
```

The Godot browser client receives only:

- participant wallet;
- short-lived YokefellowNetwork participant session token;
- public WebSocket URL;
- selected Coin Skin family.

The Network App key remains server-side.

## Hosted acceptance

1. `GET /health` on the web service returns `networkReady: true`.
2. Connect a wallet and sign the YokefellowNetwork participant challenge.
3. Browser connects to the authoritative machine.
4. A second browser sees the same machine state.
5. Paid 10-coin turn invokes `yes_drop.turn.capture` with the participant session.
6. Turn payout invokes `yes_drop.turn.payout`.
7. A Skin milestone resolves the configured weighted Coin Skin Drop capability.
8. A caught physical Toy resolves the configured App-selected matching Small Toy.
9. Workshop ownership is read from Network holdings.
10. 3 Small → Medium and 3 Medium → Large execute through Network craft actions.
11. Large Toy contribution executes through the configured Network burn action.
12. Deposit/Withdraw uses Network-prepared wallet transactions.
13. Restart the machine service and verify authoritative world/turn state recovers
    from `/data/yes-pusher-shared-state.json`.
14. Verify the app repository contains no private NFT mint/burn authority or
    `/api/sdk/v1` runtime dependency.

## Local gameplay testing

If the three Network variables in `.env.server` are blank/placeholders,
`RUN-SHARED-SERVER.ps1` automatically enables local presentation/free-turn
mode. This keeps physics/gameplay work independent of production Bucket setup.
