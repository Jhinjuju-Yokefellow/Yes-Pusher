# 00 — Base-First Launch Guardrails

**P01 baseline:** `main@ba298afc39d5db6fd5e82ae67e3803c0dbce4fa0`

Yokefellow will finish and launch on **Base**. Preserve the working Coin Pusher game, authoritative machine, physics, multiplayer, persistent App state, queue/turn logic, payout calculation, free-turn logic and other App-owned behavior.

The later Coin Pusher cutover should replace old YokefellowV2/direct shared-chain plumbing with YokefellowNetwork while Base remains the launch execution layer. Network abstraction is for simplification, not concealment: Base may be named where useful, but the App should not require raw RPC/ABI/indexer/reconciliation knowledge for normal use.

A dedicated Yokefellow chain is deferred and is not a launch prerequisite.

Do not perform the P11/P12 cutover in this guardrail pull.

## Pull evidence

Return starting branch/commit, changed files, exact validation commands/results, manual checks, unresolved gaps, acceptance-gate status, and explicitly deferred work.
