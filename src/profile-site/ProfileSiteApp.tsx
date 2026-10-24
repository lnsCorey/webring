import React, { useEffect, useState } from 'react';
import {
  buildWebringUri,
  CompleteSiteBundle,
  EndorsementItem,
  PhotoItem,
  SharedItem,
} from '../shared/schema';
import {
  Camera,
  CheckCircle2,
  ExternalLink,
  Globe,
  Heart,
  Link2,
  MapPin,
  MessageSquare,
  Repeat2,
  ShieldCheck,
  Sparkles,
  Star,
  Users,
} from 'lucide-react';

declare global {
  interface Window {
    __WEBRING_BUNDLE__?: CompleteSiteBundle;
  }
}

export interface ProfileSiteAppProps {
  bundleOverride?: CompleteSiteBundle;
  onSimulateDeepLink?: (uri: string) => void;
}

function safeHref(rawUrl?: string): string {
  if (!rawUrl) return '#';
  const trimmed = rawUrl.trim();
  if (/^(javascript|data|vbscript):/i.test(trimmed)) return '#';
  return trimmed;
}

export const ProfileSiteApp: React.FC<ProfileSiteAppProps> = ({
  bundleOverride,
  onSimulateDeepLink,
}) => {
  const [bundle, setBundle] = useState<CompleteSiteBundle | null>(
    bundleOverride || window.__WEBRING_BUNDLE__ || null
  );
  const [activeFilter, setActiveFilter] = useState<
    'all' | 'post' | 'like' | 'share' | 'recommendation' | 'comment'
  >('all');
  const [lightboxPhoto, setLightboxPhoto] = useState<PhotoItem | null>(null);
  const [openLiveCommentUrl, setOpenLiveCommentUrl] = useState<string | null>(null);

  useEffect(() => {
    if (bundleOverride) {
      setBundle(bundleOverride);
      return;
    }
    if (!bundle && window.location.protocol.startsWith('http')) {
      Promise.all([
        fetch('./api/manifest.json').then((r) => r.json()),
        fetch('./api/profile.json').then((r) => r.json()),
        fetch('./api/albums.json').then((r) => r.json()),
        fetch('./api/items.json').then((r) => r.json()),
        fetch('./api/connections.json').then((r) => r.json()),
        fetch('./.well-known/did.json').then((r) => r.json()),
      ])
        .then(([manifest, profile, albums, items, connections, didDocument]) => {
          setBundle({ manifest, profile, albums, items, connections, didDocument });
        })
        .catch((err) => console.error('Failed to load profile JSON endpoints:', err));
    }
  }, [bundleOverride]);

  if (!bundle) {
    return (
      <div className="p-12 text-center text-slate-400">
        Loading Federated Profile JSON Bundle...
      </div>
    );
  }

  const { profile, albums, items, connections, manifest } = bundle;

  const themeClasses: Record<string, string> = {
    'neo-webring': 'bg-slate-950 text-slate-100',
    'minimal-zine': 'bg-stone-100 text-stone-900 font-serif',
    'cyber-terminal': 'bg-black text-emerald-400 font-mono',
    'cozy-scrapbook': 'bg-amber-50 text-amber-950',
  };

  const cardClasses: Record<string, string> = {
    'neo-webring': 'bg-slate-900/90 border border-slate-800 text-slate-100',
    'minimal-zine': 'bg-white border border-stone-300 text-stone-900 shadow-sm',
    'cyber-terminal': 'bg-zinc-950 border border-emerald-500/60 text-emerald-300',
    'cozy-scrapbook': 'bg-white border-2 border-amber-300 text-amber-950 shadow-md',
  };

  const currentTheme = profile.theme || 'neo-webring';
  const containerStyle = themeClasses[currentTheme] || themeClasses['neo-webring'];
  const cardStyle = cardClasses[currentTheme] || cardClasses['neo-webring'];

  const triggerWebringUri = (uri: string, e: React.MouseEvent) => {
    if (onSimulateDeepLink) {
      e.preventDefault();
      onSimulateDeepLink(uri);
    }
  };

  const endorsementsFor = (canonicalUrl: string): EndorsementItem[] => {
    return (connections.endorsements || []).filter((e) => e.targetCanonicalUrl === canonicalUrl);
  };

  const commentsFor = (canonicalUrl: string): EndorsementItem[] => {
    const fromEndorsements = endorsementsFor(canonicalUrl).filter((e) => e.type === 'comment');
    const fromOwnComments: EndorsementItem[] = (items.items || [])
      .filter((i) => i.type === 'comment' && i.targetUrl === canonicalUrl)
      .map((i) => ({
        id: i.id,
        targetCanonicalUrl: canonicalUrl,
        authorSiteUrl: profile.siteUrl,
        authorName: profile.displayName,
        authorAvatarUrl: profile.avatarUrl,
        type: 'comment',
        commentary: i.commentary,
        sourceItemUrl: i.canonicalUrl,
        createdAt: i.createdAt,
        verifiedSignature: true,
      }));
    const seen = new Set<string>();
    return [...fromEndorsements, ...fromOwnComments].filter((c) => {
      if (seen.has(c.sourceItemUrl)) return false;
      seen.add(c.sourceItemUrl);
      return true;
    });
  };

  const filteredItems: SharedItem[] = (items.items || []).filter((i) =>
    activeFilter === 'all' ? true : i.type === activeFilter
  );

  const renderAdSlotPreview = (slotId?: string, positionLabel?: string) => {
    if (!profile.adsAddon?.enabled || !profile.adsAddon.publisherId || !slotId) return null;
    return (
      <div
        className={`${cardStyle} rounded-xl p-3.5 mb-8 text-center border-dashed`}
        data-ad-position={positionLabel}
      >
        <p className="text-[10px] uppercase tracking-wider opacity-60 mb-1">
          Sponsored • {positionLabel}
        </p>
        <div className="py-3 px-4 rounded-lg bg-slate-500/10 text-xs font-mono opacity-80">
          📢 Google AdSense Unit Preview • Client: <strong>{profile.adsAddon.publisherId}</strong> •
          Slot: <strong>{slotId}</strong>
        </div>
      </div>
    );
  };

  return (
    <div className={`${containerStyle} min-h-full pb-16 transition-colors duration-200`}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6">
        {/* Top Webring Navigation Bars */}
        {(connections.webrings || []).map((ring) => {
          const joinUri = buildWebringUri({
            action: 'join-ring',
            targetUrl: ring.hubUrl,
            title: ring.name,
          });
          return (
            <div
              key={ring.id}
              className={`${cardStyle} rounded-xl px-4 py-2.5 mb-3 flex flex-wrap items-center justify-between gap-2 text-xs`}
            >
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 font-bold tracking-wide">
                  WEBRING
                </span>
                <span className="font-bold">{ring.name}</span>
                {ring.description && (
                  <span className="opacity-70 hidden md:inline">— {ring.description}</span>
                )}
              </div>
              <div className="flex items-center gap-3 font-medium">
                {/* Matches the published bar: 1 member shows no links, 2 show one neighbour */}
                {(ring.memberCount ?? 3) > 1 &&
                  (ring.prevSiteUrl && ring.prevSiteUrl === ring.nextSiteUrl ? (
                    <a
                      href={safeHref(ring.nextSiteUrl)}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline opacity-85 hover:opacity-100"
                    >
                      Neighbour →
                    </a>
                  ) : (
                    <>
                      {ring.prevSiteUrl && (
                        <a
                          href={safeHref(ring.prevSiteUrl)}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:underline opacity-85 hover:opacity-100"
                        >
                          ← Prev Site
                        </a>
                      )}
                      {(ring.memberCount ?? 3) > 2 && (
                        <a
                          href={safeHref(ring.directoryUrl || ring.hubUrl)}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:underline opacity-85 hover:opacity-100"
                        >
                          Random
                        </a>
                      )}
                      {ring.nextSiteUrl && (
                        <a
                          href={safeHref(ring.nextSiteUrl)}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:underline opacity-85 hover:opacity-100"
                        >
                          Next Site →
                        </a>
                      )}
                    </>
                  ))}
                <a
                  href={joinUri}
                  onClick={(e) => triggerWebringUri(joinUri, e)}
                  className="px-2.5 py-1 rounded-md bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 font-semibold"
                >
                  + Join Ring
                </a>
              </div>
            </div>
          );
        })}

        {/* Hero Profile Card */}
        <div className={`${cardStyle} rounded-2xl overflow-hidden mb-8 shadow-xl`}>
          {profile.bannerUrl && (
            <div className="h-44 sm:h-56 w-full overflow-hidden bg-slate-800 relative">
              <img
                src={profile.bannerUrl}
                alt="Profile banner"
                className="w-full h-full object-cover"
              />
            </div>
          )}

          <div
            className={`p-6 sm:p-8 flex flex-col sm:flex-row sm:items-end justify-between gap-5 ${
              profile.bannerUrl ? '-mt-16 relative z-10' : ''
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-end gap-4">
              {profile.avatarUrl && (
                <img
                  src={profile.avatarUrl}
                  alt={profile.displayName}
                  className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl object-cover border-4 border-slate-900 shadow-lg bg-slate-800"
                />
              )}
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl sm:text-3xl font-extrabold">{profile.displayName}</h1>
                  <span
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-mono"
                    title="Ed25519 Signed DID Identity"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {profile.did}
                  </span>
                </div>
                <p className="text-sm opacity-80 mt-1">{profile.tagline}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {(() => {
                const friendUri = buildWebringUri({
                  action: 'friend',
                  targetUrl: profile.siteUrl,
                  title: profile.displayName,
                  authorName: profile.displayName,
                  authorUrl: profile.siteUrl,
                  mediaUrl: profile.avatarUrl,
                });
                return (
                  <a
                    href={friendUri}
                    onClick={(e) => triggerWebringUri(friendUri, e)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow transition"
                  >
                    <Users className="w-4 h-4" />
                    Add to Friend Ring
                  </a>
                );
              })()}
            </div>
          </div>

          <div className="px-6 sm:px-8 pb-6">
            <p className="text-base leading-relaxed max-w-3xl mb-4 opacity-90">{profile.bio}</p>

            {profile.interests.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-4">
                {profile.interests.map((interest) => (
                  <span
                    key={interest}
                    className="text-xs px-3 py-1 rounded-full bg-indigo-500/15 text-indigo-300 font-medium"
                  >
                    #{interest}
                  </span>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-4 text-xs opacity-75 pt-3 border-t border-slate-500/20">
              {profile.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" /> {profile.location}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <Globe className="w-3.5 h-3.5" /> {profile.siteUrl}
              </span>
              {profile.atprotoHandle && (
                <span className="inline-flex items-center gap-1 text-sky-400">
                  🦋 @{profile.atprotoHandle}
                </span>
              )}
              {profile.customLinks.map((link) => (
                <a
                  key={link.url}
                  href={safeHref(link.url)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 underline hover:opacity-100"
                >
                  <Link2 className="w-3.5 h-3.5" /> {link.label}
                </a>
              ))}
            </div>
          </div>
        </div>

        {renderAdSlotPreview(profile.adsAddon?.headerSlotId, 'Profile Banner Slot')}

        {/* Photo Albums Section */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
              <Camera className="w-6 h-6 text-indigo-400" />
              Photo Albums ({albums.albums.length})
            </h2>
          </div>

          {albums.albums.map((album) => (
            <div key={album.id} className="mb-8">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                <div>
                  <h3 className="text-lg font-bold">{album.title}</h3>
                  <p className="text-xs opacity-75">{album.description}</p>
                </div>
                <span className="text-xs font-mono opacity-60">{album.canonicalUrl}</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {album.photos.map((photo) => {
                  const photoEndorsements = endorsementsFor(photo.canonicalUrl);
                  const likeUri = buildWebringUri({
                    action: 'like',
                    targetUrl: photo.canonicalUrl,
                    title: photo.caption || album.title,
                    authorUrl: profile.siteUrl,
                    authorName: profile.displayName,
                    mediaUrl: photo.url,
                    category: 'photo',
                  });
                  const shareUri = buildWebringUri({
                    action: 'share',
                    targetUrl: photo.canonicalUrl,
                    title: photo.caption || album.title,
                    authorUrl: profile.siteUrl,
                    authorName: profile.displayName,
                    mediaUrl: photo.url,
                    category: 'photo',
                  });

                  return (
                    <div
                      key={photo.id}
                      className={`${cardStyle} rounded-xl overflow-hidden flex flex-col justify-between`}
                    >
                      <div>
                        <div
                          onClick={() => setLightboxPhoto(photo)}
                          className="aspect-[4/3] overflow-hidden bg-slate-900 cursor-pointer relative group"
                        >
                          <img
                            src={photo.thumbUrl || photo.url}
                            alt={photo.altText || photo.caption}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        </div>
                        <div className="p-3.5">
                          <p className="text-sm font-medium mb-1.5">{photo.caption}</p>
                          <div className="flex flex-wrap gap-1 mb-2">
                            {photo.tags.map((t) => (
                              <span key={t} className="text-[11px] opacity-65">
                                #{t}
                              </span>
                            ))}
                          </div>
                          {photoEndorsements.length > 0 && (
                            <div className="text-[11px] bg-pink-500/15 border border-pink-500/30 text-pink-300 rounded-lg px-2.5 py-1.5 mt-2">
                              ♥ Endorsed by{' '}
                              <strong>
                                {photoEndorsements.map((e) => e.authorName).join(', ')}
                              </strong>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="px-3.5 py-2.5 border-t border-slate-500/20 flex items-center justify-between text-xs">
                        <span className="font-mono text-[10px] opacity-55 truncate max-w-[120px]">
                          #{photo.id}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <a
                            href={likeUri}
                            onClick={(e) => triggerWebringUri(likeUri, e)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-pink-500/20 text-pink-400 hover:bg-pink-500/30 font-medium"
                          >
                            <Heart className="w-3 h-3" /> Like
                          </a>
                          <a
                            href={shareUri}
                            onClick={(e) => triggerWebringUri(shareUri, e)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 font-medium"
                          >
                            <Repeat2 className="w-3 h-3" /> Share
                          </a>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>

        {renderAdSlotPreview(profile.adsAddon?.inFeedSlotId, 'In-Feed Slot')}

        {/* Wall Posts, Shared Items & Things I Like Section */}
        <section className="mb-10">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-amber-400" />
              Wall Posts, Likes & Shared Items ({items.items.length})
            </h2>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {(['all', 'post', 'like', 'share', 'recommendation', 'comment'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setActiveFilter(f)}
                  className={`px-3 py-1.5 rounded-lg font-medium capitalize transition ${
                    activeFilter === f
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800/60 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {f === 'all' ? 'All Timeline' : f === 'post' ? 'Wall Posts' : `${f}s`}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredItems.map((item) => {
              const itemEndorsements = endorsementsFor(item.canonicalUrl).filter(
                (e) => e.type !== 'comment'
              );
              const itemComments = commentsFor(item.canonicalUrl);
              const likeUri = buildWebringUri({
                action: 'like',
                targetUrl: item.canonicalUrl,
                title: item.title,
                authorUrl: profile.siteUrl,
                authorName: profile.displayName,
                mediaUrl: item.mediaUrl,
                category: item.category,
              });
              const commentUri = buildWebringUri({
                action: 'comment',
                targetUrl: item.canonicalUrl,
                title: item.title,
                authorUrl: profile.siteUrl,
                authorName: profile.displayName,
                mediaUrl: item.mediaUrl,
                category: 'comment',
              });
              const reshareUri = buildWebringUri({
                action: 'share',
                targetUrl: item.targetUrl,
                title: item.title,
                authorUrl: item.targetAuthorUrl || profile.siteUrl,
                authorName: item.targetAuthorName || profile.displayName,
                mediaUrl: item.mediaUrl,
                category: item.category,
              });

              const badgeStyle =
                item.type === 'post'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : item.type === 'like'
                  ? 'bg-pink-500/20 text-pink-400'
                  : item.type === 'recommendation'
                  ? 'bg-amber-500/20 text-amber-400'
                  : item.type === 'comment'
                  ? 'bg-purple-500/20 text-purple-300'
                  : 'bg-sky-500/20 text-sky-400';

              const isSelfPost =
                item.type === 'post' &&
                (!item.targetUrl || item.targetUrl === item.canonicalUrl);

              return (
                <div
                  key={item.id}
                  className={`${cardStyle} rounded-xl p-4 flex flex-col justify-between ${
                    item.type === 'post' ? 'md:col-span-2' : ''
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[11px] uppercase tracking-wider font-bold px-2.5 py-0.5 rounded-full ${badgeStyle}`}
                        >
                          {item.type === 'post' ? '📝 Wall Post' : item.type}
                        </span>
                        <span className="text-xs opacity-60">
                          {new Date(item.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs opacity-70">
                        <span className="capitalize">{item.category}</span>
                        {item.rating && item.type !== 'post' && item.type !== 'comment' && (
                          <span className="inline-flex items-center text-amber-400">
                            {Array.from({ length: item.rating }).map((_, idx) => (
                              <Star key={idx} className="w-3 h-3 fill-amber-400" />
                            ))}
                          </span>
                        )}
                      </div>
                    </div>

                    {item.mediaUrl && (
                      <img
                        src={item.mediaUrl}
                        alt={item.title}
                        className={`w-full ${
                          item.type === 'post' ? 'max-h-80' : 'h-40'
                        } object-cover rounded-lg mb-3`}
                      />
                    )}

                    <h4 className="font-bold text-base mb-1">
                      {isSelfPost ? (
                        <span>{item.title}</span>
                      ) : (
                        <a
                          href={safeHref(item.targetUrl)}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:underline inline-flex items-center gap-1"
                        >
                          {item.title}
                          <ExternalLink className="w-3.5 h-3.5 opacity-70" />
                        </a>
                      )}
                    </h4>

                    {item.targetAuthorName && (
                      <p className="text-xs opacity-70 mb-2">
                        {item.type === 'comment' ? 'Replying to:' : 'Indexed Source:'}{' '}
                        <a
                          href={safeHref(item.targetAuthorUrl || item.targetUrl)}
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                        >
                          {item.targetAuthorName}
                        </a>
                      </p>
                    )}

                    <p className="text-sm opacity-90 mb-3 whitespace-pre-line leading-relaxed">
                      {item.commentary}
                    </p>

                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {item.tags.map((t) => (
                        <span
                          key={t}
                          className="text-xs px-2 py-0.5 rounded bg-slate-500/15 opacity-80"
                        >
                          #{t}
                        </span>
                      ))}
                    </div>

                    {itemEndorsements.length > 0 && (
                      <div className="text-xs bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 rounded-lg px-2.5 py-1.5 mb-3 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          Liked/Shared in ring by{' '}
                          <strong>{itemEndorsements.map((e) => e.authorName).join(', ')}</strong>
                        </span>
                      </div>
                    )}

                    {/* Threaded Ring Comments Section */}
                    {itemComments.length > 0 && (
                      <div className="mt-3 mb-3 pt-3 border-t border-slate-500/20 space-y-2">
                        <p className="text-xs font-bold opacity-80 flex items-center gap-1.5">
                          <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
                          Comments ({itemComments.length})
                        </p>
                        {itemComments.map((c) => (
                          <div
                            key={c.id}
                            className="p-2.5 rounded-lg bg-slate-500/10 border border-slate-500/20 text-xs space-y-1"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <a
                                href={safeHref(c.authorSiteUrl)}
                                target="_blank"
                                rel="noreferrer"
                                className="font-bold hover:underline text-indigo-300"
                              >
                                {c.authorName}
                              </a>
                              <span className="text-[10px] opacity-60">
                                {new Date(c.createdAt).toLocaleDateString()}
                              </span>
                            </div>
                            <p className="opacity-90 whitespace-pre-line">{c.commentary}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Optional Real-Time Comment Widget Drawer (Giscus / Utterances) */}
                    {profile.commentConfig &&
                      profile.commentConfig.provider !== 'none' &&
                      openLiveCommentUrl === item.canonicalUrl && (
                        <div className="mt-3 mb-3 p-3 rounded-xl bg-slate-950/80 border border-indigo-500/30 text-xs space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-indigo-300">
                              💬 Live {profile.commentConfig.provider.toUpperCase()} Comment Thread
                            </span>
                            <span className="font-mono text-[10px] text-slate-400">
                              Repo: {profile.commentConfig.giscusRepo || 'Configured'}
                            </span>
                          </div>
                          <p className="text-slate-400">
                            On the exported static website (<code>index.html</code>), this drawer
                            loads the live interactive {profile.commentConfig.provider} widget keyed
                            to <code>{item.canonicalUrl}</code>.
                          </p>
                        </div>
                      )}
                  </div>

                  <div className="pt-2.5 border-t border-slate-500/20 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span
                      className="font-mono text-[10px] opacity-55 truncate max-w-[160px]"
                      title={item.canonicalUrl}
                    >
                      {item.canonicalUrl}
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <a
                        href={likeUri}
                        onClick={(e) => triggerWebringUri(likeUri, e)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-pink-500/20 text-pink-400 hover:bg-pink-500/30 font-medium"
                      >
                        <Heart className="w-3 h-3" /> Like
                      </a>
                      <a
                        href={commentUri}
                        onClick={(e) => triggerWebringUri(commentUri, e)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 font-medium"
                      >
                        <MessageSquare className="w-3 h-3" /> Comment
                      </a>
                      <a
                        href={reshareUri}
                        onClick={(e) => triggerWebringUri(reshareUri, e)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 font-medium"
                      >
                        <Repeat2 className="w-3 h-3" /> Re-share
                      </a>
                      {profile.commentConfig && profile.commentConfig.provider !== 'none' && (
                        <button
                          type="button"
                          onClick={() =>
                            setOpenLiveCommentUrl((prev) =>
                              prev === item.canonicalUrl ? null : item.canonicalUrl
                            )
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 font-medium"
                        >
                          💬 Live Thread
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Friends Ring Blogroll (only rendered when public friends are exported) */}
        {connections.friends.length > 0 && (
          <section className="mb-10">
            <h2 className="text-xl sm:text-2xl font-bold flex items-center gap-2 mb-4">
              <Users className="w-6 h-6 text-emerald-400" />
              Friend Ring & Federated Connections ({connections.friends.length})
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {connections.friends.map((friend) => (
                <a
                  key={friend.id}
                  href={safeHref(friend.siteUrl)}
                  target="_blank"
                  rel="noreferrer"
                  className={`${cardStyle} rounded-xl p-3.5 flex items-center gap-3.5 hover:border-indigo-500/60 transition`}
                >
                  <img
                    src={
                      friend.avatarUrl ||
                      `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(
                        friend.displayName
                      )}`
                    }
                    alt={friend.displayName}
                    className="w-12 h-12 rounded-full object-cover border border-slate-600 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <h4 className="font-bold text-sm truncate">{friend.displayName}</h4>
                    <p className="text-xs opacity-65 truncate">{friend.siteUrl}</p>
                    {friend.relationship.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {friend.relationship.map((rel) => (
                          <span
                            key={rel}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-medium"
                          >
                            {rel}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}

        {renderAdSlotPreview(profile.adsAddon?.footerSlotId, 'Footer Slot')}

        <footer className="text-center text-xs opacity-60 pt-6 border-t border-slate-500/20 space-y-1.5">
          <div>
            Powered by <strong>Webring Studio JSON Protocol v{manifest.schemaVersion}</strong> •
            Signed by <code>{profile.did}</code>
          </div>
          {(profile.analyticsAddon?.enabled || profile.adsAddon?.enabled) && (
            <div className="flex flex-wrap items-center justify-center gap-2 text-[11px]">
              {profile.analyticsAddon?.enabled && (
                <span className="px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 font-mono">
                  📊 GA4 Active: {profile.analyticsAddon.measurementId}
                </span>
              )}
              {profile.adsAddon?.enabled && (
                <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-mono">
                  💰 AdSense Active: {profile.adsAddon.publisherId}
                  {profile.adsAddon.generateAdsTxt ? ' (+ /ads.txt)' : ''}
                </span>
              )}
            </div>
          )}
        </footer>
      </div>

      {/* Lightbox Modal */}
      {lightboxPhoto && (
        <div
          onClick={() => setLightboxPhoto(null)}
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-3xl w-full bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden shadow-2xl"
          >
            <img
              src={lightboxPhoto.url}
              alt={lightboxPhoto.caption}
              className="w-full max-h-[70vh] object-contain bg-black"
            />
            <div className="p-4 flex items-center justify-between gap-4 text-slate-100">
              <div>
                <p className="font-semibold text-sm">{lightboxPhoto.caption}</p>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  {lightboxPhoto.canonicalUrl}
                </p>
              </div>
              <button
                onClick={() => setLightboxPhoto(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

