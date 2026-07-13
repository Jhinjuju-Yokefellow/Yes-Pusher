const SDK_PATH = '/api/sdk/v1';

export function normalizeYokefellowSdkBaseUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const markerIndex = url.pathname.indexOf(SDK_PATH);
    url.pathname = markerIndex >= 0
      ? url.pathname.slice(0, markerIndex + SDK_PATH.length)
      : SDK_PATH;
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

const normalized = normalizeYokefellowSdkBaseUrl(process.env.YF_API_BASE_URL);
if (normalized) process.env.YF_API_BASE_URL = normalized;
