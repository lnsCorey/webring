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
  WebringManifest,
  WebringMembership,
} from '../../src/shared/schema';

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
    this.initializeSchema();
    this.ensureDefaultProfile(options);
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
      privateKeyPem: row.private_key_pem,
    };
  }

  public updateProfile(updates: Partial<ProfileDocument> & { publishSettings?: Partial<PublishSettings> }): ProfileDocument {
    const current = this.getProfile();
    const siteUrl = updates.siteUrl ? normalizeSiteUrl(updates.siteUrl) : current.siteUrl;
    const now = new Date().toISOString();

    const mergedPublish = {
      ...current.publishSettings,
      ...(updates.publishSettings || {}),
    };

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
            last_crawled_at = ?
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
          now,
          existing.id
        );
      return this.getFriends().find((f) => f.id === existing.id)!;
    }

    const id = `friend-${crypto.randomBytes(4).toString('hex')}`;
    this.db
      .prepare(
        `INSERT INTO friends (id, site_url, did, display_name, handle, avatar_url, bio, relationship_json, visibility, pinned_public_key_pem, key_status, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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

  public deleteFriend(friendId: string): void {
    this.db.prepare('DELETE FROM friends WHERE id = ?').run(friendId);
  }

  public getWebrings(): WebringMembership[] {
    const rows = this.db
      .prepare('SELECT * FROM webrings ORDER BY joined_at DESC')
      .all() as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      hubUrl: String(r.hub_url),
      description: String(r.description || ''),
      prevSiteUrl: r.prev_site_url ? String(r.prev_site_url) : undefined,
      nextSiteUrl: r.next_site_url ? String(r.next_site_url) : undefined,
      joinedAt: String(r.joined_at),
    }));
  }

  public addWebring(input: {
    name: string;
    hubUrl: string;
    description?: string;
    prevSiteUrl?: string;
    nextSiteUrl?: string;
  }): WebringMembership {
    const id = `ring-${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO webrings (id, name, hub_url, description, prev_site_url, next_site_url, joined_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.name,
        input.hubUrl.trim(),
        input.description || '',
        input.prevSiteUrl || '',
        input.nextSiteUrl || '',
        now
      );

    return this.getWebrings().find((w) => w.hubUrl === input.hubUrl.trim())!;
  }

  public updateWebring(
    ringId: string,
    updates: {
      name?: string;
      hubUrl?: string;
      description?: string;
      prevSiteUrl?: string;
      nextSiteUrl?: string;
    }
  ): WebringMembership {
    const current = this.getWebrings().find((w) => w.id === ringId);
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
    return this.getWebrings().find((w) => w.id === ringId)!;
  }

  public deleteWebring(ringId: string): void {
    this.db.prepare('DELETE FROM webrings WHERE id = ?').run(ringId);
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
      ? this.getEndorsements()
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
