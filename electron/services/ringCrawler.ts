import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import * as zlib from 'zlib';
import { StudioDatabase } from '../db/database';
import {
  AlbumsDocumentSchema,
  ConnectionsDocumentSchema,
  DidDocumentSchema,
  documentFingerprint,
  FriendKeyStatus,
  isUrlWithinSite,
  ItemsDocumentSchema,
  ManifestDocumentKey,
  normalizeSiteUrl,
  ProfileDocumentSchema,
  verifyDocumentSignature,
  WebringManifestSchema,
} from '../../src/shared/schema';
import {
  guardedLookup,
  isPrivateNetworkAddress,
  PrivateNetworkAddressError,
  privatePeersAllowed,
} from '../security/networkGuard';

export interface CrawlSiteResult {
  siteUrl: string;
  success: boolean;
  displayName?: string;
  itemsIndexed: number;
  photosIndexed: number;
  endorsementsFound: number;
  /** Entries whose canonical URL pointed outside this friend's site (spoofing attempts). */
  entriesRejected: number;
  /** Feed rows and endorsements removed because the friend no longer publishes them. */
  entriesPruned: number;
  verifiedSignature: boolean;
  keyChangedWarning?: boolean;
  /** Set when the crawl was skipped because the site is blocked. */
  blocked?: boolean;
  /** Documents the host said hadn't changed since the last sync, so they weren't downloaded. */
  unchanged?: string[];
  /** Set when Sync All skipped this friend because recent syncs couldn't reach it. */
  deferred?: boolean;
  /** After a failed sync: when Sync All will try this friend again. */
  retryAfter?: string;
  error?: string;
}

export type JsonFetcher = (url: string) => Promise<unknown>;

export interface FetchValidators {
  etag: string;
  lastModified: string;
}

/** A JSON fetch that can ask the host whether the file changed (ETag / Last-Modified). */
export type ConditionalJsonFetcher = (
  url: string,
  validators: FetchValidators | null
) => Promise<{ notModified: true } | { notModified?: false; json: unknown; etag?: string; lastModified?: string }>;

/** HTTP(S) URLs are asked conditionally; local paths are always read in full. */
export const defaultConditionalJsonFetcher: ConditionalJsonFetcher = async (url, validators) => {
  if (!/^https?:\/\//i.test(url)) return { json: await defaultJsonFetcher(url) };
  const res = await fetchPublic(url, { accept: 'application/json', maxBytes: MAX_JSON_BYTES, validators, compressed: true });
  if (res.status === 'not-modified') return { notModified: true };
  return { json: JSON.parse(res.body.toString('utf8')), etag: res.etag, lastModified: res.lastModified };
};

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/** Downloads an image from the public internet (same guards as the crawler), up to 15 MB. */
export async function fetchPublicImage(url: string): Promise<{ body: Buffer; contentType: string }> {
  const res = await fetchPublic(url, { accept: 'image/*', maxBytes: MAX_IMAGE_BYTES, validators: null });
  if (res.status === 'not-modified') throw new Error('Unexpected 304');
  if (!/^image\//i.test(res.contentType)) throw new Error(`Not an image: ${res.contentType || 'unknown type'}`);
  return { body: res.body, contentType: res.contentType };
}

const MAX_JSON_BYTES = 5 * 1024 * 1024; // 5 MB limit per crawled JSON document

/**
 * Default fetcher that supports both HTTP(S) URLs and local `file://` or directory paths
 * (making local multi-site testing and offline ring folders work seamlessly).
 */
export async function defaultJsonFetcher(urlOrPath: string): Promise<unknown> {
  if (urlOrPath.startsWith('file://')) {
    const filePath = new URL(urlOrPath).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_JSON_BYTES) {
      throw new Error(`File exceeds 5MB limit: ${filePath}`);
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  }
  if (!/^https?:\/\//i.test(urlOrPath) && fs.existsSync(urlOrPath)) {
    const stat = fs.statSync(urlOrPath);
    if (stat.size > MAX_JSON_BYTES) {
      throw new Error(`File exceeds 5MB limit: ${urlOrPath}`);
    }
    const raw = fs.readFileSync(urlOrPath, 'utf8');
    return JSON.parse(raw);
  }
  const res = await fetchPublic(urlOrPath, { accept: 'application/json', maxBytes: MAX_JSON_BYTES, validators: null, compressed: true });
  if (res.status === 'not-modified') throw new Error(`Unexpected 304 fetching ${urlOrPath}`);
  return JSON.parse(res.body.toString('utf8'));
}

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 10000;

type PublicFetchResult =
  | { status: 'not-modified' }
  | { status: 'ok'; body: Buffer; contentType: string; etag: string; lastModified: string };

interface PublicFetchOptions {
  accept: string;
  /** Limit on the body after unpacking, so a small compressed file can't expand without bound. */
  maxBytes: number;
  validators: FetchValidators | null;
  /** Ask for gzip / brotli (JSON compresses about 5x; images don't, so they don't ask). */
  compressed?: boolean;
}

/** Errors where the connection dropped (often a reused keep-alive socket the host had closed). */
function isConnectionReset(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ECONNRESET' || code === 'EPIPE';
}

/**
 * GETs a URL on the public internet only (see `electron/security/networkGuard.ts`). Every hop,
 * including redirects, is checked against the address actually connected to. With validators,
 * the host can answer 304 Not Modified instead of sending the file again. A dropped connection
 * is retried once; timeouts aren't, so an unreachable site costs one timeout.
 */
async function fetchPublic(rawUrl: string, options: PublicFetchOptions): Promise<PublicFetchResult> {
  try {
    return await fetchPublicOnce(rawUrl, options);
  } catch (err) {
    if (!isConnectionReset(err)) throw err;
    return fetchPublicOnce(rawUrl, options);
  }
}

function fetchPublicOnce(
  rawUrl: string,
  options: PublicFetchOptions,
  redirectsLeft = MAX_REDIRECTS
): Promise<PublicFetchResult> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      reject(new Error(`Invalid URL: ${rawUrl}`));
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      reject(new Error(`Unsupported protocol in ${rawUrl}`));
      return;
    }
    // Node skips the DNS lookup for IP literals, so check those here
    const literalHost = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(literalHost) && !privatePeersAllowed() && isPrivateNetworkAddress(literalHost)) {
      reject(new PrivateNetworkAddressError(url.hostname, literalHost));
      return;
    }

    const client = url.protocol === 'https:' ? https : http;
    const req = client.get(
      url,
      {
        // Some hosts (including api.github.com) refuse requests without a User-Agent
        headers: {
          Accept: options.accept,
          'User-Agent': 'WebringStudio/1.0 (+ring crawler)',
          ...(options.compressed ? { 'Accept-Encoding': 'gzip, br' } : {}),
          ...(options.validators?.etag ? { 'If-None-Match': options.validators.etag } : {}),
          ...(options.validators?.lastModified ? { 'If-Modified-Since': options.validators.lastModified } : {}),
        },
        lookup: guardedLookup,
        timeout: FETCH_TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status === 304 && options.validators) {
          res.resume();
          resolve({ status: 'not-modified' });
          return;
        }
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) {
            reject(new Error(`Too many redirects fetching ${rawUrl}`));
            return;
          }
          fetchPublicOnce(new URL(res.headers.location, url).toString(), options, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`HTTP ${status} fetching ${rawUrl}`));
          return;
        }
        const header = (name: string) => {
          const value = res.headers[name];
          return (Array.isArray(value) ? value[0] : value || '').slice(0, 512);
        };
        const encoding = header('content-encoding').trim().toLowerCase();
        const decoder =
          encoding === 'gzip' || encoding === 'x-gzip'
            ? zlib.createGunzip()
            : encoding === 'br'
              ? zlib.createBrotliDecompress()
              : encoding === 'deflate'
                ? zlib.createInflate()
                : null;
        if (!decoder && encoding && encoding !== 'identity') {
          res.resume();
          reject(new Error(`Unsupported content encoding "${encoding}" fetching ${rawUrl}`));
          return;
        }
        const fail = (err: Error) => {
          decoder?.destroy();
          req.destroy(err);
          reject(err);
        };
        const body = decoder ? res.pipe(decoder) : res;
        const chunks: Buffer[] = [];
        let total = 0;
        body.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > options.maxBytes) {
            fail(new Error(`Response from ${rawUrl} exceeds the ${Math.round(options.maxBytes / 1048576)}MB safety limit`));
            return;
          }
          chunks.push(chunk);
        });
        body.on('end', () =>
          resolve({
            status: 'ok',
            body: Buffer.concat(chunks),
            contentType: header('content-type'),
            etag: header('etag'),
            lastModified: header('last-modified'),
          })
        );
        res.on('error', reject);
        decoder?.on('error', (err) => fail(new Error(`Couldn't unpack ${rawUrl}: ${err.message}`)));
      }
    );
    // `timeout` only covers idle sockets; also cap the whole request
    const deadline = setTimeout(
      () => req.destroy(new Error(`Timed out fetching ${rawUrl}`)),
      FETCH_TIMEOUT_MS
    );
    req.on('close', () => clearTimeout(deadline));
    req.on('timeout', () => req.destroy(new Error(`Timed out fetching ${rawUrl}`)));
    req.on('error', reject);
  });
}

/**
 * Friend sites crawled at once by Sync All. Each site's own documents are still fetched one
 * after another; the local load test (`npm run loadtest:sync`) measures the effect.
 */
export const SYNC_CONCURRENCY = 16;

/** Reported by Sync All after each friend, so the Studio window can show progress. */
export interface SyncProgress {
  done: number;
  total: number;
  result: CrawlSiteResult;
}

/** Thrown inside a document's section to skip it when the host reported it unchanged. */
class UnchangedDocument extends Error {}

export class RingCrawler {
  private conditionalFetcher: ConditionalJsonFetcher;

  /**
   * `customFetcher` replaces the network (tests, offline folders) and always fetches in full;
   * `conditionalFetcher` lets a friend's documents skip downloading when unchanged.
   */
  constructor(private db: StudioDatabase, customFetcher?: JsonFetcher, conditionalFetcher?: ConditionalJsonFetcher) {
    this.conditionalFetcher =
      conditionalFetcher ||
      (customFetcher ? async (url: string) => ({ json: await customFetcher(url) }) : defaultConditionalJsonFetcher);
  }

  /**
   * Crawls a single friend's static profile site (via its base URL or local directory),
   * validates its JSON schemas, checks Ed25519 signatures against `/.well-known/did.json`
   * on EVERY document, enforces TOFU public key pinning, populates the local `network_feed`,
   * and discovers any likes/shares/comments of OUR items (`endorsements`).
   */
  public async crawlFriendSite(friendSiteUrl: string, localDirOverride?: string): Promise<CrawlSiteResult> {
    return this.crawlAndTrack(friendSiteUrl, localDirOverride, true);
  }

  /** Crawls one site and updates its sync backoff: a failure delays the next Sync All attempt. */
  private async crawlAndTrack(
    friendSiteUrl: string,
    localDirOverride: string | undefined,
    applyFeedWindow: boolean
  ): Promise<CrawlSiteResult> {
    const result = await this.crawlSite(friendSiteUrl, localDirOverride, applyFeedWindow);
    if (localDirOverride || result.blocked) return result;
    if (result.success) {
      this.db.clearSyncFailures(result.siteUrl);
    } else {
      const retryAfter = this.db.recordSyncFailure(result.siteUrl);
      if (retryAfter) result.retryAfter = retryAfter;
    }
    return result;
  }

  private async crawlSite(
    friendSiteUrl: string,
    localDirOverride: string | undefined,
    applyFeedWindow: boolean
  ): Promise<CrawlSiteResult> {
    const normalizedFriendUrl = normalizeSiteUrl(friendSiteUrl);
    if (this.db.getModerationAction(normalizedFriendUrl) === 'block') {
      return {
        siteUrl: normalizedFriendUrl,
        success: false,
        itemsIndexed: 0,
        photosIndexed: 0,
        endorsementsFound: 0,
        entriesRejected: 0,
        entriesPruned: 0,
        verifiedSignature: false,
        blocked: true,
        error: 'Site is blocked; skipped crawl.',
      };
    }
    const myProfile = this.db.getProfile();
    const mySiteUrl = normalizeSiteUrl(myProfile.siteUrl);

    const resolveEndpoint = (relEndpoint: string): string => {
      let cleanPath = relEndpoint.trim();
      if (/^https?:\/\//i.test(cleanPath)) {
        const parsed = new URL(cleanPath);
        const baseOrigin = new URL(normalizedFriendUrl).origin;
        if (parsed.origin !== baseOrigin) {
          throw new Error(`Cross-origin endpoint rejected: ${relEndpoint}`);
        }
        cleanPath = parsed.pathname;
      }
      const cleanRel = cleanPath.replace(/^\/+/, '');
      if (cleanRel.split('/').includes('..') || cleanRel.includes('\\')) {
        throw new Error(`Invalid relative endpoint path: ${relEndpoint}`);
      }
      if (localDirOverride) {
        return path.join(localDirOverride, cleanRel);
      }
      return `${normalizedFriendUrl}/${cleanRel}`;
    };

    const unchanged: string[] = [];
    // The manifest, did.json and profile are small and needed in full every time, so when the
    // manifest lists the same fingerprint as the copy saved when they last verified (no request),
    // or the host answers 304, that copy is used and checked again as if just downloaded.
    const fetchWithSavedCopy = async (endpoint: string, fingerprint?: string) => {
      const url = resolveEndpoint(endpoint);
      const remote = /^https?:\/\//i.test(url);
      const saved = remote ? this.db.getCachedDocument(url) : null;
      if (saved && fingerprint && saved.fingerprint === fingerprint) {
        unchanged.push(endpoint);
        return { url, remote, json: JSON.parse(saved.body) as unknown, etag: saved.etag, lastModified: saved.lastModified };
      }
      const validators = saved && (saved.etag || saved.lastModified) ? { etag: saved.etag, lastModified: saved.lastModified } : null;
      const res = await this.conditionalFetcher(url, validators);
      if (res.notModified) {
        if (!saved) throw new Error(`Unexpected 304 fetching ${url}`);
        unchanged.push(endpoint);
        return { url, remote, json: JSON.parse(saved.body) as unknown, etag: saved.etag, lastModified: saved.lastModified };
      }
      return { url, remote, json: res.json, etag: res.etag, lastModified: res.lastModified };
    };
    type SavedCopyFetch = Awaited<ReturnType<typeof fetchWithSavedCopy>>;

    try {
      const manifestFetch = await fetchWithSavedCopy('/api/manifest.json');
      const rawManifest = manifestFetch.json;
      const manifest = WebringManifestSchema.parse(rawManifest);
      // Fingerprints the manifest lists for each document (sites from older versions list none)
      const listedFingerprint = (key: ManifestDocumentKey) => manifest.documents?.[key]?.sha256;

      // Fetch DID document for public key signature verification
      let fetchedPublicKeyPem = '';
      let didFetch: SavedCopyFetch | null = null;
      try {
        didFetch = await fetchWithSavedCopy(manifest.endpoints.did, listedFingerprint('did'));
        const didDoc = DidDocumentSchema.parse(didFetch.json);
        fetchedPublicKeyPem = didDoc.verificationMethod[0]?.publicKeyPem || '';
      } catch {
        // Optional if DID doc isn't reachable
        didFetch = null;
      }

      // Check Trust-On-First-Use (TOFU) public key pinning against existing friend record
      const existingFriend = this.db.getFriendBySiteUrl(normalizedFriendUrl);
      // One pinned key per site, shared with ring hubs and members (site_keys)
      const existingPinnedKey =
        this.db.getSiteKey(normalizedFriendUrl)?.publicKeyPem || existingFriend?.pinnedPublicKeyPem || '';
      if (fetchedPublicKeyPem) {
        // Pins on first sight; marks the site 'changed' if the key differs from the pinned one
        this.db.pinSiteKey(normalizedFriendUrl, manifest.did, fetchedPublicKeyPem);
      }

      let keyChangedWarning = false;
      let keyStatus: FriendKeyStatus = existingFriend?.keyStatus || 'unverified';
      let pinnedKeyToSave = existingPinnedKey;
      let effectiveVerifyKeyPem = fetchedPublicKeyPem;

      if (fetchedPublicKeyPem) {
        if (existingPinnedKey && existingPinnedKey !== fetchedPublicKeyPem) {
          // Domain key changed unexpectedly! Flag warning and refuse to verify with the unpinned key
          keyChangedWarning = true;
          keyStatus = 'changed';
          pinnedKeyToSave = existingPinnedKey;
          effectiveVerifyKeyPem = existingPinnedKey;
        } else {
          keyStatus = 'pinned';
          pinnedKeyToSave = fetchedPublicKeyPem;
          effectiveVerifyKeyPem = fetchedPublicKeyPem;
        }
      }

      const profileFetch = await fetchWithSavedCopy(manifest.endpoints.profile, listedFingerprint('profile'));
      const rawProfile = profileFetch.json;
      const profile = ProfileDocumentSchema.parse(rawProfile);

      const isManifestVerified =
        !keyChangedWarning && effectiveVerifyKeyPem
          ? manifest.proof
            ? verifyDocumentSignature(
                rawManifest as Record<string, unknown> & { proof?: typeof manifest.proof },
                effectiveVerifyKeyPem
              )
            : true
          : false;

      const isProfileVerified =
        !keyChangedWarning && effectiveVerifyKeyPem
          ? verifyDocumentSignature(
              rawProfile as Record<string, unknown> & { proof?: typeof profile.proof },
              effectiveVerifyKeyPem
            )
          : false;

      // Update friend record with latest profile metadata & TOFU key state
      this.db.addOrUpdateFriend({
        siteUrl: normalizedFriendUrl,
        displayName: profile.displayName,
        handle: profile.handle,
        avatarUrl: profile.avatarUrl,
        bio: profile.bio,
        did: profile.did,
        pinnedPublicKeyPem: pinnedKeyToSave || undefined,
        keyStatus,
        lastCrawledAt: new Date().toISOString(),
      });

      // Save copies only of documents that verified; otherwise forget them so they're downloaded next time
      const keepCopies = isManifestVerified && isProfileVerified;
      for (const doc of [manifestFetch, profileFetch, ...(didFetch && fetchedPublicKeyPem ? [didFetch] : [])]) {
        if (!doc.remote) continue;
        if (keepCopies) {
          this.db.setFetchValidators(
            doc.url,
            normalizedFriendUrl,
            { etag: doc.etag, lastModified: doc.lastModified },
            JSON.stringify(doc.json),
            documentFingerprint(doc.json as Record<string, unknown>)
          );
        } else {
          this.db.setFetchValidators(doc.url, normalizedFriendUrl, {});
        }
      }

      let photosIndexed = 0;
      let itemsIndexed = 0;
      let endorsementsFound = 0;
      let entriesRejected = 0;
      let entriesPruned = 0;
      let isAlbumsVerified = true;
      let isItemsVerified = true;
      // Entries older than the feed window aren't added (endorsements of our items still are)
      const feedCutoff = this.db.feedCutoffIso();
      const inWindow = (createdAt: string) => !feedCutoff || createdAt >= feedCutoff;
      // items.json and albums.json are asked for conditionally: an unchanged file isn't downloaded
      // or reprocessed. Validators are kept only for files that verified, so anything else is
      // fetched in full next time.
      // A document whose fingerprint in the verified manifest matches the copy last processed
      // isn't requested at all.
      const fetchDocument = async (endpoint: string, fingerprint?: string) => {
        const url = resolveEndpoint(endpoint);
        const remote = /^https?:\/\//i.test(url);
        const trusted = remote && !keyChangedWarning;
        if (trusted && isManifestVerified && fingerprint && this.db.getFetchedFingerprint(url) === fingerprint) {
          unchanged.push(endpoint);
          return { url, notModified: true as const };
        }
        const validators = trusted ? this.db.getFetchValidators(url) : null;
        const res = await this.conditionalFetcher(url, validators);
        if (res.notModified) {
          unchanged.push(endpoint);
          return { url, notModified: true as const };
        }
        return { url, notModified: false as const, json: res.json, remote, etag: res.etag, lastModified: res.lastModified };
      };
      // The fingerprint is of the copy actually processed: if a host served a stale file, it won't
      // match the manifest, so the next sync fetches it again
      const rememberValidators = (doc: { url: string; remote?: boolean; json: unknown; etag?: string; lastModified?: string }) => {
        if (!doc.remote) return;
        this.db.setFetchValidators(
          doc.url,
          normalizedFriendUrl,
          { etag: doc.etag, lastModified: doc.lastModified },
          '',
          documentFingerprint(doc.json as Record<string, unknown>)
        );
      };

      // Crawl albums.json and independently verify its Ed25519 signature
      try {
        const albumsFetch = await fetchDocument(manifest.endpoints.albums, listedFingerprint('albums'));
        if (albumsFetch.notModified) throw new UnchangedDocument();
        const rawAlbums = albumsFetch.json;
        const albumsDoc = AlbumsDocumentSchema.parse(rawAlbums);
        isAlbumsVerified =
          !keyChangedWarning && effectiveVerifyKeyPem
            ? verifyDocumentSignature(
                rawAlbums as Record<string, unknown> & { proof?: typeof albumsDoc.proof },
                effectiveVerifyKeyPem
              )
            : false;

        const photoVerified = isManifestVerified && isProfileVerified && isAlbumsVerified;
        const seenPhotoUrls: string[] = [];

        // One transaction per document: far faster than committing every row
        this.db.transaction(() => {
          for (const album of albumsDoc.albums) {
            for (const photo of album.photos) {
              if (!isUrlWithinSite(photo.canonicalUrl, normalizedFriendUrl)) {
                entriesRejected++;
                continue;
              }
              seenPhotoUrls.push(photo.canonicalUrl);
              if (!inWindow(photo.createdAt)) continue;
              const fullPhotoUrl = photo.url.startsWith('http')
                ? photo.url
                : `${normalizedFriendUrl}/${photo.url.replace(/^\/+/, '')}`;
              this.db.upsertNetworkFeedEntry({
                friendSiteUrl: normalizedFriendUrl,
                friendName: profile.displayName,
                friendAvatarUrl: profile.avatarUrl,
                friendDid: profile.did,
                entryType: 'photo',
                title: photo.caption || `${album.title} Photo`,
                canonicalUrl: photo.canonicalUrl,
                targetUrl: fullPhotoUrl,
                commentary: `Published in album "${album.title}"`,
                mediaUrl: fullPhotoUrl,
                tags: photo.tags.length > 0 ? photo.tags : album.tags,
                createdAt: photo.createdAt,
                verifiedSignature: photoVerified,
              });
              photosIndexed++;
            }
          }
        });

        // Only a verified document may delete rows, so a hijacked or tampered site can't wipe the feed
        if (photoVerified) {
          entriesPruned += this.db.pruneFriendFeed(normalizedFriendUrl, 'photos', seenPhotoUrls);
          rememberValidators(albumsFetch);
        }
      } catch {
        // Continue if albums.json is missing or unchanged
      }

      // Crawl items.json (posts, shares, likes, recommendations, comments) and independently verify its Ed25519 signature
      try {
        const itemsFetch = await fetchDocument(manifest.endpoints.items, listedFingerprint('items'));
        if (itemsFetch.notModified) throw new UnchangedDocument();
        const rawItems = itemsFetch.json;
        const itemsDoc = ItemsDocumentSchema.parse(rawItems);
        isItemsVerified =
          !keyChangedWarning && effectiveVerifyKeyPem
            ? verifyDocumentSignature(
                rawItems as Record<string, unknown> & { proof?: typeof itemsDoc.proof },
                effectiveVerifyKeyPem
              )
            : false;

        const itemVerified = isManifestVerified && isProfileVerified && isItemsVerified;
        const seenItemUrls: string[] = [];

        this.db.transaction(() => {
          for (const item of itemsDoc.items) {
            if (!isUrlWithinSite(item.canonicalUrl, normalizedFriendUrl)) {
              entriesRejected++;
              continue;
            }
            seenItemUrls.push(item.canonicalUrl);
            if (inWindow(item.createdAt)) this.db.upsertNetworkFeedEntry({
              friendSiteUrl: normalizedFriendUrl,
              friendName: profile.displayName,
              friendAvatarUrl: profile.avatarUrl,
              friendDid: profile.did,
              entryType: item.type,
              title: item.title,
              canonicalUrl: item.canonicalUrl,
              targetUrl: item.targetUrl,
              commentary: item.commentary,
              mediaUrl: item.mediaUrl,
              tags: item.tags,
              createdAt: item.createdAt,
              verifiedSignature: itemVerified,
            });
            itemsIndexed++;

            // Check if this friend liked/shared/recommended/commented on an item or photo belonging to OUR site!
            if (item.targetUrl.startsWith(mySiteUrl)) {
              this.db.upsertEndorsement({
                targetCanonicalUrl: item.targetUrl,
                authorSiteUrl: normalizedFriendUrl,
                authorName: profile.displayName,
                authorAvatarUrl: profile.avatarUrl,
                type: item.type,
                commentary: item.commentary,
                sourceItemUrl: item.canonicalUrl,
                createdAt: item.createdAt,
                verifiedSignature: itemVerified,
              });
              endorsementsFound++;
            }
          }
        });

        if (itemVerified) {
          // A friend who publishes only recent items has archived the older ones, not deleted them
          const since = itemsDoc.archive?.since;
          entriesPruned += this.db.pruneFriendFeed(normalizedFriendUrl, 'items', seenItemUrls, since);
          entriesPruned += this.db.pruneEndorsementsFrom(normalizedFriendUrl, seenItemUrls, since);
          rememberValidators(itemsFetch);
        }
      } catch {
        // Continue if items.json is missing or unchanged
      }

      // connections.json: does this friend list us back ("Mutual")? Only a verified copy that
      // belongs to this site can set or clear it; it's never re-published.
      try {
        const connectionsFetch = await fetchDocument(manifest.endpoints.connections, listedFingerprint('connections'));
        if (connectionsFetch.notModified) throw new UnchangedDocument();
        const rawConnections = connectionsFetch.json;
        const connections = ConnectionsDocumentSchema.parse(rawConnections);
        const connectionsVerified =
          !keyChangedWarning &&
          Boolean(effectiveVerifyKeyPem) &&
          Boolean(connections.proof) &&
          verifyDocumentSignature(
            rawConnections as Record<string, unknown> & { proof?: typeof connections.proof },
            effectiveVerifyKeyPem
          ) &&
          normalizeSiteUrl(connections.siteUrl) === normalizedFriendUrl &&
          connections.did === manifest.did;
        if (connectionsVerified) {
          this.db.setFriendListsMe(
            normalizedFriendUrl,
            connections.friends.some((f) => normalizeSiteUrl(f.siteUrl) === mySiteUrl)
          );
          rememberValidators(connectionsFetch);
        }
      } catch {
        // Optional: missing, unchanged or unverifiable leaves "Mutual" as it was
      }

      // Sync All does this once at the end instead of once per friend
      if (applyFeedWindow) entriesPruned += this.db.pruneFeedOutsideWindow();

      const allVerified =
        !keyChangedWarning &&
        isManifestVerified &&
        isProfileVerified &&
        isAlbumsVerified &&
        isItemsVerified;

      return {
        siteUrl: normalizedFriendUrl,
        success: true,
        displayName: profile.displayName,
        itemsIndexed,
        photosIndexed,
        endorsementsFound,
        entriesRejected,
        entriesPruned,
        verifiedSignature: allVerified,
        keyChangedWarning,
        ...(unchanged.length ? { unchanged } : {}),
      };
    } catch (err: unknown) {
      return {
        siteUrl: normalizedFriendUrl,
        success: false,
        itemsIndexed: 0,
        photosIndexed: 0,
        endorsementsFound: 0,
        entriesRejected: 0,
        entriesPruned: 0,
        verifiedSignature: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Crawls all friends in the user's friend ring, `concurrency` sites at a time, so slow or
   * unreachable sites don't hold up the rest. Results are in the same order as the friends.
   */
  public async crawlAllFriends(
    options: { concurrency?: number; onProgress?: (progress: SyncProgress) => void } = {}
  ): Promise<CrawlSiteResult[]> {
    const concurrency = options.concurrency ?? SYNC_CONCURRENCY;
    const friends = this.db.getFriends();
    // Friends that recent syncs couldn't reach wait out their backoff (a single-friend sync still tries)
    const retryTimes = this.db.getSyncRetryTimes();
    const results: CrawlSiteResult[] = new Array(friends.length);
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < friends.length) {
        const index = next++;
        const siteUrl = normalizeSiteUrl(friends[index].siteUrl);
        const retryAfter = retryTimes.get(siteUrl);
        results[index] = retryAfter
          ? {
              siteUrl,
              success: false,
              itemsIndexed: 0,
              photosIndexed: 0,
              endorsementsFound: 0,
              entriesRejected: 0,
              entriesPruned: 0,
              verifiedSignature: false,
              deferred: true,
              retryAfter,
              error: `Unreachable on recent syncs; next try after ${retryAfter}.`,
            }
          : await this.crawlAndTrack(siteUrl, undefined, false);
        options.onProgress?.({ done: ++done, total: friends.length, result: results[index] });
      }
    };
    const workers = Math.min(Math.max(1, Math.floor(concurrency)), friends.length);
    await Promise.all(Array.from({ length: workers }, worker));
    this.db.pruneFeedOutsideWindow();
    return results;
  }
}
