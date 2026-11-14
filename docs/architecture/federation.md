# Federation architecture

How Webring Studio exchanges data with other sites today, where the boundaries are, and what has to change before peer-to-peer sync, CRDTs or ActivityPub can be added.

## Current model

- **Pull-only.** There's no push or gossip. The studio fetches a friend's published static files over HTTP when the user clicks Sync, an MCP agent calls `webring_crawl_friend` / `webring_crawl_all_friends`, or a per-persona schedule runs (`electron/services/scheduler.ts`: sync on an interval, publish only when the content fingerprint changed). See `RingCrawler.crawlFriendSite` in `electron/services/ringCrawler.ts`. Sync All crawls up to `SYNC_CONCURRENCY` (16) friend sites at once, so slow or unreachable sites don't hold up the rest, and skips a friend it recently couldn't reach until its backoff ends (15 min, doubling up to a day). The signed manifest lists a fingerprint for each document and only changes when one of them does, so a friend with nothing new costs one conditional request (a 304 for the manifest); otherwise only documents whose fingerprint changed are fetched. Publishing keeps unchanged documents byte-identical so their fingerprints and ETags stay put. Fetches ask for compressed JSON. `npm run loadtest:sync` measures how this scales.
- **Timing and routing.** Each scheduled sync or publish can add random jitter (up to 5, 15 or 30 minutes), so personas on one computer don't contact hosts at the same moment. A persona can route its outbound fetches through its own `socks5://`, `socks5h://` (Tor) or `http://` proxy (`electron/security/proxyAgent.ts`). That covers crawling friends and ring files, Webring Hub requests, checking links, saving a friend's post, and friends' images and ring pages shown in the Studio window (`electron/security/windowProxy.ts`). The setting is stored only in that persona and never exported. Publishing (SFTP/FTP, GitHub) connects directly.
- **Signed documents.** Every published JSON document carries an Ed25519 proof. The crawler checks each one against the friend's `did.json` key. The first key it sees is pinned in `site_keys` (trust on first use). If a different key appears later, Studio looks for a signed rotation chain from the pinned key (see [Identity and key changes](#identity-and-key-changes)). If the chain verifies, the pin moves to the new key without a warning. Otherwise the crawl is flagged `changed`, the old key stays pinned, and nothing from that site verifies until the user chooses **Trust New Key & Re-sync** (`trustNewFriendKey`).
- **Last write wins.** Feed rows are keyed by the entry's canonical URL and endorsements by the source item URL. A new crawl replaces the old row. There is no merge logic.
- **Entries are scoped to their site.** An entry is only accepted if its canonical URL is on the friend's own site (`isUrlWithinSite`). A friend can't overwrite another friend's rows.
- **Deletions follow the source.** After a *verified* fetch, anything that friend no longer publishes is pruned. A failed, missing or unverified fetch never deletes rows. A friend who publishes only recent posts sets `archive.since` in `items.json`. Entries older than that are treated as archived, not deleted, and are kept. Removing a friend deletes their rows too. Changing a friend's site address does the same for the old address: their feed rows, endorsements and cached validators are cleared, and their pinned key is reset.
- **Local retention.** Separately from the source, the feed keeps friends' entries only for the window the user chooses (3 months by default; `pruneFeedOutsideWindow`). Photos of a posted album that is still in the window are kept with it. **Saved** posts and photos are private copies in their own table. They are kept beyond the window and never published.

## Boundaries

```
friend's /api/*.json ──crawl+verify──▶ SQLite (internal state) ──curated view──▶ studio feed / MCP
                                              │
                                              └──buildSignedSiteBundle()──▶ /api/*.json (exchange format) ──▶ static site
```

- **Internal state** is the per-persona SQLite database. Only the local client writes to it.
- **Curated view** is `getCuratedNetworkFeed()` and `getCuratedEndorsements()` in `electron/db/database.ts`. They apply mute/block (from the `moderation` table) and, for export, drop endorsements without a verified signature. The studio feed, MCP tools and the static export all read through it, never from the raw tables.
  - **Mute** hides a site from the local feed only.
  - **Block** also drops its endorsements from the published site and stops crawling it.
- **Exchange format** is the set of signed documents that `buildSignedSiteBundle()` produces (`did.json`, `manifest`, `profile`, `albums`, `items`, `connections`). Older posts move out of `items` into signed monthly archives (`api/archive/items-YYYY-MM.json`), which `items.json` lists with their SHA-256. Album manifests and ring files are signed the same way (see below). Everything that gets published goes through this one function. The network feed and saved posts are never published; only endorsements of the user's own content and (optionally) the public friends list are.
- **The published site is a snapshot.** Each successful publish records `lastPublishedAt` and what it contained, and the Publish tab shows it with a count of changes made since. Anything that arrives after a publish shows up publicly only after the next one.

## Identity and key changes

- **The site address is the identity.** A persona's `did:web` comes from its site URL, so a new address means a new identity to friends. Guided setup (`electron/services/setupService.ts`) refuses to move a persona to a different address once it has published or has friends. Following a site to a new domain isn't supported yet (see [Webrings](#webrings)).
- **Planned key rotation.** **Rotate Signing Key…** makes a new key and a `webring-key-rotation` certificate (`createKeyRotationCertificate` in `src/shared/schema.ts`). The certificate holds the DID, the site URL, the old and new public keys and a timestamp, and is signed with the **old** key. Every certificate the persona has issued is published as `keyRotations` in `did.json` and `manifest.json`.
- **Following a rotation.** When a fetched key differs from the pinned one, `pinSiteKey` (`electron/db/database.ts`) calls `verifyKeyRotationChain`. Starting from the pinned key, each step needs a certificate signed by the current key, for the same DID and site, that leads to a key not seen before in the chain, for at most 10 steps. If the chain reaches the presented key, the pin advances in `site_keys`, the friend row and the ring member rows. Otherwise the site is flagged `changed`. Friend crawling and ring files share `site_keys`, so a rotation is followed in both.
- **Lost keys.** Without the old private key, no certificate can be made. Friends see the `changed` warning and have to confirm the new key with the owner some other way.

## Site Design data

`profile.json` can carry `appearance` (look & feel options) and `layout` (the ordered content blocks below the profile header). Both are parsed leniently: invalid appearance fields and unknown or malformed blocks are dropped rather than failing the whole profile, so newer block types never break older readers. A missing `layout` means the default page; an empty array means no blocks. Text blocks hold Markdown source, rendered on the page by the self-contained renderer in `src/shared/markdown.ts`, which escapes everything and allows only safe links.

## Media Library and album manifests

- **Published files.** Each album's photos are content-addressed web copies and thumbnails under `media/albums/<albumId>/` (metadata stripped), described by a signed `media/albums/<albumId>/manifest.json` (type `webring-album-manifest`: album details, and per photo the image and thumbnail URL, SHA-256, size, MIME type and dimensions). `api/albums.json` links each album's `manifestUrl`, and photo entries carry the same hashes.
- **Album cards in the feed.** A friend's posted album (`postToFeed` in the signed `albums.json`; missing means posted) becomes one feed card, with its photos kept as linked rows for the album view. `albums.json` drives it, and the verified `manifest.json` gates what may be stored or pruned. Compatibility: older Studios ignore `postToFeed` and still show every photo in the feed, unposted albums included. Readers must never reject a whole `albums.json` over `display` or `postToFeed` values; an unknown or malformed value is read as missing (posted, card).
- **Changes propagate by URL.** A replaced photo keeps its id and canonical URL but gets a new file name, so friends' Studios update the feed entry on the next sync. A removed photo disappears from `albums.json` and is pruned from friends' feeds after a verified fetch (the same rule as other entries).
- **Incremental publishing.** A per-destination ledger records what Studio last published. Publishing uploads only changed files and deletes only Studio's own files that are no longer part of the site, so stale photos don't stay reachable on hosts or in the repo.

## Webrings

Rings are curated by a maintainer and run entirely on static files (`electron/services/ringService.ts`).

- **Ring file.** Each hosted ring is published as a signed ring file at `api/rings/<slug>.json` (its signed member list, called the ring's "hub" in code: `WebringHubDocument`, `hubUrl`), plus a script-free ring page (by default `rings/<slug>/index.html`; the maintainer can choose another address, such as `/webring`) and a `ring.json` pointer beside the page so Studio can join from the page's address.
- **Ring page.** The page takes its light or dark look and accent from the maintainer's Site Design (a ring accent overrides it) and shows the banner, tagline, Markdown rules, member cards and how to join. These ride in the ring file as optional v3 fields (`tagline`, `rules`, `bannerUrl`, `accent`; members' `avatarUrl` and `tagline`), which older readers ignore. Member avatars and taglines come only from that member's verified `profile.json`, checked during the maintainer's sync, and only https images on the member's own site are shown. The ring file lists the members in order (`inRotation: false` marks hidden members). Bans and pending requests are never published. Closing a ring republishes the ring file with `status: "closed"` and no members, because some hosts (SFTP/FTP) never delete old files.
- **Membership is two-sided:** the ring file lists the site *and* the site's own signed `connections.json` lists the ring.
- **Joining.** The applicant creates a private signed request (`webring://ring-request?token=…`) and sends it to the maintainer out-of-band. The maintainer's Studio verifies it against the applicant's `did.json` and checks it's under 30 days old and not banned. Approval adds the member, and it goes live at the maintainer's next publish.
- **Sync (part of Sync All).**
  - **Members** re-read each joined ring's ring file. Listed → `member` with fresh prev/next. Not listed in a newer verified ring file → `removed`. A `closed` ring file → `closed`.
  - **Maintainers** check each member's verified `connections.json`. A member who confirmed and then stopped listing the ring has left and is removed. New members get a 14-day grace period.
- **Trust rules:**
  - Ring fetches are https-only, never `file://` or local paths.
  - A ring file must say it lives at the URL it was fetched from, sit on its maintainer's site, carry the maintainer's did:web, and be signed by the maintainer's pinned key.
  - Older ring file copies are ignored.
  - Unsigned (v1) ring files, changed keys and failed fetches never remove anyone; they only raise warnings or flags.
  - Keys are pinned once per site in `site_keys`, shared with friend crawling.
- **"Added you".** Adding a friend notifies no one. The adder can send a private signed `webring://friend-notice` link out-of-band; the recipient verifies it against the sender's `did.json` (pinned key, under 30 days, addressed to them). Studio also reads verified `connections.json` from friends (Mutual) and ring members (people who list you but aren't friends yet). Only public friends are visible this way; notices are local and never published.
- **Navigation.** Prev/Next are baked into the page at publish. On click, the page re-reads the ring file (2 s timeout, no credentials or referrer, https-only member URLs) to skip removed or hidden sites, falling back to the baked link. Random picks from the ring file's members; if the ring file can't be read (and in the Studio preview, which never fetches it), it picks from the other members saved at the last sync (`rotationUrls` in `connections.json`). Without JavaScript it goes to one saved member, or the directory page if none are saved. It never links to the ring file's JSON.
- **Migration.** The pre-redesign single ring file (`publishWebringHub`, members = public friends) was converted once into a hosted ring at the same path, `api/webring-hub.json`. Older joined rings are kept as `legacy`: still shown, never auto-removed. A `legacy` ring whose address is on the persona's own site can be converted into a hosted ring (**Host this ring**), with its page at that old address.
- **Not yet supported:** following a ring when its maintainer moves domains (`movedTo`), and keeping a member's place when they change site URL. Both currently mean re-joining.

## Webring Hubs

A Webring Hub is an optional, third-party server that indexes published sites, the way a search engine does, and can do more through extensions. It has nothing to do with ring files. It lives outside the published site, which never depends on it. Studio uses it from the engine only:

- **Find people.** Search results are hints. They are never stored or published, and **Use in Add Friend** fills in only the address and a name the user can edit. The normal crawl, verify and pin path does the rest.
- **List my site.** Opt-in per persona and per hub. The hub fetches and verifies the signed static files itself. Unlisting sends a removal request signed with the site key.
- **Ping after publish.** Studio asks each hub the site is listed in to re-read it, but only once the live site shows the new publish. It never uploads content.

The hub pins each site's key and only follows a key change through a rotation chain (`keyRotations` in `did.json`), the same as Studio. New hub features are built as **Webring Hub extensions**: modules the operator installs, which add routes and react to verified entry changes. Studio talks only to the extensions it knows. The first, `key-witness`, lets Studio compare a friend's pinned key with the keys a hub has seen, and shows the result as evidence only. Rules, decisions and the roadmap (`movedTo`, ring discovery and a signed static snapshot, all planned as extensions) are in [webring-hub.md](webring-hub.md).

## Rules for future sync layers

Any CRDT, P2P or ActivityPub work must keep these boundaries:

1. New sync code writes into internal state. It never feeds the static site generator directly.
2. Moderation and verification are applied once, in the curated view, and every reader uses it.
3. The exchange format stays the signed bundle. A new wire format (for example JSON-LD) is a second serialization of the same bundle, not a separate data path.

## Known gaps before P2P or ActivityPub

- **Non-standard canonicalization.** `canonicalizeJson` in `src/shared/schema.ts` sorts object keys recursively. It isn't JCS (RFC 8785) or URDNA2015, so only another copy of this app can verify the signatures. Key rotation certificates use the same scheme.
- **Proof type label.** Proofs say `Ed25519Signature2020`, but they aren't produced with the JSON-LD canonicalization that suite requires. Rotation certificates carry the same label. Either switch to a real Data Integrity suite or rename the proof type.
- **Custom DID property.** `keyRotations` is a Webring-specific property on the DID document. Standard did:web resolvers ignore it, so only Studio follows key rotations.
- **Rotations can't be revoked.** Certificates have no revocation or expiry. Someone holding an old private key *and* able to change files on the site can issue a certificate to a key of their own, and peers still pinned to that old key will follow it. Rotation covers planned key changes. It doesn't recover from losing control of both the key and the host.
- **Private-network guard behind a proxy.** Without a proxy, and with `socks5://`, Studio resolves hostnames itself and refuses private addresses (`electron/security/networkGuard.ts`). With `socks5h://` or `http://`, the proxy resolves DNS, so Studio can only refuse literal private hostnames and IP addresses. A public hostname that points at a private address is then reached from the proxy's network. Behind Tor that's the exit's network, but a proxy on the user's own LAN can reach devices on it.
- **No causality or versions.** Entries have no version counter, vector clock or tombstone. Last write wins is only safe because each site is the sole author of its own entries. Multi-writer or relayed data would need one of these.
- **No `@context` on content documents.** Only the DID document is JSON-LD.

## Open questions

- Should a Webring Hub act as a second witness for keys and site moves (see [webring-hub.md](webring-hub.md#tier-2-the-hub-as-a-second-witness-for-trust)), and how is its evidence shown without the user mistaking it for verification?
- Which CRDT (if any), and for which data? Most data has a single author, so per-author logs may be enough.
- A JSON-LD `@context` for `items` and `albums`, and how it maps onto ActivityStreams types (`Note`, `Like`, `Announce`, `Image`).
- How a did:web site maps onto an ActivityPub actor (inbox/outbox) without needing a running server.
- Should Studio fetch friends' monthly archives and check them against the SHA-256 listed in `items.json`? Today the crawler reads only the recent `items.json`, so Studio itself never uses those hashes.
- Could a move to a new domain (`movedTo`) be a signed statement like a rotation certificate, issued with the old site's key?
