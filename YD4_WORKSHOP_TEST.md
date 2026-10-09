# YD-4 — Rainbow's End Toy Workshop + Community Machine Build

## Scope

Rainbow's End now has an outer app shell with:

- Home
- Play
- Workshop
- Coin Skins

The shared Godot machine remains the Play surface. Crafting, loadout selection and community capacity building live outside the machine HUD.

## Toy progression

All five families use the same progression:

| Family | Rarity | Large contribution |
| --- | ---: | ---: |
| Four Leaf Clover | 1 | +1 build point |
| Horseshoe | 2 | +2 build points |
| Leprechaun | 3 | +3 build points |
| Pot of Gold | 4 | +4 build points |
| Treasure Chest | 5 | +5 build points |

Craft recipes:

- 3 Small -> consume -> 1 Medium
- 3 Medium -> consume -> 1 Large

Stable class keys using L1/L2/L3 are interpreted as Small/Medium/Large.

Crafting does not change gameplay power. Medium and Large remain normal transferable/Auction-eligible NFTs until explicitly consumed by another action.

## Atomic craft execution

The Workshop discovers live craft offerings from Yokefellow. It never hard-codes offering, output or craft-rule database IDs.

Craft execution uses:

`POST /api/sdk/v1/buckets/{bucketId}/offerings/craft`

with a stable reference ID. Yokefellow's atomic craft executor validates current ownership, burns all required inputs and mints the output in one transaction. Retrying the same Workshop operation reuses the same reference.

Required Yokefellow configuration for each family:

- live craft Path for Small -> Medium;
- one burn-required Small input rule with quantity 3;
- Medium NFT output;
- live craft Path for Medium -> Large;
- one burn-required Medium input rule with quantity 3;
- Large NFT output;
- the connected `coin-pusher` App must be allowed to execute the craft Paths / craft event;
- input classes use approved-app burn;
- output collection grants the atomic craft executor mint authority.

The Rainbow's End Toy configuration intentionally remains app-burn based. Holder burn does not need to be enabled.

## Ownership/showcase refresh

After a craft confirms, the browser polls Yokefellow ownership until it observes:

- source tier reduced by 3; and
- target tier increased by 1.

The Workshop then rerenders from Yokefellow holdings. The live Active Dropper showcase reads the same ownership source when the player's next authoritative turn begins.

## Coin Skin loadout

The outer Coin Skins view shows wallet-owned Rainbow's End Coin Skins. Selecting one stores the app loadout and passes the selected family into the Godot browser bootstrap.

The starter YES coin remains available and is not an NFT.

## Community machine build

A Large Toy can be voluntarily contributed to community capacity.

The contribution is irreversible:

```text
Large Toy
  -> approved app burn
  -> family rarity points
  -> shared Machine Build total
```

Initial target:

```text
50 build points -> next Rainbow's End machine funded/unlocked
```

The target is configuration, not hard-coded economy:

`YES_PUSHER_MACHINE_BUILD_TARGET=50`

The app tracks total points and derives funded machine count from the configured target. Actual multi-machine provisioning/routing is separate from YD-4; YD-4 produces the authoritative funded/unlocked state that future capacity routing consumes.

### Duplicate-safe contribution

The contribution service uses a dedicated server-only approved-burner signer.

Before broadcast it:

1. validates live Large Toy ownership;
2. prepares the burn;
3. signs the complete transaction;
4. stores the raw signed transaction, transaction hash, wallet, family, points and reference;
5. only then broadcasts it.

If the request/process fails after that point, retrying the same reference rebroadcasts/checks the exact same signed transaction rather than creating another burn.

Only confirmed burn transactions add build points.

For deployed use, the contribution journal must live on persistent storage:

`YES_PUSHER_COMMUNITY_BUILD_STATE_PATH=/data/yd4-workshop-state.json`

The dedicated signer is server-only:

`YF_CONTRIBUTION_BURN_PRIVATE_KEY=...`

Never expose it to browser JavaScript.

## YD-4 gate

Use one family with at least three indexed Small Toys.

1. Sign into Rainbow's End.
2. Home shows current Coin Skin, Toy holdings and community build progress.
3. Open Workshop.
4. Verify the family shows at least Small x3.
5. Click `3 SMALL -> 1 MEDIUM`.
6. Confirm one atomic craft execution succeeds.
7. Verify Yokefellow ownership changes from Small xN to Small x(N-3).
8. Verify Medium increases by one.
9. Verify the Workshop updates without manually reconstructing state.
10. Enter the shared machine on a later turn and verify the Active Dropper showcase reflects the new Medium Toy.
11. Retry the same craft reference and verify it does not consume another three Toys or mint another Medium.

Community-build extension:

1. Hold one Large Toy.
2. Contribute it.
3. Verify the Large is burned/indexed.
4. Verify points increase by the family value (1/2/3/4/5).
5. Retry the same reference and verify the same transaction/result is returned with no second burn.
6. Verify reaching 50 points increments the funded machine count.

## Not YD-4

YD-4 does not provision, schedule or route traffic across Machine #2. It creates the collection progression, irreversible community contribution rail, and durable capacity-unlock state. Multi-machine runtime orchestration can consume that state later.
