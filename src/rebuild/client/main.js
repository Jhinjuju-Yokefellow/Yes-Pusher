import * as THREE from 'three';
import './styles.css';
import { CONFIG } from '../../config/machine-config.js';
import { COIN_SKINS, getCoinSkin } from '../../config/skin-catalog.js';

const canvas = document.querySelector('#rebuildCanvas');
const connectionStatus = document.querySelector('#connectionStatus');
const activePlayer = document.querySelector('#activePlayer');
const queueCount = document.querySelector('#queueCount');
const objectCount = document.querySelector('#objectCount');
const completedPlays = document.querySelector('#completedPlays');
const coinsInput = document.querySelector('#coinsInput');
const skinSelect = document.querySelector('#skinSelect');
const dropButton = document.querySelector('#dropButton');
const eventLog = document.querySelector('#eventLog');

const playerId = localStorage.getItem('yes-pusher-rebuild-player')
  || `browser-${crypto.randomUUID()}`;
localStorage.setItem('yes-pusher-rebuild-player', playerId);

for (const option of [
  { id: 'starter', name: 'Starter YES Coin' },
  ...COIN_SKINS,
]) {
  const element = document.createElement('option');
  element.value = option.id;
  element.textContent = option.name;
  skinSelect.appendChild(element);
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x03050b);
scene.fog = new THREE.FogExp2(0x060913, 0.018);

const camera = new THREE.PerspectiveCamera(44, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 10.6, 18.5);
camera.lookAt(0, 4.2, -0.8);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.25));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

scene.add(new THREE.HemisphereLight(0xa9dcff, 0x130b28, 2.1));
const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
keyLight.position.set(4, 13, 9);
scene.add(keyLight);

function box(size, position, material, name = '') {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.name = name;
  scene.add(mesh);
  return mesh;
}

const darkMetal = new THREE.MeshStandardMaterial({ color: 0x0a1222, metalness: 0.72, roughness: 0.3 });
const blueGlass = new THREE.MeshStandardMaterial({
  color: 0x174a72,
  emissive: 0x0b7598,
  emissiveIntensity: 0.2,
  transparent: true,
  opacity: 0.28,
  metalness: 0.2,
  roughness: 0.14,
});
const gold = new THREE.MeshStandardMaterial({
  color: 0xd8ad38,
  emissive: 0x6c4b00,
  emissiveIntensity: 0.38,
  metalness: 0.84,
  roughness: 0.2,
});

box([CONFIG.board.width, 0.42, CONFIG.board.depth], [0, CONFIG.board.y, CONFIG.board.z], darkMetal, 'board');
box([12.6, 1.7, 10.5], [0, -0.4, 0.7], darkMetal, 'base');
box([11.4, 8.7, 0.2], [0, 6.0, CONFIG.peg.z - 0.52], blueGlass, 'pegboard');
box([0.35, 8.6, 1.2], [-5.7, 6.0, CONFIG.peg.z], darkMetal, 'left-rail');
box([0.35, 8.6, 1.2], [5.7, 6.0, CONFIG.peg.z], darkMetal, 'right-rail');
box([1.2, 6.2, 7.2], [-6.2, 4.45, 0.55], darkMetal, 'left-showcase');
box([1.2, 6.2, 7.2], [6.2, 4.45, 0.55], darkMetal, 'right-showcase');

for (const side of [-1, 1]) {
  for (let row = 0; row < 4; row += 1) {
    box([1.26, 0.13, 5.9], [side * 6.2, 2.4 + row * 1.35, 0.7], gold, `showcase-shelf-${side}-${row}`);
  }
}

const pegGeometry = new THREE.CylinderGeometry(CONFIG.peg.radius, CONFIG.peg.radius, 0.8, 12);
const pegMaterial = new THREE.MeshStandardMaterial({
  color: 0x67d9ff,
  emissive: 0x147594,
  emissiveIntensity: 0.4,
  metalness: 0.65,
  roughness: 0.24,
});
for (let row = 0; row < CONFIG.peg.rows; row += 1) {
  const y = CONFIG.peg.startY - row * CONFIG.peg.spacingY;
  const columns = row < 4 ? (row % 2 ? 7 : 8) : (row === 4 ? 6 : (row === 5 ? 7 : 6));
  for (let column = 0; column < columns; column += 1) {
    const x = (column - (columns - 1) / 2) * CONFIG.peg.spacingX;
    const peg = new THREE.Mesh(pegGeometry, pegMaterial);
    peg.position.set(x, y, CONFIG.peg.z);
    peg.rotation.x = Math.PI / 2;
    scene.add(peg);
  }
}

const pusher = box(
  [CONFIG.pusher.width, CONFIG.pusher.shelfThickness, CONFIG.pusher.depth],
  [0, CONFIG.pusher.y, CONFIG.pusher.rearZ],
  new THREE.MeshStandardMaterial({ color: 0x263653, metalness: 0.78, roughness: 0.24 }),
  'pusher',
);
let targetPusherZ = CONFIG.pusher.rearZ;

const coinGeometry = new THREE.CylinderGeometry(CONFIG.coin.radius, CONFIG.coin.radius, CONFIG.coin.thickness, 18);
const materialCache = new Map();
const textureLoader = new THREE.TextureLoader();

function coinMaterials(visualKey) {
  const key = String(visualKey || 'starter');
  if (materialCache.has(key)) return materialCache.get(key);

  const edge = new THREE.MeshStandardMaterial({ color: 0xd39217, metalness: 0.9, roughness: 0.2 });
  const face = new THREE.MeshStandardMaterial({ color: 0xf0c552, metalness: 0.45, roughness: 0.3 });
  const materials = [edge, face, face];
  materialCache.set(key, materials);

  const skin = getCoinSkin(key);
  const url = skin?.imageUrl || (key === 'starter' ? '/assets/coin-face.svg' : '');
  if (url) {
    textureLoader.load(url, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      face.map = texture;
      face.color.set(0xffffff);
      face.needsUpdate = true;
    });
  }
  return materials;
}

const objects = new Map();
let lastSequence = 0;

function addEventLine(text) {
  const row = document.createElement('div');
  row.textContent = text;
  eventLog.prepend(row);
  while (eventLog.children.length > 12) eventLog.lastElementChild.remove();
}

function ensureObject(object) {
  let view = objects.get(object.id);
  if (!view) {
    const mesh = new THREE.Mesh(coinGeometry, coinMaterials(object.visualKey));
    mesh.position.fromArray(object.position);
    mesh.quaternion.fromArray(object.quaternion);
    scene.add(mesh);
    view = {
      mesh,
      visualKey: object.visualKey,
      targetPosition: new THREE.Vector3().fromArray(object.position),
      targetQuaternion: new THREE.Quaternion().fromArray(object.quaternion),
    };
    objects.set(object.id, view);
  }
  if (view.visualKey !== object.visualKey) {
    view.visualKey = object.visualKey;
    view.mesh.material = coinMaterials(object.visualKey);
  }
  view.targetPosition.fromArray(object.position);
  view.targetQuaternion.fromArray(object.quaternion);
}

function removeObject(id) {
  const view = objects.get(id);
  if (!view) return;
  scene.remove(view.mesh);
  objects.delete(id);
}

function applyPacket(packet, boundary = false) {
  if (!packet || packet.protocol !== 1 || packet.sequence <= lastSequence) return;
  lastSequence = packet.sequence;
  targetPusherZ = Number(packet.pusherZ) || CONFIG.pusher.rearZ;

  const incoming = new Set();
  for (const object of packet.objects || []) {
    incoming.add(object.id);
    ensureObject(object);
  }
  if (boundary) {
    for (const id of objects.keys()) {
      if (!incoming.has(id)) removeObject(id);
    }
  }
  for (const id of packet.removed || []) removeObject(id);

  activePlayer.textContent = packet.activePlay?.playerId || 'NONE';
  queueCount.textContent = String(packet.queue?.pending?.length || 0);
  objectCount.textContent = String(objects.size);
  completedPlays.textContent = String(packet.completedPlays || 0);

  for (const event of packet.events || []) {
    if (event.type === 'object-spawned') addEventLine(`SPAWN ${event.objectId} • ${event.visualKey}`);
    else if (event.type === 'play-started') addEventLine(`START ${event.playId} • ${event.playerId}`);
    else if (event.type === 'play-completed') addEventLine(`COMPLETE ${event.playId} • ${event.coinsWon} WON`);
    else if (event.type === 'coin-payout') addEventLine(`PAYOUT ${event.objectId}`);
  }
}

function connect() {
  connectionStatus.textContent = 'CONNECTING';
  const source = new EventSource('/api/rebuild/events');
  source.addEventListener('open', () => {
    connectionStatus.textContent = 'LIVE ON RAILWAY';
  });
  source.addEventListener('boundary', (event) => {
    applyPacket(JSON.parse(event.data), true);
  });
  source.addEventListener('frame', (event) => {
    applyPacket(JSON.parse(event.data), false);
  });
  source.addEventListener('error', () => {
    connectionStatus.textContent = 'RECONNECTING';
  });
}

async function drop() {
  dropButton.disabled = true;
  dropButton.textContent = 'SENDING';
  try {
    const response = await fetch('/api/rebuild/drop', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: `play-${crypto.randomUUID()}`,
        playerId,
        coins: Number(coinsInput.value),
        visualKey: skinSelect.value,
      }),
    });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `DROP failed (${response.status})`);
    addEventLine(`ACCEPTED ${payload.play.id}`);
  } catch (error) {
    addEventLine(error instanceof Error ? error.message : String(error));
  } finally {
    dropButton.disabled = false;
    dropButton.textContent = 'DROP COINS';
  }
}

dropButton.addEventListener('click', () => void drop());

let lastTime = performance.now();
function animate(now = performance.now()) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  const blend = 1 - Math.exp(-14 * dt);
  pusher.position.z += (targetPusherZ - pusher.position.z) * blend;
  for (const view of objects.values()) {
    view.mesh.position.lerp(view.targetPosition, blend);
    view.mesh.quaternion.slerp(view.targetQuaternion, blend);
  }
  renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

connect();
animate();
