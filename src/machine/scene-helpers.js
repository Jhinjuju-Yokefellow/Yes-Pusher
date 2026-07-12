import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export function createSceneHelpers({ scene, world, materials }) {
  function addLightRig(colors) {
    scene.add(new THREE.HemisphereLight(0x90b8ff, 0x080512, 1.5));

    const key = new THREE.DirectionalLight(0xffffff, 2.7);
    key.position.set(2, 13, 10);
    key.castShadow = true;
    key.shadow.mapSize.set(1536, 1536);
    key.shadow.camera.left = -12;
    key.shadow.camera.right = 12;
    key.shadow.camera.top = 14;
    key.shadow.camera.bottom = -4;
    scene.add(key);

    const cyan = new THREE.PointLight(colors.cyan, 55, 19, 2);
    cyan.position.set(-6, 4, 3);
    scene.add(cyan);

    const violet = new THREE.PointLight(colors.violet, 46, 19, 2);
    violet.position.set(6, 5, -1);
    scene.add(violet);

    const gold = new THREE.PointLight(colors.gold, 25, 12, 2);
    gold.position.set(0, 8, -4);
    scene.add(gold);
  }

  function addStaticBox({
    size,
    position,
    material,
    physicsMaterial = materials.board,
    visible = true,
    collisionGroup = 4,
    collisionMask = 1,
    rotation = null,
  }) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.visible = visible;
    if (rotation) mesh.rotation.set(...rotation);
    scene.add(mesh);

    const body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      material: physicsMaterial,
      collisionFilterGroup: collisionGroup,
      collisionFilterMask: collisionMask,
    });
    body.addShape(new CANNON.Box(new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2)));
    body.position.set(...position);
    if (rotation) body.quaternion.setFromEuler(...rotation);
    world.addBody(body);

    return { mesh, body };
  }

  function neonStrip(size, position, color, rotation = null) {
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 3.2,
      metalness: 0.2,
      roughness: 0.25,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation);
    scene.add(mesh);
    return mesh;
  }

  function addVisualBox({ size, position, material, rotation = null }) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }

  return { addLightRig, addStaticBox, neonStrip, addVisualBox };
}
