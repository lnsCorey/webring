import React, { useEffect, useState } from 'react';
import {
  CompleteSiteBundle,
  CreatePersonaInput,
  EndorsementItem,
  FriendConnection,
  FriendVisibility,
  parseWebringUri,
  PersonaSummary,
  ProfileDocument,
  ProfileTheme,
  SharedItemType,
  siteUrlToDidWeb,
  WEBRING_SCHEMA_VERSION,
  WebringDeepLinkAction,
  WebringMembership,
} from '../shared/schema';
import { ProfileSiteApp } from '../profile-site/ProfileSiteApp';
import {
  BookOpen,
  Camera,
  CheckCircle2,
  Code2,
  Compass,
  Copy,
  ExternalLink,
  FolderOutput,
  Globe,
  Heart,
  ImagePlus,
  Layers,
  Link2,
  Lock,
  MessageSquare,
  Plus,
  Radio,
  RefreshCw,
  Repeat2,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';

interface PublishSettingsState {
  exportPath: string;
  protocol: 'sftp' | 'ftp';
  host: string;
  port: number;
  username: string;
  password?: string;
  remotePath: string;
  atprotoPdsUrl?: string;
  publishFriendsList?: boolean;
  stripRelationshipTags?: boolean;
  publishEndorsements?: boolean;
  publishWebringHub?: boolean;
  redactItemSourceAuthors?: boolean;
  commentProvider?: 'none' | 'giscus' | 'utterances';
  giscusRepo?: string;
  giscusRepoId?: string;
  giscusCategory?: string;
  giscusCategoryId?: string;
  analyticsEnabled?: boolean;
  analyticsMeasurementId?: string;
  analyticsRespectDnt?: boolean;
  analyticsAnonymizeIp?: boolean;
  analyticsTrackRingInteractions?: boolean;
  adsEnabled?: boolean;
  adsPublisherId?: string;
  adsEnableAutoAds?: boolean;
  adsGenerateAdsTxt?: boolean;
  adsHeaderSlotId?: string;
  adsInFeedSlotId?: string;
  adsFooterSlotId?: string;
  githubOwner?: string;
  githubRepo?: string;
  githubBranch?: string;
  githubToken?: string;
  githubCustomDomain?: string;
}

interface NetworkFeedEntry {
  id: string;
  friendSiteUrl: string;
  friendName: string;
  friendAvatarUrl: string;
  friendDid: string;
  entryType: 'photo' | 'post' | 'like' | 'share' | 'recommendation' | 'comment';
  title: string;
  canonicalUrl: string;
  targetUrl: string;
  commentary: string;
  mediaUrl: string;
  tags: string[];
  createdAt: string;
  verifiedSignature: boolean;
}

interface TestExportPreviewState {
  success: boolean;
  outputDir: string;
  previewUrl: string;
  port: number;
  filesWritten: Array<{
    relativePath: string;
    sizeBytes: number;
  }>;
  checks: {
    hasIndexHtml: boolean;
    hasNoJekyll: boolean;
    hasDidJson: boolean;
    hasManifestJson: boolean;
    publicFriendsExported: number;
    albumsExported: number;
    itemsExported: number;
  };
}

declare global {
  interface Window {
    studioApi?: {
      getBundle: () => Promise<{
        activePersonaId: string;
        personas: PersonaSummary[];
        bundle: CompleteSiteBundle;
        allFriends: FriendConnection[];
        allEndorsements: EndorsementItem[];
        profileWithSettings: ProfileDocument & {
          publicKeyPem: string;
          publishSettings: PublishSettingsState;
        };
        networkFeed: NetworkFeedEntry[];
        previewHtml: string;
      }>;
      listPersonas: () => Promise<{
        activePersonaId: string;
        personas: PersonaSummary[];
      }>;
      createPersona: (input: CreatePersonaInput) => Promise<{
        created: PersonaSummary;
        activePersonaId: string;
        personas: PersonaSummary[];
      }>;
      switchPersona: (personaId: string) => Promise<{
        activePersonaId: string;
        personas: PersonaSummary[];
      }>;
      updatePersonaLabel: (
        personaId: string,
        label: string
      ) => Promise<{
        updated: PersonaSummary;
        activePersonaId: string;
        personas: PersonaSummary[];
      }>;
      deletePersona: (
        personaId: string,
        deleteFiles?: boolean
      ) => Promise<{
        deletedId: string;
        activePersonaId: string;
        personas: PersonaSummary[];
      }>;
      updateProfile: (updates: unknown) => Promise<unknown>;
      createAlbum: (input: unknown) => Promise<unknown>;
      deleteAlbum: (albumId: string) => Promise<unknown>;
      addPhoto: (input: unknown) => Promise<unknown>;
      pickAndImportPhoto: (albumId: string) => Promise<{
        relativeUrl: string;
        thumbRelativeUrl: string;
        localFullPath: string;
        fileName: string;
      } | null>;
      deletePhoto: (photoId: string) => Promise<unknown>;
      createItem: (input: unknown) => Promise<unknown>;
      deleteItem: (itemId: string) => Promise<unknown>;
      addFriend: (input: unknown) => Promise<unknown>;
      setFriendVisibility: (
        friendId: string,
        visibility: FriendVisibility
      ) => Promise<FriendConnection | undefined>;
      deleteFriend: (friendId: string) => Promise<unknown>;
      addWebring: (input: unknown) => Promise<unknown>;
      updateWebring: (ringId: string, updates: unknown) => Promise<unknown>;
      deleteWebring: (ringId: string) => Promise<unknown>;
      crawlFriend: (siteUrl: string, localDirOverride?: string) => Promise<{
        siteUrl: string;
        success: boolean;
        displayName?: string;
        itemsIndexed: number;
        photosIndexed: number;
        endorsementsFound: number;
        verifiedSignature: boolean;
        error?: string;
      }>;
      crawlAllFriends: () => Promise<unknown[]>;
      syncWebringHub: (hubUrl: string) => Promise<unknown>;
      chooseExportFolder: () => Promise<string | null>;
      exportLocal: (targetDir?: string) => Promise<{
        success: boolean;
        destination: string;
        filesPublished: number;
        message: string;
      }>;
      testExportPreview: (openInBrowser?: boolean) => Promise<TestExportPreviewState>;
      openExternal: (url: string) => Promise<unknown>;
      publishRemote: (settings: unknown) => Promise<{
        success: boolean;
        destination: string;
        filesPublished: number;
        message: string;
      }>;
      publishGithub: (settings: unknown) => Promise<{
        success: boolean;
        destination: string;
        filesPublished: number;
        message: string;
      }>;
      checkGithubRepo: (settings: unknown) => Promise<{
        success: boolean;
        defaultBranch?: string;
        branchExists?: boolean;
        canPush?: boolean;
        pagesEnabled?: boolean;
        pagesUrl?: string;
        message: string;
      }>;
      openPath: (targetPath: string) => Promise<unknown>;
      simulatePeerSite: () => Promise<{
        siteUrl: string;
        success: boolean;
        displayName?: string;
        itemsIndexed: number;
        photosIndexed: number;
        endorsementsFound: number;
        verifiedSignature: boolean;
      }>;
      getMcpInfo?: () => Promise<{
        status: {
          running: boolean;
          port: number;
          endpointUrl: string;
          sseUrl: string;
          toolCount: number;
          resourceCount: number;
          promptCount: number;
        };
        cliScriptPath: string;
        userDataDir: string;
        tools: Array<{
          name: string;
          description: string;
          inputSchema: Record<string, unknown>;
        }>;
        resources: Array<{
          uri: string;
          name: string;
          description: string;
          mimeType: string;
        }>;
        prompts: Array<{
          name: string;
          description: string;
        }>;
        activityLog: Array<{
          id: string;
          timestamp: string;
          method: string;
          toolName?: string;
          personaId: string;
          summary: string;
          success: boolean;
        }>;
      }>;
      callMcpTool?: (
        toolName: string,
        args?: Record<string, unknown>
      ) => Promise<{
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
        data?: unknown;
      }>;
      onMcpActivity?: (cb: (entry: unknown) => void) => () => void;
      onDeepLink: (cb: (action: WebringDeepLinkAction) => void) => () => void;
    };
  }
}

type StudioTab =
  | 'profile'
  | 'albums'
  | 'items'
  | 'friends'
  | 'feed'
  | 'preview'
  | 'schemas'
  | 'publish'
  | 'mcp'
  | 'help';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<StudioTab>('profile');
  const [helpSection, setHelpSection] = useState<
    | 'quickstart'
    | 'github-pages'
    | 'ftp-sftp'
    | 'addons'
    | 'mcp-agents'
    | 'privacy-faq'
  >('quickstart');
  const [bundle, setBundle] = useState<CompleteSiteBundle | null>(null);
  const [allFriends, setAllFriends] = useState<FriendConnection[]>([]);
  const [allEndorsements, setAllEndorsements] = useState<EndorsementItem[]>([]);
  const [networkFeed, setNetworkFeed] = useState<NetworkFeedEntry[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Multi-Persona compartmentalization state
  const [activePersonaId, setActivePersonaId] = useState<string>('default');
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [showPersonaModal, setShowPersonaModal] = useState(false);
  const [newPersonaLabel, setNewPersonaLabel] = useState('');
  const [newPersonaDisplayName, setNewPersonaDisplayName] = useState('');
  const [newPersonaSiteUrl, setNewPersonaSiteUrl] = useState('');
  const [newPersonaTagline, setNewPersonaTagline] = useState('');
  const [newPersonaTheme, setNewPersonaTheme] = useState<ProfileTheme>('cyber-terminal');
  const [editingPersonaId, setEditingPersonaId] = useState<string | null>(null);
  const [editingPersonaLabel, setEditingPersonaLabel] = useState('');

  // Profile form state
  const [siteUrl, setSiteUrl] = useState('https://alex.indiering.social');
  const [handle, setHandle] = useState('alex.indiering.social');
  const [displayName, setDisplayName] = useState('Alex Rivera');
  const [tagline, setTagline] = useState('');
  const [bio, setBio] = useState('');
  const [location, setLocation] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [bannerUrl, setBannerUrl] = useState('');
  const [interestsInput, setInterestsInput] = useState('');
  const [theme, setTheme] = useState<ProfileTheme>('neo-webring');
  const [atprotoHandle, setAtprotoHandle] = useState('');
  const [customLinks, setCustomLinks] = useState<Array<{ label: string; url: string }>>([]);

  // Publish settings state
  const [publishSettings, setPublishSettings] = useState<PublishSettingsState>({
    exportPath: '',
    protocol: 'sftp',
    host: '',
    port: 22,
    username: '',
    password: '',
    remotePath: '/var/www/html',
    atprotoPdsUrl: 'https://bsky.social',
    publishFriendsList: false,
    stripRelationshipTags: true,
    publishEndorsements: false,
    publishWebringHub: false,
    redactItemSourceAuthors: false,
    commentProvider: 'none',
    giscusRepo: '',
    giscusRepoId: '',
    giscusCategory: 'General',
    giscusCategoryId: '',
    analyticsEnabled: false,
    analyticsMeasurementId: '',
    analyticsRespectDnt: true,
    analyticsAnonymizeIp: true,
    analyticsTrackRingInteractions: true,
    adsEnabled: false,
    adsPublisherId: '',
    adsEnableAutoAds: true,
    adsGenerateAdsTxt: true,
    adsHeaderSlotId: '',
    adsInFeedSlotId: '',
    adsFooterSlotId: '',
    githubOwner: '',
    githubRepo: '',
    githubBranch: 'gh-pages',
    githubToken: '',
    githubCustomDomain: '',
  });

  // New Album / Photo state
  const [newAlbumTitle, setNewAlbumTitle] = useState('');
  const [newAlbumDesc, setNewAlbumDesc] = useState('');
  const [newAlbumTags, setNewAlbumTags] = useState('');
  const [selectedAlbumId, setSelectedAlbumId] = useState('');
  const [newPhotoUrl, setNewPhotoUrl] = useState('');
  const [newPhotoCaption, setNewPhotoCaption] = useState('');
  const [newPhotoTags, setNewPhotoTags] = useState('');

  // New Item (Wall Post / Like / Share / Recommendation / Comment) state
  const [itemType, setItemType] = useState<SharedItemType>('post');
  const [itemTitle, setItemTitle] = useState('');
  const [itemTargetUrl, setItemTargetUrl] = useState('');
  const [itemAuthorName, setItemAuthorName] = useState('');
  const [itemAuthorUrl, setItemAuthorUrl] = useState('');
  const [itemCategory, setItemCategory] = useState('status');
  const [itemCommentary, setItemCommentary] = useState('');
  const [itemMediaUrl, setItemMediaUrl] = useState('');
  const [itemRating, setItemRating] = useState<number>(5);
  const [itemTags, setItemTags] = useState('');

  // New Friend & Webring state
  const [friendSiteUrl, setFriendSiteUrl] = useState('');
  const [friendName, setFriendName] = useState('');
  const [friendAvatar, setFriendAvatar] = useState('');
  const [friendBio, setFriendBio] = useState('');
  const [friendRel, setFriendRel] = useState('friend, met');
  const [friendVisibility, setFriendVisibility] = useState<FriendVisibility>('private');

  const [ringName, setRingName] = useState('');
  const [ringHubUrl, setRingHubUrl] = useState('');
  const [ringDesc, setRingDesc] = useState('');
  const [ringPrevUrl, setRingPrevUrl] = useState('');
  const [ringNextUrl, setRingNextUrl] = useState('');

  // Editing an already-joined webring's name/description/neighbors
  const [editingRingId, setEditingRingId] = useState<string | null>(null);
  const [editRingDraft, setEditRingDraft] = useState<{
    name: string;
    hubUrl: string;
    description: string;
    prevSiteUrl: string;
    nextSiteUrl: string;
  }>({ name: '', hubUrl: '', description: '', prevSiteUrl: '', nextSiteUrl: '' });

  // Schema Inspector state
  const [selectedSchemaFile, setSelectedSchemaFile] = useState<
    'manifest' | 'did' | 'profile' | 'albums' | 'items' | 'connections'
  >('manifest');

  // GitHub Pages Deploy state
  const [githubCheckResult, setGithubCheckResult] = useState<{
    success: boolean;
    defaultBranch?: string;
    branchExists?: boolean;
    canPush?: boolean;
    pagesEnabled?: boolean;
    pagesUrl?: string;
    message: string;
  } | null>(null);
  const [githubChecking, setGithubChecking] = useState(false);
  const [githubDeploying, setGithubDeploying] = useState(false);

  // Local Test Export & Live HTTP Server Preview state
  const [testExportResult, setTestExportResult] = useState<TestExportPreviewState | null>(null);
  const [previewRenderMode, setPreviewRenderMode] = useState<'studio' | 'exported-http'>('studio');
  const [iframeRefreshKey, setIframeRefreshKey] = useState<number>(0);

  // MCP Agent Hub state
  const [mcpInfo, setMcpInfo] = useState<{
    status: {
      running: boolean;
      port: number;
      endpointUrl: string;
      sseUrl: string;
      toolCount: number;
      resourceCount: number;
      promptCount: number;
    };
    cliScriptPath: string;
    userDataDir: string;
    tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
    resources: Array<{ uri: string; name: string; description: string; mimeType: string }>;
    prompts: Array<{ name: string; description: string }>;
    activityLog: Array<{
      id: string;
      timestamp: string;
      method: string;
      toolName?: string;
      personaId: string;
      summary: string;
      success: boolean;
    }>;
  } | null>(null);
  const [selectedMcpTool, setSelectedMcpTool] = useState<string>('webring_list_personas');
  const [mcpToolArgsJson, setMcpToolArgsJson] = useState<string>('{}');
  const [mcpToolOutput, setMcpToolOutput] = useState<string>('');

  const notify = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => {
      setStatusMessage((prev) => (prev === msg ? null : prev));
    }, 5000);
  };

  const refreshStudioData = async () => {
    if (!window.studioApi) return;
    const data = await window.studioApi.getBundle();
    if (data.activePersonaId) {
      setActivePersonaId(data.activePersonaId);
    }
    if (data.personas) {
      setPersonas(data.personas);
    }
    setBundle(data.bundle);
    setAllFriends(data.allFriends || []);
    setAllEndorsements(data.allEndorsements || []);
    setNetworkFeed(data.networkFeed || []);

    const p = data.profileWithSettings;
    setSiteUrl(p.siteUrl);
    setHandle(p.handle);
    setDisplayName(p.displayName);
    setTagline(p.tagline);
    setBio(p.bio);
    setLocation(p.location);
    setAvatarUrl(p.avatarUrl);
    setBannerUrl(p.bannerUrl);
    setInterestsInput((p.interests || []).join(', '));
    setTheme(p.theme);
    setAtprotoHandle(p.atprotoHandle || '');
    setCustomLinks((p.customLinks || []).map((l) => ({ label: l.label, url: l.url })));
    if (p.publishSettings) {
      setPublishSettings((prev) => ({
        exportPath: '',
        protocol: 'sftp',
        host: '',
        port: 22,
        username: '',
        password: '',
        remotePath: '/var/www/html',
        atprotoPdsUrl: 'https://bsky.social',
        publishFriendsList: false,
        stripRelationshipTags: true,
        publishEndorsements: false,
        publishWebringHub: false,
        redactItemSourceAuthors: false,
        analyticsEnabled: false,
        analyticsMeasurementId: '',
        analyticsRespectDnt: true,
        analyticsAnonymizeIp: true,
        analyticsTrackRingInteractions: true,
        adsEnabled: false,
        adsPublisherId: '',
        adsEnableAutoAds: true,
        adsGenerateAdsTxt: true,
        adsHeaderSlotId: '',
        adsInFeedSlotId: '',
        adsFooterSlotId: '',
        githubOwner: '',
        githubRepo: '',
        githubBranch: 'gh-pages',
        githubToken: '',
        githubCustomDomain: '',
        ...p.publishSettings,
      }));
    }
    if (data.bundle.albums.albums.length > 0) {
      const currentExists = data.bundle.albums.albums.some((a) => a.id === selectedAlbumId);
      if (!currentExists) {
        setSelectedAlbumId(data.bundle.albums.albums[0].id);
      }
    } else {
      setSelectedAlbumId('');
    }
  };

  const handleSwitchPersona = async (personaId: string) => {
    if (!window.studioApi || personaId === activePersonaId) return;
    await window.studioApi.switchPersona(personaId);
    setSelectedAlbumId('');
    setTestExportResult(null);
    setPreviewRenderMode('studio');
    await refreshStudioData();
    const target = personas.find((p) => p.id === personaId);
    notify(
      `Switched to persona "${target?.label || personaId}" — loaded isolated SQLite DB & Ed25519 keypair!`
    );
  };

  const handleCreatePersona = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!window.studioApi || !newPersonaLabel.trim() || !newPersonaDisplayName.trim()) return;
    const res = await window.studioApi.createPersona({
      label: newPersonaLabel.trim(),
      displayName: newPersonaDisplayName.trim(),
      siteUrl: newPersonaSiteUrl.trim() || undefined,
      tagline: newPersonaTagline.trim() || undefined,
      theme: newPersonaTheme,
    });
    setNewPersonaLabel('');
    setNewPersonaDisplayName('');
    setNewPersonaSiteUrl('');
    setNewPersonaTagline('');
    setSelectedAlbumId('');
    setShowPersonaModal(false);
    await refreshStudioData();
    notify(
      `Created compartmentalized persona "${res.created.label}" (${res.created.did}) with its own SQLite DB and Ed25519 keypair!`
    );
  };

  const handleRenamePersona = async (personaId: string) => {
    if (!window.studioApi || !editingPersonaLabel.trim()) return;
    await window.studioApi.updatePersonaLabel(personaId, editingPersonaLabel.trim());
    setEditingPersonaId(null);
    setEditingPersonaLabel('');
    await refreshStudioData();
    notify('Updated persona studio label!');
  };

  const handleDeletePersona = async (personaId: string, label: string) => {
    if (!window.studioApi || personaId === 'default') return;
    const confirmed = window.confirm(
      `Delete persona "${label}" and its local SQLite database? (Exported site folders are not deleted.)`
    );
    if (!confirmed) return;
    await window.studioApi.deletePersona(personaId, true);
    setSelectedAlbumId('');
    await refreshStudioData();
    notify(`Deleted persona "${label}".`);
  };

  useEffect(() => {
    refreshStudioData();
    if (window.studioApi?.getMcpInfo) {
      window.studioApi.getMcpInfo().then((info) => setMcpInfo(info));
    }
    const cleanups: Array<() => void> = [];
    if (window.studioApi) {
      cleanups.push(
        window.studioApi.onDeepLink((action) => {
          handleIncomingDeepLink(action);
        })
      );
      if (window.studioApi.onMcpActivity) {
        cleanups.push(
          window.studioApi.onMcpActivity(() => {
            refreshStudioData();
            window.studioApi?.getMcpInfo?.().then((info) => setMcpInfo(info));
          })
        );
      }
    }
    return () => {
      cleanups.forEach((fn) => fn());
    };
  }, []);

  const handleIncomingDeepLink = (action: WebringDeepLinkAction) => {
    if (action.action === 'friend') {
      setFriendSiteUrl(action.targetUrl);
      setFriendName(action.title || action.authorName || 'New Ring Friend');
      setFriendAvatar(action.mediaUrl || '');
      setActiveTab('friends');
      notify(`Deep Link: Pre-filled friend "${action.title || action.targetUrl}"`);
    } else if (action.action === 'join-ring') {
      setRingHubUrl(action.targetUrl);
      setRingName(action.title || 'Community Webring');
      setActiveTab('friends');
      notify(`Deep Link: Ready to join webring "${action.title || action.targetUrl}"`);
    } else {
      const mappedType: SharedItemType =
        action.action === 'like'
          ? 'like'
          : action.action === 'comment'
          ? 'comment'
          : 'share';
      setItemType(mappedType);
      setItemTargetUrl(action.targetUrl);
      setItemTitle(
        action.action === 'comment'
          ? `Re: ${action.title || 'Post'}`
          : action.title || 'Shared via Webring'
      );
      setItemAuthorUrl(action.authorUrl || '');
      setItemAuthorName(action.authorName || '');
      setItemMediaUrl(action.action === 'comment' ? '' : action.mediaUrl || '');
      setItemCategory(action.action === 'comment' ? 'comment' : action.category || 'general');
      setActiveTab('items');
      notify(
        `webring:// Deep Link intercepted! Ready to ${action.action.toUpperCase()} "${
          action.title || action.targetUrl
        }"`
      );
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!window.studioApi) return;
    await window.studioApi.updateProfile({
      siteUrl,
      handle,
      displayName,
      tagline,
      bio,
      location,
      avatarUrl,
      bannerUrl,
      interests: interestsInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      theme,
      atprotoHandle,
      customLinks: customLinks
        .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
        .filter((l) => l.label && l.url),
      publishSettings,
    });
    await refreshStudioData();
    notify('Profile & DID identity updated and re-signed with Ed25519 keypair!');
  };

  const handleCreateAlbum = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAlbumTitle.trim() || !window.studioApi) return;
    const created = (await window.studioApi.createAlbum({
      title: newAlbumTitle.trim(),
      description: newAlbumDesc.trim(),
      tags: newAlbumTags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    })) as { id: string };
    setNewAlbumTitle('');
    setNewAlbumDesc('');
    setNewAlbumTags('');
    setSelectedAlbumId(created.id);
    await refreshStudioData();
    notify(`Created photo album "${newAlbumTitle}"`);
  };

  const handleAddPhoto = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAlbumId || !newPhotoUrl.trim() || !window.studioApi) return;
    await window.studioApi.addPhoto({
      albumId: selectedAlbumId,
      url: newPhotoUrl.trim(),
      thumbUrl: newPhotoUrl.trim(),
      caption: newPhotoCaption.trim(),
      tags: newPhotoTags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    });
    setNewPhotoUrl('');
    setNewPhotoCaption('');
    setNewPhotoTags('');
    await refreshStudioData();
    notify('Added photo and indexed canonical URI in albums.json!');
  };

  const handlePickLocalPhoto = async () => {
    if (!selectedAlbumId || !window.studioApi) return;
    const imported = await window.studioApi.pickAndImportPhoto(selectedAlbumId);
    if (imported) {
      setNewPhotoUrl(imported.relativeUrl);
      notify(`Imported ${imported.fileName} into local studio media store!`);
    }
  };

  const handlePickLocalPostImage = async () => {
    if (!window.studioApi) return;
    const imported = await window.studioApi.pickAndImportPhoto('wall-posts');
    if (imported) {
      setItemMediaUrl(imported.relativeUrl);
      notify(`Attached ${imported.fileName} to your post!`);
    }
  };

  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!window.studioApi) return;
    if (itemType === 'post') {
      if (!itemCommentary.trim() && !itemTitle.trim()) return;
    } else if (itemType === 'comment') {
      if (!itemTargetUrl.trim() || !itemCommentary.trim()) return;
    } else {
      if (!itemTitle.trim() || !itemTargetUrl.trim()) return;
    }

    await window.studioApi.createItem({
      type: itemType,
      title: itemTitle.trim(),
      targetUrl: itemTargetUrl.trim(),
      targetAuthorName: itemAuthorName.trim(),
      targetAuthorUrl: itemAuthorUrl.trim(),
      category: itemCategory,
      commentary: itemCommentary.trim(),
      mediaUrl: itemMediaUrl.trim(),
      rating: itemType === 'post' || itemType === 'comment' ? undefined : itemRating,
      tags: itemTags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    });
    setItemTitle('');
    setItemTargetUrl('');
    setItemAuthorName('');
    setItemAuthorUrl('');
    setItemCommentary('');
    setItemMediaUrl('');
    setItemTags('');
    await refreshStudioData();
    notify(
      itemType === 'post'
        ? 'Published new Wall Post to your profile & items.json!'
        : itemType === 'comment'
        ? 'Published signed Comment to your items.json (friends will see it under the post when synced)!'
        : `Indexed new ${itemType.toUpperCase()} item in items.json!`
    );
  };

  const handleAddFriend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!friendSiteUrl.trim() || !friendName.trim() || !window.studioApi) return;
    await window.studioApi.addFriend({
      siteUrl: friendSiteUrl.trim(),
      displayName: friendName.trim(),
      avatarUrl: friendAvatar.trim(),
      bio: friendBio.trim(),
      relationship: friendRel
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      visibility: friendVisibility,
    });
    if (friendVisibility === 'public' && !publishSettings.publishFriendsList) {
      const nextSettings = { ...publishSettings, publishFriendsList: true };
      setPublishSettings(nextSettings);
      await window.studioApi.updateProfile({ publishSettings: nextSettings });
    }
    setFriendSiteUrl('');
    setFriendName('');
    setFriendAvatar('');
    setFriendBio('');
    setFriendVisibility('private');
    await refreshStudioData();
    notify(
      friendVisibility === 'private'
        ? `Added ${friendName} as Private (Local Crawler Only — hidden from public connections.json)!`
        : `Added ${friendName} as Public (exported to connections.json)!`
    );
  };

  const handleUpdatePrivacySetting = async (patch: Partial<PublishSettingsState>) => {
    if (!window.studioApi) return;
    const nextSettings = { ...publishSettings, ...patch };
    setPublishSettings(nextSettings);
    await window.studioApi.updateProfile({ publishSettings: nextSettings });
    await refreshStudioData();
    notify('Updated social graph privacy policy and re-signed static JSON bundle!');
  };

  const handleAddWebring = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ringName.trim() || !ringHubUrl.trim() || !window.studioApi) return;
    await window.studioApi.addWebring({
      name: ringName.trim(),
      hubUrl: ringHubUrl.trim(),
      description: ringDesc.trim(),
      prevSiteUrl: ringPrevUrl.trim(),
      nextSiteUrl: ringNextUrl.trim(),
    });
    setRingName('');
    setRingHubUrl('');
    setRingDesc('');
    setRingPrevUrl('');
    setRingNextUrl('');
    await refreshStudioData();
    notify(`Joined Webring "${ringName}"!`);
  };

  const handleStartEditWebring = (ring: WebringMembership) => {
    setEditingRingId(ring.id);
    setEditRingDraft({
      name: ring.name,
      hubUrl: ring.hubUrl,
      description: ring.description || '',
      prevSiteUrl: ring.prevSiteUrl || '',
      nextSiteUrl: ring.nextSiteUrl || '',
    });
  };

  const handleCancelEditWebring = () => {
    setEditingRingId(null);
  };

  const handleSaveEditWebring = async () => {
    if (!editingRingId || !window.studioApi) return;
    await window.studioApi.updateWebring(editingRingId, {
      name: editRingDraft.name.trim(),
      hubUrl: editRingDraft.hubUrl.trim(),
      description: editRingDraft.description.trim(),
      prevSiteUrl: editRingDraft.prevSiteUrl.trim(),
      nextSiteUrl: editRingDraft.nextSiteUrl.trim(),
    });
    setEditingRingId(null);
    await refreshStudioData();
    notify(`Updated Webring "${editRingDraft.name.trim()}"!`);
  };

  const handleDeleteWebring = async (ring: WebringMembership) => {
    if (!window.studioApi) return;
    const confirmed = window.confirm(
      `Remove "${ring.name}" from your joined webrings? This deletes the webring bar it adds to your exported site.`
    );
    if (!confirmed) return;
    await window.studioApi.deleteWebring(ring.id);
    if (editingRingId === ring.id) setEditingRingId(null);
    await refreshStudioData();
    notify(`Left Webring "${ring.name}".`);
  };

  const handleSimulatePeerSync = async () => {
    if (!window.studioApi) return;
    const res = await window.studioApi.simulatePeerSite();
    await refreshStudioData();
    if (res.success) {
      notify(
        `Synced ${res.displayName}'s site! Indexed ${res.itemsIndexed} items, ${res.photosIndexed} photos, and discovered ${res.endorsementsFound} verified endorsement(s) of your content!`
      );
    }
  };

  const handleExportLocalSite = async () => {
    if (!window.studioApi) return;
    const res = await window.studioApi.exportLocal(publishSettings.exportPath || undefined);
    await refreshStudioData();
    notify(res.message);
  };

  const handleRunTestExportPreview = async (openInBrowser = false) => {
    if (!window.studioApi) return;
    const res = await window.studioApi.testExportPreview(openInBrowser);
    setTestExportResult(res);
    setPreviewRenderMode('exported-http');
    setIframeRefreshKey((k) => k + 1);
    notify(
      openInBrowser
        ? `Test export built (${res.filesWritten.length} files) and launched in browser at ${res.previewUrl}`
        : `Test export built (${res.filesWritten.length} files) & served locally at ${res.previewUrl}!`
    );
  };

  const handleChooseExportFolder = async () => {
    if (!window.studioApi) return;
    const chosen = await window.studioApi.chooseExportFolder();
    if (chosen) {
      const nextSettings = { ...publishSettings, exportPath: chosen };
      setPublishSettings(nextSettings);
      await window.studioApi.updateProfile({ publishSettings: nextSettings });
      notify(`Saved local export folder: ${chosen}`);
    }
  };

  const handleSaveRemoteSettings = async () => {
    if (!window.studioApi) return;
    await window.studioApi.updateProfile({ publishSettings });
    await refreshStudioData();
    notify(
      `Saved ${publishSettings.protocol.toUpperCase()} connection settings for this persona in SQLite!`
    );
  };

  const handleClearRemoteSettings = async () => {
    if (!window.studioApi) return;
    const activeLabel =
      personas.find((p) => p.id === activePersonaId)?.label || bundle?.profile.displayName || 'this persona';
    const confirmed = window.confirm(
      `Delete the stored SFTP/FTP server address, username, password, and remote path from ${activeLabel}'s database?`
    );
    if (!confirmed) return;

    const clearedSettings: PublishSettingsState = {
      ...publishSettings,
      protocol: 'sftp',
      host: '',
      port: 22,
      username: '',
      password: '',
      remotePath: '/var/www/html',
    };
    setPublishSettings(clearedSettings);
    await window.studioApi.updateProfile({ publishSettings: clearedSettings });
    await refreshStudioData();
    notify(`Deleted stored SFTP/FTP credentials from ${activeLabel}'s database.`);
  };

  const handlePublishRemote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!window.studioApi) return;
    await window.studioApi.updateProfile({ publishSettings });
    notify(`Saved settings & connecting to ${publishSettings.protocol.toUpperCase()} host ${publishSettings.host}...`);
    const res = await window.studioApi.publishRemote(publishSettings);
    await refreshStudioData();
    notify(res.message);
  };

  const handleSaveGithubSettings = async () => {
    if (!window.studioApi) return;
    await window.studioApi.updateProfile({ publishSettings });
    await refreshStudioData();
    notify('Saved GitHub Pages connection settings for this persona in SQLite!');
  };

  const handleClearGithubSettings = async () => {
    if (!window.studioApi) return;
    const activeLabel =
      personas.find((p) => p.id === activePersonaId)?.label || bundle?.profile.displayName || 'this persona';
    const confirmed = window.confirm(
      `Delete the stored GitHub owner, repo, branch, token, and custom domain from ${activeLabel}'s database?`
    );
    if (!confirmed) return;

    const clearedSettings: PublishSettingsState = {
      ...publishSettings,
      githubOwner: '',
      githubRepo: '',
      githubBranch: 'gh-pages',
      githubToken: '',
      githubCustomDomain: '',
    };
    setPublishSettings(clearedSettings);
    setGithubCheckResult(null);
    await window.studioApi.updateProfile({ publishSettings: clearedSettings });
    await refreshStudioData();
    notify(`Deleted stored GitHub Pages credentials from ${activeLabel}'s database.`);
  };

  const handleCheckGithubRepo = async () => {
    if (!window.studioApi) return;
    setGithubChecking(true);
    try {
      const res = await window.studioApi.checkGithubRepo(publishSettings);
      setGithubCheckResult(res);
      notify(res.message);
    } finally {
      setGithubChecking(false);
    }
  };

  const handlePublishGithub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!window.studioApi) return;
    await window.studioApi.updateProfile({ publishSettings });
    notify(`Saved settings & deploying to github.com/${publishSettings.githubOwner}/${publishSettings.githubRepo}...`);
    setGithubDeploying(true);
    try {
      const res = await window.studioApi.publishGithub(publishSettings);
      await refreshStudioData();
      notify(res.message);
    } finally {
      setGithubDeploying(false);
    }
  };

  if (!bundle) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center">
        <div className="text-center space-y-2">
          <RefreshCw className="w-8 h-8 animate-spin text-indigo-400 mx-auto" />
          <p className="text-sm font-medium">Initializing Local SQLite Database & Ed25519 Keys...</p>
        </div>
      </div>
    );
  }

  const navItems: Array<{ id: StudioTab; label: string; icon: React.ReactNode; badge?: number }> = [
    { id: 'profile', label: 'Profile & Identity', icon: <UserCheck className="w-4 h-4" /> },
    {
      id: 'albums',
      label: 'Photo Albums',
      icon: <Camera className="w-4 h-4" />,
      badge: bundle.manifest.stats.photoCount,
    },
    {
      id: 'items',
      label: 'Posts, Likes & Shares',
      icon: <MessageSquare className="w-4 h-4" />,
      badge: bundle.manifest.stats.itemCount,
    },
    {
      id: 'friends',
      label: 'Friends & Webrings',
      icon: <Users className="w-4 h-4" />,
      badge: allFriends.length,
    },
    {
      id: 'feed',
      label: 'Neighborhood Feed',
      icon: <Radio className="w-4 h-4" />,
      badge: networkFeed.length,
    },
    { id: 'preview', label: 'Live Site Preview', icon: <Compass className="w-4 h-4" /> },
    { id: 'schemas', label: 'JSON Schema Output', icon: <Code2 className="w-4 h-4" /> },
    { id: 'publish', label: 'Publish & SFTP', icon: <UploadCloud className="w-4 h-4" /> },
    {
      id: 'mcp',
      label: 'AI Agent (MCP)',
      icon: <Sparkles className="w-4 h-4" />,
      badge: mcpInfo?.status.toolCount || 24,
    },
    { id: 'help', label: 'Help & Deploy Guide', icon: <BookOpen className="w-4 h-4" /> },
  ];

  const getSelectedSchemaJson = () => {
    switch (selectedSchemaFile) {
      case 'did':
        return bundle.didDocument;
      case 'manifest':
        return bundle.manifest;
      case 'profile':
        return bundle.profile;
      case 'albums':
        return bundle.albums;
      case 'items':
        return bundle.items;
      case 'connections':
        return bundle.connections;
    }
  };

  return (
    <div className="h-screen flex bg-slate-950 text-slate-100 overflow-hidden">
      {/* Left Sidebar Navigation */}
      <aside className="w-64 bg-slate-900/90 border-r border-slate-800 flex flex-col justify-between shrink-0">
        <div>
          <div className="p-5 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/30">
                <Globe className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="font-extrabold text-base tracking-tight">Webring Studio</h1>
                <p className="text-[11px] text-slate-400">Local SQLite • Static JSON v{WEBRING_SCHEMA_VERSION}</p>
              </div>
            </div>
          </div>

          {/* Active Persona Switcher (Strict Compartmentalization) */}
          <div className="p-3 border-b border-slate-800 bg-slate-950/60 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-1">
                <Layers className="w-3 h-3" />
                Active Persona ({personas.length || 1})
              </span>
              <button
                type="button"
                onClick={() => setShowPersonaModal(true)}
                className="text-[11px] px-2 py-0.5 rounded-md bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 font-semibold transition flex items-center gap-1"
                title="Create or manage compartmentalized online personas"
              >
                <Plus className="w-3 h-3" />
                Personas
              </button>
            </div>

            {personas.length > 1 ? (
              <select
                aria-label="Switch Active Persona"
                value={activePersonaId}
                onChange={(e) => handleSwitchPersona(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-semibold text-white focus:outline-none focus:border-indigo-500"
              >
                {personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} — {p.displayName}
                  </option>
                ))}
              </select>
            ) : null}

            <div
              onClick={() => setShowPersonaModal(true)}
              className="p-2 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-indigo-500/40 cursor-pointer transition flex items-center gap-2.5"
              title="Click to switch or create another compartmentalized persona"
            >
              <img
                src={
                  bundle.profile.avatarUrl ||
                  `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(
                    bundle.profile.displayName
                  )}`
                }
                alt={bundle.profile.displayName}
                className="w-8 h-8 rounded-lg object-cover border border-slate-700 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-white truncate">
                    {bundle.profile.displayName}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-medium truncate">
                    {personas.find((p) => p.id === activePersonaId)?.label || 'Primary'}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 font-mono truncate">{bundle.profile.did}</p>
              </div>
            </div>
          </div>

          <nav className="p-3 space-y-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition ${
                  activeTab === item.id
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                    : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  {item.icon}
                  {item.label}
                </span>
                {item.badge !== undefined && (
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      activeTab === item.id
                        ? 'bg-indigo-800 text-indigo-100'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Bottom Identity & Quick Export Card */}
        <div className="p-4 border-t border-slate-800 space-y-2.5 bg-slate-900/50">
          <div className="text-xs space-y-1">
            <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
              <ShieldCheck className="w-4 h-4" />
              <span>Signed DID Ready</span>
            </div>
            <p className="font-mono text-[11px] text-slate-400 truncate" title={bundle.profile.did}>
              {bundle.profile.did}
            </p>
          </div>
          <button
            onClick={async () => {
              await handleRunTestExportPreview(false);
              setActiveTab('preview');
            }}
            className="w-full py-2 px-3 rounded-xl bg-indigo-600/25 hover:bg-indigo-600/40 border border-indigo-500/40 text-indigo-200 font-semibold text-xs flex items-center justify-center gap-1.5 transition"
            title="Build a local test export and preview it over a local HTTP server before publishing"
          >
            <Compass className="w-4 h-4 text-indigo-400" />
            Test Export & Preview
          </button>
          <button
            onClick={handleExportLocalSite}
            className="w-full py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5 shadow transition"
          >
            <FolderOutput className="w-4 h-4" />
            Quick Export Static Site
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Status Bar */}
        <header className="h-14 border-b border-slate-800 bg-slate-900/50 px-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <button
              type="button"
              onClick={() => setShowPersonaModal(true)}
              className="px-2.5 py-1 rounded-md bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-300 font-semibold flex items-center gap-1.5 transition"
              title="Click to switch or manage compartmentalized personas"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>
                Persona: {personas.find((p) => p.id === activePersonaId)?.label || 'Primary'}
              </span>
            </button>
            <span className="px-2.5 py-1 rounded-md bg-slate-800 text-slate-200 font-mono">
              {bundle.profile.siteUrl}
            </span>
            <span>•</span>
            <span>
              Endorsements Discovered:{' '}
              <strong className="text-pink-400">{allEndorsements.length}</strong>
            </span>
            <span>•</span>
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <Lock className="w-3 h-3" />
              Publicly Exported Friends: <strong>{bundle.connections.friends.length}</strong> / {allFriends.length}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {statusMessage && (
              <div className="px-3 py-1 rounded-lg bg-indigo-500/20 border border-indigo-500/40 text-indigo-200 text-xs flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span className="truncate max-w-md">{statusMessage}</span>
              </div>
            )}
            <button
              onClick={handleSimulatePeerSync}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-indigo-300 flex items-center gap-1.5 border border-slate-700"
              title="Simulates a peer's static JSON website on disk and crawls their likes/shares of your items"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Simulate & Crawl Peer Ring
            </button>
          </div>
        </header>

        {/* Scrollable Workspace */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* TAB 1: PROFILE & IDENTITY */}
          {activeTab === 'profile' && (
            <div className="max-w-4xl mx-auto space-y-6">
              <div>
                <h2 className="text-2xl font-bold">Profile & Federated Identity</h2>
                <p className="text-sm text-slate-400 mt-1">
                  Configure your personal profile site, theme, and W3C / ATProto <code>did:web</code>{' '}
                  identity. Saving automatically signs <code>/api/profile.json</code> and{' '}
                  <code>/.well-known/did.json</code>.
                </p>
              </div>

              <form
                onSubmit={handleSaveProfile}
                className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                      Hosted Website URL (Canonical Root)
                    </label>
                    <input
                      type="text"
                      value={siteUrl}
                      onChange={(e) => setSiteUrl(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm focus:border-indigo-500 focus:outline-none"
                      placeholder="https://yourname.example.com"
                    />
                    <p className="text-[11px] text-emerald-400 font-mono mt-1">
                      Generated DID: {siteUrlToDidWeb(siteUrl)}
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                      Display Name
                    </label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm focus:border-indigo-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                      Tagline / Headline
                    </label>
                    <input
                      type="text"
                      value={tagline}
                      onChange={(e) => setTagline(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm focus:border-indigo-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                      Profile Website Theme
                    </label>
                    <select
                      value={theme}
                      onChange={(e) => setTheme(e.target.value as ProfileTheme)}
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm focus:border-indigo-500 focus:outline-none"
                    >
                      <option value="neo-webring">Neo-Webring (Dark Slate & Indigo)</option>
                      <option value="minimal-zine">Minimalist Zine (Editorial Paper & Serif)</option>
                      <option value="cyber-terminal">Cyber Terminal (Black & Phosphor Green)</option>
                      <option value="cozy-scrapbook">Cozy Scrapbook (Warm Amber & Polaroid)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                    About / Bio
                  </label>
                  <textarea
                    rows={3}
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                      Avatar URL
                    </label>
                    <input
                      type="text"
                      value={avatarUrl}
                      onChange={(e) => setAvatarUrl(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm focus:border-indigo-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                      Banner Image URL
                    </label>
                    <input
                      type="text"
                      value={bannerUrl}
                      onChange={(e) => setBannerUrl(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm focus:border-indigo-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                      Interests (Comma-separated tags)
                    </label>
                    <input
                      type="text"
                      value={interestsInput}
                      onChange={(e) => setInterestsInput(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm focus:border-indigo-500 focus:outline-none"
                      placeholder="Photography, IndieWeb, Sci-Fi, Synth"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                      Bluesky / ATProto Handle (Optional)
                    </label>
                    <input
                      type="text"
                      value={atprotoHandle}
                      onChange={(e) => setAtprotoHandle(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm focus:border-indigo-500 focus:outline-none"
                      placeholder="yourname.bsky.social"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Custom Links (shown below your bio)
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setCustomLinks((prev) => [...prev, { label: '', url: '' }])
                      }
                      className="text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 font-medium"
                    >
                      + Add Link
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Use a URL starting with <code>./</code> (e.g. <code>./api/manifest.json</code>)
                    to point at a file inside your own exported site — not a leading{' '}
                    <code>/</code>, which breaks once your site is hosted in a subfolder (like a
                    GitHub Pages project site at <code>username.github.io/repo-name/</code>).
                  </p>
                  {customLinks.length === 0 && (
                    <p className="text-xs text-slate-500 italic">No custom links yet.</p>
                  )}
                  {customLinks.map((link, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <input
                        type="text"
                        value={link.label}
                        onChange={(e) =>
                          setCustomLinks((prev) =>
                            prev.map((l, i) => (i === idx ? { ...l, label: e.target.value } : l))
                          )
                        }
                        placeholder="Label"
                        className="w-40 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                      />
                      <input
                        type="text"
                        value={link.url}
                        onChange={(e) =>
                          setCustomLinks((prev) =>
                            prev.map((l, i) => (i === idx ? { ...l, url: e.target.value } : l))
                          )
                        }
                        placeholder="./api/manifest.json or https://..."
                        className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setCustomLinks((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="p-2 rounded-lg bg-rose-950/40 hover:bg-rose-900/50 border border-rose-500/30 text-rose-300"
                        title="Remove this link"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="pt-2 flex items-center justify-between">
                  <div className="text-xs text-slate-400">
                    Ed25519 Verification Method:{' '}
                    <code className="text-indigo-300">{bundle.profile.did}#key-1</code>
                  </div>
                  <button
                    type="submit"
                    className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/25 transition"
                  >
                    Save & Sign Profile JSON
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 2: PHOTO ALBUMS */}
          {activeTab === 'albums' && (
            <div className="max-w-5xl mx-auto space-y-6">
              <div>
                <h2 className="text-2xl font-bold">Photo Albums Manager</h2>
                <p className="text-sm text-slate-400 mt-1">
                  Organize photo galleries stored locally and published to{' '}
                  <code>/api/albums.json</code>. Each photo gets a canonical schema URI so friends
                  can like or re-share individual shots.
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Create Album Card */}
                <form
                  onSubmit={handleCreateAlbum}
                  className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4"
                >
                  <h3 className="font-bold text-base flex items-center gap-2">
                    <Plus className="w-4 h-4 text-indigo-400" /> Create New Photo Album
                  </h3>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Album Title</label>
                    <input
                      type="text"
                      required
                      value={newAlbumTitle}
                      onChange={(e) => setNewAlbumTitle(e.target.value)}
                      placeholder="e.g., Summer Roadtrip 35mm"
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Description</label>
                    <input
                      type="text"
                      value={newAlbumDesc}
                      onChange={(e) => setNewAlbumDesc(e.target.value)}
                      placeholder="Notes about this collection..."
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Tags (comma-separated)</label>
                    <input
                      type="text"
                      value={newAlbumTags}
                      onChange={(e) => setNewAlbumTags(e.target.value)}
                      placeholder="analog, travel, landscape"
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs"
                  >
                    + Create Album
                  </button>
                </form>

                {/* Add Photo to Album Card */}
                <form
                  onSubmit={handleAddPhoto}
                  className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4"
                >
                  <h3 className="font-bold text-base flex items-center gap-2">
                    <ImagePlus className="w-4 h-4 text-emerald-400" /> Add Photo to Album
                  </h3>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Target Album</label>
                    <select
                      value={selectedAlbumId}
                      onChange={(e) => setSelectedAlbumId(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                    >
                      {bundle.albums.albums.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.title} ({a.photos.length} photos)
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Photo Source (Import Local File or Image URL)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        required
                        value={newPhotoUrl}
                        onChange={(e) => setNewPhotoUrl(e.target.value)}
                        placeholder="https://... or media/albums/..."
                        className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                      />
                      <button
                        type="button"
                        onClick={handlePickLocalPhoto}
                        className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium shrink-0"
                      >
                        Browse File...
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Caption</label>
                      <input
                        type="text"
                        value={newPhotoCaption}
                        onChange={(e) => setNewPhotoCaption(e.target.value)}
                        placeholder="Golden hour over the bay..."
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Tags</label>
                      <input
                        type="text"
                        value={newPhotoTags}
                        onChange={(e) => setNewPhotoTags(e.target.value)}
                        placeholder="sunset, film"
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs"
                  >
                    + Add Photo to Album
                  </button>
                </form>
              </div>

              {/* Existing Albums List */}
              <div className="space-y-6">
                {bundle.albums.albums.map((album) => (
                  <div
                    key={album.id}
                    className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-bold text-lg">{album.title}</h4>
                        <p className="text-xs text-slate-400">{album.description}</p>
                        <p className="text-[11px] font-mono text-indigo-400 mt-1">
                          Canonical URI: {album.canonicalUrl}
                        </p>
                      </div>
                      <button
                        onClick={async () => {
                          await window.studioApi?.deleteAlbum(album.id);
                          await refreshStudioData();
                        }}
                        className="text-slate-500 hover:text-rose-400 p-1.5"
                        title="Delete Album"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                      {album.photos.map((photo) => (
                        <div
                          key={photo.id}
                          className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden flex flex-col justify-between"
                        >
                          <div>
                            <img
                              src={photo.thumbUrl || photo.url}
                              alt={photo.caption}
                              className="w-full h-40 object-cover bg-slate-900"
                            />
                            <div className="p-3">
                              <p className="text-xs font-medium">{photo.caption}</p>
                              <p className="text-[10px] font-mono text-slate-500 truncate mt-1">
                                {photo.canonicalUrl}
                              </p>
                            </div>
                          </div>
                          <div className="px-3 py-2 border-t border-slate-800 flex justify-between items-center">
                            <span className="text-[10px] text-slate-400">
                              {photo.tags.map((t) => `#${t}`).join(' ')}
                            </span>
                            <button
                              onClick={async () => {
                                await window.studioApi?.deletePhoto(photo.id);
                                await refreshStudioData();
                              }}
                              className="text-slate-500 hover:text-rose-400"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: WALL POSTS, LIKES & SHARES */}
          {activeTab === 'items' && (
            <div className="max-w-5xl mx-auto space-y-6">
              <div>
                <h2 className="text-2xl font-bold">Wall Posts, Likes, Shares & Comments</h2>
                <p className="text-sm text-slate-400 mt-1">
                  Publish Facebook-style status updates and wall posts, curate articles/music/gear you
                  love, or post signed comments on friends' posts. Everything is cryptographically
                  signed into <code>/api/items.json</code> so your friend ring can pull and thread it!
                </p>
              </div>

              <form
                onSubmit={handleCreateItem}
                className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-bold text-base flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    {itemType === 'post'
                      ? 'Compose a Wall Post / Status Update'
                      : itemType === 'comment'
                      ? 'Write a Signed Comment on a Friend’s Post'
                      : 'Log a Like, Share, or Recommendation'}
                  </h3>

                  {/* Quick Mode Selector Pills */}
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {(
                      [
                        { id: 'post', label: '📝 Wall Post' },
                        { id: 'like', label: '♥ Like' },
                        { id: 'share', label: '↻ Share' },
                        { id: 'recommendation', label: '★ Recommend' },
                        { id: 'comment', label: '💬 Comment' },
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setItemType(m.id);
                          if (m.id === 'post') setItemCategory('status');
                          if (m.id === 'comment') setItemCategory('comment');
                        }}
                        className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                          itemType === m.id
                            ? 'bg-indigo-600 text-white shadow'
                            : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {itemType === 'post' ? (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="md:col-span-2">
                        <label className="block text-xs text-slate-400 mb-1">
                          Headline / Post Title (Optional — auto-generated from text if blank)
                        </label>
                        <input
                          type="text"
                          value={itemTitle}
                          onChange={(e) => setItemTitle(e.target.value)}
                          placeholder="e.g., Weekend Darkroom Notes & New Prints"
                          className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Topic / Category</label>
                        <select
                          value={itemCategory}
                          onChange={(e) => setItemCategory(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                        >
                          <option value="status">Status Update / Wall Post</option>
                          <option value="article">Essay / Micro-Blog</option>
                          <option value="photo">Photo Post</option>
                          <option value="music">Music / Audio Note</option>
                          <option value="general">General</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        Post Body (Multi-line text — what's on your mind?) *
                      </label>
                      <textarea
                        rows={4}
                        required={!itemTitle.trim()}
                        value={itemCommentary}
                        onChange={(e) => setItemCommentary(e.target.value)}
                        placeholder="Write your status update, thoughts, or story here..."
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm leading-relaxed"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="md:col-span-2">
                        <label className="block text-xs text-slate-400 mb-1">
                          Attach Photo or Media URL (Optional)
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={itemMediaUrl}
                            onChange={(e) => setItemMediaUrl(e.target.value)}
                            placeholder="https://... or import a local image"
                            className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                          />
                          <button
                            type="button"
                            onClick={handlePickLocalPostImage}
                            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium flex items-center gap-1.5 shrink-0"
                          >
                            <ImagePlus className="w-4 h-4 text-indigo-400" />
                            Import Image
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">
                          Tags (comma-separated)
                        </label>
                        <input
                          type="text"
                          value={itemTags}
                          onChange={(e) => setItemTags(e.target.value)}
                          placeholder="status, update, photography"
                          className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Interaction Type</label>
                        <select
                          value={itemType}
                          onChange={(e) => setItemType(e.target.value as SharedItemType)}
                          className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                        >
                          <option value="post">📝 Wall Post (Status Update)</option>
                          <option value="like">♥ Like (Thing I Like)</option>
                          <option value="share">↻ Share (Syndicated Item)</option>
                          <option value="recommendation">★ Recommendation (Gear / Book / Place)</option>
                          <option value="comment">💬 Comment (Reply to a Friend's Post)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Category</label>
                        <select
                          value={itemCategory}
                          onChange={(e) => setItemCategory(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                        >
                          <option value="comment">Comment / Reply</option>
                          <option value="article">Article / Essay</option>
                          <option value="photo">Photo / Visual Art</option>
                          <option value="music">Music / Audio</option>
                          <option value="book">Book / Zine</option>
                          <option value="gear">Tool / Hardware / Gear</option>
                          <option value="general">General Web Item</option>
                        </select>
                      </div>

                      {itemType !== 'comment' && (
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">
                            Rating (1 - 5 Stars)
                          </label>
                          <select
                            value={itemRating}
                            onChange={(e) => setItemRating(Number(e.target.value))}
                            className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                          >
                            <option value={5}>★★★★★ (5/5 Essential)</option>
                            <option value={4}>★★★★☆ (4/5 Great)</option>
                            <option value={3}>★★★☆☆ (3/5 Good)</option>
                            <option value={2}>★★☆☆☆ (2/5 Meh)</option>
                            <option value={1}>★☆☆☆☆ (1/5 Skip)</option>
                          </select>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">
                          {itemType === 'comment' ? 'Subject / Replying To' : 'Item Title *'}
                        </label>
                        <input
                          type="text"
                          required={itemType !== 'comment'}
                          value={itemTitle}
                          onChange={(e) => setItemTitle(e.target.value)}
                          placeholder={
                            itemType === 'comment'
                              ? 'Re: Friend’s post title'
                              : 'Title of the photo, post, album, or thing you like'
                          }
                          className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-slate-400 mb-1">
                          {itemType === 'comment'
                            ? "Target Post Canonical URI (Friend's Post or Photo URL) *"
                            : "Target URL (Indexed Website or Friend's Canonical Item URI) *"}
                        </label>
                        <input
                          type="text"
                          required
                          value={itemTargetUrl}
                          onChange={(e) => setItemTargetUrl(e.target.value)}
                          placeholder="https://friend.example/api/items.json#item-123"
                          className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">
                          Original Author Name
                        </label>
                        <input
                          type="text"
                          value={itemAuthorName}
                          onChange={(e) => setItemAuthorName(e.target.value)}
                          placeholder="e.g., Maya Lin"
                          className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">
                          Original Author Site URL
                        </label>
                        <input
                          type="text"
                          value={itemAuthorUrl}
                          onChange={(e) => setItemAuthorUrl(e.target.value)}
                          placeholder="https://maya.indiering.social"
                          className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">
                          Preview Image URL (Optional)
                        </label>
                        <input
                          type="text"
                          value={itemMediaUrl}
                          onChange={(e) => setItemMediaUrl(e.target.value)}
                          placeholder="https://..."
                          className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="md:col-span-2">
                        <label className="block text-xs text-slate-400 mb-1">
                          {itemType === 'comment'
                            ? 'Your Comment / Reply *'
                            : 'Your Commentary / Notes'}
                        </label>
                        <textarea
                          rows={itemType === 'comment' ? 3 : 2}
                          required={itemType === 'comment'}
                          value={itemCommentary}
                          onChange={(e) => setItemCommentary(e.target.value)}
                          placeholder={
                            itemType === 'comment'
                              ? 'Write your reply to this post...'
                              : 'Why do you like or recommend this item?'
                          }
                          className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">
                          Tags (comma-separated)
                        </label>
                        <input
                          type="text"
                          value={itemTags}
                          onChange={(e) => setItemTags(e.target.value)}
                          placeholder="indieweb, music, synth"
                          className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                        />
                      </div>
                    </div>
                  </>
                )}

                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow"
                >
                  {itemType === 'post'
                    ? '+ Publish Wall Post to My Profile'
                    : itemType === 'comment'
                    ? '+ Publish Signed Comment to My Feed'
                    : '+ Publish Item to My Schema'}
                </button>
              </form>

              {/* Existing Items & Wall Posts Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {bundle.items.items.map((item) => {
                  const postComments = allEndorsements.filter(
                    (e) => e.targetCanonicalUrl === item.canonicalUrl && e.type === 'comment'
                  );
                  return (
                    <div
                      key={item.id}
                      className={`bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between ${
                        item.type === 'post' ? 'md:col-span-2' : ''
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span
                            className={`text-[11px] uppercase font-bold px-2.5 py-0.5 rounded-full ${
                              item.type === 'post'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : item.type === 'like'
                                ? 'bg-pink-500/20 text-pink-400'
                                : item.type === 'recommendation'
                                ? 'bg-amber-500/20 text-amber-400'
                                : item.type === 'comment'
                                ? 'bg-purple-500/20 text-purple-300'
                                : 'bg-sky-500/20 text-sky-400'
                            }`}
                          >
                            {item.type === 'post' ? '📝 Wall Post' : item.type}
                          </span>
                          <button
                            onClick={async () => {
                              await window.studioApi?.deleteItem(item.id);
                              await refreshStudioData();
                            }}
                            className="text-slate-500 hover:text-rose-400"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        {item.mediaUrl && (
                          <img
                            src={item.mediaUrl}
                            alt={item.title}
                            className="w-full max-h-60 object-cover rounded-xl mb-3"
                          />
                        )}
                        <h4 className="font-bold text-base">{item.title}</h4>
                        {item.targetUrl !== item.canonicalUrl && (
                          <p className="text-xs text-indigo-400 font-mono truncate mt-0.5">
                            Target: {item.targetUrl}
                          </p>
                        )}
                        <p className="text-sm text-slate-300 mt-2 whitespace-pre-line">
                          {item.commentary}
                        </p>

                        {postComments.length > 0 && (
                          <div className="mt-3 pt-2.5 border-t border-slate-800 space-y-1.5">
                            <p className="text-xs font-bold text-emerald-400">
                              💬 Discovered Ring Comments ({postComments.length})
                            </p>
                            {postComments.map((c) => (
                              <div
                                key={c.id}
                                className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs"
                              >
                                <span className="font-bold text-indigo-300">{c.authorName}: </span>
                                <span className="text-slate-300">{c.commentary}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="mt-3 pt-2.5 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-500 font-mono">
                        <span className="truncate">{item.canonicalUrl}</span>
                        <span>{item.category}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 4: FRIENDS & WEBRINGS */}
          {activeTab === 'friends' && (
            <div className="max-w-5xl mx-auto space-y-8">
              <div>
                <h2 className="text-2xl font-bold">Friend Connections & Webrings</h2>
                <p className="text-sm text-slate-400 mt-1">
                  Follow friends locally to pull their feeds into your Neighborhood Feed without
                  exposing your social graph to third-party web scrapers. By default, friends are{' '}
                  <strong>Private (Local SQLite Only)</strong> and omitted from{' '}
                  <code>/api/connections.json</code>.
                </p>
              </div>

              {/* Social Graph Privacy & Anti-Scraping Shield Panel */}
              <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                      <Lock className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm flex items-center gap-2">
                        Social Graph Privacy & Anti-Scraping Shield
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono">
                          {publishSettings.publishFriendsList
                            ? `${bundle.connections.friends.length} Public / ${
                                allFriends.length - bundle.connections.friends.length
                              } Private`
                            : '100% Local-Only Graph'}
                        </span>
                      </h3>
                      <p className="text-xs text-slate-400">
                        Control what social metadata is written to your static <code>/api/*.json</code>{' '}
                        files and <code>index.html</code>. Your local RingCrawler always indexes all{' '}
                        {allFriends.length} friend(s) regardless of public export settings.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 text-xs">
                  <label className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(publishSettings.publishFriendsList)}
                      onChange={(e) =>
                        handleUpdatePrivacySetting({ publishFriendsList: e.target.checked })
                      }
                      className="mt-0.5 accent-indigo-500"
                    />
                    <div>
                      <span className="font-semibold text-slate-200 block">
                        Publish Public Friends to Blogroll (<code>/api/connections.json</code>)
                      </span>
                      <span className="text-slate-400">
                        When unchecked (default), <code>friends: []</code> is exported so scrapers
                        cannot map your connections. When checked, only friends marked{' '}
                        <strong>Public</strong> below are exported.
                      </span>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={publishSettings.stripRelationshipTags !== false}
                      onChange={(e) =>
                        handleUpdatePrivacySetting({ stripRelationshipTags: e.target.checked })
                      }
                      className="mt-0.5 accent-indigo-500"
                    />
                    <div>
                      <span className="font-semibold text-slate-200 block">
                        Strip XFN Relationship Tags from Exported JSON
                      </span>
                      <span className="text-slate-400">
                        Keeps real-world tags (<code>met</code>, <code>kin</code>,{' '}
                        <code>colleague</code>, <code>muse</code>) in local SQLite only and strips
                        them from public JSON.
                      </span>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(publishSettings.publishEndorsements)}
                      onChange={(e) =>
                        handleUpdatePrivacySetting({ publishEndorsements: e.target.checked })
                      }
                      className="mt-0.5 accent-indigo-500"
                    />
                    <div>
                      <span className="font-semibold text-slate-200 block">
                        Publish Back-Endorsements in <code>/api/connections.json</code>
                      </span>
                      <span className="text-slate-400">
                        When unchecked, discovered likes/shares from peers remain visible in your
                        Studio without republishing peer interaction edges.
                      </span>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(publishSettings.publishWebringHub)}
                      onChange={(e) =>
                        handleUpdatePrivacySetting({ publishWebringHub: e.target.checked })
                      }
                      className="mt-0.5 accent-indigo-500"
                    />
                    <div>
                      <span className="font-semibold text-slate-200 block">
                        Generate Public <code>/api/webring-hub.json</code> Directory
                      </span>
                      <span className="text-slate-400">
                        Only enable if you want your site to act as a public directory hub for your
                        public friends.
                      </span>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer md:col-span-2">
                    <input
                      type="checkbox"
                      checked={Boolean(publishSettings.redactItemSourceAuthors)}
                      onChange={(e) =>
                        handleUpdatePrivacySetting({ redactItemSourceAuthors: e.target.checked })
                      }
                      className="mt-0.5 accent-indigo-500"
                    />
                    <div>
                      <span className="font-semibold text-slate-200 block">
                        Redact Peer Author Attribution in <code>/api/items.json</code>
                      </span>
                      <span className="text-slate-400">
                        Strips <code>targetAuthorUrl</code>, <code>targetAuthorName</code>, and{' '}
                        <code>viaUrl</code> from exported items so shared links do not reveal which
                        friend you discovered them from.
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Add Friend Form */}
                <form
                  onSubmit={handleAddFriend}
                  className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4"
                >
                  <h3 className="font-bold text-base flex items-center gap-2">
                    <UserPlus className="w-4 h-4 text-emerald-400" /> Add Friend Profile Site
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Friend's Website URL</label>
                      <input
                        type="text"
                        required
                        value={friendSiteUrl}
                        onChange={(e) => setFriendSiteUrl(e.target.value)}
                        placeholder="https://friend.indiering.social"
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Display Name</label>
                      <input
                        type="text"
                        required
                        value={friendName}
                        onChange={(e) => setFriendName(e.target.value)}
                        placeholder="Devon K."
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        Relationship Tags (Local SQLite)
                      </label>
                      <input
                        type="text"
                        value={friendRel}
                        onChange={(e) => setFriendRel(e.target.value)}
                        placeholder="friend, met, colleague, muse"
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        Connection Visibility
                      </label>
                      <select
                        value={friendVisibility}
                        onChange={(e) => setFriendVisibility(e.target.value as FriendVisibility)}
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                      >
                        <option value="private">🔒 Private (Local Crawler Only)</option>
                        <option value="public">🌐 Public (Allow on Blogroll)</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Avatar URL (Optional)</label>
                      <input
                        type="text"
                        value={friendAvatar}
                        onChange={(e) => setFriendAvatar(e.target.value)}
                        placeholder="https://..."
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Short Bio Note</label>
                      <input
                        type="text"
                        value={friendBio}
                        onChange={(e) => setFriendBio(e.target.value)}
                        placeholder="How you know them..."
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs"
                  >
                    + Add Friend to Local Ring
                  </button>
                </form>

                {/* Join Webring Form */}
                <form
                  onSubmit={handleAddWebring}
                  className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4"
                >
                  <h3 className="font-bold text-base flex items-center gap-2">
                    <Layers className="w-4 h-4 text-indigo-400" /> Join a Webring Directory
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Webring Name</label>
                      <input
                        type="text"
                        required
                        value={ringName}
                        onChange={(e) => setRingName(e.target.value)}
                        placeholder="Analog Photo Ring"
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Webring Hub JSON URL</label>
                      <input
                        type="text"
                        required
                        value={ringHubUrl}
                        onChange={(e) => setRingHubUrl(e.target.value)}
                        placeholder="https://ring.example/webring-hub.json"
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Description</label>
                    <input
                      type="text"
                      value={ringDesc}
                      onChange={(e) => setRingDesc(e.target.value)}
                      placeholder="A circle of independent creators..."
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Previous Neighbor URL</label>
                      <input
                        type="text"
                        value={ringPrevUrl}
                        onChange={(e) => setRingPrevUrl(e.target.value)}
                        placeholder="https://prev.example"
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Next Neighbor URL</label>
                      <input
                        type="text"
                        value={ringNextUrl}
                        onChange={(e) => setRingNextUrl(e.target.value)}
                        placeholder="https://next.example"
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs"
                  >
                    + Add Webring Bar to My Site
                  </button>
                </form>
              </div>

              {/* Joined Webrings List (edit the banner text shown on your site) */}
              {bundle.connections.webrings.length > 0 && (
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <h3 className="font-bold text-lg">
                      Joined Webrings ({bundle.connections.webrings.length})
                    </h3>
                    <p className="text-xs text-slate-400">
                      This is the banner shown at the top of your Live Site Preview & exported site.
                    </p>
                  </div>
                  <div className="space-y-3">
                    {bundle.connections.webrings.map((ring) => {
                      const isEditing = editingRingId === ring.id;
                      return (
                        <div
                          key={ring.id}
                          className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3"
                        >
                          {isEditing ? (
                            <>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-xs text-slate-400 mb-1">Webring Name</label>
                                  <input
                                    type="text"
                                    value={editRingDraft.name}
                                    onChange={(e) =>
                                      setEditRingDraft((prev) => ({ ...prev, name: e.target.value }))
                                    }
                                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs text-slate-400 mb-1">Webring Hub JSON URL</label>
                                  <input
                                    type="text"
                                    value={editRingDraft.hubUrl}
                                    onChange={(e) =>
                                      setEditRingDraft((prev) => ({ ...prev, hubUrl: e.target.value }))
                                    }
                                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono"
                                  />
                                </div>
                              </div>
                              <div>
                                <label className="block text-xs text-slate-400 mb-1">Description</label>
                                <input
                                  type="text"
                                  value={editRingDraft.description}
                                  onChange={(e) =>
                                    setEditRingDraft((prev) => ({ ...prev, description: e.target.value }))
                                  }
                                  placeholder="A circle of independent creators..."
                                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                                />
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-xs text-slate-400 mb-1">Previous Neighbor URL</label>
                                  <input
                                    type="text"
                                    value={editRingDraft.prevSiteUrl}
                                    onChange={(e) =>
                                      setEditRingDraft((prev) => ({ ...prev, prevSiteUrl: e.target.value }))
                                    }
                                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs text-slate-400 mb-1">Next Neighbor URL</label>
                                  <input
                                    type="text"
                                    value={editRingDraft.nextSiteUrl}
                                    onChange={(e) =>
                                      setEditRingDraft((prev) => ({ ...prev, nextSiteUrl: e.target.value }))
                                    }
                                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                                  />
                                </div>
                              </div>
                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={handleSaveEditWebring}
                                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-1.5"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  Save Changes
                                </button>
                                <button
                                  type="button"
                                  onClick={handleCancelEditWebring}
                                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium"
                                >
                                  Cancel
                                </button>
                              </div>
                            </>
                          ) : (
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 text-[10px] font-bold tracking-wide">
                                    WEBRING
                                  </span>
                                  <h4 className="font-bold text-sm truncate">{ring.name}</h4>
                                </div>
                                {ring.description && (
                                  <p className="text-xs text-slate-400 mt-1">— {ring.description}</p>
                                )}
                                <p className="text-xs text-indigo-400 font-mono truncate mt-1">{ring.hubUrl}</p>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleStartEditWebring(ring)}
                                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteWebring(ring)}
                                  className="px-2.5 py-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/50 border border-rose-500/30 text-rose-300"
                                  title="Leave this webring (removes its banner from your site)"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Friends List */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <h3 className="font-bold text-lg">
                    Local Ring Friends ({allFriends.length} Total •{' '}
                    {bundle.connections.friends.length} Exported to Public JSON)
                  </h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {allFriends.map((friend) => {
                    const isPublic = friend.visibility === 'public';
                    const isActuallyExported =
                      isPublic && Boolean(publishSettings.publishFriendsList);
                    return (
                      <div
                        key={friend.id}
                        className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between gap-4"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <img
                            src={
                              friend.avatarUrl ||
                              `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(
                                friend.displayName
                              )}`
                            }
                            alt={friend.displayName}
                            className="w-12 h-12 rounded-full object-cover bg-slate-800"
                          />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="font-bold text-sm truncate">{friend.displayName}</h4>
                              <span
                                className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                                  isActuallyExported
                                    ? 'bg-amber-500/20 text-amber-300'
                                    : 'bg-emerald-500/20 text-emerald-300'
                                }`}
                              >
                                {isActuallyExported
                                  ? '🌐 Exported'
                                  : isPublic
                                  ? '🌐 Public (Blogroll Off)'
                                  : '🔒 Private (Local Only)'}
                              </span>
                              {friend.keyStatus === 'pinned' && (
                                <span
                                  className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                                  title="Ed25519 Public Key Pinned via Trust-On-First-Use (TOFU)"
                                >
                                  🔐 Key Pinned (TOFU)
                                </span>
                              )}
                              {friend.keyStatus === 'changed' && (
                                <span
                                  className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40"
                                  title="WARNING: Friend domain's Ed25519 key in did.json changed unexpectedly! Signatures rejected."
                                >
                                  🚨 Key Changed Warning!
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-indigo-400 font-mono truncate">
                              {friend.siteUrl}
                            </p>
                            <p className="text-xs text-slate-400 truncate mt-0.5">{friend.bio}</p>
                            <div className="flex gap-1 mt-1">
                              {friend.relationship.map((r) => (
                                <span
                                  key={r}
                                  className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300"
                                >
                                  {r}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={async () => {
                              const nextVis: FriendVisibility = isPublic ? 'private' : 'public';
                              await window.studioApi?.setFriendVisibility(friend.id, nextVis);
                              if (nextVis === 'public' && !publishSettings.publishFriendsList) {
                                const nextSettings = {
                                  ...publishSettings,
                                  publishFriendsList: true,
                                };
                                setPublishSettings(nextSettings);
                                await window.studioApi?.updateProfile({
                                  publishSettings: nextSettings,
                                });
                              }
                              await refreshStudioData();
                              notify(
                                `${friend.displayName} is now ${
                                  nextVis === 'private'
                                    ? 'Private (Local Crawler Only — hidden from connections.json)'
                                    : 'Public (Exported to connections.json & profile site)'
                                }`
                              );
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs"
                            title="Toggle whether this friend is exported to public connections.json or kept local-only"
                          >
                            {isPublic ? 'Make Private' : 'Make Public'}
                          </button>
                          <button
                            onClick={async () => {
                              notify(`Crawling ${friend.siteUrl}...`);
                              const res = await window.studioApi?.crawlFriend(friend.siteUrl);
                              await refreshStudioData();
                              if (res?.success) {
                                notify(`Synced ${friend.displayName}: ${res.itemsIndexed} items indexed!`);
                              } else {
                                notify(
                                  `Note: ${friend.siteUrl} is offline or simulated. Use "Simulate & Crawl Peer Ring" top-right to test!`
                                );
                              }
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs flex items-center gap-1"
                          >
                            <RefreshCw className="w-3 h-3" /> Sync JSON
                          </button>
                          <button
                            onClick={async () => {
                              await window.studioApi?.deleteFriend(friend.id);
                              await refreshStudioData();
                            }}
                            className="text-slate-500 hover:text-rose-400 p-1"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: NEIGHBORHOOD FEED (PULL FEDERATION) */}
          {activeTab === 'feed' && (
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold">Neighborhood Ring Feed</h2>
                  <p className="text-sm text-slate-400 mt-1">
                    Chronological, algorithm-free updates pulled directly from your friends' static{' '}
                    <code>/api/albums.json</code> and <code>/api/items.json</code> endpoints.
                  </p>
                </div>
                <button
                  onClick={handleSimulatePeerSync}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center gap-2 shadow"
                >
                  <RefreshCw className="w-4 h-4" />
                  Crawl & Sync Ring Peers Now
                </button>
              </div>

              {networkFeed.length === 0 ? (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center space-y-3">
                  <Radio className="w-10 h-10 text-indigo-400 mx-auto" />
                  <h3 className="font-bold text-base">Your Neighborhood Feed is Ready</h3>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    Click <strong>"Crawl & Sync Ring Peers Now"</strong> above to generate a live
                    simulated peer site (Maya Lin) and crawl her signed JSON endpoints into your
                    local SQLite database!
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {networkFeed
                    .filter((entry) => entry.entryType !== 'comment')
                    .map((entry) => {
                      const peerComments = networkFeed.filter(
                        (c) => c.entryType === 'comment' && c.targetUrl === entry.canonicalUrl
                      );
                      const myComments = bundle.items.items.filter(
                        (c) => c.type === 'comment' && c.targetUrl === entry.canonicalUrl
                      );

                      return (
                        <div
                          key={entry.id}
                          className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4"
                        >
                          <div className="space-y-2 min-w-0">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <img
                                  src={
                                    entry.friendAvatarUrl ||
                                    `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(
                                      entry.friendName
                                    )}`
                                  }
                                  alt={entry.friendName}
                                  className="w-8 h-8 rounded-full object-cover shrink-0"
                                />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-bold text-sm">{entry.friendName}</span>
                                    {entry.verifiedSignature && (
                                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-mono">
                                        ✓ Verified DID Signature
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-slate-400 font-mono truncate">
                                    {entry.friendSiteUrl}
                                  </p>
                                </div>
                              </div>

                              <span
                                className={`text-xs uppercase font-bold px-2.5 py-0.5 rounded-full shrink-0 ${
                                  entry.entryType === 'post'
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                    : 'bg-indigo-500/20 text-indigo-300'
                                }`}
                              >
                                {entry.entryType === 'post' ? '📝 Wall Post' : entry.entryType}
                              </span>
                            </div>

                            {entry.mediaUrl && (
                              <img
                                src={entry.mediaUrl}
                                alt={entry.title}
                                className="w-full max-h-72 object-cover rounded-xl mt-2"
                              />
                            )}

                            <h4 className="font-bold text-base pt-1">{entry.title}</h4>
                            <p className="text-sm text-slate-300 whitespace-pre-line">
                              {entry.commentary}
                            </p>
                            <p className="text-xs font-mono text-indigo-400 truncate">
                              Indexed Target: {entry.targetUrl}
                            </p>

                            <div className="flex flex-wrap gap-2 pt-1">
                              <button
                                onClick={() =>
                                  handleIncomingDeepLink({
                                    action: 'like',
                                    targetUrl: entry.canonicalUrl,
                                    title: entry.title,
                                    authorName: entry.friendName,
                                    authorUrl: entry.friendSiteUrl,
                                    mediaUrl: entry.mediaUrl,
                                  })
                                }
                                className="px-3 py-1.5 rounded-lg bg-pink-500/20 text-pink-300 hover:bg-pink-500/30 text-xs font-medium flex items-center gap-1"
                              >
                                <Heart className="w-3.5 h-3.5" /> Like
                              </button>
                              <button
                                onClick={() =>
                                  handleIncomingDeepLink({
                                    action: 'comment',
                                    targetUrl: entry.canonicalUrl,
                                    title: entry.title,
                                    authorName: entry.friendName,
                                    authorUrl: entry.friendSiteUrl,
                                  })
                                }
                                className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 text-xs font-medium flex items-center gap-1"
                              >
                                <MessageSquare className="w-3.5 h-3.5" /> Comment
                              </button>
                              <button
                                onClick={() =>
                                  handleIncomingDeepLink({
                                    action: 'share',
                                    targetUrl: entry.targetUrl,
                                    title: entry.title,
                                    authorName: entry.friendName,
                                    authorUrl: entry.friendSiteUrl,
                                    mediaUrl: entry.mediaUrl,
                                  })
                                }
                                className="px-3 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 text-xs font-medium flex items-center gap-1"
                              >
                                <Repeat2 className="w-3.5 h-3.5" /> Re-share
                              </button>
                            </div>
                          </div>

                          {/* Threaded Comments Under This Feed Post */}
                          {(peerComments.length > 0 || myComments.length > 0) && (
                            <div className="pt-3 border-t border-slate-800 space-y-2">
                              <p className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
                                <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
                                Threaded Ring Comments ({peerComments.length + myComments.length})
                              </p>
                              {peerComments.map((c) => (
                                <div
                                  key={c.id}
                                  className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1"
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="font-bold text-indigo-300">
                                      {c.friendName} ({c.friendSiteUrl})
                                    </span>
                                    <span className="text-[10px] text-slate-500">
                                      {new Date(c.createdAt).toLocaleDateString()}
                                    </span>
                                  </div>
                                  <p className="text-slate-200 whitespace-pre-line">
                                    {c.commentary}
                                  </p>
                                </div>
                              ))}
                              {myComments.map((c) => (
                                <div
                                  key={c.id}
                                  className="p-3 rounded-xl bg-emerald-950/20 border border-emerald-500/30 text-xs space-y-1"
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="font-bold text-emerald-300">
                                      {bundle.profile.displayName} (You)
                                    </span>
                                    <span className="text-[10px] text-slate-500">
                                      {new Date(c.createdAt).toLocaleDateString()}
                                    </span>
                                  </div>
                                  <p className="text-slate-200 whitespace-pre-line">
                                    {c.commentary}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}

          {/* TAB 6: LIVE SITE PREVIEW */}
          {activeTab === 'preview' && (
            <div className="space-y-4">
              {/* Top Preview Mode & Local Test Export Bar */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPreviewRenderMode('studio')}
                      className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
                        previewRenderMode === 'studio'
                          ? 'bg-indigo-600 text-white shadow'
                          : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                      }`}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Studio Interactive Preview
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!testExportResult) {
                          await handleRunTestExportPreview(false);
                        } else {
                          setPreviewRenderMode('exported-http');
                        }
                      }}
                      className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
                        previewRenderMode === 'exported-http'
                          ? 'bg-emerald-600 text-white shadow'
                          : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                      }`}
                    >
                      <Globe className="w-3.5 h-3.5" />
                      Test-Exported Static Build (Local HTTP Server)
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleRunTestExportPreview(false)}
                      className="px-3.5 py-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 font-semibold text-xs flex items-center gap-1.5 transition"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      {testExportResult ? 'Rebuild Local Test Export' : 'Run Local Test Export'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRunTestExportPreview(true)}
                      className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow transition"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Test Export & Open in Browser
                    </button>
                  </div>
                </div>

                {/* Test Export Pre-Publish Verification Report */}
                {testExportResult && (
                  <div className="p-3.5 rounded-xl bg-slate-950 border border-emerald-500/30 space-y-2.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold text-[11px]">
                          ✓ LOCAL TEST BUILD READY
                        </span>
                        <span className="text-slate-300">
                          Serving exported files on loopback HTTP server:
                        </span>
                        <button
                          type="button"
                          onClick={() => window.studioApi?.openExternal(testExportResult.previewUrl)}
                          className="font-mono text-indigo-400 hover:text-indigo-300 underline font-semibold flex items-center gap-1"
                        >
                          {testExportResult.previewUrl}
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            window.studioApi?.openExternal(
                              `${testExportResult.previewUrl}api/manifest.json`
                            )
                          }
                          className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 font-mono text-[11px] text-slate-300"
                        >
                          /api/manifest.json ↗
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            window.studioApi?.openExternal(
                              `${testExportResult.previewUrl}.well-known/did.json`
                            )
                          }
                          className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 font-mono text-[11px] text-slate-300"
                        >
                          /.well-known/did.json ↗
                        </button>
                        <button
                          type="button"
                          onClick={() => window.studioApi?.openPath(testExportResult.outputDir)}
                          className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200 font-medium flex items-center gap-1"
                        >
                          <FolderOutput className="w-3 h-3" />
                          Open Test Folder
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 pt-1 border-t border-slate-800/80">
                      <span className="text-emerald-400 font-medium">
                        {testExportResult.checks.hasIndexHtml ? '✓ index.html' : '✗ index.html'}
                      </span>
                      <span className="text-emerald-400 font-medium">
                        {testExportResult.checks.hasNoJekyll
                          ? '✓ .nojekyll (GitHub Pages ready)'
                          : '✗ .nojekyll'}
                      </span>
                      <span className="text-emerald-400 font-medium">
                        {testExportResult.checks.hasDidJson
                          ? '✓ did.json & /.well-known/did.json (Ed25519 Signed)'
                          : '✗ did.json'}
                      </span>
                      <span>
                        • Files Written: <strong>{testExportResult.filesWritten.length}</strong> (
                        {testExportResult.filesWritten
                          .map((f) => `${f.relativePath} (${(f.sizeBytes / 1024).toFixed(1)} KB)`)
                          .join(', ')}
                        )
                      </span>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 pt-1">
                  <span>
                    {previewRenderMode === 'exported-http' && testExportResult ? (
                      <>
                        <strong>Live Exported Site Preview:</strong> Rendering the actual exported{' '}
                        <code>index.html</code> and fetching <code>/api/*.json</code> over{' '}
                        <code>{testExportResult.previewUrl}</code> exactly as visitors will see it
                        after publishing.
                      </>
                    ) : (
                      <>
                        <strong>Interactive Preview:</strong> Clicking any <em>Like</em>,{' '}
                        <em>Share</em>, or <em>Add Friend</em> button below simulates a{' '}
                        <code>webring://</code> protocol action inside the Studio.
                      </>
                    )}
                  </span>
                  <span className="font-mono text-indigo-400">Theme: {bundle.profile.theme}</span>
                </div>
              </div>

              <div className="rounded-2xl overflow-hidden border border-slate-800 shadow-2xl bg-slate-950">
                {previewRenderMode === 'exported-http' && testExportResult ? (
                  <iframe
                    key={`${testExportResult.previewUrl}-${iframeRefreshKey}`}
                    src={testExportResult.previewUrl}
                    title="Exported Static Profile Site Preview"
                    className="w-full h-[75vh] border-0 bg-slate-950"
                  />
                ) : (
                  <ProfileSiteApp
                    bundleOverride={bundle}
                    onSimulateDeepLink={(uri) => {
                      const parsed = parseWebringUri(uri);
                      if (parsed) handleIncomingDeepLink(parsed);
                    }}
                  />
                )}
              </div>
            </div>
          )}

          {/* TAB 7: JSON SCHEMA INSPECTOR */}
          {activeTab === 'schemas' && (
            <div className="max-w-5xl mx-auto space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold">Standardized JSON Schema Output</h2>
                  <p className="text-sm text-slate-400 mt-1">
                    Inspect the live signed JSON documents that power your profile site and allow
                    other Webring Studio clients and ATProto bridges to index your content.
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      { id: 'manifest', label: '/api/manifest.json' },
                      { id: 'did', label: '/.well-known/did.json' },
                      { id: 'profile', label: '/api/profile.json' },
                      { id: 'albums', label: '/api/albums.json' },
                      { id: 'items', label: '/api/items.json' },
                      { id: 'connections', label: '/api/connections.json' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setSelectedSchemaFile(tab.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono transition ${
                        selectedSchemaFile === tab.id
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between text-xs font-mono text-slate-400">
                  <span>Signed with Ed25519Signature2020 ({bundle.profile.did}#key-1)</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(
                        JSON.stringify(getSelectedSchemaJson(), null, 2)
                      );
                      notify('Copied JSON document to clipboard!');
                    }}
                    className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300"
                  >
                    <Copy className="w-3.5 h-3.5" /> Copy JSON
                  </button>
                </div>
                <pre className="p-5 text-xs font-mono text-emerald-300 overflow-x-auto max-h-[65vh]">
                  {JSON.stringify(getSelectedSchemaJson(), null, 2)}
                </pre>
              </div>
            </div>
          )}

          {/* TAB 8: PUBLISH & SFTP */}
          {activeTab === 'publish' && (
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold">Publish Static Profile Website & JSON Feeds</h2>
                  <p className="text-sm text-slate-400 mt-1">
                    Export your self-contained profile website and signed JSON endpoints to a local
                    folder (for GitHub Pages, Neocities, Netlify, or any HTTP host) or upload directly
                    via built-in SFTP/FTP.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setHelpSection('github-pages');
                    setActiveTab('help');
                  }}
                  className="px-3.5 py-2 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 text-indigo-300 font-semibold text-xs flex items-center gap-1.5"
                >
                  <BookOpen className="w-4 h-4" />
                  Step-by-Step Deployment Guide
                </button>
              </div>

              {/* Pre-Publish Test Export & Local Browser Preview */}
              <div className="bg-indigo-950/25 border border-indigo-500/30 rounded-2xl p-6 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300">
                      Recommended Pre-Flight Step
                    </span>
                    <h3 className="font-bold text-lg flex items-center gap-2 pt-1">
                      <Compass className="w-5 h-5 text-indigo-400" />
                      Test Export Locally & Preview Before Publishing
                    </h3>
                    <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
                      Generates a clean staging build of your static website (<code>index.html</code>,{' '}
                      <code>.nojekyll</code>, <code>/.well-known/did.json</code>, and signed{' '}
                      <code>/api/*.json</code> endpoints) and serves it on a local loopback web server (
                      <code>127.0.0.1</code>) so you can inspect and test everything in your browser
                      before deploying to GitHub Pages or SFTP/FTP.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2.5 shrink-0">
                    <button
                      type="button"
                      onClick={async () => {
                        await handleRunTestExportPreview(false);
                        setActiveTab('preview');
                      }}
                      className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow flex items-center gap-1.5 transition"
                    >
                      <Compass className="w-4 h-4" />
                      Test Export & Preview in Studio
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRunTestExportPreview(true)}
                      className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-semibold text-xs flex items-center gap-1.5 transition"
                    >
                      <ExternalLink className="w-4 h-4 text-indigo-400" />
                      Test Export & Open in Browser
                    </button>
                  </div>
                </div>

                {testExportResult && (
                  <div className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-emerald-400 font-semibold">
                        ✓ Active Test Server:
                      </span>
                      <button
                        type="button"
                        onClick={() => window.studioApi?.openExternal(testExportResult.previewUrl)}
                        className="font-mono text-indigo-400 hover:underline font-semibold"
                      >
                        {testExportResult.previewUrl} ↗
                      </button>
                      <span className="text-slate-500">•</span>
                      <span className="text-slate-400">
                        {testExportResult.filesWritten.length} files generated •{' '}
                        {testExportResult.checks.publicFriendsExported} public friend(s) in{' '}
                        <code>connections.json</code>
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => window.studioApi?.openPath(testExportResult.outputDir)}
                      className="text-xs text-slate-300 hover:text-white underline flex items-center gap-1"
                    >
                      <FolderOutput className="w-3.5 h-3.5" />
                      Inspect Test Files on Disk
                    </button>
                  </div>
                )}
              </div>

              {/* Option 1: Local Directory Export */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
                <h3 className="font-bold text-lg flex items-center gap-2">
                  <FolderOutput className="w-5 h-5 text-emerald-400" />
                  1. Local Folder Export (Static HTML + JSON Bundle)
                </h3>
                <p className="text-xs text-slate-400">
                  Generates <code>index.html</code>, <code>/.well-known/did.json</code>,{' '}
                  <code>/api/manifest.json</code>, <code>/api/profile.json</code>,{' '}
                  <code>/api/albums.json</code>, <code>/api/items.json</code>,{' '}
                  <code>/api/connections.json</code>, and <code>/api/webring-hub.json</code>.
                </p>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={publishSettings.exportPath}
                    onChange={(e) =>
                      setPublishSettings((prev) => ({ ...prev, exportPath: e.target.value }))
                    }
                    placeholder="Default: AppData/webring-studio/exported-profile-site"
                    className="flex-1 px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleChooseExportFolder}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium"
                  >
                    Choose Folder...
                  </button>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleExportLocalSite}
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow flex items-center gap-2"
                  >
                    <FolderOutput className="w-4 h-4" />
                    Export Static Site Now
                  </button>
                  {publishSettings.exportPath && (
                    <button
                      type="button"
                      onClick={() => window.studioApi?.openPath(publishSettings.exportPath)}
                      className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium flex items-center gap-1.5"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Open Exported Folder
                    </button>
                  )}
                </div>
              </div>

              {/* Option 2: Built-in SFTP / FTP Uploader */}
              <form
                onSubmit={handlePublishRemote}
                className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-lg flex items-center gap-2">
                      <Server className="w-5 h-5 text-indigo-400" />
                      2. Direct SFTP / FTP Web Host Uploader
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Connection settings are stored in this persona’s isolated SQLite database so
                      each persona can publish to its own web host.
                    </p>
                  </div>
                  {(publishSettings.host || publishSettings.username || publishSettings.password) && (
                    <span className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-medium flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Stored for Persona: {personas.find((p) => p.id === activePersonaId)?.label || 'Primary'}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Protocol</label>
                    <select
                      value={publishSettings.protocol}
                      onChange={(e) =>
                        setPublishSettings((prev) => ({
                          ...prev,
                          protocol: e.target.value as 'sftp' | 'ftp',
                          port: e.target.value === 'sftp' ? 22 : 21,
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                    >
                      <option value="sftp">SFTP (SSH File Transfer)</option>
                      <option value="ftp">FTP (Standard)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Host / Server Address</label>
                    <input
                      type="text"
                      required
                      value={publishSettings.host}
                      onChange={(e) =>
                        setPublishSettings((prev) => ({ ...prev, host: e.target.value }))
                      }
                      placeholder="sftp.myhost.example.com"
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Port</label>
                    <input
                      type="number"
                      value={publishSettings.port}
                      onChange={(e) =>
                        setPublishSettings((prev) => ({ ...prev, port: Number(e.target.value) }))
                      }
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Username</label>
                    <input
                      type="text"
                      required
                      value={publishSettings.username}
                      onChange={(e) =>
                        setPublishSettings((prev) => ({ ...prev, username: e.target.value }))
                      }
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Password</label>
                    <input
                      type="password"
                      value={publishSettings.password || ''}
                      onChange={(e) =>
                        setPublishSettings((prev) => ({ ...prev, password: e.target.value }))
                      }
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Remote Web Root Path</label>
                    <input
                      type="text"
                      required
                      value={publishSettings.remotePath}
                      onChange={(e) =>
                        setPublishSettings((prev) => ({ ...prev, remotePath: e.target.value }))
                      }
                      placeholder="/var/www/html"
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      onClick={handleSaveRemoteSettings}
                      className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-semibold text-xs flex items-center gap-1.5 transition"
                    >
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      Save SFTP / FTP Settings
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow flex items-center gap-2 transition"
                    >
                      <UploadCloud className="w-4 h-4" />
                      Save & Upload to Remote Host
                    </button>
                  </div>

                  {(publishSettings.host ||
                    publishSettings.username ||
                    publishSettings.password ||
                    (publishSettings.remotePath &&
                      publishSettings.remotePath !== '/var/www/html')) && (
                    <button
                      type="button"
                      onClick={handleClearRemoteSettings}
                      className="px-3.5 py-2 rounded-xl bg-rose-950/40 hover:bg-rose-900/50 border border-rose-500/30 text-rose-300 font-semibold text-xs flex items-center gap-1.5 transition"
                      title="Delete the stored SFTP/FTP server credentials from this persona's SQLite database"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete Stored SFTP / FTP Info
                    </button>
                  )}
                </div>
              </form>

              {/* Option 3: GitHub Pages Deploy */}
              <form
                onSubmit={handlePublishGithub}
                className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-lg flex items-center gap-2">
                      <Globe className="w-5 h-5 text-slate-200" />
                      3. GitHub Pages Deploy
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Pushes the generated site straight to a repo branch via the GitHub API and
                      enables Pages for it. Needs a token with <code>repo</code> scope (classic) or
                      Contents + Pages read/write (fine-grained). Stored in this persona's SQLite
                      database, same as the SFTP/FTP credentials above.
                    </p>
                  </div>
                  {(publishSettings.githubOwner || publishSettings.githubRepo) && (
                    <span className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-medium flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Stored for Persona: {personas.find((p) => p.id === activePersonaId)?.label || 'Primary'}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Repo Owner (user or org)</label>
                    <input
                      type="text"
                      required
                      value={publishSettings.githubOwner || ''}
                      onChange={(e) =>
                        setPublishSettings((prev) => ({ ...prev, githubOwner: e.target.value }))
                      }
                      placeholder="octocat"
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Repository Name</label>
                    <input
                      type="text"
                      required
                      value={publishSettings.githubRepo || ''}
                      onChange={(e) =>
                        setPublishSettings((prev) => ({ ...prev, githubRepo: e.target.value }))
                      }
                      placeholder="octocat.github.io"
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Branch</label>
                    <input
                      type="text"
                      value={publishSettings.githubBranch || 'gh-pages'}
                      onChange={(e) =>
                        setPublishSettings((prev) => ({ ...prev, githubBranch: e.target.value }))
                      }
                      placeholder="gh-pages"
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Personal Access Token
                    </label>
                    <input
                      type="password"
                      required
                      value={publishSettings.githubToken || ''}
                      onChange={(e) =>
                        setPublishSettings((prev) => ({ ...prev, githubToken: e.target.value }))
                      }
                      placeholder="ghp_..."
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Custom Domain (optional — writes <code>CNAME</code>)
                    </label>
                    <input
                      type="text"
                      value={publishSettings.githubCustomDomain || ''}
                      onChange={(e) =>
                        setPublishSettings((prev) => ({ ...prev, githubCustomDomain: e.target.value }))
                      }
                      placeholder="yourdomain.com"
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono"
                    />
                  </div>
                </div>

                {githubCheckResult && (
                  <div
                    className={`p-3 rounded-xl text-xs border ${
                      githubCheckResult.success
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                        : 'bg-rose-500/10 border-rose-500/30 text-rose-200'
                    }`}
                  >
                    {githubCheckResult.message}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      onClick={handleCheckGithubRepo}
                      disabled={githubChecking}
                      className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-semibold text-xs flex items-center gap-1.5 transition disabled:opacity-50"
                    >
                      <RefreshCw className={`w-4 h-4 text-indigo-400 ${githubChecking ? 'animate-spin' : ''}`} />
                      {githubChecking ? 'Checking...' : 'Check Repo Access'}
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveGithubSettings}
                      className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-semibold text-xs flex items-center gap-1.5 transition"
                    >
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      Save GitHub Settings
                    </button>
                    <button
                      type="submit"
                      disabled={githubDeploying}
                      className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow flex items-center gap-2 transition disabled:opacity-50"
                    >
                      <UploadCloud className={`w-4 h-4 ${githubDeploying ? 'animate-pulse' : ''}`} />
                      {githubDeploying ? 'Deploying...' : 'Save & Deploy to GitHub Pages'}
                    </button>
                  </div>

                  {(publishSettings.githubOwner ||
                    publishSettings.githubRepo ||
                    publishSettings.githubToken) && (
                    <button
                      type="button"
                      onClick={handleClearGithubSettings}
                      className="px-3.5 py-2 rounded-xl bg-rose-950/40 hover:bg-rose-900/50 border border-rose-500/30 text-rose-300 font-semibold text-xs flex items-center gap-1.5 transition"
                      title="Delete the stored GitHub owner, repo, branch, token, and custom domain from this persona's SQLite database"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete Stored GitHub Info
                    </button>
                  )}
                </div>
              </form>

              {/* Option 4: Real-Time Static Site Comments (Optional Third-Party Provider) */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-lg flex items-center gap-2">
                      <MessageSquare className="w-5 h-5 text-purple-400" />
                      4. Real-Time Public Comment Threads (Optional — Giscus / Utterances)
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      In addition to zero-setup pull-federated ring comments, you can optionally
                      embed live real-time comment threads on every Wall Post on your static website
                      powered by GitHub Discussions (Giscus) or GitHub Issues (Utterances).
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Real-Time Comment Provider
                    </label>
                    <select
                      value={publishSettings.commentProvider || 'none'}
                      onChange={(e) =>
                        handleUpdatePrivacySetting({
                          commentProvider: e.target.value as 'none' | 'giscus' | 'utterances',
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                    >
                      <option value="none">
                        None (Use Native Pull-Federated Ring Comments Only)
                      </option>
                      <option value="giscus">
                        Giscus (GitHub Discussions — Free, Real-Time, Recommended)
                      </option>
                      <option value="utterances">
                        Utterances (GitHub Issues — Free, Lightweight)
                      </option>
                    </select>
                  </div>

                  {publishSettings.commentProvider &&
                    publishSettings.commentProvider !== 'none' && (
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">
                          Public GitHub Repository (<code>username/repo</code>)
                        </label>
                        <input
                          type="text"
                          value={publishSettings.giscusRepo || ''}
                          onChange={(e) =>
                            setPublishSettings((prev) => ({ ...prev, giscusRepo: e.target.value }))
                          }
                          onBlur={() =>
                            handleUpdatePrivacySetting({ giscusRepo: publishSettings.giscusRepo })
                          }
                          placeholder="e.g., alexrivera/alexrivera.github.io"
                          className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono"
                        />
                      </div>
                    )}
                </div>

                {publishSettings.commentProvider === 'giscus' && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        Giscus Repo ID (Optional, from giscus.app)
                      </label>
                      <input
                        type="text"
                        value={publishSettings.giscusRepoId || ''}
                        onChange={(e) =>
                          setPublishSettings((prev) => ({ ...prev, giscusRepoId: e.target.value }))
                        }
                        onBlur={() =>
                          handleUpdatePrivacySetting({ giscusRepoId: publishSettings.giscusRepoId })
                        }
                        placeholder="R_kgDO..."
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        Discussions Category Name
                      </label>
                      <input
                        type="text"
                        value={publishSettings.giscusCategory || 'General'}
                        onChange={(e) =>
                          setPublishSettings((prev) => ({
                            ...prev,
                            giscusCategory: e.target.value,
                          }))
                        }
                        onBlur={() =>
                          handleUpdatePrivacySetting({
                            giscusCategory: publishSettings.giscusCategory,
                          })
                        }
                        placeholder="General"
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        Giscus Category ID (Optional)
                      </label>
                      <input
                        type="text"
                        value={publishSettings.giscusCategoryId || ''}
                        onChange={(e) =>
                          setPublishSettings((prev) => ({
                            ...prev,
                            giscusCategoryId: e.target.value,
                          }))
                        }
                        onBlur={() =>
                          handleUpdatePrivacySetting({
                            giscusCategoryId: publishSettings.giscusCategoryId,
                          })
                        }
                        placeholder="DIC_kwDO..."
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Option 5: Optional Add-On 1 — Google Analytics (GA4) */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300">
                        Optional Add-On 1
                      </span>
                      {bundle.profile.analyticsAddon?.enabled && (
                        <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono">
                          ✓ Active: {bundle.profile.analyticsAddon.measurementId}
                        </span>
                      )}
                    </div>
                    <h3 className="font-bold text-lg mt-1">
                      5. Google Analytics (GA4) Profile Add-On
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Optionally inject Google Analytics 4 (<code>gtag.js</code>) into your exported{' '}
                      <code>index.html</code> and dynamically whitelist Google Analytics in the
                      Content-Security-Policy header.
                    </p>
                  </div>

                  <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={Boolean(publishSettings.analyticsEnabled)}
                      onChange={(e) =>
                        handleUpdatePrivacySetting({ analyticsEnabled: e.target.checked })
                      }
                      className="accent-indigo-500"
                    />
                    <span>Enable Google Analytics Add-On</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      GA4 Measurement ID (Format: <code>G-XXXXXXXXXX</code>)
                    </label>
                    <input
                      type="text"
                      value={publishSettings.analyticsMeasurementId || ''}
                      onChange={(e) =>
                        setPublishSettings((prev) => ({
                          ...prev,
                          analyticsMeasurementId: e.target.value.toUpperCase(),
                        }))
                      }
                      placeholder="G-1A2B3C4D5E"
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono"
                    />
                  </div>
                  <div className="flex flex-col justify-center gap-1.5 text-xs pt-2">
                    <label className="inline-flex items-center gap-2 cursor-pointer text-slate-300">
                      <input
                        type="checkbox"
                        checked={publishSettings.analyticsRespectDnt !== false}
                        onChange={(e) =>
                          setPublishSettings((prev) => ({
                            ...prev,
                            analyticsRespectDnt: e.target.checked,
                          }))
                        }
                        className="accent-indigo-500"
                      />
                      <span>Respect Visitor Browser Do-Not-Track (DNT)</span>
                    </label>
                    <label className="inline-flex items-center gap-2 cursor-pointer text-slate-300">
                      <input
                        type="checkbox"
                        checked={publishSettings.analyticsAnonymizeIp !== false}
                        onChange={(e) =>
                          setPublishSettings((prev) => ({
                            ...prev,
                            analyticsAnonymizeIp: e.target.checked,
                          }))
                        }
                        className="accent-indigo-500"
                      />
                      <span>Anonymize Visitor IP Addresses (<code>anonymize_ip: true</code>)</span>
                    </label>
                    <label className="inline-flex items-center gap-2 cursor-pointer text-slate-300">
                      <input
                        type="checkbox"
                        checked={publishSettings.analyticsTrackRingInteractions !== false}
                        onChange={(e) =>
                          setPublishSettings((prev) => ({
                            ...prev,
                            analyticsTrackRingInteractions: e.target.checked,
                          }))
                        }
                        className="accent-indigo-500"
                      />
                      <span>
                        Track Webring Like / Share / Comment Clicks (<code>webring_interact</code>)
                      </span>
                    </label>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
                  <button
                    type="button"
                    onClick={handleSaveRemoteSettings}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow transition"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Save Analytics Add-On Settings
                  </button>
                  {(publishSettings.analyticsMeasurementId || publishSettings.analyticsEnabled) && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (
                          !window.confirm(
                            'Delete the stored Google Analytics Measurement ID and disable the Analytics add-on for this persona?'
                          )
                        ) {
                          return;
                        }
                        await handleUpdatePrivacySetting({
                          analyticsEnabled: false,
                          analyticsMeasurementId: '',
                          analyticsRespectDnt: true,
                          analyticsAnonymizeIp: true,
                          analyticsTrackRingInteractions: true,
                        });
                      }}
                      className="px-3.5 py-2 rounded-xl bg-rose-950/40 hover:bg-rose-900/50 border border-rose-500/30 text-rose-300 font-semibold text-xs flex items-center gap-1.5 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete Stored Analytics Info
                    </button>
                  )}
                </div>
              </div>

              {/* Option 6: Optional Add-On 2 — Google AdSense / Ads Monetization */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                        Optional Add-On 2
                      </span>
                      {bundle.profile.adsAddon?.enabled && (
                        <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono">
                          ✓ Active: {bundle.profile.adsAddon.publisherId} (+ /ads.txt)
                        </span>
                      )}
                    </div>
                    <h3 className="font-bold text-lg mt-1">
                      6. Google AdSense / Ads Monetization Add-On
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Offset your hosting costs by enabling Google AdSense on your static profile
                      site. Automatically generates <code>/ads.txt</code> in your exported site root
                      and renders responsive ad slots.
                    </p>
                  </div>

                  <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={Boolean(publishSettings.adsEnabled)}
                      onChange={(e) =>
                        handleUpdatePrivacySetting({ adsEnabled: e.target.checked })
                      }
                      className="accent-emerald-500"
                    />
                    <span>Enable Google AdSense Add-On</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      AdSense Publisher ID (Format: <code>ca-pub-1234567890123456</code>)
                    </label>
                    <input
                      type="text"
                      value={publishSettings.adsPublisherId || ''}
                      onChange={(e) =>
                        setPublishSettings((prev) => ({
                          ...prev,
                          adsPublisherId: e.target.value,
                        }))
                      }
                      placeholder="ca-pub-1234567890123456"
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono"
                    />
                  </div>
                  <div className="flex flex-col justify-center gap-1.5 text-xs pt-2">
                    <label className="inline-flex items-center gap-2 cursor-pointer text-slate-300">
                      <input
                        type="checkbox"
                        checked={publishSettings.adsEnableAutoAds !== false}
                        onChange={(e) =>
                          setPublishSettings((prev) => ({
                            ...prev,
                            adsEnableAutoAds: e.target.checked,
                          }))
                        }
                        className="accent-emerald-500"
                      />
                      <span>Enable Google Auto Ads Script in Page Head</span>
                    </label>
                    <label className="inline-flex items-center gap-2 cursor-pointer text-slate-300">
                      <input
                        type="checkbox"
                        checked={publishSettings.adsGenerateAdsTxt !== false}
                        onChange={(e) =>
                          setPublishSettings((prev) => ({
                            ...prev,
                            adsGenerateAdsTxt: e.target.checked,
                          }))
                        }
                        className="accent-emerald-500"
                      />
                      <span>
                        Generate Root <code>/ads.txt</code> File Automatically (IAB Authorized
                        Digital Sellers)
                      </span>
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Profile Banner Ad Slot ID (Optional)
                    </label>
                    <input
                      type="text"
                      value={publishSettings.adsHeaderSlotId || ''}
                      onChange={(e) =>
                        setPublishSettings((prev) => ({
                          ...prev,
                          adsHeaderSlotId: e.target.value,
                        }))
                      }
                      placeholder="e.g., 1234567890"
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      In-Feed Ad Slot ID (Between Albums & Posts)
                    </label>
                    <input
                      type="text"
                      value={publishSettings.adsInFeedSlotId || ''}
                      onChange={(e) =>
                        setPublishSettings((prev) => ({
                          ...prev,
                          adsInFeedSlotId: e.target.value,
                        }))
                      }
                      placeholder="e.g., 2345678901"
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Footer Ad Slot ID (Optional)
                    </label>
                    <input
                      type="text"
                      value={publishSettings.adsFooterSlotId || ''}
                      onChange={(e) =>
                        setPublishSettings((prev) => ({
                          ...prev,
                          adsFooterSlotId: e.target.value,
                        }))
                      }
                      placeholder="e.g., 3456789012"
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
                  <button
                    type="button"
                    onClick={handleSaveRemoteSettings}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow transition"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Save AdSense Add-On Settings
                  </button>
                  {(publishSettings.adsPublisherId ||
                    publishSettings.adsEnabled ||
                    publishSettings.adsHeaderSlotId ||
                    publishSettings.adsInFeedSlotId ||
                    publishSettings.adsFooterSlotId) && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (
                          !window.confirm(
                            'Delete the stored Google AdSense Publisher ID, ad slot IDs, and disable the AdSense add-on for this persona?'
                          )
                        ) {
                          return;
                        }
                        await handleUpdatePrivacySetting({
                          adsEnabled: false,
                          adsPublisherId: '',
                          adsEnableAutoAds: true,
                          adsGenerateAdsTxt: true,
                          adsHeaderSlotId: '',
                          adsInFeedSlotId: '',
                          adsFooterSlotId: '',
                        });
                      }}
                      className="px-3.5 py-2 rounded-xl bg-rose-950/40 hover:bg-rose-900/50 border border-rose-500/30 text-rose-300 font-semibold text-xs flex items-center gap-1.5 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete Stored AdSense Info
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 9: AI AGENT & MODEL CONTEXT PROTOCOL (MCP) HUB */}
          {activeTab === 'mcp' && (
            <div className="max-w-5xl mx-auto space-y-6 pb-12">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold flex items-center gap-2.5">
                    <Sparkles className="w-6 h-6 text-indigo-400" />
                    AI Agent & MCP Automation Hub
                  </h2>
                  <p className="text-sm text-slate-400 mt-1">
                    Connect any Model Context Protocol (MCP) agent (Google Antigravity, Claude
                    Desktop, Cursor, Windsurf, or scheduled scripts) to manage your personas,
                    publish wall posts, crawl your friend ring, and deploy your static sites.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-mono font-semibold flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    {mcpInfo?.status.running
                      ? `Live HTTP MCP: ${mcpInfo.status.endpointUrl}`
                      : 'STDIO & HTTP MCP Ready'}
                  </span>
                </div>
              </div>

              {/* Dual Transport Configuration Cards */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* STDIO Config Card */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300">
                        Option 1 • Standalone STDIO Transport
                      </span>
                      <h3 className="font-bold text-base mt-1">
                        Antigravity / Claude Desktop / Cursor Config
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const snippet = JSON.stringify(
                          {
                            mcpServers: {
                              'webring-studio': {
                                command: 'node',
                                args: [
                                  mcpInfo?.cliScriptPath ||
                                    'dist-electron/electron/mcp/cli.js',
                                  '--data-dir',
                                  mcpInfo?.userDataDir || './user-data',
                                ],
                              },
                            },
                          },
                          null,
                          2
                        );
                        navigator.clipboard.writeText(snippet);
                        notify('Copied STDIO mcpServers JSON configuration to clipboard!');
                      }}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5"
                    >
                      <Copy className="w-3.5 h-3.5" /> Copy JSON
                    </button>
                  </div>
                  <p className="text-xs text-slate-400">
                    Spawns the headless Webring Studio MCP server over <code>stdin/stdout</code>.
                    Works even when the Webring Studio desktop window is closed!
                  </p>
                  <pre className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono text-emerald-300 overflow-x-auto">
                    {JSON.stringify(
                      {
                        mcpServers: {
                          'webring-studio': {
                            command: 'node',
                            args: [
                              mcpInfo?.cliScriptPath ||
                                'dist-electron/electron/mcp/cli.js',
                              '--data-dir',
                              mcpInfo?.userDataDir || '<your-userData-path>',
                            ],
                          },
                        },
                      },
                      null,
                      2
                    )}
                  </pre>
                </div>

                {/* Live Loopback HTTP Config Card */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                        Option 2 • Live Studio Loopback HTTP / SSE
                      </span>
                      <h3 className="font-bold text-base mt-1">
                        Live Connected Studio Endpoint
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const snippet = JSON.stringify(
                          {
                            mcpServers: {
                              'webring-studio-live': {
                                url:
                                  mcpInfo?.status.endpointUrl ||
                                  'http://127.0.0.1:<port>/mcp',
                              },
                            },
                          },
                          null,
                          2
                        );
                        navigator.clipboard.writeText(snippet);
                        notify('Copied Live HTTP MCP configuration to clipboard!');
                      }}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5"
                    >
                      <Copy className="w-3.5 h-3.5" /> Copy URL Config
                    </button>
                  </div>
                  <p className="text-xs text-slate-400">
                    Connects directly to this running Studio window on <code>127.0.0.1</code>. Any
                    posts, comments, persona switches, or crawls performed by your agent update this
                    UI in real time!
                  </p>
                  <pre className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono text-indigo-300 overflow-x-auto">
                    {JSON.stringify(
                      {
                        mcpServers: {
                          'webring-studio-live': {
                            url:
                              mcpInfo?.status.endpointUrl ||
                              'http://127.0.0.1:<port>/mcp',
                            sseUrl:
                              mcpInfo?.status.sseUrl ||
                              'http://127.0.0.1:<port>/mcp/sse',
                          },
                        },
                      },
                      null,
                      2
                    )}
                  </pre>
                </div>
              </div>

              {/* Interactive MCP Tool Tester & One-Click Automation Runner */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-lg">
                      Interactive MCP Tool Console ({mcpInfo?.tools.length || 21} Tools Available)
                    </h3>
                    <p className="text-xs text-slate-400">
                      Test any MCP tool directly against your active persona or trigger a 1-click
                      agent workflow below.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await window.studioApi?.callMcpTool?.(
                          'webring_create_post',
                          {
                            commentary:
                              'Automated Wall Update published via the Webring Studio MCP Server! 🤖✨',
                            tags: ['mcp', 'automation', 'indieweb'],
                          }
                        );
                        setMcpToolOutput(res?.content?.[0]?.text || '');
                        await refreshStudioData();
                        const info = await window.studioApi?.getMcpInfo?.();
                        if (info) setMcpInfo(info);
                        notify('Executed webring_create_post via MCP!');
                      }}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600/25 hover:bg-indigo-600/40 border border-indigo-500/40 text-indigo-200 text-xs font-semibold"
                    >
                      ⚡ Quick Test: Post to Wall via MCP
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await window.studioApi?.callMcpTool?.(
                          'webring_crawl_all_friends',
                          {}
                        );
                        setMcpToolOutput(res?.content?.[0]?.text || '');
                        await refreshStudioData();
                        const info = await window.studioApi?.getMcpInfo?.();
                        if (info) setMcpInfo(info);
                        notify('Executed webring_crawl_all_friends via MCP!');
                      }}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600/25 hover:bg-emerald-600/40 border border-emerald-500/40 text-emerald-200 text-xs font-semibold"
                    >
                      ⚡ Quick Test: Crawl Ring via MCP
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                  <div className="lg:col-span-5 space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Select MCP Tool
                      </label>
                      <select
                        value={selectedMcpTool}
                        onChange={(e) => {
                          const toolName = e.target.value;
                          setSelectedMcpTool(toolName);
                          if (toolName === 'webring_create_post') {
                            setMcpToolArgsJson(
                              JSON.stringify(
                                {
                                  commentary: 'Sharing a new update from my MCP agent!',
                                  tags: ['webring', 'agent'],
                                },
                                null,
                                2
                              )
                            );
                          } else if (toolName === 'webring_interact_with_url') {
                            setMcpToolArgsJson(
                              JSON.stringify(
                                {
                                  type: 'comment',
                                  targetUrl: 'https://maya.indiering.social/api/items.json#item-1',
                                  commentary: 'Awesome synth session!',
                                },
                                null,
                                2
                              )
                            );
                          } else if (toolName === 'webring_configure_analytics_addon') {
                            setMcpToolArgsJson(
                              JSON.stringify(
                                {
                                  enabled: true,
                                  measurementId: 'G-1A2B3C4D5E',
                                  respectDoNotTrack: true,
                                  anonymizeIp: true,
                                  trackRingInteractions: true,
                                },
                                null,
                                2
                              )
                            );
                          } else if (toolName === 'webring_configure_ads_addon') {
                            setMcpToolArgsJson(
                              JSON.stringify(
                                {
                                  enabled: true,
                                  publisherId: 'ca-pub-1234567890123456',
                                  enableAutoAds: true,
                                  generateAdsTxt: true,
                                  headerSlotId: '1122334455',
                                  inFeedSlotId: '5566778899',
                                },
                                null,
                                2
                              )
                            );
                          } else {
                            setMcpToolArgsJson('{}');
                          }
                        }}
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-white"
                      >
                        {(mcpInfo?.tools || []).map((t) => (
                          <option key={t.name} value={t.name}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-slate-400 mt-1.5">
                        {
                          mcpInfo?.tools.find((t) => t.name === selectedMcpTool)
                            ?.description
                        }
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        JSON Arguments (<code>params.arguments</code>)
                      </label>
                      <textarea
                        rows={5}
                        value={mcpToolArgsJson}
                        onChange={(e) => setMcpToolArgsJson(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const parsedArgs = JSON.parse(mcpToolArgsJson || '{}');
                          const res = await window.studioApi?.callMcpTool?.(
                            selectedMcpTool,
                            parsedArgs
                          );
                          setMcpToolOutput(res?.content?.[0]?.text || JSON.stringify(res, null, 2));
                          await refreshStudioData();
                          const info = await window.studioApi?.getMcpInfo?.();
                          if (info) setMcpInfo(info);
                          notify(`Executed MCP tool: ${selectedMcpTool}`);
                        } catch (err: unknown) {
                          setMcpToolOutput(
                            `Invalid JSON arguments: ${
                              err instanceof Error ? err.message : String(err)
                            }`
                          );
                        }
                      }}
                      className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow transition"
                    >
                      Run MCP Tool ({selectedMcpTool})
                    </button>
                  </div>

                  <div className="lg:col-span-7 flex flex-col">
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      MCP Tool JSON-RPC Result
                    </label>
                    <pre className="flex-1 min-h-[220px] max-h-[340px] p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-emerald-300 overflow-auto">
                      {mcpToolOutput ||
                        '// Click "Run MCP Tool" or a Quick Test button to inspect the JSON-RPC response...'}
                    </pre>
                  </div>
                </div>
              </div>

              {/* Example Natural-Language Prompts & Live Agent Activity Log */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
                  <h3 className="font-bold text-base">
                    Example Prompts You Can Give Your AI Agent
                  </h3>
                  <div className="space-y-2.5 text-xs">
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                      <span className="text-[10px] font-bold uppercase text-indigo-400">
                        Daily Ring Sync & Commenting
                      </span>
                      <p className="text-slate-200 italic">
                        "Crawl all my friends in Webring Studio, summarize any new wall posts or
                        photos in my Neighborhood Feed, and post a friendly comment on Maya's latest
                        synth post."
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                      <span className="text-[10px] font-bold uppercase text-emerald-400">
                        Multi-Persona Publishing
                      </span>
                      <p className="text-slate-200 italic">
                        "Switch to my Music Alias persona, create a new wall post about my latest
                        tape loop study with tags #modular and #ambient, and export the signed
                        static website."
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                      <span className="text-[10px] font-bold uppercase text-amber-400">
                        OPSEC & Privacy Audit
                      </span>
                      <p className="text-slate-200 italic">
                        "Run the opsec-privacy-audit prompt on my Webring Studio personas and verify
                        that all my friends are set to private crawler-only visibility."
                      </p>
                    </div>
                  </div>
                </div>

                {/* Live Agent Activity Log */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-base">Live MCP Agent Activity Log</h3>
                    <span className="text-xs text-slate-400">
                      {mcpInfo?.activityLog.length || 0} event(s)
                    </span>
                  </div>
                  {!mcpInfo?.activityLog || mcpInfo.activityLog.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl">
                      No MCP agent calls recorded in this session yet. Use the Tool Console above or
                      connect an external MCP agent!
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                      {mcpInfo.activityLog.map((entry) => (
                        <div
                          key={entry.id}
                          className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className={`w-2 h-2 rounded-full ${
                                  entry.success ? 'bg-emerald-400' : 'bg-rose-400'
                                }`}
                              />
                              <span className="font-mono font-bold text-indigo-300">
                                {entry.toolName || entry.method}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                                {entry.personaId}
                              </span>
                            </div>
                            <p className="text-slate-300 truncate mt-0.5">{entry.summary}</p>
                          </div>
                          <span className="text-[10px] text-slate-500 font-mono shrink-0">
                            {new Date(entry.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 10: HELP & DEPLOYMENT GUIDE */}
          {activeTab === 'help' && (
            <div className="max-w-5xl mx-auto space-y-6 pb-12">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold flex items-center gap-2.5">
                    <BookOpen className="w-6 h-6 text-indigo-400" />
                    Webring Studio — Help, Features & Step-by-Step Guide
                  </h2>
                  <p className="text-sm text-slate-400 mt-1">
                    Complete documentation for compartmentalized personas, wall posts & threaded
                    comments, local test exports, <strong>GitHub Pages</strong> &{' '}
                    <strong>SFTP / FTP</strong> deployment, <strong>Google Analytics / AdSense</strong>{' '}
                    add-ons, and <strong>AI Agent (MCP)</strong> automation.
                  </p>
                </div>

                {/* Section Switcher Pills */}
                <div className="flex flex-wrap gap-1.5 bg-slate-900 p-1.5 rounded-xl border border-slate-800">
                  {(
                    [
                      { id: 'quickstart', label: '1. Quickstart & Personas' },
                      { id: 'github-pages', label: '2. GitHub Pages Guide' },
                      { id: 'ftp-sftp', label: '3. FTP / SFTP Host Guide' },
                      { id: 'addons', label: '4. Analytics & AdSense Add-Ons' },
                      { id: 'mcp-agents', label: '5. AI Agent (MCP) Guide' },
                      { id: 'privacy-faq', label: '6. Security & Privacy FAQ' },
                    ] as const
                  ).map((sec) => (
                    <button
                      key={sec.id}
                      onClick={() => setHelpSection(sec.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                        helpSection === sec.id
                          ? 'bg-indigo-600 text-white shadow'
                          : 'text-slate-400 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      {sec.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick Navigation Banner */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
                <div className="space-y-1">
                  <div className="text-slate-400">
                    Example Canonical Root URL:{' '}
                    <code className="text-indigo-300 font-bold">https://example.com</code> or{' '}
                    <code className="text-indigo-300 font-bold">https://yourname.github.io</code>
                  </div>
                  <div className="text-slate-400">
                    Example W3C / ATProto Identity:{' '}
                    <code className="text-emerald-400 font-bold">did:web:example.com</code>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setShowPersonaModal(true)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium"
                  >
                    Manage Personas →
                  </button>
                  <button
                    onClick={() => setActiveTab('profile')}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium"
                  >
                    Edit Profile URL →
                  </button>
                  <button
                    onClick={() => setActiveTab('publish')}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                  >
                    Go to Publish Tab →
                  </button>
                </div>
              </div>

              {/* SECTION 1: QUICKSTART, MULTI-PERSONA, WALL POSTS & LOCAL TEST PREVIEW */}
              {helpSection === 'quickstart' && (
                <div className="space-y-6">
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5">
                    <h3 className="text-lg font-bold text-white">
                      How Webring Studio Works (Zero-Backend Architecture)
                    </h3>
                    <p className="text-sm text-slate-300 leading-relaxed">
                      Unlike centralized social networks, Webring Studio stores your data locally in a{' '}
                      <strong>SQLite database</strong> on your computer and compiles a{' '}
                      <strong>100% static website</strong> (HTML + cryptographically signed JSON
                      files). You can host those files anywhere for free—no database server, PHP, or
                      Node.js backend required on your web host.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
                      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                        <div className="text-xs font-bold uppercase tracking-wider text-indigo-400">
                          Step 1 • Identity & Personas
                        </div>
                        <h4 className="font-bold text-sm">Configure Canonical URL & Personas</h4>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          In <strong>Profile & Identity</strong>, enter the final web address where
                          your site will live (e.g., <code>https://yourname.github.io</code>). Need
                          separate identities (personal, music alias, professional)? Use the{' '}
                          <strong>Persona Switcher</strong> in the top-left sidebar to create strictly
                          compartmentalized personas with separate SQLite databases and Ed25519 keys.
                        </p>
                        <div className="flex gap-3 pt-1">
                          <button
                            onClick={() => setActiveTab('profile')}
                            className="text-xs text-indigo-400 hover:underline font-medium"
                          >
                            Open Profile →
                          </button>
                          <button
                            onClick={() => setShowPersonaModal(true)}
                            className="text-xs text-indigo-400 hover:underline font-medium"
                          >
                            Manage Personas →
                          </button>
                        </div>
                      </div>

                      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                        <div className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                          Step 2 • Wall Posts, Comments & Photos
                        </div>
                        <h4 className="font-bold text-sm">Publish Posts, Replies & Galleries</h4>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          Post native status updates (<code>post</code>), threaded replies to friends
                          (<code>comment</code>), likes, and recommendations in{' '}
                          <strong>Wall, Likes & Comments</strong>, or import local photos in{' '}
                          <strong>Photo Albums</strong>. Every post and photo receives a permanent
                          canonical URI so peers in your ring can reply or like it.
                        </p>
                        <div className="flex gap-3 pt-1">
                          <button
                            onClick={() => setActiveTab('items')}
                            className="text-xs text-emerald-400 hover:underline font-medium"
                          >
                            Open Wall & Comments →
                          </button>
                          <button
                            onClick={() => setActiveTab('albums')}
                            className="text-xs text-emerald-400 hover:underline font-medium"
                          >
                            Open Photo Albums →
                          </button>
                        </div>
                      </div>

                      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                        <div className="text-xs font-bold uppercase tracking-wider text-amber-400">
                          Step 3 • Friends & Neighborhood Feed
                        </div>
                        <h4 className="font-bold text-sm">Build Your Ring & Reply to Friends</h4>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          Add friends' profile URLs in <strong>Friends & Webrings</strong>. Friends
                          default to <strong>🔒 Private (Local Crawler Only)</strong> so your Studio
                          pulls their posts into your <strong>Neighborhood Feed</strong> without
                          exposing your social graph publicly. Click <strong>💬 Reply</strong> on any
                          feed item to publish a signed threaded comment!
                        </p>
                        <div className="flex gap-3 pt-1">
                          <button
                            onClick={() => setActiveTab('friends')}
                            className="text-xs text-amber-400 hover:underline font-medium"
                          >
                            Friends & Rings →
                          </button>
                          <button
                            onClick={() => setActiveTab('feed')}
                            className="text-xs text-amber-400 hover:underline font-medium"
                          >
                            Neighborhood Feed →
                          </button>
                        </div>
                      </div>

                      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                        <div className="text-xs font-bold uppercase tracking-wider text-cyan-400">
                          Step 4 • Local Test Export Preview
                        </div>
                        <h4 className="font-bold text-sm">Test Export on Localhost Before Live</h4>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          In <strong>Live Site Preview</strong> or <strong>Publish & SFTP</strong>,
                          click <strong>Run Local Test Export & Preview</strong>. Webring Studio writes
                          your complete static bundle to a local sandbox folder, runs pre-flight
                          verification checks, and serves it over a real local HTTP server (
                          <code>http://127.0.0.1:&lt;port&gt;</code>).
                        </p>
                        <button
                          onClick={() => setActiveTab('preview')}
                          className="text-xs text-cyan-400 hover:underline font-medium pt-1 inline-block"
                        >
                          Open Live Site Preview →
                        </button>
                      </div>

                      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                        <div className="text-xs font-bold uppercase tracking-wider text-purple-400">
                          Step 5 • Optional Profile Add-Ons
                        </div>
                        <h4 className="font-bold text-sm">GA4 Analytics, AdSense & Guestbook</h4>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          Optionally enable <strong>Google Analytics (GA4)</strong>,{' '}
                          <strong>Google AdSense</strong> (with automatic root <code>/ads.txt</code>{' '}
                          generation to offset hosting costs), or a <strong>Giscus / Utterances</strong>{' '}
                          GitHub guestbook widget in the <strong>Publish & SFTP</strong> tab.
                        </p>
                        <button
                          onClick={() => setHelpSection('addons')}
                          className="text-xs text-purple-400 hover:underline font-medium pt-1 inline-block"
                        >
                          Read Add-Ons Guide →
                        </button>
                      </div>

                      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                        <div className="text-xs font-bold uppercase tracking-wider text-pink-400">
                          Step 6 • Deploy or Automate via MCP
                        </div>
                        <h4 className="font-bold text-sm">Publish to Host or Connect AI Agent</h4>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          Deploy your static files to <strong>GitHub Pages</strong> or via{' '}
                          <strong>SFTP / FTP</strong> (with saved per-persona credentials), or connect
                          an AI agent via the <strong>AI Agent (MCP)</strong> tab to automate posting,
                          ring crawling, and publishing via natural language prompts.
                        </p>
                        <div className="flex gap-3 pt-1">
                          <button
                            onClick={() => setHelpSection('github-pages')}
                            className="text-xs text-pink-400 hover:underline font-medium"
                          >
                            GitHub Pages →
                          </button>
                          <button
                            onClick={() => setHelpSection('mcp-agents')}
                            className="text-xs text-pink-400 hover:underline font-medium"
                          >
                            MCP Agent Guide →
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Generated Directory Structure Card */}
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-3">
                    <h3 className="font-bold text-base">
                      What Files Does Webring Studio Generate?
                    </h3>
                    <p className="text-xs text-slate-400">
                      Every export creates a self-contained folder with the following structure:
                    </p>
                    <pre className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed">
{`exported-profile-site/
├── index.html               # Standalone interactive profile site (hardened CSP + embedded bundle)
├── .nojekyll                # Tells GitHub Pages NOT to ignore the .well-known folder
├── ads.txt                  # (Optional) IAB Authorized Digital Sellers file when AdSense is enabled
├── .well-known/
│   └── did.json             # W3C / ATProto did:web identity & Ed25519 public key
├── api/
│   ├── manifest.json        # Signed discovery entrypoint for RingCrawler peers
│   ├── profile.json         # Signed bio, avatar, links, theme, handle & add-on metadata
│   ├── albums.json          # Signed photo galleries with canonical item URIs
│   ├── items.json           # Signed wall posts, threaded comments, likes & recommendations
│   ├── connections.json     # Signed webring bars, opt-in public friends & incoming peer replies
│   └── webring-hub.json     # (Optional) Community ring directory if enabled
└── media/
    └── albums/              # Local imported photos copied automatically`}
                    </pre>
                  </div>
                </div>
              )}

              {/* SECTION 2: GITHUB PAGES STEP-BY-STEP GUIDE */}
              {helpSection === 'github-pages' && (
                <div className="space-y-6">
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5">
                    <div className="border-b border-slate-800 pb-4">
                      <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300">
                        Free Static Hosting
                      </span>
                      <h3 className="text-xl font-bold mt-2">
                        Deploying Your Profile to GitHub Pages (Step-by-Step)
                      </h3>
                      <p className="text-xs text-slate-400 mt-1">
                        GitHub Pages hosts static HTML & JSON files for free over HTTPS with full
                        support for <code>/.well-known/did.json</code> and optional GitHub Discussions
                        guestbooks (Giscus).
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-xs text-indigo-200 flex items-start gap-2.5">
                      <UploadCloud className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>
                        <strong>Skip the terminal:</strong> Webring Studio can push and deploy for you
                        directly from the app. Go to the <strong>Publish & SFTP</strong> tab → <em>3.
                        GitHub Pages Deploy</em>, add a repo + access token, and click{' '}
                        <strong>Save & Deploy to GitHub Pages</strong>. The steps below are what it does
                        under the hood, and are here for anyone who prefers plain <code>git</code>.
                      </span>
                    </div>

                    {/* Step 1 */}
                    <div className="space-y-2">
                      <h4 className="font-bold text-sm text-indigo-300">
                        Step 1: Set Your GitHub Pages URL in "Profile & Identity"
                      </h4>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        Before exporting, make sure your <strong>Hosted Website URL</strong> matches
                        your GitHub Pages address so your cryptographic signatures and{' '}
                        <code>did:web</code> identity match your live domain:
                      </p>
                      <ul className="text-xs text-slate-400 list-disc list-inside space-y-1 pl-2">
                        <li>
                          <strong>User Site (Recommended):</strong>{' '}
                          <code>https://&lt;your-github-username&gt;.github.io</code> → produces{' '}
                          <code>did:web:&lt;your-github-username&gt;.github.io</code>
                        </li>
                        <li>
                          <strong>Project Repository Site:</strong>{' '}
                          <code>https://&lt;your-github-username&gt;.github.io/&lt;repo-name&gt;</code>{' '}
                          → produces{' '}
                          <code>did:web:&lt;your-github-username&gt;.github.io:&lt;repo-name&gt;</code>
                        </li>
                        <li>
                          <strong>Custom Domain on GitHub Pages:</strong>{' '}
                          <code>https://yourcustomdomain.com</code> → produces{' '}
                          <code>did:web:yourcustomdomain.com</code>
                        </li>
                      </ul>
                      <p className="text-xs text-slate-400">
                        Click <strong>Save & Sign Profile JSON</strong> on the Profile tab after
                        updating your URL.
                      </p>
                    </div>

                    {/* Step 2 */}
                    <div className="space-y-2 pt-2 border-t border-slate-800/80">
                      <h4 className="font-bold text-sm text-indigo-300">
                        Step 2: Preview Locally & Export Your Static Site Folder
                      </h4>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        You can first test your build using <strong>Run Local Test Export & Preview</strong>{' '}
                        in the <strong>Live Site Preview</strong> tab. When ready, go to the{' '}
                        <strong>Publish & SFTP</strong> tab (or click <em>Quick Export Static Site</em>{' '}
                        in the bottom-left sidebar) and export your site to a local folder on your
                        computer—for example, <code>C:\Users\you\my-webring-site</code>.
                      </p>
                      <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200">
                        <strong>Built-in GitHub Pages Fix (<code>.nojekyll</code>):</strong> By
                        default, GitHub Pages runs Jekyll, which ignores folders starting with a dot
                        like <code>.well-known/</code>. Webring Studio automatically writes an empty{' '}
                        <code>.nojekyll</code> file in your export folder so GitHub Pages serves{' '}
                        <code>/.well-known/did.json</code> without any 404 errors!
                      </div>
                    </div>

                    {/* Step 3 */}
                    <div className="space-y-2 pt-2 border-t border-slate-800/80">
                      <h4 className="font-bold text-sm text-indigo-300">
                        Step 3: Create a GitHub Repository & Push Your Exported Files
                      </h4>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        1. On GitHub, create a new <strong>Public</strong> repository named{' '}
                        <code>&lt;your-github-username&gt;.github.io</code> (leave "Add a README"
                        unchecked).
                        <br />
                        2. Open a terminal inside your exported folder and run:
                      </p>
                      <div className="relative">
                        <pre className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-emerald-300 overflow-x-auto leading-relaxed">
{`cd "path/to/exported-profile-site"
git init
git branch -M main
git add -A
git commit -m "Publish signed Webring Studio profile"
git remote add origin https://github.com/<your-github-username>/<your-github-username>.github.io.git
git push -u origin main --force`}
                        </pre>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(
                              `cd "path/to/exported-profile-site"\ngit init\ngit branch -M main\ngit add -A\ngit commit -m "Publish signed Webring Studio profile"\ngit remote add origin https://github.com/<your-github-username>/<your-github-username>.github.io.git\ngit push -u origin main --force`
                            );
                            notify('Copied GitHub Pages git commands to clipboard!');
                          }}
                          className="absolute top-3 right-3 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 flex items-center gap-1"
                        >
                          <Copy className="w-3 h-3" /> Copy Commands
                        </button>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        <em>Tip:</em> Whenever you update your profile or add photos later, simply
                        click <strong>Quick Export Static Site</strong> into that same folder and run{' '}
                        <code>git add -A && git commit -m "Update profile" && git push</code>!
                      </p>
                    </div>

                    {/* Step 4 */}
                    <div className="space-y-2 pt-2 border-t border-slate-800/80">
                      <h4 className="font-bold text-sm text-indigo-300">
                        Step 4: Enable GitHub Pages & Verify Your Live Endpoints
                      </h4>
                      <ol className="text-xs text-slate-300 list-decimal list-inside space-y-1.5 pl-1">
                        <li>
                          On GitHub, open your repository and go to{' '}
                          <strong>Settings → Pages</strong>.
                        </li>
                        <li>
                          Under <strong>Build and deployment</strong>, set <strong>Source</strong> to{' '}
                          <code>Deploy from a branch</code>, select branch <code>main</code> and
                          folder <code>/ (root)</code>, then click <strong>Save</strong>.
                        </li>
                        <li>
                          Wait ~60 seconds, then visit your live URL:{' '}
                          <code className="text-indigo-300">https://&lt;your-github-username&gt;.github.io</code>
                        </li>
                        <li>
                          Verify your federated JSON endpoints are reachable in your browser:
                          <ul className="list-disc list-inside pl-5 mt-1 text-slate-400 font-mono">
                            <li>https://example.com/.well-known/did.json</li>
                            <li>https://example.com/api/manifest.json</li>
                            <li>https://example.com/api/profile.json</li>
                          </ul>
                        </li>
                      </ol>
                    </div>
                  </div>
                </div>
              )}

              {/* SECTION 3: HOSTED SFTP / FTP GUIDE */}
              {helpSection === 'ftp-sftp' && (
                <div className="space-y-6">
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5">
                    <div className="border-b border-slate-800 pb-4">
                      <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
                        Direct One-Click Upload + Per-Persona Credential Storage
                      </span>
                      <h3 className="text-xl font-bold mt-2">
                        Deploying to a Web Host via SFTP or FTP (Step-by-Step)
                      </h3>
                      <p className="text-xs text-slate-400 mt-1">
                        Webring Studio includes a built-in SFTP (SSH) and FTP client so you can publish
                        directly to any shared web host (cPanel, DreamHost, NearlyFreeSpeech, Porkbun)
                        or Linux VPS without external FTP software.
                      </p>
                    </div>

                    {/* Step 1 */}
                    <div className="space-y-2">
                      <h4 className="font-bold text-sm text-emerald-300">
                        Step 1: Set Your Domain in "Profile & Identity"
                      </h4>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        Open the <strong>Profile & Identity</strong> tab and set{' '}
                        <strong>Hosted Website URL</strong> to your domain or subdomain (for example,{' '}
                        <code>https://alice.example.com</code> or{' '}
                        <code>https://example.com/~alice</code>). Click{' '}
                        <strong>Save & Sign Profile JSON</strong>.
                      </p>
                    </div>

                    {/* Step 2 */}
                    <div className="space-y-2 pt-2 border-t border-slate-800/80">
                      <h4 className="font-bold text-sm text-emerald-300">
                        Step 2: Enter & Save Your SFTP or FTP Credentials in "Publish & SFTP"
                      </h4>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        Open the <strong>Publish & SFTP</strong> tab and fill in the{' '}
                        <strong>Direct SFTP / FTP Web Host Uploader</strong> card:
                      </p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border border-slate-800 rounded-xl overflow-hidden">
                          <thead className="bg-slate-950 text-slate-400">
                            <tr>
                              <th className="p-2.5 border-b border-slate-800">Field</th>
                              <th className="p-2.5 border-b border-slate-800">Recommended Value</th>
                              <th className="p-2.5 border-b border-slate-800">Notes</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800 text-slate-300">
                            <tr>
                              <td className="p-2.5 font-semibold">Protocol</td>
                              <td className="p-2.5 font-mono text-indigo-300">
                                SFTP (Port 22) or FTP (Port 21)
                              </td>
                              <td className="p-2.5 text-slate-400">
                                Prefer <strong>SFTP</strong> whenever your host supports SSH/SFTP
                                for encrypted transfers.
                              </td>
                            </tr>
                            <tr>
                              <td className="p-2.5 font-semibold">Host / Server</td>
                              <td className="p-2.5 font-mono text-indigo-300">
                                yourdomain.com or ftp.yourdomain.com
                              </td>
                              <td className="p-2.5 text-slate-400">
                                Found in your hosting control panel or VPS IP address.
                              </td>
                            </tr>
                            <tr>
                              <td className="p-2.5 font-semibold">Remote Web Root Path</td>
                              <td className="p-2.5 font-mono text-indigo-300">
                                /public_html or /var/www/html
                              </td>
                              <td className="p-2.5 text-slate-400">
                                Common roots: cPanel = <code>/public_html</code> • NearlyFreeSpeech
                                = <code>/home/public</code> • Debian/Ubuntu VPS ={' '}
                                <code>/var/www/html</code>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-xs text-indigo-200 space-y-1">
                        <strong>Per-Persona Credential Persistence & Deletion:</strong> Click{' '}
                        <strong>Save SFTP/FTP Settings to Profile DB</strong> (or upload directly) to
                        persist your host, port, username, password, and remote path inside the active
                        persona's isolated SQLite database so you don't need to re-enter them each
                        session. You can purge saved credentials anytime by clicking{' '}
                        <strong>Delete Stored SFTP/FTP Info</strong> (protected by a confirmation
                        prompt).
                      </div>
                    </div>

                    {/* Step 3 */}
                    <div className="space-y-2 pt-2 border-t border-slate-800/80">
                      <h4 className="font-bold text-sm text-emerald-300">
                        Step 3: Click "Build & Upload to Remote Host"
                      </h4>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        When you click <strong>Build & Upload to Remote Host</strong>, Webring Studio:
                      </p>
                      <ol className="text-xs text-slate-400 list-decimal list-inside space-y-1 pl-1">
                        <li>
                          Compiles and signs your latest JSON bundle, <code>index.html</code>, and
                          optional <code>ads.txt</code> into a temporary staging folder.
                        </li>
                        <li>
                          Connects via SFTP or FTP and recursively creates{' '}
                          <code>.well-known/</code>, <code>api/</code>, and <code>media/</code> on
                          your remote server.
                        </li>
                        <li>
                          Uploads all files and removes the temporary staging directory.
                        </li>
                      </ol>
                    </div>

                    {/* Step 4: CORS */}
                    <div className="space-y-2 pt-2 border-t border-slate-800/80">
                      <h4 className="font-bold text-sm text-emerald-300">
                        Step 4 (Optional): Enable CORS for Browser-Based Webring Viewers
                      </h4>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        The Webring Studio desktop app crawls peers directly from Node.js (so it
                        never gets blocked by browser CORS rules). However, if you want browser-based
                        webring widgets on other websites to fetch your <code>/api/*.json</code>{' '}
                        files directly in the browser, you can add a <code>.htaccess</code> file (on
                        Apache/cPanel hosts) inside your web root:
                      </p>
                      <pre className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-amber-300 overflow-x-auto">
{`<IfModule mod_headers.c>
  <FilesMatch "\\.(json)$">
    Header set Access-Control-Allow-Origin "*"
  </FilesMatch>
</IfModule>`}
                      </pre>
                    </div>
                  </div>
                </div>
              )}

              {/* SECTION 4: GOOGLE ANALYTICS (GA4) & GOOGLE ADSENSE MONETIZATION ADD-ONS */}
              {helpSection === 'addons' && (
                <div className="space-y-6">
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5">
                    <div className="border-b border-slate-800 pb-4">
                      <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300">
                        Optional Static Profile Add-Ons
                      </span>
                      <h3 className="text-xl font-bold mt-2">
                        Google Analytics (GA4), Google AdSense & Public Guestbook Add-Ons
                      </h3>
                      <p className="text-xs text-slate-400 mt-1">
                        Every persona can optionally enable visitor analytics, ad monetization (to
                        offset domain and web hosting costs), and GitHub-backed public guestbooks.
                        When disabled, zero third-party scripts or CSP domains are included in your
                        exported HTML.
                      </p>
                    </div>

                    {/* Add-On 1: Google Analytics GA4 */}
                    <div className="space-y-2">
                      <h4 className="font-bold text-sm text-indigo-300">
                        1. Google Analytics 4 (GA4) Telemetry Add-On
                      </h4>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        Located in <strong>Publish & SFTP → 5. Google Analytics (GA4) Profile Add-On</strong>:
                      </p>
                      <ol className="text-xs text-slate-400 list-decimal list-inside space-y-1.5 pl-1">
                        <li>
                          In your Google Analytics dashboard, create a <strong>Web Data Stream</strong>{' '}
                          for your profile domain and copy your <strong>Measurement ID</strong>{' '}
                          (formatted as <code>G-XXXXXXXXXX</code>).
                        </li>
                        <li>
                          Toggle <strong>Enable GA4 Add-On</strong> in Webring Studio and paste your{' '}
                          <code>G-XXXXXXXXXX</code> ID.
                        </li>
                        <li>
                          Configure the built-in privacy & telemetry options:
                          <ul className="list-disc list-inside pl-5 mt-1 space-y-1">
                            <li>
                              <strong>Respect Browser Do-Not-Track (DNT):</strong> Skips loading{' '}
                              <code>gtag.js</code> when a visitor's browser sends{' '}
                              <code>navigator.doNotTrack === "1"</code>.
                            </li>
                            <li>
                              <strong>Anonymize Visitor IPs:</strong> Passes{' '}
                              <code>anonymize_ip: true</code> to GA4 config.
                            </li>
                            <li>
                              <strong>Track Outbound Webring Navigation Clicks:</strong> Automatically
                              fires custom <code>webring_interact</code> events whenever visitors
                              click Prev, Next, Random, or Directory links on your webring bar.
                            </li>
                          </ul>
                        </li>
                        <li>
                          Click <strong>Save Analytics Add-On Settings</strong> (or{' '}
                          <strong>Delete Stored Analytics Info</strong> to wipe and disable it).
                        </li>
                      </ol>
                    </div>

                    {/* Add-On 2: Google AdSense */}
                    <div className="space-y-2 pt-3 border-t border-slate-800/80">
                      <h4 className="font-bold text-sm text-amber-300">
                        2. Google AdSense / Ads Monetization Add-On & Automatic <code>/ads.txt</code>
                      </h4>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        Located in <strong>Publish & SFTP → 6. Google AdSense / Ads Monetization Add-On</strong>.
                        Designed so static profile owners can generate ad revenue to offset hosting or
                        custom domain costs:
                      </p>
                      <ol className="text-xs text-slate-400 list-decimal list-inside space-y-1.5 pl-1">
                        <li>
                          Sign up at Google AdSense, add your profile domain, and copy your{' '}
                          <strong>Publisher ID</strong> (formatted as{' '}
                          <code>ca-pub-1234567890123456</code> or <code>pub-1234567890123456</code>;
                          Webring Studio automatically normalizes both formats).
                        </li>
                        <li>
                          Keep <strong>Generate <code>/ads.txt</code> in Site Root</strong> enabled.
                          Whenever you export or upload via SFTP/FTP, Webring Studio writes a
                          standards-compliant IAB Authorized Digital Sellers file at{' '}
                          <code>https://example.com/ads.txt</code> containing:
                          <pre className="mt-1.5 p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-amber-300">
{`google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0`}
                          </pre>
                        </li>
                        <li>
                          Choose between <strong>AdSense Auto Ads</strong> (Google automatically places
                          responsive ads) and/or <strong>Manual Ad Unit Slots</strong> by entering your
                          10-digit numeric Slot IDs for:
                          <ul className="list-disc list-inside pl-5 mt-1 space-y-0.5">
                            <li>
                              <strong>Header Banner Slot ID:</strong> Renders above your main profile
                              tabs.
                            </li>
                            <li>
                              <strong>In-Feed Native Slot ID:</strong> Renders inside your Wall &
                              Activity stream.
                            </li>
                            <li>
                              <strong>Footer Banner Slot ID:</strong> Renders at the bottom of your
                              profile page.
                            </li>
                          </ul>
                        </li>
                        <li>
                          Click <strong>Save AdSense Add-On Settings</strong> and preview the slot
                          placements directly in the <strong>Live Site Preview</strong> tab!
                        </li>
                      </ol>
                    </div>

                    {/* Add-On 3: Dynamic CSP & Guestbook */}
                    <div className="space-y-2 pt-3 border-t border-slate-800/80">
                      <h4 className="font-bold text-sm text-emerald-300">
                        3. Public Guestbook Widget (Giscus / Utterances) & Dynamic CSP Hardening
                      </h4>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        In <strong>Publish & SFTP → 4. Real-Time Public Comment Threads</strong>, you can
                        also enable <strong>Giscus (GitHub Discussions)</strong> or{' '}
                        <strong>Utterances (GitHub Issues)</strong> so visitors without Webring Studio
                        can leave comments at the bottom of your wall.
                      </p>
                      <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-400">
                        <strong className="text-slate-200">
                          🔒 Conditional Content-Security-Policy (CSP):
                        </strong>{' '}
                        Webring Studio's static site generator enforces a strict{' '}
                        <code>&lt;meta http-equiv="Content-Security-Policy"&gt;</code> header. It
                        automatically whitelists Google Analytics (<code>googletagmanager.com</code>)
                        or Google AdSense (<code>pagead2.googlesyndication.com</code>,{' '}
                        <code>googleads.g.doubleclick.net</code>) domains <strong>only</strong> on
                        personas where you explicitly enable those add-ons.
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* SECTION 5: AI AGENT & MODEL CONTEXT PROTOCOL (MCP) AUTOMATION GUIDE */}
              {helpSection === 'mcp-agents' && (
                <div className="space-y-6">
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5">
                    <div className="border-b border-slate-800 pb-4">
                      <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300">
                        24 MCP Tools • 8 Resources • 4 Guided Prompts
                      </span>
                      <h3 className="text-xl font-bold mt-2">
                        Automating Webring Studio with an AI Agent (MCP Guide)
                      </h3>
                      <p className="text-xs text-slate-400 mt-1">
                        Webring Studio includes a full Model Context Protocol (MCP) JSON-RPC 2.0
                        server so local AI agents (Google Antigravity, Claude Desktop, Cursor,
                        Windsurf, or custom scripts) can manage your personas, publish posts, crawl
                        friends, configure add-ons, and deploy your sites on your behalf.
                      </p>
                    </div>

                    {/* Dual Transports */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300">
                          Transport Option 1 • Headless STDIO
                        </span>
                        <h4 className="font-bold text-sm">Standalone CLI Server</h4>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          Spawns <code>dist-electron/electron/mcp/cli.js --data-dir &lt;path&gt;</code>{' '}
                          over standard input/output. Ideal for Claude Desktop, Cursor, or scheduled
                          background tasks—works even when the Webring Studio desktop window is closed.
                        </p>
                      </div>

                      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                          Transport Option 2 • Live Loopback HTTP / SSE
                        </span>
                        <h4 className="font-bold text-sm">Live Studio Window Sync</h4>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          While Webring Studio is open, it listens on{' '}
                          <code>{mcpInfo?.status.endpointUrl || 'http://127.0.0.1:<port>/mcp'}</code>.
                          Any tool call executed by your AI agent updates the Studio UI and Live
                          Activity Log in real time!
                        </p>
                      </div>
                    </div>

                    {/* Available Tool Categories */}
                    <div className="space-y-2 pt-2 border-t border-slate-800/80">
                      <h4 className="font-bold text-sm text-indigo-300">
                        What Can Your AI Agent Control via MCP? (24 Tools)
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-300">
                        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                          <strong className="text-white block mb-1">
                            🎭 Personas & Identity (5 tools)
                          </strong>
                          <code>webring_list_personas</code>, <code>webring_create_persona</code>,{' '}
                          <code>webring_switch_persona</code>, <code>webring_get_profile</code>,{' '}
                          <code>webring_update_profile</code>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                          <strong className="text-white block mb-1">
                            💬 Wall Posts, Replies & Albums (6 tools)
                          </strong>
                          <code>webring_create_post</code>, <code>webring_interact_with_url</code>,{' '}
                          <code>webring_delete_item</code>, <code>webring_create_album</code>,{' '}
                          <code>webring_add_photo</code>, <code>webring_delete_photo</code>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                          <strong className="text-white block mb-1">
                            🕸️ Ring Crawler & Neighborhood Feed (7 tools)
                          </strong>
                          <code>webring_add_friend</code>, <code>webring_set_friend_visibility</code>,{' '}
                          <code>webring_delete_friend</code>, <code>webring_add_webring</code>,{' '}
                          <code>webring_crawl_friend</code>, <code>webring_crawl_all_friends</code>,{' '}
                          <code>webring_get_neighborhood_feed</code>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                          <strong className="text-white block mb-1">
                            🚀 Publishing, Privacy & Add-Ons (6 tools)
                          </strong>
                          <code>webring_update_privacy_settings</code>,{' '}
                          <code>webring_get_addons</code>,{' '}
                          <code>webring_configure_analytics_addon</code>,{' '}
                          <code>webring_configure_ads_addon</code>, <code>webring_export_site</code>,{' '}
                          <code>webring_test_export_preview</code>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      <p className="text-xs text-slate-400">
                        Ready to copy your one-click MCP configuration or test tools interactively?
                      </p>
                      <button
                        type="button"
                        onClick={() => setActiveTab('mcp')}
                        className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition"
                      >
                        Open AI Agent (MCP) Hub →
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* SECTION 6: SECURITY, PRIVACY & TROUBLESHOOTING FAQ */}
              {helpSection === 'privacy-faq' && (
                <div className="space-y-6">
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5">
                    <h3 className="text-xl font-bold">
                      Security Hardening, Social Graph Privacy & Troubleshooting FAQ
                    </h3>

                    <div className="space-y-4">
                      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                        <h4 className="font-bold text-sm text-emerald-400">
                          Q: Can strangers or bots scrape my JSON files to map my friend network?
                        </h4>
                        <p className="text-xs text-slate-300 leading-relaxed">
                          <strong>Not unless you explicitly choose to publish them.</strong> By
                          default, Webring Studio enables the{' '}
                          <strong>Social Graph Privacy & Anti-Scraping Shield</strong>:
                        </p>
                        <ul className="text-xs text-slate-400 list-disc list-inside space-y-1 pl-2">
                          <li>
                            Every friend you add defaults to{' '}
                            <strong>🔒 Private (Local Crawler Only)</strong>. They are stored only in
                            your local SQLite database so your desktop Studio can pull their updates
                            into your <em>Neighborhood Feed</em>.
                          </li>
                          <li>
                            Your exported <code>/api/connections.json</code> contains{' '}
                            <code>friends: []</code> unless you mark specific friends as{' '}
                            <strong>🌐 Public</strong>.
                          </li>
                          <li>
                            Even for friends you mark <strong>Public</strong>, real-world XFN
                            relationship tags (<code>met</code>, <code>kin</code>,{' '}
                            <code>colleague</code>) are stripped from the exported JSON by default.
                          </li>
                        </ul>
                      </div>

                      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                        <h4 className="font-bold text-sm text-purple-400">
                          Q: If I manage multiple online personas in Webring Studio, can anyone link
                          them together?
                        </h4>
                        <p className="text-xs text-slate-300 leading-relaxed">
                          <strong>No.</strong> Webring Studio enforces{' '}
                          <strong>Strict Multi-Persona Compartmentalization</strong>: each persona has
                          its own isolated SQLite database file (<code>persona-&lt;id&gt;.sqlite</code>),
                          its own freshly generated Ed25519 cryptographic keypair and{' '}
                          <code>did:web</code> identity, its own isolated media store folder, and its
                          own export folder, SFTP credentials, and analytics/ad add-on settings. In
                          addition, the Persona Manager displays an automatic{' '}
                          <strong>OPSEC Correlation Warning</strong> if you accidentally assign two
                          personas to the same domain hostname.
                        </p>
                      </div>

                      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                        <h4 className="font-bold text-sm text-amber-400">
                          Q: How do Wall Replies, "Like", and "Add to Friend Ring" work on a static
                          site without a backend server?
                        </h4>
                        <p className="text-xs text-slate-300 leading-relaxed">
                          Webring Studio uses a <strong>Dual-Layer Social Architecture</strong>:
                        </p>
                        <ul className="text-xs text-slate-400 list-disc list-inside space-y-1 pl-2">
                          <li>
                            <strong>Layer 1 (Sovereign Ring Replies & Likes):</strong> Clicking{' '}
                            <strong>💬 Reply</strong> or <strong>♥ Like</strong> on a peer's static
                            site (or inside your Neighborhood Feed) creates a signed entry in your own{' '}
                            <code>/api/items.json</code> pointing to the friend's canonical item URI.
                            When your friend crawls the ring, their Studio verifies your Ed25519
                            signature and threads your reply directly under their post!
                          </li>
                          <li>
                            <strong>Layer 2 (Optional Public Guestbook):</strong> For casual web
                            visitors who don't use Webring Studio, you can enable the optional{' '}
                            <strong>Giscus / Utterances</strong> widget in the Publish tab.
                          </li>
                        </ul>
                      </div>

                      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                        <h4 className="font-bold text-sm text-cyan-400">
                          Q: What security protections guard against malicious peer sites during
                          crawling?
                        </h4>
                        <p className="text-xs text-slate-300 leading-relaxed">
                          Webring Studio's <code>RingCrawler</code> and static site generator include
                          comprehensive defenses audited via Edward de Bono's Six Thinking Hats
                          methodology:
                        </p>
                        <ul className="text-xs text-slate-400 list-disc list-inside space-y-1 pl-2">
                          <li>
                            <strong>SSRF & DNS-Rebinding Guard:</strong> Blocks loopback, link-local,
                            and RFC1918 private IPs before fetching remote peer JSON files.
                          </li>
                          <li>
                            <strong>DID Origin Binding & Cryptographic Verification:</strong> Verifies
                            that a peer's <code>did:web</code> matches their actual HTTPS origin and
                            validates Ed25519 signatures over canonical JCS payloads.
                          </li>
                          <li>
                            <strong>XSS & Script-Breakout Neutralization:</strong> Escapes embedded
                            JSON payloads in <code>index.html</code>, enforces strict URL scheme
                            whitelisting (blocking <code>javascript:</code> and <code>data:</code>{' '}
                            URIs), and requires explicit user confirmation before executing incoming{' '}
                            <code>webring://</code> deep links.
                          </li>
                        </ul>
                      </div>

                      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                        <h4 className="font-bold text-sm text-indigo-400">
                          Q: Why does a friend's site show an unverified DID signature when crawled?
                        </h4>
                        <p className="text-xs text-slate-300 leading-relaxed">
                          Ed25519 signature verification checks two things: (1) that{' '}
                          <code>/.well-known/did.json</code> is reachable at the friend's domain, and
                          (2) that the JSON file wasn't modified after signing. If a friend deployed
                          to GitHub Pages before adding <code>.nojekyll</code>, GitHub Pages might
                          return 404 for <code>/.well-known/did.json</code>. Re-exporting from Webring
                          Studio automatically includes <code>.nojekyll</code> to fix this.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Multi-Persona Compartmentalization Manager Modal */}
      {showPersonaModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-extrabold text-white">
                    Online Personas & Compartmentalized Identities
                  </h2>
                  <p className="text-xs text-slate-400">
                    Each persona has an isolated SQLite database, independent Ed25519 keypair, separate media store, and separate export / host settings.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPersonaModal(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300"
              >
                Close ✕
              </button>
            </div>

            <div className="p-6 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Existing Personas List */}
              <div className="lg:col-span-7 space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Your Compartmentalized Personas ({personas.length})
                </h3>
                {(() => {
                  const hostMap = new Map<string, string[]>();
                  for (const p of personas) {
                    try {
                      const host = new URL(p.siteUrl).hostname.toLowerCase();
                      if (host && host !== 'my-profile.local') {
                        hostMap.set(host, [...(hostMap.get(host) || []), p.label]);
                      }
                    } catch {
                      // ignore invalid URL
                    }
                  }
                  const sharedHosts = Array.from(hostMap.entries()).filter(
                    ([, labels]) => labels.length > 1
                  );
                  if (sharedHosts.length === 0) return null;
                  return (
                    <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-500/40 text-xs text-amber-200 space-y-1">
                      <p className="font-bold text-amber-300">
                        ⚠️ Cross-Persona OPSEC Correlation Warning
                      </p>
                      <p className="text-amber-200/90 leading-relaxed">
                        Multiple personas share the same domain hostname (
                        {sharedHosts
                          .map(([h, labels]) => `${h}: ${labels.join(' & ')}`)
                          .join('; ')}
                        ). Even though their SQLite databases and Ed25519 keys are strictly
                        isolated, hosting two personas on subpaths of the same domain or GitHub
                        Pages account allows observers to correlate them. Use separate domains or
                        separate hosting accounts for anonymous aliases.
                      </p>
                    </div>
                  );
                })()}
                <div className="space-y-3">
                  {personas.map((p) => {
                    const isActive = p.id === activePersonaId;
                    const isEditing = editingPersonaId === p.id;
                    return (
                      <div
                        key={p.id}
                        className={`p-4 rounded-xl border transition ${
                          isActive
                            ? 'bg-indigo-950/30 border-indigo-500/60 shadow-lg shadow-indigo-950/30'
                            : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <img
                              src={
                                p.avatarUrl ||
                                `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(
                                  p.displayName
                                )}`
                              }
                              alt={p.displayName}
                              className="w-12 h-12 rounded-xl object-cover border border-slate-700 shrink-0"
                            />
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-bold text-sm text-white truncate">
                                  {p.displayName}
                                </span>
                                {isEditing ? (
                                  <span className="inline-flex items-center gap-1">
                                    <input
                                      type="text"
                                      value={editingPersonaLabel}
                                      onChange={(e) => setEditingPersonaLabel(e.target.value)}
                                      className="px-2 py-0.5 rounded bg-slate-900 border border-indigo-500 text-xs text-white w-32"
                                      placeholder="Studio Label"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => handleRenamePersona(p.id)}
                                      className="text-[10px] px-2 py-0.5 rounded bg-emerald-600 text-white font-semibold"
                                    >
                                      Save
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingPersonaId(null)}
                                      className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400"
                                    >
                                      Cancel
                                    </button>
                                  </span>
                                ) : (
                                  <span
                                    onClick={() => {
                                      setEditingPersonaId(p.id);
                                      setEditingPersonaLabel(p.label);
                                    }}
                                    className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-semibold cursor-pointer hover:bg-indigo-500/30"
                                    title="Click to rename studio label"
                                  >
                                    {p.label} ✎
                                  </span>
                                )}
                                {isActive && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">
                                    ACTIVE
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-400 font-mono truncate mt-0.5">
                                {p.siteUrl}
                              </p>
                              <p className="text-[11px] text-emerald-400/90 font-mono truncate">
                                {p.did}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {!isActive && (
                              <button
                                type="button"
                                onClick={() => handleSwitchPersona(p.id)}
                                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition"
                              >
                                Switch
                              </button>
                            )}
                            {p.id !== 'default' && (
                              <button
                                type="button"
                                onClick={() => handleDeletePersona(p.id, p.label)}
                                className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 transition"
                                title="Delete this persona"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                          <div className="flex items-center gap-3">
                            <span>📸 {p.stats?.photoCount ?? 0} photos</span>
                            <span>✨ {p.stats?.itemCount ?? 0} items</span>
                            <span>🤝 {p.stats?.friendCount ?? 0} friends</span>
                          </div>
                          <span className="font-mono text-[10px] text-slate-500" title="Isolated SQLite Database File">
                            DB: {p.dbFileName}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right Column: Create New Persona Form */}
              <div className="lg:col-span-5 bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-4 self-start">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <UserPlus className="w-4 h-4 text-indigo-400" />
                    Create New Online Persona
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Generates a fresh SQLite database, a brand-new Ed25519 cryptographic keypair, and an isolated media store so this persona cannot be correlated with your other identities.
                  </p>
                </div>

                <form onSubmit={handleCreatePersona} className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Studio Workspace Label *
                    </label>
                    <input
                      type="text"
                      required
                      value={newPersonaLabel}
                      onChange={(e) => setNewPersonaLabel(e.target.value)}
                      placeholder="e.g., Alt Handle / Music Alias / Professional"
                      className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-sm text-white"
                    />
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Private label shown only inside your local Studio switcher.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Public Display Name / Handle *
                    </label>
                    <input
                      type="text"
                      required
                      value={newPersonaDisplayName}
                      onChange={(e) => setNewPersonaDisplayName(e.target.value)}
                      placeholder="e.g., Nightowl Synth"
                      className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-sm text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Hosted Website URL (Domain or Subpath)
                    </label>
                    <input
                      type="url"
                      value={newPersonaSiteUrl}
                      onChange={(e) => setNewPersonaSiteUrl(e.target.value)}
                      placeholder="https://nightowl.github.io or https://domain.com/alt"
                      className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-sm text-white font-mono"
                    />
                    {newPersonaSiteUrl.trim() && (
                      <p className="text-[11px] text-emerald-400 font-mono mt-1 truncate">
                        DID: {siteUrlToDidWeb(newPersonaSiteUrl.trim())}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Tagline (Optional)
                    </label>
                    <input
                      type="text"
                      value={newPersonaTagline}
                      onChange={(e) => setNewPersonaTagline(e.target.value)}
                      placeholder="Ambient electronics & late-night field recordings"
                      className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-sm text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Initial Visual Theme
                    </label>
                    <select
                      value={newPersonaTheme}
                      onChange={(e) => setNewPersonaTheme(e.target.value as ProfileTheme)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-sm text-white"
                    >
                      <option value="neo-webring">Neo-Webring (Dark Indigo)</option>
                      <option value="cyber-terminal">Cyber Terminal (Phosphor Green)</option>
                      <option value="minimal-zine">Minimal Zine (Editorial Print)</option>
                      <option value="cozy-scrapbook">Cozy Scrapbook (Warm Amber)</option>
                    </select>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 transition"
                  >
                    <Plus className="w-4 h-4" />
                    Create Isolated Persona & Switch
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

