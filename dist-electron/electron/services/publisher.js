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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SitePublisher = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ssh2_sftp_client_1 = __importDefault(require("ssh2-sftp-client"));
const ftp = __importStar(require("basic-ftp"));
class SitePublisher {
    generator;
    constructor(generator) {
        this.generator = generator;
    }
    /**
     * Exports the generated static website and JSON schemas to a local folder.
     */
    publishToLocalDirectory(targetDir) {
        try {
            const result = this.generator.generateToDirectory(targetDir);
            return {
                success: true,
                mode: 'local',
                destination: result.outputDir,
                filesPublished: result.filesWritten.length,
                message: `Successfully exported ${result.filesWritten.length} files (HTML, DID, and JSON endpoints) to ${result.outputDir}`,
            };
        }
        catch (err) {
            return {
                success: false,
                mode: 'local',
                destination: targetDir,
                filesPublished: 0,
                message: err instanceof Error ? err.message : String(err),
            };
        }
    }
    /**
     * Generates the site to a staging folder and uploads it to the configured SFTP or FTP host.
     */
    async publishToRemoteHost(settings, stagingDir) {
        const genResult = this.generator.generateToDirectory(stagingDir);
        if (settings.protocol === 'sftp') {
            const sftp = new ssh2_sftp_client_1.default();
            try {
                await sftp.connect({
                    host: settings.host,
                    port: settings.port || 22,
                    username: settings.username,
                    password: settings.password,
                });
                await sftp.uploadDir(stagingDir, settings.remotePath);
                await this.ensureRemoteSftpPermissions(sftp, stagingDir, settings.remotePath);
                await sftp.end();
                return {
                    success: true,
                    mode: 'sftp',
                    destination: `sftp://${settings.host}:${settings.port}${settings.remotePath}`,
                    filesPublished: genResult.filesWritten.length,
                    message: `Uploaded ${genResult.filesWritten.length} files via SFTP to ${settings.host}:${settings.remotePath}`,
                };
            }
            catch (err) {
                try {
                    await sftp.end();
                }
                catch {
                    // ignore
                }
                return {
                    success: false,
                    mode: 'sftp',
                    destination: settings.host,
                    filesPublished: 0,
                    message: `SFTP upload failed: ${err instanceof Error ? err.message : String(err)}`,
                };
            }
        }
        else {
            const client = new ftp.Client();
            try {
                await client.access({
                    host: settings.host,
                    port: settings.port || 21,
                    user: settings.username,
                    password: settings.password,
                    secure: false,
                });
                await client.ensureDir(settings.remotePath);
                await client.uploadFromDir(stagingDir, settings.remotePath);
                client.close();
                return {
                    success: true,
                    mode: 'ftp',
                    destination: `ftp://${settings.host}:${settings.port}${settings.remotePath}`,
                    filesPublished: genResult.filesWritten.length,
                    message: `Uploaded ${genResult.filesWritten.length} files via FTP to ${settings.host}:${settings.remotePath}`,
                };
            }
            catch (err) {
                client.close();
                return {
                    success: false,
                    mode: 'ftp',
                    destination: settings.host,
                    filesPublished: 0,
                    message: `FTP upload failed: ${err instanceof Error ? err.message : String(err)}`,
                };
            }
        }
    }
    /**
     * Ensures remote directories have 0o755 and files have 0o644 permissions after SFTP upload
     * so Apache / Nginx / LiteSpeed web servers do not return 403 Forbidden when SFTP umask is restrictive.
     */
    async ensureRemoteSftpPermissions(sftp, localDir, remoteDir) {
        const cleanRemoteDir = remoteDir.replace(/\/+$/, '') || '/';
        try {
            await sftp.chmod(cleanRemoteDir, 0o755);
        }
        catch {
            // ignore if host disallows chmod on root target dir
        }
        if (!fs.existsSync(localDir))
            return;
        for (const entry of fs.readdirSync(localDir, { withFileTypes: true })) {
            const localPath = path.join(localDir, entry.name);
            const remotePath = `${cleanRemoteDir}/${entry.name}`;
            if (entry.isDirectory()) {
                await this.ensureRemoteSftpPermissions(sftp, localPath, remotePath);
            }
            else {
                try {
                    await sftp.chmod(remotePath, 0o644);
                }
                catch {
                    // ignore if host disallows chmod
                }
            }
        }
    }
}
exports.SitePublisher = SitePublisher;
