import * as crypto from 'crypto';
import { ActivePersonaContext } from './personaManager';
import {
  githubPagesSiteUrl,
  GitHubUser,
  isUserPagesRepo,
  PagesBuildStatus,
  PublishResult,
  SitePublisher,
} from './publisher';
import { defaultJsonFetcher } from './ringCrawler';
import { publishTo, PublishPaths } from './jobs';
import { STORED_SECRET_PLACEHOLDER } from '../db/database';
import type {
  ConfigureSiteResult,
  LiveSiteCheck,
  LiveSiteState,
  SetupStatus,
  SetupStep,
  SetupStepId,
  SetupStepState,
} from '../../src/shared/setup';
import {
  isPlaceholderSiteUrl,
  PLACEHOLDER_SITE_URL,
  normalizeSiteUrl,
  PLACEHOLDER_DISPLAY_NAME,
  siteUrlToDidWeb,
} from '../../src/shared/schema';

/**
 * Guided setup: everything a new persona needs to get from "just installed" to "my site is live",
 * shared by the in-app wizard and the MCP tools so both always agree on progress. Progress is read
 * from the persona's real settings (not a separate checklist), so setting things up by hand counts.
 */

export type { ConfigureSiteResult, LiveSiteCheck, LiveSiteState, SetupStatus, SetupStep, SetupStepId, SetupStepState };

/** What the setup service needs from GitHub; `SitePublisher` provides it (tests pass a fake). */
export interface SetupGitHubApi {
  getGitHubUser(token: string): Promise<GitHubUser | null>;
  createPagesRepo: SitePublisher['createPagesRepo'];
  getPagesBuildStatus(token: string, owner: string, repo: string): Promise<PagesBuildStatus>;
}

export interface SetupDeps {
  github?: SetupGitHubApi;
  fetchJson?: (url: string) => Promise<unknown>;
  publish?: (ctx: ActivePersonaContext) => Promise<PublishResult>;
  now?: () => Date;
}

const STEP_TITLES: Record<SetupStepId, string> = {
  profile: 'Your name',
  github: 'Connect GitHub',
  site: 'Your site address',
  published: 'First publish',
  live: 'Site is live',
};

/** How long a successful "who is this token" answer is trusted before asking GitHub again. */
const GITHUB_USER_CACHE_MS = 5 * 60 * 1000;
const githubUserCache = new Map<string, { at: number; user: GitHubUser | null }>();

function tokenKey(personaId: string, token: string): string {
  return `${personaId}:${crypto.createHash('sha256').update(token).digest('hex').slice(0, 16)}`;
}

function githubApi(ctx: ActivePersonaContext, deps: SetupDeps): SetupGitHubApi {
  return deps.github || ctx.sitePublisher;
}

/** The stored GitHub token, decrypted; undefined when none is saved or the keychain is unavailable. */
function storedGitHubToken(ctx: ActivePersonaContext): string | undefined {
  const masked = ctx.db.getProfile().publishSettings;
  if (!masked.githubToken) return undefined;
  try {
    const token = ctx.db.withStoredCredentials(masked).githubToken?.trim();
    return token && token !== STORED_SECRET_PLACEHOLDER ? token : undefined;
  } catch {
    // Keychain unavailable (the stdio MCP server): the token exists but can't be used here
    return undefined;
  }
}

async function cachedGitHubUser(
  ctx: ActivePersonaContext,
  token: string,
  deps: SetupDeps,
  fresh = false
): Promise<GitHubUser | null> {
  const key = tokenKey(ctx.persona.id, token);
  const cached = githubUserCache.get(key);
  const now = (deps.now?.() || new Date()).getTime();
  if (!fresh && cached && now - cached.at < GITHUB_USER_CACHE_MS) return cached.user;
  const user = await githubApi(ctx, deps).getGitHubUser(token);
  githubUserCache.set(key, { at: now, user });
  return user;
}

/** The address GitHub Pages will serve this repo at, honouring a custom domain. */
export function expectedGitHubSiteUrl(owner: string, repo: string, customDomain?: string): string {
  const domain = (customDomain || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return domain ? normalizeSiteUrl(`https://${domain}`) : githubPagesSiteUrl(owner, repo);
}

/**
 * Where the persona stands. With `checkGitHub`, asks GitHub (at most every few minutes) whether
 * the saved token still works; otherwise only local settings are read.
 */
export async function getSetupStatus(
  ctx: ActivePersonaContext,
  options: { checkGitHub?: boolean } = {},
  deps: SetupDeps = {}
): Promise<SetupStatus> {
  const profile = ctx.db.getProfile();
  const settings = profile.publishSettings;
  const setupState = ctx.db.getSetupState();
  const steps: SetupStep[] = [];
  const add = (id: SetupStepId, state: SetupStepState, detail: string) =>
    steps.push({ id, title: STEP_TITLES[id], state, detail });

  const named = Boolean(profile.displayName?.trim()) && profile.displayName.trim() !== PLACEHOLDER_DISPLAY_NAME;
  add('profile', named ? 'done' : 'todo', named ? `Shown as "${profile.displayName}".` : 'Choose the name people see on your site.');

  // GitHub
  let githubLogin: string | undefined;
  const hasToken = Boolean(settings.githubToken);
  if (!hasToken) {
    add('github', 'todo', 'Sign in with GitHub so Studio can create your site and publish it.');
  } else if (options.checkGitHub) {
    const token = storedGitHubToken(ctx);
    if (!token) {
      add('github', 'done', 'A GitHub sign-in is saved. Open Webring Studio to check it still works.');
    } else {
      let user: GitHubUser | null = null;
      let unreachable = false;
      try {
        user = await cachedGitHubUser(ctx, token, deps);
      } catch {
        unreachable = true;
      }
      if (user) {
        githubLogin = user.login;
        add('github', 'done', `Signed in as ${user.login}.`);
      } else if (unreachable) {
        add('github', 'done', "A GitHub sign-in is saved (GitHub couldn't be reached to check it).");
      } else {
        add('github', 'attention', 'GitHub no longer accepts the saved sign-in (it may have been revoked). Sign in again.');
      }
    }
  } else {
    add('github', 'done', settings.githubOwner ? `Connected to GitHub as ${settings.githubOwner}.` : 'A GitHub sign-in is saved.');
  }

  // Site address and repo
  const owner = (settings.githubOwner || '').trim();
  const repo = (settings.githubRepo || '').trim();
  if (!owner || !repo) {
    add('site', 'todo', 'Create the GitHub repository that will hold your public site.');
  } else {
    const expected = expectedGitHubSiteUrl(owner, repo, settings.githubCustomDomain);
    const actual = normalizeSiteUrl(profile.siteUrl);
    if (isPlaceholderSiteUrl(profile.siteUrl)) {
      add('site', 'attention', `Your site address isn't set. For ${owner}/${repo} it should be ${expected}.`);
    } else if (actual.toLowerCase() !== expected.toLowerCase()) {
      add(
        'site',
        'attention',
        `Your site address is ${actual}, but ${owner}/${repo} is served at ${expected}. Friends won't find your site until these match.`
      );
    } else {
      add('site', 'done', `${actual} (from ${owner}/${repo}).`);
    }
  }

  // Published
  if (settings.lastPublishedAt) {
    add('published', 'done', `Last published ${new Date(settings.lastPublishedAt).toLocaleString()}.`);
  } else {
    add('published', 'todo', 'Publish to put your site online. Nothing is public until you do.');
  }

  // Live
  const lastCheck = setupState.lastLiveCheck;
  if (!settings.lastPublishedAt) {
    add('live', 'todo', 'After your first publish, Studio checks that your site is online and signed by you.');
  } else if (!lastCheck || (settings.lastPublishedAt && lastCheck.at < settings.lastPublishedAt && lastCheck.state !== 'live')) {
    add('live', 'todo', 'Check that your site is online.');
  } else if (lastCheck.state === 'live') {
    add('live', 'done', `Online and verified (checked ${new Date(lastCheck.at).toLocaleString()}).`);
  } else if (lastCheck.state === 'building' || lastCheck.state === 'stale') {
    add('live', 'todo', lastCheck.message);
  } else {
    add('live', 'attention', lastCheck.message);
  }

  const next = steps.find((s) => s.state !== 'done');
  return {
    steps,
    nextStep: next ? next.id : null,
    complete: !next,
    dismissed: Boolean(setupState.dismissedAt),
    ...(githubLogin ? { githubLogin } : {}),
    siteUrl: profile.siteUrl,
    did: profile.did,
  };
}

/**
 * Saves a GitHub token (from device sign-in or pasted) after checking whom it belongs to.
 * The token is sealed with the keychain like any publish secret.
 */
export async function connectGitHub(
  ctx: ActivePersonaContext,
  token: string,
  deps: SetupDeps = {}
): Promise<{ login: string; name?: string }> {
  const clean = token.trim();
  if (!clean) throw new Error('No GitHub token was given.');
  const user = await cachedGitHubUser(ctx, clean, deps, true);
  if (!user) throw new Error('GitHub rejected that token. Check it was copied in full, or sign in again.');
  const settings = ctx.db.getProfile().publishSettings;
  const signedInAsOther = settings.githubOwner && settings.githubOwner.toLowerCase() !== user.login.toLowerCase();
  ctx.db.updateProfile({
    publishSettings: {
      githubToken: clean,
      // Keep a repo the user already set up (it may belong to an organization); otherwise use their account
      ...(!settings.githubRepo || !signedInAsOther ? { githubOwner: user.login } : {}),
    },
  });
  return { login: user.login, ...(user.name ? { name: user.name } : {}) };
}


/**
 * Creates (or reuses) the repo for the site and points the persona at it: owner, repo, branch and
 * site address. Refuses to move an address that's already in use (friends, a previous publish),
 * since that changes the persona's identity, unless `allowAddressChange` is set.
 */
export async function configureGitHubSite(
  ctx: ActivePersonaContext,
  options: { repoName?: string; allowAddressChange?: boolean } = {},
  deps: SetupDeps = {}
): Promise<ConfigureSiteResult> {
  const token = storedGitHubToken(ctx);
  if (!token) throw new Error('Sign in with GitHub first.');
  const user = await cachedGitHubUser(ctx, token, deps);
  if (!user) throw new Error('GitHub no longer accepts the saved sign-in. Sign in again.');

  const owner = user.login;
  const repo = (options.repoName || `${owner}.github.io`).trim();
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(repo)) {
    throw new Error('A repository name can only use letters, numbers, ".", "-" and "_".');
  }

  const profile = ctx.db.getProfile();
  const settings = profile.publishSettings;
  const siteUrl = expectedGitHubSiteUrl(owner, repo, settings.githubCustomDomain);
  const currentUrl = normalizeSiteUrl(profile.siteUrl);
  const addressInUse =
    !isPlaceholderSiteUrl(profile.siteUrl) &&
    currentUrl.toLowerCase() !== siteUrl.toLowerCase() &&
    (Boolean(settings.lastPublishedAt) || ctx.db.getFriends().length > 0);
  if (addressInUse && !options.allowAddressChange) {
    throw new Error(
      `This persona already uses ${currentUrl}. Moving it to ${siteUrl} changes its identity (${siteUrlToDidWeb(currentUrl)}), ` +
        'and friends would need to update their link to you. Confirm the change to continue.'
    );
  }

  const result = await githubApi(ctx, deps).createPagesRepo(token, owner, repo);
  if (result.status === 'error') throw new Error(result.message);
  if (result.status === 'exists') {
    if (!result.canPush) throw new Error(`${owner}/${repo} exists but this sign-in can't publish to it.`);
    if (!result.isEmpty && !result.publishedByStudio) {
      throw new Error(
        `You already have a repository called ${repo} with other files in it, so Studio won't overwrite it. ` +
          'Choose another name, such as "webring" (your site would then be at ' +
          `${githubPagesSiteUrl(owner, 'webring')}).`
      );
    }
  }
  // A <login>.github.io repo is served from its default branch; other repos use gh-pages
  const branch = isUserPagesRepo(owner, repo) ? result.defaultBranch : 'gh-pages';

  // A handle still showing the placeholder address follows the new one
  const placeholderHandle = !profile.handle || profile.handle === new URL(PLACEHOLDER_SITE_URL).hostname;
  ctx.db.updateProfile({
    siteUrl,
    ...(placeholderHandle ? { handle: new URL(siteUrl).hostname } : {}),
    publishSettings: { githubOwner: owner, githubRepo: repo, githubBranch: branch },
  });
  ctx.db.updateSetupState({ lastLiveCheck: undefined });
  const created = result.status === 'created';
  return {
    owner,
    repo,
    branch,
    siteUrl,
    did: siteUrlToDidWeb(siteUrl),
    created,
    message: created
      ? `Created ${owner}/${repo}. Your site will be at ${siteUrl}.`
      : `Using your existing ${owner}/${repo}. Your site will be at ${siteUrl}.`,
  };
}

/** Publishes to the configured GitHub repo. */
export async function publishGitHubSite(
  ctx: ActivePersonaContext,
  paths: PublishPaths,
  deps: SetupDeps = {}
): Promise<PublishResult> {
  const settings = ctx.db.getProfile().publishSettings;
  if (!settings.githubOwner || !settings.githubRepo || !settings.githubToken) {
    return {
      success: false,
      mode: 'github-pages',
      destination: '',
      filesPublished: 0,
      message: 'Connect GitHub and create your site first.',
    };
  }
  const result = deps.publish ? await deps.publish(ctx) : await publishTo(ctx, 'github', paths);
  if (result.success) ctx.db.updateSetupState({ lastLiveCheck: undefined });
  return result;
}

/**
 * Checks the public site: has GitHub finished building it, is it reachable, is it signed with this
 * persona's key, and is it the latest publish (hosts cache pages for a few minutes).
 */
export async function checkLiveSite(ctx: ActivePersonaContext, deps: SetupDeps = {}): Promise<LiveSiteCheck> {
  const profile = ctx.db.getProfile();
  const settings = profile.publishSettings;
  const siteUrl = normalizeSiteUrl(profile.siteUrl);
  const now = deps.now?.() || new Date();
  const finish = (check: LiveSiteCheck): LiveSiteCheck => {
    ctx.db.updateSetupState({ lastLiveCheck: { at: now.toISOString(), state: check.state, message: check.message } });
    return check;
  };

  if (!settings.lastPublishedAt || isPlaceholderSiteUrl(profile.siteUrl)) {
    return { state: 'not-published', siteUrl, message: "Your site hasn't been published yet." };
  }

  let pagesBuild: PagesBuildStatus | undefined;
  const token = storedGitHubToken(ctx);
  if (token && settings.githubOwner && settings.githubRepo) {
    try {
      pagesBuild = await githubApi(ctx, deps).getPagesBuildStatus(token, settings.githubOwner, settings.githubRepo);
    } catch {
      pagesBuild = undefined;
    }
    if (pagesBuild?.status === 'errored') {
      return finish({ state: 'errored', siteUrl, pagesBuild, message: `GitHub Pages couldn't build your site: ${pagesBuild.message}` });
    }
    if (pagesBuild?.status === 'not-enabled') {
      return finish({
        state: 'errored',
        siteUrl,
        pagesBuild,
        message:
          `GitHub Pages isn't turned on for ${settings.githubOwner}/${settings.githubRepo}. Turn it on at ` +
          `https://github.com/${settings.githubOwner}/${settings.githubRepo}/settings/pages ` +
          `("Deploy from a branch", branch "${settings.githubBranch || 'gh-pages'}", folder "/ (root)").`,
      });
    }
  }

  // A query string asks the host's cache for a fresh copy
  const bust = `?check=${now.getTime()}`;
  const fetchJson = deps.fetchJson || ((url: string) => defaultJsonFetcher(url));
  let didDoc: { verificationMethod?: Array<{ publicKeyPem?: string }> };
  try {
    didDoc = (await fetchJson(`${siteUrl}/.well-known/did.json${bust}`)) as typeof didDoc;
  } catch (err) {
    const building = pagesBuild && (pagesBuild.status === 'building' || pagesBuild.status === 'queued');
    if (building || (!pagesBuild && now.getTime() - Date.parse(settings.lastPublishedAt) < 10 * 60 * 1000)) {
      return finish({
        state: 'building',
        siteUrl,
        ...(pagesBuild ? { pagesBuild } : {}),
        message: 'GitHub is still putting your site online. This usually takes a minute or two.',
      });
    }
    return finish({
      state: 'unreachable',
      siteUrl,
      ...(pagesBuild ? { pagesBuild } : {}),
      message: `Your site at ${siteUrl} couldn't be reached (${err instanceof Error ? err.message : String(err)}).`,
    });
  }

  const liveKey = (didDoc?.verificationMethod?.[0]?.publicKeyPem || '').trim();
  if (liveKey !== profile.publicKeyPem.trim()) {
    return finish({
      state: 'wrong-key',
      siteUrl,
      ...(pagesBuild ? { pagesBuild } : {}),
      message:
        `The site at ${siteUrl} isn't signed with this persona's key. Another site may be published there, ` +
        'or an older copy is still showing. Publish again, then check in a few minutes.',
    });
  }

  const publishedManifestAt = ctx.db.getPublishedManifestUpdatedAt();
  if (publishedManifestAt) {
    try {
      const manifest = (await fetchJson(`${siteUrl}/api/manifest.json${bust}`)) as { updatedAt?: string };
      if (manifest?.updatedAt && manifest.updatedAt < publishedManifestAt) {
        return finish({
          state: 'stale',
          siteUrl,
          ...(pagesBuild ? { pagesBuild } : {}),
          message: 'Your site is online, but GitHub is still showing the previous version. It updates within about 10 minutes.',
        });
      }
    } catch {
      // did.json verified; a missing manifest copy will show up at the next check
    }
  }

  return finish({ state: 'live', siteUrl, ...(pagesBuild ? { pagesBuild } : {}), message: `Your site is online at ${siteUrl}.` });
}

export function dismissSetup(ctx: ActivePersonaContext, dismissed = true): void {
  ctx.db.updateSetupState({ dismissedAt: dismissed ? new Date().toISOString() : undefined });
}
