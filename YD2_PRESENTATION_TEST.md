# YD-2 presentation test mode

This mode validates the persistent active-player presentation before live Yokefellow Profile/NFT reads are wired.

It does **not** replace the authoritative machine, queue, turns, snapshots, or multiplayer transport. Only the player presentation data source is mocked.

## Enable on the authoritative machine

Set:

```text
YES_PUSHER_PRESENTATION_TEST_MODE=true
YES_PUSHER_TEST_FREE_TURNS=true
```

`YES_PUSHER_TEST_FREE_TURNS=true` keeps this UI/multiplayer check from charging YES.

The presentation fixture mode may also be enabled for a local server with:

```text
--presentation-test
```

## Permanent presentation contract

The server broadcasts the same shape that the later Yokefellow-backed provider will fill:

```text
{
  version,
  source,
  wallet,
  profile: {
    display_name,
    handle,
    avatar_url,
    profile_picture_url
  },
  equipped_skin: {
    family,
    label
  },
  toys: [
    {
      family,
      size,
      quantity
    }
  ]
}
```

The UI depends on this contract, not on the fixture implementation. Live Yokefellow reads can therefore replace the test provider without rebuilding the presentation layer.

## Two-player gate

1. Start the existing authoritative machine with presentation test mode enabled.
2. Open two browser clients using two different verified wallets.
3. Join the queue from both clients.
4. Player A's turn should show **Rainbow Player A**, its equipped skin, and its Small/Medium Toy showcase on every connected viewer.
5. Let the turn finish without restarting or reloading the machine.
6. Player B's turn should replace the panel with **Rainbow Player B**, a different equipped skin, and a different Toy showcase including Large.
7. A spectator joining during either turn should immediately receive the same active-player presentation.
8. Verify the physical machine state continues uninterrupted across the player transition.

## Deferred source swap

The test fixtures are temporary. Later integration replaces the provider with:

- canonical Yokefellow Profile Card lookup by wallet;
- Rainbow's End Toy ownership reads;
- equipped Coin Skin ownership/state.

The machine and presentation UI should not change during that swap.


## Reconciled YD-7 note

The steady branch uses the current Rainbow's End game assets and the richer YD-7 Profile/Toy showcase. Presentation-test fixtures are only a deterministic regression provider; they no longer represent the final visual asset source.
