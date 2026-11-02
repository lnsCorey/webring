import * as http from 'http';
import type { AddressInfo } from 'net';
import type { DocumentKind, Fleet } from './peerFleet';

/**
 * Serves a synthetic fleet the way a static host would: strong ETags, Last-Modified and 304s for
 * conditional requests. It can also add latency or a bandwidth cap, and make some sites dead
 * (connection reset, or hanging until the client times out) or broken (HTTP 500). Every
 * response is counted so a sync's cost can be read off afterwards.
 */

export type DeadMode = 'reset' | 'hang';

export interface FleetServerOptions {
  /** Added before every response. Default 0: measure local cost, project network time afterwards. */
  latencyMs?: number;
  /** Throttles response bodies to this many bytes per second (0 = unlimited). */
  bytesPerSecond?: number;
  deadMode?: DeadMode;
}

/** Rough size of the request plus response headers, which the body counts leave out. */
export const HEADER_BYTES_PER_EXCHANGE = 500;

export interface KindStats {
  requests: number;
  notModified: number;
  /** Body bytes actually sent (compressed when the client asked for gzip). */
  bodyBytes: number;
  /** The same bodies uncompressed. */
  rawBytes: number;
}

export interface FleetServerStats {
  requests: number;
  notModified: number;
  failed: number;
  bodyBytes: number;
  rawBytes: number;
  /** 200 responses sent gzip-compressed. */
  compressed: number;
  byKind: Record<DocumentKind, KindStats>;
}

function emptyStats(): FleetServerStats {
  const kind = (): KindStats => ({ requests: 0, notModified: 0, bodyBytes: 0, rawBytes: 0 });
  return {
    requests: 0,
    notModified: 0,
    failed: 0,
    bodyBytes: 0,
    rawBytes: 0,
    compressed: 0,
    byKind: { did: kind(), manifest: kind(), profile: kind(), albums: kind(), items: kind(), connections: kind() },
  };
}

export class FleetServer {
  private server: http.Server;
  private fleet: Fleet | null = null;
  private dead = new Set<number>();
  private broken = new Set<number>();
  public stats = emptyStats();
  public baseUrl = '';

  constructor(private options: FleetServerOptions = {}) {
    this.server = http.createServer((req, res) => this.handle(req, res));
  }

  async start(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    const { port } = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${port}`;
    return this.baseUrl;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  setFleet(fleet: Fleet): void {
    this.fleet = fleet;
    this.dead.clear();
    this.broken.clear();
  }

  /** Marks sites as unreachable or erroring, chosen with the fleet's own seeded random. */
  setFailures(deadFraction: number, brokenFraction: number): { dead: number; broken: number } {
    this.dead.clear();
    this.broken.clear();
    if (!this.fleet) return { dead: 0, broken: 0 };
    for (const site of this.fleet.sites) {
      const roll = this.fleet.rng();
      if (roll < deadFraction) this.dead.add(site.index);
      else if (roll < deadFraction + brokenFraction) this.broken.add(site.index);
    }
    return { dead: this.dead.size, broken: this.broken.size };
  }

  resetStats(): void {
    this.stats = emptyStats();
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.stats.requests++;
    const match = /^\/p\/(\d+)\/(.+)$/.exec(req.url || '');
    const site = match ? this.fleet?.sites[Number(match[1])] : undefined;
    const file = site && match ? site.files.get(match[2]) : undefined;

    if (site && this.dead.has(site.index)) {
      this.stats.failed++;
      if (this.options.deadMode === 'hang') return; // the client's timeout ends it
      req.socket.destroy();
      return;
    }

    const respond = () => {
      if (!site || !file) {
        this.stats.failed++;
        res.writeHead(404).end();
        return;
      }
      if (this.broken.has(site.index)) {
        this.stats.failed++;
        res.writeHead(500).end();
        return;
      }
      const kind = this.stats.byKind[file.kind];
      kind.requests++;
      const headers = { ETag: file.etag, 'Last-Modified': file.lastModified, 'Content-Type': 'application/json' };
      const ifNoneMatch = req.headers['if-none-match'];
      const ifModifiedSince = req.headers['if-modified-since'];
      if ((ifNoneMatch && ifNoneMatch === file.etag) || (!ifNoneMatch && ifModifiedSince === file.lastModified)) {
        this.stats.notModified++;
        kind.notModified++;
        res.writeHead(304, headers).end();
        return;
      }
      const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
      const body = gzip ? file.gzipBody : file.body;
      this.stats.bodyBytes += body.length;
      this.stats.rawBytes += file.body.length;
      if (gzip) this.stats.compressed++;
      kind.bodyBytes += body.length;
      kind.rawBytes += file.body.length;
      res.writeHead(200, {
        ...headers,
        'Content-Length': String(body.length),
        ...(gzip ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}),
      });
      const transferMs = this.options.bytesPerSecond ? (body.length / this.options.bytesPerSecond) * 1000 : 0;
      if (transferMs > 0) setTimeout(() => res.end(body), transferMs);
      else res.end(body);
    };

    if (this.options.latencyMs) setTimeout(respond, this.options.latencyMs);
    else respond();
  }
}
