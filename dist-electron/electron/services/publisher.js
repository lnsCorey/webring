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
const GITHUB_API_BASE = 'https://api.github.com';
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
     * Generates the site to a staging folder and pushes it to a GitHub repository branch via the
     * GitHub REST "Git Data" API (blobs/trees/commits), then enables/updates GitHub Pages for that
     * repo to serve from the branch. Requires a Personal Access Token with `repo` scope (classic)
     * or Contents: Read & Write + Pages: Read & Write (fine-grained).
     */
    async publishToGitHubPages(settings, stagingDir) {
        const owner = (settings.githubOwner || '').trim();
        const repo = (settings.githubRepo || '').trim();
        const branch = (settings.githubBranch || 'gh-pages').trim();
        const token = (settings.githubToken || '').trim();
        if (!owner || !repo || !token) {
            return {
                success: false,
                mode: 'github-pages',
                destination: '',
                filesPublished: 0,
                message: 'GitHub Pages deploy requires an owner, repository name, and access token.',
            };
        }
        const genResult = this.generator.generateToDirectory(stagingDir);
        const customDomain = (settings.githubCustomDomain || '').trim();
        if (customDomain) {
            fs.writeFileSync(path.join(stagingDir, 'CNAME'), `${customDomain}\n`, 'utf8');
            genResult.filesWritten.push('CNAME');
        }
        const gh = this.githubRequest.bind(this, token);
        const repoPath = `/repos/${owner}/${repo}`;
        try {
            // 0. Confirm up front that the token can actually push, so a permissions problem fails fast
            // with a clear message instead of after reads (and maybe a branch creation) have succeeded.
            const repoInfoRes = await gh(repoPath);
            if (repoInfoRes.status !== 200) {
                throw new Error(`Repository ${owner}/${repo} not found or token lacks access (HTTP ${repoInfoRes.status})${this.githubErrorDetail(repoInfoRes.body)}`);
            }
            const repoInfoBody = repoInfoRes.body;
            if (repoInfoBody.permissions && repoInfoBody.permissions.push === false) {
                throw new Error(`Resource not accessible by personal access token — it can read ${owner}/${repo} but not push to it. ` +
                    `For a classic token, grant the "repo" scope; for a fine-grained token, grant "Contents: Read and write" ` +
                    `(and "Pages: Read and write" to auto-enable Pages) on this repository, then save your settings again.`);
            }
            // 1. Resolve (or create) the target branch's current commit + tree.
            let baseCommitSha;
            const refRes = await gh(`${repoPath}/git/ref/heads/${encodeURIComponent(branch)}`);
            if (refRes.status === 200) {
                baseCommitSha = refRes.body.object.sha;
            }
            else if (refRes.status === 404) {
                const defaultBranch = repoInfoBody.default_branch;
                const defaultRefRes = await gh(`${repoPath}/git/ref/heads/${encodeURIComponent(defaultBranch)}`);
                if (defaultRefRes.status !== 200) {
                    throw new Error(`Repository ${owner}/${repo} has no commits yet; push an initial commit first.`);
                }
                const defaultSha = defaultRefRes.body.object.sha;
                const createRefRes = await gh(`${repoPath}/git/refs`, 'POST', {
                    ref: `refs/heads/${branch}`,
                    sha: defaultSha,
                });
                if (createRefRes.status !== 201) {
                    throw new Error(`Failed to create branch "${branch}" (HTTP ${createRefRes.status})${this.githubErrorDetail(createRefRes.body)}`);
                }
                baseCommitSha = defaultSha;
            }
            else {
                throw new Error(`Failed to resolve branch "${branch}" (HTTP ${refRes.status})${this.githubErrorDetail(refRes.body)}`);
            }
            const baseCommitRes = await gh(`${repoPath}/git/commits/${baseCommitSha}`);
            if (baseCommitRes.status !== 200) {
                throw new Error(`Failed to read base commit (HTTP ${baseCommitRes.status})${this.githubErrorDetail(baseCommitRes.body)}`);
            }
            const baseTreeSha = baseCommitRes.body.tree.sha;
            // 2. Upload every file in the staging dir as a blob. GitHub's abuse-detection rate limiter
            // flags concurrent writes to this endpoint, so these go one at a time (retried internally
            // with backoff by githubRequest on 403/429) rather than in parallel chunks.
            const files = this.listFilesRecursive(stagingDir);
            const treeEntries = [];
            for (const relPath of files) {
                const content = fs.readFileSync(path.join(stagingDir, relPath)).toString('base64');
                const blobRes = await gh(`${repoPath}/git/blobs`, 'POST', {
                    content,
                    encoding: 'base64',
                });
                if (blobRes.status !== 201) {
                    throw new Error(`Failed to upload "${relPath}" (HTTP ${blobRes.status})${this.githubErrorDetail(blobRes.body)}`);
                }
                treeEntries.push({
                    path: relPath,
                    mode: '100644',
                    type: 'blob',
                    sha: blobRes.body.sha,
                });
            }
            // 3. Create a new tree + commit on top of the branch's current state, then fast-forward the ref.
            const treeRes = await gh(`${repoPath}/git/trees`, 'POST', {
                base_tree: baseTreeSha,
                tree: treeEntries,
            });
            if (treeRes.status !== 201) {
                throw new Error(`Failed to create tree (HTTP ${treeRes.status})${this.githubErrorDetail(treeRes.body)}`);
            }
            const newTreeSha = treeRes.body.sha;
            const commitRes = await gh(`${repoPath}/git/commits`, 'POST', {
                message: `Publish site via Webring Studio (${genResult.filesWritten.length} files)`,
                tree: newTreeSha,
                parents: [baseCommitSha],
            });
            if (commitRes.status !== 201) {
                throw new Error(`Failed to create commit (HTTP ${commitRes.status})${this.githubErrorDetail(commitRes.body)}`);
            }
            const newCommitSha = commitRes.body.sha;
            const updateRefRes = await gh(`${repoPath}/git/refs/heads/${encodeURIComponent(branch)}`, 'PATCH', {
                sha: newCommitSha,
                force: true,
            });
            if (updateRefRes.status !== 200) {
                throw new Error(`Failed to update branch "${branch}" (HTTP ${updateRefRes.status})${this.githubErrorDetail(updateRefRes.body)}`);
            }
            // 4. Ensure GitHub Pages is configured to serve from this branch (best-effort; not fatal).
            let pagesNote = '';
            try {
                const pagesCreateRes = await gh(`${repoPath}/pages`, 'POST', {
                    source: { branch, path: '/' },
                });
                if (pagesCreateRes.status === 201) {
                    pagesNote = ' GitHub Pages was enabled for this repo.';
                }
                else if (pagesCreateRes.status === 409) {
                    await gh(`${repoPath}/pages`, 'PUT', { source: { branch, path: '/' } });
                }
            }
            catch {
                pagesNote = ' (Could not confirm GitHub Pages site settings — check them in the repo settings.)';
            }
            return {
                success: true,
                mode: 'github-pages',
                destination: `https://github.com/${owner}/${repo}/tree/${branch}`,
                filesPublished: genResult.filesWritten.length,
                message: `Pushed ${genResult.filesWritten.length} files to ${owner}/${repo}@${branch}.${pagesNote}`,
            };
        }
        catch (err) {
            return {
                success: false,
                mode: 'github-pages',
                destination: `${owner}/${repo}`,
                filesPublished: 0,
                message: `GitHub Pages deploy failed: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
    /**
     * Verifies the stored GitHub token can see the repo and reports branch/Pages status, without
     * publishing anything — used by the "Check Repo Access" button.
     */
    async checkGitHubRepo(settings) {
        const owner = (settings.githubOwner || '').trim();
        const repo = (settings.githubRepo || '').trim();
        const branch = (settings.githubBranch || 'gh-pages').trim();
        const token = (settings.githubToken || '').trim();
        if (!owner || !repo || !token) {
            return { success: false, message: 'Enter an owner, repository name, and access token first.' };
        }
        const gh = this.githubRequest.bind(this, token);
        const repoPath = `/repos/${owner}/${repo}`;
        const repoRes = await gh(repoPath);
        if (repoRes.status === 401) {
            return { success: false, message: 'GitHub rejected the token (401 Unauthorized).' };
        }
        if (repoRes.status === 404) {
            return { success: false, message: `Repository ${owner}/${repo} was not found, or the token can't see it.` };
        }
        if (repoRes.status !== 200) {
            return { success: false, message: `GitHub returned HTTP ${repoRes.status}.` };
        }
        const repoInfoBody = repoRes.body;
        const defaultBranch = repoInfoBody.default_branch;
        const canPush = repoInfoBody.permissions?.push !== false;
        if (!canPush) {
            return {
                success: false,
                defaultBranch,
                canPush: false,
                message: `Token can read ${owner}/${repo} but can't push to it. For a classic token, grant the ` +
                    `"repo" scope; for a fine-grained token, grant "Contents: Read and write" on this repo.`,
            };
        }
        const refRes = await gh(`${repoPath}/git/ref/heads/${encodeURIComponent(branch)}`);
        const branchExists = refRes.status === 200;
        const pagesRes = await gh(`${repoPath}/pages`);
        const pagesEnabled = pagesRes.status === 200;
        const pagesUrl = pagesEnabled ? pagesRes.body.html_url : undefined;
        return {
            success: true,
            defaultBranch,
            branchExists,
            canPush,
            pagesEnabled,
            pagesUrl,
            message: branchExists
                ? `Connected to ${owner}/${repo}. Branch "${branch}" exists.${pagesEnabled ? ' GitHub Pages is already enabled.' : ' GitHub Pages is not yet enabled — it will be enabled on first deploy.'}`
                : `Connected to ${owner}/${repo}. Branch "${branch}" doesn't exist yet — it will be created from "${defaultBranch}" on first deploy.`,
        };
    }
    /**
     * GitHub aggressively secondary-rate-limits concurrent writes to mutating endpoints (like blob
     * creation), returning 403 with a `retry_after`/Retry-After hint rather than a scope/permission
     * error. We retry those (and raw 429s) with backoff instead of failing the whole deploy on one
     * unlucky request.
     */
    async githubRequest(token, urlPath, method = 'GET', body, attempt = 1) {
        const res = await fetch(`${GITHUB_API_BASE}${urlPath}`, {
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'webring-studio',
                ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        let parsed = {};
        try {
            parsed = text ? JSON.parse(text) : {};
        }
        catch {
            parsed = { raw: text };
        }
        const isRateLimited = res.status === 429 ||
            (res.status === 403 &&
                (res.headers.get('retry-after') ||
                    res.headers.get('x-ratelimit-remaining') === '0' ||
                    /rate limit/i.test(String(parsed.message || ''))));
        if (isRateLimited && attempt < 5) {
            const retryAfterHeader = Number(res.headers.get('retry-after'));
            const waitMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
                ? retryAfterHeader * 1000
                : 1000 * 2 ** attempt;
            await new Promise((resolve) => setTimeout(resolve, waitMs));
            return this.githubRequest(token, urlPath, method, body, attempt + 1);
        }
        return { status: res.status, body: parsed };
    }
    /** Extracts GitHub's human-readable `message` field from a response body, if present. */
    githubErrorDetail(body) {
        const msg = body?.message;
        return msg ? ` — ${msg}` : '';
    }
    listFilesRecursive(dir, prefix = '') {
        const out = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                out.push(...this.listFilesRecursive(path.join(dir, entry.name), relPath));
            }
            else {
                out.push(relPath);
            }
        }
        return out;
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
