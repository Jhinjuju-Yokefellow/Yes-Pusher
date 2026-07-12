export function makeRandomSlotPlan(slotCount, count, random = Math.random) {
  const plan = [];
  let previous = -1;

  while (plan.length < count) {
    const cycle = Array.from({ length: slotCount }, (_, index) => index);
    for (let index = cycle.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(random() * (index + 1));
      [cycle[index], cycle[swapIndex]] = [cycle[swapIndex], cycle[index]];
    }

    if (cycle[0] === previous && cycle.length > 1) {
      [cycle[0], cycle[1]] = [cycle[1], cycle[0]];
    }

    for (const slot of cycle) {
      if (plan.length >= count) break;
      plan.push(slot);
      previous = slot;
    }
  }

  return plan;
}
