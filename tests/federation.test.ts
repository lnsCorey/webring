import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import {
  buildCanonicalUrl,
  buildDidDocument,
  buildWebringUri,
  generateIdentityKeyPair,
  parseWebringUri,
  signDocument,
  siteUrlToDidWeb,
  verifyDocumentSignature,
  WebringManifestSchema,
} from '../src/shared/schema';
import { STORED_SECRET_PLACEHOLDER, StudioDatabase } from '../electron/db/database';
import { StaticSiteGenerator } from '../electron/services/siteGenerator';
import { defaultJsonFetcher, RingCrawler } from '../electron/services/ringCrawler';
import { RingService } from '../electron/services/ringService';
import { jobNextRunAt, nextRunAt, Scheduler } from '../electron/services/scheduler';
import { runScheduledPublish } from '../electron/services/jobs';
import { isPrivateNetworkAddress } from '../electron/security/networkGuard';
import { PersonaManager } from '../electron/services/personaManager';
import { SitePublisher } from '../electron/services/publisher';
import { KeyCipher, KeyVaultUnavailableError } from '../electron/security/keyVault';
import { LocalPreviewServer } from '../electron/services/localPreviewServer';
import { WebringMcpServer } from '../electron/mcp/mcpServer';
import { McpHttpServer } from '../electron/mcp/mcpHttpServer';

describe('Webring Schema, DID Identity & Ed25519 Signatures', () => {
  it('converts website URLs into standard W3C / ATProto did:web identifiers', () => {
    expect(siteUrlToDidWeb('https://alice.indiering.social')).toBe(
      'did:web:alice.indiering.social'
    );
    expect(siteUrlToDidWeb('https://example.com/users/bob/')).toBe(
      'did:web:example.com:users:bob'
    );
  });

  it('builds deterministic canonical URLs for albums, photos, and shared items', () => {
    expect(buildCanonicalUrl('https://alice.example.com/', 'albums', 'alb-1')).toBe(
      'https://alice.example.com/api/albums.json#album-alb-1'
    );
    expect(buildCanonicalUrl('https://alice.example.com', 'photos', 'ph-99')).toBe(
      'https://alice.example.com/api/albums.json#photo-ph-99'
    );
    expect(buildCanonicalUrl('https://alice.example.com', 'items', 'it-42')).toBe(
      'https://alice.example.com/api/items.json#item-it-42'
    );
  });

  it('signs JSON documents with Ed25519 and verifies tampering', () => {
    const { publicKeyPem, privateKeyPem } = generateIdentityKeyPair();
    const did = 'did:web:alice.example.com';
    const didDoc = buildDidDocument('https://alice.example.com', publicKeyPem, 'alice.bsky.social');
    expect(didDoc.id).toBe(did);

    const payload = {
      schemaVersion: '1.0.0',
      siteUrl: 'https://alice.example.com',
      did,
      title: 'Test Payload',
    };

    const signed = signDocument(payload, did, privateKeyPem);
    expect(signed.proof).toBeDefined();
    expect(verifyDocumentSignature(signed, publicKeyPem)).toBe(true);

    // Tamper with the signed document and verify signature fails
    const tampered = { ...signed, title: 'Modified Title' };
    expect(verifyDocumentSignature(tampered, publicKeyPem)).toBe(false);
  });

  it('round-trips webring:// deep link URIs for static site interactions', () => {
    const uri = buildWebringUri({
      action: 'like',
      targetUrl: 'https://alice.example.com/api/albums.json#photo-1',
      title: 'Misty Trail',
      authorName: 'Alice',
      authorUrl: 'https://alice.example.com',
      category: 'photo',
    });

    const parsed = parseWebringUri(uri);
    expect(parsed).toEqual({
      action: 'like',
      targetUrl: 'https://alice.example.com/api/albums.json#photo-1',
      title: 'Misty Trail',
      authorName: 'Alice',
      authorUrl: 'https://alice.example.com',
      mediaUrl: undefined,
      category: 'photo',
    });
  });
});

describe('Two-Peer Pull Federation, Static Site Generation & Endorsement Discovery', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webring-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('exports Alice and Bob static JSON sites and indexes mutual likes/shares across the ring', async () => {
    const aliceDir = path.join(tempRoot, 'alice');
    const bobDir = path.join(tempRoot, 'bob');

    const aliceDb = new StudioDatabase(aliceDir, 'alice.sqlite');
    const bobDb = new StudioDatabase(bobDir, 'bob.sqlite');

    // 1. Configure Alice's profile & create a new photo in her album
    aliceDb.updateProfile({
      siteUrl: 'https://alice.ring.test',
      handle: 'alice.ring.test',
      displayName: 'Alice Wonderland',
    });
    const aliceAlbum = aliceDb.createAlbum({
      title: 'Botanical Glasshouse',
      description: 'Rare ferns and orchids',
      tags: ['botany', 'glasshouse'],
    });
    const alicePhoto = aliceDb.addPhotoToAlbum({
      albumId: aliceAlbum.id,
      url: 'https://alice.ring.test/media/fern.jpg',
      caption: 'Silver fern frond',
      tags: ['fern'],
    });

    const aliceOutDir = path.join(aliceDir, 'public_html');
    const aliceGenerator = new StaticSiteGenerator(aliceDb);
    const aliceGenResult = aliceGenerator.generateToDirectory(aliceOutDir);

    expect(aliceGenResult.filesWritten).toContain('.well-known/did.json');
    expect(aliceGenResult.filesWritten).toContain('api/manifest.json');
    expect(aliceGenResult.filesWritten).toContain('api/albums.json');
    expect(aliceGenResult.filesWritten).toContain('index.html');
    expect(aliceGenResult.filesWritten).toContain('.nojekyll');

    // Validate generated manifest on disk
    const manifestOnDisk = JSON.parse(
      fs.readFileSync(path.join(aliceOutDir, 'api/manifest.json'), 'utf8')
    );
    expect(() => WebringManifestSchema.parse(manifestOnDisk)).not.toThrow();

    // 2. Configure Bob's profile, crawl Alice's static JSON site, and like Alice's photo
    bobDb.updateProfile({
      siteUrl: 'https://bob.ring.test',
      handle: 'bob.ring.test',
      displayName: 'Bob Builder',
    });

    const bobCrawler = new RingCrawler(bobDb);
    const crawlAliceRes = await bobCrawler.crawlFriendSite('https://alice.ring.test', aliceOutDir);
    expect(crawlAliceRes.success).toBe(true);
    expect(crawlAliceRes.verifiedSignature).toBe(true);
    expect(crawlAliceRes.photosIndexed).toBeGreaterThan(0);

    // Bob's neighborhood feed now contains Alice's photo
    const bobFeed = bobDb.getNetworkFeed();
    expect(bobFeed.some((f) => f.canonicalUrl === alicePhoto.canonicalUrl)).toBe(true);

    // Bob likes Alice's photo by referencing its canonicalUrl
    bobDb.createItem({
      type: 'like',
      title: 'Loved Alice’s Silver Fern Photo!',
      targetUrl: alicePhoto.canonicalUrl,
      targetAuthorName: 'Alice Wonderland',
      targetAuthorUrl: 'https://alice.ring.test',
      category: 'photo',
      commentary: 'Incredible detail on those fronds!',
      tags: ['botany', 'ring-love'],
    });

    const bobOutDir = path.join(bobDir, 'public_html');
    const bobGenerator = new StaticSiteGenerator(bobDb);
    bobGenerator.generateToDirectory(bobOutDir);

    // 3. Alice crawls Bob's static JSON site and automatically discovers Bob's endorsement!
    const aliceCrawler = new RingCrawler(aliceDb);
    const crawlBobRes = await aliceCrawler.crawlFriendSite('https://bob.ring.test', bobOutDir);
    expect(crawlBobRes.success).toBe(true);
    expect(crawlBobRes.verifiedSignature).toBe(true);
    expect(crawlBobRes.endorsementsFound).toBe(1);

    const aliceEndorsements = aliceDb.getEndorsements();
    expect(aliceEndorsements).toHaveLength(1);
    expect(aliceEndorsements[0].targetCanonicalUrl).toBe(alicePhoto.canonicalUrl);
    expect(aliceEndorsements[0].authorName).toBe('Bob Builder');
    expect(aliceEndorsements[0].verifiedSignature).toBe(true);

    aliceDb.close();
    bobDb.close();
  });

  it('protects the social graph by default: crawls private friends locally without leaking connections in static JSON or HTML', async () => {
    const aliceDir = path.join(tempRoot, 'alice-priv');
    const bobDir = path.join(tempRoot, 'bob-priv');
    const carolDir = path.join(tempRoot, 'carol-priv');

    const aliceDb = new StudioDatabase(aliceDir, 'alice.sqlite');
    const bobDb = new StudioDatabase(bobDir, 'bob.sqlite');

    bobDb.updateProfile({
      siteUrl: 'https://bob-secret.ring.test',
      handle: 'bob-secret.ring.test',
      displayName: 'Bob Secret',
    });
    const bobOutDir = path.join(bobDir, 'public_html');
    new StaticSiteGenerator(bobDb).generateToDirectory(bobOutDir);

    // Alice adds Bob (default visibility: 'private') and Carol (explicitly 'public')
    const bobFriend = aliceDb.addOrUpdateFriend({
      siteUrl: 'https://bob-secret.ring.test',
      displayName: 'Bob Secret',
      relationship: ['friend', 'kin', 'met'],
    });
    expect(bobFriend.visibility).toBe('private');

    const carolFriend = aliceDb.addOrUpdateFriend({
      siteUrl: 'https://carol-public.ring.test',
      displayName: 'Carol Public',
      relationship: ['friend', 'colleague'],
      visibility: 'public',
    });
    expect(carolFriend.visibility).toBe('public');

    // Alice crawls Bob's site into her local SQLite feed
    const aliceCrawler = new RingCrawler(aliceDb);
    const crawlRes = await aliceCrawler.crawlFriendSite('https://bob-secret.ring.test', bobOutDir);
    expect(crawlRes.success).toBe(true);
    // Crawling must preserve Bob's private visibility
    expect(
      aliceDb.getFriends().find((f) => f.siteUrl === 'https://bob-secret.ring.test')?.visibility
    ).toBe('private');

    // 1. Default export: publishFriendsList is false, publishWebringHub is false
    const aliceOutDir = path.join(aliceDir, 'public_html');
    const aliceGen = new StaticSiteGenerator(aliceDb);
    const defaultExport = aliceGen.generateToDirectory(aliceOutDir);

    expect(defaultExport.bundle.connections.friends).toHaveLength(0);
    expect(defaultExport.bundle.manifest.stats.friendCount).toBe(0);
    expect(fs.existsSync(path.join(aliceOutDir, 'api/webring-hub.json'))).toBe(false);

    const connectionsJsonRaw = fs.readFileSync(
      path.join(aliceOutDir, 'api/connections.json'),
      'utf8'
    );
    const indexHtmlRaw = fs.readFileSync(path.join(aliceOutDir, 'index.html'), 'utf8');
    expect(connectionsJsonRaw).not.toContain('bob-secret.ring.test');
    expect(connectionsJsonRaw).not.toContain('carol-public.ring.test');
    expect(indexHtmlRaw).not.toContain('bob-secret.ring.test');

    // 2. Enable publishFriendsList (with stripRelationshipTags: true by default)
    aliceDb.updateProfile({
      publishSettings: {
        publishFriendsList: true,
        stripRelationshipTags: true,
        redactItemSourceAuthors: true,
      },
    });
    const selectiveExport = aliceGen.generateToDirectory(aliceOutDir);

    // Only Carol (public) is exported; Bob (private) is still hidden!
    expect(selectiveExport.bundle.connections.friends).toHaveLength(1);
    expect(selectiveExport.bundle.connections.friends[0].siteUrl).toBe(
      'https://carol-public.ring.test'
    );
    // XFN relationship tags ('friend', 'colleague') are stripped from exported JSON
    expect(selectiveExport.bundle.connections.friends[0].relationship).toEqual([]);
    // Local SQLite still retains Carol's relationship tags
    expect(
      aliceDb.getFriends().find((f) => f.id === carolFriend.id)?.relationship
    ).toEqual(['friend', 'colleague']);

    // Redacted item source authors in exported items.json
    expect(
      selectiveExport.bundle.items.items.every(
        (i) => i.targetAuthorUrl === undefined && i.targetAuthorName === undefined
      )
    ).toBe(true);

    aliceDb.close();
    bobDb.close();
    if (fs.existsSync(carolDir)) {
      fs.rmSync(carolDir, { recursive: true, force: true });
    }
  });

  it('compartmentalizes multiple online personas with isolated SQLite DBs, Ed25519 keys, DIDs, and friend graphs', () => {
    const userDataDir = path.join(tempRoot, 'multi-persona-studio');
    const manager = new PersonaManager(userDataDir);

    try {
      // 1. Default persona is initialized automatically
      const initialList = manager.listPersonas();
      expect(initialList.personas).toHaveLength(1);
      expect(initialList.personas[0].id).toBe('default');
      expect(initialList.personas[0].dbFileName).toBe('webring-studio.sqlite');

      const primaryCtx = manager.getActiveContext();
      const primaryProfile = primaryCtx.db.getProfile();
      primaryCtx.db.addOrUpdateFriend({
        siteUrl: 'https://primary-only-friend.test',
        displayName: 'Primary Circle Friend',
        visibility: 'private',
      });

      // 2. Create a second compartmentalized persona (e.g. a synth music alias on a subpath or separate domain)
      const secondCreated = manager.createPersona({
        label: 'Synth Alias',
        displayName: 'Nightowl Modular',
        siteUrl: 'https://user.github.io/nightowl',
        tagline: 'Late-night tape loops & Eurorack patches',
        theme: 'cyber-terminal',
      });
      const secondSummary = secondCreated.created;

      expect(secondSummary.id).not.toBe('default');
      expect(secondSummary.dbFileName).toMatch(/^persona-.*\.sqlite$/);
      expect(secondSummary.did).toBe('did:web:user.github.io:nightowl');
      expect(manager.getActivePersonaId()).toBe(secondSummary.id);

      const secondCtx = manager.getActiveContext();
      const secondProfile = secondCtx.db.getProfile();

      // 3. Verify strict cryptographic and social compartmentalization
      expect(secondProfile.publicKeyPem).not.toBe(primaryProfile.publicKeyPem);
      expect(secondProfile.did).not.toBe(primaryProfile.did);
      expect(secondCtx.db.getFriends()).toHaveLength(0);
      expect(secondCtx.db.getAlbums()).toHaveLength(0);
      expect(secondCtx.db.getItems()).toHaveLength(0);

      // Add an item and friend exclusively to Persona 2
      secondCtx.db.createItem({
        type: 'recommendation',
        title: 'Tape Loop Technique #4',
        targetUrl: 'https://synth.example.com/tape-loops',
        category: 'music',
        commentary: 'Essential cassette splice guide.',
        tags: ['modular', 'tape'],
      });

      // Export Persona 2 static site and verify subpath did.json + .well-known/did.json
      const persona2Out = path.join(tempRoot, 'out-persona-2');
      const gen2 = secondCtx.siteGenerator.generateToDirectory(persona2Out);
      expect(gen2.filesWritten).toContain('.well-known/did.json');
      expect(gen2.filesWritten).toContain('did.json');
      expect(gen2.bundle.didDocument.id).toBe('did:web:user.github.io:nightowl');

      // 4. Switch back to Persona 1 ('default') and confirm zero cross-contamination
      manager.switchPersona('default');
      expect(manager.getActivePersonaId()).toBe('default');
      const switchedBackCtx = manager.getActiveContext();
      expect(switchedBackCtx.db.getProfile().did).toBe(primaryProfile.did);
      expect(
        switchedBackCtx.db.getFriends().some((f) => f.siteUrl === 'https://primary-only-friend.test')
      ).toBe(true);
      expect(
        switchedBackCtx.db.getItems().some((i) => i.title === 'Tape Loop Technique #4')
      ).toBe(false);

      // Verify per-persona SFTP/FTP publishing credentials persistence & deletion
      switchedBackCtx.db.updateProfile({
        publishSettings: {
          ...switchedBackCtx.db.getProfile().publishSettings,
          protocol: 'sftp',
          host: 'sftp.primary-host.example',
          port: 2222,
          username: 'alex_admin',
          password: 'super-secret-sftp-password',
          remotePath: '/var/www/alex',
        },
      });
      expect(switchedBackCtx.db.getProfile().publishSettings.host).toBe('sftp.primary-host.example');
      // The profile only shows a placeholder; the real value is for the publisher
      expect(switchedBackCtx.db.getProfile().publishSettings.password).toBe(STORED_SECRET_PLACEHOLDER);
      expect(switchedBackCtx.db.getPublishCredentials().password).toBe('super-secret-sftp-password');

      // Persona 2's SFTP settings remain completely blank/isolated
      manager.switchPersona(secondSummary.id);
      expect(manager.getActiveContext().db.getProfile().publishSettings.host).toBe('');
      expect(manager.getActiveContext().db.getProfile().publishSettings.password).toBe('');

      // Switch back to Persona 1, confirm SFTP credentials persisted across persona switches, then clear them
      manager.switchPersona('default');
      expect(manager.getActiveContext().db.getProfile().publishSettings.host).toBe(
        'sftp.primary-host.example'
      );
      manager.getActiveContext().db.updateProfile({
        publishSettings: {
          ...manager.getActiveContext().db.getProfile().publishSettings,
          protocol: 'sftp',
          host: '',
          port: 22,
          username: '',
          password: '',
          remotePath: '/var/www/html',
        },
      });
      expect(manager.getActiveContext().db.getProfile().publishSettings.host).toBe('');
      expect(manager.getActiveContext().db.getProfile().publishSettings.password).toBe('');

      // 5. Rename and delete Persona 2
      const renamedList = manager.updatePersonaLabel(secondSummary.id, 'Underground Synth');
      expect(renamedList.personas.find((p) => p.id === secondSummary.id)?.label).toBe(
        'Underground Synth'
      );

      const delRes = manager.deletePersona(secondSummary.id);
      expect(delRes.personas).toHaveLength(1);
      expect(delRes.activePersonaId).toBe('default');

      // Primary persona cannot be deleted
      expect(() => manager.deletePersona('default')).toThrow();
    } finally {
      manager.closeAll();
    }
  });

  it('builds a local test export and serves it over a loopback HTTP preview server', async () => {
    const studioDir = path.join(tempRoot, 'preview-studio');
    const previewOutDir = path.join(tempRoot, 'preview-out');
    const db = new StudioDatabase(studioDir, 'preview.sqlite');
    const generator = new StaticSiteGenerator(db);
    const previewServer = new LocalPreviewServer();

    try {
      const res = await previewServer.runTestExportAndServe(generator, previewOutDir);
      expect(res.success).toBe(true);
      expect(res.port).toBeGreaterThan(0);
      expect(res.previewUrl).toBe(`http://127.0.0.1:${res.port}/`);
      expect(res.checks.hasIndexHtml).toBe(true);
      expect(res.checks.hasNoJekyll).toBe(true);
      expect(res.checks.hasDidJson).toBe(true);
      expect(res.checks.hasManifestJson).toBe(true);

      // Fetch the live served index.html and /api/manifest.json over HTTP
      const htmlResp = await fetch(res.previewUrl);
      expect(htmlResp.status).toBe(200);
      const htmlText = await htmlResp.text();
      expect(htmlText).toContain('window.__WEBRING_BUNDLE__');

      const manifestResp = await fetch(`${res.previewUrl}api/manifest.json`);
      expect(manifestResp.status).toBe(200);
      const manifestJson = await manifestResp.json();
      expect(() => WebringManifestSchema.parse(manifestJson)).not.toThrow();
    } finally {
      await previewServer.stop();
      db.close();
    }
  });

  it('publishes Wall Posts and federates threaded Comments across peer static sites', async () => {
    const aliceDir = path.join(tempRoot, 'alice-wall');
    const bobDir = path.join(tempRoot, 'bob-wall');
    const aliceDb = new StudioDatabase(aliceDir, 'alice.sqlite', { seedStarterData: false });
    const bobDb = new StudioDatabase(bobDir, 'bob.sqlite', { seedStarterData: false });

    try {
      aliceDb.updateProfile({
        siteUrl: 'https://alice-wall.ring.test',
        handle: 'alice-wall.ring.test',
        displayName: 'Alice Wall',
        publishSettings: {
          publishEndorsements: true,
          commentProvider: 'giscus',
          giscusRepo: 'alice/alice.github.io',
        },
      });

      // 1. Alice writes a Wall Post without needing to specify a title or external targetUrl
      const wallPost = aliceDb.createItem({
        type: 'post',
        commentary: 'Hello from my new static wall! Anyone up for a synth jam this weekend?',
        tags: ['wall', 'jam'],
      });
      expect(wallPost.type).toBe('post');
      expect(wallPost.targetUrl).toBe(wallPost.canonicalUrl);
      expect(wallPost.title).toContain('Hello from my new static wall!');

      const aliceOut = path.join(aliceDir, 'public_html');
      new StaticSiteGenerator(aliceDb).generateToDirectory(aliceOut);

      // 2. Bob crawls Alice's static site and sees her Wall Post in his Neighborhood Feed
      bobDb.updateProfile({
        siteUrl: 'https://bob-wall.ring.test',
        handle: 'bob-wall.ring.test',
        displayName: 'Bob Commenter',
      });
      const bobCrawler = new RingCrawler(bobDb);
      const crawlAlice = await bobCrawler.crawlFriendSite('https://alice-wall.ring.test', aliceOut);
      expect(crawlAlice.success).toBe(true);

      const bobFeed = bobDb.getNetworkFeed();
      const crawledPost = bobFeed.find((e) => e.canonicalUrl === wallPost.canonicalUrl);
      expect(crawledPost).toBeDefined();
      expect(crawledPost?.entryType).toBe('post');

      // 3. Bob replies with a Comment targeting Alice's Wall Post canonicalUrl
      const bobComment = bobDb.createItem({
        type: 'comment',
        targetUrl: wallPost.canonicalUrl,
        targetAuthorName: 'Alice Wall',
        targetAuthorUrl: 'https://alice-wall.ring.test',
        commentary: 'Count me in! Bringing my Eurorack case and tape delay.',
      });
      expect(bobComment.type).toBe('comment');

      const bobOut = path.join(bobDir, 'public_html');
      new StaticSiteGenerator(bobDb).generateToDirectory(bobOut);

      // 4. Alice crawls Bob's static site and discovers Bob's verified Comment on her Wall Post
      const aliceCrawler = new RingCrawler(aliceDb);
      const crawlBob = await aliceCrawler.crawlFriendSite('https://bob-wall.ring.test', bobOut);
      expect(crawlBob.success).toBe(true);
      expect(crawlBob.endorsementsFound).toBe(1);

      const aliceEndorsements = aliceDb.getEndorsements();
      expect(aliceEndorsements).toHaveLength(1);
      expect(aliceEndorsements[0].type).toBe('comment');
      expect(aliceEndorsements[0].commentary).toContain('Bringing my Eurorack case');

      // 5. Alice re-exports her site; her bundle includes both Bob's comment and her Giscus live-thread config
      const reExport = new StaticSiteGenerator(aliceDb).generateToDirectory(aliceOut);
      expect(reExport.bundle.profile.commentConfig?.provider).toBe('giscus');
      expect(reExport.bundle.profile.commentConfig?.giscusRepo).toBe('alice/alice.github.io');
      expect(reExport.bundle.connections.endorsements[0].commentary).toContain(
        'Bringing my Eurorack case'
      );
    } finally {
      aliceDb.close();
      bobDb.close();
    }
  });

  it('hardens static HTML against DOM XSS, verifies per-document Ed25519 signatures, and enforces TOFU key pinning', async () => {
    const aliceDir = path.join(tempRoot, 'alice-sec');
    const bobDir = path.join(tempRoot, 'bob-sec');
    const aliceDb = new StudioDatabase(aliceDir, 'alice.sqlite', { seedStarterData: false });
    const bobDb = new StudioDatabase(bobDir, 'bob.sqlite', { seedStarterData: false });

    try {
      // 1. FIX-01: Test DOM XSS & script breakout escaping in generated standalone index.html
      aliceDb.updateProfile({
        siteUrl: 'https://alice-sec.ring.test',
        handle: 'alice-sec.ring.test',
        displayName: 'Alice </script><script>window.__XSS=1</script>',
        bio: '<img src=x onerror="alert(1)">',
        customLinks: [{ label: 'Malicious Link', url: 'javascript:alert(1)' }],
      });
      const alicePost = aliceDb.createItem({
        type: 'post',
        title: 'Security Test Post <svg onload=alert(1)>',
        commentary: 'Testing HTML escaping in standalone bundle',
      });

      const aliceOut = path.join(aliceDir, 'public_html');
      new StaticSiteGenerator(aliceDb).generateToDirectory(aliceOut);
      const indexHtml = fs.readFileSync(path.join(aliceOut, 'index.html'), 'utf8');

      // Inline JSON script block must never contain literal </script>
      expect(indexHtml).not.toContain('</script><script>window.__XSS=1');
      expect(indexHtml).toContain('\\u003c/script\\u003e\\u003cscript\\u003ewindow.__XSS=1');
      expect(indexHtml).toContain('http-equiv="Content-Security-Policy"');
      expect(indexHtml).toContain('function esc(');
      expect(indexHtml).toContain('function safeUrl(');

      // 2. FIX-02 & FIX-04: Bob publishes a valid site and likes Alice's post; Alice crawls Bob (TOFU pins Bob's key)
      bobDb.updateProfile({
        siteUrl: 'https://bob-sec.ring.test',
        handle: 'bob-sec.ring.test',
        displayName: 'Bob Secure',
      });
      const bobAlbum = bobDb.createAlbum({ title: 'Verified Album' });
      bobDb.addPhotoToAlbum({
        albumId: bobAlbum.id,
        url: 'https://bob-sec.ring.test/photo.jpg',
        caption: 'Authentic Photo',
      });
      bobDb.createItem({
        type: 'like',
        title: 'Liked Alice Post',
        targetUrl: alicePost.canonicalUrl,
        commentary: 'Legitimate signed endorsement!',
      });

      const bobOut = path.join(bobDir, 'public_html');
      new StaticSiteGenerator(bobDb).generateToDirectory(bobOut);

      const aliceCrawler = new RingCrawler(aliceDb);
      const firstCrawl = await aliceCrawler.crawlFriendSite('https://bob-sec.ring.test', bobOut);
      expect(firstCrawl.success).toBe(true);
      expect(firstCrawl.verifiedSignature).toBe(true);
      expect(firstCrawl.keyChangedWarning).toBe(false);

      // Confirm Bob's Ed25519 public key is now TOFU-pinned in Alice's database
      const bobFriendAfterFirst = aliceDb
        .getFriends()
        .find((f) => f.siteUrl === 'https://bob-sec.ring.test');
      expect(bobFriendAfterFirst?.keyStatus).toBe('pinned');
      expect(bobFriendAfterFirst?.pinnedPublicKeyPem).toContain('BEGIN PUBLIC KEY');
      const originalPinnedKey = bobFriendAfterFirst!.pinnedPublicKeyPem;

      // 3. FIX-02: Tamper ONLY with Bob's api/items.json on disk while leaving api/profile.json & api/albums.json valid
      const itemsJsonPath = path.join(bobOut, 'api/items.json');
      const rawItemsDoc = JSON.parse(fs.readFileSync(itemsJsonPath, 'utf8'));
      rawItemsDoc.items[0].commentary = 'TAMPERED UNSIGNED COMMENTARY!';
      fs.writeFileSync(itemsJsonPath, JSON.stringify(rawItemsDoc, null, 2), 'utf8');

      const tamperedCrawl = await aliceCrawler.crawlFriendSite('https://bob-sec.ring.test', bobOut);
      expect(tamperedCrawl.success).toBe(true);
      // Overall crawl signature verification must fail because items.json was tampered with
      expect(tamperedCrawl.verifiedSignature).toBe(false);

      // Photos from untampered albums.json remain verified, while tampered items/endorsements are marked unverified!
      const feedAfterTamper = aliceDb.getNetworkFeed();
      const photoEntry = feedAfterTamper.find((e) => e.entryType === 'photo');
      const itemEntry = feedAfterTamper.find((e) => e.entryType === 'like');
      expect(photoEntry?.verifiedSignature).toBe(true);
      expect(itemEntry?.verifiedSignature).toBe(false);
      expect(aliceDb.getEndorsements()[0]?.verifiedSignature).toBe(false);

      // 4. FIX-04: Simulate domain hijack / key swap on Bob's site with a rogue Ed25519 keypair
      const rogueDir = path.join(tempRoot, 'bob-rogue');
      const rogueDb = new StudioDatabase(rogueDir, 'rogue.sqlite', { seedStarterData: false });
      rogueDb.updateProfile({
        siteUrl: 'https://bob-sec.ring.test',
        handle: 'bob-sec.ring.test',
        displayName: 'Bob Hijacked',
      });
      rogueDb.createItem({
        type: 'like',
        title: 'Forged Like by Attacker',
        targetUrl: alicePost.canonicalUrl,
        commentary: 'Signed with attacker key after domain takeover',
      });
      const rogueOut = path.join(rogueDir, 'public_html');
      new StaticSiteGenerator(rogueDb).generateToDirectory(rogueOut);

      // Alice crawls Bob's URL (now serving rogueOut signed by a different keypair)
      const hijackCrawl = await aliceCrawler.crawlFriendSite('https://bob-sec.ring.test', rogueOut);
      expect(hijackCrawl.success).toBe(true);
      expect(hijackCrawl.keyChangedWarning).toBe(true);
      expect(hijackCrawl.verifiedSignature).toBe(false);

      const bobFriendAfterHijack = aliceDb
        .getFriends()
        .find((f) => f.siteUrl === 'https://bob-sec.ring.test');
      expect(bobFriendAfterHijack?.keyStatus).toBe('changed');
      // Original pinned key must NOT be overwritten by the attacker's key
      expect(bobFriendAfterHijack?.pinnedPublicKeyPem).toBe(originalPinnedKey);

      rogueDb.close();
    } finally {
      aliceDb.close();
      bobDb.close();
    }
  });

  it('exposes a full Model Context Protocol (MCP) JSON-RPC 2.0 & Loopback HTTP interface for autonomous agent management', async () => {
    const studioDataDir = path.join(tempRoot, 'mcp-studio');
    const peerDataDir = path.join(tempRoot, 'mcp-peer');
    const manager = new PersonaManager(studioDataDir);
    const mcpServer = new WebringMcpServer(manager, studioDataDir);
    const httpServer = new McpHttpServer(mcpServer);
    const peerDb = new StudioDatabase(peerDataDir, 'peer.sqlite', { seedStarterData: false });

    try {
      // 1. Test MCP initialize, tools/list, resources/list, prompts/list
      const initRes = await mcpServer.handleJsonRpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
      });
      expect(initRes?.result).toBeDefined();

      const toolsRes = await mcpServer.handleJsonRpc({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      });
      const tools = (toolsRes?.result as { tools: Array<{ name: string }> }).tools;
      expect(tools.length).toBeGreaterThanOrEqual(21);
      expect(tools.some((t) => t.name === 'webring_create_post')).toBe(true);
      expect(tools.some((t) => t.name === 'webring_crawl_friend')).toBe(true);

      // 2. Agent creates a new persona via MCP tool call
      const createPersonaRes = await mcpServer.executeToolCall('webring_create_persona', {
        label: 'Agent Managed Persona',
        displayName: 'AutoBot Indie',
        siteUrl: 'https://autobot.indiering.test',
        theme: 'cyber-terminal',
      });
      expect(createPersonaRes.isError).toBeUndefined();
      const createdPersonaId = (
        createPersonaRes.data as { created: { id: string } }
      ).created.id;
      expect(manager.getActivePersonaId()).toBe(createdPersonaId);

      // 3. Agent publishes a Wall Post via MCP
      const createPostRes = await mcpServer.executeToolCall('webring_create_post', {
        commentary: 'Hello from my autonomous MCP agent! Managing my webring via JSON-RPC.',
        tags: ['mcp', 'agent', 'webring'],
      });
      expect(createPostRes.isError).toBeUndefined();

      // 4. Set up a peer site on disk and have the Agent crawl the peer and post a comment via MCP
      peerDb.updateProfile({
        siteUrl: 'https://friend-peer.ring.test',
        handle: 'friend-peer.ring.test',
        displayName: 'Peer Friend',
      });
      const peerPost = peerDb.createItem({
        type: 'post',
        commentary: 'Anyone automating their IndieWeb studio with MCP agents?',
      });
      const peerOutDir = path.join(peerDataDir, 'public_html');
      new StaticSiteGenerator(peerDb).generateToDirectory(peerOutDir);

      const crawlRes = await mcpServer.executeToolCall('webring_crawl_friend', {
        siteUrl: 'https://friend-peer.ring.test',
        localDirOverride: peerOutDir,
      });
      expect((crawlRes.data as { verifiedSignature: boolean }).verifiedSignature).toBe(true);

      // Agent reads Neighborhood Feed via MCP and replies to Peer Friend's post
      const feedRes = await mcpServer.executeToolCall('webring_get_neighborhood_feed', {
        entryType: 'post',
        verifiedOnly: true,
      });
      const feedEntries = (feedRes.data as { entries: Array<{ canonicalUrl: string }> }).entries;
      expect(feedEntries.some((e) => e.canonicalUrl === peerPost.canonicalUrl)).toBe(true);

      await mcpServer.executeToolCall('webring_interact_with_url', {
        type: 'comment',
        targetUrl: peerPost.canonicalUrl,
        targetAuthorName: 'Peer Friend',
        targetAuthorUrl: 'https://friend-peer.ring.test',
        commentary: 'Yes! Replying right now via webring_interact_with_url over MCP!',
      });

      // 5. Agent exports the signed static site via MCP and verifies over Loopback HTTP /mcp endpoint
      const exportOutDir = path.join(tempRoot, 'mcp-exported-site');
      const exportRes = await mcpServer.executeToolCall('webring_export_static_site', {
        targetDir: exportOutDir,
      });
      expect((exportRes.data as { success: boolean }).success).toBe(true);
      expect(fs.existsSync(path.join(exportOutDir, 'index.html'))).toBe(true);

      const httpStatus = await httpServer.start(0);
      expect(httpStatus.running).toBe(true);
      expect(httpStatus.port).toBeGreaterThan(0);

      const httpRpcResp = await fetch(httpStatus.endpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 99,
          method: 'resources/read',
          params: { uri: 'webring://active/bundle' },
        }),
      });
      expect(httpRpcResp.status).toBe(200);
      const httpRpcJson = (await httpRpcResp.json()) as {
        result: { contents: Array<{ text: string }> };
      };
      const bundleFromResource = JSON.parse(httpRpcJson.result.contents[0].text);
      expect(bundleFromResource.profile.displayName).toBe('AutoBot Indie');
      expect(bundleFromResource.items.items).toHaveLength(2); // 1 wall post + 1 comment
      expect(httpRpcResp.headers.get('access-control-allow-origin')).toBeNull();

      // Browser-style requests are refused before any tool runs
      const rawPost = (headers: Record<string, string>) =>
        new Promise<number>((resolve, reject) => {
          const body = JSON.stringify({
            jsonrpc: '2.0',
            id: 100,
            method: 'tools/call',
            params: { name: 'webring_create_post', arguments: { commentary: 'Injected by a web page' } },
          });
          const req = http.request(
            { host: '127.0.0.1', port: httpStatus.port, path: '/mcp', method: 'POST', headers },
            (res) => {
              res.resume();
              resolve(res.statusCode || 0);
            }
          );
          req.on('error', reject);
          req.end(body);
        });
      const loopbackHost = `127.0.0.1:${httpStatus.port}`;
      expect(
        await rawPost({ Host: loopbackHost, 'Content-Type': 'application/json', Origin: 'https://evil.example' })
      ).toBe(403);
      expect(await rawPost({ Host: loopbackHost, 'Content-Type': 'text/plain' })).toBe(415);
      expect(await rawPost({ Host: 'evil.example', 'Content-Type': 'application/json' })).toBe(403);
      expect(manager.getActiveContext().db.getItems()).toHaveLength(2);

      // An Electron-style client holding the token is allowed, with CORS for its origin
      const electronOrigin = 'app://mcp-client';
      const tokenUrl = httpStatus.authorizedEndpointUrl!;
      const preflight = await fetch(tokenUrl, {
        method: 'OPTIONS',
        headers: { Origin: electronOrigin },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-origin')).toBe(electronOrigin);
      const tokenResp = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: electronOrigin },
        body: JSON.stringify({ jsonrpc: '2.0', id: 101, method: 'tools/list' }),
      });
      expect(tokenResp.status).toBe(200);
      expect(tokenResp.headers.get('access-control-allow-origin')).toBe(electronOrigin);
      const wrongToken = await fetch(tokenUrl.replace(/token=[0-9a-f]+/, 'token=nope'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: electronOrigin },
        body: JSON.stringify({ jsonrpc: '2.0', id: 102, method: 'tools/list' }),
      });
      expect(wrongToken.status).toBe(403);

      // The SSE handshake hands token-holding clients a message URL that keeps the token
      const sseController = new AbortController();
      const sseResp = await fetch(httpStatus.authorizedSseUrl!, {
        headers: { Origin: electronOrigin },
        signal: sseController.signal,
      });
      const firstChunk = new TextDecoder().decode((await sseResp.body!.getReader().read()).value);
      sseController.abort();
      expect(firstChunk).toContain('/mcp/message?token=');

      // The unauthenticated health check never reveals the token
      const health = await (await fetch(`http://127.0.0.1:${httpStatus.port}/mcp/health`)).text();
      expect(health).not.toContain('token');
    } finally {
      await httpServer.stop();
      peerDb.close();
      manager.closeAll();
    }
  });

  it('supports optional Google Analytics (GA4) and Google AdSense add-ons with dynamic CSP, /ads.txt generation, and MCP control', async () => {
    const studioDataDir = path.join(tempRoot, 'addons-studio');
    const outDir = path.join(tempRoot, 'addons-out');
    const manager = new PersonaManager(studioDataDir);
    const mcpServer = new WebringMcpServer(manager, studioDataDir);

    try {
      // 1. Default export (both add-ons disabled): zero Google scripts in CSP or HTML, and no ads.txt
      const ctx = manager.getActiveContext();
      const defaultGen = ctx.siteGenerator.generateToDirectory(outDir);
      const defaultHtml = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
      expect(defaultGen.filesWritten).not.toContain('ads.txt');
      expect(fs.existsSync(path.join(outDir, 'ads.txt'))).toBe(false);
      expect(defaultHtml).not.toContain('googletagmanager.com');
      expect(defaultHtml).not.toContain('googlesyndication.com');

      // 2. Phase 1: Configure Google Analytics (GA4) Add-On via MCP
      const badGaRes = await mcpServer.executeToolCall('webring_configure_analytics_addon', {
        enabled: true,
        measurementId: '<script>evil</script>',
      });
      expect(badGaRes.isError).toBe(true);

      const gaRes = await mcpServer.executeToolCall('webring_configure_analytics_addon', {
        enabled: true,
        measurementId: 'G-98765ABCDE',
        respectDoNotTrack: true,
        anonymizeIp: true,
        trackRingInteractions: true,
      });
      expect(gaRes.isError).toBeUndefined();

      ctx.siteGenerator.generateToDirectory(outDir);
      const htmlWithGa = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
      expect(htmlWithGa).toContain(
        'https://www.googletagmanager.com/gtag/js?id=G-98765ABCDE'
      );
      expect(htmlWithGa).toContain("gtag('config', 'G-98765ABCDE'");
      expect(htmlWithGa).toContain('webring_interact');

      // 3. Phase 2: Configure Google AdSense Add-On via MCP (with Auto Ads, /ads.txt, and Ad Slots)
      const adsRes = await mcpServer.executeToolCall('webring_configure_ads_addon', {
        enabled: true,
        publisherId: 'pub-1234567890123456', // Automatically normalized to ca-pub-1234567890123456
        enableAutoAds: true,
        generateAdsTxt: true,
        headerSlotId: '1111122222',
        inFeedSlotId: '3333344444',
        footerSlotId: '5555566666',
      });
      expect(adsRes.isError).toBeUndefined();

      const adsGen = ctx.siteGenerator.generateToDirectory(outDir);
      expect(adsGen.filesWritten).toContain('ads.txt');
      const adsTxtContent = fs.readFileSync(path.join(outDir, 'ads.txt'), 'utf8');
      expect(adsTxtContent.trim()).toBe(
        'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0'
      );

      const htmlWithAds = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
      expect(htmlWithAds).toContain(
        'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456'
      );
      expect(htmlWithAds).toContain('1111122222');
      expect(htmlWithAds).toContain('3333344444');
      expect(htmlWithAds).toContain('5555566666');

      // Verify .htaccess is generated for subdirectory DirectoryIndex and JSON CORS
      expect(adsGen.filesWritten).toContain('.htaccess');
      const htaccess = fs.readFileSync(path.join(outDir, '.htaccess'), 'utf8');
      expect(htaccess).toContain('DirectoryIndex index.html');

      // Verify all inline <script> blocks in index.html are 100% syntactically valid JavaScript
      const scriptBlocks = Array.from(
        htmlWithAds.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)
      );
      expect(scriptBlocks.length).toBeGreaterThanOrEqual(2);
      for (const match of scriptBlocks) {
        expect(() => new Function(match[1])).not.toThrow();
      }

      // Inspect add-ons via webring_get_addons MCP tool
      const getAddonsRes = await mcpServer.executeToolCall('webring_get_addons', {});
      const addonsData = getAddonsRes.data as {
        analyticsAddon: { enabled: boolean; measurementId: string };
        adsAddon: { enabled: boolean; publisherId: string };
      };
      expect(addonsData.analyticsAddon.enabled).toBe(true);
      expect(addonsData.analyticsAddon.measurementId).toBe('G-98765ABCDE');
      expect(addonsData.adsAddon.enabled).toBe(true);
      expect(addonsData.adsAddon.publisherId).toBe('ca-pub-1234567890123456');

      // 4. Clear both add-ons via MCP and verify /ads.txt and Google scripts are removed on re-export
      await mcpServer.executeToolCall('webring_configure_analytics_addon', { clear: true });
      await mcpServer.executeToolCall('webring_configure_ads_addon', { clear: true });

      const cleanGen = ctx.siteGenerator.generateToDirectory(outDir);
      expect(cleanGen.filesWritten).not.toContain('ads.txt');
      expect(fs.existsSync(path.join(outDir, 'ads.txt'))).toBe(false);
      const htmlCleaned = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
      expect(htmlCleaned).not.toContain('G-98765ABCDE');
      expect(htmlCleaned).not.toContain('ca-pub-1234567890123456');
    } finally {
      manager.closeAll();
    }
  });
});

describe('Feed Integrity, Moderation & Publish Snapshot', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webring-curation-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const makeSite = (name: string) => {
    const dir = path.join(tempRoot, name);
    const db = new StudioDatabase(dir, `${name}.sqlite`, { seedStarterData: false });
    const siteUrl = `https://${name}.ring.test`;
    db.updateProfile({ siteUrl, handle: `${name}.ring.test`, displayName: name });
    const outDir = path.join(dir, 'public_html');
    const publish = () => new StaticSiteGenerator(db).generateToDirectory(outDir);
    return { db, siteUrl, outDir, publish };
  };

  it('rejects entries whose canonical URL points at another friend’s site', async () => {
    const alice = makeSite('alice');
    const carol = makeSite('carol');
    const mallory = makeSite('mallory');
    try {
      const carolPost = carol.db.createItem({ type: 'post', title: 'Carol original', commentary: 'real' });
      carol.publish();
      await new RingCrawler(alice.db).crawlFriendSite(carol.siteUrl, carol.outDir);

      // Mallory publishes a validly signed items.json claiming Carol's canonical URL
      mallory.db.createItem({ type: 'post', title: 'Spoofed', commentary: 'fake' });
      mallory.publish();
      const itemsPath = path.join(mallory.outDir, 'api/items.json');
      const { proof: _proof, ...itemsDoc } = JSON.parse(fs.readFileSync(itemsPath, 'utf8'));
      itemsDoc.items[0].canonicalUrl = carolPost.canonicalUrl;
      const resigned = signDocument(
        itemsDoc,
        siteUrlToDidWeb(mallory.siteUrl),
        mallory.db.getKeys().privateKeyPem
      );
      fs.writeFileSync(itemsPath, JSON.stringify(resigned));

      const res = await new RingCrawler(alice.db).crawlFriendSite(mallory.siteUrl, mallory.outDir);
      expect(res.success).toBe(true);
      expect(res.entriesRejected).toBe(1);

      const carolEntry = alice.db.getNetworkFeed().find((e) => e.canonicalUrl === carolPost.canonicalUrl);
      expect(carolEntry?.title).toBe('Carol original');
      expect(carolEntry?.friendSiteUrl).toBe(carol.siteUrl);
    } finally {
      alice.db.close();
      carol.db.close();
      mallory.db.close();
    }
  });

  it('prunes items a friend deleted, but never on a failed or unverified fetch', async () => {
    const alice = makeSite('alice');
    const bob = makeSite('bob');
    try {
      const keep = bob.db.createItem({ type: 'post', title: 'Keep me', commentary: '' });
      const drop = bob.db.createItem({ type: 'post', title: 'Delete me', commentary: '' });
      bob.publish();
      const crawler = new RingCrawler(alice.db);
      await crawler.crawlFriendSite(bob.siteUrl, bob.outDir);
      expect(alice.db.getNetworkFeed()).toHaveLength(2);

      bob.db.deleteItem(drop.id);
      bob.publish();

      // Tampered (unverified) items.json must not delete anything
      const itemsPath = path.join(bob.outDir, 'api/items.json');
      const original = fs.readFileSync(itemsPath, 'utf8');
      const tampered = JSON.parse(original);
      tampered.items = [];
      fs.writeFileSync(itemsPath, JSON.stringify(tampered));
      const tamperedRes = await crawler.crawlFriendSite(bob.siteUrl, bob.outDir);
      expect(tamperedRes.entriesPruned).toBe(0);
      expect(alice.db.getNetworkFeed()).toHaveLength(2);

      // Missing items.json must not delete anything either
      fs.rmSync(itemsPath);
      await crawler.crawlFriendSite(bob.siteUrl, bob.outDir);
      expect(alice.db.getNetworkFeed()).toHaveLength(2);

      fs.writeFileSync(itemsPath, original);
      const res = await crawler.crawlFriendSite(bob.siteUrl, bob.outDir);
      expect(res.entriesPruned).toBe(1);
      expect(alice.db.getNetworkFeed().map((e) => e.canonicalUrl)).toEqual([keep.canonicalUrl]);
    } finally {
      alice.db.close();
      bob.db.close();
    }
  });

  it('deleting a friend removes their feed entries and endorsements', async () => {
    const alice = makeSite('alice');
    const bob = makeSite('bob');
    try {
      const alicePost = alice.db.createItem({ type: 'post', title: 'Hello', commentary: '' });
      bob.db.createItem({ type: 'like', title: 'Nice', targetUrl: alicePost.canonicalUrl, commentary: '' });
      bob.publish();
      await new RingCrawler(alice.db).crawlFriendSite(bob.siteUrl, bob.outDir);
      expect(alice.db.getNetworkFeed().length).toBeGreaterThan(0);
      expect(alice.db.getEndorsements()).toHaveLength(1);

      const bobFriend = alice.db.getFriends().find((f) => f.siteUrl === bob.siteUrl)!;
      expect(bobFriend.lastCrawledAt).toBeTruthy();
      alice.db.deleteFriend(bobFriend.id);

      expect(alice.db.getNetworkFeed()).toHaveLength(0);
      expect(alice.db.getEndorsements()).toHaveLength(0);
    } finally {
      alice.db.close();
      bob.db.close();
    }
  });

  it('mute hides from the feed only; block also drops endorsements from the export and skips crawling', async () => {
    const alice = makeSite('alice');
    const bob = makeSite('bob');
    try {
      alice.db.updateProfile({ publishSettings: { publishEndorsements: true } });
      const alicePost = alice.db.createItem({ type: 'post', title: 'Hello', commentary: '' });
      bob.db.createItem({ type: 'like', title: 'Nice', targetUrl: alicePost.canonicalUrl, commentary: '' });
      bob.publish();
      const crawler = new RingCrawler(alice.db);
      await crawler.crawlFriendSite(bob.siteUrl, bob.outDir);

      alice.db.setModeration(bob.siteUrl, 'mute');
      const mutedFeed = alice.db.getCuratedNetworkFeed();
      expect(mutedFeed.entries).toHaveLength(0);
      expect(mutedFeed.excluded.muted).toBeGreaterThan(0);
      expect(alice.db.buildSignedSiteBundle().connections.endorsements).toHaveLength(1);

      alice.db.setModeration(bob.siteUrl, 'block');
      expect(alice.db.getCuratedNetworkFeed().excluded.blocked).toBeGreaterThan(0);
      expect(alice.db.buildSignedSiteBundle().connections.endorsements).toHaveLength(0);
      const blockedCrawl = await crawler.crawlFriendSite(bob.siteUrl, bob.outDir);
      expect(blockedCrawl.blocked).toBe(true);
      expect(blockedCrawl.success).toBe(false);

      alice.db.setModeration(bob.siteUrl, null);
      expect(alice.db.getModeration()).toHaveLength(0);
      expect(alice.db.buildSignedSiteBundle().connections.endorsements).toHaveLength(1);
    } finally {
      alice.db.close();
      bob.db.close();
    }
  });

  it('never publishes unverified endorsements', () => {
    const alice = makeSite('alice');
    try {
      alice.db.updateProfile({ publishSettings: { publishEndorsements: true } });
      const alicePost = alice.db.createItem({ type: 'post', title: 'Hello', commentary: '' });
      alice.db.upsertEndorsement({
        targetCanonicalUrl: alicePost.canonicalUrl,
        authorSiteUrl: 'https://unknown.ring.test',
        authorName: 'Unknown',
        authorAvatarUrl: '',
        type: 'like',
        commentary: '',
        sourceItemUrl: 'https://unknown.ring.test/api/items.json#item-1',
        createdAt: new Date().toISOString(),
        verifiedSignature: false,
      });
      expect(alice.db.getCuratedEndorsements().entries).toHaveLength(1);
      expect(alice.db.getCuratedEndorsements({ forExport: true }).excluded.unverified).toBe(1);
      expect(alice.db.buildSignedSiteBundle().connections.endorsements).toHaveLength(0);
    } finally {
      alice.db.close();
    }
  });

  it('records when the site was last published and counts changes since', async () => {
    const alice = makeSite('alice');
    try {
      expect(alice.db.getProfile().publishSettings.lastPublishedAt).toBeUndefined();
      const res = new SitePublisher(new StaticSiteGenerator(alice.db)).publishToLocalDirectory(alice.outDir);
      expect(res.success).toBe(true);

      const settings = alice.db.getProfile().publishSettings;
      expect(settings.lastPublishedAt).toBeTruthy();
      expect(settings.lastPublishedCounts?.endorsementCount).toBe(0);
      expect(alice.db.countChangesSince(settings.lastPublishedAt)).toBe(0);

      await new Promise((r) => setTimeout(r, 5));
      alice.db.createItem({ type: 'post', title: 'After publish', commentary: '' });
      expect(alice.db.countChangesSince(settings.lastPublishedAt)).toBe(1);
    } finally {
      alice.db.close();
    }
  });
});

describe('Private Key Encryption at Rest', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webring-keyvault-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  // Stand-in for Electron safeStorage: reversible, and obviously not plaintext
  const fakeCipher: KeyCipher = {
    isAvailable: () => true,
    encrypt: (plainText) => Buffer.from(plainText, 'utf8').reverse(),
    decrypt: (cipherText) => Buffer.from(cipherText).reverse().toString('utf8'),
  };

  const readStoredKey = (dbFile: string): string => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite');
    const raw = new DatabaseSync(dbFile);
    const row = raw.prepare('SELECT private_key_pem FROM profile WHERE id = 1').get() as {
      private_key_pem: string;
    };
    raw.close();
    return row.private_key_pem;
  };

  it('migrates a plaintext key to encrypted storage and still signs', () => {
    const plainDb = new StudioDatabase(tempRoot, 'p.sqlite', { seedStarterData: false });
    const originalKey = plainDb.getKeys().privateKeyPem;
    plainDb.close();
    expect(readStoredKey(path.join(tempRoot, 'p.sqlite'))).toContain('BEGIN PRIVATE KEY');

    const sealedDb = new StudioDatabase(tempRoot, 'p.sqlite', { keyCipher: fakeCipher });
    expect(readStoredKey(path.join(tempRoot, 'p.sqlite'))).toMatch(/^enc:v1:/);
    expect(sealedDb.getKeys().privateKeyPem).toBe(originalKey);
    const bundle = sealedDb.buildSignedSiteBundle();
    expect(verifyDocumentSignature(bundle.profile, sealedDb.getKeys().publicKeyPem)).toBe(true);
    sealedDb.close();
  });

  it('seals publishing credentials, never returns them from getProfile, and keeps them through the form', () => {
    // An older install stored them in plaintext
    const legacy = new StudioDatabase(tempRoot, 'creds.sqlite', { seedStarterData: false });
    legacy.updateProfile({ publishSettings: { password: 'sftp-secret', githubToken: 'ghp_legacy' } });
    legacy.close();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite');
    const readStored = () => {
      const raw = new DatabaseSync(path.join(tempRoot, 'creds.sqlite'));
      const row = raw.prepare('SELECT publish_settings_json FROM profile WHERE id = 1').get() as {
        publish_settings_json: string;
      };
      raw.close();
      return JSON.parse(row.publish_settings_json);
    };
    expect(readStored().password).toBe('sftp-secret');

    const db = new StudioDatabase(tempRoot, 'creds.sqlite', { keyCipher: fakeCipher });
    try {
      // Sealed on open, masked on read, readable only via getPublishCredentials
      expect(readStored().password).toMatch(/^enc:v1:/);
      expect(readStored().githubToken).toMatch(/^enc:v1:/);
      const shown = db.getProfile().publishSettings;
      expect(shown.password).toBe(STORED_SECRET_PLACEHOLDER);
      expect(shown.githubToken).toBe(STORED_SECRET_PLACEHOLDER);
      expect(db.getPublishCredentials()).toEqual({ password: 'sftp-secret', githubToken: 'ghp_legacy' });

      // Saving the form as shown (placeholders) keeps the stored values
      db.updateProfile({ publishSettings: { ...shown, host: 'example.org' } });
      expect(db.getPublishCredentials()).toEqual({ password: 'sftp-secret', githubToken: 'ghp_legacy' });
      expect(db.withStoredCredentials(db.getProfile().publishSettings).password).toBe('sftp-secret');

      // A new value replaces (sealed); '' clears
      db.updateProfile({ publishSettings: { githubToken: 'ghp_new' } });
      expect(readStored().githubToken).toMatch(/^enc:v1:/);
      expect(db.getPublishCredentials().githubToken).toBe('ghp_new');
      db.updateProfile({ publishSettings: { password: '' } });
      expect(db.getPublishCredentials().password).toBe('');
      expect(db.getProfile().publishSettings.password).toBe('');

      // Nothing secret reaches the published site
      const out = path.join(tempRoot, 'creds-out');
      new StaticSiteGenerator(db).generateToDirectory(out);
      const published = fs
        .readdirSync(path.join(out, 'api'))
        .map((f) => fs.readFileSync(path.join(out, 'api', f), 'utf8'))
        .join('\n');
      expect(published).not.toContain('ghp_new');
    } finally {
      db.close();
    }

    // Outside the app the profile still reads fine, but the credentials can't be opened
    const cli = new StudioDatabase(tempRoot, 'creds.sqlite');
    try {
      expect(cli.getProfile().publishSettings.githubToken).toBe(STORED_SECRET_PLACEHOLDER);
      expect(() => cli.getPublishCredentials()).toThrow(KeyVaultUnavailableError);
    } finally {
      cli.close();
    }
  });

  it('fails cleanly when signing without the keychain (stdio MCP CLI)', () => {
    new StudioDatabase(tempRoot, 'c.sqlite', { keyCipher: fakeCipher }).close();

    const cliDb = new StudioDatabase(tempRoot, 'c.sqlite');
    expect(cliDb.getProfile().displayName).toBeTruthy();
    expect(() => cliDb.buildSignedSiteBundle()).toThrow(KeyVaultUnavailableError);
    const res = new SitePublisher(new StaticSiteGenerator(cliDb)).publishToLocalDirectory(
      path.join(tempRoot, 'out')
    );
    expect(res.success).toBe(false);
    expect(res.message).toContain('Open Webring Studio to publish');
    cliDb.close();
  });
});

describe('Loopback MCP HTTP Settings', () => {
  it('keeps the same port and access token across restarts', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webring-mcp-http-'));
    const manager = new PersonaManager(tempRoot);
    const settingsPath = path.join(tempRoot, 'mcp-http.json');
    try {
      const first = new McpHttpServer(new WebringMcpServer(manager, tempRoot), { settingsPath });
      const firstStatus = await first.start(0);
      await first.stop();

      const second = new McpHttpServer(new WebringMcpServer(manager, tempRoot), { settingsPath });
      const secondStatus = await second.start(0);
      await second.stop();

      expect(secondStatus.port).toBe(firstStatus.port);
      expect(secondStatus.authorizedSseUrl).toBe(firstStatus.authorizedSseUrl);
      expect((fs.statSync(settingsPath).mode & 0o777).toString(8)).toBe('600');
    } finally {
      manager.closeAll();
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

describe('SSRF Guard for Peer Crawling', () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ secret: 'internal-only' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    delete process.env.WEBRING_ALLOW_PRIVATE_PEERS;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('classifies private, local and metadata addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
    ]) {
      expect(isPrivateNetworkAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '172.32.0.1']) {
      expect(isPrivateNetworkAddress(ip), ip).toBe(false);
    }
  });

  it('refuses to fetch loopback addresses by IP or hostname', async () => {
    await expect(defaultJsonFetcher(`http://127.0.0.1:${port}/api/manifest.json`)).rejects.toThrow(
      /private or local network address/
    );
    await expect(defaultJsonFetcher(`http://localhost:${port}/api/manifest.json`)).rejects.toThrow(
      /private or local network address/
    );
    await expect(defaultJsonFetcher(`http://[::1]:${port}/x`)).rejects.toThrow(
      /private or local network address/
    );
  });

  it('reports a blocked peer as a failed crawl, and allows it when explicitly enabled', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webring-ssrf-'));
    const db = new StudioDatabase(dir, 'ssrf.sqlite', { seedStarterData: false });
    try {
      const res = await new RingCrawler(db).crawlFriendSite(`http://127.0.0.1:${port}`);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/private or local network address/);

      process.env.WEBRING_ALLOW_PRIVATE_PEERS = '1';
      await expect(defaultJsonFetcher(`http://127.0.0.1:${port}/x`)).resolves.toEqual({
        secret: 'internal-only',
      });
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Curated Webrings (hosted rings, signed requests, sync)', () => {
  let tempRoot: string;
  const sites = new Map<string, { db: StudioDatabase; outDir: string }>();

  // Serves https://<name>.ring.test/... from each site's published folder
  const fetcher = async (url: string): Promise<unknown> => {
    const parsed = new URL(url);
    const site = sites.get(parsed.origin);
    if (!site) throw new Error(`HTTP 404 fetching ${url}`);
    const file = path.join(site.outDir, decodeURIComponent(parsed.pathname));
    if (!fs.existsSync(file)) throw new Error(`HTTP 404 fetching ${url}`);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  };

  const makeSite = (name: string) => {
    const siteUrl = `https://${name}.ring.test`;
    const dir = path.join(tempRoot, name);
    const db = new StudioDatabase(dir, `${name}.sqlite`, { seedStarterData: false });
    db.updateProfile({ siteUrl, handle: `${name}.ring.test`, displayName: name });
    const outDir = path.join(dir, 'public_html');
    sites.set(siteUrl, { db, outDir });
    return {
      db,
      siteUrl,
      outDir,
      rings: new RingService(db, fetcher),
      publish: () => new StaticSiteGenerator(db).generateToDirectory(outDir),
    };
  };

  const tick = () => new Promise((r) => setTimeout(r, 5));

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webring-rings-'));
    sites.clear();
  });

  afterEach(() => {
    for (const { db } of sites.values()) db.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('joins a ring end to end: signed request, approval, membership on both sides', async () => {
    const maya = makeSite('maya');
    const bob = makeSite('bob');
    const carol = makeSite('carol');
    const ring = maya.db.createHostedRing({ name: 'Photo Ring', description: 'Film photographers' });
    maya.publish();
    bob.publish();
    carol.publish();

    const { ring: bobRing, requestLink } = await bob.rings.requestToJoin(ring.hubUrl);
    expect(bobRing.status).toBe('requested');
    expect(requestLink).toMatch(/^webring:\/\/ring-request\?token=/);
    // Requests are private: nothing about the request is published
    bob.publish();
    expect(bob.db.buildSignedSiteBundle().connections.webrings).toHaveLength(0);

    const review = await maya.rings.reviewRequest(requestLink);
    expect(review.state).toBe('new');
    expect(review.applicant.siteUrl).toBe(bob.siteUrl);
    await maya.rings.decideRequest(requestLink, 'approve');
    const { requestLink: carolLink } = await carol.rings.requestToJoin(ring.hubUrl);
    await maya.rings.decideRequest(carolLink, 'approve');
    await tick();
    maya.publish();

    const [bobSync] = await bob.rings.syncJoinedRings();
    expect(bobSync.outcome).toBe('member');
    const joined = bob.db.getJoinedRings()[0];
    expect(joined.status).toBe('member');
    expect(joined.memberCount).toBe(3);
    // Order is maya, bob, carol
    expect(joined.prevSiteUrl).toBe(maya.siteUrl);
    expect(joined.nextSiteUrl).toBe(carol.siteUrl);
    bob.publish();
    expect(bob.db.buildSignedSiteBundle().connections.webrings[0].hubUrl).toBe(ring.hubUrl);

    const [hostedSync] = await maya.rings.syncHostedRings();
    expect(hostedSync.confirmed).toEqual([bob.siteUrl]);
    expect(hostedSync.autoRemoved).toEqual([]);
    // Carol hasn't published the ring yet but is inside the grace period
    expect(maya.db.getHostedRing(ring.id).members.map((m) => m.siteUrl)).toContain(carol.siteUrl);
  });

  it('removes a confirmed member who leaves, and propagates removal and bans to the member', async () => {
    const maya = makeSite('maya');
    const bob = makeSite('bob');
    const ring = maya.db.createHostedRing({ name: 'Ring' });
    maya.publish();
    bob.publish();
    const { requestLink } = await bob.rings.requestToJoin(ring.hubUrl);
    await maya.rings.decideRequest(requestLink, 'approve');
    await tick();
    maya.publish();
    await bob.rings.syncJoinedRings();
    bob.publish();
    await maya.rings.syncHostedRings();

    // Bob leaves; Maya's sync removes him because he had confirmed before
    bob.db.deleteWebring(bob.db.getJoinedRings()[0].id);
    bob.publish();
    const [afterLeave] = await maya.rings.syncHostedRings();
    expect(afterLeave.autoRemoved).toEqual([bob.siteUrl]);

    // Bob re-joins, then Maya bans him
    const again = await bob.rings.requestToJoin(ring.hubUrl);
    await maya.rings.decideRequest(again.requestLink, 'approve');
    await tick();
    maya.publish();
    await bob.rings.syncJoinedRings();
    expect(bob.db.getJoinedRings()[0].status).toBe('member');
    await maya.rings.decideRequest(again.requestLink, 'ban', 'spam');
    await tick();
    maya.publish();
    const [removed] = await bob.rings.syncJoinedRings();
    expect(removed.outcome).toBe('removed');
    expect(bob.db.buildSignedSiteBundle().connections.webrings).toHaveLength(0);

    // A fresh request from a banned site is recognised and can't be approved
    const third = await bob.rings.requestToJoin(ring.hubUrl);
    expect((await maya.rings.reviewRequest(third.requestLink)).state).toBe('banned');
    await expect(maya.rings.decideRequest(third.requestLink, 'approve')).rejects.toThrow(/banned/);
  });

  it('ignores stale hub copies, and never removes anyone on a changed key or unsigned hub', async () => {
    const maya = makeSite('maya');
    const bob = makeSite('bob');
    const ring = maya.db.createHostedRing({ name: 'Ring' });
    maya.publish();
    bob.publish();
    const hubFile = path.join(maya.outDir, ring.hubPath);
    const beforeBob = fs.readFileSync(hubFile, 'utf8');
    const { requestLink } = await bob.rings.requestToJoin(ring.hubUrl);
    await maya.rings.decideRequest(requestLink, 'approve');
    await tick();
    maya.publish();
    await bob.rings.syncJoinedRings();
    expect(bob.db.getJoinedRings()[0].status).toBe('member');

    // An older (signed, valid) copy that doesn't list Bob is ignored
    const current = fs.readFileSync(hubFile, 'utf8');
    fs.writeFileSync(hubFile, beforeBob);
    expect((await bob.rings.syncJoinedRings())[0].outcome).toBe('unchanged');
    expect(bob.db.getJoinedRings()[0].status).toBe('member');

    // An unsigned hub that drops Bob can't remove him
    const unsigned = JSON.parse(current);
    delete unsigned.proof;
    unsigned.members = unsigned.members.filter((m: { siteUrl: string }) => m.siteUrl !== bob.siteUrl);
    unsigned.updatedAt = new Date(Date.now() + 60000).toISOString();
    fs.writeFileSync(hubFile, JSON.stringify(unsigned));
    expect((await bob.rings.syncJoinedRings())[0].outcome).toBe('unchanged');
    expect(bob.db.getJoinedRings()[0].status).toBe('member');

    // A changed maintainer key freezes the ring instead of removing anyone
    fs.writeFileSync(hubFile, current);
    const didFile = path.join(maya.outDir, '.well-known/did.json');
    const didDoc = JSON.parse(fs.readFileSync(didFile, 'utf8'));
    didDoc.verificationMethod[0].publicKeyPem = generateIdentityKeyPair().publicKeyPem;
    fs.writeFileSync(didFile, JSON.stringify(didDoc));
    const [frozen] = await bob.rings.syncJoinedRings();
    expect(frozen.outcome).toBe('unchanged');
    expect(frozen.warning).toMatch(/key changed/);
    expect(bob.db.getJoinedRings()[0].status).toBe('member');
  });

  it('refuses re-hosted hubs and non-https hub URLs, and propagates a closed ring', async () => {
    const maya = makeSite('maya');
    const mallory = makeSite('mallory');
    const bob = makeSite('bob');
    const ring = maya.db.createHostedRing({ name: 'Ring' });
    maya.publish();
    mallory.publish();
    bob.publish();

    // Mallory re-hosts Maya's signed hub on her own site
    const copyPath = path.join(mallory.outDir, 'api/rings/copied.json');
    fs.mkdirSync(path.dirname(copyPath), { recursive: true });
    fs.copyFileSync(path.join(maya.outDir, ring.hubPath), copyPath);
    await expect(bob.rings.requestToJoin(`${mallory.siteUrl}/api/rings/copied.json`)).rejects.toThrow(
      /lives at/
    );
    await expect(bob.rings.requestToJoin(`file://${path.join(maya.outDir, ring.hubPath)}`)).rejects.toThrow(
      /https/
    );
    await expect(bob.rings.requestToJoin(ring.hubUrl.replace('https:', 'http:'))).rejects.toThrow(/https/);

    const { requestLink } = await bob.rings.requestToJoin(ring.hubUrl);
    await maya.rings.decideRequest(requestLink, 'approve');
    await tick();
    maya.publish();
    await bob.rings.syncJoinedRings();
    maya.db.updateHostedRing(ring.id, { status: 'closed' });
    await tick();
    maya.publish();
    expect((await bob.rings.syncJoinedRings())[0].outcome).toBe('closed');
    expect(bob.db.buildSignedSiteBundle().connections.webrings).toHaveLength(0);
    // The closed hub is still published, with no members
    const closedDoc = JSON.parse(fs.readFileSync(path.join(maya.outDir, ring.hubPath), 'utf8'));
    expect(closedDoc.status).toBe('closed');
    expect(closedDoc.members).toEqual([]);
  });

  it('rejects tampered, expired or misdirected requests', async () => {
    const maya = makeSite('maya');
    const bob = makeSite('bob');
    const other = makeSite('other');
    const ring = maya.db.createHostedRing({ name: 'Ring' });
    other.db.createHostedRing({ name: 'Other Ring' });
    maya.publish();
    bob.publish();
    other.publish();
    const { requestLink } = await bob.rings.requestToJoin(ring.hubUrl);

    const token = requestLink.split('token=')[1];
    const decoded = JSON.parse(Buffer.from(decodeURIComponent(token), 'base64url').toString('utf8'));
    decoded.displayName = 'Impostor';
    const tampered = Buffer.from(JSON.stringify(decoded)).toString('base64url');
    await expect(maya.rings.reviewRequest(tampered)).rejects.toThrow(/signature/);

    await expect(other.rings.reviewRequest(requestLink)).rejects.toThrow(/doesn’t host/);
    await expect(maya.rings.reviewRequest('webring://ring-request?token=garbage')).rejects.toThrow(/damaged/);
  });

  it('publishes small rings sensibly and converts the old hub in place', async () => {
    const maya = makeSite('maya');
    maya.db.createHostedRing({ name: 'Solo' });
    const solo = maya.db.getWebrings()[0];
    expect(solo.memberCount).toBe(1);
    expect(solo.prevSiteUrl).toBeUndefined();
    expect(solo.nextSiteUrl).toBeUndefined();

    // Old install: hub setting on, one public friend, plus the seeded demo ring
    const legacyDir = path.join(tempRoot, 'legacy');
    const legacy = new StudioDatabase(legacyDir, 'legacy.sqlite');
    legacy.updateProfile({ siteUrl: 'https://legacy.ring.test', publishSettings: { publishWebringHub: true } });
    legacy.addOrUpdateFriend({ siteUrl: 'https://pal.ring.test', displayName: 'Pal', visibility: 'public' });
    legacy.close();

    const reopened = new StudioDatabase(legacyDir, 'legacy.sqlite');
    try {
      const [hosted] = reopened.getHostedRings();
      expect(hosted.hubPath).toBe('api/webring-hub.json');
      expect(hosted.members.map((m) => m.siteUrl)).toContain('https://pal.ring.test');
      expect(reopened.getProfile().publishSettings.publishWebringHub).toBe(false);
      expect(reopened.getJoinedRings().every((r) => r.status === 'legacy')).toBe(true);
      const out = path.join(legacyDir, 'out');
      new StaticSiteGenerator(reopened).generateToDirectory(out);
      const hub = JSON.parse(fs.readFileSync(path.join(out, 'api/webring-hub.json'), 'utf8'));
      expect(hub.hubUrl).toBe('https://legacy.ring.test/api/webring-hub.json');
      expect(hub.proof).toBeDefined();
    } finally {
      reopened.close();
    }
  });
});

describe('Scheduled Sync & Publish', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webring-schedule-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const local = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi, 0, 0);

  it('computes the next run for each preset, catching up once after a gap', () => {
    // Interval: one interval after the anchor
    expect(nextRunAt({ kind: 'interval', minutes: 60 }, local(2026, 3, 2, 10, 15))).toEqual(local(2026, 3, 2, 11, 15));
    // Daily: later today, or tomorrow once the time has passed
    expect(nextRunAt({ kind: 'daily', time: '09:30' }, local(2026, 3, 2, 8, 0))).toEqual(local(2026, 3, 2, 9, 30));
    expect(nextRunAt({ kind: 'daily', time: '09:30' }, local(2026, 3, 2, 9, 30))).toEqual(local(2026, 3, 3, 9, 30));
    // Weekly (2026-03-02 is a Monday): Friday this week; Monday at the same time moves a week on
    expect(nextRunAt({ kind: 'weekly', weekday: 5, time: '18:00' }, local(2026, 3, 2, 12, 0))).toEqual(
      local(2026, 3, 6, 18, 0)
    );
    expect(nextRunAt({ kind: 'weekly', weekday: 1, time: '12:00' }, local(2026, 3, 2, 12, 0))).toEqual(
      local(2026, 3, 9, 12, 0)
    );
    // Daily slots keep local wall-clock time across a month of days (incl. any DST change)
    const later = nextRunAt({ kind: 'daily', time: '07:00' }, local(2026, 3, 28, 23, 0));
    expect([later.getHours(), later.getMinutes()]).toEqual([7, 0]);
    // After a long gap the job is due once; running moves the anchor to "now"
    const job = { enabled: true, preset: { kind: 'daily' as const, time: '09:00' }, since: local(2026, 3, 1, 8, 0).toISOString() };
    expect(jobNextRunAt(job) <= local(2026, 3, 20, 12, 0)).toBe(true);
    const afterRun = { ...job, lastRunAt: local(2026, 3, 20, 12, 0).toISOString() };
    expect(jobNextRunAt(afterRun)).toEqual(local(2026, 3, 21, 9, 0));
  });

  it('queues due jobs in order, one at a time, and respects pause and disabled schedules', async () => {
    let now = local(2026, 3, 2, 8, 0);
    const calls: string[] = [];
    let concurrent = 0;
    let maxConcurrent = 0;
    const slow = async (label: string) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      calls.push(label);
      await new Promise((r) => setTimeout(r, 5));
      concurrent--;
      return { at: now.toISOString(), status: 'ok' as const, message: label };
    };
    const scheduler = new Scheduler({
      configPath: path.join(tempRoot, 'scheduler.json'),
      listPersonaIds: () => ['a', 'b'],
      now: () => now,
      runner: {
        sync: (id) => slow(`sync:${id}`),
        publish: (id, destination) => slow(`publish:${id}:${destination}`),
      },
    });
    scheduler.setPersonaSchedule('a', {
      sync: { enabled: true, preset: { kind: 'interval', minutes: 15 } },
      publish: { enabled: true, preset: { kind: 'interval', minutes: 60 }, destination: 'github' },
    });
    scheduler.setPersonaSchedule('b', { sync: { enabled: true, preset: { kind: 'interval', minutes: 60 } } });

    await scheduler.tick();
    expect(calls).toEqual([]);

    now = local(2026, 3, 2, 9, 5);
    await scheduler.tick();
    expect(calls).toEqual(['sync:a', 'publish:a:github', 'sync:b']);
    expect(maxConcurrent).toBe(1);
    const config = scheduler.loadConfig();
    expect(config.personas.a.sync.lastResult?.message).toBe('sync:a');
    expect(config.history).toHaveLength(3);

    // Ran at 09:05, so nothing is due a minute later; paused stops everything
    now = local(2026, 3, 2, 9, 6);
    await scheduler.tick();
    expect(calls).toHaveLength(3);
    scheduler.setAppSettings({ paused: true });
    now = local(2026, 3, 2, 12, 0);
    await scheduler.tick();
    expect(calls).toHaveLength(3);

    // Edits written by another process (e.g. the MCP CLI) are picked up on the next tick
    const raw = JSON.parse(fs.readFileSync(path.join(tempRoot, 'scheduler.json'), 'utf8'));
    raw.paused = false;
    raw.personas.b.sync.enabled = false;
    fs.writeFileSync(path.join(tempRoot, 'scheduler.json'), JSON.stringify(raw));
    await scheduler.tick();
    expect(calls.slice(3)).toEqual(['sync:a', 'publish:a:github']);

    // Schedules for deleted personas are dropped
    const pruned = new Scheduler({
      configPath: path.join(tempRoot, 'scheduler.json'),
      listPersonaIds: () => ['a'],
      runner: { sync: () => slow('x'), publish: () => slow('y') },
    });
    expect(Object.keys(pruned.loadConfig().personas)).toEqual(['a']);
  });

  it('records a failed job as a run so it waits for its next slot, and serialises with manual work', async () => {
    let now = local(2026, 3, 2, 10, 0);
    const scheduler = new Scheduler({
      configPath: path.join(tempRoot, 'scheduler.json'),
      listPersonaIds: () => ['a'],
      now: () => now,
      runner: {
        sync: () => Promise.reject(new Error('host unreachable')),
        publish: () => Promise.reject(new Error('unused')),
      },
    });
    scheduler.setPersonaSchedule('a', { sync: { enabled: true, preset: { kind: 'interval', minutes: 15 } } });
    now = local(2026, 3, 2, 10, 20);
    await scheduler.tick();
    const first = scheduler.loadConfig().personas.a.sync;
    expect(first.lastResult?.status).toBe('failed');
    expect(first.lastResult?.message).toBe('host unreachable');
    now = local(2026, 3, 2, 10, 21);
    await scheduler.tick();
    expect(scheduler.loadConfig().history).toHaveLength(1);

    const order: string[] = [];
    const manual = scheduler.runExclusive('a', async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push('manual');
    });
    const second = scheduler.runExclusive('a', async () => {
      order.push('second');
    });
    await Promise.all([manual, second]);
    expect(order).toEqual(['manual', 'second']);
  });

  it('fingerprints site content, ignoring timestamps and signatures', async () => {
    const dir = path.join(tempRoot, 'fp');
    const mediaDir = path.join(dir, 'media');
    const db = new StudioDatabase(dir, 'fp.sqlite', { seedStarterData: false });
    try {
      db.updateProfile({ siteUrl: 'https://fp.ring.test' });
      const generator = new StaticSiteGenerator(db, mediaDir);
      const base = generator.contentFingerprint();
      await new Promise((r) => setTimeout(r, 5));
      expect(generator.contentFingerprint()).toBe(base);

      db.createItem({ type: 'post', title: 'New', commentary: '' });
      const afterPost = generator.contentFingerprint();
      expect(afterPost).not.toBe(base);

      db.updateProfile({ publishSettings: { publishEndorsements: true } });
      db.upsertEndorsement({
        targetCanonicalUrl: 'https://fp.ring.test/api/items.json#item-x',
        authorSiteUrl: 'https://pal.ring.test',
        authorName: 'Pal',
        authorAvatarUrl: '',
        type: 'like',
        commentary: '',
        sourceItemUrl: 'https://pal.ring.test/api/items.json#item-1',
        createdAt: new Date().toISOString(),
        verifiedSignature: true,
      });
      const afterEndorsement = generator.contentFingerprint();
      expect(afterEndorsement).not.toBe(afterPost);

      const ring = db.createHostedRing({ name: 'FP Ring' });
      const afterRing = generator.contentFingerprint();
      expect(afterRing).not.toBe(afterEndorsement);
      db.addRingMember(ring.id, { siteUrl: 'https://pal.ring.test', displayName: 'Pal', did: '', keyFingerprint: '' });
      const afterMember = generator.contentFingerprint();
      expect(afterMember).not.toBe(afterRing);

      fs.mkdirSync(mediaDir, { recursive: true });
      fs.writeFileSync(path.join(mediaDir, 'photo.jpg'), 'pixels');
      expect(generator.contentFingerprint()).not.toBe(afterMember);
    } finally {
      db.close();
    }
  });

  it('runs a scheduled publish for a non-active persona with its own key, skipping when unchanged', async () => {
    const manager = new PersonaManager(path.join(tempRoot, 'studio'));
    try {
      const created = manager.createPersona({
        label: 'Second',
        displayName: 'Second Self',
        siteUrl: 'https://second.ring.test',
      });
      const secondId = created.created.id;
      manager.switchPersona('default');
      const activeBefore = manager.getActiveContext().db.getProfile().siteUrl;
      const exportDir = path.join(tempRoot, 'second-export');
      const paths = { userDataDir: path.join(tempRoot, 'studio'), tempDir: tempRoot };

      const first = await manager.withPersonaContext(secondId, async (ctx) => {
        ctx.db.updateProfile({ publishSettings: { exportPath: exportDir } });
        return runScheduledPublish(ctx, 'local', false, paths);
      });
      expect(first.status).toBe('ok');
      const didDoc = JSON.parse(fs.readFileSync(path.join(exportDir, '.well-known/did.json'), 'utf8'));
      expect(didDoc.id).toBe('did:web:second.ring.test');
      const profileDoc = JSON.parse(fs.readFileSync(path.join(exportDir, 'api/profile.json'), 'utf8'));
      expect(verifyDocumentSignature(profileDoc, didDoc.verificationMethod[0].publicKeyPem)).toBe(true);

      const second = await manager.withPersonaContext(secondId, (ctx) =>
        runScheduledPublish(ctx, 'local', false, paths)
      );
      expect(second.status).toBe('skipped');

      // The active persona is untouched and still usable
      expect(manager.getActivePersonaId()).toBe('default');
      expect(manager.getActiveContext().db.getProfile().siteUrl).toBe(activeBefore);

      // A destination that isn't set up fails without publishing anything
      const remote = await manager.withPersonaContext(secondId, async (ctx) => {
        ctx.db.createItem({ type: 'post', title: 'Changed', commentary: '' });
        return runScheduledPublish(ctx, 'remote', false, paths);
      });
      expect(remote.status).toBe('failed');
      expect(remote.message).toMatch(/host and username/);
    } finally {
      manager.closeAll();
    }
  });
});
