import * as THREE from 'three';
import { CONFIG } from './config/machine-config.js';
import { SharedWorldView } from './network/shared-world-view.js';
import { createRubberDuckMesh } from './toy-view-patch.js';

const RUBBER_DUCK_TOY_KEY = 'rubber_duck';
const EFFECT_DURATION_MS = 1550;
const RING_DELAYS_MS = Object.freeze([170, 300, 430]);

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function audioContextFor(view) {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!view.squeakAudioContext) view.squeakAudioContext = new AudioContextClass();
  return view.squeakAudioContext;
}

async function unlockSqueakAudio(view) {
  try {
    const context = audioContextFor(view);
    if (!context) return false;
    if (context.state !== 'running') await context.resume();
    return context.state === 'running';
  } catch {
    return false;
  }
}

async function playSqueakAudio(view) {
  try {
    const context = audioContextFor(view);
    if (!context || !(await unlockSqueakAudio(view))) return;
    const start = context.currentTime + 0.015;

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.34, start + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.10, start + 0.16);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.44);
    gain.connect(context.destination);

    const chirp = context.createOscillator();
    chirp.type = 'square';
    chirp.frequency.setValueAtTime(540, start);
    chirp.frequency.exponentialRampToValueAtTime(1180, start + 0.10);
    chirp.frequency.exponentialRampToValueAtTime(430, start + 0.24);
    chirp.connect(gain);
    chirp.start(start);
    chirp.stop(start + 0.45);

    const body = context.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(760, start);
    body.frequency.exponentialRampToValueAtTime(1320, start + 0.11);
    body.frequency.exponentialRampToValueAtTime(610, start + 0.29);
    body.connect(gain);
    body.start(start);
    body.stop(start + 0.45);
  } catch {
    // The visible authoritative power still runs when a browser blocks audio.
  }
}

function createRing() {
  const geometry = new THREE.RingGeometry(0.92, 1, 64);
  const material = new THREE.MeshBasicMaterial({
    color: 0x57e8ff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const ring = new THREE.Mesh(geometry, material);
  ring.rotation.x = -Math.PI / 2;
  ring.frustumCulled = false;
  ring.renderOrder = 12;
  return ring;
}

function easeOutBack(value) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const t = value - 1;
  return 1 + c3 * t * t * t + c1 * t * t;
}

function installSqueakWaveViewPatch() {
  const prototype = SharedWorldView.prototype;
  if (prototype.squeakWaveViewPatchInstalled) return;

  const emitReplayEventsThrough = prototype.emitReplayEventsThrough;
  const update = prototype.update;
  const clear = prototype.clear;

  prototype.ensureSqueakWaveView = function ensureSqueakWaveView() {
    if (!Array.isArray(this.squeakWaveEffects)) this.squeakWaveEffects = [];
    if (!this.__squeakAudioUnlockInstalled && typeof window !== 'undefined') {
      const unlock = () => { void unlockSqueakAudio(this); };
      window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
      window.addEventListener('keydown', unlock, { capture: true });
      this.__squeakAudioUnlockInstalled = true;
      this.__squeakAudioUnlock = unlock;
    }
  };

  prototype.startSqueakWaveVisual = function startSqueakWaveVisual(event) {
    this.ensureSqueakWaveView();
    const position = Array.isArray(event?.position) && event.position.length === 3
      ? event.position
      : [0, CONFIG.board.y + 0.42, CONFIG.board.front - 0.08];
    const origin = new THREE.Vector3(
      Number(position[0]) || 0,
      Math.max(CONFIG.board.y + 0.50, Number(position[1]) || 0),
      Number(position[2]) || CONFIG.board.front - 0.08,
    );
    const rings = RING_DELAYS_MS.map(() => {
      const ring = createRing();
      ring.position.copy(origin);
      this.scene.add(ring);
      return ring;
    });
    const duck = createRubberDuckMesh();
    duck.position.set(origin.x, origin.y - 1.15, origin.z + 0.20);
    duck.rotation.y = Math.PI;
    duck.scale.setScalar(0.92);
    duck.renderOrder = 13;
    this.scene.add(duck);

    this.squeakWaveEffects.push({
      id: event?.id ?? `${event?.turnId ?? 'turn'}:${event?.toyId ?? 'duck'}:${nowMs()}`,
      startedAt: nowMs(),
      origin,
      rings,
      duck,
    });
    void playSqueakAudio(this);
  };

  prototype.updateSqueakWaveVisuals = function updateSqueakWaveVisuals() {
    this.ensureSqueakWaveView();
    const current = nowMs();
    const survivors = [];

    for (const effect of this.squeakWaveEffects) {
      const elapsed = current - effect.startedAt;
      const riseProgress = Math.max(0, Math.min(1, elapsed / 340));
      const rise = easeOutBack(riseProgress);
      effect.duck.position.set(
        effect.origin.x,
        effect.origin.y - 1.15 + rise * 1.10,
        effect.origin.z + 0.20,
      );

      if (elapsed < 620) {
        const breathe = 1 + Math.sin(elapsed / 55) * 0.035;
        effect.duck.scale.set(0.92 * breathe, 0.92 / breathe, 0.92 * breathe);
      } else if (elapsed < 1060) {
        const suck = Math.max(0, Math.min(1, (elapsed - 620) / 440));
        effect.duck.scale.set(0.92 + suck * 0.20, 0.92 - suck * 0.22, 0.92 + suck * 0.20);
        effect.duck.position.z = effect.origin.z + 0.20 + suck * 0.34;
      } else {
        const sink = Math.max(0, Math.min(1, (elapsed - 1060) / 420));
        effect.duck.position.y = effect.origin.y - 0.05 - sink * 1.10;
        effect.duck.scale.setScalar(1.12 - sink * 0.38);
      }

      for (let index = 0; index < effect.rings.length; index += 1) {
        const ring = effect.rings[index];
        const localElapsed = elapsed - RING_DELAYS_MS[index];
        if (localElapsed < 0) {
          ring.visible = false;
          continue;
        }
        const progress = Math.max(0, Math.min(1, localElapsed / 660));
        const radius = 2.75 - progress * 2.52;
        ring.visible = progress < 1;
        ring.scale.set(radius, radius, radius);
        ring.material.opacity = Math.sin(progress * Math.PI) * 0.90;
      }

      if (elapsed < EFFECT_DURATION_MS) {
        survivors.push(effect);
        continue;
      }
      for (const ring of effect.rings) {
        this.scene.remove(ring);
        ring.geometry.dispose?.();
        ring.material.dispose?.();
      }
      this.scene.remove(effect.duck);
    }
    this.squeakWaveEffects = survivors;
  };

  prototype.emitReplayEventsThrough = function emitReplayEventsWithSqueak(elapsedSeconds) {
    const previouslyEmitted = new Set(this.emittedReplayEvents ?? []);
    const result = emitReplayEventsThrough.call(this, elapsedSeconds);
    for (const event of this.replayPackage?.events ?? []) {
      if (previouslyEmitted.has(event.id) || !this.emittedReplayEvents?.has?.(event.id)) continue;
      if (event.type === 'squeak-wave-start' && event.toyKey === RUBBER_DUCK_TOY_KEY) {
        this.startSqueakWaveVisual(event);
      }
    }
    return result;
  };

  prototype.update = function updateWorldWithSqueakVisuals(...args) {
    const result = update.apply(this, args);
    this.updateSqueakWaveVisuals();
    return result;
  };

  prototype.clear = function clearWorldWithSqueakVisuals(...args) {
    this.ensureSqueakWaveView();
    for (const effect of this.squeakWaveEffects) {
      for (const ring of effect.rings) {
        this.scene.remove(ring);
        ring.geometry.dispose?.();
        ring.material.dispose?.();
      }
      this.scene.remove(effect.duck);
    }
    this.squeakWaveEffects = [];
    return clear.apply(this, args);
  };

  Object.defineProperty(prototype, 'squeakWaveViewPatchInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

installSqueakWaveViewPatch();

export { installSqueakWaveViewPatch, playSqueakAudio, unlockSqueakAudio };
