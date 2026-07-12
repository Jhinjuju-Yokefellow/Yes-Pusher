# CoinPusher 56 — Continuous visual pusher during replay

## Fixed

- The browser pusher no longer stops when its local replay reaches `ready`
  before Railway finishes the official settling window.
- While Railway still owns an active turn, the browser keeps the pusher cycling
  and keeps local visual physics running.
- The pusher returns to the parked rear position only after Railway sends the
  confirmed turn-boundary snapshot.
- Visible falling coins remain browser-simulated. Railway does not stream or
  steer their live transforms.
- Railway still runs a hidden authoritative scoring simulation so payout and
  settlement results are not trusted to browser code.

## Unchanged

- Queue behavior
- 1–10 coin drop schedule
- Payout counting
- Wallet authentication
- Persistent world storage
- Yokefellow settlement and skin-drop event handling
