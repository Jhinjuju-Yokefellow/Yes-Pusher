# Coin Drop isolated WebSocket capacity test

This test is **separate** from Network/V3 ownership-login HTTP stress. It must not
connect to production Neon, Alchemy, the production Railway machine, or a user's wallet.

## What is already automated

`cd web && npm run check` verifies the client-only transport harness against
an isolated local WebSocket mock: 100 simultaneous spectator connections, a
second 100-connection reconnect wave, and rejection of production URLs. The
Godot source now caps **WebSocket** peers at the same 128 ceiling used for
ENet. These checks do **not** prove the Godot physics engine can stream 100
active spectator sessions or process 100 wallet actions.

## Real machine acceptance (not yet executed)

1. Start a **disposable local/staging** Godot authoritative server with
   production wallet/funding/Neon/chain credentials absent. Verify the game
   serves the public shared-machine spectator state without external data.
2. From a separate host, test 100 spectator transports held for 30 seconds,
   followed by 100 intentional reconnects:
   `cd web && node scripts/stress-godot-websocket.mjs --url ws://127.0.0.1:8787 --clients 100 --rounds 2 --hold-ms 30000`
   (For a separately provisioned staging hostname containing `staging`,
   `preview`, or `test`, add `--allow-staging`. Production hostnames are
   rejected by the harness.)
3. Capture connection success/failure, p95 handshake time, unexpected closes,
   packets received, Godot CPU/memory, egress, and reconnect count. Confirm
   zero ownership database reads and zero chain RPCs from these anonymous
   spectator connections.
4. In a **second** workload, use isolated signed fixture sessions to test
   authorized turns and queue fairness. Do not simulate on-chain spending.
   Validate per-player message ceilings, snapshot backpressure, max clients,
   and no automatic page reload or repeated signatures.
5. Repeat with 128 and 129 connections to validate the hard cap under load.
   The 129th should disconnect without disrupting existing sessions.

## Proposed go/no-go

- All 100 spectator sockets connected and remained stable during the hold.
- Reconnect waves did not cause an auto-reload or authenticate again.
- No unbounded growth in Godot memory or outstanding connections.
- Network/Neon/Alchemy calls from the spectator workload remain **zero**.
- Maximum peer ceiling rejects overflow safely without affecting the first 128.

Do not merge this as evidence of live 100-player capacity until the actual
Godot staging machine test and monitoring have been completed.
