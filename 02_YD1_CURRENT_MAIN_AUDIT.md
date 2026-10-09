# YD-1 — Current Main Audit and Launch Baseline Map

**Audit target:** `Jhinjuju-Yokefellow/Yes-Pusher`  
**Starting ref:** `main@d1dfd7874dc17e59f0818df5a36da6659db2d375`  
**Authoritative target:** `01_YES_DROP_LAUNCH_SPEC.md`  
**Scope:** source/configuration audit only; no gameplay redesign or production cutover in YD-1.

## Gate summary

YD-1 establishes a single product target and maps current `main` against it.

Status:

- authoritative launch spec: **captured**;
- current game architecture: **preserve**;
- product mismatches: **identified**;
- legacy plumbing: **identified for later Network cutover**;
- player-reported gameplay/visual defects: **recorded**;
- five current toy powers: **recorded below**;
- deployment assumptions: **recorded below**.

No runtime behavior was intentionally changed in this pull.

---

## 1. Preserve / already aligned

These parts of current `main` already match the launch direction and should not be casually rewritten.

### Authoritative shared machine

Current code already supports:

- one authoritative Godot machine;
- browser clients as replicas;
- WebSocket shared state;
- queue state;
- active-turn state;
- world snapshots;
- replicated coins and toys;
- persistent server state;
- recovery of an interrupted active turn;
- settlement outbox/retry behavior.

Primary implementation:

- `scripts/machine.gd`
- `scripts/shared_world.gd`

**YD status:** KEEP.

### Fixed 10-coin turns

Current `scripts/machine.gd` hard-codes:

`FIXED_TURN_COIN_COUNT = 10`

and current shared-world logic uses:

`FIXED_DROP_COUNT = 10`.

The machine ignores a caller-supplied alternate count and uses ten coins.

**YD status:** KEEP.

### Paid-turn target price

Current Railway machine configuration sets:

`YES_PUSHER_TURN_PRICE_YES_RAW=10000000000000000000`

which is 10 YES with 18 decimals.

**YD status:** KEEP.

### One YES per qualifying payout coin

Current deployment configuration sets:

`YES_PUSHER_YES_PER_PAYOUT_RAW=1000000000000000000`

and machine payout is based on qualifying coins plus power effects.

**YD status:** KEEP as the current launch baseline.

### 100-payout Coin Skin milestone

Current shared-world logic already tracks `lifetime_coins_paid_out`, not merely coins dropped, and uses:

`SKIN_DROP_EVERY_COINS = 100`.

Crossing each 100-coin boundary submits a Coin Skin Drop event.

**YD status:** KEEP.

### Five Rainbow's End families

Current code consistently recognizes:

- `horseshoe`
- `four_leaf_clover`
- `leprechaun`
- `pot_of_gold`
- `treasure_chest`

These exist in machine, coin-skin, toy, entitlement, and catalog-resolution code.

**YD status:** KEEP.

### Equipped skin selects matching toy family

Current flow stores a player's selected owned skin family and passes the same family to `machine.queue_turn_toy(...)` before a turn starts.

The Godot UI also tells the user that the matching toy enters each turn.

**YD status:** KEEP, with ownership freshness and capacity fixes described below.

### Toy capture already maps to Small/base Toy outputs

Current catalog resolution deliberately selects Toy offering outputs whose tier is blank/base/small and ignores Medium/Large/Giant outputs for physical catches.

A captured toy then submits a family-specific `toy_caught` event with the selected Small/base output.

**YD status:** KEEP. This already matches "catch -> Small Toy NFT."

### Result and NFT award presentation foundations

Current `scripts/main.gd` already includes:

- turn-result panel;
- Toy power panel;
- NFT-earned panel;
- in-game 3D NFT preview fallback;
- remote result presentation.

These are useful foundations for the later presentation pass.

**YD status:** KEEP/REFINE, not replace by default.

### Ownership fallback exists after entitlement refresh

When owned skin entitlements are refreshed, current shared-world code clears the equipped family if the wallet no longer owns that family.

**YD status:** KEEP principle, strengthen freshness at turn boundaries.

---

## 2. Needs modification to match the launch spec

### Public naming

Current project/UI/config still contains significant **YES Pusher / Coin Pusher** naming:

- Godot project name: `Yes Pusher`;
- web title/header: `YES Pusher`;
- default App slug: `coin-pusher`;
- legacy trigger keys use `yes_pusher.*`;
- state path uses `yes-pusher-shared-state.json`.

The launch public name is **YES DROP**.

**Action:** public-facing naming should migrate deliberately. Internal identifiers that would create needless testnet breakage may remain temporarily until the production/Network cutover.

### Active-player identity

Current spectators receive the active wallet and turn ID. The UI displays only a shortened wallet such as `0x1234…abcd`.

There is no canonical Yokefellow Profile Card read or display.

**Action:** YD-2 consumes the existing Yokefellow `profile_card.v1` rail and presents the active dropper's canonical profile.

### Active-player Toy showcase

Current `main` has no live showcase of the active dropper's actual Toy NFT holdings.

The machine currently knows family gameplay toys, but it does not load a wallet's Small/Medium/Large Toy collection for social display.

**Action:** YD-2 adds active-player Toy ownership reads and the showcase while keeping the machine loaded.

### Toy burn/craft progression

Current catalog parsing understands tier text such as Small/Medium/Large, but gameplay settlement only maps physical catches to Small/base outputs.

No current App flow performs:

- burn 3 Small -> craft Medium;
- burn 3 Medium -> craft Large.

There is no player craft UI or Network craft action in this repo.

**Action:** YD-4.

### Hourly free turn timing

Current code already has one timestamp-based hourly free turn and therefore does not stack hourly grants. However, it currently advances `next_free_turn_at_unix` inside `_reserve_turn_access(...)` when the queued turn is reserved.

That occurs before `_start_active_turn()`.

The launch rule is that the one-hour refill starts after the free turn has been successfully accepted/started by the authoritative system; a pre-start failure must not burn the free turn.

**Action:** move final free-turn consumption/cooldown commit to the successful turn-start boundary and make recovery idempotent.

### Free-drop countdown UI

Current UI exposes the cooldown only through status text such as "Next free drop in about N minutes."

There is no persistent exact live countdown and no clear dedicated `FREE DROP READY` state.

**Action:** YD-3.

### Paid/free control presentation

Current UI has one Drop button. Server logic automatically chooses free, then earned, then paid access.

The launch App shell calls for clear free-drop status and paid play availability.

**Action:** YD-3 should make the player's cost/access state explicit without changing gameplay parity.

### Matching toy can currently be skipped

Current machine has `max_active_toys = 8`.

If that capacity is reached, `_spawn_turn_toy(...)` emits `toy_spawn_skipped` and does not insert the equipped skin's matching toy.

The launch rule says the equipped skin causes its matching toy to enter the player's turn.

**Action:** later gameplay pass must ensure capacity handling does not silently violate the equipped-skin promise.

### Skin ownership can become stale during a session

Ownership is refreshed after identity verification and when the player manually requests a refresh. Queue join uses cached `owned_skin_families`.

A skin sold after the last refresh can therefore remain selectable until the next entitlement refresh.

**Action:** later integration work should perform an authoritative ownership check at an appropriate turn/equip boundary. If the skin is gone, fall back to the default YES coin.

### Auction eligibility/transfer posture is not proven by this App repo

The App treats earned NFTs as owned outputs, but current source does not establish that every launch Skin/Small/Medium/Large Toy class is configured as transferable and Auction-eligible in Yokefellow.

**Action:** verify those class capabilities/configuration during Bucket/NFT setup and launch acceptance. Do not infer Auction eligibility merely from this repo.

---

## 3. Known gameplay / quality defects

These are launch work, not speculative redesign items.

### Front guards trap coins

Player report: coins sometimes get stuck on top of guards.

Current `Machine.tscn` contains:

- `LeftFrontGuide`;
- `RightFrontGuide`;
- `LeftFrontGuideExtension`;
- `RightFrontGuideExtension`;

with box collisions around the front field.

**Status:** KNOWN DEFECT. Address in YD-5.

### Playfield feels clunky

The current geometry/flow is not considered launch quality.

**Status:** KNOWN QUALITY GAP. Address in YD-5.

### Capture/settlement falling looks poor

Current payout behavior intentionally counts a body when it enters `PayoutZone`, then leaves physics alone so the body continues falling until `CleanupZone` removes it.

Current source comments explicitly describe this behavior.

This matches the player's reported bad post-capture falling/settlement presentation.

**Status:** KNOWN DEFECT/PRESENTATION GAP. Address in YD-6.

### Coins and toys are not final-quality assets

Current skins/toys are largely constructed procedurally from Godot primitive meshes/materials. They are functional and family-specific, but are not considered launch-quality by the product owner.

**Status:** KNOWN ART GAP. Address in YD-7.

### NFT art and game assets are not sufficiently unified

Current NFT award UI may render the NFT image URL or fall back to an in-game 3D model. The final launch direction requires the NFT, game object, and showcase item to feel like the same collectible.

**Status:** KNOWN ART GAP. Address in YD-7.

---

## 4. Current five Toy powers — exact source behavior

These are the actual current machine powers, not a proposed redesign.

### Horseshoe — magnet

On capture:

- activates `horseshoe_magnet`;
- default duration: **3.5 seconds**;
- considers uncaptured gameplay coins only;
- affects up to **8** coins;
- pulls the nearest eligible coins toward the payout zone;
- default force: **4.0**;
- caps affected coin speed at **2.5**.

### Four-Leaf Clover — Lucky Wheel

On capture:

- creates a pending reward-wheel spin;
- configured outcomes: **1, 2, 3, 5, or 10 YES**;
- maximum configured bonus: **10 YES**;
- active player can spin;
- if unresolved, server auto-resolves after **8 seconds**;
- awarded YES is added to the current turn payout.

### Leprechaun — duplicate nearby machine coins

On capture:

- finds uncaptured coins currently in the machine;
- duplicates the closest candidates to the toy;
- current configured limit is **200 coins**;
- cloned coins preserve the source coin's skin family.

The practical effect can be very large because 200 exceeds the normal starting bed.

### Pot of Gold — double turn payout

On capture:

- sets the turn payout multiplier to at least **2x**;
- final payout is `caught base YES * multiplier + bonus YES`.

### Treasure Chest — bonus coins

On capture:

- adds **10 bonus coins** by default;
- bonus coins are spawned rapidly at roughly 0.18-second intervals;
- they use the default coin skin in the current implementation.

### Shared Toy effect

Every captured Toy also adds turn time:

- **+5 seconds** per Toy by default;
- maximum accumulated Toy bonus time: **30 seconds**.

### Capacity rule

The current machine allows up to **8 active Toys**. A newly requested turn Toy is skipped once the capacity is full.

---

## 5. Current free/paid access behavior

Current server-side access priority is:

1. test-free mode, if enabled;
2. hourly free turn, if ready;
3. stored earned turn, if available;
4. paid turn.

### Already useful

- hourly eligibility is persisted per wallet;
- no hourly free-turn pile accumulates;
- persistent machine state survives restarts;
- paid charge happens before the active turn begins;
- if paid charge fails, the queued turn does not start.

### Mismatch

- hourly cooldown is committed at reservation rather than successful start;
- exact countdown is not surfaced;
- the extra "earned turns" rail is not part of the current YES DROP launch spec.

---

## 6. Obsolete / prototype behavior to quarantine, not remove in YD-1

These remain in `main` but are not launch product requirements.

### Stored earned turns

`shared_world.gd` contains:

- `earned_turns`;
- `grant_earned_turns(...)`;
- `earned_turn_sources`;
- access mode `earned`.

The current launch spec defines hourly free turns and paid turns, not a general earned-turn bank.

**Disposition:** treat as legacy/prototype unless intentionally revived later. Do not build new launch UX around it.

### Test-free turn override

`YES_PUSHER_TEST_FREE_TURNS` can bypass normal paid access.

**Disposition:** test/development facility only, not production product behavior.

### App-owned wallet session service

The web service currently creates its own SIWE-like challenge/session flow using:

- `personal_sign`;
- `SESSION_SECRET`;
- App-local signed session tokens;
- `/auth/challenge`;
- `/auth/verify`;
- `/auth/session/verify`.

Yokefellow now has newer first-party session/profile rails.

**Disposition:** preserve until YD-8 so the current machine remains testable, then replace rather than layering another auth system on top.

### Direct instant NFT minter

`web/server.mjs` currently supports an App-owned mint path using:

- `ethers.Contract`;
- `JsonRpcProvider`;
- `Wallet`;
- `YF_NFT_MINT_PRIVATE_KEY`;
- direct ERC-721/ERC-1155 `mintTo`;
- an App-local mint journal.

**Disposition:** legacy shared-chain plumbing. Preserve for current test continuity only. Remove during YD-8 Network cutover.

### Old YokefellowV2 SDK endpoints

`YokefellowServerClient` currently calls old paths including:

- bucket catalog;
- wallet entitlements;
- bucket credit spends;
- bucket credit grants;
- offering events.

It requires both `YF_BUCKET_ID` and `YF_APP_API_KEY`.

**Disposition:** replace with YokefellowNetwork/current App rails in YD-8.

### Legacy naming/keys

Current code accepts/uses `yes_pusher.*`, `coin-pusher`, and YES Pusher labels. Some parsing already accepts `yes_drop.*` as a compatibility prefix.

**Disposition:** migrate intentionally; do not destabilize current test state solely for naming.

---

## 7. Current deployment assumptions

### Topology

Two Railway services from this repository:

1. **web service**
   - Node 22;
   - serves wallet/session shell and static exported Godot web build;
   - health endpoint at `/health`;
   - embeds game in an iframe.

2. **machine service**
   - headless Godot;
   - authoritative physics/server;
   - WebSocket transport;
   - persistent Railway volume.

### Machine runtime

- Docker image installs **Godot 4.7-beta3**;
- project feature marker: **4.7**;
- physics engine: **Jolt Physics**;
- default server port: 8787;
- snapshot rate: 10 Hz;
- maximum clients: 128;
- authoritative state path: `/data/yes-pusher-shared-state.json`.

### Network / chain

Current web configuration defaults to:

- chain ID **84532**;
- Base Sepolia;
- Base Sepolia RPC if direct minting is enabled.

### Current machine integration configuration

Current example environment expects:

- `YF_API_BASE_URL`;
- explicit `YF_BUCKET_ID`;
- `YF_APP_API_KEY`;
- `YES_PUSHER_APP_SLUG=coin-pusher`;
- spend event `coin_drop_started`;
- credit event `coin_drop_completed`;
- skin event `skin_drop_earned`;
- toy event `toy_caught`;
- skin trigger `yes_pusher.skin_drop`;
- toy trigger `yes_pusher.toy_caught`;
- 10 YES turn price;
- 1 YES per payout unit;
- test free turns disabled;
- web service URL for App-local wallet-session verification.

### Current browser build assumption

A built Godot web export is committed under `web/public/game`.

Changing Godot source does not automatically imply that the committed browser export is current; future gameplay pulls must rebuild/export the browser player before deployment acceptance.

---

## 8. Changed / unchanged launch map

| Area | Current main | Launch action |
| --- | --- | --- |
| Shared authoritative machine | Present | **UNCHANGED / preserve** |
| Queue + active turn | Present | **UNCHANGED / extend presentation** |
| Persistent world state | Present | **UNCHANGED / preserve** |
| 10-coin turn | Present | **UNCHANGED** |
| 10 YES paid turn | Configured | **UNCHANGED** |
| Payout from physical catches | Present | **UNCHANGED core** |
| 100 paid-out-coin skin milestone | Present | **UNCHANGED core** |
| Random skin result / duplicates | App submits milestone; no collection-completion protection | **KEEP random behavior** |
| Five Rainbow's End families | Present | **UNCHANGED** |
| Skin selects matching physical Toy | Present | **UNCHANGED core** |
| Toy catch -> Small NFT | Present | **UNCHANGED core** |
| Small/Medium/Large showcase ladder | Not implemented | **ADD** |
| Burn 3 -> craft next size | Not implemented | **ADD** |
| Toy size changes power | Not present | **KEEP absent** |
| Active player's canonical profile | Wallet shorthand only | **ADD** |
| Active player's Toy showcase | Not present | **ADD** |
| Machine persistence across UI/player changes | Shared machine exists | **PRESERVE and build UI around it** |
| Hourly free turn | Present | **MODIFY consumption timing + UI** |
| Non-stacking free turn | Timestamp model already non-stacking | **KEEP** |
| Exact free countdown | Not present | **ADD** |
| Extra earned-turn bank | Present | **QUARANTINE / likely remove from launch path** |
| Sold equipped skin fallback | Happens after entitlement refresh | **STRENGTHEN ownership freshness** |
| Toy/Skin Auction eligibility | Not proven here | **VERIFY Yokefellow NFT configuration** |
| Front guard physics | Known trapping issue | **FIX** |
| Capture exit presentation | Fall-through cleanup | **FIX presentation** |
| Coin/Toy visual quality | Functional but not final | **REWORK art** |
| NFT/game visual alignment | Inconsistent | **REWORK art** |
| App-local wallet session | Present | **REPLACE in YD-8** |
| Direct private-key NFT minting | Present/optional | **REMOVE in YD-8** |
| Old direct YokefellowV2 APIs | Present | **REPLACE in YD-8** |
| Public YES DROP naming | Partial compatibility only | **MIGRATE deliberately** |

---

## 9. YD-1 acceptance checklist

- [x] Current launch decisions captured in one authoritative repo document.
- [x] Current `main` audited against those decisions.
- [x] Working systems that should be preserved identified.
- [x] Required modifications identified.
- [x] Legacy/prototype behavior identified without deleting it.
- [x] Known player-reported defects recorded.
- [x] Exact current five Toy powers recorded.
- [x] Current Railway/Base Sepolia deployment assumptions recorded.
- [x] Changed/unchanged map created.
- [x] No gameplay redesign performed in YD-1.
- [ ] Runtime/manual gameplay validation was not performed as part of this documentation-only source audit.

## Gate result

**YD-1 source/spec gate: PASS.**

The repo now has a single authoritative YES DROP launch target plus a source-level map of what is preserved, modified, added, quarantined, or deferred.

Runtime validation belongs to the implementation pulls and final acceptance pass; it is not claimed by this documentation-only YD-1 pull.
