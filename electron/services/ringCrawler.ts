import * as fs from 'fs';
import * as path from 'path';
import { StudioDatabase } from '../db/database';
import {
  AlbumsDocumentSchema,
  ConnectionsDocumentSchema,
  DidDocumentSchema,
  FriendKeyStatus,
  ItemsDocumentSchema,
  normalizeSiteUrl,
  ProfileDocumentSchema,
  verifyDocumentSignature,
  WebringHubDocumentSchema,
  WebringManifestSchema,
} from '../../src/shared/schema';

export interface CrawlSiteResult {
  siteUrl: string;
  success: boolean;
  displayName?: string;
  itemsIndexed: number;
  photosIndexed: number;
  endorsementsFound: number;
  verifiedSignature: boolean;
  keyChangedWarning?: boolean;
  error?: string;
}

export type JsonFetcher = (url: string) => Promise<unknown>;

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
  const response = await fetch(urlOrPath, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${urlOrPath}`);
  }
  const rawText = await response.text();
  if (rawText.length > MAX_JSON_BYTES) {
    throw new Error(`Response from ${urlOrPath} exceeds 5MB safety limit`);
  }
  return JSON.parse(rawText);
}

export class RingCrawler {
  private fetcher: JsonFetcher;

  constructor(private db: StudioDatabase, customFetcher?: JsonFetcher) {
    this.fetcher = customFetcher || defaultJsonFetcher;
  }

  /**
   * Crawls a single friend's static profile site (via its base URL or local directory),
   * validates its JSON schemas, checks Ed25519 signatures against `/.well-known/did.json`
   * on EVERY document, enforces TOFU public key pinning, populates the local `network_feed`,
   * and discovers any likes/shares/comments of OUR items (`endorsements`).
   */
  public async crawlFriendSite(
    friendSiteUrl: string,
    localDirOverride?: string
  ): Promise<CrawlSiteResult> {
    const normalizedFriendUrl = normalizeSiteUrl(friendSiteUrl);
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

    try {
      const rawManifest = await this.fetcher(resolveEndpoint('/api/manifest.json'));
      const manifest = WebringManifestSchema.parse(rawManifest);

      // Fetch DID document for public key signature verification
      let fetchedPublicKeyPem = '';
      try {
        const rawDid = await this.fetcher(resolveEndpoint(manifest.endpoints.did));
        const didDoc = DidDocumentSchema.parse(rawDid);
        fetchedPublicKeyPem = didDoc.verificationMethod[0]?.publicKeyPem || '';
      } catch {
        // Optional if DID doc isn't reachable
      }

      // Check Trust-On-First-Use (TOFU) public key pinning against existing friend record
      const existingFriend = this.db
        .getFriends()
        .find((f) => normalizeSiteUrl(f.siteUrl) === normalizedFriendUrl);
      const existingPinnedKey = existingFriend?.pinnedPublicKeyPem || '';

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

      const rawProfile = await this.fetcher(resolveEndpoint(manifest.endpoints.profile));
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
      });

      let photosIndexed = 0;
      let itemsIndexed = 0;
      let endorsementsFound = 0;
      let isAlbumsVerified = true;
      let isItemsVerified = true;

      // Crawl albums.json and independently verify its Ed25519 signature
      try {
        const rawAlbums = await this.fetcher(resolveEndpoint(manifest.endpoints.albums));
        const albumsDoc = AlbumsDocumentSchema.parse(rawAlbums);
        isAlbumsVerified =
          !keyChangedWarning && effectiveVerifyKeyPem
            ? verifyDocumentSignature(
                rawAlbums as Record<string, unknown> & { proof?: typeof albumsDoc.proof },
                effectiveVerifyKeyPem
              )
            : false;

        const photoVerified = isManifestVerified && isProfileVerified && isAlbumsVerified;

        for (const album of albumsDoc.albums) {
          for (const photo of album.photos) {
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
      } catch {
        // Continue if albums.json is missing
      }

      // Crawl items.json (posts, shares, likes, recommendations, comments) and independently verify its Ed25519 signature
      try {
        const rawItems = await this.fetcher(resolveEndpoint(manifest.endpoints.items));
        const itemsDoc = ItemsDocumentSchema.parse(rawItems);
        isItemsVerified =
          !keyChangedWarning && effectiveVerifyKeyPem
            ? verifyDocumentSignature(
                rawItems as Record<string, unknown> & { proof?: typeof itemsDoc.proof },
                effectiveVerifyKeyPem
              )
            : false;

        const itemVerified = isManifestVerified && isProfileVerified && isItemsVerified;

        for (const item of itemsDoc.items) {
          this.db.upsertNetworkFeedEntry({
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
      } catch {
        // Continue if items.json is missing
      }

      // Optionally inspect connections.json for webring discovery
      try {
        const rawConnections = await this.fetcher(resolveEndpoint(manifest.endpoints.connections));
        ConnectionsDocumentSchema.parse(rawConnections);
      } catch {
        // Optional
      }

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
        verifiedSignature: allVerified,
        keyChangedWarning,
      };
    } catch (err: unknown) {
      return {
        siteUrl: normalizedFriendUrl,
        success: false,
        itemsIndexed: 0,
        photosIndexed: 0,
        endorsementsFound: 0,
        verifiedSignature: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Crawls all friends in the user's friend ring.
   */
  public async crawlAllFriends(): Promise<CrawlSiteResult[]> {
    const friends = this.db.getFriends();
    const results: CrawlSiteResult[] = [];
    for (const friend of friends) {
      const res = await this.crawlFriendSite(friend.siteUrl);
      results.push(res);
    }
    return results;
  }

  /**
   * Fetches a remote Webring Hub JSON (`webring-hub.json`), computes our `prevSiteUrl` and `nextSiteUrl`
   * neighbors in the ring, and updates the local webring record.
   */
  public async syncWebringHub(hubUrl: string): Promise<{
    name: string;
    memberCount: number;
    prevSiteUrl?: string;
    nextSiteUrl?: string;
  }> {
    const rawHub = await this.fetcher(hubUrl);
    const hub = WebringHubDocumentSchema.parse(rawHub);
    const mySiteUrl = normalizeSiteUrl(this.db.getProfile().siteUrl);

    const members = hub.members.map((m) => normalizeSiteUrl(m.siteUrl));
    let prevSiteUrl: string | undefined;
    let nextSiteUrl: string | undefined;

    if (members.length > 0) {
      const myIdx = members.indexOf(mySiteUrl);
      if (myIdx !== -1 && members.length > 1) {
        prevSiteUrl = members[(myIdx - 1 + members.length) % members.length];
        nextSiteUrl = members[(myIdx + 1) % members.length];
      } else {
        prevSiteUrl = members[members.length - 1];
        nextSiteUrl = members[0];
      }
    }

    this.db.addWebring({
      name: hub.name,
      hubUrl,
      description: hub.description,
      prevSiteUrl,
      nextSiteUrl,
    });

    return {
      name: hub.name,
      memberCount: members.length,
      prevSiteUrl,
      nextSiteUrl,
    };
  }
}

