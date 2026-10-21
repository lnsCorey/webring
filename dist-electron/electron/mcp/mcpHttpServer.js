"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.McpHttpServer = void 0;
const http = __importStar(require("http"));
/**
 * Loopback-only (127.0.0.1) HTTP & SSE MCP Server for Webring Studio.
 * Allows local AI agents and automation tools to connect to the live running
 * Webring Studio instance over Streamable HTTP (`POST /mcp`) or SSE (`GET /mcp/sse`).
 */
class McpHttpServer {
    mcpServer;
    server = null;
    port = 0;
    sseClients = new Set();
    constructor(mcpServer) {
        this.mcpServer = mcpServer;
    }
    async start(preferredPort = 0) {
        if (this.server && this.port > 0) {
            return this.getStatus();
        }
        await new Promise((resolve, reject) => {
            const srv = http.createServer(async (req, res) => {
                // Strict loopback CORS headers for local agent tooling
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
                if (req.method === 'OPTIONS') {
                    res.writeHead(204);
                    res.end();
                    return;
                }
                const urlObj = new URL(req.url || '/', `http://127.0.0.1:${this.port || 80}`);
                // 1. Health & Metadata Check
                if (req.method === 'GET' && urlObj.pathname === '/mcp/health') {
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify(this.getStatus(), null, 2));
                    return;
                }
                // 2. SSE Endpoint (`GET /mcp/sse`)
                if (req.method === 'GET' && urlObj.pathname === '/mcp/sse') {
                    res.writeHead(200, {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        Connection: 'keep-alive',
                    });
                    res.write(`event: endpoint\ndata: http://127.0.0.1:${this.port}/mcp/message\n\n`);
                    this.sseClients.add(res);
                    req.on('close', () => {
                        this.sseClients.delete(res);
                    });
                    return;
                }
                // 3. Streamable HTTP JSON-RPC (`POST /mcp` or `POST /mcp/message`)
                if (req.method === 'POST' &&
                    (urlObj.pathname === '/mcp' || urlObj.pathname === '/mcp/message')) {
                    try {
                        const rawBody = await this.readRequestBody(req);
                        const parsed = JSON.parse(rawBody);
                        if (Array.isArray(parsed)) {
                            const responses = [];
                            for (const item of parsed) {
                                const r = await this.mcpServer.handleJsonRpc(item);
                                if (r)
                                    responses.push(r);
                            }
                            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                            res.end(JSON.stringify(responses));
                            return;
                        }
                        const rpcResponse = await this.mcpServer.handleJsonRpc(parsed);
                        // Also broadcast over SSE if an SSE client is listening on /mcp/message
                        if (urlObj.pathname === '/mcp/message' && rpcResponse) {
                            const ssePayload = `event: message\ndata: ${JSON.stringify(rpcResponse)}\n\n`;
                            for (const client of this.sseClients) {
                                client.write(ssePayload);
                            }
                        }
                        if (!rpcResponse) {
                            res.writeHead(202);
                            res.end();
                            return;
                        }
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify(rpcResponse));
                        return;
                    }
                    catch (err) {
                        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({
                            jsonrpc: '2.0',
                            id: null,
                            error: {
                                code: -32700,
                                message: err instanceof Error ? err.message : 'Invalid JSON-RPC payload',
                            },
                        }));
                        return;
                    }
                }
                res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Not Found. Use POST /mcp for MCP JSON-RPC 2.0.' }));
            });
            srv.on('error', reject);
            srv.listen(preferredPort, '127.0.0.1', () => {
                const addr = srv.address();
                if (addr && typeof addr === 'object') {
                    this.port = addr.port;
                }
                this.server = srv;
                resolve();
            });
        });
        return this.getStatus();
    }
    readRequestBody(req) {
        return new Promise((resolve, reject) => {
            const chunks = [];
            let totalBytes = 0;
            const maxBytes = 5 * 1024 * 1024;
            req.on('data', (chunk) => {
                totalBytes += chunk.length;
                if (totalBytes > maxBytes) {
                    reject(new Error('Request payload exceeds 5MB limit'));
                    req.destroy();
                    return;
                }
                chunks.push(chunk);
            });
            req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
            req.on('error', reject);
        });
    }
    getStatus() {
        const running = Boolean(this.server && this.port > 0);
        return {
            running,
            port: this.port,
            endpointUrl: running ? `http://127.0.0.1:${this.port}/mcp` : '',
            sseUrl: running ? `http://127.0.0.1:${this.port}/mcp/sse` : '',
            toolCount: this.mcpServer.getTools().length,
            resourceCount: this.mcpServer.getResources().length,
            promptCount: this.mcpServer.getPrompts().length,
        };
    }
    async stop() {
        for (const client of this.sseClients) {
            try {
                client.end();
            }
            catch {
                // Ignore
            }
        }
        this.sseClients.clear();
        if (!this.server)
            return;
        await new Promise((resolve) => {
            this.server.close(() => resolve());
        });
        this.server = null;
        this.port = 0;
    }
}
exports.McpHttpServer = McpHttpServer;
