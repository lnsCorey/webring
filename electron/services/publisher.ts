import * as fs from 'fs';
import * as path from 'path';
import SftpClient from 'ssh2-sftp-client';
import * as ftp from 'basic-ftp';
import { PublishSettings } from '../db/database';
import { StaticSiteGenerator } from './siteGenerator';

export interface PublishResult {
  success: boolean;
  mode: 'local' | 'sftp' | 'ftp';
  destination: string;
  filesPublished: number;
  message: string;
}

export class SitePublisher {
  constructor(private generator: StaticSiteGenerator) {}

  /**
   * Exports the generated static website and JSON schemas to a local folder.
   */
  public publishToLocalDirectory(targetDir: string): PublishResult {
    try {
      const result = this.generator.generateToDirectory(targetDir);
      return {
        success: true,
        mode: 'local',
        destination: result.outputDir,
        filesPublished: result.filesWritten.length,
        message: `Successfully exported ${result.filesWritten.length} files (HTML, DID, and JSON endpoints) to ${result.outputDir}`,
      };
    } catch (err: unknown) {
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
  public async publishToRemoteHost(
    settings: PublishSettings,
    stagingDir: string
  ): Promise<PublishResult> {
    const genResult = this.generator.generateToDirectory(stagingDir);

    if (settings.protocol === 'sftp') {
      const sftp = new SftpClient();
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
      } catch (err: unknown) {
        try {
          await sftp.end();
        } catch {
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
    } else {
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
      } catch (err: unknown) {
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
  private async ensureRemoteSftpPermissions(
    sftp: SftpClient,
    localDir: string,
    remoteDir: string
  ): Promise<void> {
    const cleanRemoteDir = remoteDir.replace(/\/+$/, '') || '/';
    try {
      await sftp.chmod(cleanRemoteDir, 0o755);
    } catch {
      // ignore if host disallows chmod on root target dir
    }

    if (!fs.existsSync(localDir)) return;
    for (const entry of fs.readdirSync(localDir, { withFileTypes: true })) {
      const localPath = path.join(localDir, entry.name);
      const remotePath = `${cleanRemoteDir}/${entry.name}`;
      if (entry.isDirectory()) {
        await this.ensureRemoteSftpPermissions(sftp, localPath, remotePath);
      } else {
        try {
          await sftp.chmod(remotePath, 0o644);
        } catch {
          // ignore if host disallows chmod
        }
      }
    }
  }
}

