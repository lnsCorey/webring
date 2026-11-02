# Album Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Albums take up the space of one post on the published page and in friends' Neighborhood Feeds, with the full album on a page of its own (published) or an album view (Studio).

**Architecture:**
- **Album settings.** Each album gains `slug`, `postToFeed` and `display`. They are stored in SQLite and published in the signed `albums.json`.
- **Published page.** The page script renders card albums as cards and posted albums as timeline posts, in every arrangement.
- **Album pages.** The generator writes `albums/<slug>/index.html`. It is the same page as `index.html` with `<base href="../../">`, an album id that switches the page script into album view, and Open Graph tags.
- **Crawler.** It writes one `album` feed row per posted album, plus photo rows linked to it by `album_url`. Photo rows are hidden from the main feed list and shown in a new Studio album view.

**Tech Stack:** TypeScript, Electron, React (`src/studio`), `node:sqlite`, zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-02-album-cards-design.md`

## Global Constraints

- **Static artifact.** Album pages are generated static HTML with no server-side logic (CLAUDE.md).
- **Schema changes are additive.** New zod fields are optional, and readers accept albums without them. New DB columns use the guarded `PRAGMA table_info` + `ALTER TABLE` pattern in `initializeSchema` (`electron/db/database.ts`, see `addPhotoColumn` near line 918).
- **Defaults when a field is missing:**
  - `postToFeed` missing means posted, and `display` missing means `card`.
  - New albums are created with `postToFeed: false` and `display: 'card'`.
  - Existing albums are migrated to posted, card.
- **Slugs.** A slug is made from the title once, when the album is created or backfilled, and never changes on rename. It is lowercase with runs of non-`[a-z0-9]` replaced by `-`, trimmed, `.slice(0, 40) || 'album'`, and made unique with `-2`, `-3`… (the same rule as `createHostedRing`, `database.ts` ~2503).
- **Album page path.** `albums/<slug>/index.html`, linked as `albums/<slug>/`, published as `pageUrl: 'albums/<slug>/'`.
- **Peek.** Cover large on the left, two more photos stacked on the right, and `+N` on the last tile, where N = photoCount − 3. There's no `+` tile when N ≤ 0. Below it: the title and "Open album →".
- **Federation rules.**
  - Only a verified albums document may delete feed rows.
  - Unverified data is never re-published.
  - Endorsements and saved posts are never pruned.
- **Self-contained page code.** `renderTemplatePage` and `installPageEnhancements` can't import, and their source must not contain `</script`. New page helpers live in the page script in `buildStandaloneProfileHtml` and reach templates through `ctx`.
- Every change to federation behaviour gets a test in `tests/federation.test.ts`.

## Review Focus

1. **A title with no usable characters** (emoji only, or `"!!!"`) becomes slug `album`. A second such album gets `album-2`. Covered in Task 1.
2. **An album with 0, 1 or 2 photos:**
   - The card and peek render without empty cells and with no `+0`/`+-1`.
   - An empty album's page says "No photos yet".
   - An empty posted album's feed row uses the album's `createdAt`.
   - Covered in Task 2 and Task 4.
3. **A friend switches an album from posted to not posted.** The album row and its photo rows leave your feed on the next verified sync. Saved copies stay, and an unverified fetch removes nothing. Covered in Task 4.
4. **The first sync after upgrading,** with per-photo rows already in the feed. Afterwards there are no loose photo rows in the main feed and no "N new" badges. Covered in Task 4.
5. **On an album page,** opening and closing a photo keeps the address on `albums/<slug>/` (it must not jump to the site root), and "Back" goes to the profile. Covered in Task 3.

---

### Task 1: Album settings and slugs in the data model

**Files:**
- Modify: `src/shared/schema.ts`
  - `AlbumItemSchema` (~345)
  - new helpers next to `buildCanonicalUrl` (~811)
- Modify: `electron/db/database.ts`
  - albums migration in `initializeSchema`
  - `getAlbums` (~1259), `createAlbum` (~1316), `updateAlbum` (~1486)
- Modify: `electron/main.ts` (~520, ~596) and `electron/preload.ts` (14, 26). Pass through, no shape change.
- Modify: `electron/mcp/mcpServer.ts`
  - `webring_create_album` schema (~429) and its handler (~1255)
- Modify: `src/studio/App.tsx`
  - `updateAlbum` typing (~393)
  - `AlbumItem` usage compiles
- Test: `tests/federation.test.ts`, new `describe('Album cards')`

**Interfaces:**
- Produces, in `src/shared/schema.ts`:
  - `AlbumItemSchema` gains:
    - `slug: z.string().optional()`
    - `pageUrl: z.string().optional()`
    - `postToFeed: z.boolean().optional()`
    - `display: z.enum(['card','expanded']).optional().catch(undefined)`
  - `export type AlbumDisplay = 'card' | 'expanded'`
  - `export function albumIsPosted(album: { postToFeed?: boolean }): boolean`, which returns `postToFeed !== false`
  - `export function albumDisplay(album: { display?: string }): AlbumDisplay`
  - `export function slugifyAlbumTitle(title: string): string` (the slug rule from Global Constraints, without the uniqueness suffix)
  - `export function albumPagePath(slug: string): string`, which returns `albums/${slug}/index.html`
- Produces, in `electron/db/database.ts`:
  - `createAlbum(input: { title: string; description?: string; coverUrl?: string; tags?: string[]; postToFeed?: boolean; display?: AlbumDisplay }): AlbumItem`
  - `updateAlbum(albumId, updates: { title?; description?; tags?; coverUrl?; postToFeed?: boolean; display?: AlbumDisplay }): AlbumItem`
  - `getAlbums()` returns each album with `slug`, `pageUrl: 'albums/<slug>/'`, `postToFeed` and `display` set.

- [ ] **Step 1: Write the failing tests**

```ts
describe('Album cards', () => {
  it('stores album settings and a stable, unique slug', () => {
    const db = new StudioDatabase(dir, 'a.sqlite');
    db.updateProfile({ siteUrl: 'https://alice.ring.test', displayName: 'Alice' });
    const a = db.createAlbum({ title: 'Midjourney Images #1' });
    expect(a).toMatchObject({ slug: 'midjourney-images-1', pageUrl: 'albums/midjourney-images-1/', postToFeed: false, display: 'card' });
    const b = db.createAlbum({ title: 'Midjourney Images #1', postToFeed: true, display: 'expanded' });
    expect(b).toMatchObject({ slug: 'midjourney-images-1-2', postToFeed: true, display: 'expanded' });
    expect(db.createAlbum({ title: '🎨🎨' }).slug).toBe('album');
    expect(db.createAlbum({ title: '!!!' }).slug).toBe('album-2');
    const renamed = db.updateAlbum(a.id, { title: 'Renamed', postToFeed: true, display: 'expanded' });
    expect(renamed).toMatchObject({ slug: 'midjourney-images-1', postToFeed: true, display: 'expanded' });
    const albums = AlbumsDocumentSchema.parse(db.buildSignedSiteBundle({ publish: true }).albums);
    expect(albums.albums.find((x) => x.id === a.id)).toMatchObject({ slug: 'midjourney-images-1', postToFeed: true, display: 'expanded' });
  });

  it('migrates existing albums to posted cards with a slug', () => {
    // Create a DB, insert an album row with raw SQL lacking the new columns' values, reopen StudioDatabase
    // expect(getAlbums()[0]).toMatchObject({ postToFeed: true, display: 'card', slug: <slugified title> })
  });

  it('reads albums without the new fields as posted cards', () => {
    expect(albumIsPosted({})).toBe(true);
    expect(albumIsPosted({ postToFeed: false })).toBe(false);
    expect(albumDisplay({})).toBe('card');
    expect(albumDisplay({ display: 'bogus' })).toBe('card');
    expect(AlbumItemSchema.parse({ id: 'x', canonicalUrl: 'u', title: 't', createdAt: 'c', updatedAt: 'c', display: 'bogus' }).display).toBeUndefined();
  });
});
```

For the migration test, add the old albums table through a raw `node:sqlite` `DatabaseSync` before constructing `StudioDatabase`, using the DDL quoted at `database.ts` ~637.

- [ ] **Step 2: Run the tests and check they fail**

Run: `npx vitest run tests/federation.test.ts -t "Album cards"`
Expected: FAIL. `slug` is undefined, and `albumIsPosted` is not exported.

- [ ] **Step 3: Implement the schema fields and helpers in `src/shared/schema.ts`**

- [ ] **Step 4: Implement the DB changes**
  - **Migration:** add the columns `slug TEXT`, `post_to_feed INTEGER NOT NULL DEFAULT 1` and `display TEXT NOT NULL DEFAULT 'card'` to `albums`. Then backfill a unique slug for every row whose slug is NULL, oldest `created_at` first.
  - **Private helper:** `uniqueAlbumSlug(title: string): string`, checking against `SELECT 1 FROM albums WHERE slug = ?`.
  - **`createAlbum`:** writes `post_to_feed` = `input.postToFeed ? 1 : 0` and `display` = `albumDisplay(input)`.
  - **`updateAlbum`:** updates `post_to_feed` and `display` when they're given, and never changes `slug`.
  - **`getAlbums`:** maps the new columns.
  - **`contentFingerprint` / `countChangesSince`:** must see a settings change, so `updateAlbum` already bumps `updated_at`.

- [ ] **Step 5: MCP.** In `webring_create_album`, add `postToFeed: { type: 'boolean' }` and `display: { type: 'string', enum: ['card','expanded'] }`, and pass them through in the handler.

- [ ] **Step 6: Run the tests and type checks**

Run: `npx vitest run tests/federation.test.ts && npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.electron.json --noEmit`
Expected: all PASS, with no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/shared/schema.ts electron/db/database.ts electron/main.ts electron/preload.ts electron/mcp/mcpServer.ts src/studio/App.tsx tests/federation.test.ts
git commit -m "Give albums a stable page address and feed and display settings"
```

---

### Task 2: Album cards and album posts on the published page

**Files:**
- Modify: `electron/services/siteGenerator.ts`, page script inside `buildStandaloneProfileHtml`:
  - new helpers near `renderAlbum` (~662)
  - `blockRenderers.albums` / `items` (~830-842)
  - the `renderTemplatePage` ctx (~914)
- Modify: `electron/services/siteTemplates.ts`:
  - `albumsBlock` and `itemsBlock` (~358-382)
  - `postCard`, `tweetRow`, `itemTile` and `itemReel` handle album entries
  - Instapick highlights (~461) link to album pages
  - new CSS in `TEMPLATE_CSS`
- Test: `tests/federation.test.ts`. Extend the `social-style templates` `setUp` (~2917) and use `renderPage` (~2774).

**Interfaces:**
- Consumes (Task 1): `pageUrl`, `postToFeed`, `display` on each album.
- Produces, as page-script functions also passed on `ctx` to `renderTemplatePage`:
  - `albumPeek(album): string`
    - The mosaic: cover + 2 + `+N`, wrapped in `<a href="<pageUrl>" class="album-peek" data-album-link="<id>">`.
    - It falls back to `album.coverUrl` / the first photos' `thumbUrl || url`.
  - `renderAlbumCard(album): string`
    - Cover, title and `N photos`, as `<a class="album-card" href="<pageUrl>" data-album-link="<id>">`.
    - An empty album gets a plain placeholder block, not an `<img>`.
  - `renderAlbumPost(album): string`
    - The classic timeline card: "<displayName> posted an album · <date>", then `albumPeek`, then the title and "Open album →".
  - `timelineEntries(items, kinds, limit)`
    - Merges `{ type: 'album', id: 'album-' + a.id, createdAt: a.createdAt, album: a }` for each posted album into the item list when `kinds` is empty or includes `post`.
    - Sorts newest first, then applies `limit`.
- A timeline entry with `type === 'album'` is rendered by every shell's item renderer through `ctx.albumPeek` / `ctx.renderAlbumPost`.

- [ ] **Step 1: Write the failing tests**

Add to `setUp`: one album `display: 'card', postToFeed: true` with 5 photos, and one `display: 'expanded', postToFeed: false` with 1 photo. Then, for the themes `neo-webring, facepace, tweetdeck, xtraspecial, instapick, tiktalk`, assert:

```ts
it(`shows card albums as cards and posted albums in the timeline in ${theme}`, () => {
  const { html } = renderPage(gen.buildStandaloneProfileHtml(db.buildSignedSiteBundle({ publish: true })));
  expect(html).toContain('href="albums/trips/"');                  // card links to its page
  expect(html.match(/data-album-link="[^"]+"/g)!.length).toBeGreaterThanOrEqual(2); // card + timeline post
  expect(html).toContain('+2');                                     // 5 photos: cover + 2 shown, +2
  expect(html).not.toMatch(/\+0|\+-/);
  expect(html).toContain('data-photo-id="' + expandedPhoto.id + '"'); // expanded album still shows its photos
  expect(html).not.toContain('data-photo-id="' + cardAlbumPhotos[4].id + '"'); // card album photos not drawn
});
it('leaves album posts out of item blocks that exclude posts', () => {
  // layout items block with kinds ['recommendation'] → no data-album-link inside that block
});
it('draws a 1-photo and an empty album card without empty peek tiles', () => {
  // album with 1 photo posted: peek has exactly one <img>, no "+"; empty album card has no <img> and says "0 photos"
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `npx vitest run tests/federation.test.ts -t "albums"`
Expected: FAIL. The cards and `data-album-link` attributes don't exist yet.

- [ ] **Step 3: Implement the page-script helpers and the classic renderers in `siteGenerator.ts`**
  - **`blockRenderers.albums`:** card albums go into one grid of `renderAlbumCard`, and expanded albums use `renderAlbum`. Keep the `albumIds` filter and the `style`: with `carousel`, the cards sit in the carousel row.
  - **`blockRenderers.items`:** use `timelineEntries`, and render `type === 'album'` entries with `renderAlbumPost`.
  - **Photos anchor:** give the first albums `<section>` `id="photos"`. Friends' "Albums ↗" link in Task 6 depends on it.
  - **`featured`:** an album block shows `renderAlbumCard`.

- [ ] **Step 4: Implement the template renderers in `siteTemplates.ts`**
  - **`albumsBlock`:** card albums render as one tile each:
    - `.tpl-tile` with the cover and a title overlay, linking to `pageUrl`;
    - in reel, one `reelCard` with `open` set to an `href` on the album page.
    - Expanded albums keep today's markup.
  - **`itemsBlock`:** call `ctx.timelineEntries`. The item renderers branch on `item.type === 'album'`:
    - `postCard` and `tweetRow` wrap `ctx.albumPeek` in their own head (avatar, name, "posted an album", date);
    - `itemTile` shows the cover with a "▣ N" badge;
    - `itemReel` is a `reelCard` with the cover.
  - **Instapick highlights:** link to `a.pageUrl`.
  - **CSS:** add `.album-peek`, `.album-card` and `.album-plus` to `TEMPLATE_CSS`, and the classic equivalents in the page `<style>`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/federation.test.ts`
Expected: all PASS. This includes the existing "embeds a template renderer that runs standalone" and "every inline script parses" tests.

- [ ] **Step 6: Commit**

```bash
git add electron/services/siteGenerator.ts electron/services/siteTemplates.ts tests/federation.test.ts
git commit -m "Show albums as cards, and posted albums in the timeline, on the published page"
```

---

### Task 3: A page for each album

**Files:**
- Modify: `electron/services/siteGenerator.ts`:
  - `generateToDirectory` (~96-208): write album pages after `index.html`
  - `buildStandaloneProfileHtml(bundle, options)`: new option `albumId`
  - the page script's render branch
- Modify: `electron/services/pageEnhancements.ts`
  - `setHash` (~70-76) builds the URL from `location.pathname + location.search`
- Test: `tests/federation.test.ts`

**Interfaces:**
- Consumes (Task 1): `albumPagePath(slug)`, `album.pageUrl`. Consumes (Task 2): `renderAlbum`, `renderPhotoCard`.
- Produces: `buildStandaloneProfileHtml(bundle, options: { preview?: boolean; albumId?: string })`. With `albumId`:
  - **Head:**
    - `<base href="../../">`
    - `<title>` set to `<album title> · <displayName>`
    - `og:title`, `og:description` (plain description, max 200 chars), `og:image` (absolute: `siteUrl` + `/` + cover), `og:url` (absolute page URL) and `twitter:card=summary_large_image`
  - **Embedded bundle:** items emptied, `albums` reduced to that album.
  - **`window.__WEBRING_ALBUM_ID__`:** set to the id. When it's set, the page script skips layout and templates and renders the album view:
    - "← Back to <displayName>'s page" (`href="./"`)
    - title, Markdown description, `N photos`, "↻ Share album"
    - every photo via `renderPhotoCard` in a grid, or "No photos yet"
- Produces: `generateToDirectory` writes `albums/<slug>/index.html` for every album and adds each to `filesWritten`. Removed albums' pages are deleted by the publish ledger (`publishSync.ts`), as ring pages are today.

- [ ] **Step 1: Write the failing tests**

```ts
it('writes a shareable page for each album', () => {
  const result = gen.generateToDirectory(out);
  expect(result.filesWritten).toContain('albums/trips/index.html');
  const page = fs.readFileSync(path.join(out, 'albums/trips/index.html'), 'utf8');
  expect(page).toContain('<base href="../../">');
  expect(page).toContain('<meta property="og:title" content="Trips · Alice"');
  expect(page).toContain('<meta property="og:image" content="https://alice.ring.test/media/albums/');
  const { html } = renderPage(page);
  expect(html).toContain('Back to Alice');
  expect(html.match(/data-photo-id=/g)!.length).toBe(5);
  expect(html).not.toContain('data-block=');           // no profile layout on the album page
});
it('removes an album page from the destination when the album is deleted', async () => {
  // publishToLocalDirectory, deleteAlbum, publish again → albums/trips/index.html no longer exists
});
it('keeps the album page address when a photo opens and closes', () => {
  // vm-run installPageEnhancements with location.pathname '/albums/trips/' and a replaceState spy
  // open #photo-<id> then close: every replaceState URL starts with '/albums/trips/'
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `npx vitest run tests/federation.test.ts -t "album page|shareable page"`
Expected: FAIL. `albums/trips/index.html` is not written.

- [ ] **Step 3: Implement the `albumId` option, the page-script album branch, and the album-page writes in `generateToDirectory`**

Escape every Open Graph value with the module `escapeHtml`. Read `siteUrl` from `bundle.profile.siteUrl` with any trailing `/` trimmed.

- [ ] **Step 4: Fix `setHash` in `pageEnhancements.ts`** so it uses `location.pathname + location.search + (hash ? '#' + hash : '')`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/federation.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/services/siteGenerator.ts electron/services/pageEnhancements.ts tests/federation.test.ts
git commit -m "Publish a page for each album, with a link preview"
```

---

### Task 4: One feed card per album when syncing friends

**Files:**
- Modify: `electron/db/database.ts`:
  - `NetworkFeedEntry` (~263)
  - `network_feed` migration
  - `upsertNetworkFeedEntry` (~2998), `pruneFriendFeed` (~2028), `pruneFeedOutsideWindow` (~2104), `getNetworkFeed` (~2783)
  - new methods
- Modify: `electron/services/ringCrawler.ts`, albums block (~534-592)
- Modify: `electron/mcp/mcpServer.ts`, the feed `entryType` enum (~655)
- Modify: `src/studio/App.tsx`, the `NetworkFeedEntry` copy (~287)
- Test: `tests/federation.test.ts`. Use the `makeSite` pattern (~1063).

**Interfaces:**
- Produces:
  - `NetworkFeedEntry.entryType` gains `'album'`.
  - New optional fields: `albumUrl?: string`, `photoCount?: number`, `newCount?: number`, `peekUrls?: string[]`.
- New `network_feed` columns:
  - `album_url TEXT NOT NULL DEFAULT ''` (set on photo rows to their album's `canonicalUrl`)
  - `photo_count INTEGER NOT NULL DEFAULT 0`
  - `new_count INTEGER NOT NULL DEFAULT 0`
  - `peek_json TEXT NOT NULL DEFAULT '[]'`
  - index `idx_network_feed_album ON network_feed(album_url)`
  - The migration that adds `album_url` also runs `clearFetchCache()` once, so the next sync reprocesses every friend's albums.
- **Album row** (`entryType 'album'`):
  - `canonicalUrl`: `album.canonicalUrl`
  - `title`: the album title
  - `commentary`: the description
  - `targetUrl`: the absolute album page URL, or the friend's site URL if there's no `pageUrl`
  - `mediaUrl`: the absolute cover
  - `createdAt`: the newest photo's `createdAt`, or `album.createdAt` if the album is empty
  - `photoCount`
  - `peekUrls`: up to 3 absolute thumbnails, newest first when `newCount > 0`, otherwise the cover and then album order
  - `newCount`
- **`newCount` rule:**
  - If the album row didn't exist before this sync, `newCount = 0`.
  - Otherwise, `newCount = previous newCount + photos whose canonicalUrl had no row before`.
- `getNetworkFeed()` excludes `entry_type = 'photo'`.
- `getFeedAlbumPhotos(albumUrl: string): NetworkFeedEntry[]` returns photo rows for the album, in album order (`created_at ASC`).
- `markFeedAlbumSeen(albumUrl: string): void` sets `new_count = 0`.
- `pruneFriendFeed(..., 'photos', keep)` now matches `entry_type IN ('photo','album')`.
- `pruneFeedOutsideWindow()` keeps photo rows whose album row is in the window. These delete only rows older than the cutoff, except photo rows whose `album_url` matches an album row with `created_at >= cutoff`.
- **Crawler, for each album:**
  - If `!albumIsPosted(album)`, skip it: no rows, and nothing added to `seenPhotoUrls`, so a verified sync prunes them.
  - Otherwise, if the album's newest date is outside the window, skip it.
  - Otherwise, upsert every photo (whatever its own date) with `albumUrl`, then the album row, and add all canonical URLs to `seenPhotoUrls`.

- [ ] **Step 1: Write the failing tests**

```ts
it('shows a friend album as one feed card and keeps its photos for the album view', async () => {
  // Carol: posted album with 3 photos; Alice crawls
  const feed = alice.db.getNetworkFeed();
  expect(feed.filter((e) => e.entryType === 'photo')).toHaveLength(0);
  const card = feed.find((e) => e.entryType === 'album')!;
  expect(card).toMatchObject({ title: 'Trips', photoCount: 3, newCount: 0, targetUrl: 'https://carol.ring.test/albums/trips/' });
  expect(card.peekUrls).toHaveLength(3);
  expect(alice.db.getFeedAlbumPhotos(card.canonicalUrl)).toHaveLength(3);
});
it('counts photos added later as new and clears the count when opened', async () => {
  // Carol adds 2 photos, republishes; Alice crawls → newCount 2, createdAt = newest photo, peekUrls[0] is a new photo
  // markFeedAlbumSeen → newCount 0
});
it('leaves unposted albums out of the feed, and removes one that is unposted later, only on a verified sync', async () => {
  // Carol album postToFeed false → no album/photo rows.
  // Posted then switched off → rows removed after crawl; a saved copy of one photo remains in getSavedPosts().
  // Tamper albums.json signature before the switch-off crawl → rows remain.
});
it('treats albums from older Studios (no settings) as posted cards', async () => {
  // Rewrite carol's albums.json removing postToFeed/display and re-sign → album card appears
});
it('keeps every photo of a recently updated album inside the feed window', async () => {
  // album with photos backdated 200 days and one new photo; window 90 → getFeedAlbumPhotos length = all
});
it('upgrades per-photo feed rows to album cards on the first sync without new badges', async () => {
  // seed photo rows with upsertNetworkFeedEntry (no albumUrl), reopen DB (migration clears fetch cache), crawl
  // → no entryType 'photo' in getNetworkFeed, album card newCount 0
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `npx vitest run tests/federation.test.ts -t "feed card|album"`
Expected: FAIL. `getFeedAlbumPhotos` doesn't exist.

- [ ] **Step 3: Implement the DB migration, the new fields in `upsertNetworkFeedEntry` and the row mapper, and the new and changed methods**

- [ ] **Step 4: Implement the crawler changes**

Read the existing photo canonical URLs for the album, and the old album row, before upserting, all inside the existing transaction.

- [ ] **Step 5: Update the MCP enum and the `App.tsx` interface copy**

- [ ] **Step 6: Run the tests, the type checks and a quick load test**

Run: `npx vitest run tests/federation.test.ts && npx tsc -p tsconfig.electron.json --noEmit && LOADTEST_SIZES=50,500 npm run loadtest:sync`
Expected:
- All PASS.
- Load test "warm, unchanged" requests equal the friend count (50 / 500).
- @150ms times are within 10% of `tests/load/results/sync-2026-11-01T18-26-13-708Z.md` (14.3 s at 500).

- [ ] **Step 7: Commit**

```bash
git add electron/db/database.ts electron/services/ringCrawler.ts electron/mcp/mcpServer.ts src/studio/App.tsx tests/federation.test.ts
git commit -m "Sync a friend's album as one feed card, with its photos kept for the album view"
```

---

### Task 5: Album settings in Studio

**Files:**
- Modify: `src/studio/App.tsx`:
  - New Album form (~2452-2480): state next to `newAlbumTitle` (~661)
  - `handleCreateAlbum` (~1065)
  - edit panel (~2533-2581): `albumDraft` gains `postToFeed`, `display`
  - `handleSaveAlbum` (~1180)

**Interfaces:**
- Consumes (Task 1): `createAlbum` / `updateAlbum` with `postToFeed`, `display`.

- [ ] **Step 1: Add the controls to the New Album form**
  - `☐ Post to feed` checkbox (unticked) with the hint "Announce this album in your posts timeline".
  - "Show in Photos as:" radio, `Card` (checked) / `Expanded`.
  - Pass both to `createAlbum`, and reset them after creating.

- [ ] **Step 2: Add the same two controls to the edit panel**

Bind them to `albumDraft` (initialised from the album). "Save Album" sends them to `updateAlbum`. Show the album's page address, `albums/<slug>/`, read-only under the title, with **View page ↗** (`openExternal(siteUrl + '/' + pageUrl)`) when the site has been published.

- [ ] **Step 3: Type-check and try it in the app**

Run: `npx tsc -p tsconfig.json --noEmit && npm run dev`
Expected:
- No type errors.
- Creating an album with the defaults shows Card and unticked.
- Editing it to Expanded + posted and saving persists after switching albums.

- [ ] **Step 4: Commit**

```bash
git add src/studio/App.tsx
git commit -m "Choose whether an album is posted to the feed and how it shows in Photos"
```

---

### Task 6: Album cards and the album view in Studio's feed

**Files:**
- Create: `src/studio/FriendAlbumView.tsx`
- Modify:
  - `electron/main.ts`: IPC `studio:get-feed-album-photos`, `studio:mark-feed-album-seen`
  - `electron/preload.ts`
  - `src/studio/App.tsx`:
    - `studioApi` typings
    - `myFeedEntries` (~1841)
    - the feed entry card (~4220-4400)
    - the friend card action row (~3976)
    - the saved view, if it switches on `entryType`

**Interfaces:**
- Consumes (Task 4): `getFeedAlbumPhotos`, `markFeedAlbumSeen`, and the `album` entry fields.
- Produces:
  - IPC `studio:get-feed-album-photos` `(albumUrl: string) => NetworkFeedEntry[]`
  - IPC `studio:mark-feed-album-seen` `(albumUrl: string) => { ok: true }`
  - preload `getFeedAlbumPhotos(albumUrl)` and `markFeedAlbumSeen(albumUrl)`
  - `export function FriendAlbumView(props: { album: NetworkFeedEntry; photos: NetworkFeedEntry[]; savedUrls: Set<string>; onClose(): void; onAction(action: WebringDeepLinkAction): void; onToggleSave(entry: NetworkFeedEntry): void; onOpenSite(url: string): void }): JSX.Element`
  - The header has the friend's name, the album title, the description, `N photos`, and Like / Comment / Share / Save on the album. Under it is a photo grid; each photo has Like / Comment / Share / Save and a click-to-enlarge view. **Open on their site ↗** uses `album.targetUrl`.

- [ ] **Step 1: Add the IPC handlers and preload methods**

- [ ] **Step 2: Render `album` entries in the feed**
  - The peek mosaic comes from `peekUrls`, with `+N` from `photoCount`.
  - The line reads "<friendName> posted an album", or "added N photos" when `newCount > 0`, with an **N new** pill.
  - Clicking the mosaic or title opens the album view: fetch photos, call `markFeedAlbumSeen`, then `refreshStudioData()`.
  - Like, Comment and Save on the card target the album's `canonicalUrl` through the existing handlers. Re-share uses `targetUrl` (the album page).

- [ ] **Step 3: Build `FriendAlbumView.tsx`**

Reuse `handleIncomingDeepLink` for photo actions (like/comment: `targetUrl` is `photo.canonicalUrl`; share: `targetUrl` is `photo.targetUrl`) and `handleToggleSaved` for saves.

- [ ] **Step 4: Condense your own albums in the "Everyone" and "Just me" scopes**

`myFeedEntries` maps each posted album to one `album` entry (`isMine: true`, `peekUrls` from the first three thumbnails). Clicking it switches to the Albums tab with that album selected (`setSelectedAlbumId`).

- [ ] **Step 5: Add "Albums ↗" to the friend card**

It calls `openExternal(friend.siteUrl.replace(/\/$/, '') + '/#photos')`.

- [ ] **Step 6: Type-check and try it in the app**

Run: `npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.electron.json --noEmit && npm test && npm run dev`
Expected:
- No type errors, and tests pass.
- In the app:
  - With two personas pointed at each other's export folders, a posted album shows as one card.
  - Opening it shows every photo, and liking a photo pre-fills a like for that photo.
  - Adding 2 photos and syncing shows "added 2 photos" and **2 new**, which clears on open.
  - "Albums ↗" opens the friend's page at the Photos section.

- [ ] **Step 7: Commit**

```bash
git add src/studio/FriendAlbumView.tsx src/studio/App.tsx electron/main.ts electron/preload.ts
git commit -m "Show albums as one card in the Neighborhood Feed, with an album view"
```

---

### Task 7: Docs and fixtures

**Files:**
- Modify: `SPEC.md`, `README.md`, `docs/architecture/federation.md`, `tests/load/peerFleet.ts` (`makeAlbums` ~157)

- [ ] **Step 1: Fixtures.** `makeAlbums` sets `slug`, `pageUrl`, `postToFeed: true` and `display: 'card'` so the fleet matches what Studio publishes. Run `LOADTEST_SIZES=50 npm run loadtest:sync`. It should complete with requests = 50 in the "warm, unchanged" row.

- [ ] **Step 2: SPEC.md.** Add one bullet covering:
  - the album fields and their missing-field defaults;
  - `albums/<slug>/index.html` with `<base href="../../">` and `__WEBRING_ALBUM_ID__`;
  - the `network_feed` album rows (`album_url`, `photo_count`, `new_count`, `peek_json`);
  - the window and prune rules;
  - the `newCount` rule.

- [ ] **Step 3: README.** Under "Media Library", describe Post to feed, Card/Expanded, album pages and link previews. Under "Feed window", mention that friends' albums appear as one card with an album view.

- [ ] **Step 4: federation.md.** Add a sentence on album cards in the feed and which documents drive them.

- [ ] **Step 5: Final check**

Run: `npm test && npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.electron.json --noEmit`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add SPEC.md README.md docs/architecture/federation.md tests/load/peerFleet.ts
git commit -m "Document album cards, album pages and album feed cards"
```
