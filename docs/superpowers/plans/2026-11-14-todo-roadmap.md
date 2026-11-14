# To Do plan: Webring Studio and Webring Hub

*Written 2026-11-14. Covers both `webring studio` and the hub server (`webring-directory-php`, being renamed to `webring-hub-php`).*

This lists every open item from the Webring Hub work, ranked by **value added**: how much each one protects users, unblocks other work or improves the product, weighed against its effort and risk. Each item has its goal, steps, the files involved and how to check it's done.

## Where things stand

**Done:**
- Webring Hub support in Studio:
  - search hubs from the Friends tab
  - list or unlist your site, with unlisting signed by your site key
  - ping hubs after a publish, with retries
  - key pinning on the hub
  - hub extension badges
  - **Check with Webring Hubs** on friend cards
  - MCP tools for all of this
- The hub's extension framework, plus the `key-witness` extension.
- The hub's `/admin` page and `GET /api/admin/entries`.
- The rename from Webring Directory to Webring Hub across both projects, with the old names still accepted.
- MCP publishes now schedule hub pings, and the MCP Sync All tool now pings hubs.
- Fixes on the hub server:
  - the backslashes in `extension.json`
  - SQLite search
  - `did.json` routing under `php -S`
  - `sign-request.js` no longer needs any other files
- PHP 8.3 is set up locally, the smoke test passes, and the hub was tested end to end against Studio on `127.0.0.1:8080`.
- READMEs and the in-app Help (**8. Webring Hubs**) are updated.

**Corrections to earlier notes:**
- The hub folder *is* a git repo (`origin` is `lnsCorey/webring-directory-php`). It has uncommitted changes.
- The PHP code *has* been run, locally.
- `config.php` reads its extension list from `HUB_EXTENSIONS`, which falls back to `DIRECTORY_EXTENSIONS`. If neither is set, no extensions are on.

## Ranking

| Rank | Item | Value | Effort | Owner |
|---:|---|---|---|---|
| 1 | Commit both repos | Critical: protects all of this work | XS | Claude, when asked |
| 2 | Deploy the hub to Hostinger | Critical: nothing reaches users until it's live | S | You |
| 3 | Check the hub features in the running Studio | High: the UI has only been tested through tests and MCP | S | You and Claude |
| 4 | Shared canonicalization test vectors | High: prevents silent signature breakage between projects | S | Claude |
| 5 | Automatic key cross-check on first pin | High: closes a real trust gap with existing parts | M | Claude |
| 6 | Fix the Windows test failures and the flaky test | Medium-high: a clean test run to trust later changes | S | Claude |
| 7 | `site-moves` extension | Medium-high: lets sites move domains without losing friends and rings | L | Claude |
| 8 | `ring-index` extension | Medium: helps people discover rings | M–L | Claude |
| 9 | `snapshot` extension and signed key-witness answers | Medium: browsing without the live API, stronger evidence | L | Claude |
| 10 | Rename the folder (and maybe the repo) to `webring-hub-php` | Low-medium: consistency | XS | You and Claude |
| 11 | Update Codemancer's Chronicle VII | Low: public wording | XS | Claude via MCP |
| 12 | Rename the "AI Agent & MCP Automation Hub" tab | Low: avoids a third, unrelated "hub" | XS | Claude |
| 13 | Fix php.ini line 1940 | Low: local machine only | XS | You |
| — | Delegated inbox | Deferred on purpose | — | — |

Effort: XS is under 30 minutes, S a couple of hours, M about a day, L several days.

---

## 1. Commit both repos

**Why first:** two sessions of work across about 45 files exist only on this disk.

**Steps**
1. **Studio** (branch `docs/federation-update`):
   - Run `npm test` (expect only the known Windows failures, item 6) and both type checks.
   - Commit in logical chunks:
     1. the hub service and its tests
     2. the UI panels and Help
     3. the MCP fixes
     4. the docs
   - Open a PR to `main`.
2. **Hub** (`main`, with 26 modified and 2 new files): run `php scripts/smoke-extensions.php` and `php -l` on the changed files, then commit. Check that `config.php` isn't staged: it's in `.gitignore` and holds real credentials.
3. Push when you're ready.

**Done when:** `git status` is clean in both repos and the branches are on GitHub.

## 2. Deploy the hub to Hostinger

**Why:** the admin page, key-witness, and the search and routing fixes exist only locally.

**Steps** (from the hub README, [Upgrading an existing install](../../../../webring-directory-php/README.md#upgrading-an-existing-install)):
1. Back up the MySQL database and the server's `config.php`.
2. Upload everything **except `config.php`**, including `.htaccess`, `admin.js` and `src/templates/admin.html`.
3. In the server's `config.php`, add `admin_token` (from `openssl rand -hex 32`) and `'extensions' => ['key-witness']`.
4. Run `php scripts/smoke-extensions.php` over SSH, or with a one-off cron job.
5. Check that:
   - `/api/healthz` responds
   - `/api/info` lists `key-witness`
   - you can sign in to `/admin` and the Extensions panel shows key-witness loaded
   - `/api/ext/key-witness/v1/keys/<a listed did>` returns a `first-seen` record
6. Confirm the refresh cron job still runs `scripts/refresh.php`.

**Done when:** the live hub at `directory.lines2code.com` passes step 5, and Studio shows the **Key witness** badge for it.

## 3. Check the hub features in the running Studio

**Why:** the panels, badges and Help were checked by type checks and tests, not by using them.

**Steps**
1. Restart Studio, so the new MCP tool names and IPC channels load.
2. Check:
   - the **Publish → Webring Hubs** panel (add, list, unlist)
   - **Friends → search** with **Use in Add Friend**
   - the extension badges
   - **Check with Webring Hubs** on a friend card
   - Help → **8. Webring Hubs**, and its FAQ item
3. Check that the saved setting moved from `directoriesJson` to `webringHubsJson`, and that the hub you saved before the rename still shows.
4. From an MCP client, call `webring_hubs` (`action: "list"`), then publish and confirm the ping reaches the hub (in its access log, or `updatedAt` changes).

**Done when:** each check passes, and anything broken is filed and fixed.

## 4. Shared canonicalization test vectors

**Why:** Studio (TypeScript), the hub (`Verify.php`) and `scripts/sign-request.js` each implement canonical JSON and `did:web` derivation separately. `sign-request.js` has already drifted once. A silent mismatch would break listing, removal and key checks for everyone.

**Steps**
1. Add `tests/fixtures/canonicalization-vectors.json` to Studio. Each case gives an input object, its canonical string, a fixed Ed25519 test key, and the expected signature, did:web and SPKI fingerprint. Cover:
   - nested objects, arrays of objects, and a dropped `proof`
   - Unicode and escaped characters
   - URLs with ports and paths
2. A vitest test runs the vectors through `src/shared/schema.ts`.
3. Copy the same file into the hub as `scripts/fixtures/canonicalization-vectors.json`. Have `scripts/smoke-extensions.php` run it through `Verify::canonicalizeJson`, `siteUrlToDidWeb`, `spkiFingerprint` and `verifyPayloadSignature`.
4. Add a `node --test` check that runs the same vectors through `sign-request.js`. This means exporting its helpers, or moving them to a small module next to it.
5. Document in both READMEs that the vectors must be updated in both places together.

**Done when:** both suites pass on the same file, and changing one byte of an expected value fails both.

## 5. Automatic key cross-check on first pin

**Why:** Studio trusts a friend's key the first time it sees it. If that first fetch was tampered with, nothing notices. Hubs running key-witness already fetch from somewhere else on the network.

**Steps**
1. In the friend crawler, when a key is pinned for the first time, queue `checkKeyWithWebringHubs` (`electron/services/webringHubService.ts`) without waiting for it.
2. Store the result as a notice on the friend:
   - `match`: nothing is shown
   - `mismatch`: a 🚨 banner with **Review**
   - `unknown`, or no witness hubs: nothing is shown

   The pinned key is **never** refused or changed automatically.
3. Add a per-persona setting, on by default only when the persona has at least one hub with key-witness. Send the requests through the persona's proxy.
4. Add an MCP field (`keyWitness` on the friend result), and a line in Help → 8.
5. Tests:
   - a mismatch raises the notice
   - a match is silent
   - no hubs means no requests
   - the pinned key is never changed

**Done when:** the tests pass, and a friend added while a key-witness hub is configured shows a check result without anyone clicking.

## 6. Fix the Windows test failures and the flaky test

**Why:** three tests always fail on Windows and one fails sometimes, so a real regression can hide among them.

**Steps**
1. **MCP HTTP settings file mode** (expects 600, gets 666): Windows ignores POSIX modes. Skip the mode check on `win32`, or assert through an ACL helper instead.
2. **Album card tests** (EPERM removing the temp folder): close the SQLite handles before cleanup, and use `fs.rm(dir, { recursive: true, force: true, maxRetries: 5 })`.
3. **The jitter test** fails under a full-suite run: inject a fake clock and random source, instead of asserting on real timing.

**Done when:** `npm test` passes cleanly 5 runs in a row on Windows.

## 7. `site-moves` extension

**Why:** today, moving to a new domain breaks every friend and ring link to you. This is the known "Not yet supported" gap in `federation.md`.

**Steps**
1. Write a spec: a `movedTo` statement signed with the old site's key, in the same format as a rotation certificate, giving the new URL and DID and the time.
2. In the hub, write `extensions/site-moves/`. It:
   - provides `POST v1/moves`, and accepts a statement only if it verifies against the key the hub pinned for the old site
   - provides `GET v1/moves/{did}`
   - stores the statement, which outlives the old domain
3. In Studio:
   - Add **Move my site…**, which signs the statement, publishes it on the old site while that still exists, and submits it to the hubs.
   - When a friend or ring member's site fails, or shows a `movedTo`, offer **Follow to new address**, which re-pins only when the new site's key matches or is properly rotated.
4. Tests on both sides, plus docs.

**Done when:** a test persona moves domains, and a friend follows it without a key warning.

## 8. `ring-index` extension

**Why:** rings can't be found today unless someone shares the link.

**Steps**
1. In the hub, write `extensions/ring-index/`:
   - On `entry.verified`, fetch and verify the site's `connections.json` and its hosted ring files (with `fetchJson` and the pinned key).
   - Index ring name, maintainer, member count and description.
   - Provide `GET v1/rings?q=`.
   - Drop the data when a site leaves.
2. In Studio, add a **Browse rings** search next to **Join a Webring**. Its results fill in the ring address, and joining still goes through the normal signed request.
3. Tests and docs.

**Done when:** searching a hub finds a ring hosted by a listed site, and joining it works as before.

## 9. `snapshot` extension and signed key-witness answers

**Why:** this lets Studio browse a hub, and check keys, from static signed files, the same way it reads any peer. It also makes key-witness answers verifiable. It depends on item 4.

**Steps**
1. Give the hub a signing key. It's stored outside the web root, and its `did.json` is published.
2. `extensions/snapshot/` writes signed `entries.json` (and `rings.json` once item 8 exists) on a cron job.
3. Key-witness answers are signed with the same key.
4. In Studio:
   - Pin the hub's key on first use.
   - Prefer the snapshot for browsing, and verify signed key-witness answers.
5. Tests and docs.

**Done when:** Studio can browse the hub with the live API turned off, and rejects a tampered key-witness answer.

## 10. Rename the folder (and maybe the repo) to `webring-hub-php`

**Steps**
1. Stop the local `php -S 127.0.0.1:8080` server.
2. `Move-Item webring-directory-php webring-hub-php`
3. Update the link in item 2 of this plan. `webring-suite.code-workspace` opens the whole suite folder, so it needs no change.
4. Restart the server from the new folder, then re-run the smoke test and the `healthz` check.
5. Optional: rename the GitHub repo, then run `git remote set-url origin git@github.com:lnsCorey/webring-hub-php.git`. GitHub redirects the old URL. Then update the link in Studio's README.

**Done when:** nothing refers to the old folder name, and the server and smoke test work from the new path.

## 11. Update Codemancer's Chronicle VII

Through the Studio MCP server, edit post `item-9e0764c8` so it says "Webring Hub". Keep the persona's voice, and add a line noting the rename. Then publish and check the live page.

## 12. Rename the "AI Agent & MCP Automation Hub" tab

Rename it to **"AI Agent & MCP Automation"**, and the button "Open AI Agent (MCP) Hub →" to match. These are text changes in `src/studio/App.tsx` only.

## 13. Fix php.ini line 1940

In the WinGet PHP 8.3 `php.ini`, change `curl.cafile` to `openssl.cafile` (same value). Run `php -m` to check that nothing warns.

## Deferred: delegated inbox

A hub could hold ring join requests and friend notices for people who are offline. That would put private messages on a third-party server, so it stays deferred. If it's ever built, messages must be encrypted to the recipient's key, and treated as unverified until checked against the sender's pinned key. See `docs/architecture/webring-hub.md`.
