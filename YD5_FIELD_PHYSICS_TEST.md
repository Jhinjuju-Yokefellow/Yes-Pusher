# YD-5 — Rainbow's End field and physics pass

## Goal

Clean the physical field without changing the authoritative multiplayer model or the game economy.

## Changes in this pass

### Guard trapping / field geometry

- The front guide pieces are lower and narrower.
- The long front extensions are shorter and angled inward instead of creating nearly straight side pockets.
- Glass opacity is reduced so the peg field is easier to read from the spectator camera.
- The pusher is slightly brighter against the lower playfield.

### Stuck-object recovery

The authoritative machine watches only known risk areas:

- peg-wall channel;
- lower side/guard channel;
- hidden area immediately behind the retracted pusher.

Normal sleeping coins in the lower coin bed are not considered stuck.

A body must remain effectively motionless in one of those risk areas for the configured delay before recovery occurs.

Default tuning:

```text
scan interval: 0.50 s
stuck threshold: 3.50 s
recovery impulse: 0.75
```

Recovery behavior:

- peg-wall objects receive a restrained downward/inward impulse;
- side-guard objects receive an inward/forward impulse;
- after repeated side trapping, the object is placed just inside the playable field;
- objects hidden behind the pusher are returned immediately in front of the retracted shelf.

Recovery happens only on the authoritative machine. Browser spectators continue to receive the resulting transforms through the existing world snapshots.

### Toy movement

All five gameplay Toy families keep their existing visual models and compound collision shapes.

This pass lowers friction/damping and slightly reduces mass so Toys move with the coin bed rather than behaving like anchors. The Treasure Chest remains the heaviest of the five.

No Toy gains gameplay power from size or mass changes.

### Existing powers

**Horseshoe**

The magnet now considers lower-playfield coins only and pulls toward a point behind the front lip. It no longer pulls peg-wall coins or applies a strong downward vector toward the payout trigger.

**Leprechaun**

Duplicated coins spawn farther above their source coin and inherit a restrained portion of the source velocity. This reduces immediate overlapping rigid bodies and explosive pile behavior while preserving the existing coin-duplication power.

Other power outcomes are unchanged.

## Multiplayer preservation

YD-5 does not change:

- turn authority;
- queue ownership;
- turn IDs;
- settlement;
- payout accounting;
- world snapshot schema/version;
- replica interpolation;
- YD-2 active-player presentation;
- YD-3 hourly free turns.

## Acceptance test

Run multiple consecutive turns on the same authoritative machine.

Check:

1. top-drop coins descend through the peg field without repeatedly parking against the peg-wall channel;
2. coins reaching either lower guard do not repeatedly form the same immovable pocket;
3. no coins or Toys visibly accumulate behind the retracted pusher;
4. Toys continue moving with repeated pusher strokes instead of becoming permanent anchors;
5. objects still fall naturally through the open payout path;
6. Horseshoe attraction is visible but does not pin coins into the floor/guards;
7. Leprechaun duplication does not produce an obvious explosive overlap/jammed pile;
8. spectators see the same authoritative motion without a new reload, stepping, or ownership regression;
9. repeated turns do not show an obvious recurring stuck/guard failure.

The gate is visual/behavioral: the field should feel materially cleaner to watch. Tune the three recovery exports or guard geometry only if the repeated local test demonstrates a recurring problem.
