# Sync load test

Measures how Sync All's friend crawl (`RingCrawler.crawlAllFriends`) scales from 50 to 2000 friends, and reports where it crosses a set of budgets.

```sh
npm run loadtest:sync                      # 50, 100, 250, 500, 1000, 2000 friends (~8 min)
LOADTEST_SIZES=50 npm run loadtest:sync    # quick smoke run
```

It isn't part of `npm test`. Results print as Markdown and are saved to `tests/load/results/` (gitignored) as `.md` and `.json`. Keep a JSON baseline so changes to sync can be compared.

## How it works

- `peerFleet.ts` builds N synthetic friend sites in memory. Each has its own Ed25519 key and signed `manifest`, `did`, `profile`, `albums`, `items` and `connections` documents. Every document is parsed with its schema as it's built. Some items like or comment on the syncing persona's posts (endorsements), and some sites list the persona back ("Mutual").
- `fleetServer.ts` serves them from one local HTTP server at `http://127.0.0.1:PORT/p/NNNN`, the way a static host would: ETag, Last-Modified and 304 for conditional requests. It counts requests, 304s and body bytes for each document.
- `syncLoad.load.ts` gives each size a fresh persona database and runs the real crawler over real HTTP (`WEBRING_ALLOW_PRIVATE_PEERS=1`) in four scenarios:
  1. **cold**: first sync, nothing cached.
  2. **warm, unchanged**: nothing changed since the last sync.
  3. **warm, 20% posted**: a fifth of friends published one new post.
  4. **warm, 7% failing**: 5% of sites are unreachable and 2% answer HTTP 500.
  5. **warm, 7% failing again**: the next sync, where Sync All skips the failed sites until their backoff ends.

## Reading the numbers

- **Local wall / DB time / Max UI block** are measured. Max UI block is the longest event-loop stall, a stand-in for how long the Studio window would freeze (sync runs on Electron's main thread).
- **@50ms / @150ms / @300ms** are projections. The local server has no network delay, so these add the round trips back: (requests + 2 connection round trips per site) × RTT, plus 10 s (the crawler's timeout) for each unreachable site that was actually tried, divided by the concurrency (network waits overlap across sites; local work doesn't, so it's an upper bound). To measure real delays instead, set `LOADTEST_LATENCY_MS` (and `LOADTEST_DEAD_MODE=hang` for real timeouts). That's slow at large sizes.
- **Wire MB** is the body bytes sent (gzip, since the crawler asks for it and the server, like most static hosts, compresses JSON) plus about 500 bytes of headers per request. **Uncompressed MB** is the same without compression, roughly what a host that doesn't compress would send.
- **Failed / skipped**: friends whose sync failed, and friends Sync All skipped because of their backoff.
- **Monthly download** assumes an hourly scheduled sync, with 20% of friends posting once a day.

## Knobs

| Variable | Default | Meaning |
|---|---|---|
| `LOADTEST_SIZES` | `50,100,250,500,1000,2000` | Friend counts to test |
| `LOADTEST_ITEMS` | 60 | Items per friend's `items.json` |
| `LOADTEST_PHOTOS` | 24 | Photos per friend's `albums.json` |
| `LOADTEST_FRIENDS_PER_SITE` | 150 | Entries in each friend's `connections.json` |
| `LOADTEST_POSTING_FRACTION` | 0.2 | Share of friends who post between warm syncs |
| `LOADTEST_DEAD_FRACTION` / `LOADTEST_BROKEN_FRACTION` | 0.05 / 0.02 | Unreachable / HTTP 500 sites in the failing scenario |
| `LOADTEST_DEAD_MODE` | `reset` | `reset` fails fast and projects the timeout; `hang` waits for the real 10 s timeout |
| `LOADTEST_LATENCY_MS` | 0 | Real delay added to every response (turns projections off) |
| `LOADTEST_CONCURRENCY` | `SYNC_CONCURRENCY` (16) | Friends crawled at once; `1` reproduces the old sequential sync |

Budgets are at the top of `syncLoad.load.ts` (`BUDGETS`).
