import { useEffect, useState } from 'react';
import { Eye, X } from 'lucide-react';
import type { AlbumItem } from '../shared/schema';
import { MarkdownField } from './MarkdownField';
import { ProfileImagePicker } from './ProfileImagePicker';

export interface RingPageFields {
  directoryPath: string;
  tagline: string;
  rules: string;
  bannerUrl: string;
  accent: string;
}

/** The address part of a ring page path: "webring/index.html" → "/webring". */
const pageAddress = (directoryPath: string) => `/${directoryPath.replace(/\/?index\.html$/, '')}`;

/**
 * The design of a hosted ring's public page: its address, tagline, rules, banner and accent
 * colour. Saving stores it locally; it goes online with the next publish.
 */
export function HostedRingPageEditor(props: {
  ring: RingPageFields & { id: string; name: string };
  albums: AlbumItem[];
  mediaSrc: (url: string) => string;
  onSave: (updates: RingPageFields) => Promise<void>;
  onPreview: () => Promise<string>;
}) {
  const saved: RingPageFields = {
    directoryPath: pageAddress(props.ring.directoryPath),
    tagline: props.ring.tagline,
    rules: props.ring.rules,
    bannerUrl: props.ring.bannerUrl,
    accent: props.ring.accent,
  };
  const [draft, setDraft] = useState<RingPageFields>(saved);
  const [saving, setSaving] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const savedKey = JSON.stringify(saved);
  useEffect(() => setDraft(JSON.parse(savedKey)), [savedKey]);
  const dirty = JSON.stringify(draft) !== savedKey;

  const field = 'w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm focus:border-indigo-500 focus:outline-none';
  const label = 'block text-xs text-slate-400 mb-1';

  const save = async () => {
    setSaving(true);
    try {
      await props.onSave(draft);
    } finally {
      setSaving(false);
    }
  };

  return (
    <details className="text-xs rounded-xl border border-slate-800 bg-slate-950/40">
      <summary className="cursor-pointer px-3 py-2 font-semibold text-slate-300">Ring page design</summary>
      <div className="p-3 pt-1 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className={label}>Page address on your site</label>
            <input
              type="text"
              value={draft.directoryPath}
              onChange={(e) => setDraft({ ...draft, directoryPath: e.target.value })}
              placeholder="/webring"
              className={`${field} font-mono`}
            />
          </div>
          <div>
            <label className={label}>Tagline</label>
            <input
              type="text"
              maxLength={200}
              value={draft.tagline}
              onChange={(e) => setDraft({ ...draft, tagline: e.target.value })}
              placeholder="Independent sites about science and society"
              className={field}
            />
          </div>
        </div>
        <div>
          <label className={label}>Rules and welcome (Markdown)</label>
          <MarkdownField
            value={draft.rules}
            onChange={(rules) => setDraft({ ...draft, rules })}
            placeholder={'- Be kind\n- Keep your ring bar on your home page'}
            rows={4}
          />
        </div>
        <ProfileImagePicker
          kind="banner"
          label="Banner"
          value={draft.bannerUrl}
          savedValue={saved.bannerUrl}
          albums={props.albums}
          mediaSrc={props.mediaSrc}
          onChange={(bannerUrl) => setDraft({ ...draft, bannerUrl })}
          unsavedNote="save the ring page to apply"
        />
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-slate-400">
            Accent colour
            <input
              type="color"
              value={draft.accent || '#6366f1'}
              onChange={(e) => setDraft({ ...draft, accent: e.target.value })}
              className="w-8 h-6 rounded bg-transparent"
            />
          </label>
          {draft.accent && (
            <button type="button" onClick={() => setDraft({ ...draft, accent: '' })} className="text-slate-400 hover:text-slate-200">
              Use my site's accent
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              disabled={dirty}
              title={dirty ? 'Save to preview your changes' : undefined}
              onClick={async () => setPreviewHtml(await props.onPreview())}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 flex items-center gap-1"
            >
              <Eye className="w-3 h-3" /> Preview page
            </button>
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={() => void save()}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold"
            >
              {saving ? 'Saving…' : 'Save ring page'}
            </button>
          </div>
        </div>
      </div>
      {previewHtml !== null && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setPreviewHtml(null)}>
          <div className="w-full max-w-4xl h-[85vh] bg-slate-900 rounded-2xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 text-xs">
              <span className="font-semibold">Preview: {props.ring.name} ring page</span>
              <button type="button" onClick={() => setPreviewHtml(null)} className="p-1 rounded hover:bg-slate-800" title="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* No scripts, popups or navigation: the page is static and its links stay inert here */}
            <iframe title="Ring page preview" srcDoc={previewHtml} sandbox="" className="flex-1 w-full bg-white" />
          </div>
        </div>
      )}
    </details>
  );
}
