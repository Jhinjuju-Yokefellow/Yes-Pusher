export function formatTurnSeconds(value) {
  return String(Math.max(0, Math.ceil(Number(value) || 0)));
}
