import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import {
  AdsAddon,
  AlbumItem,
  AlbumsDocument,
  AnalyticsAddon,
  buildCanonicalUrl,
  buildDidDocument,
  CompleteSiteBundle,
  ConnectionsDocument,
  EndorsementItem,
  FriendConnection,
  FriendKeyStatus,
  FriendVisibility,
  generateIdentityKeyPair,
  isValidAdSlotId,
  isValidGa4MeasurementId,
  ItemsDocument,
  computeRingNeighbors,
  ModerationAction,
  normalizeAdSensePublisherId,
  normalizeSiteUrl,
  PhotoItem,
  ProfileDocument,
  ProfileTheme,
  SharedItem,
  SharedItemType,
  signDocument,
  siteUrlToDidWeb,
  WEBRING_SCHEMA_VERSION,
  publicKeyFingerprint,
  WebringHubDocument,
  WebringManifest,
  WebringMembership,
} from '../../src/shared/schema';
import {
  isEncryptedKey,
  KeyCipher,
  openPrivateKey,
  openSecret,
  sealPrivateKey,
  sealSecret,
} from '../security/keyVault';

/** Publishing credentials, sealed at rest and never returned by getProfile(). */
const SECRET_PUBLISH_FIELDS = ['password', 'githubToken'] as const;
type SecretPublishField = (typeof SECRET_PUBLISH_FIELDS)[number];

/**
 * What getProfile() shows in place of a stored credential. Sending it back unchanged (e.g. from
 * the Publish form) keeps the stored value; '' clears it; anything else replaces it.
 */
export const STORED_SECRET_PLACEHOLDER = '••••••••';

export interface PublishSettings {
  exportPath: string;
  protocol: 'sftp' | 'ftp';
  host: string;
  port: number;
  username: string;
  password?: string;
  remotePath: string;
  atprotoPdsUrl?: string;
  publishFriendsList?: boolean;
  stripRelationshipTags?: boolean;
  publishEndorsements?: boolean;
  publishWebringHub?: boolean;
  redactItemSourceAuthors?: boolean;
  commentProvider?: 'none' | 'giscus' | 'utterances';
  giscusRepo?: string;
  giscusRepoId?: string;
  giscusCategory?: string;
  giscusCategoryId?: string;
  // Add-On 1: Google Analytics (GA4)
  analyticsEnabled?: boolean;
  analyticsMeasurementId?: string;
  analyticsRespectDnt?: boolean;
  analyticsAnonymizeIp?: boolean;
  analyticsTrackRingInteractions?: boolean;
  // Add-On 2: Google AdSense / Ads Monetization
  adsEnabled?: boolean;
  adsPublisherId?: string;
  adsEnableAutoAds?: boolean;
  adsGenerateAdsTxt?: boolean;
  adsHeaderSlotId?: string;
  adsInFeedSlotId?: string;
  adsFooterSlotId?: string;
  // Add-On 3: GitHub Pages Deploy
  githubOwner?: string;
  githubRepo?: string;
  githubBranch?: string;
  githubToken?: string;
  githubCustomDomain?: string;
  /** Set once the old single webring hub has been converted into a hosted ring. */
  legacyHubMigrated?: boolean;
  // Snapshot bookkeeping: when the static site was last generated and what it contained
  lastPublishedAt?: string;
  lastPublishedCounts?: PublishedCounts;
  /** Content fingerprint of the last published site, used to skip publishes with no changes. */
  lastPublishedFingerprint?: string;
}

export interface PublishedCounts {
  albumCount: number;
  photoCount: number;
  itemCount: number;
  friendCount: number;
  webringCount: number;
  endorsementCount: number;
}

export interface SiteKey {
  siteUrl: string;
  did: string;
  publicKeyPem: string;
  keyStatus: 'pinned' | 'changed';
  firstSeenAt: string;
}

export type JoinedRingStatus = 'requested' | 'member' | 'removed' | 'closed' | 'legacy';

/** A ring this persona has joined (or asked to join), as tracked locally. */
export interface JoinedRing {
  id: string;
  name: string;
  hubUrl: string;
  description: string;
  status: JoinedRingStatus;
  maintainerUrl: string;
  maintainerDid: string;
  prevSiteUrl?: string;
  nextSiteUrl?: string;
  memberCount: number;
  directoryUrl?: string;
  hubVerified: boolean;
  hubUpdatedAt?: string;
  lastSyncedAt?: string;
  requestToken?: string;
  syncWarning?: string;
  joinedAt: string;
}

export interface HostedRingMember {
  siteUrl: string;
  displayName: string;
  did: string;
  keyFingerprint: string;
  position: number;
  joinedAt: string;
  confirmedAt?: string;
  lastVerifiedAt?: string;
  failCount: number;
  hidden: boolean;
}

export interface HostedRingBan {
  siteUrl: string;
  did: string;
  keyFingerprint: string;
  reason: string;
  createdAt: string;
}

/** A ring this persona maintains and publishes. */
export interface HostedRing {
  id: string;
  slug: string;
  name: string;
  description: string;
  hubPath: string;
  hubUrl: string;
  directoryPath: string;
  directoryUrl: string;
  maintainerIsMember: boolean;
  status: 'active' | 'closed';
  createdAt: string;
  updatedAt: string;
  members: HostedRingMember[];
  bans: HostedRingBan[];
}

export interface ModerationEntry {
  siteUrl: string;
  action: ModerationAction;
  createdAt: string;
}

/**
 * Counts of rows a curated view left out, so the UI can show what moderation is hiding.
 */
export interface CuratedExclusions {
  muted: number;
  blocked: number;
  unverified: number;
}

export interface CuratedView<T> {
  entries: T[];
  excluded: CuratedExclusions;
}

export interface NetworkFeedEntry {
  id: string;
  friendSiteUrl: string;
  friendName: string;
  friendAvatarUrl: string;
  friendDid: string;
  entryType: 'photo' | 'post' | 'like' | 'share' | 'recommendation' | 'comment';
  title: string;
  canonicalUrl: string;
  targetUrl: string;
  commentary: string;
  mediaUrl: string;
  tags: string[];
  createdAt: string;
  verifiedSignature: boolean;
}

interface SqlStatementAdapter {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): unknown;
}

interface SqlDatabaseAdapter {
  exec(sql: string): void;
  prepare(sql: string): SqlStatementAdapter;
  close(): void;
}

function openSqliteAdapter(dbPath: string): SqlDatabaseAdapter {
  // Prefer Node's built-in node:sqlite (zero native compilation issues)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeSqlite = require('node:sqlite');
    if (nodeSqlite && nodeSqlite.DatabaseSync) {
      const db = new nodeSqlite.DatabaseSync(dbPath);
      db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
      return {
        exec: (sql: string) => db.exec(sql),
        prepare: (sql: string) => {
          const stmt = db.prepare(sql);
          return {
            get: (...params: unknown[]) => stmt.get(...params),
            all: (...params: unknown[]) => stmt.all(...params),
            run: (...params: unknown[]) => stmt.run(...params),
          };
        },
        close: () => db.close(),
      };
    }
  } catch {
    // Fallback to better-sqlite3 if node:sqlite is unavailable
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BetterSqlite3 = require('better-sqlite3');
  const db = new BetterSqlite3(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export interface StudioDatabaseOptions {
  seedStarterData?: boolean;
  /** Seals the private key at rest. Without one, the key is stored and read as plaintext. */
  keyCipher?: KeyCipher;
  defaultExportPath?: string;
  initialProfile?: {
    siteUrl?: string;
    handle?: string;
    displayName?: string;
    tagline?: string;
    bio?: string;
    location?: string;
    avatarUrl?: string;
    bannerUrl?: string;
    interests?: string[];
    theme?: ProfileTheme;
    atprotoHandle?: string;
  };
}

export class StudioDatabase {
  private db: SqlDatabaseAdapter;
  private keyCipher?: KeyCipher;
  public readonly dbPath: string;

  constructor(
    storageDir: string,
    dbFileName = 'webring-studio.sqlite',
    options?: StudioDatabaseOptions
  ) {
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
    this.dbPath = path.join(storageDir, dbFileName);
    this.db = openSqliteAdapter(this.dbPath);
    this.keyCipher = options?.keyCipher;
    this.initializeSchema();
    this.ensureDefaultProfile(options);
    this.sealPrivateKeyAtRest();
    this.sealPublishSecretsAtRest();
    this.migrateLegacyHub();
  }

  /**
   * The old "publish webring hub" setting published an unsigned api/webring-hub.json listing the
   * user plus their public friends. Convert it, once, into a hosted ring at the same path with the
   * same members, so existing links keep working.
   */
  private migrateLegacyHub(): void {
    const profile = this.getProfile();
    if (!profile.publishSettings.publishWebringHub || profile.publishSettings.legacyHubMigrated) {
      return;
    }
    const existing = this.db
      .prepare("SELECT id FROM hosted_rings WHERE hub_path = 'api/webring-hub.json'")
      .get();
    if (!existing) {
      const ring = this.createHostedRing({
        name: `${profile.displayName}'s Webring Circle`,
        description: `Federated friend ring maintained by ${profile.displayName}`,
        hubPath: 'api/webring-hub.json',
      });
      for (const friend of this.getFriends().filter((f) => f.visibility === 'public')) {
        this.addRingMember(ring.id, {
          siteUrl: friend.siteUrl,
          displayName: friend.displayName,
          did: friend.did || siteUrlToDidWeb(friend.siteUrl),
          keyFingerprint: friend.pinnedPublicKeyPem ? publicKeyFingerprint(friend.pinnedPublicKeyPem) : '',
          joinedAt: friend.addedAt,
        });
      }
    }
    const row = this.db.prepare('SELECT publish_settings_json FROM profile WHERE id = 1').get() as {
      publish_settings_json: string;
    };
    const stored = JSON.parse(String(row.publish_settings_json || '{}'));
    this.db
      .prepare('UPDATE profile SET publish_settings_json = ? WHERE id = 1')
      .run(JSON.stringify({ ...stored, publishWebringHub: false, legacyHubMigrated: true }));
  }

  /**
   * Encrypts a plaintext private key (new or from an older build) once a cipher is available.
   */
  private sealPrivateKeyAtRest(): void {
    if (!this.keyCipher?.isAvailable()) return;
    const row = this.db.prepare('SELECT private_key_pem FROM profile WHERE id = 1').get() as
      | { private_key_pem: string }
      | undefined;
    if (!row || isEncryptedKey(row.private_key_pem)) return;
    this.db
      .prepare('UPDATE profile SET private_key_pem = ? WHERE id = 1')
      .run(sealPrivateKey(row.private_key_pem, this.keyCipher));
  }

  private readStoredPublishSettings(): Record<string, unknown> {
    const row = this.db.prepare('SELECT publish_settings_json FROM profile WHERE id = 1').get() as
      | { publish_settings_json: string }
      | undefined;
    return JSON.parse(String(row?.publish_settings_json || '{}'));
  }

  /** Encrypts plaintext publishing credentials (from older builds or the MCP CLI) once a cipher is available. */
  private sealPublishSecretsAtRest(): void {
    if (!this.keyCipher?.isAvailable()) return;
    const stored = this.readStoredPublishSettings();
    let changed = false;
    for (const field of SECRET_PUBLISH_FIELDS) {
      const value = stored[field];
      if (typeof value === 'string' && value && !isEncryptedKey(value)) {
        stored[field] = sealSecret(value, this.keyCipher);
        changed = true;
      }
    }
    if (changed) {
      this.db
        .prepare('UPDATE profile SET publish_settings_json = ? WHERE id = 1')
        .run(JSON.stringify(stored));
    }
  }

  /**
   * The real publishing credentials, decrypted. Only the publisher should call this, right before
   * connecting. Throws KeyVaultUnavailableError outside the app (where nothing can publish anyway).
   */
  public getPublishCredentials(): { password: string; githubToken: string } {
    const stored = this.readStoredPublishSettings();
    const open = (field: SecretPublishField) => {
      const value = stored[field];
      return typeof value === 'string' && value ? openSecret(value, this.keyCipher) : '';
    };
    return { password: open('password'), githubToken: open('githubToken') };
  }

  /**
   * Fills placeholder or missing credentials in `settings` with the stored ones, so settings that
   * came from the (masked) Publish form can be used to connect.
   */
  public withStoredCredentials<T extends Partial<PublishSettings>>(settings: T): T {
    const needsStored = SECRET_PUBLISH_FIELDS.some(
      (field) => settings[field] === undefined || settings[field] === STORED_SECRET_PLACEHOLDER
    );
    if (!needsStored) return settings;
    const credentials = this.getPublishCredentials();
    const result = { ...settings };
    for (const field of SECRET_PUBLISH_FIELDS) {
      if (result[field] === undefined || result[field] === STORED_SECRET_PLACEHOLDER) {
        result[field] = credentials[field];
      }
    }
    return result;
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        site_url TEXT NOT NULL,
        handle TEXT NOT NULL,
        display_name TEXT NOT NULL,
        tagline TEXT NOT NULL DEFAULT '',
        bio TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        avatar_url TEXT NOT NULL DEFAULT '',
        banner_url TEXT NOT NULL DEFAULT '',
        interests_json TEXT NOT NULL DEFAULT '[]',
        custom_links_json TEXT NOT NULL DEFAULT '[]',
        theme TEXT NOT NULL DEFAULT 'neo-webring',
        atproto_handle TEXT NOT NULL DEFAULT '',
        public_key_pem TEXT NOT NULL,
        private_key_pem TEXT NOT NULL,
        publish_settings_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS albums (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        cover_url TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS photos (
        id TEXT PRIMARY KEY,
        album_id TEXT NOT NULL,
        url TEXT NOT NULL,
        thumb_url TEXT NOT NULL,
        local_source_path TEXT NOT NULL DEFAULT '',
        caption TEXT NOT NULL DEFAULT '',
        alt_text TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        width INTEGER,
        height INTEGER,
        taken_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        target_url TEXT NOT NULL,
        target_author_url TEXT NOT NULL DEFAULT '',
        target_author_name TEXT NOT NULL DEFAULT '',
        via_url TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'general',
        commentary TEXT NOT NULL DEFAULT '',
        media_url TEXT NOT NULL DEFAULT '',
        rating INTEGER,
        tags_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS friends (
        id TEXT PRIMARY KEY,
        site_url TEXT NOT NULL UNIQUE,
        did TEXT NOT NULL DEFAULT '',
        display_name TEXT NOT NULL,
        handle TEXT NOT NULL DEFAULT '',
        avatar_url TEXT NOT NULL DEFAULT '',
        bio TEXT NOT NULL DEFAULT '',
        relationship_json TEXT NOT NULL DEFAULT '["friend"]',
        visibility TEXT NOT NULL DEFAULT 'private',
        pinned_public_key_pem TEXT NOT NULL DEFAULT '',
        key_status TEXT NOT NULL DEFAULT 'unverified',
        last_crawled_at TEXT,
        added_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS webrings (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        hub_url TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        prev_site_url TEXT NOT NULL DEFAULT '',
        next_site_url TEXT NOT NULL DEFAULT '',
        joined_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS endorsements (
        id TEXT PRIMARY KEY,
        target_canonical_url TEXT NOT NULL,
        author_site_url TEXT NOT NULL,
        author_name TEXT NOT NULL,
        author_avatar_url TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL,
        commentary TEXT NOT NULL DEFAULT '',
        source_item_url TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        verified_signature INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS network_feed (
        id TEXT PRIMARY KEY,
        friend_site_url TEXT NOT NULL,
        friend_name TEXT NOT NULL,
        friend_avatar_url TEXT NOT NULL DEFAULT '',
        friend_did TEXT NOT NULL DEFAULT '',
        entry_type TEXT NOT NULL,
        title TEXT NOT NULL,
        canonical_url TEXT NOT NULL UNIQUE,
        target_url TEXT NOT NULL,
        commentary TEXT NOT NULL DEFAULT '',
        media_url TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        verified_signature INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS site_keys (
        site_url TEXT PRIMARY KEY,
        did TEXT NOT NULL DEFAULT '',
        public_key_pem TEXT NOT NULL,
        key_status TEXT NOT NULL DEFAULT 'pinned',
        first_seen_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hosted_rings (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        hub_path TEXT NOT NULL UNIQUE,
        maintainer_is_member INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ring_members (
        ring_id TEXT NOT NULL,
        site_url TEXT NOT NULL,
        display_name TEXT NOT NULL,
        did TEXT NOT NULL DEFAULT '',
        key_fingerprint TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0,
        joined_at TEXT NOT NULL,
        confirmed_at TEXT,
        last_verified_at TEXT,
        fail_count INTEGER NOT NULL DEFAULT 0,
        hidden INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (ring_id, site_url)
      );

      CREATE TABLE IF NOT EXISTS ring_bans (
        ring_id TEXT NOT NULL,
        site_url TEXT NOT NULL,
        did TEXT NOT NULL DEFAULT '',
        key_fingerprint TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        PRIMARY KEY (ring_id, site_url)
      );

      CREATE TABLE IF NOT EXISTS moderation (
        site_url TEXT PRIMARY KEY,
        action TEXT NOT NULL CHECK (action IN ('mute', 'block')),
        created_at TEXT NOT NULL
      );
    `);

    // Safe migration for existing databases lacking friends.visibility or TOFU key pinning columns
    const columns = this.db
      .prepare('PRAGMA table_info(friends)')
      .all() as Array<{ name: string }>;
    if (!columns.some((c) => c.name === 'visibility')) {
      this.db.exec(`ALTER TABLE friends ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';`);
    }
    if (!columns.some((c) => c.name === 'pinned_public_key_pem')) {
      this.db.exec(`ALTER TABLE friends ADD COLUMN pinned_public_key_pem TEXT NOT NULL DEFAULT '';`);
    }
    if (!columns.some((c) => c.name === 'key_status')) {
      this.db.exec(`ALTER TABLE friends ADD COLUMN key_status TEXT NOT NULL DEFAULT 'unverified';`);
    }

    // Joined-ring tracking. Rows that predate it become 'legacy' (still published, never auto-removed)
    const ringColumns = this.db
      .prepare('PRAGMA table_info(webrings)')
      .all() as Array<{ name: string }>;
    const addRingColumn = (name: string, ddl: string) => {
      if (!ringColumns.some((c) => c.name === name)) {
        this.db.exec(`ALTER TABLE webrings ADD COLUMN ${name} ${ddl};`);
      }
    };
    addRingColumn('status', "TEXT NOT NULL DEFAULT 'legacy'");
    addRingColumn('maintainer_url', "TEXT NOT NULL DEFAULT ''");
    addRingColumn('maintainer_did', "TEXT NOT NULL DEFAULT ''");
    addRingColumn('member_count', 'INTEGER NOT NULL DEFAULT 0');
    addRingColumn('directory_url', "TEXT NOT NULL DEFAULT ''");
    addRingColumn('hub_verified', 'INTEGER NOT NULL DEFAULT 0');
    addRingColumn('hub_updated_at', 'TEXT');
    addRingColumn('last_synced_at', 'TEXT');
    addRingColumn('request_token', "TEXT NOT NULL DEFAULT ''");
    addRingColumn('sync_warning', "TEXT NOT NULL DEFAULT ''");

    // One pinned key per site, shared by friends, ring hubs, applicants and members
    this.db.exec(`
      INSERT OR IGNORE INTO site_keys (site_url, did, public_key_pem, key_status, first_seen_at)
      SELECT site_url, did, pinned_public_key_pem,
             CASE WHEN key_status = 'changed' THEN 'changed' ELSE 'pinned' END, added_at
      FROM friends WHERE pinned_public_key_pem != '';
    `);

    this.migrateLegacyAbsoluteCustomLinks();
  }

  /**
   * Early builds seeded the default "My Webring Feed" / "DID Identity" custom links as root-absolute
   * paths (e.g. `/api/manifest.json`). Those 404 once the site is exported to a subfolder (e.g. a
   * GitHub Pages project site at `username.github.io/repo-name/`), since the browser resolves them
   * against the domain root instead of the page's own folder. Rewrites them to relative paths
   * in-place for any already-seeded profile; leaves anything the user customized untouched.
   */
  private migrateLegacyAbsoluteCustomLinks(): void {
    const legacyToFixed: Record<string, string> = {
      '/api/manifest.json': './api/manifest.json',
      '/.well-known/did.json': './.well-known/did.json',
    };
    const row = this.db
      .prepare('SELECT custom_links_json FROM profile WHERE id = 1')
      .get() as { custom_links_json?: string } | undefined;
    if (!row?.custom_links_json) return;

    let links: Array<{ label: string; url: string }>;
    try {
      links = JSON.parse(row.custom_links_json);
    } catch {
      return;
    }
    if (!Array.isArray(links)) return;

    let changed = false;
    const fixedLinks = links.map((link) => {
      if (link && typeof link.url === 'string' && legacyToFixed[link.url]) {
        changed = true;
        return { ...link, url: legacyToFixed[link.url] };
      }
      return link;
    });

    if (changed) {
      this.db
        .prepare('UPDATE profile SET custom_links_json = ? WHERE id = 1')
        .run(JSON.stringify(fixedLinks));
    }
  }

  private ensureDefaultProfile(options?: StudioDatabaseOptions): void {
    const existing = this.db.prepare('SELECT id FROM profile WHERE id = 1').get();
    if (!existing) {
      const { publicKeyPem, privateKeyPem } = generateIdentityKeyPair();
      const now = new Date().toISOString();
      const shouldSeedStarter = options?.seedStarterData !== false;
      const init = options?.initialProfile;

      const siteUrl = normalizeSiteUrl(init?.siteUrl || 'https://alex.indiering.social');
      let defaultHandle = init?.handle || '';
      if (!defaultHandle) {
        try {
          defaultHandle = new URL(siteUrl).hostname;
        } catch {
          defaultHandle = 'alex.indiering.social';
        }
      }

      const defaultInterests =
        init?.interests ||
        (shouldSeedStarter
          ? ['IndieWeb', 'Photography', 'Self-Hosting', 'Decentralized Web', 'Sci-Fi']
          : ['IndieWeb', 'Decentralized Web']);
      // Relative, not root-absolute: these must still resolve correctly when the exported site is
      // hosted in a subfolder (e.g. a GitHub Pages project site at username.github.io/repo-name/).
      const defaultLinks = [
        { label: 'My Webring Feed', url: './api/manifest.json' },
        { label: 'DID Identity', url: './.well-known/did.json' },
      ];
      this.db
        .prepare(
          `INSERT INTO profile (
            id, site_url, handle, display_name, tagline, bio, location,
            avatar_url, banner_url, interests_json, custom_links_json,
            theme, atproto_handle, public_key_pem, private_key_pem, publish_settings_json, updated_at
          ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          siteUrl,
          defaultHandle,
          init?.displayName || 'Alex Rivera',
          init?.tagline ??
            (shouldSeedStarter
              ? 'Digital gardener, analog photographer & webring explorer'
              : ''),
          init?.bio ??
            (shouldSeedStarter
              ? 'Welcome to my self-contained corner of the web! Everything here is hosted as static JSON & HTML, managed locally from my desktop studio, and federated across my friend ring.'
              : ''),
          init?.location ?? (shouldSeedStarter ? 'Pacific Northwest' : ''),
          init?.avatarUrl ??
            (shouldSeedStarter
              ? 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&auto=format&fit=crop&q=80'
              : ''),
          init?.bannerUrl ??
            (shouldSeedStarter
              ? 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1200&auto=format&fit=crop&q=80'
              : ''),
          JSON.stringify(defaultInterests),
          JSON.stringify(defaultLinks),
          init?.theme || 'neo-webring',
          init?.atprotoHandle ?? (shouldSeedStarter ? 'alex.bsky.social' : ''),
          publicKeyPem,
          privateKeyPem,
          JSON.stringify({
            exportPath: options?.defaultExportPath || '',
            protocol: 'sftp',
            host: '',
            port: 22,
            username: '',
            remotePath: '/var/www/html',
            atprotoPdsUrl: 'https://bsky.social',
            publishFriendsList: false,
            stripRelationshipTags: true,
            publishEndorsements: false,
            publishWebringHub: false,
            redactItemSourceAuthors: false,
          }),
          now
        );

      if (shouldSeedStarter) {
        this.seedStarterData();
      }
    }
  }

  private seedStarterData(): void {
    const albumId = 'album-pnw-trails';
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO albums (id, title, description, cover_url, tags_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        albumId,
        'Misty Morning Trails',
        '35mm film and digital snapshots from autumn hikes around old-growth forests and coastal headlands.',
        'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=800&auto=format&fit=crop&q=80',
        JSON.stringify(['photography', 'nature', 'pnw', '35mm']),
        now,
        now
      );

    const samplePhotos = [
      {
        id: 'photo-sunbeams',
        url: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1200&auto=format&fit=crop&q=80',
        thumbUrl: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=400&auto=format&fit=crop&q=80',
        caption: 'First light breaking through the Douglas fir canopy at 6:30 AM.',
        tags: ['forest', 'sunlight', 'morning'],
      },
      {
        id: 'photo-coast-fog',
        url: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1200&auto=format&fit=crop&q=80',
        thumbUrl: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=400&auto=format&fit=crop&q=80',
        caption: 'Ridge line rolling fog before the rain moved in.',
        tags: ['fog', 'mountains', 'landscape'],
      },
    ];

    for (const p of samplePhotos) {
      this.db
        .prepare(
          `INSERT INTO photos (id, album_id, url, thumb_url, caption, alt_text, tags_json, width, height, taken_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(p.id, albumId, p.url, p.thumbUrl, p.caption, p.caption, JSON.stringify(p.tags), 1200, 800, now, now);
    }

    const sampleItems: Array<{
      id: string;
      type: SharedItemType;
      title: string;
      targetUrl: string;
      targetAuthorUrl: string;
      targetAuthorName: string;
      category: string;
      commentary: string;
      mediaUrl: string;
      rating: number;
      tags: string[];
    }> = [
      {
        id: 'item-welcome-post',
        type: 'post',
        title: 'Building My Own Static Social Wall on the IndieWeb',
        targetUrl: 'https://alex.indiering.social/api/items.json#item-welcome-post',
        targetAuthorUrl: '',
        targetAuthorName: '',
        category: 'status',
        commentary:
          'Just set up my self-contained profile wall! No algorithms, no cloud database lock-in—just local SQLite authoring, Ed25519 signatures, and pull-federated comments across our friend ring.',
        mediaUrl:
          'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&auto=format&fit=crop&q=80',
        rating: 5,
        tags: ['status', 'indieweb', 'webring'],
      },
      {
        id: 'item-posse-manifesto',
        type: 'share',
        title: 'Why Small Static Websites & Webrings Are Returning',
        targetUrl: 'https://indieweb.org/POSSE',
        targetAuthorUrl: 'https://indieweb.org',
        targetAuthorName: 'IndieWeb Community',
        category: 'article',
        commentary: 'Owning your own digital home and syndicating outward via clean JSON schemas is the antidote to algorithmic burnout.',
        mediaUrl: '',
        rating: 5,
        tags: ['indieweb', 'federation', 'webrings'],
      },
      {
        id: 'item-synth-album',
        type: 'like',
        title: 'Music for Subterranean Greenhouses (Ambient Tape Loop LP)',
        targetUrl: 'https://maya.indiering.social/api/items.json#item-ambient-tape',
        targetAuthorUrl: 'https://maya.indiering.social',
        targetAuthorName: 'Maya Lin',
        category: 'music',
        commentary: 'Been listening to this modular synth tape study non-stop while editing photos.',
        mediaUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
        rating: 5,
        tags: ['ambient', 'synth', 'music'],
      },
      {
        id: 'item-camera-rec',
        type: 'recommendation',
        title: 'Olympus OM-1 Mechanical 35mm SLR',
        targetUrl: 'https://camerawiki.org/olympus-om1',
        targetAuthorUrl: '',
        targetAuthorName: 'Camera Wiki',
        category: 'gear',
        commentary: 'Fully mechanical shutter, huge bright viewfinder, and compact enough to carry on every trail.',
        mediaUrl: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=600&auto=format&fit=crop&q=80',
        rating: 5,
        tags: ['camera', 'film', 'photography'],
      },
    ];

    for (const item of sampleItems) {
      this.db
        .prepare(
          `INSERT INTO items (
            id, type, title, target_url, target_author_url, target_author_name,
            category, commentary, media_url, rating, tags_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          item.id,
          item.type,
          item.title,
          item.targetUrl,
          item.targetAuthorUrl,
          item.targetAuthorName,
          item.category,
          item.commentary,
          item.mediaUrl,
          item.rating,
          JSON.stringify(item.tags),
          now
        );
    }

    this.db
      .prepare(
        `INSERT INTO friends (id, site_url, did, display_name, handle, avatar_url, bio, relationship_json, visibility, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'friend-maya',
        'https://maya.indiering.social',
        'did:web:maya.indiering.social',
        'Maya Lin',
        'maya.indiering.social',
        'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=300&auto=format&fit=crop&q=80',
        'Sound designer, botanical illustrator & modular synth tinkerer.',
        JSON.stringify(['friend', 'met', 'muse']),
        'private',
        now
      );

    this.db
      .prepare(
        `INSERT INTO webrings (id, name, hub_url, description, prev_site_url, next_site_url, joined_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'ring-indie-craft',
        'Indie Craft & Photo Ring',
        'https://ring.indiecraft.org/webring-hub.json',
        'A federated ring of independent photographers, makers, and digital gardeners.',
        'https://maya.indiering.social',
        'https://devon.indiering.social',
        now
      );
  }

  public getProfile(): ProfileDocument & { publicKeyPem: string; publishSettings: PublishSettings } {
    const row = this.db.prepare('SELECT * FROM profile WHERE id = 1').get() as Record<string, unknown>;
    const siteUrl = normalizeSiteUrl(String(row.site_url));
    const did = siteUrlToDidWeb(siteUrl);
    const storedPublish = JSON.parse(String(row.publish_settings_json || '{}'));
    const publishSettings: PublishSettings = {
      exportPath: '',
      protocol: 'sftp',
      host: '',
      port: 22,
      username: '',
      password: '',
      remotePath: '/var/www/html',
      atprotoPdsUrl: 'https://bsky.social',
      publishFriendsList: false,
      stripRelationshipTags: true,
      publishEndorsements: false,
      publishWebringHub: false,
      redactItemSourceAuthors: false,
      commentProvider: 'none',
      giscusRepo: '',
      giscusRepoId: '',
      giscusCategory: 'General',
      giscusCategoryId: '',
      analyticsEnabled: false,
      analyticsMeasurementId: '',
      analyticsRespectDnt: true,
      analyticsAnonymizeIp: true,
      analyticsTrackRingInteractions: true,
      adsEnabled: false,
      adsPublisherId: '',
      adsEnableAutoAds: true,
      adsGenerateAdsTxt: true,
      adsHeaderSlotId: '',
      adsInFeedSlotId: '',
      adsFooterSlotId: '',
      githubOwner: '',
      githubRepo: '',
      githubBranch: 'gh-pages',
      githubToken: '',
      githubCustomDomain: '',
      ...storedPublish,
    };
    // Credentials never leave the database in readable form; see getPublishCredentials()
    for (const field of SECRET_PUBLISH_FIELDS) {
      publishSettings[field] = storedPublish[field] ? STORED_SECRET_PLACEHOLDER : '';
    }

    const commentConfig =
      publishSettings.commentProvider && publishSettings.commentProvider !== 'none'
        ? {
            provider: publishSettings.commentProvider,
            giscusRepo: publishSettings.giscusRepo || '',
            giscusRepoId: publishSettings.giscusRepoId || '',
            giscusCategory: publishSettings.giscusCategory || 'General',
            giscusCategoryId: publishSettings.giscusCategoryId || '',
          }
        : undefined;

    const cleanGa4Id = (publishSettings.analyticsMeasurementId || '').trim().toUpperCase();
    const analyticsAddon: AnalyticsAddon | undefined =
      publishSettings.analyticsEnabled && isValidGa4MeasurementId(cleanGa4Id)
        ? {
            enabled: true,
            measurementId: cleanGa4Id,
            respectDoNotTrack: publishSettings.analyticsRespectDnt !== false,
            anonymizeIp: publishSettings.analyticsAnonymizeIp !== false,
            trackRingInteractions: publishSettings.analyticsTrackRingInteractions !== false,
          }
        : undefined;

    const cleanPubId = normalizeAdSensePublisherId(publishSettings.adsPublisherId);
    const adsAddon: AdsAddon | undefined =
      publishSettings.adsEnabled && cleanPubId
        ? {
            enabled: true,
            publisherId: cleanPubId,
            enableAutoAds: publishSettings.adsEnableAutoAds !== false,
            generateAdsTxt: publishSettings.adsGenerateAdsTxt !== false,
            headerSlotId: isValidAdSlotId(publishSettings.adsHeaderSlotId)
              ? publishSettings.adsHeaderSlotId!.trim()
              : '',
            inFeedSlotId: isValidAdSlotId(publishSettings.adsInFeedSlotId)
              ? publishSettings.adsInFeedSlotId!.trim()
              : '',
            footerSlotId: isValidAdSlotId(publishSettings.adsFooterSlotId)
              ? publishSettings.adsFooterSlotId!.trim()
              : '',
          }
        : undefined;

    return {
      schemaVersion: WEBRING_SCHEMA_VERSION,
      did,
      siteUrl,
      handle: String(row.handle),
      displayName: String(row.display_name),
      tagline: String(row.tagline || ''),
      bio: String(row.bio || ''),
      location: String(row.location || ''),
      avatarUrl: String(row.avatar_url || ''),
      bannerUrl: String(row.banner_url || ''),
      interests: JSON.parse(String(row.interests_json || '[]')),
      customLinks: JSON.parse(String(row.custom_links_json || '[]')),
      theme: (row.theme as ProfileTheme) || 'neo-webring',
      atprotoHandle: String(row.atproto_handle || ''),
      commentConfig,
      analyticsAddon,
      adsAddon,
      updatedAt: String(row.updated_at),
      publicKeyPem: String(row.public_key_pem),
      publishSettings,
    };
  }

  public getKeys(): { publicKeyPem: string; privateKeyPem: string } {
    const row = this.db
      .prepare('SELECT public_key_pem, private_key_pem FROM profile WHERE id = 1')
      .get() as { public_key_pem: string; private_key_pem: string };
    return {
      publicKeyPem: row.public_key_pem,
      privateKeyPem: openPrivateKey(row.private_key_pem, this.keyCipher),
    };
  }

  public updateProfile(updates: Partial<ProfileDocument> & { publishSettings?: Partial<PublishSettings> }): ProfileDocument {
    const current = this.getProfile();
    const siteUrl = updates.siteUrl ? normalizeSiteUrl(updates.siteUrl) : current.siteUrl;
    const now = new Date().toISOString();

    const mergedPublish: Record<string, unknown> = {
      ...current.publishSettings,
      ...(updates.publishSettings || {}),
    };
    // current.publishSettings carries placeholders; store sealed values instead
    const storedPublish = this.readStoredPublishSettings();
    for (const field of SECRET_PUBLISH_FIELDS) {
      const incoming = updates.publishSettings?.[field];
      if (incoming === undefined || incoming === STORED_SECRET_PLACEHOLDER) {
        mergedPublish[field] = storedPublish[field] || '';
      } else {
        mergedPublish[field] = incoming ? sealSecret(incoming, this.keyCipher) : '';
      }
    }

    this.db
      .prepare(
        `UPDATE profile SET
          site_url = ?,
          handle = ?,
          display_name = ?,
          tagline = ?,
          bio = ?,
          location = ?,
          avatar_url = ?,
          banner_url = ?,
          interests_json = ?,
          custom_links_json = ?,
          theme = ?,
          atproto_handle = ?,
          publish_settings_json = ?,
          updated_at = ?
        WHERE id = 1`
      )
      .run(
        siteUrl,
        updates.handle ?? current.handle,
        updates.displayName ?? current.displayName,
        updates.tagline ?? current.tagline,
        updates.bio ?? current.bio,
        updates.location ?? current.location,
        updates.avatarUrl ?? current.avatarUrl,
        updates.bannerUrl ?? current.bannerUrl,
        JSON.stringify(updates.interests ?? current.interests),
        JSON.stringify(updates.customLinks ?? current.customLinks),
        updates.theme ?? current.theme,
        updates.atprotoHandle ?? current.atprotoHandle ?? '',
        JSON.stringify(mergedPublish),
        now
      );

    return this.getProfile();
  }

  public getAlbums(): AlbumItem[] {
    const profile = this.getProfile();
    const albumRows = this.db
      .prepare('SELECT * FROM albums ORDER BY created_at DESC')
      .all() as Array<Record<string, unknown>>;

    return albumRows.map((a) => {
      const albumId = String(a.id);
      const photoRows = this.db
        .prepare('SELECT * FROM photos WHERE album_id = ? ORDER BY created_at ASC')
        .all(albumId) as Array<Record<string, unknown>>;

      const photos: PhotoItem[] = photoRows.map((p) => {
        const photoId = String(p.id);
        return {
          id: photoId,
          canonicalUrl: buildCanonicalUrl(profile.siteUrl, 'photos', photoId),
          url: String(p.url),
          thumbUrl: String(p.thumb_url || p.url),
          caption: String(p.caption || ''),
          altText: String(p.alt_text || p.caption || ''),
          tags: JSON.parse(String(p.tags_json || '[]')),
          width: p.width ? Number(p.width) : undefined,
          height: p.height ? Number(p.height) : undefined,
          takenAt: p.taken_at ? String(p.taken_at) : undefined,
          createdAt: String(p.created_at),
        };
      });

      const coverUrl = String(a.cover_url || '') || (photos[0] ? photos[0].thumbUrl : '');

      return {
        id: albumId,
        canonicalUrl: buildCanonicalUrl(profile.siteUrl, 'albums', albumId),
        title: String(a.title),
        description: String(a.description || ''),
        coverUrl,
        tags: JSON.parse(String(a.tags_json || '[]')),
        photos,
        createdAt: String(a.created_at),
        updatedAt: String(a.updated_at),
      };
    });
  }

  public createAlbum(input: { title: string; description?: string; coverUrl?: string; tags?: string[] }): AlbumItem {
    const id = `album-${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO albums (id, title, description, cover_url, tags_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.title,
        input.description || '',
        input.coverUrl || '',
        JSON.stringify(input.tags || []),
        now,
        now
      );

    return this.getAlbums().find((a) => a.id === id)!;
  }

  public deleteAlbum(albumId: string): void {
    this.db.prepare('DELETE FROM albums WHERE id = ?').run(albumId);
  }

  public addPhotoToAlbum(input: {
    albumId: string;
    url: string;
    thumbUrl?: string;
    localSourcePath?: string;
    caption?: string;
    tags?: string[];
    width?: number;
    height?: number;
  }): PhotoItem {
    const id = `photo-${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    const thumb = input.thumbUrl || input.url;

    this.db
      .prepare(
        `INSERT INTO photos (id, album_id, url, thumb_url, local_source_path, caption, alt_text, tags_json, width, height, taken_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.albumId,
        input.url,
        thumb,
        input.localSourcePath || '',
        input.caption || '',
        input.caption || '',
        JSON.stringify(input.tags || []),
        input.width ?? null,
        input.height ?? null,
        now,
        now
      );

    this.db.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').run(now, input.albumId);

    const profile = this.getProfile();
    return {
      id,
      canonicalUrl: buildCanonicalUrl(profile.siteUrl, 'photos', id),
      url: input.url,
      thumbUrl: thumb,
      caption: input.caption || '',
      altText: input.caption || '',
      tags: input.tags || [],
      width: input.width,
      height: input.height,
      takenAt: now,
      createdAt: now,
    };
  }

  public deletePhoto(photoId: string): void {
    this.db.prepare('DELETE FROM photos WHERE id = ?').run(photoId);
  }

  public getItems(): SharedItem[] {
    const profile = this.getProfile();
    const rows = this.db
      .prepare('SELECT * FROM items ORDER BY created_at DESC')
      .all() as Array<Record<string, unknown>>;

    return rows.map((r) => {
      const id = String(r.id);
      return {
        id,
        canonicalUrl: buildCanonicalUrl(profile.siteUrl, 'items', id),
        type: (r.type as SharedItemType) || 'like',
        title: String(r.title),
        targetUrl: String(r.target_url),
        targetAuthorUrl: r.target_author_url ? String(r.target_author_url) : undefined,
        targetAuthorName: r.target_author_name ? String(r.target_author_name) : undefined,
        viaUrl: r.via_url ? String(r.via_url) : undefined,
        category: String(r.category || 'general'),
        commentary: String(r.commentary || ''),
        mediaUrl: String(r.media_url || ''),
        rating: r.rating ? Number(r.rating) : undefined,
        tags: JSON.parse(String(r.tags_json || '[]')),
        createdAt: String(r.created_at),
      };
    });
  }

  public createItem(input: {
    type: SharedItemType;
    title?: string;
    targetUrl?: string;
    targetAuthorUrl?: string;
    targetAuthorName?: string;
    viaUrl?: string;
    category?: string;
    commentary?: string;
    mediaUrl?: string;
    rating?: number;
    tags?: string[];
  }): SharedItem {
    const id = `item-${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    const profile = this.getProfile();
    const selfCanonicalUrl = buildCanonicalUrl(profile.siteUrl, 'items', id);

    const resolvedTargetUrl =
      input.targetUrl && input.targetUrl.trim() ? input.targetUrl.trim() : selfCanonicalUrl;

    let resolvedTitle = (input.title || '').trim();
    if (!resolvedTitle) {
      if (input.type === 'post') {
        const firstLine = (input.commentary || '').trim().split('\n')[0] || 'Wall Post';
        resolvedTitle = firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
      } else if (input.type === 'comment') {
        resolvedTitle = input.targetAuthorName
          ? `Comment on ${input.targetAuthorName}'s post`
          : 'Comment';
      } else {
        resolvedTitle = 'Shared Item';
      }
    }

    this.db
      .prepare(
        `INSERT INTO items (
          id, type, title, target_url, target_author_url, target_author_name,
          via_url, category, commentary, media_url, rating, tags_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.type,
        resolvedTitle,
        resolvedTargetUrl,
        input.targetAuthorUrl || '',
        input.targetAuthorName || '',
        input.viaUrl || '',
        input.category || (input.type === 'post' ? 'status' : input.type === 'comment' ? 'comment' : 'general'),
        input.commentary || '',
        input.mediaUrl || '',
        input.rating ?? null,
        JSON.stringify(input.tags || []),
        now
      );

    return this.getItems().find((i) => i.id === id)!;
  }

  public deleteItem(itemId: string): void {
    this.db.prepare('DELETE FROM items WHERE id = ?').run(itemId);
  }

  public getFriends(): FriendConnection[] {
    const rows = this.db
      .prepare('SELECT * FROM friends ORDER BY added_at DESC')
      .all() as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r.id),
      siteUrl: String(r.site_url),
      did: r.did ? String(r.did) : siteUrlToDidWeb(String(r.site_url)),
      displayName: String(r.display_name),
      handle: String(r.handle || ''),
      avatarUrl: String(r.avatar_url || ''),
      bio: String(r.bio || ''),
      relationship: JSON.parse(String(r.relationship_json || '["friend"]')),
      visibility: (r.visibility === 'public' ? 'public' : 'private') as FriendVisibility,
      pinnedPublicKeyPem: r.pinned_public_key_pem ? String(r.pinned_public_key_pem) : undefined,
      keyStatus: (r.key_status === 'pinned' || r.key_status === 'changed'
        ? r.key_status
        : 'unverified') as FriendKeyStatus,
      lastCrawledAt: r.last_crawled_at ? String(r.last_crawled_at) : undefined,
      addedAt: String(r.added_at),
    }));
  }

  public addOrUpdateFriend(input: {
    siteUrl: string;
    displayName: string;
    handle?: string;
    avatarUrl?: string;
    bio?: string;
    did?: string;
    relationship?: string[];
    visibility?: FriendVisibility;
    pinnedPublicKeyPem?: string;
    keyStatus?: FriendKeyStatus;
    /** Set only by the crawler, so manual edits don't look like a sync. */
    lastCrawledAt?: string;
  }): FriendConnection {
    const normalizedUrl = normalizeSiteUrl(input.siteUrl);
    const did = input.did || siteUrlToDidWeb(normalizedUrl);
    const now = new Date().toISOString();

    const existing = this.db
      .prepare('SELECT id FROM friends WHERE site_url = ?')
      .get(normalizedUrl) as { id: string } | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE friends SET
            display_name = ?,
            handle = COALESCE(NULLIF(?, ''), handle),
            avatar_url = COALESCE(NULLIF(?, ''), avatar_url),
            bio = COALESCE(NULLIF(?, ''), bio),
            did = ?,
            relationship_json = COALESCE(?, relationship_json),
            visibility = COALESCE(?, visibility),
            pinned_public_key_pem = COALESCE(NULLIF(?, ''), pinned_public_key_pem),
            key_status = COALESCE(?, key_status),
            last_crawled_at = COALESCE(?, last_crawled_at)
          WHERE id = ?`
        )
        .run(
          input.displayName,
          input.handle || '',
          input.avatarUrl || '',
          input.bio || '',
          did,
          input.relationship ? JSON.stringify(input.relationship) : null,
          input.visibility ?? null,
          input.pinnedPublicKeyPem || '',
          input.keyStatus ?? null,
          input.lastCrawledAt ?? null,
          existing.id
        );
      return this.getFriends().find((f) => f.id === existing.id)!;
    }

    const id = `friend-${crypto.randomBytes(4).toString('hex')}`;
    this.db
      .prepare(
        `INSERT INTO friends (id, site_url, did, display_name, handle, avatar_url, bio, relationship_json, visibility, pinned_public_key_pem, key_status, last_crawled_at, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        normalizedUrl,
        did,
        input.displayName,
        input.handle || new URL(normalizedUrl).hostname,
        input.avatarUrl || '',
        input.bio || '',
        JSON.stringify(input.relationship || ['friend']),
        input.visibility || 'private',
        input.pinnedPublicKeyPem || '',
        input.keyStatus || (input.pinnedPublicKeyPem ? 'pinned' : 'unverified'),
        input.lastCrawledAt ?? null,
        now
      );

    return this.getFriends().find((f) => f.id === id)!;
  }

  public setFriendVisibility(friendId: string, visibility: FriendVisibility): FriendConnection | undefined {
    this.db
      .prepare('UPDATE friends SET visibility = ? WHERE id = ?')
      .run(visibility, friendId);
    return this.getFriends().find((f) => f.id === friendId);
  }

  /**
   * Removes a friend along with everything crawled from their site, so their posts and
   * endorsements don't linger in the feed or the next export.
   */
  public deleteFriend(friendId: string): void {
    const row = this.db.prepare('SELECT site_url FROM friends WHERE id = ?').get(friendId) as
      | { site_url: string }
      | undefined;
    this.transaction(() => {
      if (row) {
        this.db.prepare('DELETE FROM network_feed WHERE friend_site_url = ?').run(row.site_url);
        this.db.prepare('DELETE FROM endorsements WHERE author_site_url = ?').run(row.site_url);
      }
      this.db.prepare('DELETE FROM friends WHERE id = ?').run(friendId);
    });
  }

  private transaction(fn: () => void): void {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * Deletes a friend's feed rows that weren't present in their latest verified documents
   * (i.e. they removed the post or photo). `scope` limits pruning to the document that was fetched.
   */
  public pruneFriendFeed(
    friendSiteUrl: string,
    scope: 'photos' | 'items',
    keepCanonicalUrls: string[]
  ): number {
    const keep = new Set(keepCanonicalUrls);
    const rows = this.db
      .prepare('SELECT id, canonical_url, entry_type FROM network_feed WHERE friend_site_url = ?')
      .all(normalizeSiteUrl(friendSiteUrl)) as Array<{ id: string; canonical_url: string; entry_type: string }>;
    const stale = rows.filter(
      (r) => (scope === 'photos') === (r.entry_type === 'photo') && !keep.has(r.canonical_url)
    );
    this.transaction(() => {
      for (const r of stale) {
        this.db.prepare('DELETE FROM network_feed WHERE id = ?').run(r.id);
      }
    });
    return stale.length;
  }

  /**
   * Deletes endorsements from a friend whose source item is no longer in their items.json.
   */
  public pruneEndorsementsFrom(authorSiteUrl: string, keepSourceItemUrls: string[]): number {
    const keep = new Set(keepSourceItemUrls);
    const rows = this.db
      .prepare('SELECT id, source_item_url FROM endorsements WHERE author_site_url = ?')
      .all(normalizeSiteUrl(authorSiteUrl)) as Array<{ id: string; source_item_url: string }>;
    const stale = rows.filter((r) => !keep.has(r.source_item_url));
    this.transaction(() => {
      for (const r of stale) {
        this.db.prepare('DELETE FROM endorsements WHERE id = ?').run(r.id);
      }
    });
    return stale.length;
  }

  public getModeration(): ModerationEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM moderation ORDER BY created_at DESC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      siteUrl: String(r.site_url),
      action: r.action as ModerationAction,
      createdAt: String(r.created_at),
    }));
  }

  public getModerationAction(siteUrl: string): ModerationAction | undefined {
    const row = this.db
      .prepare('SELECT action FROM moderation WHERE site_url = ?')
      .get(normalizeSiteUrl(siteUrl)) as { action: ModerationAction } | undefined;
    return row?.action;
  }

  /**
   * Sets (or with `null`, clears) the mute/block action for a site.
   */
  public setModeration(siteUrl: string, action: ModerationAction | null): ModerationEntry[] {
    const normalized = normalizeSiteUrl(siteUrl);
    if (action) {
      this.db
        .prepare('INSERT OR REPLACE INTO moderation (site_url, action, created_at) VALUES (?, ?, ?)')
        .run(normalized, action, new Date().toISOString());
    } else {
      this.db.prepare('DELETE FROM moderation WHERE site_url = ?').run(normalized);
    }
    return this.getModeration();
  }

  /**
   * The rings published in connections.json: rings this persona is a confirmed member of
   * (plus pre-redesign 'legacy' rows), and hosted rings the maintainer belongs to, built from
   * local tables so the maintainer never has to fetch their own hub.
   */
  public getWebrings(): WebringMembership[] {
    const joined: WebringMembership[] = this.getJoinedRings()
      .filter((r) => r.status === 'member' || r.status === 'legacy')
      .map((r) => ({
        id: r.id,
        name: r.name,
        hubUrl: r.hubUrl,
        description: r.description,
        prevSiteUrl: r.prevSiteUrl,
        nextSiteUrl: r.nextSiteUrl,
        joinedAt: r.joinedAt,
        ...(r.memberCount ? { memberCount: r.memberCount } : {}),
        ...(r.directoryUrl ? { directoryUrl: r.directoryUrl } : {}),
      }));
    const mySiteUrl = normalizeSiteUrl(this.getProfile().siteUrl);
    const hosted: WebringMembership[] = this.getHostedRings()
      .filter((ring) => ring.status === 'active' && ring.maintainerIsMember)
      .map((ring) => {
        const members = this.hubMembersFor(ring);
        const neighbors = computeRingNeighbors(members, mySiteUrl);
        return {
          id: ring.id,
          name: ring.name,
          hubUrl: ring.hubUrl,
          description: ring.description,
          prevSiteUrl: neighbors.prevSiteUrl,
          nextSiteUrl: neighbors.nextSiteUrl,
          joinedAt: ring.createdAt,
          memberCount: neighbors.memberCount,
          directoryUrl: ring.directoryUrl,
        };
      });
    return [...hosted, ...joined];
  }

  public getJoinedRings(): JoinedRing[] {
    const rows = this.db
      .prepare('SELECT * FROM webrings ORDER BY joined_at DESC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      hubUrl: String(r.hub_url),
      description: String(r.description || ''),
      status: (String(r.status || 'legacy') as JoinedRingStatus),
      maintainerUrl: String(r.maintainer_url || ''),
      maintainerDid: String(r.maintainer_did || ''),
      prevSiteUrl: r.prev_site_url ? String(r.prev_site_url) : undefined,
      nextSiteUrl: r.next_site_url ? String(r.next_site_url) : undefined,
      memberCount: Number(r.member_count || 0),
      directoryUrl: r.directory_url ? String(r.directory_url) : undefined,
      hubVerified: Boolean(r.hub_verified),
      hubUpdatedAt: r.hub_updated_at ? String(r.hub_updated_at) : undefined,
      lastSyncedAt: r.last_synced_at ? String(r.last_synced_at) : undefined,
      requestToken: r.request_token ? String(r.request_token) : undefined,
      syncWarning: r.sync_warning ? String(r.sync_warning) : undefined,
      joinedAt: String(r.joined_at),
    }));
  }

  /**
   * Inserts or updates a joined ring by hub URL. Unlike the old INSERT OR REPLACE, the row's id
   * and joined_at survive re-syncs. Only the fields passed are changed on update.
   */
  public upsertJoinedRing(input: {
    hubUrl: string;
    name?: string;
    description?: string;
    status?: JoinedRingStatus;
    maintainerUrl?: string;
    maintainerDid?: string;
    prevSiteUrl?: string | null;
    nextSiteUrl?: string | null;
    memberCount?: number;
    directoryUrl?: string;
    hubVerified?: boolean;
    hubUpdatedAt?: string;
    lastSyncedAt?: string;
    requestToken?: string;
    syncWarning?: string;
  }): JoinedRing {
    const hubUrl = input.hubUrl.trim();
    const existing = this.getJoinedRings().find((r) => r.hubUrl === hubUrl);
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO webrings (id, name, hub_url, description, prev_site_url, next_site_url, joined_at, status)
           VALUES (?, ?, ?, ?, '', '', ?, ?)`
        )
        .run(
          `ring-${crypto.randomBytes(4).toString('hex')}`,
          input.name || hubUrl,
          hubUrl,
          input.description || '',
          new Date().toISOString(),
          input.status || 'requested'
        );
    }
    const columns: Array<[string, unknown]> = [
      ['name', input.name],
      ['description', input.description],
      ['status', input.status],
      ['maintainer_url', input.maintainerUrl],
      ['maintainer_did', input.maintainerDid],
      ['prev_site_url', input.prevSiteUrl === null ? '' : input.prevSiteUrl],
      ['next_site_url', input.nextSiteUrl === null ? '' : input.nextSiteUrl],
      ['member_count', input.memberCount],
      ['directory_url', input.directoryUrl],
      ['hub_verified', input.hubVerified === undefined ? undefined : input.hubVerified ? 1 : 0],
      ['hub_updated_at', input.hubUpdatedAt],
      ['last_synced_at', input.lastSyncedAt],
      ['request_token', input.requestToken],
      ['sync_warning', input.syncWarning],
    ];
    const changed = columns.filter(([, value]) => value !== undefined);
    if (changed.length > 0) {
      this.db
        .prepare(
          `UPDATE webrings SET ${changed.map(([col]) => `${col} = ?`).join(', ')} WHERE hub_url = ?`
        )
        .run(...changed.map(([, value]) => value), hubUrl);
    }
    return this.getJoinedRings().find((r) => r.hubUrl === hubUrl)!;
  }

  /** Manual edits, only offered for pre-redesign 'legacy' rings. */
  public updateWebring(
    ringId: string,
    updates: {
      name?: string;
      hubUrl?: string;
      description?: string;
      prevSiteUrl?: string;
      nextSiteUrl?: string;
    }
  ): JoinedRing {
    const current = this.getJoinedRings().find((w) => w.id === ringId);
    if (!current) {
      throw new Error(`Webring membership "${ringId}" not found.`);
    }
    const merged = { ...current, ...updates };
    this.db
      .prepare(
        `UPDATE webrings SET name = ?, hub_url = ?, description = ?, prev_site_url = ?, next_site_url = ?
         WHERE id = ?`
      )
      .run(
        merged.name,
        merged.hubUrl.trim(),
        merged.description || '',
        merged.prevSiteUrl || '',
        merged.nextSiteUrl || '',
        ringId
      );
    return this.getJoinedRings().find((w) => w.id === ringId)!;
  }

  public deleteWebring(ringId: string): void {
    this.db.prepare('DELETE FROM webrings WHERE id = ?').run(ringId);
  }

  // ---------------------------------------------------------------------------
  // Site keys (trust on first use, one key per site)

  public getSiteKey(siteUrl: string): SiteKey | undefined {
    const row = this.db
      .prepare('SELECT * FROM site_keys WHERE site_url = ?')
      .get(normalizeSiteUrl(siteUrl)) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      siteUrl: String(row.site_url),
      did: String(row.did || ''),
      publicKeyPem: String(row.public_key_pem),
      keyStatus: row.key_status === 'changed' ? 'changed' : 'pinned',
      firstSeenAt: String(row.first_seen_at),
    };
  }

  /**
   * Pins a site's key the first time it's seen. A different key later is reported as 'changed'
   * and the original key stays pinned.
   */
  public pinSiteKey(siteUrl: string, did: string, publicKeyPem: string): 'pinned' | 'changed' {
    const normalized = normalizeSiteUrl(siteUrl);
    const existing = this.getSiteKey(normalized);
    if (!existing) {
      this.db
        .prepare(
          'INSERT INTO site_keys (site_url, did, public_key_pem, key_status, first_seen_at) VALUES (?, ?, ?, ?, ?)'
        )
        .run(normalized, did, publicKeyPem, 'pinned', new Date().toISOString());
      return 'pinned';
    }
    const status = existing.publicKeyPem.trim() === publicKeyPem.trim() ? 'pinned' : 'changed';
    this.db.prepare('UPDATE site_keys SET key_status = ? WHERE site_url = ?').run(status, normalized);
    return status;
  }

  // ---------------------------------------------------------------------------
  // Hosted rings (this persona is the maintainer)

  public getHostedRings(): HostedRing[] {
    const siteUrl = normalizeSiteUrl(this.getProfile().siteUrl);
    const rows = this.db
      .prepare('SELECT * FROM hosted_rings ORDER BY created_at ASC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => {
      const id = String(r.id);
      const slug = String(r.slug);
      const hubPath = String(r.hub_path);
      const directoryPath = `rings/${slug}/index.html`;
      const members = (
        this.db
          .prepare('SELECT * FROM ring_members WHERE ring_id = ? ORDER BY position ASC, joined_at ASC')
          .all(id) as Array<Record<string, unknown>>
      ).map((m) => ({
        siteUrl: String(m.site_url),
        displayName: String(m.display_name),
        did: String(m.did || ''),
        keyFingerprint: String(m.key_fingerprint || ''),
        position: Number(m.position || 0),
        joinedAt: String(m.joined_at),
        confirmedAt: m.confirmed_at ? String(m.confirmed_at) : undefined,
        lastVerifiedAt: m.last_verified_at ? String(m.last_verified_at) : undefined,
        failCount: Number(m.fail_count || 0),
        hidden: Boolean(m.hidden),
      }));
      const bans = (
        this.db
          .prepare('SELECT * FROM ring_bans WHERE ring_id = ? ORDER BY created_at DESC')
          .all(id) as Array<Record<string, unknown>>
      ).map((b) => ({
        siteUrl: String(b.site_url),
        did: String(b.did || ''),
        keyFingerprint: String(b.key_fingerprint || ''),
        reason: String(b.reason || ''),
        createdAt: String(b.created_at),
      }));
      return {
        id,
        slug,
        name: String(r.name),
        description: String(r.description || ''),
        hubPath,
        hubUrl: `${siteUrl}/${hubPath}`,
        directoryPath,
        directoryUrl: `${siteUrl}/${directoryPath.replace(/index\.html$/, '')}`,
        maintainerIsMember: Boolean(r.maintainer_is_member),
        status: r.status === 'closed' ? 'closed' : 'active',
        createdAt: String(r.created_at),
        updatedAt: String(r.updated_at),
        members,
        bans,
      };
    });
  }

  public getHostedRing(ringId: string): HostedRing {
    const ring = this.getHostedRings().find((r) => r.id === ringId);
    if (!ring) throw new Error(`Hosted ring "${ringId}" not found.`);
    return ring;
  }

  public createHostedRing(input: { name: string; description?: string; hubPath?: string }): HostedRing {
    const base =
      input.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'ring';
    let slug = base;
    for (let n = 2; this.db.prepare('SELECT 1 FROM hosted_rings WHERE slug = ?').get(slug); n++) {
      slug = `${base}-${n}`;
    }
    const id = `hosted-${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO hosted_rings (id, slug, name, description, hub_path, maintainer_is_member, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, 'active', ?, ?)`
      )
      .run(id, slug, input.name.trim(), input.description?.trim() || '', input.hubPath || `api/rings/${slug}.json`, now, now);
    return this.getHostedRing(id);
  }

  public updateHostedRing(
    ringId: string,
    updates: { name?: string; description?: string; maintainerIsMember?: boolean; status?: 'active' | 'closed' }
  ): HostedRing {
    const current = this.getHostedRing(ringId);
    this.db
      .prepare(
        'UPDATE hosted_rings SET name = ?, description = ?, maintainer_is_member = ?, status = ? WHERE id = ?'
      )
      .run(
        updates.name?.trim() || current.name,
        updates.description ?? current.description,
        (updates.maintainerIsMember ?? current.maintainerIsMember) ? 1 : 0,
        updates.status ?? current.status,
        ringId
      );
    this.touchHostedRing(ringId);
    return this.getHostedRing(ringId);
  }

  private touchHostedRing(ringId: string): void {
    this.db
      .prepare('UPDATE hosted_rings SET updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), ringId);
  }

  public addRingMember(
    ringId: string,
    input: { siteUrl: string; displayName: string; did: string; keyFingerprint: string; joinedAt?: string }
  ): HostedRing {
    const siteUrl = normalizeSiteUrl(input.siteUrl);
    const next = this.db
      .prepare('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM ring_members WHERE ring_id = ?')
      .get(ringId) as { n: number };
    this.db
      .prepare(
        `INSERT INTO ring_members (ring_id, site_url, display_name, did, key_fingerprint, position, joined_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(ring_id, site_url) DO UPDATE SET display_name = excluded.display_name,
           did = excluded.did, key_fingerprint = excluded.key_fingerprint`
      )
      .run(
        ringId,
        siteUrl,
        input.displayName.slice(0, 120),
        input.did,
        input.keyFingerprint,
        next.n,
        input.joinedAt || new Date().toISOString()
      );
    this.touchHostedRing(ringId);
    return this.getHostedRing(ringId);
  }

  public removeRingMember(ringId: string, siteUrl: string): HostedRing {
    this.db
      .prepare('DELETE FROM ring_members WHERE ring_id = ? AND site_url = ?')
      .run(ringId, normalizeSiteUrl(siteUrl));
    this.touchHostedRing(ringId);
    return this.getHostedRing(ringId);
  }

  public banRingMember(
    ringId: string,
    input: { siteUrl: string; did?: string; keyFingerprint?: string; reason?: string }
  ): HostedRing {
    const siteUrl = normalizeSiteUrl(input.siteUrl);
    const member = this.getHostedRing(ringId).members.find((m) => m.siteUrl === siteUrl);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO ring_bans (ring_id, site_url, did, key_fingerprint, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        ringId,
        siteUrl,
        input.did || member?.did || '',
        input.keyFingerprint || member?.keyFingerprint || '',
        input.reason || '',
        new Date().toISOString()
      );
    return this.removeRingMember(ringId, siteUrl);
  }

  public unbanRingMember(ringId: string, siteUrl: string): HostedRing {
    this.db
      .prepare('DELETE FROM ring_bans WHERE ring_id = ? AND site_url = ?')
      .run(ringId, normalizeSiteUrl(siteUrl));
    return this.getHostedRing(ringId);
  }

  /** A ban matches by site URL, DID or key, so moving to a new domain doesn't get around it. */
  public findRingBan(
    ringId: string,
    applicant: { siteUrl: string; did?: string; keyFingerprint?: string }
  ): HostedRingBan | undefined {
    const siteUrl = normalizeSiteUrl(applicant.siteUrl);
    return this.getHostedRing(ringId).bans.find(
      (b) =>
        b.siteUrl === siteUrl ||
        (Boolean(applicant.did) && b.did === applicant.did) ||
        (Boolean(applicant.keyFingerprint) && b.keyFingerprint === applicant.keyFingerprint)
    );
  }

  public setRingMemberHidden(ringId: string, siteUrl: string, hidden: boolean): HostedRing {
    this.db
      .prepare('UPDATE ring_members SET hidden = ? WHERE ring_id = ? AND site_url = ?')
      .run(hidden ? 1 : 0, ringId, normalizeSiteUrl(siteUrl));
    this.touchHostedRing(ringId);
    return this.getHostedRing(ringId);
  }

  public moveRingMember(ringId: string, siteUrl: string, direction: 'up' | 'down'): HostedRing {
    const members = this.getHostedRing(ringId).members;
    const idx = members.findIndex((m) => m.siteUrl === normalizeSiteUrl(siteUrl));
    const swapWith = direction === 'up' ? idx - 1 : idx + 1;
    if (idx === -1 || swapWith < 0 || swapWith >= members.length) {
      return this.getHostedRing(ringId);
    }
    const reordered = [...members];
    [reordered[idx], reordered[swapWith]] = [reordered[swapWith], reordered[idx]];
    this.transaction(() => {
      reordered.forEach((m, i) => {
        this.db
          .prepare('UPDATE ring_members SET position = ? WHERE ring_id = ? AND site_url = ?')
          .run(i + 1, ringId, m.siteUrl);
      });
    });
    this.touchHostedRing(ringId);
    return this.getHostedRing(ringId);
  }

  /** Records the outcome of a verified check of a member's own site. */
  public recordRingMemberCheck(
    ringId: string,
    siteUrl: string,
    result: { ok: true; listsRing: boolean; displayName?: string } | { ok: false }
  ): void {
    const normalized = normalizeSiteUrl(siteUrl);
    const now = new Date().toISOString();
    if (!result.ok) {
      this.db
        .prepare('UPDATE ring_members SET fail_count = fail_count + 1 WHERE ring_id = ? AND site_url = ?')
        .run(ringId, normalized);
      return;
    }
    this.db
      .prepare(
        `UPDATE ring_members SET fail_count = 0, last_verified_at = ?,
           confirmed_at = CASE WHEN ? THEN COALESCE(confirmed_at, ?) ELSE confirmed_at END,
           display_name = COALESCE(?, display_name)
         WHERE ring_id = ? AND site_url = ?`
      )
      .run(now, result.listsRing ? 1 : 0, now, result.displayName?.slice(0, 120) ?? null, ringId, normalized);
  }

  /**
   * Members as published in the hub: the maintainer first (when they're a member), then everyone
   * else in order. Hidden members stay listed but are skipped by navigation.
   */
  public hubMembersFor(ring: HostedRing): WebringHubDocument['members'] {
    if (ring.status === 'closed') return [];
    const profile = this.getProfile();
    const maintainer = ring.maintainerIsMember
      ? [
          {
            siteUrl: normalizeSiteUrl(profile.siteUrl),
            displayName: profile.displayName,
            did: siteUrlToDidWeb(profile.siteUrl),
            joinedAt: ring.createdAt,
          },
        ]
      : [];
    return [
      ...maintainer,
      ...ring.members
        .filter((m) => m.siteUrl !== normalizeSiteUrl(profile.siteUrl))
        .map((m) => ({
          siteUrl: m.siteUrl,
          displayName: m.displayName,
          did: m.did || undefined,
          joinedAt: m.joinedAt,
          ...(m.hidden ? { inRotation: false } : {}),
        })),
    ];
  }

  /**
   * Signed hub documents for every hosted ring. Closed rings are still published (with no
   * members) so members learn the ring closed, even on hosts where old files never get deleted.
   */
  public buildSignedHubDocuments(): Array<{ ring: HostedRing; doc: WebringHubDocument }> {
    const profile = this.getProfile();
    const siteUrl = normalizeSiteUrl(profile.siteUrl);
    const did = siteUrlToDidWeb(siteUrl);
    const rings = this.getHostedRings();
    if (rings.length === 0) return [];
    const { privateKeyPem } = this.getKeys();
    return rings.map((ring) => {
      const unsigned: WebringHubDocument = {
        schemaVersion: WEBRING_SCHEMA_VERSION,
        name: ring.name,
        description: ring.description,
        hubUrl: ring.hubUrl,
        maintainerUrl: siteUrl,
        maintainerDid: did,
        status: ring.status,
        directoryUrl: ring.directoryUrl,
        updatedAt: ring.updatedAt,
        members: this.hubMembersFor(ring),
      };
      return { ring, doc: signDocument(unsigned, did, privateKeyPem) };
    });
  }

  public getEndorsements(): EndorsementItem[] {
    const rows = this.db
      .prepare('SELECT * FROM endorsements ORDER BY created_at DESC')
      .all() as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r.id),
      targetCanonicalUrl: String(r.target_canonical_url),
      authorSiteUrl: String(r.author_site_url),
      authorName: String(r.author_name),
      authorAvatarUrl: String(r.author_avatar_url || ''),
      type: (r.type as SharedItemType) || 'like',
      commentary: String(r.commentary || ''),
      sourceItemUrl: String(r.source_item_url),
      createdAt: String(r.created_at),
      verifiedSignature: Boolean(r.verified_signature),
    }));
  }

  public upsertEndorsement(input: Omit<EndorsementItem, 'id'>): void {
    const id = `end-${crypto.createHash('sha1').update(input.sourceItemUrl).digest('hex').slice(0, 10)}`;
    this.db
      .prepare(
        `INSERT OR REPLACE INTO endorsements (
          id, target_canonical_url, author_site_url, author_name, author_avatar_url,
          type, commentary, source_item_url, created_at, verified_signature
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.targetCanonicalUrl,
        input.authorSiteUrl,
        input.authorName,
        input.authorAvatarUrl || '',
        input.type,
        input.commentary || '',
        input.sourceItemUrl,
        input.createdAt,
        input.verifiedSignature ? 1 : 0
      );
  }

  public getNetworkFeed(): NetworkFeedEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM network_feed ORDER BY created_at DESC LIMIT 200')
      .all() as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r.id),
      friendSiteUrl: String(r.friend_site_url),
      friendName: String(r.friend_name),
      friendAvatarUrl: String(r.friend_avatar_url || ''),
      friendDid: String(r.friend_did || ''),
      entryType: r.entry_type as NetworkFeedEntry['entryType'],
      title: String(r.title),
      canonicalUrl: String(r.canonical_url),
      targetUrl: String(r.target_url),
      commentary: String(r.commentary || ''),
      mediaUrl: String(r.media_url || ''),
      tags: JSON.parse(String(r.tags_json || '[]')),
      createdAt: String(r.created_at),
      verifiedSignature: Boolean(r.verified_signature),
    }));
  }

  /**
   * The feed as the user has curated it: muted and blocked sites removed. Unverified entries
   * stay (they're badged in the UI) but are counted so the user can see how many there are.
   */
  public getCuratedNetworkFeed(): CuratedView<NetworkFeedEntry> {
    const moderation = new Map(this.getModeration().map((m) => [m.siteUrl, m.action]));
    const excluded: CuratedExclusions = { muted: 0, blocked: 0, unverified: 0 };
    const entries = this.getNetworkFeed().filter((entry) => {
      const action = moderation.get(entry.friendSiteUrl);
      if (action === 'block') {
        excluded.blocked++;
        return false;
      }
      if (action === 'mute') {
        excluded.muted++;
        return false;
      }
      if (!entry.verifiedSignature) excluded.unverified++;
      return true;
    });
    return { entries, excluded };
  }

  /**
   * Endorsements with blocked sites removed. With `forExport`, unverified endorsements are
   * also dropped so the published site only carries signatures we could check. Muting is a
   * local-reading preference and doesn't affect what's published.
   */
  public getCuratedEndorsements(options: { forExport?: boolean } = {}): CuratedView<EndorsementItem> {
    const moderation = new Map(this.getModeration().map((m) => [m.siteUrl, m.action]));
    const excluded: CuratedExclusions = { muted: 0, blocked: 0, unverified: 0 };
    const entries = this.getEndorsements().filter((e) => {
      const action = moderation.get(normalizeSiteUrl(e.authorSiteUrl));
      if (action === 'block') {
        excluded.blocked++;
        return false;
      }
      if (action === 'mute' && !options.forExport) {
        excluded.muted++;
        return false;
      }
      if (options.forExport && !e.verifiedSignature) {
        excluded.unverified++;
        return false;
      }
      return true;
    });
    return { entries, excluded };
  }

  /**
   * Records a successful static-site generation without bumping the profile's `updated_at`
   * (which would make the profile look "changed since publish").
   */
  public recordPublished(publishedAt: string, counts: PublishedCounts, fingerprint?: string): void {
    const row = this.db.prepare('SELECT publish_settings_json FROM profile WHERE id = 1').get() as {
      publish_settings_json: string;
    };
    const stored = JSON.parse(String(row.publish_settings_json || '{}'));
    this.db
      .prepare('UPDATE profile SET publish_settings_json = ? WHERE id = 1')
      .run(
        JSON.stringify({
          ...stored,
          lastPublishedAt: publishedAt,
          lastPublishedCounts: counts,
          ...(fingerprint ? { lastPublishedFingerprint: fingerprint } : {}),
        })
      );
  }

  /**
   * How many of the user's own items, photos, albums and profile edits are newer than the last publish.
   */
  public countChangesSince(sinceIso: string | undefined): number {
    if (!sinceIso) return 0;
    const count = (sql: string) => (this.db.prepare(sql).get(sinceIso) as { n: number }).n;
    return (
      count('SELECT COUNT(*) AS n FROM items WHERE created_at > ?') +
      count('SELECT COUNT(*) AS n FROM photos WHERE created_at > ?') +
      count('SELECT COUNT(*) AS n FROM albums WHERE updated_at > ?') +
      count('SELECT COUNT(*) AS n FROM profile WHERE updated_at > ?') +
      count('SELECT COUNT(*) AS n FROM hosted_rings WHERE updated_at > ?')
    );
  }

  public upsertNetworkFeedEntry(entry: Omit<NetworkFeedEntry, 'id'>): void {
    const id = `feed-${crypto.createHash('sha1').update(entry.canonicalUrl).digest('hex').slice(0, 10)}`;
    this.db
      .prepare(
        `INSERT OR REPLACE INTO network_feed (
          id, friend_site_url, friend_name, friend_avatar_url, friend_did,
          entry_type, title, canonical_url, target_url, commentary,
          media_url, tags_json, created_at, verified_signature
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        entry.friendSiteUrl,
        entry.friendName,
        entry.friendAvatarUrl,
        entry.friendDid,
        entry.entryType,
        entry.title,
        entry.canonicalUrl,
        entry.targetUrl,
        entry.commentary,
        entry.mediaUrl,
        JSON.stringify(entry.tags || []),
        entry.createdAt,
        entry.verifiedSignature ? 1 : 0
      );
  }

  public buildSignedSiteBundle(): CompleteSiteBundle {
    const rawProfile = this.getProfile();
    const publishSettings = rawProfile.publishSettings;
    const { publicKeyPem, privateKeyPem } = this.getKeys();
    const siteUrl = normalizeSiteUrl(rawProfile.siteUrl);
    const did = siteUrlToDidWeb(siteUrl);
    const now = new Date().toISOString();

    const didDocument = buildDidDocument(
      siteUrl,
      publicKeyPem,
      rawProfile.atprotoHandle || rawProfile.handle,
      publishSettings?.atprotoPdsUrl
    );

    const profileUnsigned: ProfileDocument = {
      schemaVersion: WEBRING_SCHEMA_VERSION,
      did,
      siteUrl,
      handle: rawProfile.handle,
      displayName: rawProfile.displayName,
      tagline: rawProfile.tagline,
      bio: rawProfile.bio,
      location: rawProfile.location,
      avatarUrl: rawProfile.avatarUrl,
      bannerUrl: rawProfile.bannerUrl,
      interests: rawProfile.interests,
      customLinks: rawProfile.customLinks,
      theme: rawProfile.theme,
      atprotoHandle: rawProfile.atprotoHandle,
      ...(rawProfile.commentConfig ? { commentConfig: rawProfile.commentConfig } : {}),
      ...(rawProfile.analyticsAddon ? { analyticsAddon: rawProfile.analyticsAddon } : {}),
      ...(rawProfile.adsAddon ? { adsAddon: rawProfile.adsAddon } : {}),
      updatedAt: now,
    };
    const profile = signDocument(profileUnsigned, did, privateKeyPem);

    const albumList = this.getAlbums();
    const albumsUnsigned: AlbumsDocument = {
      schemaVersion: WEBRING_SCHEMA_VERSION,
      siteUrl,
      did,
      updatedAt: now,
      albums: albumList,
    };
    const albums = signDocument(albumsUnsigned, did, privateKeyPem);

    const rawItems = this.getItems();
    const exportedItems: SharedItem[] = publishSettings?.redactItemSourceAuthors
      ? rawItems.map((item) => ({
          ...item,
          targetAuthorUrl: undefined,
          targetAuthorName: undefined,
          viaUrl: undefined,
        }))
      : rawItems;

    const itemsUnsigned: ItemsDocument = {
      schemaVersion: WEBRING_SCHEMA_VERSION,
      siteUrl,
      did,
      updatedAt: now,
      items: exportedItems,
    };
    const items = signDocument(itemsUnsigned, did, privateKeyPem);

    const allFriends = this.getFriends();
    const exportedFriends: FriendConnection[] = publishSettings?.publishFriendsList
      ? allFriends
          .filter((f) => f.visibility === 'public')
          .map(({ pinnedPublicKeyPem: _pk, keyStatus: _ks, ...f }) => ({
            ...f,
            relationship: publishSettings?.stripRelationshipTags !== false ? [] : f.relationship,
          }))
      : [];

    const webringList = this.getWebrings();
    const exportedEndorsements: EndorsementItem[] = publishSettings?.publishEndorsements
      ? this.getCuratedEndorsements({ forExport: true }).entries
      : [];

    const connectionsUnsigned: ConnectionsDocument = {
      schemaVersion: WEBRING_SCHEMA_VERSION,
      siteUrl,
      did,
      updatedAt: now,
      friends: exportedFriends,
      webrings: webringList,
      endorsements: exportedEndorsements,
    };
    const connections = signDocument(connectionsUnsigned, did, privateKeyPem);

    const totalPhotos = albumList.reduce((acc, a) => acc + a.photos.length, 0);
    const manifestUnsigned: WebringManifest = {
      schemaVersion: WEBRING_SCHEMA_VERSION,
      siteUrl,
      did,
      updatedAt: now,
      endpoints: {
        did: '/.well-known/did.json',
        profile: '/api/profile.json',
        albums: '/api/albums.json',
        items: '/api/items.json',
        connections: '/api/connections.json',
      },
      stats: {
        albumCount: albumList.length,
        photoCount: totalPhotos,
        itemCount: exportedItems.length,
        friendCount: exportedFriends.length,
        webringCount: webringList.length,
      },
    };
    const manifest = signDocument(manifestUnsigned, did, privateKeyPem);

    return {
      didDocument,
      manifest,
      profile,
      albums,
      items,
      connections,
    };
  }

  public close(): void {
    this.db.close();
  }
}
