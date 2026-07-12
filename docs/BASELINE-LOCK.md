# YES Pusher Machine Base Lock

This project is the approved machine base. Future work should extend it without redesigning the machine unless a specific, reproducible defect requires a mechanical change.

## Locked presentation

- Current cabinet proportions, artwork, lighting, and camera range
- Rear Plinko/peg board behind glass
- Seven randomized insertion lanes
- Active-player showcase frames on the left and right
- Large fixed payout board and narrower rear pusher area
- One dense, non-overlapping flat starting coin field
- Front payout fall visible in front of the cabinet banner

## Locked machine behavior

- The pusher cycles continuously.
- The pusher retracts fully behind the scraper wall.
- Coins are inserted individually with two seconds between releases.
- Each coin receives its own shuffled random chute.
- Coins stay face-flat through the peg board.
- Side-lane coins remain physical; they are not teleported sideways.
- Coins land in the rear receiving area and are moved by the physical pusher.
- Coins riding the moving shelf are left forward by the fixed scraper wall during retraction.
- Front-edge falls count once and remain visible while falling.
- Side-drain and rear-loss coins do not count.
- Every starting coin begins flat and asleep; no starting coin is stacked above another.

## Change rule

A future patch may change a locked item only when it names the exact defect, identifies the files involved, and proves that unrelated locked behavior remains intact.
