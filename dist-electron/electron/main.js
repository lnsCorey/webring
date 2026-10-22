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
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const database_1 = require("./db/database");
const siteGenerator_1 = require("./services/siteGenerator");
const personaManager_1 = require("./services/personaManager");
const localPreviewServer_1 = require("./services/localPreviewServer");
const mcpServer_1 = require("./mcp/mcpServer");
const mcpHttpServer_1 = require("./mcp/mcpHttpServer");
const schema_1 = require("../src/shared/schema");
let mainWindow = null;
let personaManager;
let localPreviewServer;
let webringMcpServer;
let mcpHttpServer;
async function initServices() {
    const userDataDir = electron_1.app.getPath('userData');
    personaManager = new personaManager_1.PersonaManager(userDataDir);
    localPreviewServer = new localPreviewServer_1.LocalPreviewServer();
    webringMcpServer = new mcpServer_1.WebringMcpServer(personaManager, userDataDir, localPreviewServer, (entry) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('studio:mcp-activity', entry);
        }
    });
    mcpHttpServer = new mcpHttpServer_1.McpHttpServer(webringMcpServer);
    await mcpHttpServer.start(0);
}
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1380,
        height: 900,
        minWidth: 1024,
        minHeight: 700,
        title: 'Webring Studio — Decentralized Profile & Ring Manager',
        backgroundColor: '#090d16',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    if (devServerUrl) {
        mainWindow.loadURL(devServerUrl);
    }
    else {
        const indexHtmlPath = path.join(__dirname, '../../dist/index.html');
        mainWindow.loadFile(indexHtmlPath);
    }
}
function handleDeepLinkUrl(rawUri) {
    const parsed = (0, schema_1.parseWebringUri)(rawUri);
    if (parsed && mainWindow) {
        mainWindow.webContents.send('webring:deep-link', parsed);
        if (mainWindow.isMinimized())
            mainWindow.restore();
        mainWindow.focus();
    }
}
// Register custom protocol `webring://`
if (process.defaultApp) {
    if (process.argv.length >= 2) {
        electron_1.app.setAsDefaultProtocolClient('webring', process.execPath, [path.resolve(process.argv[1])]);
    }
}
else {
    electron_1.app.setAsDefaultProtocolClient('webring');
}
const gotTheLock = electron_1.app.requestSingleInstanceLock();
if (!gotTheLock) {
    electron_1.app.quit();
}
else {
    electron_1.app.on('second-instance', (_event, commandLine) => {
        const uriArg = commandLine.find((arg) => arg.startsWith('webring://'));
        if (uriArg) {
            handleDeepLinkUrl(uriArg);
        }
        if (mainWindow) {
            if (mainWindow.isMinimized())
                mainWindow.restore();
            mainWindow.focus();
        }
    });
    electron_1.app.whenReady().then(async () => {
        await initServices();
        registerIpcHandlers();
        createWindow();
        // Check if launched with a webring:// URI
        const startupUri = process.argv.find((arg) => arg.startsWith('webring://'));
        if (startupUri) {
            setTimeout(() => handleDeepLinkUrl(startupUri), 1000);
        }
    });
}
electron_1.app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLinkUrl(url);
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
function registerIpcHandlers() {
    electron_1.ipcMain.handle('studio:get-bundle', () => {
        const ctx = personaManager.getActiveContext();
        const bundle = ctx.db.buildSignedSiteBundle();
        const personaList = personaManager.listPersonas();
        return {
            activePersonaId: personaList.activePersonaId,
            personas: personaList.personas,
            bundle,
            allFriends: ctx.db.getFriends(),
            allEndorsements: ctx.db.getEndorsements(),
            profileWithSettings: ctx.db.getProfile(),
            networkFeed: ctx.db.getNetworkFeed(),
            previewHtml: ctx.siteGenerator.buildStandaloneProfileHtml(bundle),
        };
    });
    electron_1.ipcMain.handle('studio:list-personas', () => {
        return personaManager.listPersonas();
    });
    electron_1.ipcMain.handle('studio:create-persona', (_e, input) => {
        return personaManager.createPersona(input);
    });
    electron_1.ipcMain.handle('studio:switch-persona', (_e, personaId) => {
        return personaManager.switchPersona(personaId);
    });
    electron_1.ipcMain.handle('studio:update-persona-label', (_e, personaId, label) => {
        return personaManager.updatePersonaLabel(personaId, label);
    });
    electron_1.ipcMain.handle('studio:delete-persona', (_e, personaId) => {
        return personaManager.deletePersona(personaId);
    });
    electron_1.ipcMain.handle('studio:update-profile', (_e, updates) => {
        return personaManager.getActiveContext().db.updateProfile(updates);
    });
    electron_1.ipcMain.handle('studio:create-album', (_e, input) => {
        return personaManager.getActiveContext().db.createAlbum(input);
    });
    electron_1.ipcMain.handle('studio:delete-album', (_e, albumId) => {
        personaManager.getActiveContext().db.deleteAlbum(albumId);
        return { ok: true };
    });
    electron_1.ipcMain.handle('studio:add-photo', (_e, input) => {
        return personaManager.getActiveContext().db.addPhotoToAlbum(input);
    });
    electron_1.ipcMain.handle('studio:pick-and-import-photo', async (_e, albumId) => {
        if (!mainWindow)
            return null;
        const result = await electron_1.dialog.showOpenDialog(mainWindow, {
            title: 'Select Photo for Album',
            properties: ['openFile'],
            filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'] }],
        });
        if (result.canceled || result.filePaths.length === 0)
            return null;
        const imported = personaManager.getActiveContext().mediaProcessor.importLocalPhoto(result.filePaths[0], albumId);
        return imported;
    });
    electron_1.ipcMain.handle('studio:delete-photo', (_e, photoId) => {
        personaManager.getActiveContext().db.deletePhoto(photoId);
        return { ok: true };
    });
    electron_1.ipcMain.handle('studio:create-item', (_e, input) => {
        return personaManager.getActiveContext().db.createItem(input);
    });
    electron_1.ipcMain.handle('studio:delete-item', (_e, itemId) => {
        personaManager.getActiveContext().db.deleteItem(itemId);
        return { ok: true };
    });
    electron_1.ipcMain.handle('studio:add-friend', (_e, input) => {
        return personaManager.getActiveContext().db.addOrUpdateFriend(input);
    });
    electron_1.ipcMain.handle('studio:set-friend-visibility', (_e, friendId, visibility) => {
        return personaManager.getActiveContext().db.setFriendVisibility(friendId, visibility);
    });
    electron_1.ipcMain.handle('studio:delete-friend', (_e, friendId) => {
        personaManager.getActiveContext().db.deleteFriend(friendId);
        return { ok: true };
    });
    electron_1.ipcMain.handle('studio:add-webring', (_e, input) => {
        return personaManager.getActiveContext().db.addWebring(input);
    });
    electron_1.ipcMain.handle('studio:update-webring', (_e, ringId, updates) => {
        return personaManager.getActiveContext().db.updateWebring(ringId, updates);
    });
    electron_1.ipcMain.handle('studio:delete-webring', (_e, ringId) => {
        personaManager.getActiveContext().db.deleteWebring(ringId);
        return { ok: true };
    });
    electron_1.ipcMain.handle('studio:crawl-friend', async (_e, siteUrl, localDirOverride) => {
        return await personaManager.getActiveContext().ringCrawler.crawlFriendSite(siteUrl, localDirOverride);
    });
    electron_1.ipcMain.handle('studio:crawl-all-friends', async () => {
        return await personaManager.getActiveContext().ringCrawler.crawlAllFriends();
    });
    electron_1.ipcMain.handle('studio:sync-webring-hub', async (_e, hubUrl) => {
        return await personaManager.getActiveContext().ringCrawler.syncWebringHub(hubUrl);
    });
    electron_1.ipcMain.handle('studio:choose-export-folder', async () => {
        if (!mainWindow)
            return null;
        const res = await electron_1.dialog.showOpenDialog(mainWindow, {
            title: 'Choose Export Folder for Static Profile Website',
            properties: ['openDirectory', 'createDirectory'],
        });
        if (res.canceled || res.filePaths.length === 0)
            return null;
        return res.filePaths[0];
    });
    electron_1.ipcMain.handle('studio:export-local', (_e, targetDir) => {
        const ctx = personaManager.getActiveContext();
        const profile = ctx.db.getProfile();
        const defaultExportFolder = ctx.persona.id === 'default'
            ? 'exported-profile-site'
            : `exported-profile-site-${ctx.persona.id}`;
        const outDir = targetDir ||
            profile.publishSettings?.exportPath ||
            path.join(electron_1.app.getPath('userData'), defaultExportFolder);
        const result = ctx.sitePublisher.publishToLocalDirectory(outDir);
        if (result.success) {
            ctx.db.updateProfile({ publishSettings: { ...profile.publishSettings, exportPath: outDir } });
        }
        return result;
    });
    electron_1.ipcMain.handle('studio:test-export-preview', async (_e, openInBrowser) => {
        const ctx = personaManager.getActiveContext();
        const previewDir = path.join(electron_1.app.getPath('userData'), `test-preview-site-${ctx.persona.id}`);
        const result = await localPreviewServer.runTestExportAndServe(ctx.siteGenerator, previewDir);
        if (openInBrowser && result.previewUrl) {
            await electron_1.shell.openExternal(result.previewUrl);
        }
        return result;
    });
    electron_1.ipcMain.handle('studio:open-external', async (_e, url) => {
        if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
            await electron_1.shell.openExternal(url);
        }
        return { ok: true };
    });
    electron_1.ipcMain.handle('studio:publish-remote', async (_e, settings) => {
        const ctx = personaManager.getActiveContext();
        const currentProfile = ctx.db.getProfile();
        ctx.db.updateProfile({
            publishSettings: {
                ...currentProfile.publishSettings,
                ...(settings || {}),
            },
        });
        const stagingDir = path.join(electron_1.app.getPath('temp'), `webring-studio-staging-${ctx.persona.id}`);
        if (fs.existsSync(stagingDir)) {
            fs.rmSync(stagingDir, { recursive: true, force: true });
        }
        return await ctx.sitePublisher.publishToRemoteHost(settings, stagingDir);
    });
    electron_1.ipcMain.handle('studio:publish-github', async (_e, settings) => {
        const ctx = personaManager.getActiveContext();
        const currentProfile = ctx.db.getProfile();
        ctx.db.updateProfile({
            publishSettings: {
                ...currentProfile.publishSettings,
                ...(settings || {}),
            },
        });
        const stagingDir = path.join(electron_1.app.getPath('temp'), `webring-studio-github-staging-${ctx.persona.id}`);
        if (fs.existsSync(stagingDir)) {
            fs.rmSync(stagingDir, { recursive: true, force: true });
        }
        return await ctx.sitePublisher.publishToGitHubPages(settings, stagingDir);
    });
    electron_1.ipcMain.handle('studio:check-github-repo', async (_e, settings) => {
        const ctx = personaManager.getActiveContext();
        return await ctx.sitePublisher.checkGitHubRepo(settings);
    });
    electron_1.ipcMain.handle('studio:open-path', async (_e, targetPath) => {
        await electron_1.shell.openPath(targetPath);
        return { ok: true };
    });
    electron_1.ipcMain.handle('studio:simulate-peer-site', async () => {
        const ctx = personaManager.getActiveContext();
        // Creates a local simulated friend's published static site on disk and crawls it!
        const peerDir = path.join(electron_1.app.getPath('userData'), 'simulated-peer-maya');
        const peerDb = new database_1.StudioDatabase(peerDir, 'maya.sqlite');
        const myProfile = ctx.db.getProfile();
        const myBundle = ctx.db.buildSignedSiteBundle();
        peerDb.updateProfile({
            siteUrl: 'https://maya.indiering.social',
            handle: 'maya.indiering.social',
            displayName: 'Maya Lin',
            tagline: 'Sound designer, botanical illustrator & modular synth tinkerer',
            bio: 'Publishing static JSON feeds from my studio.',
        });
        // Have Maya publish a Wall Post AND comment/like one of OUR items or photos so the user can see live threads!
        const targetItemUrl = myBundle.items.items.find((i) => i.type === 'post')?.canonicalUrl ||
            myBundle.items.items[0]?.canonicalUrl ||
            myBundle.albums.albums[0]?.photos[0]?.canonicalUrl ||
            `${myProfile.siteUrl}/api/profile.json`;
        peerDb.createItem({
            type: 'post',
            title: 'Late-Night Buchla & Tape Loop Session',
            category: 'status',
            commentary: 'Just finished splicing a 14-second quarter-inch tape loop through a spring reverb tank. Posting this directly from my static JSON wall!',
            mediaUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&auto=format&fit=crop&q=80',
            tags: ['synth', 'status', 'webring'],
        });
        peerDb.createItem({
            type: 'comment',
            title: `Reply to ${myProfile.displayName}`,
            targetUrl: targetItemUrl,
            targetAuthorUrl: myProfile.siteUrl,
            targetAuthorName: myProfile.displayName,
            category: 'comment',
            commentary: 'Love this post! So cool seeing wall posts and comments federate across our static sites without a central server.',
            tags: ['reply', 'webring'],
        });
        peerDb.createItem({
            type: 'like',
            title: `Loved ${myProfile.displayName}'s post!`,
            targetUrl: targetItemUrl,
            targetAuthorUrl: myProfile.siteUrl,
            targetAuthorName: myProfile.displayName,
            category: 'photo',
            commentary: 'Such incredible light and atmosphere on this shot! Discovered via our Webring.',
            tags: ['webring', 'endorsed', 'photography'],
        });
        const peerSiteOut = path.join(peerDir, 'public_html');
        const peerGen = new siteGenerator_1.StaticSiteGenerator(peerDb);
        peerGen.generateToDirectory(peerSiteOut);
        peerDb.close();
        return await ctx.ringCrawler.crawlFriendSite('https://maya.indiering.social', peerSiteOut);
    });
    electron_1.ipcMain.handle('studio:get-mcp-info', () => {
        const cliScriptPath = path.resolve(__dirname, 'mcp/cli.js');
        return {
            status: mcpHttpServer.getStatus(),
            cliScriptPath,
            userDataDir: electron_1.app.getPath('userData'),
            tools: webringMcpServer.getTools(),
            resources: webringMcpServer.getResources(),
            prompts: webringMcpServer.getPrompts(),
            activityLog: webringMcpServer.getActivityLog(),
        };
    });
    electron_1.ipcMain.handle('studio:call-mcp-tool', async (_e, toolName, args) => {
        return await webringMcpServer.executeToolCall(toolName, args);
    });
}
