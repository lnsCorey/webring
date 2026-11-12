import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Circle,
  Copy,
  ExternalLink,
  Globe,
  KeyRound,
  Laptop,
  Loader2,
  RefreshCw,
  UploadCloud,
  Users,
  Wand2,
  X,
} from 'lucide-react';
import {
  ConfigureSiteResult,
  githubPagesSiteUrl,
  LiveSiteCheck,
  SetupStatus,
  SetupStepId,
} from '../shared/setup';
import { siteUrlToDidWeb } from '../shared/schema';

/** The engine calls the wizard uses (see electron/preload.ts). */
export interface SetupApi {
  getSetupStatus: (options?: { checkGitHub?: boolean }) => Promise<SetupStatus>;
  githubLoginAvailable: () => Promise<boolean>;
  githubLoginStart: () => Promise<{ loginId: string; userCode: string; verificationUri: string; expiresAt: string; intervalSeconds: number }>;
  githubLoginPoll: (
    loginId: string
  ) => Promise<{ status: 'pending'; intervalSeconds: number } | { status: 'approved'; login: string } | { status: 'expired' | 'denied' | 'error'; message: string }>;
  githubConnectToken: (token: string) => Promise<{ login: string }>;
  setupConfigureSite: (options?: { repoName?: string; allowAddressChange?: boolean }) => Promise<ConfigureSiteResult>;
  setupPublish: () => Promise<{ success: boolean; message: string }>;
  setupCheckLive: () => Promise<LiveSiteCheck>;
  setupDismiss: (dismissed: boolean) => Promise<unknown>;
  openExternal: (url: string) => Promise<unknown>;
}

type Screen = 'welcome' | SetupStepId | 'next';
const SCREENS: Screen[] = ['welcome', 'profile', 'github', 'site', 'published', 'live', 'next'];
const STEP_LABELS: Record<SetupStepId, string> = {
  profile: 'Your name',
  github: 'GitHub',
  site: 'Address',
  published: 'Publish',
  live: 'Live',
};

const fieldClass =
  'w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm focus:border-indigo-500 focus:outline-none';
const primaryButton =
  'inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold';
const secondaryButton =
  'inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-sm';

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function StepIcon({ state }: { state: 'done' | 'todo' | 'attention' }) {
  if (state === 'done') return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
  if (state === 'attention') return <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />;
  return <Circle className="w-4 h-4 text-slate-600 shrink-0" />;
}

/** A small picture of the two halves: the app on your computer and your public site. */
function HowItWorksDiagram() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-3 text-xs">
      <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-1.5">
        <div className="flex items-center gap-2 font-semibold text-indigo-300">
          <Laptop className="w-4 h-4" /> On your computer
        </div>
        <p className="text-slate-400 leading-relaxed">
          Webring Studio keeps your posts, photos, friends and your private signing key in a local database. Only you
          can see it.
        </p>
      </div>
      <div className="flex sm:flex-col items-center justify-center gap-1 text-slate-500">
        <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 font-semibold">Publish →</span>
        <span className="px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 font-semibold">← Sync</span>
      </div>
      <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-1.5">
        <div className="flex items-center gap-2 font-semibold text-emerald-300">
          <Globe className="w-4 h-4" /> Your public site
        </div>
        <p className="text-slate-400 leading-relaxed">
          Plain web pages and signed files, hosted free on GitHub Pages. Anyone can visit, and friends' copies of
          Studio read it.
        </p>
      </div>
    </div>
  );
}

/**
 * The first-run setup wizard: from a new persona to a live, verified site on GitHub Pages, with
 * short explanations of how Studio works along the way. Progress comes from the engine, so the
 * wizard can be closed and resumed, and agrees with the MCP tools and with manual setup.
 */
export function SetupWizard(props: {
  api: SetupApi;
  profile: { displayName: string; bio: string; siteUrl: string };
  onSaveProfile: (changes: { displayName: string; bio: string }) => Promise<void>;
  onEnableSchedule: () => Promise<void>;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { api } = props;
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [screen, setScreen] = useState<Screen>('welcome');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Profile
  const [name, setName] = useState(props.profile.displayName === 'Your Name' ? '' : props.profile.displayName);
  const [bio, setBio] = useState(props.profile.bio);

  // GitHub
  const [deviceAvailable, setDeviceAvailable] = useState(true);
  const [login, setLogin] = useState<{ loginId: string; userCode: string; verificationUri: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [token, setToken] = useState('');
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Site
  const [customRepo, setCustomRepo] = useState('');
  const [showRepoName, setShowRepoName] = useState(false);
  const [needsAddressConfirm, setNeedsAddressConfirm] = useState(false);
  const [siteResult, setSiteResult] = useState<ConfigureSiteResult | null>(null);

  // Publish and live
  const [publishMessage, setPublishMessage] = useState('');
  const [live, setLive] = useState<LiveSiteCheck | null>(null);
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveTries = useRef(0);
  const [scheduleOn, setScheduleOn] = useState(false);

  const refresh = async (checkGitHub = false) => {
    const next = await api.getSetupStatus({ checkGitHub });
    setStatus(next);
    return next;
  };

  useEffect(() => {
    void (async () => {
      setDeviceAvailable(await api.githubLoginAvailable().catch(() => false));
      const first = await refresh(true);
      // Resume where the user left off; a brand-new persona starts with the explanation
      const doneCount = first.steps.filter((s) => s.state === 'done').length;
      setScreen(first.complete ? 'next' : doneCount === 0 ? 'welcome' : (first.nextStep as Screen));
    })();
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
      if (liveTimer.current) clearTimeout(liveTimer.current);
    };
  }, []);

  const go = (next: Screen) => {
    setError('');
    setScreen(next);
  };
  const advance = () => go(SCREENS[Math.min(SCREENS.length - 1, SCREENS.indexOf(screen) + 1)]);
  const back = () => go(SCREENS[Math.max(0, SCREENS.indexOf(screen) - 1)]);
  const stepState = (id: SetupStepId) => status?.steps.find((s) => s.id === id)?.state || 'todo';
  const stepDetail = (id: SetupStepId) => status?.steps.find((s) => s.id === id)?.detail || '';

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const finishLater = async () => {
    if (status && !status.complete) await api.setupDismiss(true).catch(() => undefined);
    props.onClose();
  };

  // --- Profile
  const saveProfile = () =>
    run(async () => {
      if (!name.trim()) throw new Error('Enter the name you want people to see.');
      await props.onSaveProfile({ displayName: name.trim(), bio: bio.trim() });
      await refresh();
      props.onChanged();
      advance();
    });

  // --- GitHub sign-in
  const schedulePoll = (loginId: string, seconds: number) => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = setTimeout(async () => {
      try {
        const res = await api.githubLoginPoll(loginId);
        if (res.status === 'pending') {
          schedulePoll(loginId, res.intervalSeconds);
        } else if (res.status === 'approved') {
          setLogin(null);
          await refresh(true);
          props.onChanged();
          go('site');
        } else {
          setLogin(null);
          setError(res.message);
        }
      } catch (err) {
        setLogin(null);
        setError(message(err));
      }
    }, seconds * 1000);
  };

  const startSignIn = () =>
    run(async () => {
      const started = await api.githubLoginStart();
      setLogin(started);
      setCopied(false);
      await api.openExternal(started.verificationUri);
      schedulePoll(started.loginId, started.intervalSeconds);
    });

  const cancelSignIn = () => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    setLogin(null);
  };

  const connectToken = () =>
    run(async () => {
      await api.githubConnectToken(token.trim());
      setToken('');
      await refresh(true);
      props.onChanged();
      go('site');
    });

  // --- Site
  const githubLogin = status?.githubLogin || '';
  const plannedRepo = customRepo.trim() || (githubLogin ? `${githubLogin}.github.io` : '');
  const plannedUrl = githubLogin ? githubPagesSiteUrl(githubLogin, plannedRepo) : '';

  const createSite = (allowAddressChange = false) =>
    run(async () => {
      try {
        const res = await api.setupConfigureSite({
          repoName: customRepo.trim() || undefined,
          allowAddressChange,
        });
        setSiteResult(res);
        setNeedsAddressConfirm(false);
        await refresh();
        props.onChanged();
      } catch (err) {
        const text = message(err);
        if (/changes its identity/.test(text)) setNeedsAddressConfirm(true);
        if (/won't overwrite/.test(text)) setShowRepoName(true);
        throw err;
      }
    });

  // --- Publish
  const publish = () =>
    run(async () => {
      setPublishMessage('');
      const res = await api.setupPublish();
      if (!res.success) throw new Error(res.message);
      setPublishMessage(res.message);
      await refresh();
      props.onChanged();
      liveTries.current = 0;
      go('live');
    });

  // --- Live check: polls while GitHub is still building or serving the previous copy
  const checkLive = async () => {
    if (liveTimer.current) clearTimeout(liveTimer.current);
    try {
      const res = await api.setupCheckLive();
      setLive(res);
      await refresh();
      if ((res.state === 'building' || res.state === 'stale') && liveTries.current < 30) {
        liveTries.current += 1;
        liveTimer.current = setTimeout(() => void checkLive(), 15_000);
      }
    } catch (err) {
      setError(message(err));
    }
  };

  useEffect(() => {
    if (screen === 'live') void checkLive();
    return () => {
      if (liveTimer.current) clearTimeout(liveTimer.current);
    };
  }, [screen]);

  const enableSchedule = () =>
    run(async () => {
      await props.onEnableSchedule();
      setScheduleOn(true);
    });

  const progress = (['profile', 'github', 'site', 'published', 'live'] as SetupStepId[]).map((id) => (
    <button
      key={id}
      type="button"
      onClick={() => go(id)}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition ${
        screen === id ? 'bg-indigo-600/30 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
      }`}
    >
      <StepIcon state={stepState(id)} />
      {STEP_LABELS[id]}
    </button>
  ));

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-wizard-title"
        className="w-full max-w-3xl max-h-[92vh] overflow-y-auto bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 p-6 pb-3">
          <div>
            <h2 id="setup-wizard-title" className="text-xl font-bold flex items-center gap-2">
              <Wand2 className="w-5 h-5 text-indigo-400" /> Set up your site
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              About 5 minutes. You can stop at any point and pick up where you left off.
            </p>
          </div>
          <button type="button" onClick={finishLater} className={secondaryButton} title="Close and finish later">
            <X className="w-4 h-4" /> Finish later
          </button>
        </div>
        <div className="px-6 flex flex-wrap gap-1">{progress}</div>

        <div className="p-6 space-y-5">
          {screen === 'welcome' && (
            <>
              <h3 className="text-lg font-semibold">Welcome! Here's how Webring Studio works</h3>
              <HowItWorksDiagram />
              <ul className="text-sm text-slate-300 space-y-2 list-disc list-inside">
                <li>
                  <strong>Nothing is public until you publish.</strong> Write and change as much as you like first.
                </li>
                <li>
                  <strong>Publish</strong> copies your site to the web. <strong>Sync</strong> fetches your friends'
                  sites into your feed. There's no central server: sites read each other's public files.
                </li>
                <li>
                  Your site lives on <strong>GitHub Pages</strong>, a free host. You'll need a free GitHub account;
                  Studio does the rest.
                </li>
              </ul>
            </>
          )}

          {screen === 'profile' && (
            <>
              <h3 className="text-lg font-semibold">What should people call you?</h3>
              <p className="text-sm text-slate-400">
                This is shown at the top of your site. You can change it, and add a photo and links, any time in{' '}
                <strong>Profile &amp; Identity</strong>.
              </p>
              <div className="space-y-3">
                <label className="block text-xs text-slate-400">
                  Your name
                  <input className={`${fieldClass} mt-1`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Devon K." autoFocus />
                </label>
                <label className="block text-xs text-slate-400">
                  A line about you (optional)
                  <input className={`${fieldClass} mt-1`} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Gardener, film photographer, tinkerer." />
                </label>
              </div>
            </>
          )}

          {screen === 'github' && (
            <>
              <h3 className="text-lg font-semibold">Connect your GitHub account</h3>
              <p className="text-sm text-slate-400">
                Studio uses GitHub to host your site for free. It will only create and update the repository that holds
                your public site. Your sign-in is kept in your computer's keychain and is never published.
              </p>
              {stepState('github') === 'done' && status?.githubLogin ? (
                <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-sm text-emerald-200 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> Signed in as <strong>{status.githubLogin}</strong>.
                </div>
              ) : login ? (
                <div className="p-5 rounded-2xl bg-slate-950 border border-indigo-500/40 space-y-3 text-center">
                  <p className="text-sm text-slate-300">
                    A GitHub page has opened in your browser. Enter this code there and click <strong>Authorize</strong>:
                  </p>
                  <div className="text-3xl font-mono font-bold tracking-[0.3em] text-white select-all">{login.userCode}</div>
                  <div className="flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      className={secondaryButton}
                      onClick={() => {
                        void navigator.clipboard.writeText(login.userCode);
                        setCopied(true);
                      }}
                    >
                      <Copy className="w-4 h-4" /> {copied ? 'Copied' : 'Copy code'}
                    </button>
                    <button type="button" className={secondaryButton} onClick={() => void api.openExternal(login.verificationUri)}>
                      <ExternalLink className="w-4 h-4" /> Open the GitHub page again
                    </button>
                    <button type="button" className={secondaryButton} onClick={cancelSignIn}>
                      Cancel
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 flex items-center justify-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Waiting for you to approve it on GitHub…
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {stepState('github') === 'attention' && (
                    <p className="text-sm text-amber-300">{stepDetail('github')}</p>
                  )}
                  {deviceAvailable ? (
                    <button type="button" className={primaryButton} disabled={busy} onClick={startSignIn}>
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} Sign in with GitHub
                    </button>
                  ) : (
                    <p className="text-sm text-slate-400">Sign in with GitHub isn't available in this build, so connect with an access token below.</p>
                  )}
                  <p className="text-xs text-slate-400">
                    No GitHub account?{' '}
                    <button type="button" className="text-indigo-300 hover:underline" onClick={() => void api.openExternal('https://github.com/signup')}>
                      Create one for free
                    </button>
                    , then come back here.
                  </p>
                  <div className="pt-1">
                    <button type="button" className="text-xs text-slate-400 hover:text-white underline" onClick={() => setShowToken((v) => !v || !deviceAvailable)}>
                      {showToken || !deviceAvailable ? 'Connect with an access token' : 'Use an access token instead (advanced)'}
                    </button>
                    {(showToken || !deviceAvailable) && (
                      <div className="mt-3 p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2 text-xs text-slate-300">
                        <ol className="list-decimal list-inside space-y-1">
                          <li>
                            <button
                              type="button"
                              className="text-indigo-300 hover:underline"
                              onClick={() =>
                                void api.openExternal('https://github.com/settings/tokens/new?scopes=public_repo&description=Webring%20Studio')
                              }
                            >
                              Open GitHub's token page
                            </button>{' '}
                            (the name and the <code>public_repo</code> permission are filled in for you).
                          </li>
                          <li>Choose an expiration (a year is fine), scroll down and click <strong>Generate token</strong>.</li>
                          <li>Copy the token (it starts with <code>ghp_</code>) and paste it here:</li>
                        </ol>
                        <div className="flex gap-2">
                          <input
                            type="password"
                            className={fieldClass}
                            value={token}
                            onChange={(e) => setToken(e.target.value)}
                            placeholder="ghp_…"
                            autoComplete="off"
                          />
                          <button type="button" className={primaryButton} disabled={busy || !token.trim()} onClick={connectToken}>
                            Connect
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {screen === 'site' && (
            <>
              <h3 className="text-lg font-semibold">Create your site</h3>
              {!githubLogin ? (
                <p className="text-sm text-amber-300">Connect GitHub first.</p>
              ) : siteResult || stepState('site') === 'done' ? (
                <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-sm text-emerald-200 space-y-1">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" /> {siteResult?.message || stepDetail('site')}
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm text-slate-400">
                    Studio will create a public repository called <strong>{plannedRepo}</strong> on your GitHub account.
                    Your site's address will be:
                  </p>
                  <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-1">
                    <div className="text-lg font-mono text-white">{plannedUrl}</div>
                    <div className="text-xs text-slate-500">
                      Your identity: <code>{siteUrlToDidWeb(plannedUrl)}</code>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400">
                    This address is how friends find you, and Studio signs everything you publish with it, so it's best
                    not to change it later. You can add your own domain name afterwards.
                  </p>
                  <button type="button" className="text-xs text-slate-400 hover:text-white underline" onClick={() => setShowRepoName((v) => !v)}>
                    Use a different repository name
                  </button>
                  {showRepoName && (
                    <label className="block text-xs text-slate-400">
                      Repository name (your site will be at {githubPagesSiteUrl(githubLogin, customRepo.trim() || 'webring')})
                      <input className={`${fieldClass} mt-1`} value={customRepo} onChange={(e) => setCustomRepo(e.target.value)} placeholder="webring" />
                    </label>
                  )}
                  {needsAddressConfirm ? (
                    <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-2 text-sm text-amber-100">
                      <p>
                        This persona already uses <strong>{props.profile.siteUrl}</strong>. Moving it changes your identity, and
                        friends will need to update their link to you.
                      </p>
                      <button type="button" className={primaryButton} disabled={busy} onClick={() => createSite(true)}>
                        Yes, move my site to {plannedUrl}
                      </button>
                    </div>
                  ) : (
                    <button type="button" className={primaryButton} disabled={busy} onClick={() => createSite(false)}>
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />} Create my site
                    </button>
                  )}
                </>
              )}
            </>
          )}

          {screen === 'published' && (
            <>
              <h3 className="text-lg font-semibold">Publish your site</h3>
              <p className="text-sm text-slate-400">
                Studio builds your site from what's on your computer, signs it with your key, and uploads it to GitHub.
                Later, only what changed is uploaded. Publish again whenever you want your changes to go public.
              </p>
              {stepState('published') === 'done' && !publishMessage && (
                <p className="text-sm text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> {stepDetail('published')}
                </p>
              )}
              {publishMessage && <p className="text-sm text-emerald-300">{publishMessage}</p>}
              <button type="button" className={primaryButton} disabled={busy || stepState('site') !== 'done'} onClick={publish}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}{' '}
                {busy ? 'Publishing…' : stepState('published') === 'done' ? 'Publish again' : 'Publish my site'}
              </button>
              {stepState('site') !== 'done' && <p className="text-xs text-amber-300">Create your site first.</p>}
            </>
          )}

          {screen === 'live' && (
            <>
              <h3 className="text-lg font-semibold">Going live</h3>
              <p className="text-sm text-slate-400">
                GitHub usually takes a minute or two to put a new site online, and may show the previous version for up
                to 10 minutes after later publishes. Studio checks that your site is reachable and signed with your key.
              </p>
              <div
                className={`p-4 rounded-2xl border text-sm flex items-start gap-2 ${
                  live?.state === 'live'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                    : live && ['building', 'stale', 'not-published'].includes(live.state)
                      ? 'bg-slate-950 border-slate-800 text-slate-300'
                      : live
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-100'
                        : 'bg-slate-950 border-slate-800 text-slate-300'
                }`}
              >
                {live?.state === 'live' ? (
                  <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                ) : live && !['building', 'stale'].includes(live.state) ? (
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                ) : (
                  <Loader2 className="w-4 h-4 mt-0.5 shrink-0 animate-spin" />
                )}
                <span>{live?.message || 'Checking your site…'}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={secondaryButton} onClick={() => { liveTries.current = 0; void checkLive(); }}>
                  <RefreshCw className="w-4 h-4" /> Check again
                </button>
                {live?.state === 'live' && (
                  <button type="button" className={primaryButton} onClick={() => void api.openExternal(`${live.siteUrl}/?v=${Date.now()}`)}>
                    <ExternalLink className="w-4 h-4" /> View my site
                  </button>
                )}
              </div>
            </>
          )}

          {screen === 'next' && (
            <>
              <h3 className="text-lg font-semibold">
                {status?.complete ? "You're online! What's next" : "What's next"}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-1.5">
                  <div className="font-semibold text-emerald-300 flex items-center gap-2">
                    <UploadCloud className="w-4 h-4" /> Publish after changes
                  </div>
                  <p className="text-slate-400">
                    New posts, photos and profile edits stay on your computer until you publish. The Publish tab shows
                    what's changed since last time.
                  </p>
                </div>
                <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-1.5">
                  <div className="font-semibold text-sky-300 flex items-center gap-2">
                    <RefreshCw className="w-4 h-4" /> Sync to see friends
                  </div>
                  <p className="text-slate-400">
                    Sync reads your friends' public sites and builds your feed here. Their likes and comments on your posts
                    arrive the same way.
                  </p>
                </div>
                <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-1.5">
                  <div className="font-semibold text-amber-300 flex items-center gap-2">
                    <Users className="w-4 h-4" /> Add a friend
                  </div>
                  <p className="text-slate-400">
                    In <strong>Friends &amp; Webrings</strong>, paste a friend's site address. Send them yours (
                    {status?.siteUrl}) so they can add you back, or join a webring.
                  </p>
                </div>
                <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="font-semibold text-indigo-300 flex items-center gap-2">
                    <Wand2 className="w-4 h-4" /> Put it on autopilot
                  </div>
                  <p className="text-slate-400">
                    Studio can sync every hour and publish once a day when something changed, while it's running in the
                    menu bar.
                  </p>
                  <button
                    type="button"
                    className={secondaryButton}
                    disabled={busy || scheduleOn || stepState('site') !== 'done'}
                    onClick={enableSchedule}
                  >
                    {scheduleOn ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Schedule on
                      </>
                    ) : (
                      'Turn on the schedule'
                    )}
                  </button>
                </div>
              </div>
            </>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-sm text-rose-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-6 pb-6">
          <button type="button" className={secondaryButton} onClick={back} disabled={screen === 'welcome' || busy}>
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          {screen === 'profile' ? (
            <button type="button" className={primaryButton} disabled={busy} onClick={saveProfile}>
              Save and continue <ArrowRight className="w-4 h-4" />
            </button>
          ) : screen === 'next' ? (
            <button type="button" className={primaryButton} onClick={props.onClose}>
              Done
            </button>
          ) : (
            <button
              type="button"
              className={screen === 'welcome' ? primaryButton : secondaryButton}
              disabled={busy}
              onClick={advance}
            >
              {screen === 'welcome' ? "Let's start" : stepState(screen as SetupStepId) === 'done' ? 'Continue' : 'Skip for now'}
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The Setup & Health checklist on the Publish tab: stays useful after setup (revoked sign-in, mismatched address, site down). */
export function SetupHealthCard(props: { status: SetupStatus | null; onOpenWizard: () => void; onRefresh: () => void }) {
  const { status } = props;
  if (!status) return null;
  const needsAttention = status.steps.some((s) => s.state === 'attention');
  return (
    <div
      className={`rounded-2xl p-5 border space-y-3 ${
        needsAttention ? 'bg-amber-500/5 border-amber-500/30' : 'bg-slate-900 border-slate-800'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-sm flex items-center gap-2">
          <Wand2 className="w-4 h-4 text-indigo-400" /> Setup &amp; Health
          {status.complete && !needsAttention && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">All good</span>
          )}
        </h3>
        <div className="flex gap-2">
          <button type="button" onClick={props.onRefresh} className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200" title="Check again, including GitHub">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={props.onOpenWizard} className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white">
            {status.complete ? 'Open setup' : 'Continue setup'}
          </button>
        </div>
      </div>
      <ul className="space-y-1.5">
        {status.steps.map((step) => (
          <li key={step.id} className="flex items-start gap-2 text-xs">
            <StepIcon state={step.state} />
            <span>
              <strong className="text-slate-200">{step.title}:</strong>{' '}
              <span className={step.state === 'attention' ? 'text-amber-200' : 'text-slate-400'}>{step.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
