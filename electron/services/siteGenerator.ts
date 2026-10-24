import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { StudioDatabase } from '../db/database';
import {
  CompleteSiteBundle,
  isValidAdSlotId,
  isValidGa4MeasurementId,
  normalizeAdSensePublisherId,
  WebringHubDocument,
  WEBRING_SCHEMA_VERSION,
} from '../../src/shared/schema';

export interface GeneratedSiteResult {
  outputDir: string;
  filesWritten: string[];
  bundle: CompleteSiteBundle;
}

/**
 * Generates the complete static website directory containing:
 * - /.well-known/did.json (W3C / ATProto identity & public key)
 * - /api/manifest.json
 * - /api/profile.json
 * - /api/albums.json
 * - /api/items.json
 * - /api/connections.json
 * - /api/rings/<slug>.json + /rings/<slug>/index.html (signed hub and directory page per hosted ring)
 * - /index.html (Standalone interactive profile site powered by the JSON files)
 */
export class StaticSiteGenerator {
  constructor(private db: StudioDatabase, private mediaStoreDir?: string) {}

  /**
   * Remembers that this bundle actually went live (local export or upload), so the studio can
   * show when the public snapshot was taken. Test previews don't call this.
   */
  public recordPublished(bundle: CompleteSiteBundle): void {
    this.db.recordPublished(
      bundle.manifest.updatedAt,
      {
        ...bundle.manifest.stats,
        endorsementCount: bundle.connections.endorsements.length,
      },
      this.contentFingerprint(bundle)
    );
  }

  /**
   * A hash of what the published site would contain, ignoring things that change on every build
   * (timestamps and signatures). Equal fingerprints mean publishing again would change nothing,
   * which lets scheduled publishes skip. Covers the bundle, hosted ring hubs and media files.
   */
  public contentFingerprint(bundle: CompleteSiteBundle = this.db.buildSignedSiteBundle()): string {
    const stripVolatile = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(stripVolatile);
      if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(value as Record<string, unknown>).sort()) {
          if (key === 'updatedAt' || key === 'proof') continue;
          out[key] = stripVolatile((value as Record<string, unknown>)[key]);
        }
        return out;
      }
      return value;
    };
    const media: string[] = [];
    const walk = (dir: string, rel: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const full = path.join(dir, entry.name);
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walk(full, relPath);
        } else {
          const stat = fs.statSync(full);
          media.push(`${relPath}:${stat.size}:${Math.floor(stat.mtimeMs)}`);
        }
      }
    };
    if (this.mediaStoreDir) walk(this.mediaStoreDir, '');
    const hubs = this.db.buildSignedHubDocuments().map(({ ring, doc }) => ({ path: ring.hubPath, doc }));
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(stripVolatile({ bundle, hubs, media })))
      .digest('hex');
  }

  public generateToDirectory(outputDir: string, compiledProfileHtml?: string): GeneratedSiteResult {
    const bundle = this.db.buildSignedSiteBundle();
    const filesWritten: string[] = [];

    const wellKnownDir = path.join(outputDir, '.well-known');
    const apiDir = path.join(outputDir, 'api');
    const mediaOutDir = path.join(outputDir, 'media');

    fs.mkdirSync(wellKnownDir, { recursive: true });
    fs.mkdirSync(apiDir, { recursive: true });
    fs.mkdirSync(mediaOutDir, { recursive: true });

    const writeJson = (relPath: string, data: unknown) => {
      const fullPath = path.join(outputDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), 'utf8');
      filesWritten.push(relPath);
    };

    // 1. Write standardized JSON endpoints (both /.well-known/did.json for root domains and /did.json for subpath did:web resolution)
    writeJson('.well-known/did.json', bundle.didDocument);
    writeJson('did.json', bundle.didDocument);
    writeJson('api/manifest.json', bundle.manifest);
    writeJson('api/profile.json', bundle.profile);
    writeJson('api/albums.json', bundle.albums);
    writeJson('api/items.json', bundle.items);
    writeJson('api/connections.json', bundle.connections);

    // 2. Hosted rings: a signed hub JSON (what members' Studios and visitors' Prev/Next read) and a
    // script-free directory page. Closed rings are still written so members learn they closed.
    const hubDocs = this.db.buildSignedHubDocuments();
    for (const { ring, doc } of hubDocs) {
      writeJson(ring.hubPath, doc);
      const directoryFile = path.join(outputDir, ring.directoryPath);
      fs.mkdirSync(path.dirname(directoryFile), { recursive: true });
      fs.writeFileSync(directoryFile, buildRingDirectoryHtml(doc), 'utf8');
      filesWritten.push(ring.directoryPath);
    }
    // The pre-redesign hub lived here; drop a stale local copy unless a hosted ring now owns the path
    const legacyHubPath = path.join(outputDir, 'api/webring-hub.json');
    if (!hubDocs.some(({ ring }) => ring.hubPath === 'api/webring-hub.json') && fs.existsSync(legacyHubPath)) {
      fs.rmSync(legacyHubPath, { force: true });
    }

    // 3. Copy local media files if mediaStoreDir exists
    if (this.mediaStoreDir && fs.existsSync(this.mediaStoreDir)) {
      this.copyDirectoryRecursive(this.mediaStoreDir, mediaOutDir, 'media', filesWritten);
    }

    // 4. Write standalone index.html for the hosted Profile Website
    const indexHtml = compiledProfileHtml
      ? this.injectHydrationData(compiledProfileHtml, bundle)
      : this.buildStandaloneProfileHtml(bundle);

    fs.writeFileSync(path.join(outputDir, 'index.html'), indexHtml, 'utf8');
    filesWritten.push('index.html');

    // 5. Write .nojekyll so GitHub Pages serves /.well-known/did.json without ignoring dot-folders
    fs.writeFileSync(path.join(outputDir, '.nojekyll'), '', 'utf8');
    filesWritten.push('.nojekyll');

    // 5b. Write .htaccess so Apache / LiteSpeed hosts resolve DirectoryIndex index.html on subdirectories (preventing 403 Forbidden on /social/) and allow CORS on JSON endpoints
    const htaccessContent = [
      'DirectoryIndex index.html',
      '<IfModule mod_headers.c>',
      '  <FilesMatch "\\.(json)$">',
      '    Header set Access-Control-Allow-Origin "*"',
      '  </FilesMatch>',
      '</IfModule>',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(outputDir, '.htaccess'), htaccessContent, 'utf8');
    filesWritten.push('.htaccess');

    // 6. Optional Add-On: Write /ads.txt when Google AdSense Add-On is enabled (or remove if disabled)
    const adsTxtPath = path.join(outputDir, 'ads.txt');
    const adsAddon = bundle.profile.adsAddon;
    const normalizedPubId = normalizeAdSensePublisherId(adsAddon?.publisherId);
    if (adsAddon?.enabled && adsAddon.generateAdsTxt !== false && normalizedPubId) {
      const pubWithoutCa = normalizedPubId.replace(/^ca-/i, '');
      const adsTxtContent = `google.com, ${pubWithoutCa}, DIRECT, f08c47fec0942fa0\n`;
      fs.writeFileSync(adsTxtPath, adsTxtContent, 'utf8');
      filesWritten.push('ads.txt');
    } else if (fs.existsSync(adsTxtPath)) {
      fs.rmSync(adsTxtPath, { force: true });
    }

    return {
      outputDir,
      filesWritten,
      bundle,
    };
  }

  private copyDirectoryRecursive(
    srcDir: string,
    destDir: string,
    relPrefix: string,
    filesWritten: string[]
  ): void {
    if (!fs.existsSync(srcDir)) return;
    fs.mkdirSync(destDir, { recursive: true });
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);
      const relPath = `${relPrefix}/${entry.name}`;
      if (entry.isDirectory()) {
        this.copyDirectoryRecursive(srcPath, destPath, relPath, filesWritten);
      } else {
        fs.copyFileSync(srcPath, destPath);
        filesWritten.push(relPath);
      }
    }
  }

  private injectHydrationData(htmlTemplate: string, bundle: CompleteSiteBundle): string {
    const scriptTag = `<script>window.__WEBRING_BUNDLE__ = ${JSON.stringify(bundle)};</script>`;
    if (htmlTemplate.includes('</head>')) {
      return htmlTemplate.replace('</head>', `${scriptTag}\n</head>`);
    }
    return `${scriptTag}\n${htmlTemplate}`;
  }

  /**
   * Produces a zero-dependency, self-contained HTML profile website that dynamically loads
   * `/api/*.json` when hosted on an HTTP server, and falls back to `window.__WEBRING_BUNDLE__`
   * when opened locally via `file://`.
   */
  public buildStandaloneProfileHtml(bundle: CompleteSiteBundle): string {
    const safeJson = JSON.stringify(bundle)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026');

    const analytics = bundle.profile.analyticsAddon;
    const hasValidAnalytics = Boolean(
      analytics?.enabled && isValidGa4MeasurementId(analytics.measurementId)
    );
    const gaId = hasValidAnalytics ? analytics!.measurementId.trim().toUpperCase() : '';

    const ads = bundle.profile.adsAddon;
    const adsPubId = ads?.enabled ? normalizeAdSensePublisherId(ads.publisherId) : '';
    const hasValidAds = Boolean(ads?.enabled && adsPubId);

    const scriptSrcExtras = [
      hasValidAnalytics
        ? 'https://www.googletagmanager.com https://www.google-analytics.com'
        : '',
      hasValidAds
        ? 'https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net https://tpc.googlesyndication.com https://ep1.adtrafficquality.google https://ep2.adtrafficquality.google'
        : '',
    ]
      .filter(Boolean)
      .join(' ');

    const frameSrcExtras = hasValidAds
      ? ' https://googleads.g.doubleclick.net https://tpc.googlesyndication.com https://pagead2.googlesyndication.com https://ep1.adtrafficquality.google https://ep2.adtrafficquality.google'
      : '';

    const analyticsHeadSnippet = hasValidAnalytics
      ? `
  <!-- Optional Profile Add-On: Google Analytics (GA4) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=${gaId}"></script>
  <script>
    (function() {
      var respectDnt = ${analytics!.respectDoNotTrack !== false ? 'true' : 'false'};
      if (respectDnt && (navigator.doNotTrack === '1' || window.doNotTrack === '1')) {
        return;
      }
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      window.gtag = gtag;
      gtag('js', new Date());
      gtag('config', '${gaId}', { anonymize_ip: ${analytics!.anonymizeIp !== false ? 'true' : 'false'} });
    })();
  </script>`
      : '';

    const adsHeadSnippet = hasValidAds
      ? `
  <!-- Optional Profile Add-On: Google AdSense (${adsPubId}) -->
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsPubId}" crossorigin="anonymous"></script>`
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://giscus.app https://utteranc.es${scriptSrcExtras ? ' ' + scriptSrcExtras : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' https: http: data:; frame-src https://giscus.app https://utteranc.es${frameSrcExtras}; connect-src 'self' https: http:;" />
  <title>${this.escapeHtml(bundle.profile.displayName)} — Federated Profile & Webring</title>
  <link rel="alternate" type="application/json" title="Webring Manifest" href="./api/manifest.json" />
  <link rel="me" href="${this.escapeHtml(bundle.profile.siteUrl)}" />
  <script src="https://cdn.tailwindcss.com"></script>${analyticsHeadSnippet}${adsHeadSnippet}
  <script>window.__WEBRING_BUNDLE__ = ${safeJson};</script>
  <style>
    body.theme-neo-webring { background: #0f172a; color: #f8fafc; font-family: system-ui, -apple-system, sans-serif; }
    body.theme-minimal-zine { background: #fafaf9; color: #1c1917; font-family: Georgia, Cambria, serif; }
    body.theme-cyber-terminal { background: #050505; color: #4ade80; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    body.theme-cozy-scrapbook { background: #fef3c7; color: #451a03; font-family: system-ui, -apple-system, sans-serif; }
    .card-surface { background: rgba(30, 41, 59, 0.75); border: 1px solid rgba(148, 163, 184, 0.2); }
    body.theme-minimal-zine .card-surface { background: #ffffff; border: 1px solid #e7e5e4; color: #1c1917; }
    body.theme-cyber-terminal .card-surface { background: #0a0f0d; border: 1px solid #22c55e; color: #4ade80; }
    body.theme-cozy-scrapbook .card-surface { background: #fffbeb; border: 2px solid #d97706; color: #451a03; }
  </style>
</head>
<body class="theme-${this.escapeHtml(bundle.profile.theme)} min-h-screen antialiased pb-20">
  <div id="profile-root" class="max-w-5xl mx-auto px-4 sm:px-6 pt-6"></div>

  <script>
    (async function() {
      let data = window.__WEBRING_BUNDLE__;
      // Try fetching live JSON files if hosted over HTTP(S)
      if (window.location.protocol.startsWith('http')) {
        try {
          const [manifest, profile, albums, items, connections, didDocument] = await Promise.all([
            fetch('./api/manifest.json').then(r => r.ok ? r.json() : data.manifest),
            fetch('./api/profile.json').then(r => r.ok ? r.json() : data.profile),
            fetch('./api/albums.json').then(r => r.ok ? r.json() : data.albums),
            fetch('./api/items.json').then(r => r.ok ? r.json() : data.items),
            fetch('./api/connections.json').then(r => r.ok ? r.json() : data.connections),
            fetch('./.well-known/did.json').then(r => r.ok ? r.json() : data.didDocument)
          ]);
          data = { manifest, profile, albums, items, connections, didDocument };
        } catch (err) {
          console.warn('Using embedded bundle fallback:', err);
        }
      }

      const root = document.getElementById('profile-root');
      const { profile, albums, items, connections } = data;

      function esc(str) {
        return String(str || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function safeUrl(url) {
        const raw = String(url || '').trim();
        if (!raw) return '#';
        const lower = raw.toLowerCase();
        if (
          lower.startsWith('https://') ||
          lower.startsWith('http://') ||
          lower.startsWith('webring://') ||
          lower.startsWith('./') ||
          lower.startsWith('/') ||
          lower.startsWith('media/')
        ) {
          return esc(raw);
        }
        return '#blocked-unsafe-url';
      }

      const allowedThemes = ['neo-webring', 'minimal-zine', 'cyber-terminal', 'cozy-scrapbook'];
      const activeTheme = allowedThemes.includes(profile.theme) ? profile.theme : 'neo-webring';
      document.body.className = 'theme-' + activeTheme + ' min-h-screen antialiased pb-20';

      function buildDeepLink(action, targetUrl, title, mediaUrl, category) {
        const params = new URLSearchParams();
        params.set('action', action);
        params.set('targetUrl', String(targetUrl || ''));
        if (title) params.set('title', String(title));
        params.set('authorUrl', String(profile.siteUrl || ''));
        params.set('authorName', String(profile.displayName || ''));
        if (mediaUrl) params.set('mediaUrl', String(mediaUrl));
        if (category) params.set('category', String(category));
        return esc('webring://interact?' + params.toString());
      }

      function getEndorsementsFor(canonicalUrl) {
        return (connections.endorsements || []).filter(e => e.targetCanonicalUrl === canonicalUrl);
      }

      function getCommentsFor(canonicalUrl) {
        const fromEndorsements = getEndorsementsFor(canonicalUrl).filter(e => e.type === 'comment');
        const fromOwn = (items.items || [])
          .filter(i => i.type === 'comment' && i.targetUrl === canonicalUrl)
          .map(i => ({
            authorSiteUrl: profile.siteUrl,
            authorName: profile.displayName,
            commentary: i.commentary,
            sourceItemUrl: i.canonicalUrl,
            createdAt: i.createdAt
          }));
        const seen = new Set();
        return [...fromEndorsements, ...fromOwn].filter(c => {
          if (seen.has(c.sourceItemUrl)) return false;
          seen.add(c.sourceItemUrl);
          return true;
        });
      }

      window.toggleLiveCommentThread = function(containerId, canonicalUrl) {
        const el = document.getElementById(containerId);
        if (!el) return;
        if (!el.classList.contains('hidden')) {
          el.classList.add('hidden');
          el.innerHTML = '';
          return;
        }
        el.classList.remove('hidden');
        const cfg = profile.commentConfig || {};
        if (cfg.provider === 'giscus' && cfg.giscusRepo) {
          const script = document.createElement('script');
          script.src = 'https://giscus.app/client.js';
          script.setAttribute('data-repo', cfg.giscusRepo);
          if (cfg.giscusRepoId) script.setAttribute('data-repo-id', cfg.giscusRepoId);
          script.setAttribute('data-category', cfg.giscusCategory || 'General');
          if (cfg.giscusCategoryId) script.setAttribute('data-category-id', cfg.giscusCategoryId);
          script.setAttribute('data-mapping', 'specific');
          script.setAttribute('data-term', canonicalUrl);
          script.setAttribute('data-reactions-enabled', '1');
          script.setAttribute('data-emit-metadata', '0');
          script.setAttribute('data-theme', 'dark');
          script.crossOrigin = 'anonymous';
          script.async = true;
          el.innerHTML = '';
          el.appendChild(script);
        } else if (cfg.provider === 'utterances' && cfg.giscusRepo) {
          const script = document.createElement('script');
          script.src = 'https://utteranc.es/client.js';
          script.setAttribute('repo', cfg.giscusRepo);
          script.setAttribute('issue-term', canonicalUrl);
          script.setAttribute('theme', 'github-dark');
          script.crossOrigin = 'anonymous';
          script.async = true;
          el.innerHTML = '';
          el.appendChild(script);
        } else {
          el.innerHTML = '<p class="text-xs opacity-75">Configure your GitHub repository in Webring Studio Publish Settings to enable live Giscus / Utterances threads.</p>';
        }
      };

      // Ring bars. Prev / Next / Random are baked in at publish; on click they re-read the ring's
      // hub so removed or hidden sites are skipped, falling back to the baked link on any failure.
      const webringBars = (connections.webrings || []).map((ring, ringIndex) => {
        const count = typeof ring.memberCount === 'number' ? ring.memberCount : 3;
        const homeHref = safeUrl(ring.directoryUrl || ring.hubUrl);
        const single = ring.prevSiteUrl && ring.prevSiteUrl === ring.nextSiteUrl;
        const navLink = (nav, href, label) =>
          '<a href="' + safeUrl(href) + '" data-ring-nav="' + nav + '" data-ring-index="' + ringIndex + '" rel="noopener noreferrer" class="hover:underline">' + label + '</a>';
        const links = count <= 1
          ? ''
          : single
            ? navLink('next', ring.nextSiteUrl, 'Neighbour →')
            : (ring.prevSiteUrl ? navLink('prev', ring.prevSiteUrl, '← Prev Site') : '') +
              (count > 2 ? navLink('random', ring.directoryUrl || ring.hubUrl, 'Random') : '') +
              (ring.nextSiteUrl ? navLink('next', ring.nextSiteUrl, 'Next Site →') : '');
        return \`
        <div class="card-surface rounded-xl px-4 py-2.5 mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div class="flex items-center gap-2">
            <span class="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-semibold">WEBRING</span>
            <a href="\${homeHref}" target="_blank" rel="noopener noreferrer" class="font-bold hover:underline">\${esc(ring.name)}</a>
            <span class="opacity-70 hidden sm:inline">— \${esc(ring.description || '')}</span>
          </div>
          <div class="flex items-center gap-3 font-medium">
            \${links}
            <a href="\${buildDeepLink('join-ring', ring.hubUrl, ring.name)}" class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30">Join Ring</a>
          </div>
        </div>
      \`;
      }).join('');

      // Hub-supplied addresses are untrusted: absolute https only, no credentials
      function ringSiteUrl(value) {
        try {
          const u = new URL(String(value || ''));
          if (u.protocol !== 'https:' || u.username || u.password) return null;
          return u.origin + u.pathname.replace(/\\/+$/, '');
        } catch (e) {
          return null;
        }
      }

      async function fetchRingHub(hubUrl) {
        const controller = new AbortController();
        const timer = setTimeout(function() { controller.abort(); }, 2000);
        try {
          const res = await fetch(hubUrl, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: controller.signal });
          if (!res.ok) return null;
          const text = await res.text();
          if (text.length > 1000000) return null;
          const doc = JSON.parse(text);
          if (!doc || !Array.isArray(doc.members) || doc.status === 'closed') return null;
          return doc;
        } catch (e) {
          return null;
        } finally {
          clearTimeout(timer);
        }
      }

      root.addEventListener('click', async function(ev) {
        const anchor = ev.target && ev.target.closest ? ev.target.closest('a[data-ring-nav]') : null;
        if (!anchor) return;
        const ring = (connections.webrings || [])[Number(anchor.getAttribute('data-ring-index'))];
        const hubUrl = ring ? ringSiteUrl(ring.hubUrl) : null;
        if (!hubUrl) return;
        ev.preventDefault();
        const nav = anchor.getAttribute('data-ring-nav');
        const fallback = anchor.getAttribute('href');
        let target = null;
        const doc = await fetchRingHub(ring.hubUrl);
        if (doc) {
          const me = ringSiteUrl(profile.siteUrl);
          const rotation = [];
          doc.members.forEach(function(m) {
            const url = m ? ringSiteUrl(m.siteUrl) : null;
            if (url && (m.inRotation !== false || url === me) && rotation.indexOf(url) === -1) rotation.push(url);
          });
          const others = rotation.filter(function(u) { return u !== me; });
          const idx = rotation.indexOf(me);
          if (nav === 'random') {
            target = others.length ? others[Math.floor(Math.random() * others.length)] : null;
          } else if (idx !== -1 && rotation.length > 1) {
            const step = nav === 'prev' ? -1 : 1;
            target = rotation[(idx + step + rotation.length) % rotation.length];
          }
        }
        const destination = target || fallback;
        if (destination && destination.charAt(0) !== '#') window.location.assign(destination);
      });

      const albumsHtml = (albums.albums || []).map(album => {
        const photosHtml = (album.photos || []).map(photo => {
          const likes = getEndorsementsFor(photo.canonicalUrl);
          return \`
            <div class="card-surface rounded-xl overflow-hidden flex flex-col justify-between">
              <div>
                <a href="\${safeUrl(photo.url)}" target="_blank" rel="noopener noreferrer" class="block aspect-[4/3] overflow-hidden bg-black/20">
                  <img src="\${safeUrl(photo.thumbUrl || photo.url)}" alt="\${esc(photo.altText || photo.caption)}" class="w-full h-full object-cover hover:scale-105 transition-transform duration-300" />
                </a>
                <div class="p-3.5">
                  <p class="text-sm font-medium mb-1">\${esc(photo.caption || 'Untitled Photo')}</p>
                  <div class="flex flex-wrap gap-1 mb-2">
                    \${(photo.tags || []).map(t => \`<span class="text-[11px] opacity-70">#\${esc(t)}</span>\`).join(' ')}
                  </div>
                  \${likes.length > 0 ? \`
                    <div class="text-[11px] opacity-80 bg-pink-500/10 border border-pink-500/20 rounded px-2 py-1 mb-2">
                      ♥ Liked/Shared by \${likes.map(l => esc(l.authorName)).join(', ')}
                    </div>
                  \` : ''}
                </div>
              </div>
              <div class="px-3.5 pb-3 pt-1 flex items-center justify-between border-t border-white/10 text-xs">
                <a href="\${safeUrl(photo.canonicalUrl)}" class="opacity-60 hover:opacity-100" title="Canonical Schema Index">Index ID</a>
                <div class="flex gap-2">
                  <a href="\${buildDeepLink('like', photo.canonicalUrl, photo.caption || album.title, photo.url, 'photo')}" class="px-2.5 py-1 rounded bg-pink-500/20 text-pink-300 hover:bg-pink-500/30 font-medium">♥ Like</a>
                  <a href="\${buildDeepLink('share', photo.canonicalUrl, photo.caption || album.title, photo.url, 'photo')}" class="px-2.5 py-1 rounded bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 font-medium">↻ Share</a>
                </div>
              </div>
            </div>
          \`;
        }).join('');

        return \`
          <div class="mb-8">
            <div class="flex items-baseline justify-between mb-3">
              <div>
                <h3 class="text-xl font-bold">\${esc(album.title)}</h3>
                <p class="text-sm opacity-75">\${esc(album.description || '')}</p>
              </div>
              <a href="\${buildDeepLink('share', album.canonicalUrl, album.title, album.coverUrl, 'photo')}" class="text-xs px-3 py-1 rounded-lg bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30">Share Album</a>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              \${photosHtml}
            </div>
          </div>
        \`;
      }).join('');

      const itemsHtml = (items.items || []).map(item => {
        const badgeColor = item.type === 'post'
          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
          : item.type === 'like'
          ? 'bg-pink-500/20 text-pink-300'
          : item.type === 'recommendation'
          ? 'bg-amber-500/20 text-amber-300'
          : item.type === 'comment'
          ? 'bg-purple-500/20 text-purple-300'
          : 'bg-sky-500/20 text-sky-300';
        const endorsements = getEndorsementsFor(item.canonicalUrl).filter(e => e.type !== 'comment');
        const comments = getCommentsFor(item.canonicalUrl);
        const isSelfPost = item.type === 'post' && (!item.targetUrl || item.targetUrl === item.canonicalUrl);
        const liveContainerId = 'live-comments-' + esc(item.id);
        const hasLiveProvider = profile.commentConfig && profile.commentConfig.provider && profile.commentConfig.provider !== 'none';

        return \`
          <div class="card-surface rounded-xl p-4 flex flex-col justify-between \${item.type === 'post' ? 'md:col-span-2' : ''}">
            <div>
              <div class="flex items-center justify-between gap-2 mb-2">
                <span class="text-xs uppercase tracking-wider font-bold px-2.5 py-0.5 rounded-full \${badgeColor}">\${item.type === 'post' ? '📝 Wall Post' : esc(item.type)}</span>
                <span class="text-xs opacity-60">\${esc(item.category)} \${item.rating && item.type !== 'post' && item.type !== 'comment' ? '• ' + '★'.repeat(Math.min(5, Math.max(1, Number(item.rating) || 5))) : ''}</span>
              </div>
              \${item.mediaUrl ? \`<img src="\${safeUrl(item.mediaUrl)}" class="w-full \${item.type === 'post' ? 'max-h-80' : 'h-40'} object-cover rounded-lg mb-3" />\` : ''}
              <h4 class="font-bold text-base mb-1">
                \${isSelfPost ? \`<span>\${esc(item.title)}</span>\` : \`<a href="\${safeUrl(item.targetUrl)}" target="_blank" rel="noopener noreferrer" class="hover:underline">\${esc(item.title)} ↗</a>\`}
              </h4>
              \${item.targetAuthorName ? \`<p class="text-xs opacity-70 mb-2">\${item.type === 'comment' ? 'Replying to' : 'Source'}: <a href="\${safeUrl(item.targetAuthorUrl || item.targetUrl)}" target="_blank" rel="noopener noreferrer" class="underline">\${esc(item.targetAuthorName)}</a></p>\` : ''}
              <p class="text-sm opacity-90 mb-3 whitespace-pre-line">\${esc(item.commentary || '')}</p>
              <div class="flex flex-wrap gap-1.5 mb-3">
                \${(item.tags || []).map(t => \`<span class="text-xs px-2 py-0.5 rounded bg-white/5 opacity-75">#\${esc(t)}</span>\`).join('')}
              </div>
              \${endorsements.length > 0 ? \`
                <div class="text-xs opacity-85 bg-emerald-500/10 border border-emerald-500/20 rounded px-2.5 py-1.5 mb-3">
                  ↻ Endorsed by \${endorsements.map(e => esc(e.authorName)).join(', ')}
                </div>
              \` : ''}
              \${comments.length > 0 ? \`
                <div class="mt-3 mb-3 pt-2.5 border-t border-white/10 space-y-2">
                  <p class="text-xs font-bold opacity-80">💬 Comments (\${comments.length})</p>
                  \${comments.map(c => \`
                    <div class="p-2.5 rounded-lg bg-black/20 border border-white/10 text-xs space-y-1">
                      <div class="flex items-center justify-between">
                        <a href="\${safeUrl(c.authorSiteUrl)}" target="_blank" rel="noopener noreferrer" class="font-bold text-indigo-300 hover:underline">\${esc(c.authorName)}</a>
                      </div>
                      <p class="opacity-90 whitespace-pre-line">\${esc(c.commentary || '')}</p>
                    </div>
                  \`).join('')}
                </div>
              \` : ''}
              <div id="\${liveContainerId}" class="hidden mt-3 mb-3 p-3 rounded-xl bg-black/30 border border-indigo-500/30"></div>
            </div>
            <div class="pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs">
              <a href="\${safeUrl(item.canonicalUrl)}" class="opacity-60 hover:opacity-100">Schema URI</a>
              <div class="flex flex-wrap gap-2">
                <a href="\${buildDeepLink('like', item.canonicalUrl, item.title, item.mediaUrl, item.category)}" class="px-2.5 py-1 rounded bg-pink-500/20 text-pink-300 hover:bg-pink-500/30 font-medium">♥ Like</a>
                <a href="\${buildDeepLink('comment', item.canonicalUrl, item.title, item.mediaUrl, 'comment')}" class="px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 font-medium">💬 Comment</a>
                <a href="\${buildDeepLink('share', item.targetUrl, item.title, item.mediaUrl, item.category)}" class="px-2.5 py-1 rounded bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 font-medium">↻ Re-Share</a>
                \${hasLiveProvider ? \`<button data-container="\${liveContainerId}" data-canonical="\${esc(item.canonicalUrl)}" onclick="window.toggleLiveCommentThread(this.getAttribute('data-container'), this.getAttribute('data-canonical'))" class="px-2.5 py-1 rounded bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 font-medium">💬 Live Thread</button>\` : ''}
              </div>
            </div>
          </div>
        \`;
      }).join('');

      const friendsHtml = (connections.friends || []).map(friend => \`
        <a href="\${safeUrl(friend.siteUrl)}" target="_blank" rel="noopener noreferrer" class="card-surface rounded-xl p-3.5 flex items-center gap-3 hover:border-indigo-400/50 transition">
          <img src="\${safeUrl(friend.avatarUrl || 'https://api.dicebear.com/7.x/shapes/svg?seed=' + encodeURIComponent(friend.displayName))}" class="w-12 h-12 rounded-full object-cover border border-white/20" />
          <div class="min-w-0 flex-1">
            <h4 class="font-bold text-sm truncate">\${esc(friend.displayName)}</h4>
            <p class="text-xs opacity-70 truncate">\${esc(friend.siteUrl)}</p>
            <div class="flex flex-wrap gap-1 mt-1">
              \${(friend.relationship || []).map(rel => \`<span class="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300">\${esc(rel)}</span>\`).join('')}
            </div>
          </div>
        </a>
      \`).join('');

      function renderAdSlot(slotId, label) {
        const adsCfg = profile.adsAddon;
        if (!adsCfg || !adsCfg.enabled || !adsCfg.publisherId || !/^[0-9]{5,20}$/.test(String(slotId || '').trim())) {
          return '';
        }
        const cleanClient = esc(adsCfg.publisherId);
        const cleanSlot = esc(String(slotId).trim());
        return \`
          <div class="card-surface rounded-xl p-3 mb-8 text-center overflow-hidden" data-ad-position="\${esc(label)}">
            <p class="text-[10px] uppercase tracking-wider opacity-50 mb-1.5">Sponsored • \${esc(label)}</p>
            <ins class="adsbygoogle"
                 style="display:block"
                 data-ad-client="\${cleanClient}"
                 data-ad-slot="\${cleanSlot}"
                 data-ad-format="auto"
                 data-full-width-responsive="true"></ins>
          </div>
        \`;
      }

      const headerAdHtml = renderAdSlot(profile.adsAddon && profile.adsAddon.headerSlotId, 'Profile Banner Slot');
      const inFeedAdHtml = renderAdSlot(profile.adsAddon && profile.adsAddon.inFeedSlotId, 'In-Feed Slot');
      const footerAdHtml = renderAdSlot(profile.adsAddon && profile.adsAddon.footerSlotId, 'Footer Slot');

      root.innerHTML = \`
        \${webringBars}
        <div class="card-surface rounded-2xl overflow-hidden mb-8 shadow-xl">
          \${profile.bannerUrl ? \`<div class="h-48 sm:h-60 w-full overflow-hidden bg-slate-800"><img src="\${safeUrl(profile.bannerUrl)}" class="w-full h-full object-cover" /></div>\` : ''}
          <div class="p-6 sm:p-8 flex flex-col sm:flex-row sm:items-end justify-between gap-6 \${profile.bannerUrl ? '-mt-16' : ''}">
            <div class="flex flex-col sm:flex-row sm:items-end gap-5">
              \${profile.avatarUrl ? \`<img src="\${safeUrl(profile.avatarUrl)}" class="w-28 h-28 rounded-2xl object-cover border-4 border-slate-900 shadow-lg bg-slate-800" />\` : ''}
              <div>
                <div class="flex flex-wrap items-center gap-2">
                  <h1 class="text-2xl sm:text-3xl font-extrabold">\${esc(profile.displayName)}</h1>
                  <span class="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono" title="Verified Ed25519 DID Identity">\${esc(profile.did)}</span>
                </div>
                <p class="text-sm opacity-80 mt-1">\${esc(profile.tagline || '')}</p>
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <a href="\${buildDeepLink('friend', profile.siteUrl, profile.displayName, profile.avatarUrl)}" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow">
                + Add to Friend Ring
              </a>
              <a href="./api/manifest.json" target="_blank" rel="noopener noreferrer" class="px-3 py-2 rounded-xl card-surface text-xs font-mono hover:opacity-80">
                JSON API
              </a>
            </div>
          </div>
          <div class="px-6 sm:px-8 pb-6">
            <p class="text-base leading-relaxed max-w-3xl mb-4">\${esc(profile.bio || '')}</p>
            <div class="flex flex-wrap gap-2 mb-4">
              \${(profile.interests || []).map(tag => \`<span class="text-xs px-3 py-1 rounded-full bg-white/10 font-medium">#\${esc(tag)}</span>\`).join('')}
            </div>
            <div class="flex flex-wrap gap-4 text-xs opacity-80 pt-3 border-t border-white/10">
              \${profile.location ? \`<span>📍 \${esc(profile.location)}</span>\` : ''}
              \${profile.atprotoHandle ? \`<span>🦋 ATProto: @\${esc(profile.atprotoHandle)}</span>\` : ''}
              \${(profile.customLinks || []).map(l => \`<a href="\${safeUrl(l.url)}" target="_blank" rel="noopener noreferrer" class="underline hover:opacity-100">🔗 \${esc(l.label)}</a>\`).join('')}
            </div>
          </div>
        </div>

        \${headerAdHtml}

        <section class="mb-12">
          <h2 class="text-2xl font-bold mb-4 flex items-center gap-2">📸 Photo Albums</h2>
          \${albumsHtml || '<p class="opacity-60 text-sm">No photo albums published yet.</p>'}
        </section>

        \${inFeedAdHtml}

        <section class="mb-12">
          <h2 class="text-2xl font-bold mb-4 flex items-center gap-2">✨ Shared Items & Things I Like</h2>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            \${itemsHtml || '<p class="opacity-60 text-sm">No shared or liked items yet.</p>'}
          </div>
        </section>

        \${(connections.friends || []).length > 0 ? \`
        <section class="mb-12">
          <h2 class="text-2xl font-bold mb-4 flex items-center gap-2">🤝 Friend Ring & Connections (\${(connections.friends || []).length})</h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            \${friendsHtml}
          </div>
        </section>
        \` : ''}

        \${footerAdHtml}

        <footer class="text-center text-xs opacity-60 pt-8 border-t border-white/10">
          <p>Self-contained static profile powered by <strong>Webring Studio JSON Protocol v\${esc(data.manifest.schemaVersion)}</strong> • Cryptographically signed via <code>\${esc(profile.did)}</code></p>
        </footer>
      \`;

      // Initialize any rendered AdSense slots
      if (profile.adsAddon && profile.adsAddon.enabled && typeof window !== 'undefined') {
        const adNodes = root.querySelectorAll('ins.adsbygoogle');
        adNodes.forEach(() => {
          try {
            (window.adsbygoogle = window.adsbygoogle || []).push({});
          } catch (e) {}
        });
      }

      // Optional GA4 Webring interaction click tracking
      if (profile.analyticsAddon && profile.analyticsAddon.enabled && profile.analyticsAddon.trackRingInteractions !== false && typeof window.gtag === 'function') {
        root.addEventListener('click', function(ev) {
          const anchor = ev.target && ev.target.closest ? ev.target.closest('a[href^="webring://"]') : null;
          if (anchor) {
            window.gtag('event', 'webring_interact', {
              href: anchor.getAttribute('href') || ''
            });
          }
        });
      }
    })();
  </script>
</body>
</html>`;
  }

  private escapeHtml(str: string): string {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}


function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only absolute http(s) URLs make it into links; anything else is dropped. */
function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * A plain, script-free page listing a hosted ring's members, so the ring is browsable without
 * JavaScript and "Random" has somewhere to land when scripts are off.
 */
export function buildRingDirectoryHtml(doc: WebringHubDocument): string {
  const closed = doc.status === 'closed';
  const members = doc.members
    .map((m) => {
      const href = safeExternalUrl(m.siteUrl);
      const name = escapeHtml(m.displayName.slice(0, 120));
      return href
        ? `<li><a href="${escapeHtml(href)}" rel="noopener">${name}</a> <span>${escapeHtml(new URL(href).host)}</span></li>`
        : '';
    })
    .join('\n      ');
  const joinLink = `webring://interact?action=join-ring&targetUrl=${encodeURIComponent(doc.hubUrl)}&title=${encodeURIComponent(doc.name)}`;
  const maintainer = safeExternalUrl(doc.maintainerUrl);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https: data:;" />
  <title>${escapeHtml(doc.name)} · Webring</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; color: #1e293b; background: #f8fafc; }
    @media (prefers-color-scheme: dark) { body { color: #e2e8f0; background: #0f172a; } a { color: #a5b4fc; } }
    li { margin: 0.35rem 0; } li span { opacity: 0.6; font-size: 0.85em; }
    .note { opacity: 0.75; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>${escapeHtml(doc.name)}</h1>
  <p>${escapeHtml(doc.description)}</p>
  ${
    closed
      ? '<p><strong>This ring has closed.</strong></p>'
      : `<h2>Members (${doc.members.length})</h2>
  <ol>
      ${members}
  </ol>
  <h2>Join this ring</h2>
  <p>Membership is curated${maintainer ? ` by <a href="${escapeHtml(maintainer)}" rel="noopener">the maintainer</a>` : ''}. In Webring Studio, <a href="${escapeHtml(joinLink)}">open this ring</a> (or paste the hub address below into Friends &amp; Webrings → Join a ring), then send the maintainer the request link Studio gives you.</p>
  <p class="note">Hub: <code>${escapeHtml(doc.hubUrl)}</code></p>`
  }
</body>
</html>
`;
}
