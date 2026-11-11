import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import * as tls from 'tls';
import {
  guardedLookup,
  isPrivateNetworkAddress,
  PrivateNetworkAddressError,
  privatePeersAllowed,
} from './networkGuard';

export type SupportedProxyProtocol = 'socks5:' | 'socks5h:' | 'http:';

export interface ParsedProxyConfig {
  protocol: SupportedProxyProtocol;
  host: string;
  port: number;
  username?: string;
  password?: string;
}

/**
 * Validates and parses a proxy URL (`socks5://`, `socks5h://` for Tor remote DNS, or `http://`).
 */
export function parseProxyUrl(rawProxyUrl: string): ParsedProxyConfig {
  let parsed: URL;
  try {
    parsed = new URL(rawProxyUrl.trim());
  } catch {
    throw new Error(`Invalid proxy URL: ${rawProxyUrl}`);
  }
  if (parsed.protocol !== 'socks5:' && parsed.protocol !== 'socks5h:' && parsed.protocol !== 'http:') {
    throw new Error(`Unsupported proxy protocol "${parsed.protocol}". Use socks5://, socks5h://, or http://`);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!host) {
    throw new Error(`Proxy URL is missing a hostname: ${rawProxyUrl}`);
  }
  const defaultPort = parsed.protocol === 'http:' ? 8080 : 1080;
  const port = parsed.port ? Number(parsed.port) : defaultPort;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid proxy port in ${rawProxyUrl}`);
  }
  return {
    protocol: parsed.protocol,
    host,
    port,
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
  };
}

function isBlockedTargetHostLiteral(hostname: string): string | null {
  const clean = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (clean === 'localhost' || clean.endsWith('.localhost') || clean.endsWith('.local')) {
    return '127.0.0.1';
  }
  if (net.isIP(clean) && isPrivateNetworkAddress(clean)) {
    return clean;
  }
  return null;
}

function resolveHostGuarded(hostname: string): Promise<string> {
  return new Promise((resolve, reject) => {
    guardedLookup(hostname, { family: 4 }, (err, address) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(typeof address === 'string' ? address : address[0]?.address || hostname);
    });
  });
}

/**
 * Establishes a TCP tunnel through a SOCKS5 (`socks5://` / `socks5h://`) or HTTP CONNECT (`http://`)
 * proxy to `targetHost:targetPort`, upgrading to TLS when `targetProtocol === 'https:'`.
 */
export async function connectViaProxy(params: {
  proxyUrl: string;
  targetHost: string;
  targetPort: number;
  targetProtocol: 'http:' | 'https:';
  timeoutMs?: number;
}): Promise<net.Socket> {
  const proxy = parseProxyUrl(params.proxyUrl);
  const timeoutMs = params.timeoutMs ?? 10000;
  const cleanTargetHost = params.targetHost.replace(/^\[|\]$/g, '');

  if (!privatePeersAllowed()) {
    const blockedLiteral = isBlockedTargetHostLiteral(cleanTargetHost);
    if (blockedLiteral) {
      throw new PrivateNetworkAddressError(cleanTargetHost, blockedLiteral);
    }
  }

  // For socks5:// (without the 'h'), resolve locally through guardedLookup first.
  // For socks5h:// (Tor) and http:// CONNECT, let the proxy resolve DNS so queries don't leak locally.
  let connectHost = cleanTargetHost;
  if (proxy.protocol === 'socks5:' && !net.isIP(cleanTargetHost) && !cleanTargetHost.endsWith('.onion')) {
    connectHost = await resolveHostGuarded(cleanTargetHost);
  }

  const rawSocket = await openRawTunnelSocket(proxy, connectHost, params.targetPort, timeoutMs);

  if (params.targetProtocol === 'https:') {
    return await new Promise<net.Socket>((resolve, reject) => {
      const tlsSocket = tls.connect({
        socket: rawSocket,
        servername: net.isIP(cleanTargetHost) ? undefined : cleanTargetHost,
      });
      const timer = setTimeout(() => {
        tlsSocket.destroy(new Error(`TLS handshake via proxy timed out for ${cleanTargetHost}`));
      }, timeoutMs);
      tlsSocket.once('secureConnect', () => {
        clearTimeout(timer);
        resolve(tlsSocket);
      });
      tlsSocket.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  return rawSocket;
}

function openRawTunnelSocket(
  proxy: ParsedProxyConfig,
  targetHost: string,
  targetPort: number,
  timeoutMs: number
): Promise<net.Socket> {
  if (proxy.protocol === 'http:') {
    return openHttpConnectTunnel(proxy, targetHost, targetPort, timeoutMs);
  }
  return openSocks5Tunnel(proxy, targetHost, targetPort, timeoutMs);
}

function openSocks5Tunnel(
  proxy: ParsedProxyConfig,
  targetHost: string,
  targetPort: number,
  timeoutMs: number
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxy.host, port: proxy.port });
    let settled = false;
    let buffer = Buffer.alloc(0);
    const hasAuth = Boolean(proxy.username);
    let stage: 'greeting' | 'auth' | 'connect' = 'greeting';

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.destroy();
      reject(err);
    };

    const timer = setTimeout(() => {
      fail(new Error(`SOCKS5 proxy connection timed out (${proxy.host}:${proxy.port})`));
    }, timeoutMs);

    const sendConnectRequest = () => {
      stage = 'connect';
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(targetPort, 0);

      let addrHeader: Buffer;
      if (proxy.protocol === 'socks5:' && net.isIPv4(targetHost)) {
        const octets = targetHost.split('.').map((part) => Number(part));
        addrHeader = Buffer.from([0x05, 0x01, 0x00, 0x01, ...octets]);
      } else {
        const hostBytes = Buffer.from(targetHost, 'utf8');
        if (hostBytes.length > 255) {
          fail(new Error(`Target hostname too long for SOCKS5: ${targetHost}`));
          return;
        }
        addrHeader = Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, hostBytes.length]), hostBytes]);
      }
      socket.write(Buffer.concat([addrHeader, portBuf]));
    };

    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      if (stage === 'greeting') {
        if (buffer.length < 2) return;
        const ver = buffer[0];
        const method = buffer[1];
        buffer = buffer.subarray(2);
        if (ver !== 0x05) {
          fail(new Error(`Unexpected SOCKS version ${ver} from proxy`));
          return;
        }
        if (method === 0x02 && hasAuth) {
          stage = 'auth';
          const uBytes = Buffer.from(proxy.username || '', 'utf8');
          const pBytes = Buffer.from(proxy.password || '', 'utf8');
          socket.write(
            Buffer.concat([
              Buffer.from([0x01, uBytes.length]),
              uBytes,
              Buffer.from([pBytes.length]),
              pBytes,
            ])
          );
          return;
        }
        if (method !== 0x00) {
          fail(new Error(`SOCKS5 proxy rejected authentication method (${method})`));
          return;
        }
        sendConnectRequest();
      }

      if (stage === 'auth') {
        if (buffer.length < 2) return;
        const status = buffer[1];
        buffer = buffer.subarray(2);
        if (status !== 0x00) {
          fail(new Error('SOCKS5 username/password authentication failed'));
          return;
        }
        sendConnectRequest();
      }

      if (stage === 'connect') {
        if (buffer.length < 4) return;
        const ver = buffer[0];
        const rep = buffer[1];
        const atyp = buffer[3];
        if (ver !== 0x05) {
          fail(new Error(`Invalid SOCKS5 reply version ${ver}`));
          return;
        }
        if (rep !== 0x00) {
          fail(new Error(`SOCKS5 proxy could not connect to ${targetHost}:${targetPort} (code ${rep})`));
          return;
        }
        let needed = 0;
        if (atyp === 0x01) {
          needed = 4 + 4 + 2;
        } else if (atyp === 0x03) {
          if (buffer.length < 5) return;
          needed = 4 + 1 + buffer[4] + 2;
        } else if (atyp === 0x04) {
          needed = 4 + 16 + 2;
        } else {
          fail(new Error(`Unsupported SOCKS5 address type ${atyp}`));
          return;
        }
        if (buffer.length < needed) return;
        const extra = buffer.subarray(needed);
        settled = true;
        clearTimeout(timer);
        socket.removeListener('data', onData);
        socket.removeListener('error', fail);
        if (extra.length > 0) {
          socket.unshift(extra);
        }
        resolve(socket);
      }
    };

    socket.on('data', onData);
    socket.once('error', fail);
    socket.once('connect', () => {
      if (hasAuth) {
        socket.write(Buffer.from([0x05, 0x02, 0x00, 0x02]));
      } else {
        socket.write(Buffer.from([0x05, 0x01, 0x00]));
      }
    });
  });
}

function openHttpConnectTunnel(
  proxy: ParsedProxyConfig,
  targetHost: string,
  targetPort: number,
  timeoutMs: number
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxy.host, port: proxy.port });
    let settled = false;
    let buffer = Buffer.alloc(0);

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.destroy();
      reject(err);
    };

    const timer = setTimeout(() => {
      fail(new Error(`HTTP proxy connection timed out (${proxy.host}:${proxy.port})`));
    }, timeoutMs);

    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        if (buffer.length > 16384) {
          fail(new Error('HTTP proxy response headers too large'));
        }
        return;
      }
      const headerText = buffer.subarray(0, headerEnd).toString('latin1');
      const statusLine = headerText.split('\r\n')[0] || '';
      if (!/^HTTP\/1\.[01]\s+200\b/i.test(statusLine)) {
        fail(new Error(`HTTP proxy CONNECT rejected: ${statusLine}`));
        return;
      }
      const extra = buffer.subarray(headerEnd + 4);
      settled = true;
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.removeListener('error', fail);
      if (extra.length > 0) {
        socket.unshift(extra);
      }
      resolve(socket);
    };

    socket.on('data', onData);
    socket.once('error', fail);
    socket.once('connect', () => {
      const authority = `${targetHost}:${targetPort}`;
      const authHeader = proxy.username
        ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password || ''}`, 'utf8').toString('base64')}\r\n`
        : '';
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${authHeader}\r\n`);
    });
  });
}

/**
 * Creates a Node `http.Agent` or `https.Agent` whose connections tunnel through `proxyUrl`.
 */
export function createProxyAgent(
  proxyUrl: string,
  targetProtocol: 'http:' | 'https:',
  timeoutMs = 10000
): http.Agent | https.Agent {
  const AgentClass = targetProtocol === 'https:' ? https.Agent : http.Agent;
  const agent = new AgentClass({ keepAlive: false });
  agent.createConnection = (
    options: http.ClientRequestArgs,
    oncreate?: (err: Error | null, stream: net.Socket) => void
  ) => {
    const host = String(options.host || options.hostname || 'localhost');
    const defaultPort = targetProtocol === 'https:' ? 443 : 80;
    const port = Number(options.port || defaultPort);
    connectViaProxy({
      proxyUrl,
      targetHost: host,
      targetPort: port,
      targetProtocol,
      timeoutMs,
    }).then(
      (socket) => oncreate?.(null, socket),
      (err) => oncreate?.(err instanceof Error ? err : new Error(String(err)), undefined as unknown as net.Socket)
    );
    return undefined;
  };
  return agent;
}
