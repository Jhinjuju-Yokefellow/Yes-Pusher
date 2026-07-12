# Machine Regression Checklist

Run this checklist before accepting any future patch.

## Startup

- [ ] The centered tower remains stable before player coins reach it.
- [ ] No starting coin appears outside or behind the visible funnel walls.
- [ ] Both front side banks begin densely loaded without overlapping the center tower.
- [ ] The initial loose coin field does not explode, bounce, or visibly resettle.
- [ ] The pusher begins cycling immediately.
- [ ] The pusher retracts fully behind the scraper wall.

## Coin insertion

- [ ] A 1-coin batch uses one valid random chute.
- [ ] A 10-coin batch uses shuffled chutes rather than one repeated chute.
- [ ] Coins release one at a time with roughly two seconds between them.
- [ ] Coins remain face-flat behind the glass.
- [ ] No coin remains permanently balanced on a peg.
- [ ] Side-lane coins descend without teleporting or becoming trapped.

## Pusher

- [ ] Coins can land on the moving shelf or the receiving floor without hovering.
- [ ] The shelf carries coins forward.
- [ ] The fixed wall leaves coins forward during retraction.
- [ ] Coins are not pulled behind the wall.
- [ ] The pusher does not ride over the pile or launch coins upward excessively.
- [ ] The pusher continues cycling during insertion and the timed turn.

## Scoring

- [ ] A front-edge coin increments the score exactly once.
- [ ] The falling payout remains visible in front of the cabinet banner.
- [ ] A side-drain coin does not increment the score.
- [ ] Removed coins reduce the machine coin count.

## Endurance

- [ ] Repeated 10-coin batches do not progressively slow the game.
- [ ] The machine remains usable after at least 15 minutes of continuous play.
- [ ] Reset Machine restores the centered tower and loaded side banks.

## Local turn system

- [ ] One click creates only one turn.
- [ ] Reset Machine cancels a batch that is still releasing between two-second drops.
- [ ] Current-turn score begins at zero.
- [ ] Payouts during insertion belong to the active turn.
- [ ] The 30-second timer starts immediately when the player confirms the turn.
- [ ] Timer expiry waits for the current pusher cycle boundary.
- [ ] Final falling coins are counted during settlement.
- [ ] The result card matches the current-turn score.
- [ ] Lifetime score increases only once when the turn finalizes.
- [ ] No more than one skin milestone resolves per turn.

## Shared world

- [ ] Two browser windows show the same pusher position and coin field.
- [ ] A spectator can watch without joining the queue.
- [ ] Only the first queued player can start a turn.
- [ ] The server, not the browser, chooses the random chute plan.
- [ ] Both windows show the same active chute, timer, payouts, and result.
- [ ] The completed player rotates behind the next connected queued player.
- [ ] Refreshing within twenty seconds keeps queue position.
- [ ] Closing every browser pauses an idle ready machine without changing its coin field.
- [ ] Closing every browser during a turn still allows that turn to finish on the server.
- [ ] Restarting the server restores the latest confirmed completed world.

## Wallet identity and settlement

- [ ] An unsigned visitor can watch but cannot join the queue when wallet-required mode is enabled.
- [ ] Signing the challenge creates a wallet-owned player identity without requesting a transaction.
- [ ] An unsigned `wallet:` query ID is treated as a guest, not an authenticated wallet.
- [ ] Changing wallet accounts disconnects the old identity and reconnects the shared view.
- [ ] One completed turn creates exactly one settlement record.
- [ ] Replaying or retrying a turn settlement cannot create a second credit grant.
- [ ] No-payout turns show no YES won.
- [ ] Missing credit-route configuration shows the amount as owed/recorded, never confirmed.
- [ ] Failed external submissions honor retry backoff and remain durable after restart.
- [ ] Yokefellow `turn_completed` events include the permanent turn event identity.
- [ ] A resolved skin milestone sends `coin_pusher.random_skin_drop` exactly once.
- [ ] The skin trigger request does not include `selectedOutputId`; Yokefellow chooses the random output.
- [ ] A successful skin response records the selected `yes_drop.*` ID and request/mint references.
- [ ] A no-match response remains retryable and is not displayed as an issued skin.
