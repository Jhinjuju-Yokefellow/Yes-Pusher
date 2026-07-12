import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export function createPusher({
  scene,
  world,
  config,
  materials,
  colors,
  pusherTopY,
  addStaticBox,
}) {
  const slabMaterial = new THREE.MeshStandardMaterial({
    color: 0x172943,
    metalness: 0.82,
    roughness: 0.17,
    emissive: 0x102c50,
    emissiveIntensity: 0.42,
  });
  const topMaterial = new THREE.MeshStandardMaterial({
    color: 0x294a70,
    metalness: 0.78,
    roughness: 0.15,
    emissive: 0x17466f,
    emissiveIntensity: 0.40,
  });
  const frontMaterial = new THREE.MeshStandardMaterial({
    color: 0x294a70,
    emissive: colors.cyan,
    emissiveIntensity: 0.22,
    metalness: 0.80,
    roughness: 0.16,
  });

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(config.pusher.width, config.pusher.shelfThickness, config.pusher.depth),
    [slabMaterial, slabMaterial, topMaterial, slabMaterial, frontMaterial, slabMaterial],
  );
  mesh.position.set(0, config.pusher.y, config.pusher.rearZ);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const body = new CANNON.Body({
    mass: 0,
    type: CANNON.Body.KINEMATIC,
    material: materials.pusher,
    collisionFilterGroup: 2,
    collisionFilterMask: 1,
  });
  body.addShape(new CANNON.Box(new CANNON.Vec3(
    config.pusher.width / 2,
    config.pusher.shelfThickness / 2,
    config.pusher.depth / 2,
  )));
  body.position.set(0, config.pusher.y, config.pusher.rearZ);
  world.addBody(body);

  const pusher = {
    mesh,
    body,
    lastZ: config.pusher.rearZ,
    z: config.pusher.rearZ,
    velocity: 0,
    pushing: false,
  };

  const wallBottomY = pusherTopY + 0.014;
  addStaticBox({
    size: [config.pusher.width + 0.46, 4.0, 0.30],
    position: [0, wallBottomY + 2.0, config.pusher.wallZ],
    material: new THREE.MeshStandardMaterial({
      color: 0x0a1221,
      metalness: 0.68,
      roughness: 0.25,
      emissive: 0x101c42,
      emissiveIntensity: 0.24,
    }),
    collisionGroup: 4,
    collisionMask: 1,
  });

  return pusher;
}
