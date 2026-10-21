"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.RingCrawler = void 0;
exports.defaultJsonFetcher = defaultJsonFetcher;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const schema_1 = require("../../src/shared/schema");
const MAX_JSON_BYTES = 5 * 1024 * 1024; // 5 MB limit per crawled JSON document
/**
 * Default fetcher that supports both HTTP(S) URLs and local `file://` or directory paths
 * (making local multi-site testing and offline ring folders work seamlessly).
 */
async function defaultJsonFetcher(urlOrPath) {
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
class RingCrawler {
    db;
    fetcher;
    constructor(db, customFetcher) {
        this.db = db;
        this.fetcher = customFetcher || defaultJsonFetcher;
    }
    /**
     * Crawls a single friend's static profile site (via its base URL or local directory),
     * validates its JSON schemas, checks Ed25519 signatures against `/.well-known/did.json`
     * on EVERY document, enforces TOFU public key pinning, populates the local `network_feed`,
     * and discovers any likes/shares/comments of OUR items (`endorsements`).
     */
    async crawlFriendSite(friendSiteUrl, localDirOverride) {
        const normalizedFriendUrl = (0, schema_1.normalizeSiteUrl)(friendSiteUrl);
        const myProfile = this.db.getProfile();
        const mySiteUrl = (0, schema_1.normalizeSiteUrl)(myProfile.siteUrl);
        const resolveEndpoint = (relEndpoint) => {
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
            const manifest = schema_1.WebringManifestSchema.parse(rawManifest);
            // Fetch DID document for public key signature verification
            let fetchedPublicKeyPem = '';
            try {
                const rawDid = await this.fetcher(resolveEndpoint(manifest.endpoints.did));
                const didDoc = schema_1.DidDocumentSchema.parse(rawDid);
                fetchedPublicKeyPem = didDoc.verificationMethod[0]?.publicKeyPem || '';
            }
            catch {
                // Optional if DID doc isn't reachable
            }
            // Check Trust-On-First-Use (TOFU) public key pinning against existing friend record
            const existingFriend = this.db
                .getFriends()
                .find((f) => (0, schema_1.normalizeSiteUrl)(f.siteUrl) === normalizedFriendUrl);
            const existingPinnedKey = existingFriend?.pinnedPublicKeyPem || '';
            let keyChangedWarning = false;
            let keyStatus = existingFriend?.keyStatus || 'unverified';
            let pinnedKeyToSave = existingPinnedKey;
            let effectiveVerifyKeyPem = fetchedPublicKeyPem;
            if (fetchedPublicKeyPem) {
                if (existingPinnedKey && existingPinnedKey !== fetchedPublicKeyPem) {
                    // Domain key changed unexpectedly! Flag warning and refuse to verify with the unpinned key
                    keyChangedWarning = true;
                    keyStatus = 'changed';
                    pinnedKeyToSave = existingPinnedKey;
                    effectiveVerifyKeyPem = existingPinnedKey;
                }
                else {
                    keyStatus = 'pinned';
                    pinnedKeyToSave = fetchedPublicKeyPem;
                    effectiveVerifyKeyPem = fetchedPublicKeyPem;
                }
            }
            const rawProfile = await this.fetcher(resolveEndpoint(manifest.endpoints.profile));
            const profile = schema_1.ProfileDocumentSchema.parse(rawProfile);
            const isManifestVerified = !keyChangedWarning && effectiveVerifyKeyPem
                ? manifest.proof
                    ? (0, schema_1.verifyDocumentSignature)(rawManifest, effectiveVerifyKeyPem)
                    : true
                : false;
            const isProfileVerified = !keyChangedWarning && effectiveVerifyKeyPem
                ? (0, schema_1.verifyDocumentSignature)(rawProfile, effectiveVerifyKeyPem)
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
                const albumsDoc = schema_1.AlbumsDocumentSchema.parse(rawAlbums);
                isAlbumsVerified =
                    !keyChangedWarning && effectiveVerifyKeyPem
                        ? (0, schema_1.verifyDocumentSignature)(rawAlbums, effectiveVerifyKeyPem)
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
            }
            catch {
                // Continue if albums.json is missing
            }
            // Crawl items.json (posts, shares, likes, recommendations, comments) and independently verify its Ed25519 signature
            try {
                const rawItems = await this.fetcher(resolveEndpoint(manifest.endpoints.items));
                const itemsDoc = schema_1.ItemsDocumentSchema.parse(rawItems);
                isItemsVerified =
                    !keyChangedWarning && effectiveVerifyKeyPem
                        ? (0, schema_1.verifyDocumentSignature)(rawItems, effectiveVerifyKeyPem)
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
            }
            catch {
                // Continue if items.json is missing
            }
            // Optionally inspect connections.json for webring discovery
            try {
                const rawConnections = await this.fetcher(resolveEndpoint(manifest.endpoints.connections));
                schema_1.ConnectionsDocumentSchema.parse(rawConnections);
            }
            catch {
                // Optional
            }
            const allVerified = !keyChangedWarning &&
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
        }
        catch (err) {
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
    async crawlAllFriends() {
        const friends = this.db.getFriends();
        const results = [];
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
    async syncWebringHub(hubUrl) {
        const rawHub = await this.fetcher(hubUrl);
        const hub = schema_1.WebringHubDocumentSchema.parse(rawHub);
        const mySiteUrl = (0, schema_1.normalizeSiteUrl)(this.db.getProfile().siteUrl);
        const members = hub.members.map((m) => (0, schema_1.normalizeSiteUrl)(m.siteUrl));
        let prevSiteUrl;
        let nextSiteUrl;
        if (members.length > 0) {
            const myIdx = members.indexOf(mySiteUrl);
            if (myIdx !== -1 && members.length > 1) {
                prevSiteUrl = members[(myIdx - 1 + members.length) % members.length];
                nextSiteUrl = members[(myIdx + 1) % members.length];
            }
            else {
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
exports.RingCrawler = RingCrawler;
