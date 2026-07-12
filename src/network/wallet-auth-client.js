import { worldServerUrl } from './world-server-url.js';

const SESSION_TOKEN_KEY = 'yes-pusher:wallet-session-token:v1';

async function parseResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `Wallet request failed (${response.status})`);
  }
  return payload;
}

function normalizeChainId(value) {
  if (typeof value === 'string' && value.startsWith('0x')) return Number.parseInt(value, 16);
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function readStoredToken() {
  try {
    return globalThis.sessionStorage?.getItem(SESSION_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function storeToken(token = '') {
  try {
    if (token) globalThis.sessionStorage?.setItem(SESSION_TOKEN_KEY, token);
    else globalThis.sessionStorage?.removeItem(SESSION_TOKEN_KEY);
  } catch {
    // Browser privacy modes can disable storage. The in-memory session still works.
  }
}

function authHeaders(token, headers = {}) {
  return token ? { ...headers, authorization: `Bearer ${token}` } : headers;
}

export class WalletAuthClient {
  constructor({
    provider = globalThis.ethereum,
    onChange = () => {},
  } = {}) {
    this.provider = provider;
    this.onChange = onChange;
    this.session = null;
    this.sessionToken = readStoredToken();
    this.pending = false;
    this.boundAccountsChanged = (accounts) => {
      const current = String(accounts?.[0] ?? '').toLowerCase();
      if (this.session?.wallet && current !== this.session.wallet.toLowerCase()) {
        void this.disconnect('accounts-changed');
      }
    };
    this.provider?.on?.('accountsChanged', this.boundAccountsChanged);
  }

  get available() {
    return Boolean(this.provider?.request);
  }

  async restore() {
    try {
      const response = await fetch(worldServerUrl('/api/auth/session'), {
        cache: 'no-store',
        credentials: 'omit',
        headers: authHeaders(this.sessionToken),
      });
      const payload = await parseResponse(response);
      this.session = payload.authenticated
        ? { ...payload, sessionToken: this.sessionToken }
        : null;
      if (!this.session) {
        this.sessionToken = '';
        storeToken('');
      }
      this.onChange(this.session, 'restore');
      return this.session;
    } catch {
      this.session = null;
      this.sessionToken = '';
      storeToken('');
      this.onChange(null, 'restore');
      return null;
    }
  }

  async connect() {
    if (!this.available) throw new Error('No browser wallet was found');
    if (this.pending) return this.session;
    this.pending = true;
    try {
      const accounts = await this.provider.request({ method: 'eth_requestAccounts' });
      const wallet = String(accounts?.[0] ?? '').trim();
      if (!wallet) throw new Error('The wallet did not return an account');
      const rawChainId = await this.provider.request({ method: 'eth_chainId' }).catch(() => null);
      const chainId = normalizeChainId(rawChainId);
      const challengeResponse = await fetch(worldServerUrl('/api/auth/challenge'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify({ wallet, chainId }),
      });
      const challenge = await parseResponse(challengeResponse);
      let signature;
      try {
        signature = await this.provider.request({
          method: 'personal_sign',
          params: [challenge.message, wallet],
        });
      } catch (firstError) {
        try {
          signature = await this.provider.request({
            method: 'personal_sign',
            params: [wallet, challenge.message],
          });
        } catch {
          throw firstError;
        }
      }
      const verifyResponse = await fetch(worldServerUrl('/api/auth/verify'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          wallet,
          signature,
        }),
      });
      const payload = await parseResponse(verifyResponse);
      this.sessionToken = String(payload.sessionToken ?? '');
      storeToken(this.sessionToken);
      this.session = { ...payload, sessionToken: this.sessionToken };
      this.onChange(this.session, 'connect');
      return this.session;
    } finally {
      this.pending = false;
    }
  }

  async disconnect(reason = 'disconnect') {
    await fetch(worldServerUrl('/api/auth/logout'), {
      method: 'POST',
      headers: authHeaders(this.sessionToken, { 'content-type': 'application/json' }),
      credentials: 'omit',
      body: '{}',
    }).catch(() => null);
    this.session = null;
    this.sessionToken = '';
    storeToken('');
    this.onChange(null, reason);
    return null;
  }

  destroy() {
    this.provider?.removeListener?.('accountsChanged', this.boundAccountsChanged);
  }
}
