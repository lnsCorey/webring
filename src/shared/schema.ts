import { z } from 'zod';

// Lazy loader for Node crypto so browser bundles don't warn on static import
function getNodeCrypto(): typeof import('crypto') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('crypto');
}

// ============================================================================
// 1. Standardized Webring & Federated Profile JSON Schemas (v1.0)
// ============================================================================

export const WEBRING_SCHEMA_VERSION = '1.0.0';

/**
 * Cryptographic authorship proof attached to published JSON documents.
 * Uses Ed25519 keys exposed in /.well-known/did.json
 */
export const SignatureProofSchema = z.object({
  type: z.literal('Ed25519Signature2020'),
  created: z.string(),
  verificationMethod: z.string(), // e.g., did:web:example.com#key-1
  signatureValue: z.string(),     // base64url encoded signature of canonical payload
});
export type SignatureProof = z.infer<typeof SignatureProofSchema>;

/**
 * W3C / ATProto compatible did:web Document (/.well-known/did.json)
 */
export const DidDocumentSchema = z.object({
  '@context': z.array(z.string()),
  id: z.string(), // did:web:domain.com
  alsoKnownAs: z.array(z.string()).optional(),
  verificationMethod: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      controller: z.string(),
      publicKeyMultibase: z.string().optional(),
      publicKeyPem: z.string().optional(),
    })
  ),
  service: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      serviceEndpoint: z.string(),
    })
  ),
});
export type DidDocument = z.infer<typeof DidDocumentSchema>;

/**
 * Site Manifest (/api/manifest.json)
 * Entrypoint for crawlers and other Electron Studio clients.
 */
export const WebringManifestSchema = z.object({
  schemaVersion: z.string().default(WEBRING_SCHEMA_VERSION),
  siteUrl: z.string(),
  did: z.string(),
  updatedAt: z.string(),
  endpoints: z.object({
    did: z.string().default('/.well-known/did.json'),
    profile: z.string().default('/api/profile.json'),
    albums: z.string().default('/api/albums.json'),
    items: z.string().default('/api/items.json'),
    connections: z.string().default('/api/connections.json'),
  }),
  stats: z.object({
    albumCount: z.number(),
    photoCount: z.number(),
    itemCount: z.number(),
    friendCount: z.number(),
    webringCount: z.number(),
  }),
  proof: SignatureProofSchema.optional(),
});
export type WebringManifest = z.infer<typeof WebringManifestSchema>;

/**
 * Theme options for the standalone Profile Website
 */
export const ProfileThemeSchema = z.enum([
  'neo-webring',     // Classic indie web meets crisp modern cards
  'minimal-zine',    // Editorial serif typography & clean whitespace
  'cyber-terminal',  // High-contrast dark neon retro terminal
  'cozy-scrapbook',  // Warm paper tones & polaroid photo frames
]);
export type ProfileTheme = z.infer<typeof ProfileThemeSchema>;

/**
 * Profile Document (/api/profile.json)
 */
export const CommentConfigSchema = z.object({
  provider: z.enum(['none', 'giscus', 'utterances']).default('none'),
  giscusRepo: z.string().optional(),
  giscusRepoId: z.string().optional(),
  giscusCategory: z.string().optional(),
  giscusCategoryId: z.string().optional(),
});
export type CommentConfig = z.infer<typeof CommentConfigSchema>;

/**
 * Optional Profile Add-On 1: Google Analytics (GA4)
 */
export const AnalyticsAddonSchema = z.object({
  enabled: z.boolean().default(false),
  measurementId: z.string().default(''), // e.g., G-XXXXXXXXXX
  respectDoNotTrack: z.boolean().default(true),
  anonymizeIp: z.boolean().default(true),
  trackRingInteractions: z.boolean().default(true),
});
export type AnalyticsAddon = z.infer<typeof AnalyticsAddonSchema>;

/**
 * Optional Profile Add-On 2: Google AdSense / Ads Monetization
 */
export const AdsAddonSchema = z.object({
  enabled: z.boolean().default(false),
  publisherId: z.string().default(''), // e.g., ca-pub-1234567890123456
  enableAutoAds: z.boolean().default(true),
  generateAdsTxt: z.boolean().default(true),
  headerSlotId: z.string().default(''),
  inFeedSlotId: z.string().default(''),
  footerSlotId: z.string().default(''),
});
export type AdsAddon = z.infer<typeof AdsAddonSchema>;

export function isValidGa4MeasurementId(rawId?: string): boolean {
  if (!rawId) return false;
  return /^G-[A-Z0-9]{4,20}$/i.test(rawId.trim());
}

export function normalizeAdSensePublisherId(rawId?: string): string {
  if (!rawId) return '';
  const trimmed = rawId.trim();
  if (/^ca-pub-\d{10,20}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^pub-\d{10,20}$/i.test(trimmed)) return `ca-${trimmed.toLowerCase()}`;
  return '';
}

export function isValidAdSlotId(rawSlotId?: string): boolean {
  if (!rawSlotId) return false;
  return /^\d{5,20}$/.test(rawSlotId.trim());
}

export const ProfileDocumentSchema = z.object({
  schemaVersion: z.string().default(WEBRING_SCHEMA_VERSION),
  did: z.string(),
  siteUrl: z.string(),
  handle: z.string(),
  displayName: z.string(),
  tagline: z.string().default(''),
  bio: z.string().default(''),
  location: z.string().default(''),
  avatarUrl: z.string().default(''),
  bannerUrl: z.string().default(''),
  interests: z.array(z.string()).default([]),
  customLinks: z
    .array(
      z.object({
        label: z.string(),
        url: z.string(),
      })
    )
    .default([]),
  theme: ProfileThemeSchema.default('neo-webring'),
  atprotoHandle: z.string().optional(),
  commentConfig: CommentConfigSchema.optional(),
  analyticsAddon: AnalyticsAddonSchema.optional(),
  adsAddon: AdsAddonSchema.optional(),
  updatedAt: z.string(),
  proof: SignatureProofSchema.optional(),
});
export type ProfileDocument = z.infer<typeof ProfileDocumentSchema>;

/**
 * Photo & Album Schemas (/api/albums.json)
 */
export const PhotoItemSchema = z.object({
  id: z.string(),
  canonicalUrl: z.string(), // e.g., https://alice.example/api/albums.json#photo-123
  url: z.string(),          // Relative or absolute image URL
  thumbUrl: z.string(),
  caption: z.string().default(''),
  altText: z.string().default(''),
  tags: z.array(z.string()).default([]),
  width: z.number().optional(),
  height: z.number().optional(),
  takenAt: z.string().optional(),
  createdAt: z.string(),
});
export type PhotoItem = z.infer<typeof PhotoItemSchema>;

export const AlbumItemSchema = z.object({
  id: z.string(),
  canonicalUrl: z.string(), // e.g., https://alice.example/api/albums.json#album-123
  title: z.string(),
  description: z.string().default(''),
  coverUrl: z.string().default(''),
  tags: z.array(z.string()).default([]),
  photos: z.array(PhotoItemSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AlbumItem = z.infer<typeof AlbumItemSchema>;

export const AlbumsDocumentSchema = z.object({
  schemaVersion: z.string().default(WEBRING_SCHEMA_VERSION),
  siteUrl: z.string(),
  did: z.string(),
  updatedAt: z.string(),
  albums: z.array(AlbumItemSchema),
  proof: SignatureProofSchema.optional(),
});
export type AlbumsDocument = z.infer<typeof AlbumsDocumentSchema>;

/**
 * Shared Items & "Things I Like" Schema (/api/items.json)
 * Every item has a canonicalUrl on the author's site AND indexes a targetUrl
 * so peers can discover shares/likes of their content or external web pages.
 */
export const SharedItemTypeSchema = z.enum([
  'post',
  'like',
  'share',
  'recommendation',
  'comment',
]);
export type SharedItemType = z.infer<typeof SharedItemTypeSchema>;

export const SharedItemSchema = z.object({
  id: z.string(),
  canonicalUrl: z.string(), // e.g., https://alice.example/api/items.json#item-456
  type: SharedItemTypeSchema,
  title: z.string(),
  targetUrl: z.string(),    // Indexed target URL (a friend's photo/item URL, or any website)
  targetAuthorUrl: z.string().optional(),
  targetAuthorName: z.string().optional(),
  viaUrl: z.string().optional(), // If re-shared via another friend in the ring
  category: z.string().default('general'), // e.g., 'article', 'photo', 'music', 'book', 'tool', 'place'
  commentary: z.string().default(''),
  mediaUrl: z.string().default(''),
  rating: z.number().min(1).max(5).optional(),
  tags: z.array(z.string()).default([]),
  createdAt: z.string(),
});
export type SharedItem = z.infer<typeof SharedItemSchema>;

export const ItemsDocumentSchema = z.object({
  schemaVersion: z.string().default(WEBRING_SCHEMA_VERSION),
  siteUrl: z.string(),
  did: z.string(),
  updatedAt: z.string(),
  items: z.array(SharedItemSchema),
  proof: SignatureProofSchema.optional(),
});
export type ItemsDocument = z.infer<typeof ItemsDocumentSchema>;

/**
 * Connections, Webrings & Verified Endorsements (/api/connections.json)
 */
export const FriendVisibilitySchema = z.enum(['private', 'public']);
export type FriendVisibility = z.infer<typeof FriendVisibilitySchema>;

export const FriendKeyStatusSchema = z.enum(['unverified', 'pinned', 'changed']);
export type FriendKeyStatus = z.infer<typeof FriendKeyStatusSchema>;

export const FriendConnectionSchema = z.object({
  id: z.string(),
  siteUrl: z.string(),
  did: z.string().optional(),
  displayName: z.string(),
  handle: z.string().default(''),
  avatarUrl: z.string().default(''),
  bio: z.string().default(''),
  relationship: z.array(z.string()).default(['friend']), // XFN-inspired: 'friend', 'met', 'kin', 'muse', 'colleague'
  visibility: FriendVisibilitySchema.default('private').optional(),
  pinnedPublicKeyPem: z.string().optional(),
  keyStatus: FriendKeyStatusSchema.default('unverified').optional(),
  addedAt: z.string(),
});
export type FriendConnection = z.infer<typeof FriendConnectionSchema>;

export const WebringMembershipSchema = z.object({
  id: z.string(),
  name: z.string(),
  hubUrl: z.string(),
  description: z.string().default(''),
  prevSiteUrl: z.string().optional(),
  nextSiteUrl: z.string().optional(),
  joinedAt: z.string(),
});
export type WebringMembership = z.infer<typeof WebringMembershipSchema>;

/**
 * Verified back-interactions discovered by crawling friends' items.json
 */
export const EndorsementItemSchema = z.object({
  id: z.string(),
  targetCanonicalUrl: z.string(), // Which of OUR items/photos was liked or shared
  authorSiteUrl: z.string(),
  authorName: z.string(),
  authorAvatarUrl: z.string().default(''),
  type: SharedItemTypeSchema,
  commentary: z.string().default(''),
  sourceItemUrl: z.string(),
  createdAt: z.string(),
  verifiedSignature: z.boolean().default(false),
});
export type EndorsementItem = z.infer<typeof EndorsementItemSchema>;

export const ConnectionsDocumentSchema = z.object({
  schemaVersion: z.string().default(WEBRING_SCHEMA_VERSION),
  siteUrl: z.string(),
  did: z.string(),
  updatedAt: z.string(),
  friends: z.array(FriendConnectionSchema),
  webrings: z.array(WebringMembershipSchema),
  endorsements: z.array(EndorsementItemSchema).default([]),
  proof: SignatureProofSchema.optional(),
});
export type ConnectionsDocument = z.infer<typeof ConnectionsDocumentSchema>;

/**
 * Standalone Webring Hub Directory Schema (webring-hub.json)
 * Allows any user or community to host a static JSON file that acts as a Webring directory.
 */
export const WebringHubDocumentSchema = z.object({
  schemaVersion: z.string().default(WEBRING_SCHEMA_VERSION),
  name: z.string(),
  description: z.string(),
  hubUrl: z.string(),
  maintainerUrl: z.string(),
  updatedAt: z.string(),
  members: z.array(
    z.object({
      siteUrl: z.string(),
      displayName: z.string(),
      did: z.string().optional(),
      joinedAt: z.string(),
    })
  ),
});
export type WebringHubDocument = z.infer<typeof WebringHubDocumentSchema>;

/**
 * Complete Hydrated Bundle for the Standalone Profile Site
 */
export interface CompleteSiteBundle {
  didDocument: DidDocument;
  manifest: WebringManifest;
  profile: ProfileDocument;
  albums: AlbumsDocument;
  items: ItemsDocument;
  connections: ConnectionsDocument;
}

/**
 * Local Studio Persona Summary (Strict Compartmentalization)
 */
export interface PersonaSummary {
  id: string;
  label: string;          // Internal Studio nickname (never exported in public JSON)
  displayName: string;
  handle: string;
  siteUrl: string;
  did: string;
  avatarUrl: string;
  theme: ProfileTheme;
  dbFileName: string;
  mediaDirName: string;
  createdAt: string;
  stats?: {
    photoCount: number;
    itemCount: number;
    friendCount: number;
  };
}

export interface CreatePersonaInput {
  label: string;
  displayName: string;
  siteUrl?: string;
  handle?: string;
  tagline?: string;
  bio?: string;
  avatarUrl?: string;
  theme?: ProfileTheme;
  seedStarterData?: boolean;
}

// ============================================================================
// 2. Identity (did:web), Canonical URL, and Ed25519 Crypto Helpers
// ============================================================================

/**
 * Normalizes a site URL (removes trailing slash, ensures protocol)
 */
export function normalizeSiteUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return 'https://my-profile.local';
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProto.replace(/\/+$/, '');
}

/**
 * Converts an HTTP(S) site URL into a W3C / ATProto compatible did:web identifier.
 * Example: https://alice.example.com/profile -> did:web:alice.example.com:profile
 */
export function siteUrlToDidWeb(siteUrl: string): string {
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
  } catch {
    return 'did:web:localhost';
  }
}

/**
 * Builds a canonical item URL indexed to the user's hosted website structure.
 */
export function buildCanonicalUrl(
  siteUrl: string,
  collection: 'albums' | 'photos' | 'items',
  id: string
): string {
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
export function generateIdentityKeyPair(): { publicKeyPem: string; privateKeyPem: string } {
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
export function canonicalizeJson(obj: Record<string, unknown>): string {
  const clone: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    if (key === 'proof') continue;
    const val = obj[key];
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      clone[key] = JSON.parse(canonicalizeJson(val as Record<string, unknown>));
    } else {
      clone[key] = val;
    }
  }
  return JSON.stringify(clone);
}

/**
 * Signs a JSON payload using the owner's Ed25519 private key and attaches a `proof` object.
 */
export function signDocument<T extends Record<string, unknown>>(
  doc: T,
  did: string,
  privateKeyPem: string
): T & { proof: SignatureProof } {
  const nodeCrypto = getNodeCrypto();
  const canonicalPayload = canonicalizeJson(doc);
  const signature = nodeCrypto.sign(null, Buffer.from(canonicalPayload, 'utf8'), privateKeyPem);
  const proof: SignatureProof = {
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
export function verifyDocumentSignature(
  doc: Record<string, unknown> & { proof?: SignatureProof },
  publicKeyPem: string
): boolean {
  try {
    if (!doc.proof || !doc.proof.signatureValue) return false;
    const nodeCrypto = getNodeCrypto();
    const canonicalPayload = canonicalizeJson(doc);
    const sigBuffer = Buffer.from(doc.proof.signatureValue, 'base64url');
    return nodeCrypto.verify(null, Buffer.from(canonicalPayload, 'utf8'), publicKeyPem, sigBuffer);
  } catch {
    return false;
  }
}

/**
 * Builds a W3C / ATProto compatible /.well-known/did.json document
 */
export function buildDidDocument(
  siteUrl: string,
  publicKeyPem: string,
  handle?: string,
  atprotoPdsUrl?: string
): DidDocument {
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

/**
 * Parses a custom `webring://interact?...` deep link URI into structured action parameters
 */
export interface WebringDeepLinkAction {
  action: 'like' | 'share' | 'comment' | 'friend' | 'join-ring';
  targetUrl: string;
  title?: string;
  authorUrl?: string;
  authorName?: string;
  mediaUrl?: string;
  category?: string;
}

export function parseWebringUri(uri: string): WebringDeepLinkAction | null {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== 'webring:') return null;
    const actionParam = parsed.searchParams.get('action') || 'share';
    const targetUrl = parsed.searchParams.get('targetUrl') || '';
    if (!targetUrl) return null;

    const action = (['like', 'share', 'comment', 'friend', 'join-ring'].includes(actionParam)
      ? actionParam
      : 'share') as WebringDeepLinkAction['action'];

    return {
      action,
      targetUrl,
      title: parsed.searchParams.get('title') || undefined,
      authorUrl: parsed.searchParams.get('authorUrl') || undefined,
      authorName: parsed.searchParams.get('authorName') || undefined,
      mediaUrl: parsed.searchParams.get('mediaUrl') || undefined,
      category: parsed.searchParams.get('category') || undefined,
    };
  } catch {
    return null;
  }
}

export function buildWebringUri(params: WebringDeepLinkAction): string {
  const search = new URLSearchParams();
  search.set('action', params.action);
  search.set('targetUrl', params.targetUrl);
  if (params.title) search.set('title', params.title);
  if (params.authorUrl) search.set('authorUrl', params.authorUrl);
  if (params.authorName) search.set('authorName', params.authorName);
  if (params.mediaUrl) search.set('mediaUrl', params.mediaUrl);
  if (params.category) search.set('category', params.category);
  return `webring://interact?${search.toString()}`;
}

