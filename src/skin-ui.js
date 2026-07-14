import './skin-ui.css';
import { SharedWorldClient } from './network/shared-world-client.js';
import { worldServerUrl } from './network/world-server-url.js';
import { renderToyShowcase } from './toy-showcase-ui.js';

const playerCard = document.querySelector('.player-card');
const playerMetrics = document.querySelector('.player-metrics');

let activeClient = null;
let currentWallet = '';
let inventory = null;
let pending = false;

function clean(value) {
  return String(value ?? '').trim();
}

function createLocker() {
  if (!playerCard || document.querySelector('#skinLocker')) return document.querySelector('#skinLocker');
  const locker = document.createElement('section');
  locker.id = 'skinLocker';
  locker.className = 'skin-locker';
  locker.innerHTML = `
    <button id="skinLockerToggle" class="skin-locker-toggle" type="button" aria-expanded="false">
      <img id="skinLockerPreview" src="/assets/coin-face.svg" alt="Starter YES Coin" />
      <span><small>COIN SKIN</small><strong id="skinLockerName">STARTER YES COIN</strong></span>
      <b>CHOOSE</b>
    </button>
    <div id="skinLockerPanel" class="skin-locker-panel" hidden>
      <label for="skinLockerSelect">OWNED SKINS</label>
      <select id="skinLockerSelect" aria-label="Owned coin skins">
        <option value="">Starter YES Coin</option>
      </select>
      <div class="skin-locker-actions">
        <button id="skinLockerEquip" type="button">EQUIP</button>
        <button id="skinLockerRefresh" type="button">REFRESH</button>
      </div>
      <span id="skinLockerStatus">CONNECT WALLET TO LOAD SKINS</span>
    </div>`;
  playerMetrics?.insertAdjacentElement('afterend', locker);
  return locker;
}

const locker = createLocker();
const toggle = locker?.querySelector('#skinLockerToggle');
const panel = locker?.querySelector('#skinLockerPanel');
const preview = locker?.querySelector('#skinLockerPreview');
const name = locker?.querySelector('#skinLockerName');
const select = locker?.querySelector('#skinLockerSelect');
const equip = locker?.querySelector('#skinLockerEquip');
const refresh = locker?.querySelector('#skinLockerRefresh');
const status = locker?.querySelector('#skinLockerStatus');

function setPanel(open) {
  if (!panel || !toggle) return;
  panel.hidden = !open;
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  locker?.classList.toggle('open', open);
}

function selectedSkin() {
  const holdingId = clean(select?.value);
  if (!holdingId) return inventory?.starter ?? { name: 'Starter YES Coin', imageUrl: '/assets/coin-face.svg' };
  return inventory?.owned?.find((item) => item.holdingId === holdingId) ?? null;
}

function updatePreview(item) {
  const value = item ?? { name: 'Starter YES Coin', imageUrl: '/assets/coin-face.svg' };
  if (preview) {
    preview.src = value.imageUrl || '/assets/coin-face.svg';
    preview.alt = value.name || 'Coin skin';
  }
  if (name) name.textContent = clean(value.name || 'Starter YES Coin').toUpperCase();
}

function setBusy(value) {
  pending = value;
  if (select) select.disabled = value || !currentWallet;
  if (equip) equip.disabled = value || !currentWallet;
  if (refresh) refresh.disabled = value || !currentWallet;
}

function renderInventory(value, message = '') {
  inventory = value;
  const owned = Array.isArray(value?.owned) ? value.owned : [];
  const toys = Array.isArray(value?.toys) ? value.toys : [];
  const equipped = value?.equipped ?? null;

  renderToyShowcase(toys, !currentWallet ? 'CONNECT WALLET TO LOAD TOYS' : '');

  if (select) {
    select.replaceChildren();
    const starter = document.createElement('option');
    starter.value = '';
    starter.textContent = 'Starter YES Coin';
    starter.dataset.image = '/assets/coin-face.svg';
    select.appendChild(starter);
    for (const skin of owned) {
      const option = document.createElement('option');
      option.value = skin.holdingId;
      option.textContent = skin.name;
      option.dataset.image = skin.imageUrl || '';
      option.dataset.skinId = skin.skinId || '';
      select.appendChild(option);
    }
    select.value = equipped?.holdingId && owned.some((skin) => skin.holdingId === equipped.holdingId)
      ? equipped.holdingId
      : '';
  }
  updatePreview(equipped || selectedSkin());
  if (status) {
    status.textContent = message || (!currentWallet
      ? 'CONNECT WALLET TO LOAD SKINS'
      : equipped
        ? `${clean(equipped.name).toUpperCase()} EQUIPPED FOR YOUR NEXT TURN`
        : owned.length
          ? `${owned.length} MINTED SKIN${owned.length === 1 ? '' : 'S'} READY`
          : value?.queued?.length
            ? 'MINT IS STILL QUEUED'
            : 'NO MINTED SKINS FOUND');
  }
  setBusy(false);
}

async function getInventory({ quiet = false } = {}) {
  if (!activeClient || !currentWallet || pending) return null;
  setBusy(true);
  if (!quiet && status) status.textContent = 'LOADING YOKEFELLOW SKINS AND TOYS';
  try {
    const url = worldServerUrl('/api/skins/self');
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'omit',
      headers: activeClient.authHeaders({ accept: 'application/json' }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || `Skin inventory failed (${response.status})`);
    }
    renderInventory(payload.skins ?? null);
    return payload.skins ?? null;
  } catch (error) {
    renderInventory(inventory, error instanceof Error ? error.message.toUpperCase() : 'SKIN INVENTORY FAILED');
    return null;
  }
}

async function equipSelected() {
  if (!activeClient || !currentWallet || pending) return;
  setBusy(true);
  if (status) status.textContent = clean(select?.value) ? 'VERIFYING NFT OWNERSHIP' : 'EQUIPPING STARTER COIN';
  try {
    const payload = await activeClient.command('/api/skins/equip', {
      holdingId: clean(select?.value),
    });
    renderInventory(payload.skins ?? null);
    setPanel(false);
  } catch (error) {
    renderInventory(inventory, error instanceof Error ? error.message.toUpperCase() : 'SKIN COULD NOT BE EQUIPPED');
  }
}

toggle?.addEventListener('click', () => setPanel(Boolean(panel?.hidden)));
select?.addEventListener('change', () => updatePreview(selectedSkin()));
equip?.addEventListener('click', () => void equipSelected());
refresh?.addEventListener('click', () => void getInventory());

document.addEventListener('pointerdown', (event) => {
  if (!locker?.classList.contains('open') || locker.contains(event.target)) return;
  setPanel(false);
});

const originalAcceptSnapshot = SharedWorldClient.prototype.acceptSnapshot;
if (!originalAcceptSnapshot.__skinUiPatched) {
  const patched = function acceptSkinSnapshot(snapshot, source = 'unknown') {
    const accepted = originalAcceptSnapshot.call(this, snapshot, source);
    if (!accepted) return accepted;
    activeClient = this;
    const authenticated = Boolean(snapshot?.auth?.authenticated && snapshot?.auth?.wallet);
    const wallet = authenticated ? clean(snapshot.auth.wallet).toLowerCase() : '';
    if (!wallet) {
      currentWallet = '';
      renderInventory(null);
      setPanel(false);
    } else if (wallet !== currentWallet) {
      currentWallet = wallet;
      renderInventory(null, 'LOADING YOKEFELLOW SKINS AND TOYS');
      queueMicrotask(() => void getInventory({ quiet: true }));
    }
    return accepted;
  };
  Object.defineProperty(patched, '__skinUiPatched', { value: true });
  SharedWorldClient.prototype.acceptSnapshot = patched;
}

renderInventory(null);
