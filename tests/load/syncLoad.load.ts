import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { monitorEventLoopDelay, performance } from 'perf_hooks';
import { StudioDatabase } from '../../electron/db/database';
import { RingCrawler, SYNC_CONCURRENCY, type CrawlSiteResult } from '../../electron/services/ringCrawler';
import { buildFleet, DEFAULT_FLEET_OPTIONS, mutateFleet, type DocumentKind } from './peerFleet';
import { FleetServer, HEADER_BYTES_PER_EXCHANGE, type DeadMode, type FleetServerStats } from './fleetServer';

/**
 * Sync load test: how Sync All's friend crawl scales with the number of friends.
 * Run with `npm run loadtest:sync` (see tests/load/README.md for the knobs).
 */

const env = (name: string, fallback: number) => (process.env[name] ? Number(process.env[name]) : fallback);
const SIZES = (process.env.LOADTEST_SIZES || '50,100,250,500,1000,2000').split(',').map(Number);
const LATENCY_MS = env('LOADTEST_LATENCY_MS', 0);
const DEAD_MODE: DeadMode = process.env.LOADTEST_DEAD_MODE === 'hang' ? 'hang' : 'reset';
const DEAD_FRACTION = env('LOADTEST_DEAD_FRACTION', 0.05);
const BROKEN_FRACTION = env('LOADTEST_BROKEN_FRACTION', 0.02);
const POSTING_FRACTION = env('LOADTEST_POSTING_FRACTION', 0.2);
const FLEET = {
  itemsPerSite: env('LOADTEST_ITEMS', DEFAULT_FLEET_OPTIONS.itemsPerSite),
  photosPerSite: env('LOADTEST_PHOTOS', DEFAULT_FLEET_OPTIONS.photosPerSite),
  friendsPerSite: env('LOADTEST_FRIENDS_PER_SITE', DEFAULT_FLEET_OPTIONS.friendsPerSite),
};
const PERSONA_SITE_URL = 'https://me.load.test';

/** Same as FETCH_TIMEOUT_MS in ringCrawler.ts: what each unreachable site costs a sequential sync. */
const FETCH_TIMEOUT_MS = 10_000;
/** A new HTTPS connection per friend site costs about 2 round trips (TCP + TLS 1.3). */
const CONNECT_RTTS_PER_SITE = 2;
const PROJECTED_RTTS_MS = [50, 150, 300];
/** Friends crawled at once; defaults to what Sync All uses. */
const CONCURRENCY = env('LOADTEST_CONCURRENCY', SYNC_CONCURRENCY);

const BUDGETS = {
  warmSyncSeconds: 120, // warm sync (nothing changed) at 150 ms RTT
  coldSyncSeconds: 600, // first sync at 150 ms RTT
  warmSyncMB: 5,
  maxLoopLagMs: 200, // longest the Studio main thread is blocked
  monthlyGB: 100, // hourly syncs, ~10% of a 1 TB/month cap
};

const TIMED_DB_METHODS = [
  'getFriends',
  'addOrUpdateFriend',
  'getSiteKey',
  'pinSiteKey',
  'upsertNetworkFeedEntry',
  'upsertEndorsement',
  'pruneFriendFeed',
  'pruneEndorsementsFrom',
  'pruneFeedOutsideWindow',
  'getFetchValidators',
  'setFetchValidators',
  'setFriendListsMe',
  'getModerationAction',
  'getProfile',
  'feedCutoffIso',
] as const;

type DbTimings = Record<string, { calls: number; ms: number }>;

/** Wraps the crawler's DB calls with timers. Nested calls count once in the total. */
function instrumentDb(db: StudioDatabase) {
  let depth = 0;
  let totalMs = 0;
  let timings: DbTimings = {};
  const target = db as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of TIMED_DB_METHODS) {
    const original = target[name].bind(db);
    target[name] = (...args: unknown[]) => {
      const start = performance.now();
      depth++;
      try {
        return original(...args);
      } finally {
        depth--;
        const ms = performance.now() - start;
        const entry = (timings[name] ||= { calls: 0, ms: 0 });
        entry.calls++;
        entry.ms += ms;
        if (depth === 0) totalMs += ms;
      }
    };
  }
  return {
    reset() {
      timings = {};
      totalMs = 0;
    },
    read() {
      return { totalMs, timings };
    },
  };
}

interface ScenarioResult {
  friends: number;
  scenario: string;
  wallMs: number;
  dbMs: number;
  dbTop: Array<{ method: string; calls: number; ms: number }>;
  maxLoopLagMs: number;
  p99LoopLagMs: number;
  peakRssDeltaMB: number;
  sqliteMB: number;
  friendsOk: number;
  friendsFailed: number;
  /** Skipped by Sync All's backoff because recent syncs couldn't reach them. */
  friendsDeferred: number;
  /** Unreachable sites actually tried (each costs a timeout on a real network). */
  deadAttempts: number;
  /** Failure messages (site-specific parts removed) and how often each happened. */
  errors: Record<string, number>;
  itemsIndexed: number;
  endorsementsFound: number;
  server: FleetServerStats;
  wireBytes: number;
  projectedSeconds: Record<number, number>;
}

function sqliteBytes(db: StudioDatabase): number {
  return ['', '-wal'].reduce((n, suffix) => {
    try {
      return n + fs.statSync(db.dbPath + suffix).size;
    } catch {
      return n;
    }
  }, 0);
}

async function runScenario(
  label: string,
  friends: number,
  crawler: RingCrawler,
  db: StudioDatabase,
  server: FleetServer,
  timer: ReturnType<typeof instrumentDb>
): Promise<ScenarioResult> {
  server.resetStats();
  timer.reset();
  const lag = monitorEventLoopDelay({ resolution: 10 });
  const rssStart = process.memoryUsage().rss;
  let rssPeak = rssStart;
  const sampler = setInterval(() => (rssPeak = Math.max(rssPeak, process.memoryUsage().rss)), 100);
  lag.enable();
  const start = performance.now();
  const results: CrawlSiteResult[] = await crawler.crawlAllFriends({ concurrency: CONCURRENCY });
  const wallMs = performance.now() - start;
  lag.disable();
  clearInterval(sampler);
  rssPeak = Math.max(rssPeak, process.memoryUsage().rss);

  const stats = server.stats;
  const { totalMs, timings } = timer.read();
  const ok = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success && !r.deferred);
  const contacted = results.filter((r) => !r.deferred).length;
  // In reset mode a dead site fails fast; on a real network it would wait out the timeout
  const deadAttempts = failed.filter((r) => /socket hang up|ECONNRESET|Timed out/.test(r.error || '')).length;
  const projectedSeconds: Record<number, number> = {};
  for (const rtt of PROJECTED_RTTS_MS) {
    // Measured local cost, plus round trips and timeouts the local server didn't have, which
    // overlap across concurrent sites (local work doesn't, so this is an upper bound)
    const network =
      LATENCY_MS > 0
        ? 0
        : (stats.requests + contacted * CONNECT_RTTS_PER_SITE) * rtt +
          (DEAD_MODE === 'reset' ? deadAttempts * FETCH_TIMEOUT_MS : 0);
    projectedSeconds[rtt] = (wallMs + network / CONCURRENCY) / 1000;
  }
  return {
    friends,
    scenario: label,
    wallMs,
    dbMs: totalMs,
    dbTop: Object.entries(timings)
      .map(([method, t]) => ({ method, ...t }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 4),
    maxLoopLagMs: lag.max / 1e6,
    p99LoopLagMs: lag.percentile(99) / 1e6,
    peakRssDeltaMB: (rssPeak - rssStart) / 1048576,
    sqliteMB: sqliteBytes(db) / 1048576,
    friendsOk: ok.length,
    friendsFailed: failed.length,
    friendsDeferred: results.filter((r) => r.deferred).length,
    deadAttempts,
    errors: failed.reduce<Record<string, number>>((acc, r) => {
      if (r.error) {
        const key = r.error.replace(/https?:\/\/\S+/g, '<url>');
        acc[key] = (acc[key] || 0) + 1;
      }
      return acc;
    }, {}),
    itemsIndexed: ok.reduce((n, r) => n + r.itemsIndexed + r.photosIndexed, 0),
    endorsementsFound: ok.reduce((n, r) => n + r.endorsementsFound, 0),
    server: structuredClone(stats),
    wireBytes: stats.bodyBytes + stats.requests * HEADER_BYTES_PER_EXCHANGE,
    projectedSeconds,
  };
}

const mb = (bytes: number) => (bytes / 1048576).toFixed(2);
const s = (seconds: number) => (seconds >= 120 ? `${(seconds / 60).toFixed(1)} min` : `${seconds.toFixed(1)} s`);

function scenarioTable(rows: ScenarioResult[]): string {
  const lines = [
    '| Friends | Scenario | Local wall | DB time | Max UI block | Requests | 304s | Failed / skipped | Wire MB | Uncompressed MB | @50ms | @150ms | @300ms | RSS +MB | SQLite MB |',
    '|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.friends} | ${r.scenario} | ${s(r.wallMs / 1000)} | ${s(r.dbMs / 1000)} | ${r.maxLoopLagMs.toFixed(0)} ms | ${r.server.requests} | ${r.server.notModified} | ${r.friendsFailed} / ${r.friendsDeferred} | ${mb(r.wireBytes)} | ${mb(r.server.rawBytes + r.server.requests * HEADER_BYTES_PER_EXCHANGE)} | ${PROJECTED_RTTS_MS.map((rtt) => s(r.projectedSeconds[rtt])).join(' | ')} | ${r.peakRssDeltaMB.toFixed(0)} | ${r.sqliteMB.toFixed(1)} |`
    );
  }
  return lines.join('\n');
}

function bytesByKindTable(rows: ScenarioResult[]): string {
  const kinds: DocumentKind[] = ['manifest', 'did', 'profile', 'albums', 'items', 'connections'];
  const lines = [
    `| Friends | Scenario | ${kinds.join(' | ')} |`,
    `|---:|---|${kinds.map(() => '---:').join('|')}|`,
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.friends} | ${r.scenario} | ${kinds
        .map((k) => `${mb(r.server.byKind[k].bodyBytes)} MB (${r.server.byKind[k].notModified}/${r.server.byKind[k].requests} 304)`)
        .join(' | ')} |`
    );
  }
  return lines.join('\n');
}

function errorsTable(rows: ScenarioResult[]): string {
  const failed = rows.filter((r) => r.friendsFailed);
  if (!failed.length) return 'None.';
  const lines = ['| Friends | Scenario | Errors |', '|---:|---|---|'];
  for (const r of failed) {
    lines.push(`| ${r.friends} | ${r.scenario} | ${Object.entries(r.errors).map(([e, n]) => `${e} ×${n}`).join('; ')} |`);
  }
  return lines.join('\n');
}

function dbTable(rows: ScenarioResult[]): string {
  const lines = ['| Friends | Scenario | Slowest DB calls (calls, total) |', '|---:|---|---|'];
  for (const r of rows) {
    lines.push(
      `| ${r.friends} | ${r.scenario} | ${r.dbTop.map((t) => `${t.method} ×${t.calls} ${s(t.ms / 1000)}`).join('; ')} |`
    );
  }
  return lines.join('\n');
}

/** Where each budget is crossed: measured if a tested size crossed it, else a per-friend extrapolation. */
function thresholdTable(rows: ScenarioResult[]): string {
  const find = (scenario: string) => rows.filter((r) => r.scenario === scenario).sort((a, b) => a.friends - b.friends);
  const warm = find('warm, unchanged');
  const posted = find(`warm, ${Math.round(POSTING_FRACTION * 100)}% posted`);
  const cold = find('cold');
  const monthlyBytes = (n: number) => {
    const w = warm.find((r) => r.friends === n)!;
    const p = posted.find((r) => r.friends === n)!;
    // Hourly syncs; POSTING_FRACTION of friends post once a day, each change fetched once
    return 720 * w.wireBytes + 30 * Math.max(0, p.wireBytes - w.wireBytes);
  };
  const checks: Array<{ name: string; budget: string; series: ScenarioResult[]; value: (r: ScenarioResult) => number; limit: number; linear: boolean; fmt: (v: number) => string }> = [
    { name: 'Warm sync time @150ms', budget: `${BUDGETS.warmSyncSeconds} s`, series: warm, value: (r) => r.projectedSeconds[150], limit: BUDGETS.warmSyncSeconds, linear: true, fmt: s },
    { name: 'Cold sync time @150ms', budget: `${BUDGETS.coldSyncSeconds / 60} min`, series: cold, value: (r) => r.projectedSeconds[150], limit: BUDGETS.coldSyncSeconds, linear: true, fmt: s },
    { name: 'Warm sync download', budget: `${BUDGETS.warmSyncMB} MB`, series: warm, value: (r) => r.wireBytes / 1048576, limit: BUDGETS.warmSyncMB, linear: true, fmt: (v) => `${v.toFixed(2)} MB` },
    { name: 'Monthly download (hourly sync)', budget: `${BUDGETS.monthlyGB} GB`, series: warm, value: (r) => monthlyBytes(r.friends) / 1024 ** 3, limit: BUDGETS.monthlyGB, linear: true, fmt: (v) => `${v.toFixed(1)} GB` },
    { name: 'Max UI block (cold)', budget: `${BUDGETS.maxLoopLagMs} ms`, series: cold, value: (r) => r.maxLoopLagMs, limit: BUDGETS.maxLoopLagMs, linear: false, fmt: (v) => `${v.toFixed(0)} ms` },
  ];
  const lines = ['| Budget | Limit | At largest N | Crossed at | ', '|---|---:|---:|---|'];
  for (const c of checks) {
    if (!c.series.length) continue;
    const largest = c.series[c.series.length - 1];
    const crossed = c.series.find((r) => c.value(r) > c.limit);
    let where: string;
    if (crossed) where = `measured: ${crossed.friends} friends`;
    else if (c.linear && c.value(largest) > 0) where = `≈ ${Math.floor((c.limit / c.value(largest)) * largest.friends)} friends (extrapolated)`;
    else where = `not crossed up to ${largest.friends}`;
    lines.push(`| ${c.name} | ${c.budget} | ${c.fmt(c.value(largest))} (${largest.friends}) | ${where} |`);
  }
  return lines.join('\n');
}

describe('Sync load test', () => {
  const server = new FleetServer({ latencyMs: LATENCY_MS, deadMode: DEAD_MODE });
  const all: ScenarioResult[] = [];
  let tempRoot = '';
  let previousPrivatePeers: string | undefined;

  beforeAll(async () => {
    previousPrivatePeers = process.env.WEBRING_ALLOW_PRIVATE_PEERS;
    process.env.WEBRING_ALLOW_PRIVATE_PEERS = '1';
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webring-load-'));
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    if (previousPrivatePeers === undefined) delete process.env.WEBRING_ALLOW_PRIVATE_PEERS;
    else process.env.WEBRING_ALLOW_PRIVATE_PEERS = previousPrivatePeers;
    fs.rmSync(tempRoot, { recursive: true, force: true });
    if (!all.length) return;

    const header = [
      `# Sync load test, ${new Date().toISOString()}`,
      '',
      `Fleet: ${FLEET.itemsPerSite} items, ${FLEET.photosPerSite} photos and ${FLEET.friendsPerSite} listed friends per site. ` +
        `Server latency ${LATENCY_MS} ms; failures: ${DEAD_FRACTION * 100}% dead (${DEAD_MODE}), ${BROKEN_FRACTION * 100}% HTTP 500. ` +
        `Projections assume concurrency ${CONCURRENCY}, ${CONNECT_RTTS_PER_SITE} RTTs to connect to each site and ${FETCH_TIMEOUT_MS / 1000} s per dead site.`,
      '',
    ].join('\n');
    const report = [
      header,
      '## Where the budgets break',
      thresholdTable(all),
      '',
      '## Every run',
      scenarioTable(all),
      '',
      '## Downloaded bytes by document',
      bytesByKindTable(all),
      '',
      '## Database time',
      dbTable(all),
      '',
      '## Failed friends',
      errorsTable(all),
      '',
    ].join('\n');
    console.log(`\n${report}`);
    const outDir = path.join(__dirname, 'results');
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(outDir, `sync-${stamp}.md`), report);
    fs.writeFileSync(
      path.join(outDir, `sync-${stamp}.json`),
      JSON.stringify({ config: { SIZES, LATENCY_MS, DEAD_MODE, DEAD_FRACTION, BROKEN_FRACTION, POSTING_FRACTION, FLEET, CONCURRENCY, BUDGETS }, results: all }, null, 2)
    );
    console.log(`Saved to ${outDir}/sync-${stamp}.{md,json}`);
  });

  for (const friends of SIZES) {
    it(`syncs ${friends} friends`, async () => {
      const buildStart = performance.now();
      const fleet = buildFleet({ count: friends, baseUrl: server.baseUrl, personaSiteUrl: PERSONA_SITE_URL, ...FLEET });
      server.setFleet(fleet);
      const buildMs = performance.now() - buildStart;

      const db = new StudioDatabase(path.join(tempRoot, `n${friends}`), 'load.sqlite');
      db.updateProfile({ siteUrl: PERSONA_SITE_URL, displayName: 'Load Tester' });
      const addStart = performance.now();
      for (const site of fleet.sites) db.addOrUpdateFriend({ siteUrl: site.siteUrl, displayName: site.displayName });
      const addMs = performance.now() - addStart;
      const timer = instrumentDb(db);
      const crawler = new RingCrawler(db);
      console.log(`[${friends}] fleet built in ${s(buildMs / 1000)}, friends added in ${s(addMs / 1000)}`);

      const run = async (label: string) => {
        const result = await runScenario(label, friends, crawler, db, server, timer);
        all.push(result);
        console.log(
          `[${friends}] ${label}: ${s(result.wallMs / 1000)} local, ${result.server.requests} requests, ${mb(result.wireBytes)} MB, ` +
            `${result.friendsOk} ok / ${result.friendsFailed} failed / ${result.friendsDeferred} skipped, max UI block ${result.maxLoopLagMs.toFixed(0)} ms`
        );
        if (result.friendsFailed) console.log(`[${friends}]   errors: ${JSON.stringify(result.errors)}`);
        return result;
      };

      const cold = await run('cold');
      // A rare transient failure (a reused connection reset) is reported, not fatal
      const transientAllowance = Math.ceil(friends * 0.001);
      expect(cold.friendsFailed).toBeLessThanOrEqual(transientAllowance);
      expect(cold.endorsementsFound).toBeGreaterThan(0);

      const warm = await run('warm, unchanged');
      // One request per friend: the manifest comes back 304 and its fingerprints cover the rest
      expect(warm.server.requests).toBeLessThanOrEqual(friends + transientAllowance * 6);
      expect(warm.server.notModified).toBeGreaterThanOrEqual(friends - transientAllowance);

      const posted = mutateFleet(fleet, POSTING_FRACTION);
      await run(`warm, ${Math.round(POSTING_FRACTION * 100)}% posted`);
      console.log(`[${friends}] (${posted} sites posted)`);

      const { dead, broken } = server.setFailures(DEAD_FRACTION, BROKEN_FRACTION);
      const failingLabel = `${Math.round((DEAD_FRACTION + BROKEN_FRACTION) * 100)}% failing`;
      const failing = await run(`warm, ${failingLabel}`);
      expect(failing.friendsFailed).toBeGreaterThanOrEqual(dead + broken);
      expect(failing.friendsFailed).toBeLessThanOrEqual(dead + broken + transientAllowance);

      // The next sync skips them until their backoff ends
      const again = await run(`warm, ${failingLabel} again`);
      expect(again.friendsDeferred).toBe(failing.friendsFailed);
      expect(again.friendsFailed).toBeLessThanOrEqual(transientAllowance);

      db.close();
    });
  }
});
