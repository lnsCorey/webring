# Webring Hubs

How Webring Studio uses an optional Webring Hub (`webring-hub-php`, the PHP + MySQL edition) without giving up the static-site, local-first model in `CLAUDE.md`. Read [federation.md](federation.md) first. This document covers the rules, what exists today, hub extensions, the decisions behind it, and what's planned.

Naming: this server was called a "Webring Directory" before it was renamed to Webring Hub, because extensions let it do more than search. In this document "hub" always means a Webring Hub. It is unrelated to a ring's *ring file* (`api/rings/<slug>.json`, its signed member list), which ring code still calls the ring's "hub" (`hubUrl`, `WebringHubDocument`, `publishWebringHub`).

## What a Webring Hub is

A hub is a **third-party server that indexes published Webring sites**, the way a search engine indexes web pages. It fetches a site's signed static files (`/api/manifest.json`, `did.json`, `/api/profile.json`), verifies them, and offers search over what it found. Anyone can run one, and a site can be listed in several.

The hub sits **outside the artifact**. The published site never calls it, links to it or depends on it. Studio's engine talks to it as an optional client, in the same way it crawls friends.

```
                      ┌───────────────── engine (Studio, local) ─────────────────┐
 hub       ◀─search───┤ WebringHubService ──hints──▶ Add Friend form ──▶ crawl   │
   │      ◀─list/ping─┤        │                                       + verify  │
   │                  │        └── local_settings.webringHubsJson (per persona)  │
   │                  └──────────────────────────────────────────────────────────┘
   └──crawl+verify──▶ published static site (/api/*.json, did.json)
```

## Rules

These are the boundaries any hub feature has to keep. They follow from the [rules for future sync layers](federation.md#rules-for-future-sync-layers).

1. **A hub gives hints, never truth.** What it returns (a site address, a name, later a key) only leads Studio to a site. Studio always fetches, verifies and pins the site itself, from the site. Search results are shown and thrown away. They are never written to the persona database and never reach `buildSignedSiteBundle()`.
2. **Nothing hub-shaped is published by default.** The published site has no hub widgets or calls. If one is ever offered (a live search box, a "listed in" badge that loads anything), it's an opt-in add-on, off by default, like analytics. A plain static link the user types themselves is just content.
3. **Opt-in, per persona.** Adding a hub lists nothing. Listing a site tells the hub the site exists, so it's a publishing decision the user makes per hub. Hub settings live in that persona's `local_settings` and are never exported or shared between personas.
4. **Studio pings, the hub pulls.** After a publish, Studio may ask a hub to re-read the site. It never uploads content. The hub still fetches and verifies the signed static files on its own.
5. **Same network rules as crawling.** Hub requests use the persona's proxy and the crawler's private-network guard (`requestPublicJson` in `electron/services/ringCrawler.ts`), are https only (http only with `WEBRING_ALLOW_PRIVATE_PEERS=1`), and have the same size limit and timeout. POSTs are never retried and never follow redirects.
6. **The private key stays in the engine.** Self-service removal is signed inside Studio, and only the signature is sent.

## What exists today (Tier 1)

### Studio

- **`WebringHubService`** (`electron/services/webringHubService.ts`), on every persona context as `ctx.webringHubService`.
  - `add(url)`: checks the address answers `GET /api/info` with a title, then stores it as `{ url, title, listMe: false, state: 'not-listed' }`. Up to 10 per persona.
  - `remove(url)`: forgets a hub. Refused while the site is listed there, so a listing is never left behind.
  - `search(url, query)`: `GET /api/entries?q=`. Each result is checked and trimmed before it's shown:
    - entries whose `did` isn't the did:web of their own `siteUrl` are dropped;
    - non-https sites are dropped;
    - blocked sites are dropped;
    - an avatar is kept only if it's https and on the entry's own site (no third-party trackers in the Studio window);
    - each result is tagged `self`, `friend`, `muted` or `none`.
  - `listSite(url)`: `POST /api/entries { siteUrl }`. Refused until the site has a real address and has been published, because the hub reads the published files.
  - `unlistSite(url)`: gets a nonce (`GET /api/nonce`), signs `{ action: 'remove', siteUrl, did, nonce, createdAt }` with the persona key (`signWebringHubPayload`: Ed25519 over `canonicalizeJson`, base64url, matching the hub's `Verify::verifyPayloadSignature`), and posts it to `/api/entries/:did/remove`. A 404 counts as already removed.
  - `markPublished(manifestUpdatedAt)` and `flushPendingPings()`: see Pings below.
- **Storage.** `WebringHubRecord[]` in `local_settings` under `webringHubsJson` (`getWebringHubs` / `saveWebringHubs` in `electron/db/database.ts`). It holds hub addresses and listing state only, never search results. Settings saved before the rename under `directoriesJson` are moved to `webringHubsJson` the first time they're read (`migrateLegacyWebringHubsSetting`; the old key is deleted, and an existing new key is never overwritten).
- **Pings.** `publishTo` in `electron/services/jobs.ts` (shared by the buttons, MCP and the scheduler) calls `markPublished` after every successful publish. That records, for each hub where `listMe` is on, the `updatedAt` of the manifest just published (`pendingPingFor`). `flushPendingPings` then reads the live `/api/manifest.json` (with a cache-busting query). Only when the live copy is at least that new does it call `POST /api/entries/:did/refresh`. Hosts like GitHub Pages take minutes to show a publish, so a waiting ping is retried:
  - straight after the publish;
  - by main-process follow-ups 2, 6 and 15 minutes later (`scheduleWebringHubFollowUp` in `electron/main.ts`, serialised with the persona's other jobs). Every publish path schedules them: the Publish tab, guided setup, the scheduler, and the MCP `webring_publish` tool (through `McpAppServices.onPublished`);
  - at the end of every Sync All (`runSyncAll`, the Sync button and the MCP `webring_crawl_all_friends` tool).

  A ping still waiting after 24 hours is dropped with a note. Outcomes:
  - 200: `lastPingAt` is set.
  - 404: the operator removed or blocked the listing. `listMe` turns off and Studio does **not** re-submit; the user can list again by hand.
  - 409 `key_changed`: `state: 'key-changed'`.
  - Network errors leave the ping pending.

  Pings never fail a publish or a sync.
- **UI.** `src/studio/WebringHubPanels.tsx`:
  - **Webring Hubs** in the Publish tab: add or remove a hub, a "List my site" switch, listing state, last re-read, and errors.
  - **Find People in a Webring Hub** in the Friends tab: search and **Use in Add Friend**. That fills in only the site address and a display name the user can edit. The avatar and bio come from the site itself after the normal crawl, never from the hub.
- **IPC and MCP.**
  - IPC: `studio:webring-hub-list|add|remove|search|set-listed`.
  - MCP tools: `webring_hubs` (list/add/remove), `webring_search_hub`, `webring_set_hub_listing`, and `webring_check_key_with_hubs` (see [Extensions](#extensions)).
- **Tests.** "Webring Hubs" in `tests/federation.test.ts`, against a fake hub that checks removal signatures the way the PHP code does.

### Hub (webring-hub-php)

- **Key pinning.** The first key a hub sees for a site is pinned in `entries.public_key_pem`. `Database::upsertEntry` used to overwrite it on every refresh. It now accepts a different key only:
  - through a verified rotation chain from the pinned key, using the `keyRotations` certificates the site publishes in `did.json` (`Verify::verifyKeyRotationChain`, a port of Studio's `verifyKeyRotationChain`); or
  - when the operator explicitly accepts it (`POST /api/admin/entries/:did/trust-key`).

  Otherwise every path that re-verifies a site (submit, refresh, admin refresh, cron) fails with 409 `key_changed` and the listing keeps the old key. The cron records it as a failure, so the entry goes `stale` after 7 failed checks. Without this, whoever took over a domain would also take over its listing and its signed self-removal.

## Extensions

New hub features are built as **extensions**, not added to the hub's core. That lets third parties build on the hub while the core stays small: verification, key pinning, search, listing and removal. The author guide is [webring-hub-php/docs/extensions.md](../../../webring-hub-php/docs/extensions.md).

### How they work on the hub

- An extension is a folder in `extensions/<id>/` holding an `extension.json` manifest and a class that implements `WebringHub\Extension`. The operator installs it and turns it on by listing its id in `config['extensions']`.
- It registers routes under `/api/ext/<id>/v<n>/`, its own tables (`ext_<id>_*`), and listeners for core events:
  - `entry.verified`
  - `entry.key_rejected`
  - `entry.removed`
  - `entry.status_changed`
  - `cron.refresh`
- All of this goes through `ExtensionContext` (`src/Extensions.php`).
- Every core change to an entry goes through `src/Entries.php`, so events fire consistently. They fire after the core commits, and a failing listener is logged and ignored.
- `/api/info` lists the extensions that loaded (`extensions: [{ id, version, apiVersion }]`), and `GET /api/admin/extensions` shows load errors.

### Rules

These are added to the six rules above:

7. **Off by default.** A folder does nothing until the operator lists it.
8. **Hints, not truth, still.** Extension output is evidence. Studio shows it and throws it away, never stores or publishes it, and never lets it replace a key Studio pinned.
9. **Data only from verified sources.** Data comes from core events, which fire after verification, or from guarded fetches. Extensions never accept content uploads.
10. **Own namespace.** Extensions never write to core tables.
11. **The listed person's choices win.** On `entry.removed` an extension deletes everything it holds for that site. It doesn't serve blocked or stale entries.
12. **Studio never runs extension code.** Studio has a built-in client for each `id` and `apiVersion` pair it knows (`KNOWN_WEBRING_HUB_EXTENSIONS` in `webringHubService.ts`). Other extensions appear only as names in the Publish tab.

**Trust model:** PHP can't sandbox code it loads, so an enabled extension has the hub's full access. The allowlist, manifest and host API make extensions reviewable, but they aren't a security boundary. Operators should enable only code they trust.

### How Studio uses them

- `WebringHubRecord.extensions` and `infoCheckedAt` cache what `/api/info` advertised. They're filled in by `add()`, and re-read by `refreshStaleInfo()` when older than a day (when the hub list loads, and before a key check). This is metadata about the hub, not about anyone listed in it.
- `webringHubSupports(record, id)` is true only for a known id at the API version Studio speaks.
- The Publish tab shows each hub's extensions as badges.

### key-witness (first extension)

The Tier 2 "cross-check" and "key history" items, built as an extension.

- **Hub:** `extensions/key-witness/` records each key it sees for a site:
  - `first-seen`;
  - `rotated` (through a verified rotation chain);
  - `operator-accepted`;
  - `rejected` (refused by the core).

  It serves them at `GET /api/ext/key-witness/v1/keys/:did`, for active entries only, and deletes a site's history when the site leaves.
- **Fingerprint:** SHA-256 over the SPKI DER bytes, hex (`Verify::spkiFingerprint` and `publicKeyFingerprint` in `webringHubService.ts`). Both sides test the same fixed vector.
- **Studio:** `WebringHubService.checkKeyWithWebringHubs(friendSiteUrl)`:
  - fingerprints the key pinned in `site_keys`;
  - asks **only** the hubs that advertise key-witness v1 (the others aren't told which site is being checked);
  - drops any answer that names a different DID.

  Each answer is reported as one of:
  - `match`
  - `mismatch`, with how the hub accepted its current key and whether it ever saw the pinned key
  - `not-listed`
  - `error`

  Nothing is stored and the pinned key never changes. The **Check with Webring Hubs** button on a friend card (highlighted when `keyStatus === 'changed'`) and the MCP tool `webring_check_key_with_hubs` both use it. The UI wording frames each hub as one more observer and tells the user to confirm a new key with their friend.

## Decisions

| Decision | Why |
| --- | --- |
| Search results are never stored. | The strictest way to keep "hints, not truth": no table to forget to filter, nothing to leak into the export. A friend added from a result goes through the normal add, crawl, verify and pin path. |
| "Use in Add Friend" copies only the address and name. | The avatar and bio a public friend shows in `connections.json` must come from that friend's own verified site, not from a third party. The name is shown in an editable field, so it's the user's own choice, the same as typing it. |
| Listing needs a publish first. | The hub verifies the live signed files. Listing before they exist only produces an error on the hub's side. |
| Pings wait for the live site. | A ping before the host shows the new files makes the hub re-read old content and wastes its rate limit. Checking the live manifest's `updatedAt` reuses the same signal as the guided setup's live check. |
| A 404 on refresh turns listing off and doesn't re-submit. | It means the operator removed or blocked the entry. Quietly re-listing would override their moderation. |
| A hub can't be removed while the site is listed in it. | Forgetting it would leave a listing Studio no longer knows about and can't sign a removal for. |
| Hubs are local per persona, like the proxy setting. | Which hubs a persona uses is private and mustn't link personas together. |
| Hub calls go through the crawler's guard and the persona's proxy. | Same exposure as crawling, so the same protections. A hub address is user-supplied and could point at a LAN device. |
| The hub pins keys and follows rotation chains. | Pinning is required before a hub can act as an independent witness for keys (Tier 2), and it closes a hijacking hole on its own. |
| The hub's operator, not Studio, accepts a key change that has no certificate. | Matches Studio's own model: losing the old key means confirming the new one some other way. |
| New hub features are extensions, not core changes. | Third parties can build on the hub, operators choose what runs, and the security-critical core (verification, pinning, removal) stays small and reviewable. |
| Extensions are modules the operator installs and runs in the same PHP process, not separate services. | Hubs run on shared hosting with no way to run extra services. Features like key history need the hub's own verified observations, which an outside service can't see. |
| Extensions run only from an allowlist, with no pretend sandbox. | PHP can't isolate loaded code. Being honest about that (operators enable only trusted code) is safer than a boundary that doesn't hold. |
| Events fire after the core commits, and listener errors are swallowed. | An extension can't block, undo or corrupt a listing, a removal or a key decision. |
| Extensions delete a site's data on `entry.removed`. | Leaving a hub has to mean leaving all of it, extensions included. |
| Studio speaks only to extensions it knows, by `id` and `apiVersion`. | Studio never downloads or runs third-party code, and a changed extension API can't make Studio misread an answer. |
| The key check asks only hubs that advertise key-witness. | Asking a hub about a site tells it whom you're interested in, so only hubs that can answer are asked. |
| Key-witness compares SPKI DER fingerprints, not PEM text. | PEM wrapping and line endings vary between implementations, but DER bytes don't. |
| Key-check answers are shown, never stored. | Rule 1. A hub's view can add doubt or confidence, but trust decisions stay with the user and the key Studio pinned itself. |

## Not done yet

The remaining roadmap is mostly extensions now. The ranked, step-by-step plan for these and the other open items is in [docs/superpowers/plans/2026-11-14-todo-roadmap.md](../superpowers/plans/2026-11-14-todo-roadmap.md).

| Item | Where it lives | Status |
| --- | --- | --- |
| Key history and cross-check | `key-witness` extension | **Done** (on demand from a friend card) |
| Automatic cross-check when Studio first pins a friend | Studio, using `key-witness` | Planned |
| Domain moves (`movedTo`) | `site-moves` extension | Planned |
| Ring discovery | `ring-index` extension | Planned |
| Signed static snapshot (Tier 3) | `snapshot` extension | Planned |
| Key pinning, canonicalization test vectors | Hub core | Pinning done; shared vectors planned |
| Delegated inbox | — | Deferred |

### Tier 2: the hub as a second witness for trust

A hub runs all the time and fetches from a different place on the network than the user does. That makes it useful for the gaps listed in [federation.md](federation.md#known-gaps-before-p2p-or-activitypub), provided rule 1 holds: it adds evidence, the user decides.

- **Automatic cross-check on first use.** Today the key check is run on demand. Next, when Studio first pins a friend's key it could ask key-witness hubs at the same time and flag a mismatch, which would suggest a spoofed or tampered first fetch. It should be a notice the user can act on, not an automatic refusal.
- **Domain moves (`movedTo`), as `site-moves`.** A signed move statement, made with the old site's key like a rotation certificate, needs somewhere to live once the old domain is gone. The extension would accept a statement only when it verifies against the key the hub pinned for the old site. Friends and ring members could then follow the move. This addresses the two "Not yet supported" items under Webrings.
- **Ring discovery, as `ring-index`.** Index the rings that sites list in their verified `connections.json`, and the ring files of hosted rings, so rings can be browsed from Studio. The join request itself stays out-of-band. The extension would fetch and verify `connections.json` itself, using `fetchJson` and the pinned key.

Signing key-witness answers with the hub's own did:web key fits naturally with the snapshot work below.

### Tier 3: a signed static snapshot, as `snapshot`

The hub publishes signed `entries.json` (and rings) documents under its own did:web, which it already has. Studio reads them like any other peer: pull, pin on first use, fingerprints and 304s. No new trust path is needed. Search still needs the live API, but browsing and the Tier 2 checks could then run entirely on static files.

### Deferred: a delegated inbox

A hub could hold ring join requests and friend notices for people who aren't online. That partly answers the open question of an ActivityPub-style inbox without running a server. But it puts private messages on a third-party server. If it's built, messages must be encrypted to the recipient's key and treated as unverified until checked against the sender's pinned key. Not planned.

### Shared canonicalization test vectors

The hub's `Verify::canonicalizeJson` copies Studio's own key-sorting canonicalization, which is not JCS (see [Known gaps](federation.md#known-gaps-before-p2p-or-activitypub)). Having two independent implementations is useful: a shared set of test vectors (documents, keys, expected signatures) checked by both the TypeScript and PHP code would make a later move to JCS or a real Data Integrity suite much safer.
