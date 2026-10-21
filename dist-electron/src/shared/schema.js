"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebringHubDocumentSchema = exports.ConnectionsDocumentSchema = exports.EndorsementItemSchema = exports.WebringMembershipSchema = exports.FriendConnectionSchema = exports.FriendKeyStatusSchema = exports.FriendVisibilitySchema = exports.ItemsDocumentSchema = exports.SharedItemSchema = exports.SharedItemTypeSchema = exports.AlbumsDocumentSchema = exports.AlbumItemSchema = exports.PhotoItemSchema = exports.ProfileDocumentSchema = exports.AdsAddonSchema = exports.AnalyticsAddonSchema = exports.CommentConfigSchema = exports.ProfileThemeSchema = exports.WebringManifestSchema = exports.DidDocumentSchema = exports.SignatureProofSchema = exports.WEBRING_SCHEMA_VERSION = void 0;
exports.isValidGa4MeasurementId = isValidGa4MeasurementId;
exports.normalizeAdSensePublisherId = normalizeAdSensePublisherId;
exports.isValidAdSlotId = isValidAdSlotId;
exports.normalizeSiteUrl = normalizeSiteUrl;
exports.siteUrlToDidWeb = siteUrlToDidWeb;
exports.buildCanonicalUrl = buildCanonicalUrl;
exports.generateIdentityKeyPair = generateIdentityKeyPair;
exports.canonicalizeJson = canonicalizeJson;
exports.signDocument = signDocument;
exports.verifyDocumentSignature = verifyDocumentSignature;
exports.buildDidDocument = buildDidDocument;
exports.parseWebringUri = parseWebringUri;
exports.buildWebringUri = buildWebringUri;
const zod_1 = require("zod");
// Lazy loader for Node crypto so browser bundles don't warn on static import
function getNodeCrypto() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('crypto');
}
// ============================================================================
// 1. Standardized Webring & Federated Profile JSON Schemas (v1.0)
// ============================================================================
exports.WEBRING_SCHEMA_VERSION = '1.0.0';
/**
 * Cryptographic authorship proof attached to published JSON documents.
 * Uses Ed25519 keys exposed in /.well-known/did.json
 */
exports.SignatureProofSchema = zod_1.z.object({
    type: zod_1.z.literal('Ed25519Signature2020'),
    created: zod_1.z.string(),
    verificationMethod: zod_1.z.string(), // e.g., did:web:example.com#key-1
    signatureValue: zod_1.z.string(), // base64url encoded signature of canonical payload
});
/**
 * W3C / ATProto compatible did:web Document (/.well-known/did.json)
 */
exports.DidDocumentSchema = zod_1.z.object({
    '@context': zod_1.z.array(zod_1.z.string()),
    id: zod_1.z.string(), // did:web:domain.com
    alsoKnownAs: zod_1.z.array(zod_1.z.string()).optional(),
    verificationMethod: zod_1.z.array(zod_1.z.object({
        id: zod_1.z.string(),
        type: zod_1.z.string(),
        controller: zod_1.z.string(),
        publicKeyMultibase: zod_1.z.string().optional(),
        publicKeyPem: zod_1.z.string().optional(),
    })),
    service: zod_1.z.array(zod_1.z.object({
        id: zod_1.z.string(),
        type: zod_1.z.string(),
        serviceEndpoint: zod_1.z.string(),
    })),
});
/**
 * Site Manifest (/api/manifest.json)
 * Entrypoint for crawlers and other Electron Studio clients.
 */
exports.WebringManifestSchema = zod_1.z.object({
    schemaVersion: zod_1.z.string().default(exports.WEBRING_SCHEMA_VERSION),
    siteUrl: zod_1.z.string(),
    did: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
    endpoints: zod_1.z.object({
        did: zod_1.z.string().default('/.well-known/did.json'),
        profile: zod_1.z.string().default('/api/profile.json'),
        albums: zod_1.z.string().default('/api/albums.json'),
        items: zod_1.z.string().default('/api/items.json'),
        connections: zod_1.z.string().default('/api/connections.json'),
    }),
    stats: zod_1.z.object({
        albumCount: zod_1.z.number(),
        photoCount: zod_1.z.number(),
        itemCount: zod_1.z.number(),
        friendCount: zod_1.z.number(),
        webringCount: zod_1.z.number(),
    }),
    proof: exports.SignatureProofSchema.optional(),
});
/**
 * Theme options for the standalone Profile Website
 */
exports.ProfileThemeSchema = zod_1.z.enum([
    'neo-webring', // Classic indie web meets crisp modern cards
    'minimal-zine', // Editorial serif typography & clean whitespace
    'cyber-terminal', // High-contrast dark neon retro terminal
    'cozy-scrapbook', // Warm paper tones & polaroid photo frames
]);
/**
 * Profile Document (/api/profile.json)
 */
exports.CommentConfigSchema = zod_1.z.object({
    provider: zod_1.z.enum(['none', 'giscus', 'utterances']).default('none'),
    giscusRepo: zod_1.z.string().optional(),
    giscusRepoId: zod_1.z.string().optional(),
    giscusCategory: zod_1.z.string().optional(),
    giscusCategoryId: zod_1.z.string().optional(),
});
/**
 * Optional Profile Add-On 1: Google Analytics (GA4)
 */
exports.AnalyticsAddonSchema = zod_1.z.object({
    enabled: zod_1.z.boolean().default(false),
    measurementId: zod_1.z.string().default(''), // e.g., G-XXXXXXXXXX
    respectDoNotTrack: zod_1.z.boolean().default(true),
    anonymizeIp: zod_1.z.boolean().default(true),
    trackRingInteractions: zod_1.z.boolean().default(true),
});
/**
 * Optional Profile Add-On 2: Google AdSense / Ads Monetization
 */
exports.AdsAddonSchema = zod_1.z.object({
    enabled: zod_1.z.boolean().default(false),
    publisherId: zod_1.z.string().default(''), // e.g., ca-pub-1234567890123456
    enableAutoAds: zod_1.z.boolean().default(true),
    generateAdsTxt: zod_1.z.boolean().default(true),
    headerSlotId: zod_1.z.string().default(''),
    inFeedSlotId: zod_1.z.string().default(''),
    footerSlotId: zod_1.z.string().default(''),
});
function isValidGa4MeasurementId(rawId) {
    if (!rawId)
        return false;
    return /^G-[A-Z0-9]{4,20}$/i.test(rawId.trim());
}
function normalizeAdSensePublisherId(rawId) {
    if (!rawId)
        return '';
    const trimmed = rawId.trim();
    if (/^ca-pub-\d{10,20}$/i.test(trimmed))
        return trimmed.toLowerCase();
    if (/^pub-\d{10,20}$/i.test(trimmed))
        return `ca-${trimmed.toLowerCase()}`;
    return '';
}
function isValidAdSlotId(rawSlotId) {
    if (!rawSlotId)
        return false;
    return /^\d{5,20}$/.test(rawSlotId.trim());
}
exports.ProfileDocumentSchema = zod_1.z.object({
    schemaVersion: zod_1.z.string().default(exports.WEBRING_SCHEMA_VERSION),
    did: zod_1.z.string(),
    siteUrl: zod_1.z.string(),
    handle: zod_1.z.string(),
    displayName: zod_1.z.string(),
    tagline: zod_1.z.string().default(''),
    bio: zod_1.z.string().default(''),
    location: zod_1.z.string().default(''),
    avatarUrl: zod_1.z.string().default(''),
    bannerUrl: zod_1.z.string().default(''),
    interests: zod_1.z.array(zod_1.z.string()).default([]),
    customLinks: zod_1.z
        .array(zod_1.z.object({
        label: zod_1.z.string(),
        url: zod_1.z.string(),
    }))
        .default([]),
    theme: exports.ProfileThemeSchema.default('neo-webring'),
    atprotoHandle: zod_1.z.string().optional(),
    commentConfig: exports.CommentConfigSchema.optional(),
    analyticsAddon: exports.AnalyticsAddonSchema.optional(),
    adsAddon: exports.AdsAddonSchema.optional(),
    updatedAt: zod_1.z.string(),
    proof: exports.SignatureProofSchema.optional(),
});
/**
 * Photo & Album Schemas (/api/albums.json)
 */
exports.PhotoItemSchema = zod_1.z.object({
    id: zod_1.z.string(),
    canonicalUrl: zod_1.z.string(), // e.g., https://alice.example/api/albums.json#photo-123
    url: zod_1.z.string(), // Relative or absolute image URL
    thumbUrl: zod_1.z.string(),
    caption: zod_1.z.string().default(''),
    altText: zod_1.z.string().default(''),
    tags: zod_1.z.array(zod_1.z.string()).default([]),
    width: zod_1.z.number().optional(),
    height: zod_1.z.number().optional(),
    takenAt: zod_1.z.string().optional(),
    createdAt: zod_1.z.string(),
});
exports.AlbumItemSchema = zod_1.z.object({
    id: zod_1.z.string(),
    canonicalUrl: zod_1.z.string(), // e.g., https://alice.example/api/albums.json#album-123
    title: zod_1.z.string(),
    description: zod_1.z.string().default(''),
    coverUrl: zod_1.z.string().default(''),
    tags: zod_1.z.array(zod_1.z.string()).default([]),
    photos: zod_1.z.array(exports.PhotoItemSchema).default([]),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
});
exports.AlbumsDocumentSchema = zod_1.z.object({
    schemaVersion: zod_1.z.string().default(exports.WEBRING_SCHEMA_VERSION),
    siteUrl: zod_1.z.string(),
    did: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
    albums: zod_1.z.array(exports.AlbumItemSchema),
    proof: exports.SignatureProofSchema.optional(),
});
/**
 * Shared Items & "Things I Like" Schema (/api/items.json)
 * Every item has a canonicalUrl on the author's site AND indexes a targetUrl
 * so peers can discover shares/likes of their content or external web pages.
 */
exports.SharedItemTypeSchema = zod_1.z.enum([
    'post',
    'like',
    'share',
    'recommendation',
    'comment',
]);
exports.SharedItemSchema = zod_1.z.object({
    id: zod_1.z.string(),
    canonicalUrl: zod_1.z.string(), // e.g., https://alice.example/api/items.json#item-456
    type: exports.SharedItemTypeSchema,
    title: zod_1.z.string(),
    targetUrl: zod_1.z.string(), // Indexed target URL (a friend's photo/item URL, or any website)
    targetAuthorUrl: zod_1.z.string().optional(),
    targetAuthorName: zod_1.z.string().optional(),
    viaUrl: zod_1.z.string().optional(), // If re-shared via another friend in the ring
    category: zod_1.z.string().default('general'), // e.g., 'article', 'photo', 'music', 'book', 'tool', 'place'
    commentary: zod_1.z.string().default(''),
    mediaUrl: zod_1.z.string().default(''),
    rating: zod_1.z.number().min(1).max(5).optional(),
    tags: zod_1.z.array(zod_1.z.string()).default([]),
    createdAt: zod_1.z.string(),
});
exports.ItemsDocumentSchema = zod_1.z.object({
    schemaVersion: zod_1.z.string().default(exports.WEBRING_SCHEMA_VERSION),
    siteUrl: zod_1.z.string(),
    did: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
    items: zod_1.z.array(exports.SharedItemSchema),
    proof: exports.SignatureProofSchema.optional(),
});
/**
 * Connections, Webrings & Verified Endorsements (/api/connections.json)
 */
exports.FriendVisibilitySchema = zod_1.z.enum(['private', 'public']);
exports.FriendKeyStatusSchema = zod_1.z.enum(['unverified', 'pinned', 'changed']);
exports.FriendConnectionSchema = zod_1.z.object({
    id: zod_1.z.string(),
    siteUrl: zod_1.z.string(),
    did: zod_1.z.string().optional(),
    displayName: zod_1.z.string(),
    handle: zod_1.z.string().default(''),
    avatarUrl: zod_1.z.string().default(''),
    bio: zod_1.z.string().default(''),
    relationship: zod_1.z.array(zod_1.z.string()).default(['friend']), // XFN-inspired: 'friend', 'met', 'kin', 'muse', 'colleague'
    visibility: exports.FriendVisibilitySchema.default('private').optional(),
    pinnedPublicKeyPem: zod_1.z.string().optional(),
    keyStatus: exports.FriendKeyStatusSchema.default('unverified').optional(),
    addedAt: zod_1.z.string(),
});
exports.WebringMembershipSchema = zod_1.z.object({
    id: zod_1.z.string(),
    name: zod_1.z.string(),
    hubUrl: zod_1.z.string(),
    description: zod_1.z.string().default(''),
    prevSiteUrl: zod_1.z.string().optional(),
    nextSiteUrl: zod_1.z.string().optional(),
    joinedAt: zod_1.z.string(),
});
/**
 * Verified back-interactions discovered by crawling friends' items.json
 */
exports.EndorsementItemSchema = zod_1.z.object({
    id: zod_1.z.string(),
    targetCanonicalUrl: zod_1.z.string(), // Which of OUR items/photos was liked or shared
    authorSiteUrl: zod_1.z.string(),
    authorName: zod_1.z.string(),
    authorAvatarUrl: zod_1.z.string().default(''),
    type: exports.SharedItemTypeSchema,
    commentary: zod_1.z.string().default(''),
    sourceItemUrl: zod_1.z.string(),
    createdAt: zod_1.z.string(),
    verifiedSignature: zod_1.z.boolean().default(false),
});
exports.ConnectionsDocumentSchema = zod_1.z.object({
    schemaVersion: zod_1.z.string().default(exports.WEBRING_SCHEMA_VERSION),
    siteUrl: zod_1.z.string(),
    did: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
    friends: zod_1.z.array(exports.FriendConnectionSchema),
    webrings: zod_1.z.array(exports.WebringMembershipSchema),
    endorsements: zod_1.z.array(exports.EndorsementItemSchema).default([]),
    proof: exports.SignatureProofSchema.optional(),
});
/**
 * Standalone Webring Hub Directory Schema (webring-hub.json)
 * Allows any user or community to host a static JSON file that acts as a Webring directory.
 */
exports.WebringHubDocumentSchema = zod_1.z.object({
    schemaVersion: zod_1.z.string().default(exports.WEBRING_SCHEMA_VERSION),
    name: zod_1.z.string(),
    description: zod_1.z.string(),
    hubUrl: zod_1.z.string(),
    maintainerUrl: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
    members: zod_1.z.array(zod_1.z.object({
        siteUrl: zod_1.z.string(),
        displayName: zod_1.z.string(),
        did: zod_1.z.string().optional(),
        joinedAt: zod_1.z.string(),
    })),
});
// ============================================================================
// 2. Identity (did:web), Canonical URL, and Ed25519 Crypto Helpers
// ============================================================================
/**
 * Normalizes a site URL (removes trailing slash, ensures protocol)
 */
function normalizeSiteUrl(rawUrl) {
    const trimmed = rawUrl.trim();
    if (!trimmed)
        return 'https://my-profile.local';
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return withProto.replace(/\/+$/, '');
}
/**
 * Converts an HTTP(S) site URL into a W3C / ATProto compatible did:web identifier.
 * Example: https://alice.example.com/profile -> did:web:alice.example.com:profile
 */
function siteUrlToDidWeb(siteUrl) {
    try {
        const parsed = new URL(normalizeSiteUrl(siteUrl));
        const host = parsed.port ? `${parsed.hostname}%3A${parsed.port}` : parsed.hostname;
        const pathSegments = parsed.pathname
            .split('/')
            .filter(Boolean)
            .map((seg) => encodeURIComponent(seg));
        if (pathSegments.length > 0) {
            return `did:web:${host}:${pathSegments.join(':')}`;
        }
        return `did:web:${host}`;
    }
    catch {
        return 'did:web:localhost';
    }
}
/**
 * Builds a canonical item URL indexed to the user's hosted website structure.
 */
function buildCanonicalUrl(siteUrl, collection, id) {
    const base = normalizeSiteUrl(siteUrl);
    if (collection === 'albums') {
        return `${base}/api/albums.json#album-${id}`;
    }
    if (collection === 'photos') {
        return `${base}/api/albums.json#photo-${id}`;
    }
    return `${base}/api/items.json#item-${id}`;
}
/**
 * Generates an Ed25519 keypair in PEM format for signing static JSON files.
 */
function generateIdentityKeyPair() {
    const nodeCrypto = getNodeCrypto();
    const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync('ed25519', {
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}
/**
 * Deterministically serializes a JSON object (excluding 'proof') for cryptographic signing.
 */
function canonicalizeJson(obj) {
    const clone = {};
    for (const key of Object.keys(obj).sort()) {
        if (key === 'proof')
            continue;
        const val = obj[key];
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            clone[key] = JSON.parse(canonicalizeJson(val));
        }
        else {
            clone[key] = val;
        }
    }
    return JSON.stringify(clone);
}
/**
 * Signs a JSON payload using the owner's Ed25519 private key and attaches a `proof` object.
 */
function signDocument(doc, did, privateKeyPem) {
    const nodeCrypto = getNodeCrypto();
    const canonicalPayload = canonicalizeJson(doc);
    const signature = nodeCrypto.sign(null, Buffer.from(canonicalPayload, 'utf8'), privateKeyPem);
    const proof = {
        type: 'Ed25519Signature2020',
        created: new Date().toISOString(),
        verificationMethod: `${did}#key-1`,
        signatureValue: signature.toString('base64url'),
    };
    return { ...doc, proof };
}
/**
 * Verifies the `proof` signature on a fetched JSON document against the author's public key PEM.
 */
function verifyDocumentSignature(doc, publicKeyPem) {
    try {
        if (!doc.proof || !doc.proof.signatureValue)
            return false;
        const nodeCrypto = getNodeCrypto();
        const canonicalPayload = canonicalizeJson(doc);
        const sigBuffer = Buffer.from(doc.proof.signatureValue, 'base64url');
        return nodeCrypto.verify(null, Buffer.from(canonicalPayload, 'utf8'), publicKeyPem, sigBuffer);
    }
    catch {
        return false;
    }
}
/**
 * Builds a W3C / ATProto compatible /.well-known/did.json document
 */
function buildDidDocument(siteUrl, publicKeyPem, handle, atprotoPdsUrl) {
    const normalizedUrl = normalizeSiteUrl(siteUrl);
    const did = siteUrlToDidWeb(normalizedUrl);
    const services = [
        {
            id: '#webring',
            type: 'WebringProfileService',
            serviceEndpoint: `${normalizedUrl}/api/manifest.json`,
        },
    ];
    if (atprotoPdsUrl) {
        services.push({
            id: '#atproto_pds',
            type: 'AtprotoPersonalDataServer',
            serviceEndpoint: atprotoPdsUrl,
        });
    }
    return {
        '@context': [
            'https://www.w3.org/ns/did/v1',
            'https://w3id.org/security/suites/ed25519-2020/v1',
        ],
        id: did,
        alsoKnownAs: handle ? [`at://${handle}`, normalizedUrl] : [normalizedUrl],
        verificationMethod: [
            {
                id: `${did}#key-1`,
                type: 'Ed25519VerificationKey2020',
                controller: did,
                publicKeyPem,
            },
        ],
        service: services,
    };
}
function parseWebringUri(uri) {
    try {
        const parsed = new URL(uri);
        if (parsed.protocol !== 'webring:')
            return null;
        const actionParam = parsed.searchParams.get('action') || 'share';
        const targetUrl = parsed.searchParams.get('targetUrl') || '';
        if (!targetUrl)
            return null;
        const action = (['like', 'share', 'comment', 'friend', 'join-ring'].includes(actionParam)
            ? actionParam
            : 'share');
        return {
            action,
            targetUrl,
            title: parsed.searchParams.get('title') || undefined,
            authorUrl: parsed.searchParams.get('authorUrl') || undefined,
            authorName: parsed.searchParams.get('authorName') || undefined,
            mediaUrl: parsed.searchParams.get('mediaUrl') || undefined,
            category: parsed.searchParams.get('category') || undefined,
        };
    }
    catch {
        return null;
    }
}
function buildWebringUri(params) {
    const search = new URLSearchParams();
    search.set('action', params.action);
    search.set('targetUrl', params.targetUrl);
    if (params.title)
        search.set('title', params.title);
    if (params.authorUrl)
        search.set('authorUrl', params.authorUrl);
    if (params.authorName)
        search.set('authorName', params.authorName);
    if (params.mediaUrl)
        search.set('mediaUrl', params.mediaUrl);
    if (params.category)
        search.set('category', params.category);
    return `webring://interact?${search.toString()}`;
}
