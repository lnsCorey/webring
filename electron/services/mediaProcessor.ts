import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface ImportedMediaFile {
  relativeUrl: string;
  thumbRelativeUrl: string;
  localFullPath: string;
  fileName: string;
}

/**
 * Copies selected local image files into the studio's managed `media/` directory
 * so they are bundled into the static site export and referenced via clean relative URLs.
 */
export class MediaProcessor {
  constructor(private mediaStoreDir: string) {
    if (!fs.existsSync(this.mediaStoreDir)) {
      fs.mkdirSync(this.mediaStoreDir, { recursive: true });
    }
  }

  public importLocalPhoto(sourceFilePath: string, albumId: string): ImportedMediaFile {
    const ext = path.extname(sourceFilePath).toLowerCase() || '.jpg';
    const hash = crypto.randomBytes(4).toString('hex');
    const safeAlbumDir = albumId.replace(/[^a-zA-Z0-9_-]/g, '');
    const targetSubDir = path.join(this.mediaStoreDir, 'albums', safeAlbumDir);
    fs.mkdirSync(targetSubDir, { recursive: true });

    const fileName = `photo-${Date.now()}-${hash}${ext}`;
    const destFullPath = path.join(targetSubDir, fileName);
    fs.copyFileSync(sourceFilePath, destFullPath);

    const relativeUrl = `media/albums/${safeAlbumDir}/${fileName}`;
    return {
      relativeUrl,
      thumbRelativeUrl: relativeUrl,
      localFullPath: destFullPath,
      fileName,
    };
  }
}

