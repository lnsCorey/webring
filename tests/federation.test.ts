import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
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
import { StudioDatabase } from '../electron/db/database';
import { StaticSiteGenerator } from '../electron/services/siteGenerator';
import { RingCrawler } from '../electron/services/ringCrawler';
import { PersonaManager } from '../electron/services/personaManager';
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
      expect(switchedBackCtx.db.getProfile().publishSettings.password).toBe(
        'super-secret-sftp-password'
      );

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


