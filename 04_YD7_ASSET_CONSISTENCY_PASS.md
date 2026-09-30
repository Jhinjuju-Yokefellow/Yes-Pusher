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

Each family must remain recognizable across its Coin Skin, physical gameplay Toy, and Toy NFT showcase art.

## Asset model

### Coin Skins

There are five Coin Skin designs, one per family. A Coin Skin stays visibly a coin/token and must remain readable at gameplay scale.

The final NFT image should be a polished presentation of the same design used by the game, not unrelated artwork.

### Physical gameplay Toys

There are exactly five gameplay Toy designs, one per family.

Small, Medium, and Large are not separate physical machine objects.

Small, Medium, and Large ownership all map to the same family gameplay Toy and the same family power. Tier must not change physical dimensions, physics, power strength, power behavior, or payout behavior.

### Toy NFT tiers

Each family has Small, Medium, and Large NFT/showcase tiers, for fifteen Toy NFT classes total.

Catching a Toy awards Small. Three Small upgrade to one Medium. Three Medium upgrade to one Large.

Small should closely represent the actual gameplay Toy. Medium and Large should preserve the same family identity while becoming increasingly elaborate collectible/showcase presentations. The progression is status and presentation, not gameplay power.

## Active-player showcase

The active player's owned Toys are shown to everyone watching. Tier must be explicit in the showcase rather than inferred only from artwork.

A transferred or sold Toy disappears after authoritative ownership refresh. There is no Toy equip state for the showcase.

## YD-7 preview workbench

Use res://tools/AssetPreview.tscn to inspect the real Coin.tscn and Toy.tscn assets under fixed lighting before making NFT artwork.

Controls:

- Left/Right or 1–5: choose family
- C: Coin Skin
- T: gameplay Toy
- Space: toggle Coin/Toy
- R: toggle rotation
- S: save a clean PNG without the overlay

Screenshots are written to user://yd7_previews.

The first family pass is Horseshoe:

1. inspect/polish the real Horseshoe Coin;
2. inspect/polish the real Horseshoe gameplay Toy;
3. use those real designs as the source for the Horseshoe Coin NFT image;
4. make Small Horseshoe closely match the gameplay Toy;
5. derive Medium and Large as progressively richer showcase treatments;
6. freeze that visual grammar before repeating it for the remaining four families.

## Deliverables

- 5 final Coin Skin class images
- 5 final physical gameplay Toy appearances
- 15 final Small/Medium/Large Toy NFT/showcase images
- light guard/presentation cleanup where needed

## Acceptance gate

YD-7 is complete when all five families are visually coherent across Coin Skin, gameplay Toy, and Toy NFT presentation; the 15 Toy NFT tiers clearly communicate collectible progression without implying gameplay progression; and the finished images are ready for creation of the 5 Coin Skin classes and 15 Toy classes in Yokefellow.
