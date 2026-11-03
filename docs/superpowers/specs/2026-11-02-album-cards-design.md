# Album cards: condensed albums on the published page and in the feed

Date: 2026-11-02
Status: ready for approval

## Why

A big album takes over the page. On the published site, the Photos section shows every album in full, so an album like *Midjourney Images #1* (36 photos) is a long grid that visitors have to scroll past. In friends' Studios it's worse: every photo becomes its own Neighborhood Feed entry, so one album reads like 36 posts and feels like spam.

The goal is for an album to take up the space of one post wherever it appears, with the full album one click away on a page of its own. Users should also be able to decide how each album is shown: their space follows a standard format, but they can make it their own.

## Goals

1. **Two settings per album**, set when the album is created and changeable later:
   - **Post to feed** (checkbox). When ticked, the album is also announced in the posts timeline. When not, it appears only in the Photos section.
   - **Show in Photos as:** **Card** (the default) or **Expanded**, which shows every photo as the page does today.
2. **Album post in the published timeline** (only when Post to feed is ticked). It reads "<Name> posted an album", with the time, and is laid out as **cover plus a peek**:
   - the cover large on the left, two more photos stacked on the right, and a "+N" count on the last one;
   - title and "Open album →" below.
   - This was style B in the mockups; style A, a single big cover, was rejected.
3. **Album cards in the Photos section:** a grid of cards, each with the cover photo, title and photo count. Albums set to Expanded are shown in full there instead.
4. **A page for each album**, for example `yoursite.com/albums/<slug>/`. Clicking an album post or card opens it. It can be bookmarked and shared, and a shared link shows the album's cover and title as its preview (Open Graph tags).
5. **A friend's album in your Neighborhood Feed** appears as one album card in the same cover-plus-peek style, never as one entry per photo.
6. **Clicking a friend's album card in Studio** opens an album view inside Studio. From there you can like, share, comment on or save the album or any single photo.
7. **New photos in an album show up after sync.** When a friend adds photos to an album you've already seen, the next sync updates its card to show the new photos.

## Non-goals

- **"What's new" notifications** (new comments on posts, unread counts across the feed). The user will raise this separately. The album "new photos" indicator (goal 7) should be built so it can become part of that later, but this project doesn't build the general feature.
- **A popup (modal) album view on the published page.** The user chose a page of its own, because it can be bookmarked and shared.
- Changing how single photos are stored, signed, resized or published.

## Anti-goals (would make this a failure even if it works)

- A friend's album still flooding the Neighborhood Feed one photo at a time.
- Likes, comments or saves on photos that people have already made being lost or detached after the change.
- The album page needing anything dynamic on the host. It must be static files, like the rest of the site.
- Existing albums disappearing from friends' feeds, or from the published page, after upgrading.

## Constraints (from the project rules and code)

- **Static site.** Album pages are generated HTML files, written next to `index.html` by `StaticSiteGenerator.generateToDirectory` (`electron/services/siteGenerator.ts`). They are published incrementally like every other file (`electron/services/publishSync.ts`), and removed when the album is deleted.
- **One renderer.** The page and Studio's preview both come from `buildStandaloneProfileHtml`, with the templates in `electron/services/siteTemplates.ts`. Album posts and cards must work in every arrangement:
  - `stack`, the classic themes;
  - `sidebar` (Facepace), `deck` (Tweetdeck), `rails` (XtraSpecial), `grid` (Instapick) and `reel` (Tik Talk).
- **Signed data, additive schema.** The two settings travel in the signed `albums.json` as new optional fields on `AlbumItemSchema` (`src/shared/schema.ts`). Readers must accept albums without them.
  - Local storage changes follow the "guarded `ALTER TABLE` in `initializeSchema`" rule.
  - The fixtures in `tests/load/peerFleet.ts` must be kept in step.
- **Federation rules.**
  - Unverified peer data is never re-published.
  - Only verified fetches may delete local feed rows (`pruneFriendFeed`).
  - The feed window (`feedRetentionDays`) still applies.
  - Any change to federation behaviour gets a test in `tests/federation.test.ts`.
- **Sync cost.** The sync load test (`npm run loadtest:sync`) must not get noticeably worse. Its baseline is in `tests/load/results/`.
- **Existing interactions keep working.**
  - Likes, comments and shares target a photo's `canonicalUrl`, and must keep doing so.
  - The published page's photo viewer (`#photo-<id>` in `electron/services/pageEnhancements.ts`) keeps working, both on the main page and on album pages.

## Decided by the user

- The album post and the feed card use the cover-plus-peek layout (style B).
- Each album opens on a page of its own, not in a popup.
- Card is the default display, and Expanded is an option.
- Post to feed is a per-album choice. Ticked, the album appears in both the timeline and the Photos section. Not ticked, it appears only in Photos.
- Friends' feeds show one card per album, and clicking it opens an album view inside Studio with like, share and comment.
- Photos added later show up on the album's card after friends sync.
- **A friend's albums that weren't posted to the feed are not shown in Studio.**
  - The friend card gets an **Albums ↗** link that opens the friend's published Photos section in the browser. Visitors can like and share from there through the page's existing `webring://` links.
  - The crawler doesn't keep feed rows for photos in unposted albums. Rows already stored from before are pruned on a verified sync, like any removed photo.
  - Endorsements and saved posts are never pruned, so those survive.

## Calls I made (the user can overrule them)

- **Post to feed is off for new albums.** The user described it as an opt-in.
- **Existing albums are migrated to "posted, card"**, so nothing disappears from friends' feeds. A friend's album with no setting (from an older Studio) is treated the same way.
- **Albums that aren't posted stay out of friends' feeds.** (The user decided how they're reached; see "Decided by the user".)
- **Photos added later:**
  - On the **published page**, the album post stays at its original date. The page just shows the current photos.
  - In **friends' feeds**, the card moves back to the top with "<Name> added N photos", a **N new** badge, and the new photos first in the peek. The badge clears once the album is opened.
- **Album page look:** it uses the site's theme, with a "← Back to <Name>'s page" link, the description, the photo count and "↻ Share album". It opens photos in the existing photo viewer.
- **Album page address:** `albums/<slug>/`, with the slug made from the title and kept stable after it's first published, so links don't break.

- **Page layout blocks** (`src/shared/schema.ts`, around lines 200–220):
  - Album posts appear in any `items` block whose `kinds` filter is empty or includes `post`. No new kind is added.
  - An `albums` block's `albumIds` filter and its `grid` / `carousel` style still apply. Card albums show as cards in that grid or carousel, and Expanded albums show their photos in it, as today.
  - Every album gets its own page, and a post if posted, whatever the blocks show.
- **Saving a friend's album** keeps the cover image and a link to the album, like saving one post (`electron/services/savedPosts.ts`). Saving a single photo from the album view copies it, as today.
- **Feed window and albums:**
  - A posted album is in the window if its newest photo's `createdAt` is inside it.
  - Studio keeps every photo's details for an album that is in the window, not just the photos inside it, so the album view is never partial. These details are small rows, and `albums.json` is already downloaded in full. Only image references are stored; images load from the friend's site.
- **No badge flood on upgrade.** "N new" counts only photos first seen on a sync after the album was already stored as an album card. The first sync after upgrading sets the baseline.
- **Album-level likes, comments and shares** target the album's existing `canonicalUrl`. Photo-level ones keep targeting each photo's `canonicalUrl`.
- **The `#photo-<id>` viewer** on the main page still opens photos in Card albums. They stay in the page's data and are just not drawn in the grid.

## Left to the builder

- How the Studio album view is put together: a new view or panel in `src/studio/App.tsx`, and where the album and photo data comes from. Today the crawler writes one `network_feed` row per photo (`electron/services/ringCrawler.ts`, around line 550).
- How album cards are stored for the feed: for example, a new `album` entry type, with photo rows linked to their album and hidden from the main feed list.
- Exact markup and CSS for each template arrangement.
- How to handle a slug that clashes with another album, or with an existing path.
