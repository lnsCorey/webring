import { parseProxyUrl } from './proxyAgent';

/**
 * The Studio window loads friends' avatars, photos and ring hubs straight from their hosts through
 * Chromium, which never sees the Node proxy agent. This turns the active persona's proxy setting
 * into an Electron session proxy config so those loads take the same route as syncs.
 */

export interface WindowProxyConfig {
  mode: 'system' | 'fixed_servers';
  proxyRules?: string;
  proxyBypassRules?: string;
}

export interface WindowProxyPlan {
  /** Stable key: the session is only reconfigured when this changes */
  key: string;
  config: WindowProxyConfig;
  /** Credentials for an HTTP proxy that asks for them (Chromium can't send SOCKS credentials) */
  credentials?: { username: string; password: string };
}

/** Studio's own dev server and the local preview server must never go through the proxy. */
const LOOPBACK_BYPASS = '127.0.0.1,localhost,[::1]';

export function planWindowProxy(settings: { enabled: boolean; proxyUrl: string }): WindowProxyPlan {
  if (!settings.enabled || !settings.proxyUrl.trim()) {
    return { key: 'system', config: { mode: 'system' } };
  }
  const parsed = parseProxyUrl(settings.proxyUrl);
  const host = parsed.host.includes(':') ? `[${parsed.host}]` : parsed.host;
  // Chromium's SOCKS5 always lets the proxy resolve hostnames, which is what socks5h asks for
  const scheme = parsed.protocol === 'http:' ? 'http' : 'socks5';
  const proxyRules = `${scheme}://${host}:${parsed.port}`;
  return {
    key: `${proxyRules}|${parsed.username || ''}`,
    config: { mode: 'fixed_servers', proxyRules, proxyBypassRules: LOOPBACK_BYPASS },
    ...(parsed.username
      ? { credentials: { username: parsed.username, password: parsed.password || '' } }
      : {}),
  };
}
