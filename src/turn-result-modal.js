import './turn-result-modal.css';
import { SharedWorldClient } from './network/shared-world-client.js';
import {
  resultBelongsToSnapshotSelf,
  sanitizePersonalSnapshot,
} from './ui/personal-result.js';

const documentRef = globalThis.document ?? null;
const turnResult = documentRef?.querySelector('#turnResult') ?? null;
let backdrop = null;
let closeButton = null;
let activeResultId = null;

function dismissalKey(resultId) {
  return `yes-pusher:turn-result-dismissed:${String(resultId ?? '')}`;
}

function isDismissed(resultId) {
  if (!resultId) return false;
  try {
    return globalThis.sessionStorage?.getItem(dismissalKey(resultId)) === '1';
  } catch {
    return false;
  }
}

function rememberDismissed(resultId) {
  if (!resultId) return;
  try {
    globalThis.sessionStorage?.setItem(dismissalKey(resultId), '1');
  } catch {
    // A blocked storage API should never prevent the dialog from closing.
  }
}

function setDialogVisible(visible) {
  if (!turnResult || !backdrop) return;
  turnResult.classList.toggle('hidden', !visible);
  turnResult.setAttribute('aria-hidden', visible ? 'false' : 'true');
  backdrop.classList.toggle('hidden', !visible);
  backdrop.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function dismissDialog() {
  rememberDismissed(activeResultId);
  setDialogVisible(false);
}

function syncDialogPresentation() {
  if (!turnResult || !backdrop) return;
  const requestedVisible = !turnResult.classList.contains('hidden');
  const allowedVisible = Boolean(activeResultId && !isDismissed(activeResultId));
  if (!requestedVisible || !allowedVisible) {
    setDialogVisible(false);
    return;
  }
  turnResult.setAttribute('aria-hidden', 'false');
  backdrop.classList.remove('hidden');
  backdrop.setAttribute('aria-hidden', 'false');
}

if (turnResult && documentRef) {
  const title = turnResult.querySelector('.eyebrow');
  if (title) {
    title.id ||= 'turnResultTitle';
    turnResult.setAttribute('aria-labelledby', title.id);
  }
  turnResult.setAttribute('role', 'dialog');
  turnResult.setAttribute('aria-modal', 'true');
  turnResult.setAttribute('aria-hidden', 'true');

  closeButton = documentRef.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'turn-result-close';
  closeButton.setAttribute('aria-label', 'Close turn result');
  closeButton.textContent = '×';
  closeButton.addEventListener('click', dismissDialog);
  turnResult.prepend(closeButton);

  backdrop = documentRef.createElement('div');
  backdrop.className = 'turn-result-backdrop hidden';
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.addEventListener('click', dismissDialog);
  turnResult.parentNode?.insertBefore(backdrop, turnResult);

  const observer = new MutationObserver(syncDialogPresentation);
  observer.observe(turnResult, { attributes: true, attributeFilter: ['class'] });
  documentRef.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !turnResult.classList.contains('hidden')) dismissDialog();
  });
}

const originalAcceptSnapshot = SharedWorldClient.prototype.acceptSnapshot;
if (!originalAcceptSnapshot.__personalTurnResultPatched) {
  const patched = function acceptPersonalTurnSnapshot(snapshot, source = 'unknown') {
    const personalSnapshot = sanitizePersonalSnapshot(snapshot);
    const accepted = originalAcceptSnapshot.call(this, personalSnapshot, source);
    if (!accepted) return false;

    const result = personalSnapshot?.turn?.lastResult ?? null;
    activeResultId = resultBelongsToSnapshotSelf(personalSnapshot, result) ? result.id : null;
    queueMicrotask(() => {
      if (!activeResultId || isDismissed(activeResultId)) setDialogVisible(false);
      else syncDialogPresentation();
    });
    return true;
  };
  Object.defineProperty(patched, '__personalTurnResultPatched', { value: true });
  SharedWorldClient.prototype.acceptSnapshot = patched;
}
