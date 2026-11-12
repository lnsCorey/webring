/**
 * Guided-setup status shared by the engine (`electron/services/setupService.ts`), the MCP tools
 * and the Studio setup wizard.
 */

export type SetupStepId = 'profile' | 'github' | 'site' | 'published' | 'live';
export type SetupStepState = 'done' | 'todo' | 'attention';

export interface SetupStep {
  id: SetupStepId;
  title: string;
  state: SetupStepState;
  /** Plain-language status or what to do next */
  detail: string;
}

export interface SetupStatus {
  steps: SetupStep[];
  /** The first step that isn't done, or null when everything is */
  nextStep: SetupStepId | null;
  complete: boolean;
  dismissed: boolean;
  githubLogin?: string;
  siteUrl: string;
  did: string;
}

export type LiveSiteState = 'not-published' | 'building' | 'live' | 'stale' | 'wrong-key' | 'unreachable' | 'errored';

export interface LiveSiteCheck {
  state: LiveSiteState;
  siteUrl: string;
  message: string;
  pagesBuild?: { status: string; message?: string; updatedAt?: string };
}

export interface ConfigureSiteResult {
  owner: string;
  repo: string;
  branch: string;
  siteUrl: string;
  did: string;
  created: boolean;
  message: string;
}

/** The public address GitHub Pages gives `<owner>/<repo>` (before any custom domain). */
export function githubPagesSiteUrl(owner: string, repo: string): string {
  const host = `https://${owner.trim().toLowerCase()}.github.io`;
  return repo.trim().toLowerCase() === `${owner.trim().toLowerCase()}.github.io` ? host : `${host}/${repo.trim()}`;
}
