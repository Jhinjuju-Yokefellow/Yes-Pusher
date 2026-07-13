import * as CANNON from 'cannon-es';
import { CONFIG } from '../config/machine-config.js';
import { WorldEngine } from './world-engine.js';

export const REPLAY_FREE_COIN_SEGMENTS = 10;
export const REPLAY_SETTLED_COIN_SEGMENTS = 6;

function replaceCoinShape(coin, segments) {
  if (!coin?.body || coin.replayCollisionSegments === segments) return;
  const body = coin.body;
  for (const shape of [...body.shapes]) body.removeShape(shape);
  body.addShape(new CANNON.Cylinder(
    CONFIG.coin.radius,
    CONFIG.coin.radius,
    CONFIG.coin.thickness,
    segments,
  ));
  coin.replayCollisionSegments = segments;
  body.aabbNeedsUpdate = true;
}

function installRecordedReplayPhysicsOptimization() {
  const prototype = WorldEngine.prototype;
  if (prototype.recordedReplayPhysicsOptimizationInstalled) return;

  const configurePlanarBoardCoin = prototype.configurePlanarBoardCoin;
  const configureFreeBoardCoin = prototype.configureFreeBoardCoin;

  prototype.configurePlanarBoardCoin = function configureReplayPlanarCoin(coin, options) {
    configurePlanarBoardCoin.call(this, coin, options);
    replaceCoinShape(coin, REPLAY_SETTLED_COIN_SEGMENTS);
  };

  prototype.configureFreeBoardCoin = function configureReplayFreeCoin(coin, options) {
    replaceCoinShape(coin, REPLAY_FREE_COIN_SEGMENTS);
    configureFreeBoardCoin.call(this, coin, options);
  };

  Object.defineProperty(prototype, 'recordedReplayPhysicsOptimizationInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

export function optimizeRecordedReplayPhysics(engine) {
  installRecordedReplayPhysicsOptimization();
  if (!engine) return engine;
  for (const coin of engine.coins) {
    replaceCoinShape(
      coin,
      coin.phase === 'board' && coin.planar
        ? REPLAY_SETTLED_COIN_SEGMENTS
        : REPLAY_FREE_COIN_SEGMENTS,
    );
  }
  return engine;
}

// Railway loads this module with Node's --import flag before the world server.
// That makes every authoritative simulation use the lighter settled-coin hulls
// without changing browser rendering or serialized machine state.
installRecordedReplayPhysicsOptimization();
