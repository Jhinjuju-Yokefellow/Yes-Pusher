import * as THREE from 'three';
import { CONFIG } from './config/machine-config.js';
import { SharedWorldView } from './network/shared-world-view.js';

const RUBBER_DUCK_TOY_KEY = 'rubber_duck';
const EFFECT_DURATION_MS = 800;
const RING_DELAYS_MS = Object.freeze([0, 200, 400]);

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function playSqueakAudio(view) {
  if (typeof window === 'undefined') return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const context = view.squeakAudioContext ?? new AudioContextClass();
    view.squeakAudioContext = context;
    void context.resume?.();

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(920, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(420, context.currentTime + 0.18);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.23);
  } catch {
    // Browser audio permissions may still be locked. The visible wave remains authoritative.
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

function installSqueakWaveViewPatch() {
  const prototype = SharedWorldView.prototype;
  if (prototype.squeakWaveViewPatchInstalled) return;

  const emitReplayEventsThrough = prototype.emitReplayEventsThrough;
  const update = prototype.update;
  const clear = prototype.clear;

  prototype.ensureSqueakWaveView = function ensureSqueakWaveView() {
    if (!Array.isArray(this.squeakWaveEffects)) this.squeakWaveEffects = [];
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
    this.squeakWaveEffects.push({
      id: event?.id ?? `${event?.turnId ?? 'turn'}:${event?.toyId ?? 'duck'}:${nowMs()}`,
      startedAt: nowMs(),
      origin,
      rings,
    });
    playSqueakAudio(this);
  };

  prototype.updateSqueakWaveVisuals = function updateSqueakWaveVisuals() {
    this.ensureSqueakWaveView();
    const current = nowMs();
    const survivors = [];

    for (const effect of this.squeakWaveEffects) {
      const elapsed = current - effect.startedAt;
      for (let index = 0; index < effect.rings.length; index += 1) {
        const ring = effect.rings[index];
        const localElapsed = elapsed - RING_DELAYS_MS[index];
        if (localElapsed < 0) {
          ring.visible = false;
          continue;
        }
        const progress = Math.max(0, Math.min(1, localElapsed / 420));
        const radius = 0.18 + progress * 2.25;
        ring.visible = progress < 1;
        ring.scale.set(radius, radius, radius);
        ring.material.opacity = (1 - progress) * 0.82;
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
    }
    this.squeakWaveEffects = survivors;
  };

  prototype.emitReplayEventsThrough = function emitReplayEventsWithSqueak(elapsedSeconds) {
    const previouslyEmitted = new Set(this.emittedReplayEvents ?? []);
    const result = emitReplayEventsThrough.call(this, elapsedSeconds);
    for (const event of this.replayPackage?.events ?? []) {
      if (previouslyEmitted.has(event.id) || !this.emittedReplayEvents?.has?.(event.id)) continue;
      if (event.type === 'toy-payout' && event.toyKey === RUBBER_DUCK_TOY_KEY) {
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

export { installSqueakWaveViewPatch };
