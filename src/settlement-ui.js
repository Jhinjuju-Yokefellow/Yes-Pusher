import './settlement-ui.css';
import { SharedWorldClient } from './network/shared-world-client.js';

const skinCard = document.querySelector('#resultSkin');
const skinStatus = document.querySelector('#resultSkinStatus');
const creditStatus = document.querySelector('#resultCredit');

function ensureElement(parent, id, tagName, className, text = '') {
  let element = document.querySelector(`#${id}`);
  if (element) return element;
  element = document.createElement(tagName);
  element.id = id;
  element.className = className;
  element.textContent = text;
  element.hidden = true;
  parent?.appendChild(element);
  return element;
}

const skinDetails = skinCard?.querySelector('div') ?? skinCard;
const skinError = ensureElement(skinDetails, 'resultSkinError', 'span', 'settlement-error');
const skinRetry = ensureElement(skinDetails, 'resultSkinRetry', 'button', 'settlement-retry', 'RETRY SKIN DROP');
const creditWrap = document.createElement('div');
creditWrap.className = 'settlement-credit-wrap';
if (creditStatus?.parentNode) {
  creditStatus.parentNode.insertBefore(creditWrap, creditStatus);
  creditWrap.appendChild(creditStatus);
}
const creditError = ensureElement(creditWrap, 'resultCreditError', 'span', 'settlement-error');
const creditRetry = ensureElement(creditWrap, 'resultCreditRetry', 'button', 'settlement-retry', 'RETRY YES CREDIT');

let activeClient = null;
let latestSnapshot = null;
let commandPending = false;

function formatYesRaw(value) {
  try {
    const raw = BigInt(String(value ?? '0'));
    const base = 10n ** 18n;
    const whole = raw / base;
    const fraction = (raw % base).toString().padStart(18, '0').slice(0, 3).replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : String(whole);
  } catch {
    return '0';
  }
}

function resetError(element, button) {
  element.hidden = true;
  element.textContent = '';
  button.hidden = true;
  button.disabled = commandPending;
}

function renderSettlement(settlement, result = latestSnapshot?.turn?.lastResult ?? null) {
  const integration = settlement?.integration ?? latestSnapshot?.settlement?.integration ?? null;
  const record = settlement?.last?.id === result?.id ? settlement.last : settlement?.last ?? null;

  resetError(skinError, skinRetry);
  resetError(creditError, creditRetry);

  if (record?.skinDropStatus === 'failed') {
    skinStatus.textContent = 'DROP SUBMISSION FAILED';
    skinError.textContent = record.skinDropError || record.lastError || 'Yokefellow rejected the skin drop.';
    skinError.hidden = false;
    skinRetry.hidden = false;
    skinRetry.disabled = commandPending;
  } else if (record?.skinDropStatus === 'pending') {
    skinStatus.textContent = 'YOKEFELLOW IS RESOLVING THE DROP';
  } else if (record?.skinDropStatus === 'disabled' && result?.skinDropEarned) {
    skinStatus.textContent = 'YOKEFELLOW EVENT ROUTE NOT CONFIGURED';
  }

  if (!record || !creditStatus) return;
  const amount = `${formatYesRaw(record.amountYesRaw)} YES`;
  if (record.creditStatus === 'failed') {
    creditStatus.textContent = `${amount} CREDIT FAILED`;
    creditStatus.classList.remove('pending', 'confirmed');
    creditStatus.classList.add('failed');
    creditError.textContent = record.creditError || record.lastError || 'Yokefellow rejected the YES credit.';
    creditError.hidden = false;
    creditRetry.hidden = false;
    creditRetry.disabled = commandPending;
  } else if (record.creditStatus === 'recorded') {
    creditStatus.textContent = integration?.creditSubmissionConfigured
      ? `${amount} CREDIT READY TO SUBMIT`
      : `${amount} OWED • CREDIT ROUTE NOT CONFIGURED`;
    creditStatus.classList.add('pending');
    creditRetry.hidden = !integration?.creditSubmissionConfigured;
    creditRetry.disabled = commandPending;
  }
}

async function retry(path, button, pendingText) {
  if (!activeClient || commandPending) return;
  commandPending = true;
  button.disabled = true;
  const previous = button.textContent;
  button.textContent = pendingText;
  try {
    const payload = await activeClient.command(path);
    renderSettlement(payload.settlement, latestSnapshot?.turn?.lastResult ?? null);
  } catch (error) {
    const target = path.includes('/skin/') ? skinError : creditError;
    target.textContent = error instanceof Error ? error.message : 'Settlement retry failed';
    target.hidden = false;
  } finally {
    commandPending = false;
    button.textContent = previous;
    button.disabled = false;
  }
}

skinRetry?.addEventListener('click', () => void retry(
  '/api/settlements/skin/retry',
  skinRetry,
  'RETRYING SKIN DROP',
));
creditRetry?.addEventListener('click', () => void retry(
  '/api/settlements/credit/retry',
  creditRetry,
  'RETRYING YES CREDIT',
));

const originalAcceptSnapshot = SharedWorldClient.prototype.acceptSnapshot;
if (!originalAcceptSnapshot.__settlementUiPatched) {
  const patched = function acceptSettlementSnapshot(snapshot, source = 'unknown') {
    const accepted = originalAcceptSnapshot.call(this, snapshot, source);
    if (accepted) {
      activeClient = this;
      latestSnapshot = snapshot;
      queueMicrotask(() => renderSettlement(snapshot.settlement, snapshot.turn?.lastResult ?? null));
    }
    return accepted;
  };
  Object.defineProperty(patched, '__settlementUiPatched', { value: true });
  SharedWorldClient.prototype.acceptSnapshot = patched;
}
