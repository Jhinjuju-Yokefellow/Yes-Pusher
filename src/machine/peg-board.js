import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export function createPegBoard({
  scene,
  world,
  textures,
  config,
  colors,
  materials,
  addStaticBox,
  addVisualBox,
  neonStrip,
}) {
  function addPegFunnelRail(side) {
    const glassMaterial = new THREE.MeshPhysicalMaterial({
      color: side < 0 ? 0x174a70 : 0x3c267b,
      emissive: side < 0 ? colors.cyan : colors.violet,
      emissiveIntensity: 0.25,
      transparent: true,
      opacity: 0.20,
      roughness: 0.08,
      transmission: 0.52,
      metalness: 0.08,
    });

    const straightHeight = config.peg.sideWallTopY - config.peg.sideWallBottomY;
    addStaticBox({
      size: [0.16, straightHeight, 1.04],
      position: [
        side * config.peg.sideWallX,
        config.peg.sideWallBottomY + straightHeight / 2,
        config.peg.z,
      ],
      material: glassMaterial,
    });

    const lower = new THREE.Vector3(
      side * config.peg.funnelBottomX,
      config.peg.funnelBottomY,
      config.peg.z,
    );
    const upper = new THREE.Vector3(
      side * config.peg.funnelTopX,
      config.peg.funnelTopY,
      config.peg.z,
    );
    const dx = upper.x - lower.x;
    const dy = upper.y - lower.y;
    const length = Math.hypot(dx, dy);
    const angleZ = -Math.atan2(dx, dy);
    const center = lower.clone().add(upper).multiplyScalar(0.5);
    addStaticBox({
      size: [0.16, length, 1.04],
      position: [center.x, center.y, center.z],
      material: glassMaterial,
      rotation: [0, 0, angleZ],
    });
  }

  const panelMaterial = new THREE.MeshStandardMaterial({
    map: textures.pegboard,
    metalness: 0.28,
    roughness: 0.42,
    emissive: 0x0b1435,
    emissiveIntensity: 0.38,
  });
  const panel = new THREE.Mesh(new THREE.BoxGeometry(10.8, 8.35, 0.32), panelMaterial);
  panel.position.set(0, 6.1, -3.92);
  panel.castShadow = true;
  panel.receiveShadow = true;
  scene.add(panel);

  addStaticBox({
    size: [11.0, 8.45, 0.12],
    position: [0, 6.0, -2.64],
    material: new THREE.MeshPhysicalMaterial({
      color: 0x6fdcff,
      transparent: true,
      opacity: 0.055,
      roughness: 0.04,
      transmission: 0.72,
    }),
    visible: true,
  });
  addStaticBox({
    size: [11.0, 8.45, 0.12],
    position: [0, 6.0, -3.60],
    material: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }),
    visible: false,
  });

  addVisualBox({
    size: [0.14, 8.45, 1.12],
    position: [-5.64, 6.0, -3.12],
    material: new THREE.MeshStandardMaterial({
      color: 0x19345b,
      emissive: colors.cyan,
      emissiveIntensity: 0.35,
      metalness: 0.6,
    }),
  });
  addVisualBox({
    size: [0.14, 8.45, 1.12],
    position: [5.64, 6.0, -3.12],
    material: new THREE.MeshStandardMaterial({
      color: 0x26185f,
      emissive: colors.violet,
      emissiveIntensity: 0.35,
      metalness: 0.6,
    }),
  });

  const pegVisualMaterial = new THREE.MeshStandardMaterial({
    color: colors.gold,
    emissive: 0x8f5a00,
    emissiveIntensity: 0.65,
    metalness: 0.92,
    roughness: 0.18,
  });

  for (let row = 0; row < config.peg.rows; row++) {
    const y = config.peg.startY - row * config.peg.spacingY;
    const columns = row < 4 ? (row % 2 ? 7 : 8) : (row === 4 ? 6 : (row === 5 ? 7 : 6));
    for (let column = 0; column < columns; column++) {
      const x = (column - (columns - 1) / 2) * config.peg.spacingX;
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(config.peg.radius, config.peg.radius, 0.8, 24),
        pegVisualMaterial,
      );
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set(x, y, config.peg.z);
      mesh.castShadow = true;
      scene.add(mesh);

      const body = new CANNON.Body({
        mass: 0,
        type: CANNON.Body.STATIC,
        material: materials.peg,
        collisionFilterGroup: 4,
        collisionFilterMask: 1,
      });
      body.addShape(new CANNON.Cylinder(config.peg.radius, config.peg.radius, 0.8, 16));
      body.position.set(x, y, config.peg.z);
      body.quaternion.setFromEuler(Math.PI / 2, 0, 0);
      world.addBody(body);
    }
  }

  const slotHeader = new THREE.Mesh(
    new THREE.BoxGeometry(10.8, 0.78, 1.18),
    new THREE.MeshStandardMaterial({
      color: 0x07111e,
      emissive: colors.cyan,
      emissiveIntensity: 0.3,
      metalness: 0.65,
      roughness: 0.2,
    }),
  );
  slotHeader.position.set(0, 10.45, -3.45);
  scene.add(slotHeader);

  config.slots.forEach((x) => {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.34, 0.055, 10, 28),
      new THREE.MeshStandardMaterial({
        color: colors.cyan,
        emissive: colors.cyan,
        emissiveIntensity: 1.4,
        metalness: 0.5,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 10.32, -2.85);
    scene.add(ring);

    const railMaterial = new THREE.MeshStandardMaterial({
      color: colors.gold,
      metalness: 0.75,
      roughness: 0.2,
    });
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.05, 0.22), railMaterial);
      rail.position.set(x + side * 0.31, 9.82, -3.15);
      rail.rotation.z = side * 0.2;
      scene.add(rail);
    }
  });

  addPegFunnelRail(-1);
  addPegFunnelRail(1);
  neonStrip([0.10, 1.65, 0.10], [-3.72, 2.86, -2.96], colors.cyan);
  neonStrip([0.10, 1.65, 0.10], [3.72, 2.86, -2.96], colors.violet);
}
