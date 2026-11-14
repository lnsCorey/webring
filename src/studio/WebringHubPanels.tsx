import React, { useEffect, useState } from 'react';
import { BookOpen, Globe, Loader2, Plus, Search, ShieldCheck, Trash2, UserPlus, X } from 'lucide-react';

/**
 * Optional Webring Hubs (electron/services/webringHubService.ts,
 * docs/architecture/webring-hub.md). A hub is a third-party index: search results are hints
 * the user can turn into a normal Add Friend, and listing the site is an opt-in per hub.
 */

/** database.ts WebringHubRecord. Local only, never exported. */
export interface WebringHubView {
  url: string;
  title: string;
  addedAt: string;
  listMe: boolean;
  state: 'not-listed' | 'listed' | 'blocked' | 'key-changed' | 'error';
  lastListedAt?: string;
  lastPingAt?: string;
  pendingPingFor?: string;
  pendingSince?: string;
  lastError?: string;
  /** Extensions the hub advertises in /api/info. */
  extensions?: Array<{ id: string; version: string; apiVersion: number }>;
  infoCheckedAt?: string;
}

/** webringHubService.ts WebringHubKeyCheck. Shown, never stored. */
export interface WebringHubKeyCheckView {
  siteUrl: string;
  did: string;
  pinnedFingerprint: string;
  results: Array<{
    webringHubUrl: string;
    title: string;
    result: 'match' | 'mismatch' | 'not-listed' | 'error';
    since?: string;
    pinnedKeySeen?: boolean;
    currentOutcome?: string;
    rejectedKeys?: number;
    message?: string;
  }>;
}

/** Extensions Studio has a client for (webringHubService.ts KNOWN_WEBRING_HUB_EXTENSIONS). */
const EXTENSION_LABELS: Record<string, { label: string; apiVersion: number; hint: string }> = {
  'key-witness': {
    label: 'Key witness',
    apiVersion: 1,
    hint: 'Keeps a history of the signing keys it has seen, so Studio can compare a friend\'s key with it.',
  },
};

/** webringHubService.ts WebringHubSearchResult. Never stored. */
export interface WebringHubSearchResultView {
  siteUrl: string;
  did: string;
  displayName: string;
  handle: string;
  tagline: string;
  avatarUrl: string;
  interests: string[];
  verifiedAt: string;
  relation: 'self' | 'friend' | 'muted' | 'none';
}

export interface WebringHubApi {
  listWebringHubs: () => Promise<WebringHubView[]>;
  addWebringHub: (url: string) => Promise<WebringHubView>;
  removeWebringHub: (url: string) => Promise<WebringHubView[]>;
  searchWebringHub: (
    url: string,
    query: string,
    options?: { limit?: number; offset?: number }
  ) => Promise<{ webringHubUrl: string; total: number; results: WebringHubSearchResultView[] }>;
  setWebringHubListed: (url: string, listed: boolean) => Promise<WebringHubView>;
  checkKeyWithWebringHubs?: (siteUrl: string) => Promise<WebringHubKeyCheckView>;
}

const errorText = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

const formatTime = (iso?: string) => {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
};

const STATE_LABELS: Record<WebringHubView['state'], { label: string; className: string }> = {
  'not-listed': { label: 'Not listed', className: 'bg-slate-800 text-slate-300' },
  listed: { label: 'Listed', className: 'bg-emerald-500/20 text-emerald-300' },
  blocked: { label: 'Blocked by hub', className: 'bg-rose-500/20 text-rose-300' },
  'key-changed': { label: 'Key mismatch', className: 'bg-amber-500/20 text-amber-300' },
  error: { label: 'Error', className: 'bg-rose-500/20 text-rose-300' },
};

/** Shared loader: the persona's hubs, refreshed when the persona changes. */
export function useWebringHubs(api: WebringHubApi | undefined, personaKey: string) {
  const [webringHubs, setWebringHubs] = useState<WebringHubView[]>([]);
  const reload = async () => {
    if (!api) return;
    try {
      setWebringHubs(await api.listWebringHubs());
    } catch {
      setWebringHubs([]);
    }
  };
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, personaKey]);
  return { webringHubs, setWebringHubs, reload };
}

/**
 * Publish tab: which hubs this persona uses and whether the site is listed in each.
 */
export function WebringHubListingsPanel(props: {
  api: WebringHubApi | undefined;
  webringHubs: WebringHubView[];
  reload: () => Promise<void>;
  hasPublished: boolean;
  notify: (message: string) => void;
}) {
  const { api, webringHubs, reload, hasPublished, notify } = props;
  const [newUrl, setNewUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  if (!api) return null;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
      await reload();
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-base flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-indigo-400" /> Webring Hubs
          </h3>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Webring Hubs are optional, third-party servers that index Webring sites. Add one to search it from the
            Friends tab. Listing your site is up to you: the hub reads and verifies your published,
            signed files itself, and Studio asks it to re-read them after each publish. Your site never
            depends on a hub.
          </p>
        </div>
        <span className="text-[11px] text-slate-500">Stored locally per persona · never exported</span>
      </div>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newUrl.trim()) return;
          void run('add', async () => {
            const added = await api.addWebringHub(newUrl.trim());
            setNewUrl('');
            notify(`Added ${added.title}. Your site isn't listed there until you choose to list it.`);
          });
        }}
      >
        <input
          type="text"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          placeholder="https://hub.example"
          className="flex-1 min-w-[16rem] px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono"
        />
        <button
          type="submit"
          disabled={busy !== null || !newUrl.trim()}
          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-medium flex items-center gap-1.5"
        >
          {busy === 'add' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Add Webring Hub
        </button>
      </form>

      {error && <p className="text-xs text-rose-300">{error}</p>}

      {webringHubs.length === 0 ? (
        <p className="text-xs text-slate-500">No Webring Hubs yet.</p>
      ) : (
        <ul className="space-y-2">
          {webringHubs.map((d) => {
            const state = STATE_LABELS[d.state] || STATE_LABELS.error;
            return (
              <li key={d.url} className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-slate-200 flex items-center gap-2">
                      {d.title}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono ${state.className}`}>
                        {state.label}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono truncate">{d.url}</div>
                    {d.extensions && d.extensions.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {d.extensions.map((ext) => {
                          const known = EXTENSION_LABELS[ext.id];
                          const usable = !!known && known.apiVersion === ext.apiVersion;
                          return (
                            <span
                              key={ext.id}
                              className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                                usable ? 'bg-indigo-500/15 text-indigo-300' : 'bg-slate-800 text-slate-500'
                              }`}
                              title={
                                usable
                                  ? known.hint
                                  : 'An extension this version of Studio doesn\'t use. It\'s shown for information only.'
                              }
                            >
                              {usable ? known.label : ext.id} {ext.version}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <label
                      className={`flex items-center gap-1.5 text-xs ${hasPublished ? 'text-slate-200' : 'text-slate-500'}`}
                      title={hasPublished ? '' : 'Publish your site first'}
                    >
                      <input
                        type="checkbox"
                        checked={d.listMe}
                        disabled={busy !== null || (!hasPublished && !d.listMe)}
                        onChange={(e) => {
                          const listed = e.target.checked;
                          void run(d.url, async () => {
                            await api.setWebringHubListed(d.url, listed);
                            notify(listed ? `Your site is listed in ${d.title}.` : `Your listing was removed from ${d.title}.`);
                          });
                        }}
                        className="accent-indigo-500"
                      />
                      List my site
                    </label>
                    {busy === d.url && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
                    <button
                      type="button"
                      disabled={busy !== null || d.listMe}
                      title={d.listMe ? 'Unlist your site first' : 'Remove this Webring Hub'}
                      onClick={() => void run(`remove:${d.url}`, async () => void (await api.removeWebringHub(d.url)))}
                      className="p-1.5 rounded-lg hover:bg-slate-800 disabled:opacity-40 text-slate-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-4 gap-y-1">
                  {d.lastListedAt && <span>Listed {formatTime(d.lastListedAt)}</span>}
                  {d.lastPingAt && <span>Last re-read {formatTime(d.lastPingAt)}</span>}
                  {d.listMe && d.pendingPingFor && <span>Waiting for your live site to show the last publish</span>}
                </div>
                {d.state === 'key-changed' && (
                  <p className="text-[11px] text-amber-300">
                    This Webring Hub pinned a different signing key for your site. If you rotated your key with
                    Rotate Signing Key, publish again so it can follow the rotation; otherwise ask the hub's
                    operator to accept your new key.
                  </p>
                )}
                {d.lastError && <p className="text-[11px] text-rose-300">{d.lastError}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Friends tab: search a hub and copy a result into the Add Friend form. Nothing is added
 * or stored until the user submits that form, which crawls and verifies the site itself.
 */
export function WebringHubSearchPanel(props: {
  api: WebringHubApi | undefined;
  webringHubs: WebringHubView[];
  onUse: (result: WebringHubSearchResultView) => void;
  onManage: () => void;
}) {
  const { api, webringHubs, onUse, onManage } = props;
  const [webringHubUrl, setWebringHubUrl] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WebringHubSearchResultView[] | null>(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!webringHubs.some((d) => d.url === webringHubUrl)) {
      setWebringHubUrl(webringHubs[0]?.url || '');
      setResults(null);
    }
  }, [webringHubs, webringHubUrl]);

  if (!api) return null;

  const search = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!webringHubUrl) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.searchWebringHub(webringHubUrl, query);
      setResults(res.results);
      setTotal(res.total);
    } catch (err) {
      setError(errorText(err));
      setResults(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
      <div>
        <h3 className="font-bold text-base flex items-center gap-2">
          <Search className="w-4 h-4 text-indigo-400" /> Find People in a Webring Hub
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          Results come from a third-party Webring Hub and are only suggestions. Choosing one fills in the Add
          Friend form; Studio then reads and verifies that person's own site, exactly as if you'd typed the
          address. Search results aren't saved.
        </p>
      </div>

      {webringHubs.length === 0 ? (
        <p className="text-xs text-slate-500">
          You haven't added a Webring Hub yet.{' '}
          <button type="button" onClick={onManage} className="text-indigo-300 hover:underline">
            Add one in the Publish tab
          </button>
          .
        </p>
      ) : (
        <form onSubmit={search} className="flex flex-wrap gap-2">
          {webringHubs.length > 1 && (
            <select
              value={webringHubUrl}
              onChange={(e) => {
                setWebringHubUrl(e.target.value);
                setResults(null);
              }}
              className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs"
            >
              {webringHubs.map((d) => (
                <option key={d.url} value={d.url}>
                  {d.title}
                </option>
              ))}
            </select>
          )}
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Interests, names, places…"
            className="flex-1 min-w-[12rem] px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs"
          />
          <button
            type="submit"
            disabled={busy || !webringHubUrl}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-medium flex items-center gap-1.5"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            Search
          </button>
        </form>
      )}

      {error && <p className="text-xs text-rose-300">{error}</p>}

      {results && (
        <div className="space-y-2">
          <p className="text-[11px] text-slate-500">
            {results.length === 0 ? 'No matches.' : `Showing ${results.length} of ${total}.`}
          </p>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {results.map((r) => (
              <li key={r.siteUrl} className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex gap-3">
                {r.avatarUrl ? (
                  <img src={r.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center text-sm font-bold flex-shrink-0">
                    {(r.displayName || '?').slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="font-semibold text-sm text-slate-200 truncate">{r.displayName}</div>
                  <div className="text-[11px] text-slate-500 font-mono truncate flex items-center gap-1">
                    <Globe className="w-3 h-3 flex-shrink-0" /> {r.siteUrl}
                  </div>
                  {r.tagline && <p className="text-xs text-slate-400 line-clamp-2">{r.tagline}</p>}
                  {r.interests.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {r.interests.slice(0, 6).map((i) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                          {i}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="pt-1">
                    {r.relation === 'self' ? (
                      <span className="text-[11px] text-slate-500">This is you</span>
                    ) : r.relation === 'friend' ? (
                      <span className="text-[11px] text-emerald-300">Already a friend</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onUse(r)}
                        className="text-[11px] px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1"
                      >
                        <UserPlus className="w-3 h-3" /> Use in Add Friend
                        {r.relation === 'muted' && <span className="text-slate-500">(muted)</span>}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Friends tab: compares the key Studio pinned for a friend with what hubs running the
 * key-witness extension have seen. The answer is evidence for the user only. It's cleared when
 * dismissed and never changes the pinned key.
 */
export function KeyWitnessCheck(props: {
  api: WebringHubApi | undefined;
  webringHubs: WebringHubView[];
  siteUrl: string;
  /** The friend's key changed: show the check more prominently. */
  emphasized: boolean;
}) {
  const { api, webringHubs, siteUrl, emphasized } = props;
  const [check, setCheck] = useState<WebringHubKeyCheckView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!api?.checkKeyWithWebringHubs || webringHubs.length === 0) return null;

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      setCheck(await api.checkKeyWithWebringHubs!(siteUrl));
    } catch (err) {
      setCheck(null);
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const describe = (r: WebringHubKeyCheckView['results'][number]) => {
    const since = r.since ? ` since ${formatTime(r.since)}` : '';
    if (r.result === 'match') {
      return { tone: 'text-emerald-300', text: `has seen the same key you pinned${since}.` };
    }
    if (r.result === 'mismatch') {
      const how =
        r.currentOutcome === 'rotated'
          ? ' It accepted that key through a signed rotation from an earlier key.'
          : r.currentOutcome === 'operator-accepted'
          ? ' Its operator accepted that key by hand.'
          : '';
      const seen = r.pinnedKeySeen ? ' It also saw the key you pinned earlier.' : ' It has never seen the key you pinned.';
      return { tone: 'text-amber-300', text: `has a different key${since}.${how}${seen}` };
    }
    if (r.result === 'not-listed') return { tone: 'text-slate-400', text: "doesn't list this site." };
    return { tone: 'text-rose-300', text: `couldn't be asked${r.message ? `: ${r.message}` : '.'}` };
  };

  return (
    <div className={check || error ? 'w-full' : ''}>
      {!check && (
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className={`px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1 disabled:opacity-50 ${
            emphasized
              ? 'bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200'
              : 'bg-slate-800 hover:bg-slate-700'
          }`}
          title="Ask Webring Hubs that run the key-witness extension which key they have seen for this site. Nothing is stored and your pinned key isn't changed."
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
          Check with Webring Hubs
        </button>
      )}
      {error && <p className="text-[11px] text-rose-300 mt-1">{error}</p>}
      {check && (
        <div className="mt-1 p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] space-y-1">
          <div className="flex items-start justify-between gap-2">
            <span className="text-slate-400">
              Your pinned key: <code className="text-slate-300">{check.pinnedFingerprint.slice(0, 16)}…</code>
            </span>
            <button
              type="button"
              onClick={() => setCheck(null)}
              className="text-slate-500 hover:text-slate-300"
              aria-label="Close"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          {check.results.length === 0 ? (
            <p className="text-slate-400">
              None of your Webring Hubs run the key-witness extension, so there was no one to ask.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {check.results.map((r) => {
                const d = describe(r);
                return (
                  <li key={r.webringHubUrl} className={d.tone}>
                    <strong className="font-semibold">{r.title}</strong> {d.text}
                    {!!r.rejectedKeys && (
                      <span className="text-slate-400">
                        {' '}
                        It refused {r.rejectedKeys} other key{r.rejectedKeys === 1 ? '' : 's'} for this site.
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-slate-500">
            A Webring Hub is one more observer, not an authority. Decide for yourself, and confirm with your
            friend another way before trusting a new key.
          </p>
        </div>
      )}
    </div>
  );
}
