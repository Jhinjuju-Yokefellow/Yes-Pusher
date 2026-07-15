import * as THREE from 'three';
import { createRubberDuckMesh } from '../toy-view-patch.js';
import { createCucumberMesh } from '../cucumber-chop-view-patch.js';

function clean(value) {
  return String(value ?? '').trim();
}

function showcaseToyScale(sizeTier) {
  switch (clean(sizeTier).toLowerCase()) {
    case 'medium': return 0.58;
    case 'large': return 0.72;
    case 'huge': return 0.88;
    default: return 0.46;
  }
}

function createShowcaseToyMesh(toy) {
  const toyKey = clean(toy?.toyKey || toy?.craftFamily).toLowerCase();
  let model = null;
  if (toyKey === 'rubber_duck' || toyKey === 'rubber-duck') model = createRubberDuckMesh();
  else if (toyKey === 'cucumber' || toyKey === 'cucumber_slice' || toyKey === 'cucumber-slice') model = createCucumberMesh();
  if (!model) return null;

  const scale = showcaseToyScale(toy?.sizeTier);
  model.scale.setScalar(scale);
  model.name = `owned-toy-showcase-${toyKey}-${clean(toy?.holdingId) || 'holding'}`;
  model.userData.holdingId = clean(toy?.holdingId) || null;
  model.userData.toyKey = toyKey;
  model.userData.sizeTier = clean(toy?.sizeTier).toLowerCase() || 'small';
  model.traverse((child) => {
    if (!child?.isMesh) return;
    child.castShadow = false;
    child.receiveShadow = false;
    child.frustumCulled = false;
  });
  return model;
}

export function createCabinet({
  scene,
  textures,
  config,
  colors,
  boardTopY,
  addStaticBox,
  neonStrip,
  performanceMode = false,
}) {
  const showcasePanels = new Map();

  function makeGlassMaterial(options) {
    if (!performanceMode) return new THREE.MeshPhysicalMaterial(options);
    const { transmission: _transmission, ...lightweight } = options;
    return new THREE.MeshStandardMaterial({ ...lightweight, opacity: Math.min(0.38, options.opacity ?? 0.3) });
  }

  function addBoardFunnelGuide(side) {
    const material = makeGlassMaterial({
      color: side < 0 ? 0x153c62 : 0x35236f,
      emissive: side < 0 ? colors.cyan : colors.violet,
      emissiveIntensity: 0.18,
      transparent: true,
      opacity: 0.34,
      roughness: 0.12,
      transmission: 0.24,
      metalness: 0.18,
    });

    const bayLength = config.funnel.bayFrontZ - config.funnel.bayRearZ;
    addStaticBox({
      size: [0.20, config.funnel.wallHeight, bayLength],
      position: [
        side * config.funnel.bayHalfWidth,
        boardTopY + config.funnel.wallHeight / 2,
        config.funnel.bayRearZ + bayLength / 2,
      ],
      material,
    });

    const start = new THREE.Vector3(
      side * config.funnel.bayHalfWidth,
      boardTopY + config.funnel.wallHeight / 2,
      config.funnel.bayFrontZ,
    );
    const end = new THREE.Vector3(
      side * config.funnel.frontHalfWidth,
      boardTopY + config.funnel.wallHeight / 2,
      config.funnel.frontZ,
    );
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    const angleY = Math.atan2(dx, dz);
    const center = start.clone().add(end).multiplyScalar(0.5);
    addStaticBox({
      size: [0.20, config.funnel.wallHeight, length],
      position: [center.x, center.y, center.z],
      material,
      rotation: [0, angleY, 0],
    });
  }

  function createShowcasePanel(side) {
    const group = new THREE.Group();
    const x = side * 6.15;
    group.position.set(x, 4.45, 0.55);
    group.rotation.y = side * -0.12;
    group.name = side < 0 ? 'owned-toy-showcase-cabinet' : 'machine-showcase-cabinet-right';

    const shell = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 6.2, 7.2),
      new THREE.MeshStandardMaterial({ color: 0x081226, metalness: 0.65, roughness: 0.28 }),
    );
    shell.castShadow = !performanceMode;
    group.add(shell);

    const inset = new THREE.Mesh(
      new THREE.BoxGeometry(1.18, 5.55, 6.42),
      new THREE.MeshStandardMaterial({
        color: 0x030711,
        emissive: side < 0 ? colors.cyan : colors.violet,
        emissiveIntensity: 0.14,
        metalness: 0.35,
        roughness: 0.45,
      }),
    );
    inset.position.x = side * 0.03;
    group.add(inset);

    const displayGroup = new THREE.Group();
    displayGroup.name = side < 0 ? 'owned-toy-showcase-models' : 'showcase-models-right';
    group.add(displayGroup);
    const slots = [];

    for (let row = 0; row < 4; row += 1) {
      const shelfY = -2.05 + row * 1.35;
      const shelf = new THREE.Mesh(
        new THREE.BoxGeometry(1.28, 0.16, 5.92),
        new THREE.MeshStandardMaterial({
          color: colors.gold,
          emissive: colors.gold,
          emissiveIntensity: 0.72,
          metalness: 0.82,
          roughness: 0.18,
        }),
      );
      shelf.position.set(0, shelfY, 0.15);
      group.add(shelf);

      const lip = new THREE.Mesh(
        new THREE.BoxGeometry(0.10, 0.30, 5.92),
        new THREE.MeshStandardMaterial({
          color: 0xd9b755,
          emissive: colors.gold,
          emissiveIntensity: 0.30,
          metalness: 0.72,
          roughness: 0.22,
        }),
      );
      lip.position.set(side * -0.60, shelfY + 0.08, 0.15);
      group.add(lip);

      for (let col = 0; col < 3; col += 1) {
        const z = -1.70 + col * 1.85;
        const halo = new THREE.Mesh(
          new THREE.TorusGeometry(0.31, 0.026, 8, 24),
          new THREE.MeshStandardMaterial({
            color: 0x4e658d,
            emissive: side < 0 ? colors.cyan : colors.violet,
            emissiveIntensity: 0.42,
          }),
        );
        halo.rotation.y = Math.PI / 2;
        halo.position.set(side * -0.48, shelfY + 0.50, z);
        group.add(halo);
        slots.push({
          position: new THREE.Vector3(side * -0.40, shelfY + 0.29, z),
          rotationY: side < 0 ? Math.PI / 2 : -Math.PI / 2,
        });
      }
    }

    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(0.055, 5.45, 6.22),
      makeGlassMaterial({
        color: side < 0 ? 0x7cd8ea : 0xb28aff,
        transparent: true,
        opacity: 0.11,
        roughness: 0.08,
        transmission: 0.48,
        metalness: 0.02,
      }),
    );
    glass.position.set(side * -0.61, -0.02, 0.12);
    group.add(glass);

    const title = new THREE.Mesh(
      new THREE.BoxGeometry(1.24, 0.46, 5.8),
      new THREE.MeshStandardMaterial({
        color: 0x0b2034,
        emissive: side < 0 ? colors.cyan : colors.violet,
        emissiveIntensity: 0.45,
        metalness: 0.4,
      }),
    );
    title.position.set(side * -0.02, 2.48, 0);
    group.add(title);
    scene.add(group);

    const panel = { side, group, displayGroup, slots };
    showcasePanels.set(side, panel);
    return panel;
  }

  function renderOwnedToyShowcase(rawToys = []) {
    const panel = showcasePanels.get(-1);
    if (!panel) return;
    panel.displayGroup.clear();

    const toys = Array.isArray(rawToys) ? rawToys : [];
    let slotIndex = 0;
    for (const toy of toys) {
      const copies = Math.max(1, Math.floor(Number(toy?.quantity) || 1));
      for (let copy = 0; copy < copies && slotIndex < panel.slots.length; copy += 1) {
        const model = createShowcaseToyMesh(toy);
        if (!model) break;
        const slot = panel.slots[slotIndex];
        model.position.copy(slot.position);
        model.rotation.y = slot.rotationY;
        model.userData.showcaseSlot = slotIndex;
        panel.displayGroup.add(model);
        slotIndex += 1;
      }
      if (slotIndex >= panel.slots.length) break;
    }
  }

  const boardMaterial = new THREE.MeshStandardMaterial({ color: 0x10192b, metalness: 0.45, roughness: 0.39 });
  addStaticBox({
    size: [config.board.width, 0.42, config.board.depth],
    position: [0, config.board.y, config.board.z],
    material: boardMaterial,
  });

  const under = new THREE.Mesh(
    new THREE.BoxGeometry(12.5, 1.6, 10.2),
    new THREE.MeshStandardMaterial({ color: 0x050912, metalness: 0.6, roughness: 0.3 }),
  );
  under.position.set(0, -0.35, 0.75);
  under.castShadow = !performanceMode;
  scene.add(under);

  const frontArt = new THREE.Mesh(
    new THREE.BoxGeometry(12.4, 2.6, 0.42),
    new THREE.MeshStandardMaterial({
      map: textures.cabinet,
      metalness: 0.32,
      roughness: 0.32,
      emissive: 0x0a0715,
      emissiveIntensity: 0.26,
    }),
  );
  frontArt.position.set(0, boardTopY - 1.42, config.board.front - 0.28);
  frontArt.castShadow = !performanceMode;
  scene.add(frontArt);

  const sideMaterial = new THREE.MeshStandardMaterial({
    map: textures.cabinet,
    metalness: 0.4,
    roughness: 0.34,
    emissive: 0x070314,
    emissiveIntensity: 0.2,
  });
  const leftRail = new THREE.Mesh(new THREE.BoxGeometry(1.15, 2.25, 10.4), sideMaterial);
  leftRail.position.set(-6.15, 1.45, 0.65);
  leftRail.castShadow = !performanceMode;
  scene.add(leftRail);
  const rightRail = leftRail.clone();
  rightRail.position.x = 6.15;
  scene.add(rightRail);

  addStaticBox({
    size: [0.34, 2.0, 10.1],
    position: [-5.75, 1.55, 0.7],
    material: makeGlassMaterial({
      color: 0x0a2442,
      transparent: true,
      opacity: 0.25,
      roughness: 0.1,
      metalness: 0.05,
    }),
    visible: true,
  });
  addStaticBox({
    size: [0.34, 2.0, 10.1],
    position: [5.75, 1.55, 0.7],
    material: makeGlassMaterial({
      color: 0x29185b,
      transparent: true,
      opacity: 0.23,
      roughness: 0.1,
      metalness: 0.05,
    }),
    visible: true,
  });

  neonStrip([0.12, 0.12, 10.5], [-5.48, 2.57, 0.55], colors.gold);
  neonStrip([0.12, 0.12, 10.5], [5.48, 2.57, 0.55], colors.gold);
  neonStrip([11.1, 0.1, 0.12], [0, boardTopY + 0.02, config.board.front + 0.02], colors.cyan);

  addStaticBox({
    size: [0.28, 0.72, 9.1],
    position: [-5.64, 1.02, 0.75],
    material: new THREE.MeshStandardMaterial({ color: 0x152847, metalness: 0.65, roughness: 0.22 }),
  });
  addStaticBox({
    size: [0.28, 0.72, 9.1],
    position: [5.64, 1.02, 0.75],
    material: new THREE.MeshStandardMaterial({ color: 0x152847, metalness: 0.65, roughness: 0.22 }),
  });

  addBoardFunnelGuide(-1);
  addBoardFunnelGuide(1);

  createShowcasePanel(-1);
  createShowcasePanel(1);

  const publish = (event) => renderOwnedToyShowcase(event?.detail?.toys);
  globalThis.addEventListener?.('yes-pusher:toy-inventory', publish);
  renderOwnedToyShowcase(globalThis.__yesPusherOwnedToys);

  return {
    showcasePanels,
    renderOwnedToyShowcase,
  };
}

export { createShowcaseToyMesh, showcaseToyScale };
