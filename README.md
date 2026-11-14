<p align="center">
  <img src="images/logo-icon.png" alt="Webring Studio logo" width="128" height="128" />
</p>

# Webring Studio

A desktop app for running your own corner of the web: a personal profile site that you publish as plain static files, linked to friends' sites and to webrings, with no server, platform or account in the middle.

> [!WARNING]
> **Webring Studio is in active development.** Features, data formats and published file layouts may change between versions without migration paths, and some parts are untested outside the developer's machine. Don't rely on it as your only copy of anything you care about, and expect rough edges.

## Overview

Webring Studio is split into two halves:

- **The engine: this desktop app (Electron).** You write posts, manage photo albums, follow friends and run webrings here. It keeps everything in a local SQLite database, signs what you publish, and fetches your friends' sites when you sync.
- **The artifact: your public site.** Publishing produces a folder of static files (HTML, JSON and media) that you can host anywhere: GitHub Pages, any SFTP/FTP host, or a folder on your own server. Nothing on the public site needs a server-side runtime.

Sites talk to each other only through those static files. Each site publishes signed JSON (`/api/manifest.json`, `profile.json`, `items.json`, `albums.json`, `connections.json`), and its identity is a [`did:web`](https://w3c-ccg.github.io/did-method-web/) with an Ed25519 key. When you sync, Studio pulls your friends' JSON, checks the signatures, and builds your feed locally. Likes, replies and comments you make become signed entries on *your* site, which the other person's Studio picks up the next time it syncs.

Highlights:

- Profile, wall posts, threaded replies, likes, shares and photo albums
- Friends, with a private-by-default social graph and mute/block
- Curated webrings with Prev / Next / Random navigation
- Multiple **personas**, fully separated from one another
- Scheduled syncing and publishing, running from the menu bar
- An MCP server so AI agents can work with Studio for you
- Optional add-ons: Google Analytics, AdSense and GitHub-based comments (all off by default)

## Installation

There are no packaged releases yet; run Webring Studio from source.

**Requirements**

- **Node.js 22.13 or newer** (Node 24 recommended) and npm. `npm install` refuses older versions. Ubuntu and Debian's `apt` package is too old (Node 18), so install Node with [nvm](https://github.com/nvm-sh/nvm) instead:
  ```bash
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  # open a new terminal, then:
  nvm install 24
  ```
  The repo includes an `.nvmrc`, so `nvm use` inside the project folder switches to the right version.
- **Git**
- **Linux only:** a Secret Service keyring (GNOME Keyring, or KWallet on KDE) so Studio can encrypt your keys and passwords. Ubuntu's desktop includes one.

**Steps**

```bash
git clone https://github.com/lnsCorey/webring.git
cd webring
npm install
npm run build  
npm run dev          # builds the UI and app, then opens Webring Studio (the first run downloads Electron)
```

Studio opens with a short splash (under 3 seconds) while it starts up. It's skipped when Studio starts at login in the background, when a `webring://` link opens it, or with `--no-splash`.

The first launch creates an empty primary persona. Start by setting your site's address and name in **Profile & Identity**. Your data lives in the app's data folder:

- macOS: `~/Library/Application Support/webring-studio`
- Windows: `%APPDATA%\webring-studio`
- Linux: `~/.config/webring-studio`

**Troubleshooting**

- **`EBADENGINE` / "Unsupported engine":** your Node is too old. Check with `node -v`, run `nvm install 24 && nvm use 24`, delete `node_modules`, and run `npm install` again.
- **"N vulnerabilities" after `npm install`:** npm's audit report about the project's dependencies; it doesn't mean the install failed. **Don't run `npm audit fix --force`**: it upgrades packages across major versions and will break the app.

## Getting started

**The quick way: the setup wizard.** A new persona opens the setup wizard, which gets you from nothing to a live site in about 5 minutes:

1. It explains how Studio works: your computer holds the database and keys, and **Publish** copies signed files to your public site.
2. You enter your name.
3. **Sign in with GitHub:** Studio shows a short code and you approve it on github.com. There's no token to create. The sign-in is kept in your system keychain, only for this persona, and is never published.
4. **Create my site:** Studio creates a public `<username>.github.io` repository and sets your site address (`https://<username>.github.io`) and `did:web` identity. If that name is taken by another project, it suggests a different name instead of overwriting it.
5. **Publish:** your site is uploaded.
6. **Going live:** Studio waits for GitHub Pages and checks that your site is reachable and signed with your key.
7. **What's next:** Publish vs Sync, adding friends, and an optional one-click schedule.

You can close the wizard at any point and continue later from **Start setup** in the banner, or from the **Setup & Health** card on the Publish tab. That card stays useful afterwards: it flags a GitHub sign-in that stopped working, a site address that doesn't match the repository, or a site that's down.

> Sign in with GitHub needs the project's GitHub OAuth App client ID (built in, or set `WEBRING_GITHUB_CLIENT_ID` for a fork). Without one, the wizard walks you through creating an access token instead.

**Or set things up yourself:**

1. **Set up your profile.** In **Profile & Identity**, set your site's public URL (for example `https://yourname.github.io` or your own domain), name, bio and links. Your `did:web` identity comes from that URL.

   For the **profile photo** and **banner**, upload a JPEG or PNG from your computer (or drop it on the preview), pick a photo from one of your albums, or enter an image address. Uploads are resized, have camera and GPS data removed, and are published with your site. There's only ever one of each: a new one replaces the old, and a replaced upload is deleted, from Studio and from your host at the next publish.
2. **Add content.** Write wall posts, create albums and add photos. Wall posts are written in **Markdown** (links, **bold** and *italic*, headings, lists, quotes and tables), with a Write / Preview switch; they're rendered safely on your page, and HTML is never passed through. To change a post, like, share or comment later, use its **Edit** (pencil) button in **Posts, Likes & Shares**. It keeps the same address, so friends' likes and comments stay attached; your page marks it as *edited*, and friends get the new version at their next sync.
3. **Preview.** **Test Export & Preview** builds the site into a scratch folder and serves it on `127.0.0.1`, so you can check it in a browser before publishing.
4. **Publish.** In **Publish & SFTP**, export to a folder, upload over SFTP/FTP, or push to GitHub Pages. The Publish tab shows when you last published and whether anything has changed since. **View live site** opens your site with a fresh copy. Hosts often cache pages (GitHub Pages for up to 10 minutes), so a normal visit may show the old version briefly, but the page checks for new posts as it loads.
5. **Add friends.** In **Friends & Webrings**, add a friend's site URL, then **Sync All Friends**. Their posts appear in your **Neighborhood Feed**. To fix a friend's name, address, tags or note later, use the **Edit** (pencil) button on their card. Changing their site address resets their pinned key and clears posts synced from the old address. The feed shows **Friends only** by default; switch to **Everyone** to see your own posts and photos in the same timeline (with friends' replies threaded under them), or **Just me**.
6. **Join or start a webring** (see below), and **set a schedule** so syncing and publishing happen on their own.

**Right-click** any text box for Cut, Copy, Paste, Select All and spelling suggestions (with **Add to Dictionary**). Right-click selected text elsewhere to copy it, or a link to copy its address or open it in your browser.

The in-app **Help & Deploy Guide** tab has step-by-step guides for GitHub Pages, SFTP/FTP hosting, add-ons, webrings and MCP.

## How it works

### Personas

A persona is a separate online identity: its own SQLite database, Ed25519 key, `did:web`, media folder, friends, rings, publish settings and schedule. Nothing is shared between personas, and Studio warns you if two personas point at the same domain, since that would link them. Switch or create personas from the persona button in the top bar.

### Security and privacy

- Your signing key, SFTP/FTP password and GitHub token are encrypted with your operating system's keychain (Keychain on macOS, DPAPI on Windows, libsecret on Linux). Studio never shows them again after you save them, and only unlocks them to sign or to connect when publishing.
- Every document you publish is signed. Friends' keys are pinned the first time Studio sees them, and a changed key is flagged rather than trusted, unless the old key signed off on it (see [Changing your signing key](#changing-your-signing-key)).
- Friends are private by default: they aren't listed on your public site unless you mark them public.
- **Mute** hides a site from your feed. **Block** also stops crawling it and keeps its endorsements off your published site.
- When crawling, Studio refuses addresses on your own computer or local network, so a peer can't use it to probe devices behind your firewall.
- **Proxy or Tor, per persona.** On the Publish tab's **Schedule** card, a persona can route its syncing through a `socks5://`, `socks5h://` (Tor, for example `socks5h://127.0.0.1:9050`) or `http://` proxy. That covers syncing friends and rings, checking links people send you, saving a friend's post, and the friends' images and ring pages Studio shows. Publishing (SFTP/FTP, GitHub) and links you open in your browser still connect directly. The setting is stored only in that persona and never exported.
- **Schedule jitter.** Scheduled syncs and publishes can start at a random time up to 5, 15 or 30 minutes after their slot, so several personas on one computer don't contact hosts at the same moment and give away that they're linked.

#### Changing your signing key

- **Planned change:** **Rotate Signing Key…** in **Profile & Identity** makes a new key and has the old key sign a *rotation certificate* for it. The certificate is published in `did.json` and `manifest.json`, so after your next publish, friends move to the new key at their next sync with no warning. A certificate the old key didn't sign is ignored, and the friend still sees a key-changed warning.
- **Lost key:** if the keychain entry is lost, your old key can't be recovered or used to sign a certificate. You'd need a new key, and friends would see a key-changed warning.
- **When a friend's key changes without a certificate:** their card shows a 🚨 warning and **Trust New Key & Re-sync**. Use it only after you've confirmed with them some other way that they really lost their key.

### Site Design

The **Site Design** tab sets how your published page looks, with a live preview beside the controls:

- **Themes and templates:** four classic themes (Neo-Webring, Minimal Zine, Cyber Terminal, Cozy Scrapbook) change colours and fonts. Five social-style templates also rearrange the page, each echoing a familiar site without copying it:
  - **Facepace:** cover photo, an intro sidebar and a feed of post cards.
  - **Tweetdeck:** old-school sky blue, with every block in its own column.
  - **XtraSpecial:** a black timeline between a navigation rail and a widgets rail.
  - **Instapick:** a stats header, album highlights and a square photo grid.
  - **Tik Talk:** a dark vertical reel of tall media cards.

  Your blocks keep their order in every template. Friends, contact, links and the guestbook go in the sidebar or rail where a template has one. Each template offers a suggested block order you can apply with one click.
- **Look & feel:** accent colour (with a warning if it's hard to read on your theme), font, corner style, card or flat sections, background (theme, accent glow or blurred banner), banner height, profile photo shape and interactive extras.
- **Interactive extras** (on by default, in every theme and template): clicking a photo opens it full size, with previous/next (arrow keys or swipe) and its caption. **⤢ Open** shows a post in a larger view, and the address (`#post-…`, `#photo-…`) links straight to it. Tables in text blocks sort when you click a column heading. Like, Share, Comment, Add friend and Join ring first show a short note that the action happens in Webring Studio, with an **Open in Webring Studio** button and, for visitors without the app, the link to copy or share. Visitors can tick **Don't ask again on this site** to skip it. It's a few KB of built-in script with no library and nothing loaded from elsewhere. Turn it off in Site Design for a page with no extras.
- **Page layout:** your banner, photo, name, bio and links always stay at the top. Below them, arrange **blocks** by dragging (or with the arrow buttons): photo albums (grid or carousel, all or chosen albums), posts and shares (filter by kind, limit the count), friends, **text** (Markdown, including tables), an image, link buttons, a featured post or album, contact links and a guestbook. Hide a block without deleting it, rename its heading, or reset to the default layout.

Your design is saved in your signed `profile.json`, so it travels with your site. The published page and the preview come from the same code, so what you see is what gets published. Text blocks are rendered safely: HTML and unsafe links are never passed through.

**About the browser's "Open …?" prompt:** when a visitor confirms an action, the browser asks before opening Webring Studio. That prompt is part of the browser, so no page can change or skip it. Chrome and Edge offer **Always allow** for that site (on https pages). While you run Studio from source, the prompt names it "Electron", because browsers show the name of the program that registered `webring://`. An installed (packaged) build shows "Webring Studio".

### Media Library

The **Media Library** tab holds your photo albums. Add JPEG or PNG photos with **Add Photos** or by dropping them on an album, then caption them, add alt text, reorder them, pick a cover, or replace and delete photos.

Album descriptions are written in **Markdown** (headings, links, lists, quotes and tables), with a Write / Preview switch. They're rendered safely on your page: HTML and unsafe links are never passed through. Site Design text blocks use the same editor.

- **Post to feed and Card / Expanded:** each album has a **Post to feed** checkbox (off for new albums) that also announces it in your posts as "posted an album", and a **Card / Expanded** choice for Photos. Card shows the cover, title and photo count; Expanded shows every photo.
- **Album pages and link previews:** every album gets its own page at `albums/<name>/`, whose address is fixed when the album is created, so renaming it never breaks a shared link. Shared links show the album's cover and title as a preview.
- **What gets published:** a web copy of each photo (longest side up to 2048 px) and a 480 px thumbnail, rotated upright, with all camera metadata, including GPS location, removed. Your originals stay on your computer.
- **Signed album manifests:** each album is published with `media/albums/<album>/manifest.json`, signed with your key, listing every photo and the exact file behind it (URL, SHA-256 hash, size, dimensions). File names are based on the content, so a replaced photo gets a new URL and nobody sees a stale copy.
- **Publishing only sends changes:** to a local folder, SFTP/FTP or GitHub Pages, Studio uploads only new or changed files and removes photos you deleted. It only ever removes files it published itself; anything else on your server or in your repo is left alone. If files there were changed by hand, use **Re-upload everything at next publish**.
- **Friends see changes on their next sync:** replaced photos update, and removed ones disappear from their feed.

### Feed window, saved posts and older posts

History grows forever, so Studio keeps syncing small on both sides:

- **Your feed keeps a window.** On the Neighborhood Feed, **Keep** sets how long friends' posts stay: 1 week, 1 month, 3 months (the default), 1 year or forever. Older posts aren't synced and are cleared from your feed. Friends' likes and comments on *your* posts are always kept.
- **Albums are one card.** A friend's album appears as one card, with a **N new** badge when they add photos, never one entry per photo. Click it to open the album view, where you can like, share, comment or save the album or any photo. Albums a friend didn't post to their feed aren't shown; use **Albums ↗** on their card in Friends to open their Photos section.
- **Save what matters.** **☆ Save** on a friend's post or photo keeps a private copy under **Saved**, with a local copy of its image (re-encoded without metadata) and your own note. Saved posts stay after they leave your feed window or your friend removes them, and they're never published.
- **Unchanged files aren't downloaded.** Each friend's signed manifest lists a fingerprint for each of their files, so a friend with nothing new costs one small request. See [Syncing many friends](#syncing-many-friends).
- **You publish recent posts, with archives.** Your `items.json` holds the last 90 days of posts (at least your 50 newest). Older ones move to signed monthly archives (`api/archive/items-YYYY-MM.json`), so friends download less. `items.json` lists each archive's SHA-256, so a copy can be checked against your signed index. Your page lists them under **Older posts**, and each month loads when a visitor opens it. Studio itself still shows all your posts.

### Syncing many friends

Sync is built to stay quick with hundreds or thousands of friends:

- **16 friends at a time.** **Sync All** checks 16 friends' sites at once. While it runs, the status message shows a running count (for example *Syncing friends… 340 / 1000*), and the feed refreshes as posts come in.
- **One request when nothing changed.** Your signed manifest lists a fingerprint for each of your files. When a friend's manifest hasn't changed, or lists the same fingerprints as last time, Studio downloads nothing else from them. Publishing unchanged content produces byte-identical files, so a republish doesn't make friends download everything again.
- **Compressed downloads.** Studio asks for gzip/brotli, which cuts downloads about 5× on hosts that compress JSON (most do, including GitHub Pages).
- **Unreachable friends wait.** If a friend's site fails, Sync All skips it for 15 minutes, then 30, doubling up to a day, so dead sites don't slow every sync. Syncing that one friend from their card always tries, and a successful sync clears the wait.

**Expected sync times.** These come from the sync load test (`npm run loadtest:sync`), with a 150 ms round trip to each friend's host, typical for a host on another continent. Hosts nearer to you are faster: at 50 ms, times are about a third of these.

| Friends | First sync | Sync, nothing new | Sync, 20% posted | Download, nothing new | Download per month (hourly sync) |
|---:|---:|---:|---:|---:|---:|
| 100 | 8 s | 3 s | 3 s | 0.05 MB | ~40 MB |
| 250 | 20 s | 7 s | 8 s | 0.12 MB | ~100 MB |
| 500 | 40 s | 14 s | 16 s | 0.24 MB | ~200 MB |
| 1,000 | 1.3 min | 29 s | 31 s | 0.5 MB | ~390 MB |
| 2,000 | 2.7 min | 57 s | 63 s | 1 MB | ~0.8 GB |

- The first sync downloads everything: about 22 MB for 1,000 friends, each with 60 posts and 24 photos' details. (Photos themselves load from friends' sites when you view them.)
- When friends' sites are down, the first sync that finds them takes longer, since Studio waits up to 10 s for each. With 7% of 1,000 friends failing, that sync took about 55 s. The next one skips them and is back to about 27 s.
- Studio stays responsive while syncing. The longest pause measured was under 0.2 s, even at 2,000 friends.
- Before these changes, Studio checked friends one at a time and re-requested all six files. A 1,000-friend sync with nothing new took about 20 minutes and 6,000 requests. It now takes about 29 seconds and 1,000 requests.

For the **Sync friends & rings** schedule, every 15 minutes is fine up to around 1,000 friends. With more than that, hourly keeps each sync well inside its interval. The times above are estimates from a local test with network delay added, not measurements on real hosts. [tests/load/README.md](tests/load/README.md) explains how they're calculated and how to run the test yourself.

### Letting people know you added them

Studio has no server or inbox, so adding someone as a friend doesn't notify them. Instead:

- **Send a signed link.** **Let them know** on a friend's card makes a private `webring://friend-notice` link, signed with your key, to send however you like: **Copy Link**, **Copy Markdown**, or **Show QR Code** to scan from another device. Their Studio checks it's addressed to them, under 30 days old and signed by your site's key, then lists you under **Added you** with **Add back**, **Dismiss** and **Block**. Your site must be published first. Nothing is added automatically.
- **Mutual friends.** When you sync a friend whose signed, public friends list includes you, their card shows **↔ Mutual**.
- **People in your rings.** When rings sync, members whose public friends list includes you appear under **Added you**, even if you haven't added them yet. Studio only checks ring members (at most 200 per sync) and skips your friends and anyone blocked.

Private friends are never published, so they can't be discovered. "Added you" and Mutual status stay on your computer.

### Webrings

A webring is a circle of sites linked by **← Prev**, **Next →** and **Random**. Each ring has a **maintainer** who decides who's in it. Everything still runs on static files:

- The maintainer publishes a **signed member list** (the ring's *ring file*, `api/rings/<name>.json`) and a plain directory page (`rings/<name>/`). The page's address is the **ring address** people share and paste to join.
- **To join:** paste the ring address into **Join a Webring**. Studio verifies the ring and gives you a private, signed **request link** to send the maintainer however you like (as a link, Markdown or a QR code). Once they approve it and publish, your next sync makes you a member, and your next publish shows the ring's bar. Requests are never published.
- **To host:** create a ring under **Rings You Host**, share its ring address, and paste the request links people send you into **Review a Join Request** to approve, decline or ban. One persona can host several rings, separate from its friend list.
- **Leaving and removal:** if you remove a ring and publish, the maintainer's next sync drops you. If a maintainer removes, bans or closes a ring, members' Studios pick that up on their next sync. Maintainers can also hide a member from Prev/Next/Random without removing them.
- **Navigation:** Prev/Next are written into your page when you publish. When a visitor clicks them, the page re-reads the ring file so removed sites are skipped, falling back to the saved link if that fails.

Studio only trusts a ring file signed by its maintainer's key, served from the maintainer's own site, and never older than the last copy it saw. A key change or an unsigned ring file can raise a warning but never removes anyone.

### Webring Hubs

A Webring Hub is an optional website that lists Webring sites so people can find each other, and can offer more through extensions. Anyone can run one. Studio works fine without them, and your site never depends on one.

- **Add a Webring Hub** in the **Publish** tab with its address. Adding it doesn't list you.
- **Find people:** in the **Friends** tab, search a hub and click **Use in Add Friend**. Studio then reads and checks that person's own site, exactly as if you'd typed the address. Search results aren't saved.
- **List my site** (optional, per hub): once your site is published, the hub reads and checks your signed files itself. Turning it off sends a removal request signed with your site's key.
- **Keeping your listing fresh:** after each publish, from the app, a schedule or an MCP agent, Studio waits until your live site shows the new version, then asks each hub that lists you to re-read it. If the host hasn't updated yet, Studio tries again after 2, 6 and 15 minutes and at every **Sync All**, and gives up after 24 hours. If a hub's operator removed or blocked your listing, Studio doesn't list you again.
- **Your key and the hub:** a hub pins your site's key the first time it lists you, the same way Studio pins friends' keys. **Rotate Signing Key…** keeps your listing, because the hub follows the signed rotation certificate. A key that changes without one is refused until the hub's operator accepts it, so whoever takes over your domain doesn't take over your listing.
- **Extensions:** hubs can offer extra features, shown as badges next to each hub. Studio refreshes each hub's list once a day. With the **Key witness** extension, the **Check with Webring Hubs** button on a friend card compares the key Studio pinned for that friend with the keys the hub has seen. That's useful when Studio warns that a friend's key changed. It's one more opinion, not proof: nothing is saved, and your pinned key isn't changed.

Webring Hub settings are kept per persona, go through that persona's proxy, and are never published.

**Running your own hub.** A hub is a separate project, [`webring-hub-php`](https://github.com/lnsCorey/webring-directory-php): a PHP 8.1+ and MySQL (or SQLite) server for ordinary shared hosting, with an operator page at `/admin` for reviewing, blocking and re-checking listings. Its README covers deployment. The design is in [docs/architecture/webring-hub.md](docs/architecture/webring-hub.md).

### Scheduling

In the **Publish** tab, the **Schedule** card sets two jobs per persona:

- **Sync friends & rings**, from every 15 minutes up to weekly
- **Publish if anything changed**, to your export folder, SFTP/FTP host or GitHub Pages, optionally syncing first

Each job can also add a random delay of up to 5, 15 or 30 minutes (**jitter**), so personas sharing a computer don't all run at the same moment.

Every persona with a schedule runs, even when it isn't the one you have open. Scheduled publishes are skipped when nothing has changed. Jobs run one at a time and never overlap a sync or publish you start by hand.

Schedules run while Studio is running. With **background mode** on (the default), closing the window leaves Studio in the menu bar / system tray so schedules keep going. Quit from the tray icon or with Cmd+Q. You can also have Studio **start at login**. If your computer was asleep or Studio was closed, each missed job runs once when it's back. Failures are recorded on the Schedule card and can raise a notification.

## Connecting an MCP agent

Studio includes a [Model Context Protocol](https://modelcontextprotocol.io) server, so an AI agent (Claude Code, Claude Desktop, Cursor, or your own scripts) can read and manage your personas, posts, friends, rings, schedules and publishing. The **AI Agent (MCP)** tab lists every tool and has a console for trying them.

**Guided setup by an agent.** The server tells agents about the `guided-setup` prompt, which walks a new user through signing in to GitHub, creating their site, publishing and checking it's live. It uses the same steps as the in-app wizard. The tools are `webring_get_setup_status`, `webring_github_login_start` / `webring_github_login_poll` (the user approves a code on github.com, and the agent never sees the token), `webring_setup_github_site`, `webring_publish` and `webring_check_live_site`. Signing in, creating the site and publishing need the live connection below.

**Webring Hubs from an agent.** `webring_hubs` lists, adds and removes hubs; `webring_search_hub` searches one; `webring_set_hub_listing` lists or unlists your site; and `webring_check_key_with_hubs` compares a friend's pinned key with what key-witness hubs have seen. `webring_publish` and `webring_crawl_all_friends` also notify hubs, as the app does.

There are two ways to connect.

**1. Live connection to the running app (recommended)**

While Studio is open, it serves MCP on `127.0.0.1` with a fixed port. This is the only route that can **publish**, since signing needs the keychain, and agent actions show up in the app immediately.

- In the **AI Agent (MCP)** tab, click **Copy SSE URL** (or **Copy HTTP URL**). The URL includes an access token.
- In your MCP client, add a server with transport **SSE** (or Streamable HTTP) and paste the URL.

Command-line agents can connect without the token. Clients that run inside a browser or an Electron window send an `Origin` header and must use the URL with the token; web pages are always refused. Treat the token like a password. To issue a new one, quit Studio, delete `mcp-http.json` from the data folder, and reopen it.

**2. Standalone stdio server**

This works even when Studio is closed. It can read, post, sync and edit schedules, but it **can't publish**.

```bash
npm run build:electron
```

Then configure your MCP client to run:

| Field | Value |
|---|---|
| Command | the full path to `node` (for example `/usr/local/bin/node`) |
| Arguments | `<repo>/dist-electron/electron/mcp/cli.js`, `--data-dir`, `<your data folder>` |

`npm run mcp` starts the same server from the terminal.

## Development

| Command | What it does |
|---|---|
| `npm run dev` | Build the UI and the Electron code, then launch the app |
| `npm run build` | Build both without launching |
| `npm run build:vite` / `npm run build:electron` | Build just the UI / just the Electron code |
| `npm test` | Run the test suite (Vitest, `tests/federation.test.ts`) |
| `npm run loadtest:sync` | Measure how syncing scales with 50–2000 friends ([tests/load/README.md](tests/load/README.md)) |
| `npx tsc -p tsconfig.json --noEmit` | Type-check the UI |
| `npx tsc -p tsconfig.electron.json --noEmit` | Type-check the Electron code |
| `npm run mcp` | Build and start the stdio MCP server |
| `node scripts/brand-dev-electron.mjs` | macOS: show "Webring Studio" and its icon in the Dock and app menu when running from source (runs automatically after `npm install` and before `npm run dev`) |
| `python3 scripts/generate-icons.py` | Regenerate every app icon and branded image from `images/logo-icon.png` (macOS) |

**No native modules.** Storage uses Node's built-in `node:sqlite`, available in Node 22.13+ (tests, stdio MCP server) and in Electron 45's bundled Node 24 (the app), so nothing is compiled during install. If `ELECTRON_RUN_AS_NODE=1` is set in your shell (some editors set it), `npm run dev` will fail to open a window; unset it first.

**Testing against local sites.** Studio refuses `http://` and local-network addresses for friends, rings and hubs. To test with a site or hub on `127.0.0.1` (for example `php -S 127.0.0.1:8080 index.php` in `webring-hub-php`), start Studio with `WEBRING_ALLOW_PRIVATE_PEERS=1` set. Never set it for everyday use.

**Project layout**

| Path | Contents |
|---|---|
| `electron/main.ts`, `electron/preload.ts` | App lifecycle, tray, IPC |
| `electron/editContextMenu.ts` | The right-click menu (Cut/Copy/Paste, spelling, link actions) |
| `electron/db/database.ts` | SQLite schema and queries, and the signed site bundle |
| `electron/services/` | Friend crawler, webrings, site generator, publisher, personas, scheduler, guided setup and GitHub sign-in (`setupService.ts`, `githubAuth.ts`) |
| `electron/mcp/` | MCP server (stdio CLI, and loopback HTTP/SSE) |
| `electron/security/` | Keychain encryption, private-network guard, SOCKS5/HTTP proxy for syncing and the Studio window |
| `src/shared/schema.ts` | Data schemas (zod), signing and verification, `did:web` |
| `src/studio/App.tsx` | The Studio UI |
| `src/studio/SiteDesignPanel.tsx` | Site Design: look & feel options and page layout blocks |
| `src/studio/SetupWizard.tsx` | The first-run setup wizard and the Setup & Health card |
| `src/studio/FriendEditor.tsx` | The inline editor for a friend's details |
| `src/studio/QrCodeSvg.tsx` | Copy Link / Copy Markdown / QR code for `webring://` links (built-in QR encoder) |
| `src/shared/markdown.ts` | Safe Markdown renderer for text blocks (also embedded in published pages) |
| `electron/services/webringHubService.ts` | Webring Hubs: search, listing, signed unlisting, pings after publish, key check |
| `src/studio/WebringHubPanels.tsx` | The Webring Hub panels in the Publish and Friends tabs |
| `docs/architecture/federation.md` | How federation, signing and webrings fit together |
| `docs/architecture/webring-hub.md` | Webring Hub design, extensions and roadmap |

`AGENTS.md` and `SPEC.md` describe the project's goals and conventions for contributors, human or AI.

## Legal

**Use at your own risk.** Webring Studio is experimental software provided **"as is", without warranty of any kind**, express or implied, including fitness for a particular purpose and non-infringement. To the maximum extent permitted by law, the authors and contributors are not liable for any loss or damage arising from its use. That includes lost or corrupted data, lost or leaked keys and credentials, content published by mistake, and charges or penalties from hosting providers or third-party services.

You are responsible for:

- **Backups:** keep your own copies of your data folder and anything you publish.
- **What you publish:** everything in your export is public. Check it before publishing, and make sure you have the rights to the text, photos and links you share.
- **Third-party terms:** your hosting provider (GitHub, your SFTP/FTP host) and any add-on you enable (Google Analytics, Google AdSense, Giscus/Utterances) has its own terms and privacy obligations. For example, analytics and ads may require a cookie notice or consent in your region.
- **Other people's data:** friends' content you sync stays on your computer, but treat it with the same care you'd want for yours.

### License

Webring Studio is free software, licensed under the [GNU General Public License v3.0 or later](LICENSE) (GPL-3.0-or-later). You may use, study, share and modify it. If you distribute it or a modified version, you must do so under the same license and make the source code available. See [LICENSE](LICENSE) for the full terms.

Your own content (profile, posts, photos and links) stays yours; the license covers the program, not what you write or upload with it.
