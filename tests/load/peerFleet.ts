import * as crypto from 'crypto';
import * as zlib from 'zlib';
import {
  AlbumsDocumentSchema,
  buildCanonicalUrl,
  buildDidDocument,
  ConnectionsDocumentSchema,
  DidDocumentSchema,
  documentFingerprint,
  generateIdentityKeyPair,
  ItemsDocumentSchema,
  ProfileDocumentSchema,
  signDocument,
  siteUrlToDidWeb,
  WebringManifestSchema,
  type AlbumItem,
  type FriendConnection,
  type SharedItem,
  type SharedItemType,
} from '../../src/shared/schema';

/**
 * A fleet of synthetic friend sites for load-testing sync. Each site has its own Ed25519 key and
 * publishes the same signed documents a real Studio export does. Every document is parsed with its
 * schema as it's built, so the fixtures can't drift from the real format.
 */

export interface FleetOptions {
  count: number;
  /** Origin the fleet is served from; site N lives at `${baseUrl}/p/000N`. */
  baseUrl: string;
  /** The syncing persona's site: some items endorse it and some connections list it. */
  personaSiteUrl: string;
  itemsPerSite: number;
  photosPerSite: number;
  friendsPerSite: number;
  /** Share of each site's likes/comments that point at the persona (endorsements). */
  endorsementFraction: number;
  /** Share of sites whose connections.json lists the persona ("Mutual"). */
  mutualFraction: number;
  seed: number;
}

export const DEFAULT_FLEET_OPTIONS: Omit<FleetOptions, 'count' | 'baseUrl' | 'personaSiteUrl'> = {
  itemsPerSite: 60,
  photosPerSite: 24,
  friendsPerSite: 150,
  endorsementFraction: 0.05,
  mutualFraction: 0.3,
  seed: 2027,
};

export type DocumentKind = 'did' | 'manifest' | 'profile' | 'albums' | 'items' | 'connections';

export const DOCUMENT_PATHS: Record<DocumentKind, string> = {
  did: '.well-known/did.json',
  manifest: 'api/manifest.json',
  profile: 'api/profile.json',
  albums: 'api/albums.json',
  items: 'api/items.json',
  connections: 'api/connections.json',
};

export interface ServedFile {
  kind: DocumentKind;
  body: Buffer;
  /** What a host sends a client that accepts gzip (static hosts usually compress JSON). */
  gzipBody: Buffer;
  etag: string;
  lastModified: string;
}

export interface FleetSite {
  index: number;
  siteUrl: string;
  did: string;
  displayName: string;
  privateKeyPem: string;
  publicKeyPem: string;
  items: SharedItem[];
  albums: AlbumItem[];
  connections: FriendConnection[];
  updatedAt: string;
  files: Map<string, ServedFile>;
  /** The latest version of each document, as published. */
  docs: Partial<Record<DocumentKind, unknown>>;
}

export interface Fleet {
  options: FleetOptions;
  sites: FleetSite[];
  rng: () => number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** mulberry32: small, fast and deterministic, so runs are comparable. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS =
  'ring static garden zine signal coffee photo walk river morning sketch notes build tiny web sun hill letter radio quiet city tram book bread kettle bike map star'.split(
    ' '
  );

function words(rng: () => number, min: number, max: number): string {
  const n = min + Math.floor(rng() * (max - min + 1));
  return Array.from({ length: n }, () => WORDS[Math.floor(rng() * WORDS.length)]).join(' ');
}

function pick<T>(rng: () => number, values: T[]): T {
  return values[Math.floor(rng() * values.length)];
}

export function fleetSiteUrl(baseUrl: string, index: number): string {
  return `${baseUrl}/p/${String(index).padStart(4, '0')}`;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

function makeItem(site: FleetSite, rng: () => number, options: FleetOptions, createdAt: string): SharedItem {
  const id = crypto.randomBytes(6).toString('hex');
  const canonicalUrl = buildCanonicalUrl(site.siteUrl, 'items', id);
  const roll = rng();
  const type: SharedItemType = roll < 0.7 ? 'post' : roll < 0.85 ? 'like' : roll < 0.95 ? 'share' : 'comment';
  const endorsesPersona = type !== 'post' && rng() < options.endorsementFraction;
  const targetUrl =
    type === 'post'
      ? canonicalUrl
      : endorsesPersona
        ? `${options.personaSiteUrl}/api/items.json#item-${Math.floor(rng() * 500)}`
        : `https://example.com/${pick(rng, WORDS)}/${Math.floor(rng() * 10000)}`;
  return {
    id,
    canonicalUrl,
    type,
    title: words(rng, 2, 7),
    targetUrl,
    category: 'general',
    commentary: type === 'like' ? '' : words(rng, 8, 90),
    mediaUrl: type === 'post' && rng() < 0.3 ? `${site.siteUrl}/media/${id}.jpg` : '',
    tags: Array.from({ length: Math.floor(rng() * 4) }, () => pick(rng, WORDS)),
    createdAt,
  };
}

function makeAlbums(site: FleetSite, rng: () => number, options: FleetOptions): AlbumItem[] {
  const albumCount = Math.max(1, Math.ceil(options.photosPerSite / 8));
  const albums: AlbumItem[] = [];
  let remaining = options.photosPerSite;
  for (let a = 0; a < albumCount; a++) {
    const albumId = `album${a}`;
    const createdAt = isoDaysAgo(80 - a * 10);
    const photos = Array.from({ length: Math.min(8, remaining) }, (_, p) => {
      const photoId = `${albumId}-p${p}`;
      const file = crypto.randomBytes(8).toString('hex');
      return {
        id: photoId,
        canonicalUrl: buildCanonicalUrl(site.siteUrl, 'photos', photoId),
        url: `media/albums/${albumId}/${file}.jpg`,
        thumbUrl: `media/albums/${albumId}/${file}-thumb.jpg`,
        caption: words(rng, 0, 12),
        altText: words(rng, 3, 10),
        tags: [pick(rng, WORDS)],
        width: 2048,
        height: 1536,
        createdAt,
        sha256: crypto.randomBytes(32).toString('hex'),
        bytes: 400000 + Math.floor(rng() * 600000),
        mimeType: 'image/jpeg',
      };
    });
    remaining -= photos.length;
    albums.push({
      id: albumId,
      canonicalUrl: buildCanonicalUrl(site.siteUrl, 'albums', albumId),
      title: words(rng, 1, 4),
      description: words(rng, 0, 20),
      coverUrl: photos[0]?.thumbUrl || '',
      tags: [],
      photos,
      createdAt,
      updatedAt: createdAt,
    });
  }
  return albums;
}

function makeConnections(site: FleetSite, rng: () => number, options: FleetOptions): FriendConnection[] {
  const friends: FriendConnection[] = [];
  const listsPersona = rng() < options.mutualFraction;
  const count = options.friendsPerSite;
  for (let f = 0; f < count; f++) {
    // Friends of friends are mostly other fleet sites, plus some from outside the fleet
    const siteUrl =
      listsPersona && f === 0
        ? options.personaSiteUrl
        : rng() < 0.7
          ? fleetSiteUrl(options.baseUrl, Math.floor(rng() * options.count))
          : `https://outside-${Math.floor(rng() * 100000)}.example`;
    friends.push({
      id: `friend-${crypto.randomBytes(4).toString('hex')}`,
      siteUrl,
      did: siteUrlToDidWeb(siteUrl),
      displayName: words(rng, 1, 2),
      handle: new URL(siteUrl).hostname,
      avatarUrl: `${siteUrl}/media/avatar.jpg`,
      bio: words(rng, 0, 15),
      relationship: ['friend'],
      visibility: 'public',
      addedAt: isoDaysAgo(rng() * 400),
    });
  }
  return friends;
}

function serve(kind: DocumentKind, doc: unknown, lastModified: string): ServedFile {
  const body = Buffer.from(JSON.stringify(doc, null, 2), 'utf8');
  return {
    kind,
    body,
    gzipBody: zlib.gzipSync(body),
    etag: `"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 20)}"`,
    lastModified: new Date(lastModified).toUTCString(),
  };
}

/**
 * Builds (or rebuilds) every published document for a site. Like the real exporter, documents
 * whose content didn't change keep their bytes (fixed signing time), so ETags stay the same.
 */
function publishSite(site: FleetSite, changed: DocumentKind[] | 'all'): void {
  const shouldBuild = (kind: DocumentKind) => changed === 'all' || changed.includes(kind);
  const sign = <T extends Record<string, unknown>>(doc: T) =>
    signDocument(doc, site.did, site.privateKeyPem, site.updatedAt);
  const photoCount = site.albums.reduce((n, a) => n + a.photos.length, 0);

  const docs: Partial<Record<DocumentKind, unknown>> = {};
  if (shouldBuild('did')) {
    docs.did = DidDocumentSchema.parse(buildDidDocument(site.siteUrl, site.publicKeyPem));
  }
  if (shouldBuild('profile')) {
    docs.profile = sign({
      schemaVersion: '1.0',
      did: site.did,
      siteUrl: site.siteUrl,
      handle: new URL(site.siteUrl).host,
      displayName: site.displayName,
      tagline: 'Load-test peer',
      bio: `Synthetic friend site #${site.index} for sync load testing. ${WORDS.join(' ')}`,
      location: '',
      avatarUrl: `${site.siteUrl}/media/avatar.jpg`,
      bannerUrl: '',
      interests: WORDS.slice(0, 6),
      customLinks: [{ label: 'Home', url: site.siteUrl }],
      theme: 'neo-webring',
      updatedAt: site.updatedAt,
    });
    ProfileDocumentSchema.parse(docs.profile);
  }
  if (shouldBuild('albums')) {
    docs.albums = sign({ schemaVersion: '1.0', siteUrl: site.siteUrl, did: site.did, updatedAt: site.updatedAt, albums: site.albums });
    AlbumsDocumentSchema.parse(docs.albums);
  }
  if (shouldBuild('items')) {
    docs.items = sign({ schemaVersion: '1.0', siteUrl: site.siteUrl, did: site.did, updatedAt: site.updatedAt, items: site.items });
    ItemsDocumentSchema.parse(docs.items);
  }
  if (shouldBuild('connections')) {
    docs.connections = sign({
      schemaVersion: '1.0',
      siteUrl: site.siteUrl,
      did: site.did,
      updatedAt: site.updatedAt,
      friends: site.connections,
      webrings: [],
      endorsements: [],
    });
    ConnectionsDocumentSchema.parse(docs.connections);
  }
  Object.assign(site.docs, docs);
  // Like the real exporter, the manifest changes with any document: it lists their fingerprints
  {
    docs.manifest = sign({
      schemaVersion: '1.0',
      siteUrl: site.siteUrl,
      did: site.did,
      updatedAt: site.updatedAt,
      endpoints: {
        did: '/.well-known/did.json',
        profile: '/api/profile.json',
        albums: '/api/albums.json',
        items: '/api/items.json',
        connections: '/api/connections.json',
      },
      stats: {
        albumCount: site.albums.length,
        photoCount,
        itemCount: site.items.length,
        friendCount: site.connections.length,
        webringCount: 0,
      },
      documents: Object.fromEntries(
        (['did', 'profile', 'albums', 'items', 'connections'] as const).map((kind) => [
          kind,
          { sha256: documentFingerprint(site.docs[kind] as Record<string, unknown>) },
        ])
      ),
    });
    WebringManifestSchema.parse(docs.manifest);
  }
  for (const [kind, doc] of Object.entries(docs) as Array<[DocumentKind, unknown]>) {
    site.files.set(DOCUMENT_PATHS[kind], serve(kind, doc, site.updatedAt));
  }
}

export function buildFleet(input: Partial<FleetOptions> & Pick<FleetOptions, 'count' | 'baseUrl' | 'personaSiteUrl'>): Fleet {
  const options: FleetOptions = { ...DEFAULT_FLEET_OPTIONS, ...input };
  const rng = seededRandom(options.seed);
  const sites: FleetSite[] = [];
  for (let index = 0; index < options.count; index++) {
    const siteUrl = fleetSiteUrl(options.baseUrl, index);
    const keys = generateIdentityKeyPair();
    const site: FleetSite = {
      index,
      siteUrl,
      did: siteUrlToDidWeb(siteUrl),
      displayName: `Peer ${index}`,
      privateKeyPem: keys.privateKeyPem,
      publicKeyPem: keys.publicKeyPem,
      items: [],
      albums: [],
      connections: [],
      updatedAt: isoDaysAgo(1 + rng() * 5),
      files: new Map(),
      docs: {},
    };
    // Spread items over the last 85 days, newest first (inside the default 90-day window)
    site.items = Array.from({ length: options.itemsPerSite }, (_, i) =>
      makeItem(site, rng, options, isoDaysAgo((i / options.itemsPerSite) * 85 + 1))
    );
    site.albums = makeAlbums(site, rng, options);
    site.connections = makeConnections(site, rng, options);
    publishSite(site, 'all');
    sites.push(site);
  }
  return { options, sites, rng };
}

/**
 * Simulates the time between two syncs: a share of sites publish one new post each. Like the
 * real exporter, that changes items.json and the manifest (stats, fingerprints); the other
 * documents keep their bytes.
 */
export function mutateFleet(fleet: Fleet, fractionPosting: number): number {
  let changed = 0;
  for (const site of fleet.sites) {
    if (fleet.rng() >= fractionPosting) continue;
    site.updatedAt = new Date().toISOString();
    site.items = [makeItem(site, fleet.rng, fleet.options, site.updatedAt), ...site.items].slice(
      0,
      fleet.options.itemsPerSite
    );
    publishSite(site, ['items']);
    changed++;
  }
  return changed;
}

/** Bytes a full copy of one site costs, by document. */
export function siteBytes(site: FleetSite): Record<DocumentKind, number> {
  const out = {} as Record<DocumentKind, number>;
  for (const file of site.files.values()) out[file.kind] = file.body.length;
  return out;
}
