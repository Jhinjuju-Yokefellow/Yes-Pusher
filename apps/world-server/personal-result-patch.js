import { PlayerProgressStore } from './player-progress.js';
import { SettlementOutbox } from './settlement-outbox.js';

function cleanString(value) {
  return String(value ?? '').trim();
}

export function personalResultForPlayer(result, playerId) {
  const id = cleanString(playerId);
  return id && cleanString(result?.playerId) === id ? result : null;
}

function patchPrototype(prototype, name, wrap) {
  const original = prototype[name];
  if (typeof original !== 'function' || original.__personalResultPatched) return;
  const patched = wrap(original);
  Object.defineProperty(patched, '__personalResultPatched', { value: true });
  prototype[name] = patched;
}

patchPrototype(PlayerProgressStore.prototype, 'decorateTurnSnapshot', (original) => function decoratePersonalTurn(turn, playerId) {
  const decorated = original.call(this, turn, playerId);
  return {
    ...decorated,
    lastResult: personalResultForPlayer(decorated?.lastResult, playerId),
  };
});

patchPrototype(SettlementOutbox.prototype, 'viewForPlayer', (original) => function viewPersonalSettlement(playerId) {
  const view = original.call(this, playerId);
  return {
    ...view,
    last: personalResultForPlayer(view?.last, playerId),
  };
});
