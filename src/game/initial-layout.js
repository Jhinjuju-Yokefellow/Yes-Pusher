import {
  CONFIG,
  isNearTowerStack,
  playableHalfWidthAtZ,
} from '../config/machine-config.js';

export const STARTING_BED_ROWS = 11;
export const STARTING_BED_ROW_SPACING = 0.56;
export const STARTING_BED_COLUMN_SPACING = 0.78;
export const STARTING_BED_REAR_Z = -0.50;

/**
 * Returns the approved starting loose-coin layout.
 *
 * The base layer is a close-packed field that stays inside the visible funnel
 * walls. Extra sleeping layers are concentrated on the open left and right
 * payout banks, so ordinary turns build pressure and pay more consistently
 * without burying the center jackpot tower.
 */
export function createStartingBedPlan(random = Math.random) {
  const plan = [];
  const wallClearance = CONFIG.coin.radius + 0.12;

  for (let row = 0; row < STARTING_BED_ROWS; row += 1) {
    const z = STARTING_BED_REAR_Z + row * STARTING_BED_ROW_SPACING;
    const oddRow = row % 2 === 1;
    const halfWidth = playableHalfWidthAtZ(z, wallClearance);

    for (let column = -7; column <= 7; column += 1) {
      const x = (column + (oddRow ? 0.5 : 0)) * STARTING_BED_COLUMN_SPACING;
      if (Math.abs(x) > halfWidth) continue;
      if (isNearTowerStack(x, z, 0.79)) continue;

      const rotationY = random() * Math.PI;
      plan.push({ x, z, layer: 0, rotationY });

      // Build deep, payout-ready side banks while leaving the center tower and
      // its pressure path visible. These layers begin far enough forward that
      // the pusher can work into them instead of trapping them behind guides.
      if (z >= 2.30 && Math.abs(x) >= 1.95) {
        plan.push({ x, z, layer: 1, rotationY: random() * Math.PI });
      }
      if (z >= 3.42 && Math.abs(x) >= 3.10) {
        plan.push({ x, z, layer: 2, rotationY: random() * Math.PI });
      }
    }
  }

  return plan;
}
