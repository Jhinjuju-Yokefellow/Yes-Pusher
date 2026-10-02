# YD-8 — YES drop YokefellowNetwork Cutover Manifest

## Canonical product identity

- Bucket display name: **YES drop**
- App key/slug: **coin-pusher**
- Active machine theme: **Rainbow's End**
- Launch chain: Base Sepolia (84532)
- The older 15-skin YES Coin Pusher expansion is **not** the current launch NFT set.
- Current launch NFT set: **5 YES Skin classes + 15 Rainbow's End Toy classes**.

YD-8 is complete only when YES DROP contains no private NFT mint authority, no direct NFT contract ABI/mint path, no old `/api/sdk/v1` runtime dependency, and no duplicate wallet/session authority that YokefellowNetwork already provides.

## 1. Bucket prerequisites

YES drop must be:

1. Activated on Base.
2. Registered with YokefellowNetwork using its stable Network Bucket identity.
3. Open/active for participation.
4. Configured for participant funding as:
   - capture mode: **capture on action**
   - participant credit: **withdrawable**
5. Connected to the existing `coin-pusher` App.
6. App granted/active in Network.
7. App given a Network API key (`yfk_...`) stored server-side only.

## 2. Network funding required for YES drop

The current Network credit vault is insufficient for the faucet model because it has no ordinary Bucket reserve refill and no Bucket-backed participant-credit grant.

Required Network funding posture:

```text
controller YES -> Bucket reserve
participant credit -> paid-turn capture -> Bucket reserve
Bucket reserve -> turn payout -> participant credit
participant credit -> optional participant withdrawal
```

Required Network additions:

### Bucket reserve refill

Controller-authorized, fully backed YES transfer into the Bucket's captured/reserve balance.

Properties:

- wallet signs/sends the reserve funding transaction;
- no App or relayer may debit the controller wallet;
- stable reference/idempotency;
- increases Bucket reserve/captured YES;
- never creates participant credit;
- no operator withdrawal path.

### Participant payout credit

Network-authorized App action that reclassifies existing Bucket reserve into fully backed participant credit.

Properties:

- requires active/authorized App;
- requires participant wallet;
- amount cannot exceed Bucket reserve;
- stable App + Bucket + reference idempotency;
- decreases Bucket reserve;
- increases that participant's credit;
- preserves total vault backing;
- no YES is minted;
- no direct App wallet/private key.

Proposed semantic capability:

```text
yes_drop.turn.payout -> credit.grant.v1
```

Paid turn capture remains:

```text
yes_drop.turn.capture -> credit.capture.v1
```

## 3. YES Skin collection

One ERC-1155 V3 collection.

Suggested collection label:

```text
Rainbow's End YES Skins
```

Collection-supported capabilities:

- APP_MINT
- TRANSFERABLE
- AUCTION

Not supported for YES Skins:

- HOLDER_BURN
- APP_BURN
- CRAFT_CONSUME
- equip/use lifecycle locking
- app/operator metadata mutation after freeze

Current five classes:

1. Horseshoe YES Skin
2. Four-Leaf Clover YES Skin
3. Leprechaun YES Skin
4. Pot of Gold YES Skin
5. Treasure Chest YES Skin

Current posture:

- transferable/sellable;
- Auction-eligible;
- duplicate ownership allowed;
- App mint enabled;
- no holder burn;
- no App burn;
- no craft consumption;
- metadata frozen;
- repeatable earned outcome.

### YES Skin Drop Path

One public earned Path representing the skin milestone.

Current game rule:

- trigger basis: every 100 lifetime payout coins;
- duplicate skins allowed;
- weighted/random result among the five current YES Skin classes.

The current automatic Network Path derivation only supports one fixed result, so the weighted Skin Drop must use a dedicated Network weighted-result executor rather than being flattened into fake fixed public Paths.

Stable App reference must derive from the milestone, not browser state:

```text
wallet + skin milestone number
```

A repeated request for the same milestone must resolve to the same Network action/result and never issue a second NFT.

## 4. Rainbow's End Toy collection

One ERC-1155 V3 collection.

Suggested collection label:

```text
Rainbow's End Toys
```

Collection-supported capability union:

- APP_MINT
- TRANSFERABLE
- AUCTION
- CRAFT_CONSUME
- APP_BURN

All Toy classes:

- transferable/sellable;
- Auction-eligible;
- duplicate ownership allowed;
- App mint enabled;
- holder burn disabled;
- metadata frozen;
- 3% NFT royalty posture already selected for the current Toy draft.

### Stable Toy class keys

| Family | Small | Medium | Large |
| --- | --- | --- | --- |
| Four Leaf Clover | `four_leaf_clover_l1` | `four_leaf_clover_l2` | `four_leaf_clover_l3` |
| Horseshoe | `horseshoe_l1` | `horseshoe_l2` | `horseshoe_l3` |
| Leprechaun | `leprechaun_l1` | `leprechaun_l2` | `leprechaun_l3` |
| Pot of Gold | `pot_of_gold_l1` | `pot_of_gold_l2` | `pot_of_gold_l3` |
| Treasure Chest | `treasure_chest_l1` | `treasure_chest_l2` | `treasure_chest_l3` |

### Class capability split

Small:

- APP_MINT: yes
- TRANSFERABLE: yes
- AUCTION: yes
- CRAFT_CONSUME: **yes**
- APP_BURN: no
- HOLDER_BURN: no

Medium:

- APP_MINT: yes
- TRANSFERABLE: yes
- AUCTION: yes
- CRAFT_CONSUME: **yes**
- APP_BURN: no
- HOLDER_BURN: no

Large:

- APP_MINT: yes
- TRANSFERABLE: yes
- AUCTION: yes
- CRAFT_CONSUME: no
- APP_BURN: **yes**, used only for voluntary community-build contribution
- HOLDER_BURN: no

This resolves the earlier `appBurn:true / craftConsume:false` draft: Network craft uses the hard `CRAFT_CONSUME` capability and APP_BURN is not a substitute.

## 5. Toy issuance Path

Physical Toy capture awards the matching **Small** Toy NFT.

Five possible Small results correspond to the five physical Toy families.

Stable idempotency identity:

```text
turnId + toyInstanceId
```

One unique physical `toyInstanceId` can issue at most one Small Toy NFT.

Because the App already knows the authoritative caught Toy family, Network must validate the selected output against the configured allowed Small Toy outputs. The App must not receive generic mint authority.

## 6. Craft Paths

Ten fixed craft Paths:

- Four Leaf Clover: 3 Small -> 1 Medium
- Four Leaf Clover: 3 Medium -> 1 Large
- Horseshoe: 3 Small -> 1 Medium
- Horseshoe: 3 Medium -> 1 Large
- Leprechaun: 3 Small -> 1 Medium
- Leprechaun: 3 Medium -> 1 Large
- Pot of Gold: 3 Small -> 1 Medium
- Pot of Gold: 3 Medium -> 1 Large
- Treasure Chest: 3 Small -> 1 Medium
- Treasure Chest: 3 Medium -> 1 Large

All inputs are:

- `burn_required`
- `all_required`
- quantity 3

These map directly to the existing Network `nft.v3.v1` craft executor after Small/Medium classes are contract-configured with CRAFT_CONSUME.

## 7. Community build contribution

Large Toy contribution is voluntary and permanently consumes one Large Toy.

Family build points:

- Four Leaf Clover: 1
- Horseshoe: 2
- Leprechaun: 3
- Pot of Gold: 4
- Treasure Chest: 5

Initial machine-build target: **50 points**.

Network must execute the Large Toy burn/consume action. YES DROP must not retain `YF_CONTRIBUTION_BURN_PRIVATE_KEY`.

Community build state can remain an App projection of canonical Network actions/events; the irreversible NFT mutation and idempotency belong to Network.

## 8. Participant authorization

Replace YES DROP's local challenge/session/HMAC implementation with Network participant auth:

1. App server requests Network participant challenge.
2. Browser signs challenge.
3. App server exchanges signature for Network participant session.
4. Browser holds only participant session token.
5. Server-side requests forward the participant session to Network where required.
6. Godot authoritative server verifies the same Network participant session.

Remove at final cutover:

- local challenge Map;
- `SESSION_SECRET`;
- local HMAC session token;
- local `verifyMessage` session authority;
- duplicated expiry/session ID handling.

## 9. NFT ownership and profile presentation

NFT ownership reads come from:

```text
GET /v1/nfts/buckets/:bucketId/holdings/:wallet
```

YES DROP should map Network holdings to:

- five YES Skin families;
- fifteen Toy family/tier holdings;
- equipped skin selection.

The real user Profile Card remains supplied by Yokefellow; local fixture profiles are test-only.

## 10. App events

Publish canonical Network App events for spectator/product record where useful:

- turn started
- Toy caught
- turn result finalized
- Skin milestone reached
- community contribution confirmed
- machine-build threshold reached

Stable reference IDs must derive from authoritative turn/action identity.

App events are records; they do not replace semantic Network actions for credit or NFT mutations.

## 11. Obsolete YES DROP runtime to delete

After Network configuration is live and verified, remove:

- `/api/sdk/v1` catalog/credit/offering-event dependencies;
- `YF_NFT_MINT_PRIVATE_KEY`;
- `YF_INSTANT_MINT_SECRET`;
- `YF_INSTANT_MINT_URL`;
- direct ERC-721/1155 mint ABIs;
- direct Base NFT mint transactions;
- instant-mint journal/lock;
- issuance-job completion plumbing owned by the old app minter;
- `YF_CONTRIBUTION_BURN_PRIVATE_KEY`;
- direct craft/offering execution superseded by Network actions;
- local wallet challenge/session authority;
- ad-hoc settlement retries superseded by Network action lookup/reconcile/resume.

## 12. YD-8 gate

YD-8 passes only when:

- YES drop is a registered active Network Bucket;
- `coin-pusher` is an authorized active Network App;
- required V3 Collections are deployed and recognized;
- all 20 current classes are contract-configured and active;
- Skin/Toy/craft/contribution capabilities resolve through Network;
- paid turn capture resolves through Network;
- payout credit resolves through the Network Bucket reserve rail;
- Deposit/Withdraw use Network participant sessions and prepared wallet transactions;
- ownership reads use Network;
- all semantic writes use stable Network references;
- uncertain actions reconcile through Network;
- YES DROP contains no NFT mint private key;
- YES DROP contains no contribution burn private key;
- YES DROP contains no direct NFT mint ABI/transaction path;
- YES DROP contains no old `/api/sdk/v1` dependency;
- YES DROP contains no duplicate local wallet-session authority.
