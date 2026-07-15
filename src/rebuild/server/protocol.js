function objectSignature(object) {
  return JSON.stringify([
    object.type,
    object.visualKey,
    object.position,
    object.quaternion,
    object.sleeping,
  ]);
}

function publicPlay(play) {
  if (!play) return null;
  return {
    id: play.id,
    playerId: play.playerId,
    coins: play.coins,
    visualKey: play.visualKey,
    startedAt: play.startedAt,
  };
}

export function createBoundary(core, sequence = 0) {
  const state = core.snapshot();
  return {
    type: 'boundary',
    protocol: 1,
    sequence,
    generatedAt: state.generatedAt,
    pusherZ: state.pusherZ,
    activePlay: publicPlay(state.activePlay),
    queue: state.queue,
    completedPlays: state.completedPlays,
    scoringState: state.scoringState,
    objects: state.objects,
  };
}

export function createDeltaFrame(core, previousObjects = new Map(), sequence = 0) {
  const state = core.snapshot();
  const currentIds = new Set();
  const objects = [];
  const removed = [];

  for (const object of state.objects) {
    currentIds.add(object.id);
    const signature = objectSignature(object);
    if (previousObjects.get(object.id) !== signature) objects.push(object);
    previousObjects.set(object.id, signature);
  }

  for (const id of previousObjects.keys()) {
    if (currentIds.has(id)) continue;
    previousObjects.delete(id);
    removed.push(id);
  }

  return {
    type: 'frame',
    protocol: 1,
    sequence,
    generatedAt: state.generatedAt,
    pusherZ: state.pusherZ,
    activePlay: publicPlay(state.activePlay),
    queue: state.queue,
    completedPlays: state.completedPlays,
    scoringState: state.scoringState,
    objects,
    removed,
    events: core.drainEvents(),
  };
}

export function encodeSse(eventName, payload) {
  return `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
}
