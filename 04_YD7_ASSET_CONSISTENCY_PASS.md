# YD-7 — Rainbow's End Asset Consistency Pass

## Objective

Make the YES DROP gameplay assets, Coin Skin NFTs, and Toy NFTs look like parts of the same collectible system.

This is not a redesign of the Rainbow's End machine. Preserve the cabinet, machine layout, peg field, camera, gameplay structure, Toy powers, and gameplay behavior. Machine work in this pass is limited to light presentation cleanup such as the guards.

## Launch families

1. Horseshoe
2. Four-Leaf Clover
3. Leprechaun
4. Pot of Gold
5. Treasure Chest

## Coin model — corrected source of truth

YES DROP has **one physical gameplay coin mesh and one physics/collision model**.

The default coin uses the silver-and-blue YES token artwork. Family collectibles are **skins on that same coin**, not different coin objects.

A skin may change the face artwork and visual accents, but it must not change:

- coin dimensions;
- collision;
- mass;
- payout value;
- drop behavior;
- physics behavior.

The runtime skin slots are:

- `assets/coin_skins/yes_default.webp`
- `assets/coin_skins/horseshoe.webp`
- `assets/coin_skins/four_leaf_clover.webp`
- `assets/coin_skins/leprechaun.webp`
- `assets/coin_skins/pot_of_gold.webp`
- `assets/coin_skins/treasure_chest.webp`

Until a family texture exists, the runtime deliberately falls back to the default YES skin. This lets us design each family without changing Coin.tscn again.

The Coin Skin NFT artwork should correspond to the texture actually used on this shared gameplay coin.

## Physical gameplay Toys

There are exactly five gameplay Toy designs, one per family.

Small, Medium, and Large are not separate physical machine objects.

Small, Medium, and Large ownership all map to the same family gameplay Toy and the same family power. Tier must not change physical dimensions, physics, power strength, power behavior, or payout behavior.

## Toy NFT tiers

Each family has Small, Medium, and Large NFT/showcase tiers, for fifteen Toy NFT classes total.

Catching a Toy awards Small. Three Small upgrade to one Medium. Three Medium upgrade to one Large.

Small should closely represent the actual gameplay Toy. Medium and Large should preserve the same family identity while becoming increasingly elaborate collectible/showcase presentations. The progression is status and presentation, not gameplay power.

## Active-player showcase

The active player's owned Toys are shown to everyone watching. Tier must be explicit in the showcase rather than inferred only from artwork.

A transferred or sold Toy disappears after authoritative ownership refresh. There is no Toy equip state for the showcase.

## YD-7 preview workbench

Use `res://tools/AssetPreview.tscn` to inspect the real Coin.tscn and Toy.tscn assets under fixed lighting.

Controls:

- Left/Right or 1–5: choose family
- C: Coin Skin
- T: gameplay Toy
- Space: toggle Coin/Toy
- R: toggle rotation
- S: save a clean PNG without the overlay

Screenshots are written to `user://yd7_previews`.

## Deliverables

- one final YES base coin;
- 5 final Coin Skin textures/class images;
- 5 final physical gameplay Toy appearances;
- 15 final Small/Medium/Large Toy NFT/showcase images;
- light guard/presentation cleanup where needed.

## Acceptance gate

YD-7 is complete when the default in-game coin visibly matches the official YES identity, all five family skins use the same Coin.tscn geometry/physics, all five Toy families are coherent with their NFT presentation, and the finished images are ready for the 5 Coin Skin classes and 15 Toy classes in Yokefellow.
