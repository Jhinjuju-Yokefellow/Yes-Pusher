import crypto from 'node:crypto';
import { getAddress, isAddress, verifyMessage } from 'viem';

const DEFAULT_CHALLENGE_TTL_MS = 5 * 60_000;
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60_000;
export const WALLET_SESSION_COOKIE = 'yes_pusher_session';

function cleanOrigin(value) {
  try {
    const url = new URL(String(value ?? ''));
    return `${url.protocol}//${url.host}`;
  } catch {
    return 'http://localhost';
  }
}

export function normalizeWallet(value) {
  const wallet = String(value ?? '').trim();
  if (!isAddress(wallet)) throw new Error('A valid 0x wallet address is required');
  return getAddress(wallet).toLowerCase();
}

export function walletPlayerId(wallet) {
  return `wallet:${normalizeWallet(wallet)}`;
}

export function walletLabel(wallet) {
  const normalized = normalizeWallet(wallet);
  return `${normalized.slice(0, 6)}…${normalized.slice(-4)}`;
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      out[key] = part.slice(index + 1).trim();
    }
  }
  return out;
}

export function sessionCookie(token, {
  maxAgeSeconds = 86_400,
  secure = false,
  sameSite = 'Lax',
} = {}) {
  const pieces = [
    `${WALLET_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite}`,
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (secure) pieces.push('Secure');
  return pieces.join('; ');
}

export function clearSessionCookie({ secure = false, sameSite = 'Lax' } = {}) {
  return sessionCookie('', { maxAgeSeconds: 0, secure, sameSite });
}

function buildMessage({ wallet, origin, nonce, issuedAt, expiresAt, chainId = null }) {
  const host = new URL(origin).host;
  const chainLine = Number.isInteger(chainId) && chainId > 0 ? `\nChain ID: ${chainId}` : '';
  return `${host} wants you to sign in to YES Pusher with your wallet:\n${wallet}\n\nThis signature identifies your player. It does not spend YES or submit a transaction.\n\nURI: ${origin}\nVersion: 1${chainLine}\nNonce: ${nonce}\nIssued At: ${issuedAt}\nExpiration Time: ${expiresAt}`;
}

export class WalletAuthStore {
  constructor({
    now = () => Date.now(),
    challengeTtlMs = DEFAULT_CHALLENGE_TTL_MS,
    sessionTtlMs = DEFAULT_SESSION_TTL_MS,
  } = {}) {
    this.now = now;
    this.challengeTtlMs = challengeTtlMs;
    this.sessionTtlMs = sessionTtlMs;
    this.challenges = new Map();
    this.sessions = new Map();
  }

  prune() {
    const now = this.now();
    for (const [id, challenge] of this.challenges) {
      if (challenge.expiresAtMs <= now || challenge.used) this.challenges.delete(id);
    }
    for (const [token, session] of this.sessions) {
      if (session.expiresAtMs <= now) this.sessions.delete(token);
    }
  }

  createChallenge({ wallet, origin, chainId = null }) {
    this.prune();
    const normalizedWallet = normalizeWallet(wallet);
    const normalizedOrigin = cleanOrigin(origin);
    const issuedAtMs = this.now();
    const expiresAtMs = issuedAtMs + this.challengeTtlMs;
    const id = crypto.randomUUID();
    const nonce = crypto.randomBytes(12).toString('hex');
    const issuedAt = new Date(issuedAtMs).toISOString();
    const expiresAt = new Date(expiresAtMs).toISOString();
    const normalizedChainId = Number.isInteger(Number(chainId)) && Number(chainId) > 0
      ? Number(chainId)
      : null;
    const message = buildMessage({
      wallet: normalizedWallet,
      origin: normalizedOrigin,
      nonce,
      issuedAt,
      expiresAt,
      chainId: normalizedChainId,
    });
    const challenge = {
      id,
      wallet: normalizedWallet,
      origin: normalizedOrigin,
      chainId: normalizedChainId,
      nonce,
      issuedAtMs,
      expiresAtMs,
      message,
      used: false,
    };
    this.challenges.set(id, challenge);
    return {
      challengeId: id,
      wallet: normalizedWallet,
      message,
      expiresAt,
    };
  }

  async verifyChallenge({ challengeId, wallet, signature, origin }) {
    this.prune();
    const challenge = this.challenges.get(String(challengeId ?? ''));
    if (!challenge || challenge.used) throw new Error('Wallet challenge is missing or already used');
    if (challenge.expiresAtMs <= this.now()) {
      this.challenges.delete(challenge.id);
      throw new Error('Wallet challenge expired');
    }
    const normalizedWallet = normalizeWallet(wallet);
    if (challenge.wallet !== normalizedWallet) throw new Error('Wallet does not match the challenge');
    if (challenge.origin !== cleanOrigin(origin)) throw new Error('Wallet challenge origin does not match');
    const valid = await verifyMessage({
      address: normalizedWallet,
      message: challenge.message,
      signature: String(signature ?? ''),
    });
    if (!valid) throw new Error('Wallet signature is invalid');

    challenge.used = true;
    this.challenges.delete(challenge.id);
    const token = crypto.randomBytes(32).toString('base64url');
    const issuedAtMs = this.now();
    const expiresAtMs = issuedAtMs + this.sessionTtlMs;
    const session = {
      token,
      wallet: normalizedWallet,
      playerId: walletPlayerId(normalizedWallet),
      label: walletLabel(normalizedWallet),
      issuedAtMs,
      expiresAtMs,
    };
    this.sessions.set(token, session);
    return { ...session };
  }

  readSessionToken(token) {
    this.prune();
    const session = this.sessions.get(String(token ?? ''));
    return session ? { ...session } : null;
  }

  requestToken(request) {
    const authorization = String(request?.headers?.authorization ?? '');
    const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (bearer) return bearer;
    const cookies = parseCookies(request?.headers?.cookie ?? '');
    return cookies[WALLET_SESSION_COOKIE] || '';
  }

  readRequest(request) {
    return this.readSessionToken(this.requestToken(request));
  }

  revokeRequest(request) {
    const token = this.requestToken(request);
    if (token) this.sessions.delete(token);
  }
}
