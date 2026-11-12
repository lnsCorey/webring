/**
 * "Sign in with GitHub" for the setup wizard, using GitHub's OAuth device flow: Studio shows a short
 * code, the user approves it on github.com, and Studio receives a token. The device flow needs only
 * the app's public client ID: no client secret, no callback server, nothing outside the engine.
 *
 * The token is stored like a pasted access token (sealed with the OS keychain, per persona, never
 * exported). Pending device codes live only in memory.
 */

/**
 * Public client ID of the Webring Studio GitHub OAuth App (device flow enabled). Forks and
 * development builds can use their own with WEBRING_GITHUB_CLIENT_ID.
 */
export const GITHUB_OAUTH_CLIENT_ID = '';

/**
 * Create public repos and push to them. A repo named `<login>.github.io` is served by GitHub Pages
 * from its default branch, so the wizard doesn't need the broader `repo` scope.
 */
export const GITHUB_OAUTH_SCOPE = 'public_repo';

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  status: number;
  text(): Promise<string>;
}>;

export function githubClientId(): string {
  return (process.env.WEBRING_GITHUB_CLIENT_ID || GITHUB_OAUTH_CLIENT_ID).trim();
}

export interface DeviceLoginStart {
  /** Opaque id for polling; the device code itself never leaves the engine */
  loginId: string;
  userCode: string;
  verificationUri: string;
  expiresAt: string;
  intervalSeconds: number;
}

export type DeviceLoginPoll =
  | { status: 'pending'; intervalSeconds: number }
  | { status: 'approved'; token: string; scope: string }
  | { status: 'expired' | 'denied' | 'error'; message: string };

interface PendingLogin {
  deviceCode: string;
  expiresAt: number;
  intervalSeconds: number;
}

async function readJson(res: { text(): Promise<string> }): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return { raw: text };
  }
}

export class GitHubDeviceLogin {
  private pending = new Map<string, PendingLogin>();

  constructor(
    private fetchImpl: FetchLike = (url, init) => fetch(url, init),
    private clientId: () => string = githubClientId,
    private now: () => number = Date.now
  ) {}

  public isConfigured(): boolean {
    return Boolean(this.clientId());
  }

  public async start(): Promise<DeviceLoginStart> {
    const clientId = this.clientId();
    if (!clientId) {
      throw new Error(
        "Sign in with GitHub isn't available in this build. Use an access token instead (Publish tab → GitHub Pages)."
      );
    }
    const res = await this.fetchImpl('https://github.com/login/device/code', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'webring-studio' },
      body: JSON.stringify({ client_id: clientId, scope: GITHUB_OAUTH_SCOPE }),
    });
    const body = await readJson(res);
    if (res.status !== 200 || typeof body.device_code !== 'string' || typeof body.user_code !== 'string') {
      const detail = typeof body.error_description === 'string' ? body.error_description : `HTTP ${res.status}`;
      throw new Error(`GitHub didn't start the sign-in: ${detail}`);
    }
    const intervalSeconds = Math.max(5, Number(body.interval) || 5);
    const expiresAt = this.now() + Math.max(60, Number(body.expires_in) || 900) * 1000;
    const loginId = `login-${this.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    this.pending.set(loginId, { deviceCode: body.device_code, expiresAt, intervalSeconds });
    return {
      loginId,
      userCode: body.user_code,
      verificationUri: typeof body.verification_uri === 'string' ? body.verification_uri : 'https://github.com/login/device',
      expiresAt: new Date(expiresAt).toISOString(),
      intervalSeconds,
    };
  }

  /** Asks GitHub once whether the user has approved the code. */
  public async poll(loginId: string): Promise<DeviceLoginPoll> {
    const login = this.pending.get(loginId);
    if (!login) return { status: 'error', message: 'That sign-in has finished or was never started. Start again.' };
    if (this.now() > login.expiresAt) {
      this.pending.delete(loginId);
      return { status: 'expired', message: 'The code expired before it was approved. Start again for a new code.' };
    }
    const res = await this.fetchImpl('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'webring-studio' },
      body: JSON.stringify({
        client_id: this.clientId(),
        device_code: login.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    const body = await readJson(res);
    if (typeof body.access_token === 'string' && body.access_token) {
      this.pending.delete(loginId);
      return { status: 'approved', token: body.access_token, scope: typeof body.scope === 'string' ? body.scope : '' };
    }
    switch (body.error) {
      case 'authorization_pending':
        return { status: 'pending', intervalSeconds: login.intervalSeconds };
      case 'slow_down':
        login.intervalSeconds = Math.max(login.intervalSeconds + 5, Number(body.interval) || 0);
        return { status: 'pending', intervalSeconds: login.intervalSeconds };
      case 'expired_token':
        this.pending.delete(loginId);
        return { status: 'expired', message: 'The code expired before it was approved. Start again for a new code.' };
      case 'access_denied':
        this.pending.delete(loginId);
        return { status: 'denied', message: 'The sign-in was cancelled on GitHub.' };
      default:
        this.pending.delete(loginId);
        return {
          status: 'error',
          message: `GitHub sign-in failed: ${typeof body.error_description === 'string' ? body.error_description : body.error || `HTTP ${res.status}`}`,
        };
    }
  }

  /**
   * Polls until approved, refused, expired or `maxWaitMs` passes (then reports pending), sleeping
   * GitHub's requested interval between tries.
   */
  public async waitForApproval(
    loginId: string,
    maxWaitMs: number,
    sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
  ): Promise<DeviceLoginPoll> {
    const deadline = this.now() + maxWaitMs;
    for (;;) {
      const result = await this.poll(loginId);
      if (result.status !== 'pending') return result;
      if (this.now() + result.intervalSeconds * 1000 > deadline) return result;
      await sleep(result.intervalSeconds * 1000);
    }
  }
}
