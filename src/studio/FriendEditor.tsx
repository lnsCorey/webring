import React, { useState } from 'react';
import { CheckCircle2, Trash2 } from 'lucide-react';
import { FriendConnection, FriendVisibility, normalizeSiteUrl } from '../shared/schema';

/** Editable fields of a friend connection in the local ring. */
export interface FriendEdit {
  siteUrl: string;
  displayName: string;
  handle: string;
  avatarUrl: string;
  bio: string;
  relationship: string[];
  visibility: FriendVisibility;
}

const fieldClass =
  'w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm focus:border-indigo-500 focus:outline-none';
const labelClass = 'block text-[11px] text-slate-400 mb-1';

/**
 * Inline editor for a friend in the local ring. Keeps the friend's ID and addedAt timestamp,
 * and lets the user modify their display name, website URL, handle, avatar, bio, relationship
 * tags, and public/private visibility.
 */
export function FriendEditor(props: {
  friend: FriendConnection;
  onSave: (edit: FriendEdit) => Promise<void>;
  onCancel: () => void;
  errorMessage?: (err: unknown) => string;
}) {
  const { friend } = props;
  const [draft, setDraft] = useState({
    siteUrl: friend.siteUrl,
    displayName: friend.displayName,
    handle: friend.handle || '',
    avatarUrl: friend.avatarUrl || '',
    bio: friend.bio || '',
    relationship: (friend.relationship || []).join(', '),
    visibility: (friend.visibility === 'public' ? 'public' : 'private') as FriendVisibility,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<typeof draft>) => {
    setError(null);
    setDraft((d) => ({ ...d, ...patch }));
  };

  const urlChanged = (() => {
    const trimmed = draft.siteUrl.trim();
    if (!trimmed) return false;
    try {
      return normalizeSiteUrl(trimmed) !== normalizeSiteUrl(friend.siteUrl);
    } catch {
      return trimmed !== friend.siteUrl;
    }
  })();

  const previewAvatar =
    draft.avatarUrl.trim() ||
    `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(
      draft.displayName.trim() || friend.displayName
    )}`;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.siteUrl.trim() || !draft.displayName.trim()) {
      setError('Website URL and Display Name are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await props.onSave({
        siteUrl: draft.siteUrl.trim(),
        displayName: draft.displayName.trim(),
        handle: draft.handle.trim(),
        avatarUrl: draft.avatarUrl.trim(),
        bio: draft.bio.trim(),
        relationship: draft.relationship
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        visibility: draft.visibility,
      });
    } catch (err) {
      setError(props.errorMessage ? props.errorMessage(err) : err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-3">
      <div className="flex items-center justify-between gap-2 pb-1 border-b border-slate-800">
        <div className="flex items-center gap-2.5 min-w-0">
          <img
            src={previewAvatar}
            alt={draft.displayName || friend.displayName}
            className="w-9 h-9 rounded-full object-cover bg-slate-800 shrink-0"
          />
          <div className="min-w-0">
            <h4 className="font-bold text-xs text-indigo-300 uppercase tracking-wide">
              Editing Friend Details
            </h4>
            <p className="text-[11px] text-slate-400 truncate">
              {draft.displayName.trim() || friend.displayName}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Display Name *</label>
          <input
            type="text"
            required
            value={draft.displayName}
            onChange={(e) => set({ displayName: e.target.value })}
            placeholder="Devon K."
            className={fieldClass}
          />
        </div>
        <div>
          <label className={labelClass}>Friend's Website URL *</label>
          <input
            type="text"
            required
            value={draft.siteUrl}
            onChange={(e) => set({ siteUrl: e.target.value })}
            placeholder="https://friend.example"
            className={`${fieldClass} font-mono text-xs`}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Handle (Optional — defaults to domain)</label>
          <input
            type="text"
            value={draft.handle}
            onChange={(e) => set({ handle: e.target.value })}
            placeholder="friend.example"
            className={fieldClass}
          />
        </div>
        <div>
          <label className={labelClass}>Connection Visibility</label>
          <select
            value={draft.visibility}
            onChange={(e) => set({ visibility: e.target.value as FriendVisibility })}
            className={fieldClass}
          >
            <option value="private">🔒 Private (Local Crawler Only)</option>
            <option value="public">🌐 Public (Allow on Blogroll)</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Relationship Tags (comma-separated, Local SQLite)</label>
          <input
            type="text"
            value={draft.relationship}
            onChange={(e) => set({ relationship: e.target.value })}
            placeholder="friend, met, colleague, muse"
            className={fieldClass}
          />
        </div>
        <div>
          <label className={labelClass}>Avatar URL (Optional)</label>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={draft.avatarUrl}
              onChange={(e) => set({ avatarUrl: e.target.value })}
              placeholder="https://..."
              className={`${fieldClass} flex-1`}
            />
            {draft.avatarUrl && (
              <button
                type="button"
                onClick={() => set({ avatarUrl: '' })}
                className="px-2.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-rose-300 shrink-0"
                title="Clear custom avatar URL"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div>
        <label className={labelClass}>Short Bio Note</label>
        <textarea
          rows={2}
          value={draft.bio}
          onChange={(e) => set({ bio: e.target.value })}
          placeholder="How you know them or what they post about..."
          className={fieldClass}
        />
      </div>

      {urlChanged && (
        <p className="text-[11px] text-amber-300 bg-amber-950/30 border border-amber-500/30 rounded-lg px-3 py-2">
          Changing the website URL clears cached posts from <code>{friend.siteUrl}</code> and updates
          their DID for the new address. Click <strong>Sync JSON</strong> after saving to pull their
          feed from the new URL.
        </p>
      )}

      {error && <p className="text-xs text-rose-300">⚠ {error}</p>}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-semibold text-xs flex items-center gap-1.5"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
        <button
          type="button"
          onClick={props.onCancel}
          className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
