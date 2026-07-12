export const CONFIG = {
  board: { width: 11.6, depth: 9.2, y: 0.55, z: 0.85, front: 5.45, back: -3.75 },
  pusher: {
    width: 6.6,
    depth: 3.05,
    shelfThickness: 0.34,
    y: 0.87,
    wallZ: -3.45,
    rearZ: -4.98,
    frontZ: -1.86,
    period: 6.8,
  },
  funnel: {
    bayHalfWidth: 3.38,
    bayRearZ: -3.26,
    bayFrontZ: -0.70,
    frontHalfWidth: 5.34,
    frontZ: 1.28,
    wallHeight: 0.92,
  },
  coin: { radius: 0.34, thickness: 0.105, mass: 0.075 },
  dropIntervalMs: 2000,
  peg: {
    rows: 7,
    columns: 8,
    radius: 0.11,
    startY: 9.15,
    spacingY: 0.94,
    spacingX: 1.18,
    z: -3.12,
    exitY: 3.02,
    sideWallX: 5.36,
    sideWallTopY: 9.72,
    sideWallBottomY: 3.28,
    funnelTopY: 3.28,
    funnelBottomY: 2.18,
    funnelTopX: 5.36,
    funnelBottomX: 3.66,
  },
  slots: [-3.54, -2.36, -1.18, 0, 1.18, 2.36, 3.54],
};

export const TOWER_LAYOUT = [];

export const TOWER_STACK_OFFSETS = [
  [0, 0],
  [-1, 0], [1, 0],
  [0, -1], [0, 1],
  [-1, -1], [1, -1],
  [-1, 1], [1, 1],
];



export function playableHalfWidthAtZ(z, clearance = 0) {
  let halfWidth;
  if (z <= CONFIG.funnel.bayFrontZ) {
    halfWidth = CONFIG.funnel.bayHalfWidth;
  } else if (z < CONFIG.funnel.frontZ) {
    const progress = (z - CONFIG.funnel.bayFrontZ)
      / (CONFIG.funnel.frontZ - CONFIG.funnel.bayFrontZ);
    halfWidth = CONFIG.funnel.bayHalfWidth
      + (CONFIG.funnel.frontHalfWidth - CONFIG.funnel.bayHalfWidth) * progress;
  } else {
    halfWidth = CONFIG.funnel.frontHalfWidth;
  }
  return Math.max(0, halfWidth - Math.max(0, clearance));
}

export const COLORS = {
  navy: 0x081224,
  black: 0x02050b,
  cyan: 0x57e8ff,
  violet: 0x845ef7,
  gold: 0xffd35a,
  green: 0x43ed9e,
  steel: 0x54657b,
};

export function isNearTowerStack(x, z, clearance = 0.75) {
  const spacing = CONFIG.coin.radius * 2 + 0.045;
  return TOWER_LAYOUT.some((tower) => TOWER_STACK_OFFSETS.some(([sx, sz]) =>
    Math.hypot(
      x - (tower.x + sx * spacing),
      z - (tower.z + sz * spacing),
    ) < clearance
  ));
}
