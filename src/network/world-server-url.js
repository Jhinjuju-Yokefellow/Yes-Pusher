const configuredOrigin = String(import.meta.env?.VITE_WORLD_SERVER_URL ?? '')
  .trim()
  .replace(/\/+$/, '');

export const WORLD_SERVER_ORIGIN = configuredOrigin;
export const WORLD_SERVER_IS_REMOTE = Boolean(configuredOrigin);

export function worldServerUrl(pathname = '/') {
  const path = String(pathname || '/').startsWith('/') ? String(pathname || '/') : `/${pathname}`;
  return configuredOrigin ? `${configuredOrigin}${path}` : path;
}
