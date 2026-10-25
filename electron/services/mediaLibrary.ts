import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { makeWebImages } from './imagePipeline';

/**
 * The persona's local photo library (its media store folder):
 *
 *   albums/<albumId>/<hash>.<ext>        web copy, published as media/albums/<albumId>/<hash>.<ext>
 *   albums/<albumId>/<hash>.thumb.<ext>  thumbnail, published the same way
 *   originals/<hash>.<ext>               the imported original, kept locally and never published
 *
 * Web files are named by a hash of their content, so a changed photo gets a new URL (no stale
 * caches on hosts or in friends' feeds) and the album manifest can list exact hashes.
 */

export interface ImportedMedia {
  url: string;
  thumbUrl: string;
  sha256: string;
  bytes: number;
  mimeType: string;
  width: number;
  height: number;
  thumbSha256: string;
  thumbBytes: number;
  thumbWidth: number;
  thumbHeight: number;
  originalPath: string;
}

const PUBLISHED_PREFIX = 'media/';
const MAX_SOURCE_BYTES = 200 * 1024 * 1024;

export function sha256Hex(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export class MediaLibrary {
  constructor(private mediaStoreDir: string) {
    fs.mkdirSync(this.mediaStoreDir, { recursive: true });
  }

  public get rootDir(): string {
    return this.mediaStoreDir;
  }

  /**
   * Imports a local JPEG or PNG: keeps the original, writes a web copy (≤ 2048 px) and a
   * thumbnail (≤ 480 px) with all metadata stripped, and returns their published URLs and hashes.
   */
  public importPhoto(sourcePath: string, albumId: string): ImportedMedia {
    const stat = fs.statSync(sourcePath);
    if (!stat.isFile()) throw new Error(`Not a file: ${sourcePath}`);
    if (stat.size > MAX_SOURCE_BYTES) throw new Error('This file is larger than 200 MB.');
    const source = fs.readFileSync(sourcePath);
    const { web, thumb } = makeWebImages(source);

    const safeAlbum = albumId.replace(/[^a-zA-Z0-9_-]/g, '');
    const albumDir = path.join(this.mediaStoreDir, 'albums', safeAlbum);
    fs.mkdirSync(albumDir, { recursive: true });

    const webHash = sha256Hex(web.buffer);
    const thumbHash = sha256Hex(thumb.buffer);
    const baseName = webHash.slice(0, 20);
    const webFile = `${baseName}.${web.extension}`;
    const thumbFile = `${baseName}.thumb.${thumb.extension}`;
    fs.writeFileSync(path.join(albumDir, webFile), web.buffer);
    fs.writeFileSync(path.join(albumDir, thumbFile), thumb.buffer);

    const originalsDir = path.join(this.mediaStoreDir, 'originals');
    fs.mkdirSync(originalsDir, { recursive: true });
    const originalExt = (path.extname(sourcePath).toLowerCase() || `.${web.extension}`).replace(/[^.a-z0-9]/g, '');
    const originalFile = path.join(originalsDir, `${sha256Hex(source).slice(0, 20)}${originalExt}`);
    if (!fs.existsSync(originalFile)) fs.writeFileSync(originalFile, source);

    return {
      url: `${PUBLISHED_PREFIX}albums/${safeAlbum}/${webFile}`,
      thumbUrl: `${PUBLISHED_PREFIX}albums/${safeAlbum}/${thumbFile}`,
      sha256: webHash,
      bytes: web.buffer.length,
      mimeType: web.mimeType,
      width: web.width,
      height: web.height,
      thumbSha256: thumbHash,
      thumbBytes: thumb.buffer.length,
      thumbWidth: thumb.width,
      thumbHeight: thumb.height,
      originalPath: originalFile,
    };
  }

  /** True for a photo URL that points at a file in this library (rather than the web). */
  public static isLocalUrl(url: string): boolean {
    return url.startsWith(PUBLISHED_PREFIX);
  }

  /**
   * The file on disk for a published `media/...` URL, or null if it isn't one or would escape
   * the library folder.
   */
  public resolveLocalUrl(url: string): string | null {
    if (!MediaLibrary.isLocalUrl(url)) return null;
    const relative = url.slice(PUBLISHED_PREFIX.length).split(/[?#]/)[0];
    const full = path.resolve(this.mediaStoreDir, relative);
    const root = path.resolve(this.mediaStoreDir) + path.sep;
    return full.startsWith(root) ? full : null;
  }

  /**
   * Deletes library files no photo uses any more: web copies and thumbnails not in `keepUrls`,
   * and originals not in `keepOriginals`. Returns how many files were removed.
   */
  public collectGarbage(keepUrls: Set<string>, keepOriginals: Set<string>): number {
    let removed = 0;
    const keepFiles = new Set<string>();
    for (const url of keepUrls) {
      const file = this.resolveLocalUrl(url);
      if (file) keepFiles.add(file);
    }
    for (const original of keepOriginals) keepFiles.add(path.resolve(original));
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.resolve(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
        } else if (!keepFiles.has(full)) {
          fs.rmSync(full, { force: true });
          removed++;
        }
      }
    };
    walk(path.join(this.mediaStoreDir, 'albums'));
    walk(path.join(this.mediaStoreDir, 'originals'));
    return removed;
  }

  /** Total size of the library on disk. */
  public storageUsage(): { files: number; bytes: number } {
    let files = 0;
    let bytes = 0;
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else {
          files++;
          bytes += fs.statSync(full).size;
        }
      }
    };
    walk(this.mediaStoreDir);
    return { files, bytes };
  }
}

// ---------------------------------------------------------------------------
// Library operations shared by the Studio UI, MCP tools and the persona context

/** The database calls the library operations need (StudioDatabase provides them). */
export interface MediaLibraryDb {
  addPhotoToAlbum(input: { albumId: string; url: string; caption?: string; media?: ImportedMedia }): { id: string };
  replacePhotoMedia(photoId: string, media: ImportedMedia): unknown;
  deletePhoto(photoId: string): void;
  deleteAlbum(albumId: string): void;
  getLocalMediaReferences(): { urls: Set<string>; originals: Set<string> };
  getLegacyLocalPhotos(): Array<{ id: string; albumId: string; url: string }>;
  getPhotoAlbumId(photoId: string): string | undefined;
}

export interface ImportReport {
  added: string[];
  failed: Array<{ file: string; error: string }>;
}

/** Imports local files into an album, one photo each; files that can't be read are reported, not fatal. */
export function importPhotosIntoAlbum(
  db: MediaLibraryDb,
  library: MediaLibrary,
  albumId: string,
  files: string[]
): ImportReport {
  const report: ImportReport = { added: [], failed: [] };
  for (const file of files) {
    try {
      const media = library.importPhoto(file, albumId);
      report.added.push(db.addPhotoToAlbum({ albumId, url: media.url, media }).id);
    } catch (err) {
      report.failed.push({ file: path.basename(file), error: err instanceof Error ? err.message : String(err) });
    }
  }
  return report;
}

/** Swaps a photo's image, keeping its id, caption and place; the old files are cleaned up. */
export function replacePhotoImage(db: MediaLibraryDb, library: MediaLibrary, photoId: string, file: string): void {
  const albumId = db.getPhotoAlbumId(photoId);
  if (!albumId) throw new Error(`Photo "${photoId}" not found.`);
  db.replacePhotoMedia(photoId, library.importPhoto(file, albumId));
  cleanUpLibrary(db, library);
}

export function deletePhotoWithFiles(db: MediaLibraryDb, library: MediaLibrary, photoId: string): void {
  db.deletePhoto(photoId);
  cleanUpLibrary(db, library);
}

export function deleteAlbumWithFiles(db: MediaLibraryDb, library: MediaLibrary, albumId: string): void {
  db.deleteAlbum(albumId);
  cleanUpLibrary(db, library);
}

/** Removes library files no photo uses any more. */
export function cleanUpLibrary(db: MediaLibraryDb, library: MediaLibrary): number {
  const { urls, originals } = db.getLocalMediaReferences();
  return library.collectGarbage(urls, originals);
}

/**
 * Photos imported before the Media Library were published as-is (full size, with camera and GPS
 * metadata). Re-process each one into an optimized, metadata-free copy, once. Files that can't be
 * processed (e.g. HEIC) are left as they were.
 */
export function optimizeLegacyPhotos(db: MediaLibraryDb, library: MediaLibrary): number {
  let converted = 0;
  for (const photo of db.getLegacyLocalPhotos()) {
    const file = library.resolveLocalUrl(photo.url);
    if (!file || !fs.existsSync(file)) continue;
    try {
      db.replacePhotoMedia(photo.id, library.importPhoto(file, photo.albumId));
      converted++;
    } catch {
      // Unsupported or unreadable: keep publishing the original file
    }
  }
  if (converted > 0) cleanUpLibrary(db, library);
  return converted;
}
