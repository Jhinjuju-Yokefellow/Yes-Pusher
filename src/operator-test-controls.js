import { worldServerUrl, WORLD_SERVER_IS_REMOTE } from './network/world-server-url.js';

const SESSION_TOKEN_KEY = 'yes-pusher:wallet-session-token:v1';
const BUTTON_ID = 'resetMachine';

function sessionToken() {
  try {
    return globalThis.sessionStorage?.getItem(SESSION_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

async function parseResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `Test reset failed (${response.status})`);
  }
  return payload;
}

async function runOperatorTestReset(button) {
  const token = sessionToken();
  if (!token) throw new Error('Connect and sign with the operator wallet first.');
  if (button.dataset.operatorTestResetBusy === 'true') return null;

  const oldText = button.textContent;
  button.dataset.operatorTestResetBusy = 'true';
  button.disabled = true;
  button.textContent = 'RESETTING…';
  try {
    const response = await fetch(worldServerUrl('/api/operator/test-setup'), {
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ toyCount: 3, resetStats: true, resetSettlements: true }),
    });
    const payload = await parseResponse(response);
    button.textContent = `TEST READY • ${payload.toyCount ?? 3} TOYS`;
    button.title = 'Machine, local game statistics, and test settlement records were reset. Existing on-chain NFTs and YES remain untouched.';
    setTimeout(() => {
      if (button.dataset.operatorTestResetBusy !== 'true') button.textContent = 'RESET TEST';
    }, 2200);
    return payload;
  } catch (error) {
    button.textContent = 'RESET FAILED';
    button.title = error instanceof Error ? error.message : String(error);
    setTimeout(() => {
      if (button.dataset.operatorTestResetBusy !== 'true') button.textContent = oldText || 'RESET TEST';
    }, 2600);
    throw error;
  } finally {
    button.dataset.operatorTestResetBusy = 'false';
    button.disabled = false;
  }
}

function installOperatorTestControls() {
  if (!WORLD_SERVER_IS_REMOTE || typeof document === 'undefined') return;
  const install = () => {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;

    const token = sessionToken();
    const busy = button.dataset.operatorTestResetBusy === 'true';
    button.hidden = false;
    button.disabled = busy || !token;
    if (!busy) button.textContent = 'RESET TEST';
    button.title = token
      ? 'Reset the shared test machine, zero game statistics, clear test settlement records, and place three Rubber Ducks at the payout edge.'
      : 'Connect and sign with the operator wallet to use the test reset.';

    if (button.dataset.operatorTestResetInstalled === 'true') return;
    button.dataset.operatorTestResetInstalled = 'true';
    button.onclick = () => {
      void runOperatorTestReset(button).catch((error) => {
        console.error('Operator test reset failed', error);
      });
    };
  };

  install();
  const interval = setInterval(install, 500);
  interval.unref?.();
  globalThis.addEventListener?.('pageshow', install);
  globalThis.addEventListener?.('focus', install);
}

installOperatorTestControls();

export { installOperatorTestControls, runOperatorTestReset };
