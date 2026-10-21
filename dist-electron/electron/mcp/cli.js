#!/usr/bin/env node
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
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const readline = __importStar(require("readline"));
const personaManager_1 = require("../services/personaManager");
const mcpServer_1 = require("./mcpServer");
/**
 * Resolve the default Webring Studio userData directory across Windows, macOS, and Linux,
 * or accept `--data-dir <path>` / `WEBRING_STUDIO_DATA_DIR`.
 */
function resolveDataDir(argv) {
    const idx = argv.indexOf('--data-dir');
    if (idx !== -1 && argv[idx + 1]) {
        return path.resolve(argv[idx + 1]);
    }
    if (process.env.WEBRING_STUDIO_DATA_DIR) {
        return path.resolve(process.env.WEBRING_STUDIO_DATA_DIR);
    }
    if (process.platform === 'win32') {
        const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        return path.join(appData, 'webring-studio');
    }
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'webring-studio');
    }
    const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    return path.join(xdgConfig, 'webring-studio');
}
async function main() {
    const dataDir = resolveDataDir(process.argv.slice(2));
    const personaManager = new personaManager_1.PersonaManager(dataDir);
    const mcpServer = new mcpServer_1.WebringMcpServer(personaManager, dataDir);
    const rl = readline.createInterface({
        input: process.stdin,
        terminal: false,
    });
    rl.on('line', async (line) => {
        const trimmed = line.trim();
        if (!trimmed)
            return;
        try {
            const request = JSON.parse(trimmed);
            const response = await mcpServer.handleJsonRpc(request);
            if (response) {
                process.stdout.write(`${JSON.stringify(response)}\n`);
            }
        }
        catch (err) {
            const errResp = {
                jsonrpc: '2.0',
                id: null,
                error: {
                    code: -32700,
                    message: err instanceof Error ? err.message : 'Parse error',
                },
            };
            process.stdout.write(`${JSON.stringify(errResp)}\n`);
        }
    });
    const cleanup = () => {
        personaManager.closeAll();
        process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
}
main().catch((err) => {
    process.stderr.write(`Fatal error in webring-studio MCP CLI: ${String(err)}\n`);
    process.exit(1);
});
