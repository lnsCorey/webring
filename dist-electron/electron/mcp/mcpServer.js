"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebringMcpServer = exports.MCP_PROTOCOL_VERSION = void 0;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const localPreviewServer_1 = require("../services/localPreviewServer");
const schema_1 = require("../../src/shared/schema");
exports.MCP_PROTOCOL_VERSION = '2024-11-05';
class WebringMcpServer {
    personaManager;
    userDataDir;
    onActivity;
    activityLog = [];
    previewServer;
    constructor(personaManager, userDataDir, previewServer, onActivity) {
        this.personaManager = personaManager;
        this.userDataDir = userDataDir;
        this.onActivity = onActivity;
        this.previewServer = previewServer || new localPreviewServer_1.LocalPreviewServer();
    }
    getActivityLog() {
        return [...this.activityLog];
    }
    recordActivity(method, summary, success, toolName) {
        const entry = {
            id: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: new Date().toISOString(),
            method,
            toolName,
            personaId: this.personaManager.getActivePersonaId(),
            summary,
            success,
        };
        this.activityLog.unshift(entry);
        if (this.activityLog.length > 100) {
            this.activityLog.length = 100;
        }
        if (this.onActivity) {
            this.onActivity(entry);
        }
    }
    /**
     * Resolves the target persona context. If `personaId` is provided and differs from
     * the currently active persona, switches to it so operations run in the requested compartment.
     */
    resolveContext(args) {
        const requestedPersonaId = typeof args?.personaId === 'string' ? args.personaId.trim() : '';
        if (requestedPersonaId &&
            requestedPersonaId !== this.personaManager.getActivePersonaId()) {
            this.personaManager.switchPersona(requestedPersonaId);
        }
        return this.personaManager.getActiveContext();
    }
    getTools() {
        const personaIdProp = {
            type: 'string',
            description: 'Optional persona ID (e.g. "default" or "persona-..."). Defaults to the currently active persona.',
        };
        return [
            // 1. Personas & Identity
            {
                name: 'webring_list_personas',
                description: 'List all compartmentalized online personas in Webring Studio, including their active status, did:web identity, siteUrl, and item/friend/photo counts.',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
            {
                name: 'webring_create_persona',
                description: 'Create a new compartmentalized online persona with an isolated SQLite database, a fresh Ed25519 signing keypair, and a distinct did:web identity.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        label: {
                            type: 'string',
                            description: 'Internal Studio nickname for this persona (never exported publicly).',
                        },
                        displayName: {
                            type: 'string',
                            description: 'Public display name on the generated profile website.',
                        },
                        siteUrl: {
                            type: 'string',
                            description: 'Hosted website root URL (e.g. https://alias.example.com).',
                        },
                        tagline: { type: 'string', description: 'Short headline or tagline.' },
                        bio: { type: 'string', description: 'About / biography text.' },
                        theme: {
                            type: 'string',
                            enum: ['neo-webring', 'minimal-zine', 'cyber-terminal', 'cozy-scrapbook'],
                            description: 'Visual theme for the exported profile site.',
                        },
                    },
                    required: ['label', 'displayName'],
                },
            },
            {
                name: 'webring_switch_persona',
                description: 'Switch the active persona in Webring Studio by personaId.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        personaId: {
                            type: 'string',
                            description: 'ID of the persona to activate (e.g. "default" or "persona-...").',
                        },
                    },
                    required: ['personaId'],
                },
            },
            {
                name: 'webring_get_profile',
                description: 'Get the profile metadata, W3C/ATProto did:web identifier, Ed25519 public key, and privacy/publishing settings for a persona.',
                inputSchema: {
                    type: 'object',
                    properties: { personaId: personaIdProp },
                },
            },
            {
                name: 'webring_update_profile',
                description: 'Update profile metadata (displayName, siteUrl, tagline, bio, theme, interests, customLinks, atprotoHandle) and/or Social Graph Privacy Shield & Comment settings.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        personaId: personaIdProp,
                        siteUrl: { type: 'string' },
                        displayName: { type: 'string' },
                        tagline: { type: 'string' },
                        bio: { type: 'string' },
                        location: { type: 'string' },
                        avatarUrl: { type: 'string' },
                        bannerUrl: { type: 'string' },
                        interests: { type: 'array', items: { type: 'string' } },
                        theme: {
                            type: 'string',
                            enum: ['neo-webring', 'minimal-zine', 'cyber-terminal', 'cozy-scrapbook'],
                        },
                        atprotoHandle: { type: 'string' },
                        publishFriendsList: {
                            type: 'boolean',
                            description: 'Whether public friends are exported to /api/connections.json.',
                        },
                        stripRelationshipTags: {
                            type: 'boolean',
                            description: 'Strip XFN relationship tags from exported connections.json.',
                        },
                        publishEndorsements: {
                            type: 'boolean',
                            description: 'Include discovered peer likes/comments in exported connections.json.',
                        },
                        redactItemSourceAuthors: {
                            type: 'boolean',
                            description: 'Redact targetAuthorUrl/Name in exported items.json.',
                        },
                        commentProvider: {
                            type: 'string',
                            enum: ['none', 'giscus', 'utterances'],
                        },
                        giscusRepo: { type: 'string' },
                    },
                },
            },
            // 2. Wall Posts, Likes, Shares, Recommendations & Comments
            {
                name: 'webring_list_items',
                description: 'List authored timeline items (wall posts, likes, shares, recommendations, and comments) for the persona.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        personaId: personaIdProp,
                        type: {
                            type: 'string',
                            enum: ['post', 'like', 'share', 'recommendation', 'comment'],
                            description: 'Optional filter by item type.',
                        },
                        tag: {
                            type: 'string',
                            description: 'Optional filter by hashtag.',
                        },
                    },
                },
            },
            {
                name: 'webring_create_post',
                description: 'Publish a new self-hosted Wall Post (status update, essay, or note) on the persona’s timeline (/api/items.json).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        personaId: personaIdProp,
                        commentary: {
                            type: 'string',
                            description: 'Main body text of the wall post.',
                        },
                        title: {
                            type: 'string',
                            description: 'Optional headline (auto-derived from first line if omitted).',
                        },
                        mediaUrl: {
                            type: 'string',
                            description: 'Optional image/media URL attached to the post.',
                        },
                        tags: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Optional list of topic tags.',
                        },
                    },
                    required: ['commentary'],
                },
            },
            {
                name: 'webring_interact_with_url',
                description: 'Publish a Like, Share, Recommendation, or threaded Comment targeting a friend’s canonicalUrl (from the Neighborhood Feed) or any external web URL.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        personaId: personaIdProp,
                        type: {
                            type: 'string',
                            enum: ['like', 'share', 'recommendation', 'comment'],
                            description: 'Type of social interaction.',
                        },
                        targetUrl: {
                            type: 'string',
                            description: 'Canonical URL of the friend’s post/photo (e.g. https://friend.example/api/items.json#item-123) or external webpage.',
                        },
                        commentary: {
                            type: 'string',
                            description: 'Your comment reply or notes on why you liked/shared this item.',
                        },
                        title: {
                            type: 'string',
                            description: 'Title of the referenced post or item.',
                        },
                        targetAuthorName: {
                            type: 'string',
                            description: 'Display name of the original author.',
                        },
                        targetAuthorUrl: {
                            type: 'string',
                            description: 'Site URL of the original author.',
                        },
                        category: {
                            type: 'string',
                            description: 'Category (e.g. article, photo, music, status, comment).',
                        },
                        rating: {
                            type: 'number',
                            description: 'Optional 1-5 star rating (for recommendations/likes).',
                        },
                        tags: {
                            type: 'array',
                            items: { type: 'string' },
                        },
                    },
                    required: ['type', 'targetUrl', 'commentary'],
                },
            },
            {
                name: 'webring_delete_item',
                description: 'Delete a wall post, comment, or shared item by its item ID.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        personaId: personaIdProp,
                        itemId: { type: 'string', description: 'ID of the item to delete (e.g. item-...).' },
                    },
                    required: ['itemId'],
                },
            },
            // 3. Photo Albums
            {
                name: 'webring_list_albums',
                description: 'List all photo albums and their photos for the persona.',
                inputSchema: {
                    type: 'object',
                    properties: { personaId: personaIdProp },
                },
            },
            {
                name: 'webring_create_album',
                description: 'Create a new photo album in /api/albums.json.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        personaId: personaIdProp,
                        title: { type: 'string', description: 'Album title.' },
                        description: { type: 'string', description: 'Album description.' },
                        coverUrl: { type: 'string', description: 'Optional cover image URL.' },
                        tags: { type: 'array', items: { type: 'string' } },
                    },
                    required: ['title'],
                },
            },
            {
                name: 'webring_add_photo',
                description: 'Add a photo to an album using either a local image file path (copied into the persona media store) or a remote image URL.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        personaId: personaIdProp,
                        albumId: { type: 'string', description: 'Target album ID.' },
                        urlOrLocalPath: {
                            type: 'string',
                            description: 'HTTP(S) image URL or absolute local file path to import.',
                        },
                        caption: { type: 'string', description: 'Photo caption.' },
                        tags: { type: 'array', items: { type: 'string' } },
                    },
                    required: ['albumId', 'urlOrLocalPath'],
                },
            },
            {
                name: 'webring_delete_album',
                description: 'Delete a photo album by ID.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        personaId: personaIdProp,
                        albumId: { type: 'string' },
                    },
                    required: ['albumId'],
                },
            },
            {
                name: 'webring_delete_photo',
                description: 'Delete a photo by ID.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        personaId: personaIdProp,
                        photoId: { type: 'string' },
                    },
                    required: ['photoId'],
                },
            },
            // 4. Friend Ring, TOFU Keys & Pull-Federation Crawler
            {
                name: 'webring_list_friends',
                description: 'List all friends in the persona’s local ring, including their private/public visibility and Trust-On-First-Use (TOFU) Ed25519 key pinning status.',
                inputSchema: {
                    type: 'object',
                    properties: { personaId: personaIdProp },
                },
            },
            {
                name: 'webring_add_friend',
                description: 'Add or update a friend in the local ring. Defaults to visibility="private" (local crawler only, hidden from public connections.json).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        personaId: personaIdProp,
                        siteUrl: { type: 'string', description: 'Friend’s profile website root URL.' },
                        displayName: { type: 'string', description: 'Friend’s display name.' },
                        visibility: {
                            type: 'string',
                            enum: ['private', 'public'],
                            description: 'Whether to keep private (default) or export on public blogroll.',
                        },
                        relationship: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Local XFN relationship tags (e.g. ["friend", "colleague"]).',
                        },
                        bio: { type: 'string' },
                        avatarUrl: { type: 'string' },
                    },
                    required: ['siteUrl', 'displayName'],
                },
            },
            {
                name: 'webring_set_friend_visibility',
                description: 'Toggle a friend’s connection visibility between "private" (local crawler only) and "public" (allowed on blogroll).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        personaId: personaIdProp,
                        friendId: { type: 'string' },
                        visibility: { type: 'string', enum: ['private', 'public'] },
                    },
                    required: ['friendId', 'visibility'],
                },
            },
            {
                name: 'webring_delete_friend',
                description: 'Remove a friend from the persona’s local ring.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        personaId: personaIdProp,
                        friendId: { type: 'string' },
                    },
                    required: ['friendId'],
                },
            },
            {
                name: 'webring_crawl_friend',
                description: 'Crawl a single friend’s static JSON profile endpoints, verify Ed25519 signatures on all documents, enforce TOFU public key pinning, and index their posts/photos/endorsements.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        personaId: personaIdProp,
                        siteUrl: { type: 'string', description: 'Friend’s website URL to crawl.' },
                        localDirOverride: {
                            type: 'string',
                            description: 'Optional local directory path when testing offline peer sites.',
                        },
                    },
                    required: ['siteUrl'],
                },
            },
            {
                name: 'webring_crawl_all_friends',
                description: 'Crawl all friends in the persona’s ring (plus the simulated peer site if offline) and return a summary of newly indexed posts, photos, and back-endorsements.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        personaId: personaIdProp,
                        includeSimulatedPeer: {
                            type: 'boolean',
                            description: 'If true, also generates and crawls the built-in simulated peer site (Maya Lin) so offline testing has rich feed data.',
                        },
                    },
                },
            },
            {
                name: 'webring_get_neighborhood_feed',
                description: 'Query chronological posts, photos, likes, shares, and comments pulled from friends in the Neighborhood Feed.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        personaId: personaIdProp,
                        entryType: {
                            type: 'string',
                            enum: ['photo', 'post', 'like', 'share', 'recommendation', 'comment'],
                            description: 'Optional filter by entry type.',
                        },
                        friendSiteUrl: {
                            type: 'string',
                            description: 'Optional filter by friend site URL.',
                        },
                        verifiedOnly: {
                            type: 'boolean',
                            description: 'If true, only return entries with verified Ed25519 DID signatures.',
                        },
                        limit: {
                            type: 'number',
                            description: 'Maximum number of feed entries to return (default 50).',
                        },
                    },
                },
            },
            {
                name: 'webring_get_endorsements',
                description: 'List discovered likes, shares, recommendations, and comments made by friends targeting our own posts and photos.',
                inputSchema: {
                    type: 'object',
                    properties: { personaId: personaIdProp },
                },
            },
            {
                name: 'webring_sync_webring_hub',
                description: 'Fetch a remote webring-hub.json directory URL and update our prevSiteUrl / nextSiteUrl ring navigation links.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        personaId: personaIdProp,
                        hubUrl: { type: 'string', description: 'URL or path to webring-hub.json.' },
                    },
                    required: ['hubUrl'],
                },
            },
            // 5. Static Site Generation & Local Preview
            {
                name: 'webring_export_static_site',
                description: 'Sign all JSON documents with the persona’s Ed25519 private key and export the complete self-contained static website (index.html, .nojekyll, did.json, api/*.json) to disk.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        personaId: personaIdProp,
                        targetDir: {
                            type: 'string',
                            description: 'Optional target directory path. Uses the persona’s configured export directory if omitted.',
                        },
                    },
                },
            },
            {
                name: 'webring_start_preview_server',
                description: 'Build a local test export of the persona’s static website and serve it over a loopback HTTP preview server (http://127.0.0.1:<port>/).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        personaId: personaIdProp,
                    },
                },
            },
            // 6. Optional Profile Add-Ons (Google Analytics GA4 & Google AdSense Monetization)
            {
                name: 'webring_get_addons',
                description: 'Get the status and configuration of all optional profile add-ons (Google Analytics GA4, Google AdSense monetization, and live Giscus/Utterances comments) for a persona, plus cross-persona OPSEC correlation warnings.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        personaId: personaIdProp,
                    },
                },
            },
            {
                name: 'webring_configure_analytics_addon',
                description: 'Enable, disable, configure, or clear the optional Google Analytics (GA4) add-on for a persona.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        personaId: personaIdProp,
                        enabled: {
                            type: 'boolean',
                            description: 'Enable or disable Google Analytics (GA4) script injection.',
                        },
                        measurementId: {
                            type: 'string',
                            description: 'GA4 Measurement ID (format: G-XXXXXXXXXX).',
                        },
                        respectDoNotTrack: {
                            type: 'boolean',
                            description: 'Skip analytics when browser Do-Not-Track (DNT) is enabled (default true).',
                        },
                        anonymizeIp: {
                            type: 'boolean',
                            description: 'Anonymize visitor IP addresses in GA4 (default true).',
                        },
                        trackRingInteractions: {
                            type: 'boolean',
                            description: 'Fire custom webring_interact GA4 events when visitors click Like/Share/Comment links.',
                        },
                        clear: {
                            type: 'boolean',
                            description: 'If true, wipes stored GA4 Measurement ID and disables the add-on.',
                        },
                    },
                },
            },
            {
                name: 'webring_configure_ads_addon',
                description: 'Enable, disable, configure, or clear the optional Google AdSense monetization add-on (including automatic /ads.txt generation and ad placement slots) for a persona.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        personaId: personaIdProp,
                        enabled: {
                            type: 'boolean',
                            description: 'Enable or disable Google AdSense on the exported profile site.',
                        },
                        publisherId: {
                            type: 'string',
                            description: 'Google AdSense Publisher ID (format: ca-pub-1234567890123456).',
                        },
                        enableAutoAds: {
                            type: 'boolean',
                            description: 'Allow Google Auto Ads via the head tag (default true).',
                        },
                        generateAdsTxt: {
                            type: 'boolean',
                            description: 'Automatically generate /ads.txt in the exported site root (default true).',
                        },
                        headerSlotId: {
                            type: 'string',
                            description: 'Optional numeric AdSense slot ID for the Profile Banner ad slot.',
                        },
                        inFeedSlotId: {
                            type: 'string',
                            description: 'Optional numeric AdSense slot ID for the In-Feed ad slot.',
                        },
                        footerSlotId: {
                            type: 'string',
                            description: 'Optional numeric AdSense slot ID for the Footer ad slot.',
                        },
                        clear: {
                            type: 'boolean',
                            description: 'If true, wipes stored AdSense Publisher ID, slot IDs, and disables the add-on.',
                        },
                    },
                },
            },
        ];
    }
    getResources() {
        return [
            {
                uri: 'webring://personas',
                name: 'Compartmentalized Personas Registry',
                description: 'List of all isolated personas, their DIDs, site URLs, and content statistics.',
                mimeType: 'application/json',
            },
            {
                uri: 'webring://active/bundle',
                name: 'Active Persona Signed Site Bundle',
                description: 'Complete signed JSON bundle (manifest, profile, albums, items, connections, didDocument) for the active persona.',
                mimeType: 'application/json',
            },
            {
                uri: 'webring://active/feed',
                name: 'Active Persona Neighborhood Feed',
                description: 'Chronological feed of posts, photos, likes, and comments crawled from friends.',
                mimeType: 'application/json',
            },
            {
                uri: 'webring://active/endorsements',
                name: 'Active Persona Endorsements & Comments',
                description: 'Verified likes, shares, and comments from friends targeting the active persona’s posts and photos.',
                mimeType: 'application/json',
            },
            {
                uri: 'webring://active/addons',
                name: 'Active Persona Optional Add-Ons (Analytics, AdSense & Comments)',
                description: 'Configuration and status of optional Google Analytics (GA4), Google AdSense monetization, and live comment add-ons.',
                mimeType: 'application/json',
            },
        ];
    }
    getPrompts() {
        return [
            {
                name: 'daily-ring-digest',
                description: 'Crawl all friends in the webring, summarize new wall posts and photos in the Neighborhood Feed, highlight new comments/likes on your posts, and suggest thoughtful replies.',
                arguments: [
                    {
                        name: 'personaId',
                        description: 'Optional persona ID to run the digest for.',
                        required: false,
                    },
                ],
            },
            {
                name: 'publish-wall-update',
                description: 'Draft and publish a new Wall Post for the active persona, sign all static JSON endpoints, and export the updated static profile site.',
                arguments: [
                    {
                        name: 'topic',
                        description: 'What you want to post about on your wall.',
                        required: true,
                    },
                    {
                        name: 'tags',
                        description: 'Optional comma-separated tags.',
                        required: false,
                    },
                ],
            },
            {
                name: 'opsec-privacy-audit',
                description: 'Audit all personas in Webring Studio for cross-persona domain correlation, Social Graph Privacy Shield settings, and Friend TOFU Ed25519 key status.',
                arguments: [],
            },
        ];
    }
    async executeToolCall(name, rawArgs) {
        const args = rawArgs || {};
        try {
            let resultData;
            let summary = `Called ${name}`;
            switch (name) {
                case 'webring_list_personas': {
                    resultData = this.personaManager.listPersonas();
                    summary = `Listed ${resultData.personas.length} persona(s)`;
                    break;
                }
                case 'webring_create_persona': {
                    resultData = this.personaManager.createPersona({
                        label: String(args.label || 'New Persona'),
                        displayName: String(args.displayName || 'New Persona'),
                        siteUrl: args.siteUrl ? String(args.siteUrl) : undefined,
                        tagline: args.tagline ? String(args.tagline) : undefined,
                        bio: args.bio ? String(args.bio) : undefined,
                        theme: args.theme || 'neo-webring',
                    });
                    summary = `Created & switched to persona "${args.label}"`;
                    break;
                }
                case 'webring_switch_persona': {
                    const targetId = String(args.personaId || '');
                    resultData = this.personaManager.switchPersona(targetId);
                    summary = `Switched active persona to "${targetId}"`;
                    break;
                }
                case 'webring_get_profile': {
                    const ctx = this.resolveContext(args);
                    resultData = ctx.db.getProfile();
                    summary = `Read profile for ${ctx.persona.displayName}`;
                    break;
                }
                case 'webring_update_profile': {
                    const ctx = this.resolveContext(args);
                    const current = ctx.db.getProfile();
                    const publishUpdates = {};
                    for (const key of [
                        'publishFriendsList',
                        'stripRelationshipTags',
                        'publishEndorsements',
                        'publishWebringHub',
                        'redactItemSourceAuthors',
                        'commentProvider',
                        'giscusRepo',
                        'giscusCategory',
                        'analyticsEnabled',
                        'analyticsMeasurementId',
                        'analyticsRespectDnt',
                        'analyticsAnonymizeIp',
                        'analyticsTrackRingInteractions',
                        'adsEnabled',
                        'adsPublisherId',
                        'adsEnableAutoAds',
                        'adsGenerateAdsTxt',
                        'adsHeaderSlotId',
                        'adsInFeedSlotId',
                        'adsFooterSlotId',
                    ]) {
                        if (args[key] !== undefined) {
                            publishUpdates[key] = args[key];
                        }
                    }
                    resultData = ctx.db.updateProfile({
                        siteUrl: args.siteUrl ? String(args.siteUrl) : undefined,
                        displayName: args.displayName ? String(args.displayName) : undefined,
                        tagline: args.tagline !== undefined ? String(args.tagline) : undefined,
                        bio: args.bio !== undefined ? String(args.bio) : undefined,
                        location: args.location !== undefined ? String(args.location) : undefined,
                        avatarUrl: args.avatarUrl !== undefined ? String(args.avatarUrl) : undefined,
                        bannerUrl: args.bannerUrl !== undefined ? String(args.bannerUrl) : undefined,
                        interests: Array.isArray(args.interests)
                            ? args.interests.map(String)
                            : undefined,
                        theme: args.theme ? String(args.theme) : undefined,
                        atprotoHandle: args.atprotoHandle !== undefined ? String(args.atprotoHandle) : undefined,
                        publishSettings: Object.keys(publishUpdates).length > 0
                            ? { ...current.publishSettings, ...publishUpdates }
                            : undefined,
                    });
                    summary = `Updated profile for ${ctx.persona.displayName}`;
                    break;
                }
                case 'webring_list_items': {
                    const ctx = this.resolveContext(args);
                    let items = ctx.db.getItems();
                    if (typeof args.type === 'string' && args.type) {
                        items = items.filter((i) => i.type === args.type);
                    }
                    if (typeof args.tag === 'string' && args.tag) {
                        const needle = args.tag.toLowerCase().replace(/^#/, '');
                        items = items.filter((i) => i.tags.some((t) => t.toLowerCase() === needle));
                    }
                    resultData = { count: items.length, items };
                    summary = `Listed ${items.length} item(s)`;
                    break;
                }
                case 'webring_create_post': {
                    const ctx = this.resolveContext(args);
                    const created = ctx.db.createItem({
                        type: 'post',
                        title: args.title ? String(args.title) : undefined,
                        commentary: String(args.commentary || ''),
                        mediaUrl: args.mediaUrl ? String(args.mediaUrl) : undefined,
                        category: 'status',
                        tags: Array.isArray(args.tags) ? args.tags.map(String) : ['wall', 'webring'],
                    });
                    resultData = created;
                    summary = `Published Wall Post "${created.title}"`;
                    break;
                }
                case 'webring_interact_with_url': {
                    const ctx = this.resolveContext(args);
                    const type = args.type || 'like';
                    const created = ctx.db.createItem({
                        type,
                        targetUrl: String(args.targetUrl || ''),
                        commentary: String(args.commentary || ''),
                        title: args.title ? String(args.title) : undefined,
                        targetAuthorName: args.targetAuthorName
                            ? String(args.targetAuthorName)
                            : undefined,
                        targetAuthorUrl: args.targetAuthorUrl
                            ? String(args.targetAuthorUrl)
                            : undefined,
                        category: args.category ? String(args.category) : type === 'comment' ? 'comment' : 'general',
                        rating: typeof args.rating === 'number' ? args.rating : undefined,
                        tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
                    });
                    resultData = created;
                    summary = `Published ${type} on ${created.targetUrl}`;
                    break;
                }
                case 'webring_delete_item': {
                    const ctx = this.resolveContext(args);
                    const itemId = String(args.itemId || '');
                    ctx.db.deleteItem(itemId);
                    resultData = { deleted: true, itemId };
                    summary = `Deleted item ${itemId}`;
                    break;
                }
                case 'webring_list_albums': {
                    const ctx = this.resolveContext(args);
                    const albums = ctx.db.getAlbums();
                    resultData = { count: albums.length, albums };
                    summary = `Listed ${albums.length} photo album(s)`;
                    break;
                }
                case 'webring_create_album': {
                    const ctx = this.resolveContext(args);
                    const album = ctx.db.createAlbum({
                        title: String(args.title || 'Untitled Album'),
                        description: args.description ? String(args.description) : undefined,
                        coverUrl: args.coverUrl ? String(args.coverUrl) : undefined,
                        tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
                    });
                    resultData = album;
                    summary = `Created photo album "${album.title}"`;
                    break;
                }
                case 'webring_add_photo': {
                    const ctx = this.resolveContext(args);
                    const albumId = String(args.albumId || '');
                    const urlOrPath = String(args.urlOrLocalPath || '');
                    let photoUrl = urlOrPath;
                    let thumbUrl = urlOrPath;
                    let localSourcePath = '';
                    if (!/^https?:\/\//i.test(urlOrPath) && fs.existsSync(urlOrPath)) {
                        const imported = ctx.mediaProcessor.importLocalPhoto(urlOrPath, albumId);
                        photoUrl = imported.relativeUrl;
                        thumbUrl = imported.thumbRelativeUrl;
                        localSourcePath = imported.localFullPath;
                    }
                    const photo = ctx.db.addPhotoToAlbum({
                        albumId,
                        url: photoUrl,
                        thumbUrl,
                        localSourcePath,
                        caption: args.caption ? String(args.caption) : undefined,
                        tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
                    });
                    resultData = photo;
                    summary = `Added photo "${photo.caption || photo.id}" to album ${albumId}`;
                    break;
                }
                case 'webring_delete_album': {
                    const ctx = this.resolveContext(args);
                    const albumId = String(args.albumId || '');
                    ctx.db.deleteAlbum(albumId);
                    resultData = { deleted: true, albumId };
                    summary = `Deleted album ${albumId}`;
                    break;
                }
                case 'webring_delete_photo': {
                    const ctx = this.resolveContext(args);
                    const photoId = String(args.photoId || '');
                    ctx.db.deletePhoto(photoId);
                    resultData = { deleted: true, photoId };
                    summary = `Deleted photo ${photoId}`;
                    break;
                }
                case 'webring_list_friends': {
                    const ctx = this.resolveContext(args);
                    const friends = ctx.db.getFriends();
                    resultData = { count: friends.length, friends };
                    summary = `Listed ${friends.length} friend(s) in local ring`;
                    break;
                }
                case 'webring_add_friend': {
                    const ctx = this.resolveContext(args);
                    const friend = ctx.db.addOrUpdateFriend({
                        siteUrl: String(args.siteUrl || ''),
                        displayName: String(args.displayName || ''),
                        visibility: args.visibility === 'public' ? 'public' : 'private',
                        relationship: Array.isArray(args.relationship)
                            ? args.relationship.map(String)
                            : ['friend'],
                        bio: args.bio ? String(args.bio) : undefined,
                        avatarUrl: args.avatarUrl ? String(args.avatarUrl) : undefined,
                    });
                    resultData = friend;
                    summary = `Added/updated friend ${friend.displayName} (${friend.visibility})`;
                    break;
                }
                case 'webring_set_friend_visibility': {
                    const ctx = this.resolveContext(args);
                    const friendId = String(args.friendId || '');
                    const visibility = args.visibility === 'public' ? 'public' : 'private';
                    const updated = ctx.db.setFriendVisibility(friendId, visibility);
                    resultData = updated;
                    summary = `Set friend ${friendId} visibility to ${visibility}`;
                    break;
                }
                case 'webring_delete_friend': {
                    const ctx = this.resolveContext(args);
                    const friendId = String(args.friendId || '');
                    ctx.db.deleteFriend(friendId);
                    resultData = { deleted: true, friendId };
                    summary = `Removed friend ${friendId}`;
                    break;
                }
                case 'webring_crawl_friend': {
                    const ctx = this.resolveContext(args);
                    const siteUrl = String(args.siteUrl || '');
                    const localDirOverride = args.localDirOverride
                        ? String(args.localDirOverride)
                        : undefined;
                    const res = await ctx.ringCrawler.crawlFriendSite(siteUrl, localDirOverride);
                    resultData = res;
                    summary = `Crawled ${siteUrl} (verified=${res.verifiedSignature}, items=${res.itemsIndexed})`;
                    break;
                }
                case 'webring_crawl_all_friends': {
                    const ctx = this.resolveContext(args);
                    const results = await ctx.ringCrawler.crawlAllFriends();
                    resultData = {
                        crawledCount: results.length,
                        results,
                        totalEndorsements: ctx.db.getEndorsements().length,
                        totalFeedEntries: ctx.db.getNetworkFeed().length,
                    };
                    summary = `Crawled all ${results.length} friend(s) in ring`;
                    break;
                }
                case 'webring_get_neighborhood_feed': {
                    const ctx = this.resolveContext(args);
                    let feed = ctx.db.getNetworkFeed();
                    if (typeof args.entryType === 'string' && args.entryType) {
                        feed = feed.filter((e) => e.entryType === args.entryType);
                    }
                    if (typeof args.friendSiteUrl === 'string' && args.friendSiteUrl) {
                        feed = feed.filter((e) => e.friendSiteUrl.toLowerCase().includes(String(args.friendSiteUrl).toLowerCase()));
                    }
                    if (args.verifiedOnly === true) {
                        feed = feed.filter((e) => e.verifiedSignature);
                    }
                    const limit = typeof args.limit === 'number' && args.limit > 0 ? args.limit : 50;
                    feed = feed.slice(0, limit);
                    resultData = { count: feed.length, entries: feed };
                    summary = `Retrieved ${feed.length} Neighborhood Feed entries`;
                    break;
                }
                case 'webring_get_endorsements': {
                    const ctx = this.resolveContext(args);
                    const endorsements = ctx.db.getEndorsements();
                    resultData = { count: endorsements.length, endorsements };
                    summary = `Retrieved ${endorsements.length} peer endorsement(s)/comment(s)`;
                    break;
                }
                case 'webring_sync_webring_hub': {
                    const ctx = this.resolveContext(args);
                    const hubUrl = String(args.hubUrl || '');
                    const synced = await ctx.ringCrawler.syncWebringHub(hubUrl);
                    resultData = synced;
                    summary = `Synced webring hub "${synced.name}" (${synced.memberCount} members)`;
                    break;
                }
                case 'webring_export_static_site': {
                    const ctx = this.resolveContext(args);
                    const profile = ctx.db.getProfile();
                    const defaultFolder = ctx.persona.id === 'default'
                        ? 'exported-profile-site'
                        : `exported-profile-site-${ctx.persona.id}`;
                    const outDir = (typeof args.targetDir === 'string' && args.targetDir.trim()) ||
                        profile.publishSettings?.exportPath ||
                        path.join(this.userDataDir, defaultFolder);
                    const pubRes = ctx.sitePublisher.publishToLocalDirectory(outDir);
                    if (pubRes.success) {
                        ctx.db.updateProfile({
                            publishSettings: { ...profile.publishSettings, exportPath: outDir },
                        });
                    }
                    resultData = pubRes;
                    summary = `Exported signed static site to ${outDir}`;
                    break;
                }
                case 'webring_start_preview_server': {
                    const ctx = this.resolveContext(args);
                    const previewDir = path.join(this.userDataDir, `test-preview-site-${ctx.persona.id}`);
                    const res = await this.previewServer.runTestExportAndServe(ctx.siteGenerator, previewDir);
                    resultData = res;
                    summary = `Started local preview server at ${res.previewUrl}`;
                    break;
                }
                case 'webring_get_addons': {
                    const ctx = this.resolveContext(args);
                    const p = ctx.db.getProfile();
                    const ps = p.publishSettings;
                    resultData = {
                        personaId: ctx.persona.id,
                        displayName: p.displayName,
                        analyticsAddon: p.analyticsAddon || {
                            enabled: Boolean(ps.analyticsEnabled),
                            measurementId: ps.analyticsMeasurementId || '',
                            validMeasurementId: (0, schema_1.isValidGa4MeasurementId)(ps.analyticsMeasurementId),
                            respectDoNotTrack: ps.analyticsRespectDnt !== false,
                            anonymizeIp: ps.analyticsAnonymizeIp !== false,
                            trackRingInteractions: ps.analyticsTrackRingInteractions !== false,
                        },
                        adsAddon: p.adsAddon || {
                            enabled: Boolean(ps.adsEnabled),
                            publisherId: ps.adsPublisherId || '',
                            normalizedPublisherId: (0, schema_1.normalizeAdSensePublisherId)(ps.adsPublisherId),
                            enableAutoAds: ps.adsEnableAutoAds !== false,
                            generateAdsTxt: ps.adsGenerateAdsTxt !== false,
                            headerSlotId: ps.adsHeaderSlotId || '',
                            inFeedSlotId: ps.adsInFeedSlotId || '',
                            footerSlotId: ps.adsFooterSlotId || '',
                        },
                        commentAddon: p.commentConfig || {
                            provider: ps.commentProvider || 'none',
                            giscusRepo: ps.giscusRepo || '',
                        },
                    };
                    summary = `Inspected profile add-ons for ${p.displayName}`;
                    break;
                }
                case 'webring_configure_analytics_addon': {
                    const ctx = this.resolveContext(args);
                    const current = ctx.db.getProfile();
                    const ps = current.publishSettings;
                    if (args.clear === true) {
                        const cleared = ctx.db.updateProfile({
                            publishSettings: {
                                ...ps,
                                analyticsEnabled: false,
                                analyticsMeasurementId: '',
                                analyticsRespectDnt: true,
                                analyticsAnonymizeIp: true,
                                analyticsTrackRingInteractions: true,
                            },
                        });
                        resultData = { cleared: true, analyticsAddon: cleared.analyticsAddon || null };
                        summary = `Cleared Google Analytics (GA4) add-on for ${ctx.persona.displayName}`;
                        break;
                    }
                    const nextMeasurementId = args.measurementId !== undefined
                        ? String(args.measurementId).trim().toUpperCase()
                        : ps.analyticsMeasurementId || '';
                    if (nextMeasurementId && !(0, schema_1.isValidGa4MeasurementId)(nextMeasurementId)) {
                        throw new Error(`Invalid GA4 Measurement ID "${nextMeasurementId}". Expected format: G-XXXXXXXXXX.`);
                    }
                    const nextEnabled = args.enabled !== undefined ? Boolean(args.enabled) : Boolean(ps.analyticsEnabled);
                    const updated = ctx.db.updateProfile({
                        publishSettings: {
                            ...ps,
                            analyticsEnabled: nextEnabled,
                            analyticsMeasurementId: nextMeasurementId,
                            analyticsRespectDnt: args.respectDoNotTrack !== undefined
                                ? Boolean(args.respectDoNotTrack)
                                : ps.analyticsRespectDnt !== false,
                            analyticsAnonymizeIp: args.anonymizeIp !== undefined
                                ? Boolean(args.anonymizeIp)
                                : ps.analyticsAnonymizeIp !== false,
                            analyticsTrackRingInteractions: args.trackRingInteractions !== undefined
                                ? Boolean(args.trackRingInteractions)
                                : ps.analyticsTrackRingInteractions !== false,
                        },
                    });
                    resultData = {
                        enabled: Boolean(updated.analyticsAddon?.enabled),
                        analyticsAddon: updated.analyticsAddon || null,
                    };
                    summary = `Configured Google Analytics (GA4) add-on (${nextEnabled ? nextMeasurementId : 'disabled'}) for ${ctx.persona.displayName}`;
                    break;
                }
                case 'webring_configure_ads_addon': {
                    const ctx = this.resolveContext(args);
                    const current = ctx.db.getProfile();
                    const ps = current.publishSettings;
                    if (args.clear === true) {
                        const cleared = ctx.db.updateProfile({
                            publishSettings: {
                                ...ps,
                                adsEnabled: false,
                                adsPublisherId: '',
                                adsEnableAutoAds: true,
                                adsGenerateAdsTxt: true,
                                adsHeaderSlotId: '',
                                adsInFeedSlotId: '',
                                adsFooterSlotId: '',
                            },
                        });
                        resultData = { cleared: true, adsAddon: cleared.adsAddon || null };
                        summary = `Cleared Google AdSense add-on for ${ctx.persona.displayName}`;
                        break;
                    }
                    const rawPubId = args.publisherId !== undefined
                        ? String(args.publisherId).trim()
                        : ps.adsPublisherId || '';
                    const normalizedPubId = rawPubId ? (0, schema_1.normalizeAdSensePublisherId)(rawPubId) : '';
                    if (rawPubId && !normalizedPubId) {
                        throw new Error(`Invalid AdSense Publisher ID "${rawPubId}". Expected format: ca-pub-1234567890123456.`);
                    }
                    const checkSlot = (val, fallback, label) => {
                        if (val === undefined)
                            return fallback;
                        const s = String(val).trim();
                        if (s && !(0, schema_1.isValidAdSlotId)(s)) {
                            throw new Error(`Invalid ${label} "${s}". Expected numeric AdSense slot ID.`);
                        }
                        return s;
                    };
                    const nextEnabled = args.enabled !== undefined ? Boolean(args.enabled) : Boolean(ps.adsEnabled);
                    const updated = ctx.db.updateProfile({
                        publishSettings: {
                            ...ps,
                            adsEnabled: nextEnabled,
                            adsPublisherId: normalizedPubId,
                            adsEnableAutoAds: args.enableAutoAds !== undefined
                                ? Boolean(args.enableAutoAds)
                                : ps.adsEnableAutoAds !== false,
                            adsGenerateAdsTxt: args.generateAdsTxt !== undefined
                                ? Boolean(args.generateAdsTxt)
                                : ps.adsGenerateAdsTxt !== false,
                            adsHeaderSlotId: checkSlot(args.headerSlotId, ps.adsHeaderSlotId || '', 'headerSlotId'),
                            adsInFeedSlotId: checkSlot(args.inFeedSlotId, ps.adsInFeedSlotId || '', 'inFeedSlotId'),
                            adsFooterSlotId: checkSlot(args.footerSlotId, ps.adsFooterSlotId || '', 'footerSlotId'),
                        },
                    });
                    resultData = {
                        enabled: Boolean(updated.adsAddon?.enabled),
                        adsAddon: updated.adsAddon || null,
                    };
                    summary = `Configured Google AdSense add-on (${nextEnabled ? normalizedPubId : 'disabled'}) for ${ctx.persona.displayName}`;
                    break;
                }
                default:
                    throw new Error(`Unknown MCP tool: ${name}`);
            }
            this.recordActivity('tools/call', summary, true, name);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(resultData, null, 2),
                    },
                ],
                data: resultData,
            };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.recordActivity('tools/call', `Error in ${name}: ${msg}`, false, name);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({ error: msg }, null, 2),
                    },
                ],
                isError: true,
            };
        }
    }
    readResource(uri) {
        const ctx = this.personaManager.getActiveContext();
        let payload;
        switch (uri) {
            case 'webring://personas':
                payload = this.personaManager.listPersonas();
                break;
            case 'webring://active/bundle':
                payload = ctx.db.buildSignedSiteBundle();
                break;
            case 'webring://active/feed':
                payload = ctx.db.getNetworkFeed();
                break;
            case 'webring://active/endorsements':
                payload = ctx.db.getEndorsements();
                break;
            case 'webring://active/addons': {
                const p = ctx.db.getProfile();
                payload = {
                    personaId: ctx.persona.id,
                    analyticsAddon: p.analyticsAddon || null,
                    adsAddon: p.adsAddon || null,
                    commentConfig: p.commentConfig || null,
                };
                break;
            }
            default:
                throw new Error(`Unknown MCP resource URI: ${uri}`);
        }
        this.recordActivity('resources/read', `Read resource ${uri}`, true);
        return {
            contents: [
                {
                    uri,
                    mimeType: 'application/json',
                    text: JSON.stringify(payload, null, 2),
                },
            ],
        };
    }
    getPromptTemplate(name, args) {
        switch (name) {
            case 'daily-ring-digest': {
                const personaClause = args?.personaId
                    ? `First switch to persona "${args.personaId}" using webring_switch_persona.`
                    : 'Use the currently active persona.';
                return {
                    description: 'Crawl all friends in the ring and prepare a daily social digest.',
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `${personaClause}\n1. Call webring_crawl_all_friends to pull the latest static JSON feeds from my friend ring.\n2. Call webring_get_neighborhood_feed and webring_get_endorsements.\n3. Summarize any new Wall Posts, photos, or recommendations from my friends, highlight any new comments or likes on my own posts, and ask if I'd like to post a reply or like using webring_interact_with_url.`,
                            },
                        },
                    ],
                };
            }
            case 'publish-wall-update': {
                const topic = String(args?.topic || 'a status update');
                const tags = String(args?.tags || 'indieweb, webring');
                return {
                    description: 'Draft, sign, and export a new Wall Post.',
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Please read my profile voice via webring_get_profile, then publish a new Wall Post about "${topic}" (tags: ${tags}) using webring_create_post, and finally export my signed static website using webring_export_static_site.`,
                            },
                        },
                    ],
                };
            }
            case 'opsec-privacy-audit': {
                return {
                    description: 'Audit cross-persona OPSEC, privacy shield flags, and friend TOFU keys.',
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `Please audit my Webring Studio security and privacy posture:\n1. Call webring_list_personas and check if any personas share the same domain hostname.\n2. Call webring_get_profile and webring_get_addons to inspect my Social Graph Privacy Shield settings and optional Analytics/AdSense add-ons.\n3. Call webring_list_friends and check if any friend has keyStatus === "changed" (TOFU key mismatch warning).`,
                            },
                        },
                    ],
                };
            }
            default:
                throw new Error(`Unknown MCP prompt: ${name}`);
        }
    }
    /**
     * Handles any incoming JSON-RPC 2.0 request or notification according to the MCP specification.
     * Returns `null` for notifications (which have no `id`).
     */
    async handleJsonRpc(request) {
        const { id, method, params } = request;
        // Notifications (no id) do not receive a response
        if (id === undefined) {
            return null;
        }
        try {
            switch (method) {
                case 'initialize':
                    this.recordActivity('initialize', 'MCP Client initialized session', true);
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: {
                            protocolVersion: exports.MCP_PROTOCOL_VERSION,
                            capabilities: {
                                tools: { listChanged: false },
                                resources: { subscribe: false, listChanged: false },
                                prompts: { listChanged: false },
                            },
                            serverInfo: {
                                name: 'webring-studio-mcp',
                                version: '1.0.0',
                            },
                        },
                    };
                case 'ping':
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: {},
                    };
                case 'tools/list':
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: {
                            tools: this.getTools(),
                        },
                    };
                case 'tools/call': {
                    const toolName = String(params?.name || '');
                    const toolArgs = params?.arguments || {};
                    const callResult = await this.executeToolCall(toolName, toolArgs);
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: {
                            content: callResult.content,
                            isError: callResult.isError,
                        },
                    };
                }
                case 'resources/list':
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: {
                            resources: this.getResources(),
                        },
                    };
                case 'resources/read': {
                    const uri = String(params?.uri || '');
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: this.readResource(uri),
                    };
                }
                case 'prompts/list':
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: {
                            prompts: this.getPrompts(),
                        },
                    };
                case 'prompts/get': {
                    const promptName = String(params?.name || '');
                    const promptArgs = params?.arguments || {};
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: this.getPromptTemplate(promptName, promptArgs),
                    };
                }
                default:
                    return {
                        jsonrpc: '2.0',
                        id,
                        error: {
                            code: -32601,
                            message: `Method not found: ${method}`,
                        },
                    };
            }
        }
        catch (err) {
            return {
                jsonrpc: '2.0',
                id,
                error: {
                    code: -32603,
                    message: err instanceof Error ? err.message : String(err),
                },
            };
        }
    }
}
exports.WebringMcpServer = WebringMcpServer;
