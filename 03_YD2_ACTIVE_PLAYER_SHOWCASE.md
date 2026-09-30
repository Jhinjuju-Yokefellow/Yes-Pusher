# YD-2 — Persistent Active-Player Profile + Toy Showcase

**Branch:** `agent/yes-drop-yd2-active-player-showcase`  
**Base:** `agent/yes-drop-yd1-launch-baseline`  
**Scope:** active-player social presentation only. No free-drop timing, craft/burn, physics, art replacement, or Network cutover in this pull.

## What changed

YD-2 adds a player-specific presentation layer over the existing persistent shared machine.

When a turn starts, the authoritative server now resolves two pieces of public/current player context:

1. the player's Yokefellow `profile_card.v1`;
2. the player's current Rainbow's End Toy NFT holdings from the existing wallet-entitlements read.

That presentation is broadcast once to connected clients and rendered as a bottom overlay without resetting or recreating the machine.

## Canonical Profile Card behavior

The showcase consumes the existing public Yokefellow Profile Card data model rather than creating YES DROP profile state.

The compact presentation uses the same fields that matter to the canonical small Profile Card:

- Profile NFT/avatar;
- display name;
- handle;
- tagline;
- up to three featured Profile Card NFTs when enabled by the profile settings.

If no Profile Card can be resolved, YES DROP falls back to a shortened wallet identity while leaving the machine playable.

## Toy showcase behavior

Toy ownership is read from the current Bucket-scoped wallet entitlements.

Only recognized Rainbow's End Toy classes are included:

- Horseshoe;
- Four-Leaf Clover;
- Leprechaun;
- Pot of Gold;
- Treasure Chest.

Toy holdings are grouped by family and tier.

Supported launch tiers:

- Small;
- Medium;
- Large.

Blank/base Toy classes are treated as Small for compatibility with the current Catch a Toy output.

For each owned family, the live banner shows:

- family;
- highest owned tier;
- Small/Medium/Large quantities;
- the highest-tier NFT image when available.

This means the showcase reflects real wallet ownership rather than an App-local collection ledger.

## Active-player transition behavior

The presentation is tied to the **current dropper**, not the viewer.

- Player A starts -> everyone sees Player A's Profile Card + Toy collection.
- The queue advances to Player B -> the presentation changes to Player B.
- The underlying shared machine does not reload.
- Queue updates during the same turn do not wipe the already-loaded showcase.
- A spectator joining during an active turn is sent the current presentation.

A brief fade-in is used when the active player actually changes.

## Server/network behavior

New shared-world presentation flow:

- turn begins;
- a lightweight wallet placeholder is shown immediately;
- gameplay begins without waiting for profile/Toy HTTP reads;
- server resolves public profile + current Toy ownership asynchronously;
- server verifies the turn is still current;
- presentation is sent reliably to connected clients;
- presentation is cleared when the turn ends.

Presentation data is not inserted into the frequent physics snapshot payload, so Toy images/Profile Card data are not rebroadcast at the machine snapshot rate.

## Public naming touched in this pull

Visible shell naming changed from YES Pusher to **YES DROP** in:

- Godot project/window name;
- in-game title;
- browser page title/header;
- wallet login message text.

Internal compatibility identifiers such as `coin-pusher`, `yes_pusher.*`, and the existing state path are intentionally unchanged.

## Files changed

- `scripts/yokefellow_server_client.gd`
- `scripts/shared_world.gd`
- `scripts/main.gd`
- `Main.tscn`
- `project.godot`
- `web/public/index.html`
- `web/server.mjs`
- `03_YD2_ACTIVE_PLAYER_SHOWCASE.md`

## Validation performed in this pull

Source-level checks confirmed:

- Profile Card read resolves by active wallet;
- only `profile_card.v1` is accepted;
- Toy ownership is sourced from current wallet entitlements;
- Toy parsing excludes non-Toy classes;
- Small/Medium/Large quantities are preserved;
- active presentation uses a dedicated reliable RPC rather than physics snapshots;
- new peers can receive the current active presentation;
- repeated queue broadcasts for the same turn do not reset the showcase;
- active presentation is cleared at turn completion;
- gameplay turn start does not wait on profile/Toy presentation reads;
- current machine/queue/payout code was not redesigned.

## Build validation

Validated locally on Windows with Godot **4.7.2 stable** after a fresh-clone tool/config rebuild:

- Node dependency install: passed;
- `node --check web/server.mjs`: passed;
- Godot global classes registered successfully;
- YD-2 GDScript parsed/compiled successfully;
- Web export packing completed without the earlier parser failures.

The current YES DROP Bucket/App connection has not yet been created in the current Yokefellow version, so live profile/Toy ownership acceptance remains intentionally pending.

## Manual runtime acceptance required

After the current YES DROP Bucket/App connection exists, validate the rebuilt Godot web export before merge/deployment:

1. Start the authoritative machine with the current Yokefellow test configuration.
2. Connect two browser clients.
3. Put Player A into a turn.
4. Verify both browsers show Player A's Yokefellow Profile Card data.
5. Verify both browsers show Player A's currently owned Rainbow's End Toy NFTs and correct S/M/L counts.
6. Join/leave the queue from another client during Player A's turn and confirm the showcase does not reset.
7. Connect a new spectator during Player A's turn and confirm the current presentation appears.
8. Advance to Player B and confirm the overlay changes to Player B without machine/world reset.
9. Test a wallet with no Yokefellow Profile Card and confirm wallet fallback.
10. Test a wallet with no Toys and confirm the empty collection state.
11. Test unavailable/broken NFT image URLs and confirm the game remains playable.
12. Re-export `web/public/game` from this source and repeat the browser checks against the exported build.

## Gate

**YD-2 source implementation + compile/export validation: COMPLETE.**

**YD-2 live integration acceptance: BLOCKED ONLY on creating/configuring the current YES DROP Bucket + App connection.**

The next product pull remains YD-3: the exact one-hour free-drop lifecycle and visible countdown.
