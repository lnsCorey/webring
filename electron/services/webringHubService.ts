import { WebringHubExtensionInfo, WebringHubRecord, StudioDatabase } from '../db/database';
import {
  canonicalizeJson,
  isPlaceholderSiteUrl,
  isUrlWithinSite,
  normalizeSiteUrl,
  siteUrlToDidWeb,
} from '../../src/shared/schema';
import { privatePeersAllowed } from '../security/networkGuard';
import { defaultJsonFetcher, JsonFetcher, PublicJsonResponse, requestPublicJson } from './ringCrawler';
import * as crypto from 'crypto';

/**
 * Optional Webring Hubs (see `docs/architecture/webring-hub.md`).
 *
 * A hub is a third-party server that indexes published Webring sites, the way a search
 * engine would. Studio talks to it as a client from the engine only; the published site never
 * depends on it. The rules:
 *
 * - **Hints, not truth.** Search results are shown and discarded. Nothing from a hub is
 *   stored, verified on its say-so, or published. Adding a result as a friend goes through the
 *   normal add → crawl → verify → pin path against the site itself.
 * - **Opt-in per persona.** Listing a site tells the hub it exists, so it's a publishing
 *   decision: off until the user turns it on, per hub.
 * - **Ping, don't push.** After a publish Studio only asks the hub to re-read the site
 *   (once the live site shows the new publish). The hub still fetches and verifies the
 *   signed static files itself; Studio never uploads content.
 * - Requests use the persona's proxy and the crawler's private-network guard.
 */

export const MAX_WEBRING_HUBS = 10;
/** A ping waiting for the live site to show a publish is dropped after this long. */
export const WEBRING_HUB_PING_MAX_WAIT_MS = 24 * 60 * 60 * 1000;
const MAX_RESULTS = 50;
/** `/api/info` (title and extensions) is re-read when older than this. */
export const WEBRING_HUB_INFO_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_EXTENSIONS = 50;

/**
 * Webring Hub extensions Studio has a built-in client for, by id and API version. Studio never runs
 * extension code; anything not listed here is shown as a name only and otherwise ignored.
 */
export const KNOWN_WEBRING_HUB_EXTENSIONS: Record<string, number> = {
  'key-witness': 1,
};

export type WebringHubRequester = (
  url: string,
  init: { method: 'GET' | 'POST'; body?: unknown }
) => Promise<PublicJsonResponse>;

export interface WebringHubServiceDeps {
  request?: WebringHubRequester;
  /** Reads the persona's own live manifest (to tell when a publish is online). */
  fetchJson?: JsonFetcher;
  now?: () => Date;
}

export interface WebringHubSearchResult {
  siteUrl: string;
  did: string;
  displayName: string;
  handle: string;
  tagline: string;
  /** Only an https image on the entry's own site, otherwise empty. */
  avatarUrl: string;
  interests: string[];
  verifiedAt: string;
  /** How this site relates to the persona. Blocked sites are never returned. */
  relation: 'self' | 'friend' | 'muted' | 'none';
}

export interface WebringHubSearchResponse {
  webringHubUrl: string;
  total: number;
  results: WebringHubSearchResult[];
}

export interface WebringHubKeyCheckResult {
  webringHubUrl: string;
  title: string;
  /**
   * - `match`: the hub's current key for the site is the key Studio pinned.
   * - `mismatch`: the hub currently has a different key.
   * - `not-listed`: the hub doesn't list the site.
   * - `error`: the hub couldn't be asked.
   */
  result: 'match' | 'mismatch' | 'not-listed' | 'error';
  /** When the hub first saw its current key. */
  since?: string;
  /** The hub has, at some point, seen and accepted the key Studio pinned. */
  pinnedKeySeen?: boolean;
  /** How the hub accepted its current key: `rotated` means a signed rotation certificate. */
  currentOutcome?: string;
  /** Keys the hub saw and refused for this site (no rotation certificate). */
  rejectedKeys?: number;
  message?: string;
}

export interface WebringHubKeyCheck {
  siteUrl: string;
  did: string;
  /** Fingerprint of the key Studio pinned (SHA-256 over SPKI DER, hex). */
  pinnedFingerprint: string;
  /** Hubs with the key-witness extension. Others are never asked. */
  results: WebringHubKeyCheckResult[];
}

export interface WebringHubPingResult {
  url: string;
  outcome: 'pinged' | 'waiting' | 'dropped' | 'not-listed' | 'key-changed' | 'error';
  message?: string;
}

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function errorMessage(res: PublicJsonResponse, fallback: string): string {
  const body = res.json as { message?: unknown; error?: unknown } | undefined;
  const message = body && typeof body.message === 'string' ? body.message.slice(0, 300) : '';
  return message || `${fallback} (HTTP ${res.status})`;
}

function errorCode(res: PublicJsonResponse): string {
  const body = res.json as { error?: unknown } | undefined;
  return body && typeof body.error === 'string' ? body.error : '';
}

/**
 * A hub address as stored: http(s), no query or fragment, no trailing slash. Only https,
 * unless private peers are allowed for development.
 */
export function normalizeWebringHubUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('Enter the Webring Hub address, such as https://hub.example.');
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error(`"${trimmed}" isn't a web address.`);
  }
  const allowHttp = privatePeersAllowed() && parsed.protocol === 'http:';
  if (parsed.protocol !== 'https:' && !allowHttp) {
    throw new Error('Webring Hub addresses must use https://.');
  }
  if (parsed.username || parsed.password) throw new Error("Webring Hub addresses can't include a user name or password.");
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
}

/**
 * SHA-256 (hex) over the key's SPKI DER bytes. Matches the hub's `Verify::spkiFingerprint`.
 */
export function publicKeyFingerprint(publicKeyPem: string): string {
  const der = crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex');
}

/** The extensions a hub lists in `/api/info`, cleaned up. */
export function parseWebringHubExtensions(info: unknown): WebringHubExtensionInfo[] {
  const raw = (info as { extensions?: unknown } | undefined)?.extensions;
  if (!Array.isArray(raw)) return [];
  const out: WebringHubExtensionInfo[] = [];
  for (const item of raw.slice(0, MAX_EXTENSIONS)) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    const id = str(e.id, 41);
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(id)) continue;
    const apiVersion = typeof e.apiVersion === 'number' && Number.isInteger(e.apiVersion) ? e.apiVersion : 0;
    out.push({ id, version: str(e.version, 40), apiVersion });
  }
  return out;
}

/** True when the hub advertises an extension Studio can talk to, at the version it knows. */
export function webringHubSupports(record: WebringHubRecord, id: string): boolean {
  const known = KNOWN_WEBRING_HUB_EXTENSIONS[id];
  return !!known && !!record.extensions?.some((e) => e.id === id && e.apiVersion === known);
}

/**
 * Signs a hub's self-service removal payload with the persona's key. Matches the
 * hub's `Verify::verifyPayloadSignature`: Ed25519 over `canonicalizeJson(payload)`,
 * base64url.
 */
export function signWebringHubPayload(payload: Record<string, unknown>, privateKeyPem: string): string {
  return crypto.sign(null, Buffer.from(canonicalizeJson(payload), 'utf8'), privateKeyPem).toString('base64url');
}

export class WebringHubService {
  private request: WebringHubRequester;
  private fetchJson: JsonFetcher;
  private now: () => Date;

  constructor(private db: StudioDatabase, deps: WebringHubServiceDeps = {}) {
    const proxyUrl = () => {
      const proxy = this.db.getProxySettings();
      return proxy.enabled && proxy.proxyUrl ? proxy.proxyUrl : undefined;
    };
    this.request = deps.request || ((url, init) => requestPublicJson(url, { ...init, proxyUrl: proxyUrl() }));
    this.fetchJson = deps.fetchJson || ((url) => defaultJsonFetcher(url, proxyUrl()));
    this.now = deps.now || (() => new Date());
  }

  public list(): WebringHubRecord[] {
    return this.db.getWebringHubs();
  }

  private find(url: string): WebringHubRecord {
    const normalized = normalizeWebringHubUrl(url);
    const found = this.db.getWebringHubs().find((d) => d.url === normalized);
    if (!found) throw new Error(`${normalized} isn't in your Webring Hubs.`);
    return found;
  }

  private update(url: string, changes: Partial<WebringHubRecord>): WebringHubRecord {
    const all = this.db.getWebringHubs();
    const index = all.findIndex((d) => d.url === url);
    if (index < 0) throw new Error(`${url} isn't in your Webring Hubs.`);
    const next: WebringHubRecord = { ...all[index], ...changes };
    for (const key of Object.keys(next) as Array<keyof WebringHubRecord>) {
      if (next[key] === undefined) delete next[key];
    }
    all[index] = next;
    this.db.saveWebringHubs(all);
    return next;
  }

  /** The persona's own site, or an error when it can't be listed yet. */
  private ownSite(): { siteUrl: string; did: string } {
    const profile = this.db.getProfile();
    if (isPlaceholderSiteUrl(profile.siteUrl)) {
      throw new Error('Set your site address before listing it in a Webring Hub.');
    }
    if (!profile.publishSettings.lastPublishedAt) {
      throw new Error('Publish your site first. The Webring Hub reads your published files to list you.');
    }
    const siteUrl = normalizeSiteUrl(profile.siteUrl);
    return { siteUrl, did: siteUrlToDidWeb(siteUrl) };
  }

  /** Adds a hub after checking it answers like one (`/api/info`). Doesn't list the site. */
  public async add(rawUrl: string): Promise<WebringHubRecord> {
    const url = normalizeWebringHubUrl(rawUrl);
    const existing = this.db.getWebringHubs();
    if (existing.some((d) => d.url === url)) throw new Error(`${url} is already in your Webring Hubs.`);
    if (existing.length >= MAX_WEBRING_HUBS) throw new Error(`You can keep up to ${MAX_WEBRING_HUBS} Webring Hubs.`);
    const res = await this.request(`${url}/api/info`, { method: 'GET' });
    const info = res.json as { title?: unknown } | undefined;
    if (res.status !== 200 || !info || typeof info !== 'object' || typeof info.title !== 'string') {
      throw new Error(`${url} doesn't look like a Webring Hub (no /api/info).`);
    }
    const at = this.now().toISOString();
    const record: WebringHubRecord = {
      url,
      title: str(info.title, 120) || url,
      addedAt: at,
      listMe: false,
      state: 'not-listed',
      extensions: parseWebringHubExtensions(info),
      infoCheckedAt: at,
    };
    this.db.saveWebringHubs([...existing, record]);
    return record;
  }

  /**
   * Re-reads a hub's `/api/info` (title and extensions). Keeps the old values when the
   * hub can't be reached.
   */
  public async refreshInfo(rawUrl: string): Promise<WebringHubRecord> {
    const record = this.find(rawUrl);
    try {
      const res = await this.request(`${record.url}/api/info`, { method: 'GET' });
      const info = res.json as { title?: unknown } | undefined;
      if (res.status !== 200 || !info || typeof info !== 'object') return record;
      return this.update(record.url, {
        title: str(info.title, 120) || record.title,
        extensions: parseWebringHubExtensions(info),
        infoCheckedAt: this.now().toISOString(),
      });
    } catch {
      return record;
    }
  }

  /** Refreshes `/api/info` for hubs not checked within a day. Never throws. */
  public async refreshStaleInfo(): Promise<WebringHubRecord[]> {
    const now = this.now().getTime();
    for (const d of this.db.getWebringHubs()) {
      const checked = Date.parse(d.infoCheckedAt || '') || 0;
      if (now - checked > WEBRING_HUB_INFO_MAX_AGE_MS) await this.refreshInfo(d.url);
    }
    return this.db.getWebringHubs();
  }

  /**
   * Asks every hub with the key-witness extension which key it has for a friend's site,
   * and compares that with the key Studio pinned itself. The answers are evidence for the user:
   * never stored, and they never change the pinned key. Hubs without the extension aren't
   * asked about the site at all.
   */
  public async checkKeyWithWebringHubs(friendSiteUrl: string): Promise<WebringHubKeyCheck> {
    const siteUrl = normalizeSiteUrl(friendSiteUrl);
    const pinned = this.db.getSiteKey(siteUrl);
    if (!pinned || !pinned.publicKeyPem.trim()) {
      throw new Error(`Studio hasn't pinned a key for ${siteUrl} yet. Sync it first.`);
    }
    const did = pinned.did || siteUrlToDidWeb(siteUrl);
    const pinnedFingerprint = publicKeyFingerprint(pinned.publicKeyPem);

    await this.refreshStaleInfo();
    const witnesses = this.db.getWebringHubs().filter((d) => webringHubSupports(d, 'key-witness'));
    const results: WebringHubKeyCheckResult[] = [];
    for (const d of witnesses) {
      const base = { webringHubUrl: d.url, title: d.title };
      try {
        const res = await this.request(`${d.url}/api/ext/key-witness/v1/keys/${encodeURIComponent(did)}`, {
          method: 'GET',
        });
        if (res.status === 404) {
          results.push({ ...base, result: 'not-listed' });
          continue;
        }
        const body = res.json as
          | { did?: unknown; current?: { fingerprint?: unknown; since?: unknown }; history?: unknown }
          | undefined;
        if (res.status !== 200 || !body || body.did !== did) {
          results.push({ ...base, result: 'error', message: errorMessage(res, `${d.title} didn't answer`) });
          continue;
        }
        const current = str(body.current?.fingerprint, 64).toLowerCase();
        const history = Array.isArray(body.history) ? body.history.slice(0, 50) : [];
        const items = history
          .filter((h): h is Record<string, unknown> => !!h && typeof h === 'object')
          .map((h) => ({ fingerprint: str(h.fingerprint, 64).toLowerCase(), outcome: str(h.outcome, 30) }));
        const currentItem = [...items].reverse().find((h) => h.fingerprint === current && h.outcome !== 'rejected');
        results.push({
          ...base,
          result: current && current === pinnedFingerprint ? 'match' : 'mismatch',
          since: str(body.current?.since, 40) || undefined,
          pinnedKeySeen: items.some((h) => h.fingerprint === pinnedFingerprint && h.outcome !== 'rejected'),
          currentOutcome: currentItem?.outcome || undefined,
          rejectedKeys: new Set(items.filter((h) => h.outcome === 'rejected').map((h) => h.fingerprint)).size,
        });
      } catch (err) {
        results.push({ ...base, result: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    }
    return { siteUrl, did, pinnedFingerprint, results };
  }

  /** Forgets a hub. A listed site must be unlisted first, so a listing is never orphaned. */
  public remove(rawUrl: string): WebringHubRecord[] {
    const record = this.find(rawUrl);
    if (record.listMe || record.state === 'listed') {
      throw new Error(`Your site is listed in ${record.title}. Unlist it before removing the Webring Hub.`);
    }
    const next = this.db.getWebringHubs().filter((d) => d.url !== record.url);
    this.db.saveWebringHubs(next);
    return next;
  }

  /**
   * Searches a hub. Results are hints only: never stored, and blocked sites are dropped.
   * Entries whose did:web doesn't match their own site address are dropped too.
   */
  public async search(
    rawUrl: string,
    query: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<WebringHubSearchResponse> {
    const record = this.find(rawUrl);
    const limit = Math.min(Math.max(Math.floor(options.limit || 24), 1), MAX_RESULTS);
    const offset = Math.max(Math.floor(options.offset || 0), 0);
    const params = new URLSearchParams({ q: query.trim().slice(0, 200), limit: String(limit), offset: String(offset) });
    const res = await this.request(`${record.url}/api/entries?${params.toString()}`, { method: 'GET' });
    if (res.status !== 200) throw new Error(errorMessage(res, `${record.title} couldn't search`));
    const body = res.json as { total?: unknown; entries?: unknown } | undefined;
    const entries = Array.isArray(body?.entries) ? body!.entries.slice(0, MAX_RESULTS) : [];

    const own = normalizeSiteUrl(this.db.getProfile().siteUrl);
    const friends = new Set(this.db.getFriends().map((f) => normalizeSiteUrl(f.siteUrl)));
    const moderation = new Map(this.db.getModeration().map((m) => [normalizeSiteUrl(m.siteUrl), m.action]));

    const results: WebringHubSearchResult[] = [];
    for (const raw of entries) {
      if (!raw || typeof raw !== 'object') continue;
      const entry = raw as Record<string, unknown>;
      const rawSite = str(entry.siteUrl, 500);
      if (!/^https?:\/\//i.test(rawSite)) continue;
      const siteUrl = normalizeSiteUrl(rawSite);
      if (!siteUrl.startsWith('https://') && !privatePeersAllowed()) continue;
      const did = str(entry.did, 300);
      if (did !== siteUrlToDidWeb(siteUrl)) continue;
      const action = moderation.get(siteUrl);
      if (action === 'block') continue;
      const avatar = str(entry.avatarUrl, 2048);
      results.push({
        siteUrl,
        did,
        displayName: str(entry.displayName, 120) || siteUrl,
        handle: str(entry.handle, 100),
        tagline: str(entry.tagline, 400),
        avatarUrl: avatar.startsWith('https://') && isUrlWithinSite(avatar, siteUrl) ? avatar : '',
        interests: Array.isArray(entry.interests)
          ? entry.interests.filter((i): i is string => typeof i === 'string').slice(0, 20).map((i) => i.slice(0, 60))
          : [],
        verifiedAt: str(entry.verifiedAt, 40),
        relation: siteUrl === own ? 'self' : friends.has(siteUrl) ? 'friend' : action === 'mute' ? 'muted' : 'none',
      });
    }
    const total = typeof body?.total === 'number' && Number.isFinite(body.total) ? body.total : results.length;
    return { webringHubUrl: record.url, total, results };
  }

  /** Asks the hub to list the persona's published site. It crawls and verifies it itself. */
  public async listSite(rawUrl: string): Promise<WebringHubRecord> {
    const record = this.find(rawUrl);
    const { siteUrl } = this.ownSite();
    const res = await this.request(`${record.url}/api/entries`, { method: 'POST', body: { siteUrl } });
    const at = this.now().toISOString();
    if (res.status === 200 || res.status === 201) {
      return this.update(record.url, {
        listMe: true,
        state: 'listed',
        lastListedAt: at,
        lastError: undefined,
        pendingPingFor: undefined,
        pendingSince: undefined,
      });
    }
    const code = errorCode(res);
    const message = errorMessage(res, `${record.title} couldn't list your site`);
    if (code === 'entry_blocked') {
      this.update(record.url, { listMe: false, state: 'blocked', lastError: message });
    } else if (code === 'key_changed') {
      this.update(record.url, { listMe: false, state: 'key-changed', lastError: message });
    }
    throw new Error(message);
  }

  /**
   * Removes the persona's listing with a request signed by the site key (the hub checks it
   * against the key it pinned). A listing the hub no longer has counts as removed.
   */
  public async unlistSite(rawUrl: string): Promise<WebringHubRecord> {
    const record = this.find(rawUrl);
    const profile = this.db.getProfile();
    const siteUrl = normalizeSiteUrl(profile.siteUrl);
    const did = siteUrlToDidWeb(siteUrl);

    const nonceRes = await this.request(`${record.url}/api/nonce`, { method: 'GET' });
    const nonce = str((nonceRes.json as { nonce?: unknown } | undefined)?.nonce, 128);
    if (nonceRes.status !== 200 || !nonce) {
      throw new Error(errorMessage(nonceRes, `${record.title} didn't hand out a removal code`));
    }
    const createdAt = this.now().toISOString();
    // The private key is used here, in the engine, and never leaves it
    const signature = signWebringHubPayload(
      { action: 'remove', siteUrl, did, nonce, createdAt },
      this.db.getKeys().privateKeyPem
    );
    const res = await this.request(`${record.url}/api/entries/${encodeURIComponent(did)}/remove`, {
      method: 'POST',
      body: { siteUrl, did, nonce, createdAt, signature },
    });
    if (res.status === 204 || res.status === 200 || res.status === 404) {
      return this.update(record.url, {
        listMe: false,
        state: 'not-listed',
        lastError: undefined,
        pendingPingFor: undefined,
        pendingSince: undefined,
      });
    }
    const message = errorMessage(res, `${record.title} didn't remove your listing`);
    this.update(record.url, { lastError: message });
    throw new Error(message);
  }

  /**
   * Called after a successful publish: every hub the site is listed in should re-read it
   * once the live site shows this publish.
   */
  public markPublished(manifestUpdatedAt: string | undefined): void {
    if (!manifestUpdatedAt) return;
    const at = this.now().toISOString();
    const all = this.db.getWebringHubs();
    let changed = false;
    for (const d of all) {
      if (!d.listMe) continue;
      // A newer publish replaces any older one still waiting, and restarts the wait
      d.pendingPingFor = manifestUpdatedAt;
      d.pendingSince = at;
      changed = true;
    }
    if (changed) this.db.saveWebringHubs(all);
  }

  /** True when some listed hub is still waiting for a ping. */
  public hasPendingPings(): boolean {
    return this.db.getWebringHubs().some((d) => d.listMe && d.pendingPingFor);
  }

  /**
   * Sends waiting pings: for each listed hub with a pending publish, checks that the live
   * manifest is at least that new, then asks the hub to re-read the site. Best effort; it
   * never throws, and a site that isn't live yet stays pending (up to a day).
   */
  public async flushPendingPings(): Promise<WebringHubPingResult[]> {
    const pending = this.db.getWebringHubs().filter((d) => d.listMe && d.pendingPingFor);
    if (pending.length === 0) return [];
    const now = this.now();
    const profile = this.db.getProfile();
    const siteUrl = normalizeSiteUrl(profile.siteUrl);
    const did = siteUrlToDidWeb(siteUrl);

    let liveUpdatedAt = '';
    try {
      const manifest = (await this.fetchJson(`${siteUrl}/api/manifest.json?check=${now.getTime()}`)) as
        | { updatedAt?: unknown }
        | undefined;
      liveUpdatedAt = typeof manifest?.updatedAt === 'string' ? manifest.updatedAt : '';
    } catch {
      liveUpdatedAt = '';
    }

    const results: WebringHubPingResult[] = [];
    for (const d of pending) {
      const target = d.pendingPingFor!;
      if (!liveUpdatedAt || liveUpdatedAt < target) {
        const since = Date.parse(d.pendingSince || '') || now.getTime();
        if (now.getTime() - since > WEBRING_HUB_PING_MAX_WAIT_MS) {
          this.update(d.url, {
            pendingPingFor: undefined,
            pendingSince: undefined,
            lastError: "Your live site didn't show the latest publish within a day, so the Webring Hub wasn't asked to re-read it.",
          });
          results.push({ url: d.url, outcome: 'dropped' });
        } else {
          results.push({ url: d.url, outcome: 'waiting' });
        }
        continue;
      }
      try {
        const res = await this.request(`${d.url}/api/entries/${encodeURIComponent(did)}/refresh`, { method: 'POST' });
        const at = this.now().toISOString();
        if (res.status === 200) {
          this.update(d.url, {
            state: 'listed',
            lastPingAt: at,
            lastError: undefined,
            pendingPingFor: undefined,
            pendingSince: undefined,
          });
          results.push({ url: d.url, outcome: 'pinged' });
        } else if (res.status === 404) {
          // The operator removed or blocked the listing: respect that, don't re-submit
          const message = `${d.title} no longer lists your site. List it again if you want to be included.`;
          this.update(d.url, {
            listMe: false,
            state: 'not-listed',
            lastError: message,
            pendingPingFor: undefined,
            pendingSince: undefined,
          });
          results.push({ url: d.url, outcome: 'not-listed', message });
        } else if (errorCode(res) === 'key_changed') {
          const message = errorMessage(res, 'The Webring Hub pinned a different key');
          this.update(d.url, { state: 'key-changed', lastError: message, pendingPingFor: undefined, pendingSince: undefined });
          results.push({ url: d.url, outcome: 'key-changed', message });
        } else {
          const message = errorMessage(res, `${d.title} couldn't re-read your site`);
          this.update(d.url, { lastError: message, pendingPingFor: undefined, pendingSince: undefined });
          results.push({ url: d.url, outcome: 'error', message });
        }
      } catch (err) {
        // Unreachable hub: keep it pending for the next try
        const message = err instanceof Error ? err.message : String(err);
        this.update(d.url, { lastError: message });
        results.push({ url: d.url, outcome: 'error', message });
      }
    }
    return results;
  }
}
