import React, { useState } from 'react';
import { ArrowLeft, ExternalLink, Heart, MessageSquare, Repeat2, X } from 'lucide-react';
import type { WebringDeepLinkAction } from '../shared/schema';
import { renderMarkdown } from '../shared/markdown';

/** The feed-entry shape the album view needs (matches NetworkFeedEntry in App.tsx). */
export interface AlbumViewEntry {
  id: string;
  friendSiteUrl: string;
  friendName: string;
  friendAvatarUrl: string;
  friendDid: string;
  entryType: 'photo' | 'album' | 'post' | 'like' | 'share' | 'recommendation' | 'comment';
  title: string;
  canonicalUrl: string;
  targetUrl: string;
  commentary: string;
  mediaUrl: string;
  tags: string[];
  createdAt: string;
  verifiedSignature: boolean;
  albumUrl?: string;
  photoCount?: number;
  newCount?: number;
  peekUrls?: string[];
  isMine?: boolean;
}

type Entry = AlbumViewEntry;

/** A friend's album inside Studio: every photo, with the same actions as the feed. */
export function FriendAlbumView(props: {
  album: Entry;
  photos: Entry[];
  savedUrls: Set<string>;
  onClose(): void;
  onAction(action: WebringDeepLinkAction): void;
  onToggleSave(entry: Entry): void;
  onOpenSite(url: string): void;
}): JSX.Element {
  const { album, photos, savedUrls } = props;
  const [enlarged, setEnlarged] = useState<Entry | null>(null);
  const count = photos.length || album.photoCount || 0;

  const actions = (entry: Entry, small = false) => {
    const size = small ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs';
    const saved = savedUrls.has(entry.canonicalUrl);
    return (
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() =>
            props.onAction({
              action: 'like',
              targetUrl: entry.canonicalUrl,
              title: entry.title,
              authorName: entry.friendName,
              authorUrl: entry.friendSiteUrl,
              mediaUrl: entry.mediaUrl,
            })
          }
          className={`${size} rounded-lg bg-pink-500/20 text-pink-300 hover:bg-pink-500/30 font-medium flex items-center gap-1`}
        >
          <Heart className="w-3.5 h-3.5" /> Like
        </button>
        <button
          type="button"
          onClick={() =>
            props.onAction({
              action: 'comment',
              targetUrl: entry.canonicalUrl,
              title: entry.title,
              authorName: entry.friendName,
              authorUrl: entry.friendSiteUrl,
            })
          }
          className={`${size} rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 font-medium flex items-center gap-1`}
        >
          <MessageSquare className="w-3.5 h-3.5" /> Comment
        </button>
        <button
          type="button"
          onClick={() =>
            props.onAction({
              action: 'share',
              targetUrl: entry.targetUrl,
              title: entry.title,
              authorName: entry.friendName,
              authorUrl: entry.friendSiteUrl,
              mediaUrl: entry.mediaUrl,
            })
          }
          className={`${size} rounded-lg bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 font-medium flex items-center gap-1`}
        >
          <Repeat2 className="w-3.5 h-3.5" /> Share
        </button>
        <button
          type="button"
          onClick={() => props.onToggleSave(entry)}
          className={`${size} rounded-lg font-medium ${
            saved ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-800 text-slate-300 hover:text-amber-300'
          }`}
        >
          {saved ? '★ Saved' : '☆ Save'}
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={props.onClose}
        className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back to feed
      </button>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
        <p className="text-xs text-slate-400">{album.friendName}</p>
        <h3 className="font-bold text-lg">{album.title}</h3>
        {album.commentary && (
          // Album descriptions are Markdown; the renderer escapes everything first
          <div className="studio-prose text-sm text-slate-300" dangerouslySetInnerHTML={{ __html: renderMarkdown(album.commentary) }} />
        )}
        <p className="text-xs text-slate-400">
          {count} photo{count === 1 ? '' : 's'}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {actions(album)}
          <button
            type="button"
            onClick={() => props.onOpenSite(album.targetUrl)}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium flex items-center gap-1"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Open on their site ↗
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {photos.map((photo) => (
          <div key={photo.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2">
            <button type="button" onClick={() => setEnlarged(photo)} className="block w-full" title="Enlarge">
              <img src={photo.mediaUrl} alt={photo.title} className="w-full aspect-square object-cover rounded-lg" />
            </button>
            {photo.title && <p className="text-xs text-slate-300 truncate">{photo.title}</p>}
            {actions(photo, true)}
          </div>
        ))}
      </div>

      {enlarged && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6"
          onClick={() => setEnlarged(null)}
        >
          <div className="max-w-4xl max-h-full space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setEnlarged(null)}
                className="p-1.5 rounded-full bg-slate-800 hover:bg-slate-700"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <img src={enlarged.mediaUrl} alt={enlarged.title} className="max-w-full max-h-[75vh] object-contain rounded-xl" />
            {enlarged.title && <p className="text-sm text-slate-200">{enlarged.title}</p>}
            {actions(enlarged)}
          </div>
        </div>
      )}
    </div>
  );
}
