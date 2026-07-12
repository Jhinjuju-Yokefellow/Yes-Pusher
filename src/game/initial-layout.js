import {
  CONFIG,
  playableHalfWidthAtZ,
} from '../config/machine-config.js';

export const STARTING_BED_ROWS = 9;
export const STARTING_BED_ROW_SPACING = 0.66;
export const STARTING_BED_COLUMN_SPACING = 0.70;
export const STARTING_BED_REAR_Z = -0.17;

/**
 * Returns the starting coin field as one dense, non-overlapping flat layer.
 *
 * There are no towers and no upper layers. This removes the large stack-contact
 * graph that was slowing the authoritative physics server and lets pusher force
 * travel through the field instead of being absorbed by vertical piles. The
 * final row begins at the payout edge so ordinary turns can start moving coins
 * over the front without first collapsing a jackpot structure.
 */
export function createStartingBedPlan(random = Math.random) {
  const plan = [];
  const wallClearance = CONFIG.coin.radius + 0.08;

  for (let row = 0; row < STARTING_BED_ROWS; row += 1) {
    const z = STARTING_BED_REAR_Z + row * STARTING_BED_ROW_SPACING;
    const oddRow = row % 2 === 1;
    const halfWidth = playableHalfWidthAtZ(z, wallClearance);

    for (let column = -9; column <= 9; column += 1) {
      const x = (column + (oddRow ? 0.5 : 0)) * STARTING_BED_COLUMN_SPACING;
      if (Math.abs(x) > halfWidth) continue;

      plan.push({
        x,
        z,
        layer: 0,
        rotationY: random() * Math.PI,
      });
    }
  }

  return plan;
}
