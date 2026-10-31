import React, { useEffect, useState } from 'react';
import { Ban, Check, UserPlus, X } from 'lucide-react';

/** Someone who added this persona as a friend (database.ts FriendNotice). Never exported. */
export interface FriendNoticeView {
  siteUrl: string;
  displayName: string;
  avatarUrl: string;
  source: 'link' | 'ring';
  ringName: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

/** What Studio found in a friend-notice link (ringService.ts FriendNoticeReview). */
export interface FriendNoticeReviewView {
  sender: { siteUrl: string; displayName: string; avatarUrl: string; did: string; keyFingerprint: string };
  state: 'new' | 'already-friend' | 'blocked';
}

export interface AddBackTarget {
  siteUrl: string;
  displayName: string;
  avatarUrl: string;
}

const avatarFor = (name: string, url: string) =>
  url || `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(name)}`;

/**
 * "Added you": people whose signed link or verified connections.json says they added this persona.
 * Also reads a pasted (or opened) `webring://friend-notice` link. Nothing is added until the user
 * clicks Add back.
 */
export function FriendNoticesPanel(props: {
  notices: FriendNoticeView[];
  /** A link opened from outside Studio; reviewed as soon as it changes. */
  incomingLink: { link: string; at: number } | null;
  onReview: (link: string) => Promise<FriendNoticeReviewView>;
  onAccept: (link: string) => Promise<void>;
  onAddBack: (target: AddBackTarget) => Promise<void>;
  onDismiss: (siteUrl: string) => Promise<void>;
  onBlock: (target: AddBackTarget) => Promise<void>;
  errorMessage: (err: unknown) => string;
}) {
  const [link, setLink] = useState('');
  const [review, setReview] = useState<FriendNoticeReviewView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async (value = link) => {
    if (!value.trim()) return;
    setLink(value);
    setReview(null);
    setError(null);
    try {
      setReview(await props.onReview(value.trim()));
    } catch (err) {
      setError(props.errorMessage(err));
    }
  };

  useEffect(() => {
    if (props.incomingLink) void check(props.incomingLink.link);
  }, [props.incomingLink?.at]);

  const clear = () => {
    setLink('');
    setReview(null);
    setError(null);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(props.errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const sender = review?.sender;

  return (
    <div className="bg-slate-900 border border-amber-500/30 rounded-2xl p-5 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-bold text-sm flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-amber-300" />
          Added you{props.notices.length ? ` (${props.notices.length})` : ''}
        </h3>
        <p className="text-[11px] text-slate-500">
          From signed links people sent you, and friends lists of people in your rings. Private to you.
        </p>
      </div>

      {props.notices.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {props.notices.map((n) => (
            <div key={n.siteUrl} className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col gap-2.5">
              <div className="flex items-start gap-3 min-w-0">
                <img
                  src={avatarFor(n.displayName, n.avatarUrl)}
                  alt=""
                  className="w-10 h-10 rounded-full object-cover bg-slate-800 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-sm truncate">{n.displayName || n.siteUrl}</p>
                  <p className="text-xs text-indigo-400 font-mono truncate" title={n.siteUrl}>
                    {n.siteUrl}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {n.source === 'link' ? 'Sent you a signed link' : `Lists you as a friend · in ${n.ringName || 'a shared ring'}`}
                    {' · '}
                    {new Date(n.lastSeenAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => props.onAddBack(n))}
                  className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-xs font-semibold flex items-center gap-1"
                >
                  <UserPlus className="w-3.5 h-3.5" /> Add back
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => props.onDismiss(n.siteUrl))}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs"
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => props.onBlock(n))}
                  className="ml-auto text-slate-500 hover:text-rose-400 p-1"
                  title={`Block ${n.siteUrl}`}
                  aria-label={`Block ${n.displayName || n.siteUrl}`}
                >
                  <Ban className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void check();
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <input
          type="text"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="Got a link? Paste webring://friend-notice?token=…"
          className="flex-1 min-w-[14rem] px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono focus:border-indigo-500 focus:outline-none"
        />
        <button type="submit" className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold">
          Check link
        </button>
      </form>

      {error && (
        <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2">{error}</p>
      )}

      {sender && review && (
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex items-start gap-3 min-w-0">
            <img
              src={avatarFor(sender.displayName, sender.avatarUrl)}
              alt=""
              className="w-12 h-12 rounded-full object-cover bg-slate-800 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <strong>{sender.displayName}</strong>{' '}
                {review.state === 'already-friend' ? 'added you, and is already your friend.' : 'added you as a friend.'}
              </p>
              <p className="text-xs text-indigo-400 font-mono truncate" title={sender.siteUrl}>
                {sender.siteUrl}
              </p>
              <p className="text-[11px] text-emerald-400 mt-0.5" title={`Key fingerprint ${sender.keyFingerprint}`}>
                ✓ Signed by their site's key
              </p>
            </div>
          </div>
          {review.state === 'blocked' ? (
            <div className="flex items-center gap-2">
              <p className="text-xs text-slate-400">You've blocked this site, so it won't be added to Added you.</p>
              <button type="button" onClick={clear} className="ml-auto px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs">
                Close
              </button>
            </div>
          ) : review.state === 'already-friend' ? (
            <div className="flex justify-end">
              <button type="button" onClick={clear} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs">
                Close
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await props.onAccept(link.trim());
                    await props.onAddBack(sender);
                    clear();
                  })
                }
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-xs font-semibold flex items-center gap-1"
              >
                <UserPlus className="w-3.5 h-3.5" /> Add back
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await props.onAccept(link.trim());
                    clear();
                  })
                }
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs flex items-center gap-1"
              >
                <Check className="w-3.5 h-3.5" /> Keep for later
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={clear}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs flex items-center gap-1"
              >
                <X className="w-3.5 h-3.5" /> Ignore
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await props.onBlock(sender);
                    clear();
                  })
                }
                className="ml-auto text-slate-500 hover:text-rose-400 text-xs flex items-center gap-1"
              >
                <Ban className="w-3.5 h-3.5" /> Block
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
