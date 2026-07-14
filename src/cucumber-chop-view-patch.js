import * as THREE from 'three';
import { CONFIG } from './config/machine-config.js';
import { SharedWorldView } from './network/shared-world-view.js';

export const CUCUMBER_SLICE_TOY_KEY = 'cucumber_slice';
const EFFECT_DURATION_MS = 2350;
const CHOP_START_MS = 520;
const COIN_BURST_MS = 980;

const cucumberGeometry = Object.freeze({
  body: new THREE.CylinderGeometry(0.29, 0.31, 1.30, 18, 1),
  end: new THREE.SphereGeometry(0.30, 18, 12),
  spot: new THREE.SphereGeometry(0.045, 10, 8),
  slice: new THREE.CylinderGeometry(0.30, 0.30, 0.12, 20, 1),
  seed: new THREE.SphereGeometry(0.025, 8, 6),
});

const cucumberMaterials = Object.freeze({
  skin: new THREE.MeshStandardMaterial({ color: 0x2f9b45, roughness: 0.62, metalness: 0 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x15662e, roughness: 0.72, metalness: 0 }),
  flesh: new THREE.MeshStandardMaterial({ color: 0xbfe477, roughness: 0.58, metalness: 0 }),
  seed: new THREE.MeshStandardMaterial({ color: 0xf3f0b8, roughness: 0.76, metalness: 0 }),
});

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function mesh(geometry, material, position = [0, 0, 0], scale = null) {
  const value = new THREE.Mesh(geometry, material);
  value.position.set(...position);
  if (scale) value.scale.set(...scale);
  value.castShadow = false;
  value.receiveShadow = false;
  value.frustumCulled = false;
  return value;
}

export function createCucumberMesh() {
  const group = new THREE.Group();
  group.name = 'shared-world-cucumber-slice-toy';

  const body = mesh(cucumberGeometry.body, cucumberMaterials.skin);
  body.rotation.z = Math.PI / 2;
  group.add(body);
  group.add(mesh(cucumberGeometry.end, cucumberMaterials.dark, [-0.64, 0, 0], [0.90, 0.90, 0.90]));
  group.add(mesh(cucumberGeometry.end, cucumberMaterials.skin, [0.64, 0, 0]));

  const spots = [
    [-0.44, 0.19, 0.10], [-0.17, -0.22, 0.07], [0.10, 0.20, -0.10],
    [0.34, -0.18, -0.08], [0.48, 0.13, 0.11], [-0.31, 0.02, -0.24],
  ];
  for (const position of spots) group.add(mesh(cucumberGeometry.spot, cucumberMaterials.dark, position, [1.25, 0.55, 0.55]));
  return group;
}

function createSlice(index, count) {
  const group = new THREE.Group();
  const disk = mesh(cucumberGeometry.slice, cucumberMaterials.flesh);
  disk.rotation.z = Math.PI / 2;
  group.add(disk);
  const rind = new THREE.Mesh(
    new THREE.TorusGeometry(0.30, 0.025, 8, 24),
    cucumberMaterials.dark,
  );
  rind.rotation.y = Math.PI / 2;
  rind.castShadow = false;
  rind.receiveShadow = false;
  group.add(rind);
  for (let seedIndex = 0; seedIndex < 5; seedIndex += 1) {
    const angle = (seedIndex / 5) * Math.PI * 2 + index * 0.22;
    group.add(mesh(cucumberGeometry.seed, cucumberMaterials.seed, [0, Math.cos(angle) * 0.12, Math.sin(angle) * 0.12]));
  }
  group.position.x = (index - (count - 1) / 2) * 0.16;
  group.visible = false;
  return group;
}

function createRewardLabel(rewardCoins) {
  if (typeof document === 'undefined') return null;
  const label = document.createElement('div');
  label.textContent = `CUCUMBER CHOP  +${rewardCoins} YES`;
  Object.assign(label.style, {
    position: 'fixed',
    left: '50%',
    top: '57%',
    zIndex: '30',
    transform: 'translate(-50%, 22px) scale(.92)',
    opacity: '0',
    padding: '10px 16px',
    borderRadius: '999px',
    border: '1px solid rgba(190, 238, 119, .78)',
    background: 'rgba(8, 30, 17, .92)',
    color: '#dfff9a',
    font: '800 13px/1.1 ui-monospace, SFMono-Regular, Menlo, monospace',
    letterSpacing: '.08em',
    pointerEvents: 'none',
    boxShadow: '0 12px 40px rgba(32, 163, 71, .28)',
    transition: 'none',
  });
  document.body.appendChild(label);
  return label;
}

function audioContextFor(view) {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!view.cucumberAudioContext) view.cucumberAudioContext = new AudioContextClass();
  return view.cucumberAudioContext;
}

async function playCucumberChop(view) {
  try {
    const context = audioContextFor(view);
    if (!context) return;
    if (context.state !== 'running') await context.resume();
    const start = context.currentTime + 0.02;
    for (let index = 0; index < 4; index += 1) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const at = start + index * 0.085;
      oscillator.type = index === 3 ? 'triangle' : 'square';
      oscillator.frequency.setValueAtTime(index === 3 ? 920 : 220 + index * 45, at);
      oscillator.frequency.exponentialRampToValueAtTime(index === 3 ? 1440 : 105, at + 0.06);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(index === 3 ? 0.18 : 0.10, at + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.10);
    }
  } catch {
    // The authoritative reward still completes when browser audio is blocked.
  }
}

function installCucumberChopViewPatch() {
  const prototype = SharedWorldView.prototype;
  if (prototype.cucumberChopViewPatchInstalled) return;

  const createToyRenderState = prototype.createToyRenderState;
  const emitReplayEventsThrough = prototype.emitReplayEventsThrough;
  const update = prototype.update;
  const clear = prototype.clear;

  prototype.createToyRenderState = function createToyRenderStateWithCucumber(state) {
    const renderState = createToyRenderState.call(this, state);
    if (state?.toyKey !== CUCUMBER_SLICE_TOY_KEY) return renderState;
    this.scene.remove(renderState.mesh);
    renderState.mesh = createCucumberMesh();
    renderState.mesh.userData.toyId = state.id;
    renderState.mesh.userData.toyKey = state.toyKey;
    this.scene.add(renderState.mesh);
    return renderState;
  };

  prototype.ensureCucumberChopView = function ensureCucumberChopView() {
    if (!Array.isArray(this.cucumberChopEffects)) this.cucumberChopEffects = [];
  };

  prototype.startCucumberChopVisual = function startCucumberChopVisual(event) {
    this.ensureCucumberChopView();
    const rewardCoins = Math.max(6, Math.min(10, Math.floor(Number(event?.rewardCoins) || 6)));
    const rawPosition = Array.isArray(event?.position) && event.position.length === 3
      ? event.position
      : [0, CONFIG.board.y + 0.42, CONFIG.board.front + 0.12];
    const origin = new THREE.Vector3(
      Number(rawPosition[0]) || 0,
      Math.max(CONFIG.board.y + 0.82, Number(rawPosition[1]) || 0),
      Number(rawPosition[2]) || CONFIG.board.front + 0.12,
    );

    const cucumber = createCucumberMesh();
    cucumber.position.set(origin.x, origin.y - 1.65, origin.z + 0.35);
    cucumber.rotation.y = Math.PI * 0.08;
    cucumber.scale.setScalar(0.90);
    this.scene.add(cucumber);

    const slices = Array.from({ length: 7 }, (_, index) => createSlice(index, 7));
    for (const slice of slices) {
      slice.position.add(origin);
      slice.position.y += 0.18;
      slice.position.z += 0.18;
      this.scene.add(slice);
    }

    const coins = Array.from({ length: rewardCoins }, (_, index) => {
      const coin = new THREE.Mesh(this.coinGeometry, this.coinMaterials);
      coin.castShadow = false;
      coin.receiveShadow = false;
      coin.frustumCulled = false;
      coin.visible = false;
      coin.position.copy(origin);
      coin.userData.rewardIndex = index;
      this.scene.add(coin);
      return coin;
    });

    const effect = {
      id: event?.id ?? `${event?.turnId ?? 'turn'}:${event?.toyId ?? 'cucumber'}:${nowMs()}`,
      startedAt: nowMs(),
      origin,
      rewardCoins,
      cucumber,
      slices,
      coins,
      label: createRewardLabel(rewardCoins),
      soundPlayed: false,
    };
    this.cucumberChopEffects.push(effect);
  };

  prototype.updateCucumberChopVisuals = function updateCucumberChopVisuals() {
    this.ensureCucumberChopView();
    const current = nowMs();
    const survivors = [];

    for (const effect of this.cucumberChopEffects) {
      const elapsed = current - effect.startedAt;
      const rise = Math.max(0, Math.min(1, elapsed / CHOP_START_MS));
      effect.cucumber.position.set(
        effect.origin.x,
        effect.origin.y - 1.65 + (1 - (1 - rise) ** 3) * 1.72,
        effect.origin.z + 0.35 - rise * 0.24,
      );
      effect.cucumber.rotation.z = Math.sin(elapsed / 80) * 0.10 * rise;
      effect.cucumber.scale.set(0.90 + rise * 0.12, 0.90 - Math.sin(rise * Math.PI) * 0.10, 0.90 + rise * 0.12);

      if (elapsed >= CHOP_START_MS && !effect.soundPlayed) {
        effect.soundPlayed = true;
        void playCucumberChop(this);
      }

      const sliceProgress = Math.max(0, Math.min(1, (elapsed - CHOP_START_MS) / (COIN_BURST_MS - CHOP_START_MS)));
      const showSlices = elapsed >= CHOP_START_MS && elapsed < COIN_BURST_MS;
      effect.cucumber.visible = elapsed < CHOP_START_MS + 120;
      for (let index = 0; index < effect.slices.length; index += 1) {
        const slice = effect.slices[index];
        slice.visible = showSlices;
        slice.position.set(
          effect.origin.x + (index - 3) * (0.16 + sliceProgress * 0.10),
          effect.origin.y + 0.16 + Math.sin((index + 1) * 1.4) * sliceProgress * 0.10,
          effect.origin.z + 0.18,
        );
        slice.rotation.x = sliceProgress * (index % 2 ? 0.18 : -0.18);
      }

      const coinProgress = Math.max(0, Math.min(1, (elapsed - COIN_BURST_MS) / 950));
      for (let index = 0; index < effect.coins.length; index += 1) {
        const coin = effect.coins[index];
        coin.visible = elapsed >= COIN_BURST_MS;
        if (!coin.visible) continue;
        const angle = -Math.PI * 0.88 + (index / Math.max(1, effect.coins.length - 1)) * Math.PI * 0.76;
        const spread = 0.55 + index * 0.035;
        const lift = Math.sin(coinProgress * Math.PI) * (1.15 + (index % 3) * 0.12);
        coin.position.set(
          effect.origin.x + Math.cos(angle) * spread * coinProgress,
          effect.origin.y + 0.20 + lift,
          effect.origin.z + 0.12 + Math.sin(angle) * spread * 0.30 * coinProgress,
        );
        coin.rotation.set(Math.PI / 2 + coinProgress * 2.2, angle, coinProgress * (index % 2 ? 3.5 : -3.5));
        const scale = elapsed > 1900 ? Math.max(0, 1 - (elapsed - 1900) / 430) : 0.82;
        coin.scale.setScalar(scale);
      }

      if (effect.label) {
        const labelIn = Math.max(0, Math.min(1, (elapsed - COIN_BURST_MS) / 180));
        const labelOut = elapsed > 1950 ? Math.max(0, 1 - (elapsed - 1950) / 350) : 1;
        effect.label.style.opacity = String(labelIn * labelOut);
        effect.label.style.transform = `translate(-50%, ${22 - labelIn * 42}px) scale(${0.92 + labelIn * 0.08})`;
      }

      if (elapsed < EFFECT_DURATION_MS) {
        survivors.push(effect);
        continue;
      }
      this.scene.remove(effect.cucumber);
      for (const slice of effect.slices) this.scene.remove(slice);
      for (const coin of effect.coins) this.scene.remove(coin);
      effect.label?.remove?.();
    }
    this.cucumberChopEffects = survivors;
  };

  prototype.emitReplayEventsThrough = function emitReplayEventsWithCucumberChop(elapsedSeconds) {
    const previouslyEmitted = new Set(this.emittedReplayEvents ?? []);
    const result = emitReplayEventsThrough.call(this, elapsedSeconds);
    for (const event of this.replayPackage?.events ?? []) {
      if (previouslyEmitted.has(event.id) || !this.emittedReplayEvents?.has?.(event.id)) continue;
      if (event.type === 'toy-payout' && event.toyKey === CUCUMBER_SLICE_TOY_KEY) {
        this.startCucumberChopVisual(event);
      }
    }
    return result;
  };

  prototype.update = function updateWorldWithCucumberChop(...args) {
    const result = update.apply(this, args);
    this.updateCucumberChopVisuals();
    return result;
  };

  prototype.clear = function clearWorldWithCucumberChop(...args) {
    this.ensureCucumberChopView();
    for (const effect of this.cucumberChopEffects) {
      this.scene.remove(effect.cucumber);
      for (const slice of effect.slices) this.scene.remove(slice);
      for (const coin of effect.coins) this.scene.remove(coin);
      effect.label?.remove?.();
    }
    this.cucumberChopEffects = [];
    return clear.apply(this, args);
  };

  Object.defineProperty(prototype, 'cucumberChopViewPatchInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

installCucumberChopViewPatch();

export {
  installCucumberChopViewPatch,
  playCucumberChop,
};
