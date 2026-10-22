import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { StudioDatabase } from './db/database';
import { StaticSiteGenerator } from './services/siteGenerator';
import { PersonaManager } from './services/personaManager';
import { LocalPreviewServer } from './services/localPreviewServer';
import { WebringMcpServer } from './mcp/mcpServer';
import { McpHttpServer } from './mcp/mcpHttpServer';
import { CreatePersonaInput, parseWebringUri } from '../src/shared/schema';

let mainWindow: BrowserWindow | null = null;
let personaManager: PersonaManager;
let localPreviewServer: LocalPreviewServer;
let webringMcpServer: WebringMcpServer;
let mcpHttpServer: McpHttpServer;

async function initServices() {
  const userDataDir = app.getPath('userData');
  personaManager = new PersonaManager(userDataDir);
  localPreviewServer = new LocalPreviewServer();
  webringMcpServer = new WebringMcpServer(
    personaManager,
    userDataDir,
    localPreviewServer,
    (entry) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('studio:mcp-activity', entry);
      }
    }
  );
  mcpHttpServer = new McpHttpServer(webringMcpServer);
  await mcpHttpServer.start(0);
}

function createWindow() {
  mainWindow = new BrowserWindow({
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
  } else {
    const indexHtmlPath = path.join(__dirname, '../../dist/index.html');
    mainWindow.loadFile(indexHtmlPath);
  }
}

function handleDeepLinkUrl(rawUri: string) {
  const parsed = parseWebringUri(rawUri);
  if (parsed && mainWindow) {
    mainWindow.webContents.send('webring:deep-link', parsed);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
}

// Register custom protocol `webring://`
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('webring', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('webring');
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    const uriArg = commandLine.find((arg) => arg.startsWith('webring://'));
    if (uriArg) {
      handleDeepLinkUrl(uriArg);
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
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

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLinkUrl(url);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function registerIpcHandlers() {
  ipcMain.handle('studio:get-bundle', () => {
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

  ipcMain.handle('studio:list-personas', () => {
    return personaManager.listPersonas();
  });

  ipcMain.handle('studio:create-persona', (_e, input: CreatePersonaInput) => {
    return personaManager.createPersona(input);
  });

  ipcMain.handle('studio:switch-persona', (_e, personaId: string) => {
    return personaManager.switchPersona(personaId);
  });

  ipcMain.handle('studio:update-persona-label', (_e, personaId: string, label: string) => {
    return personaManager.updatePersonaLabel(personaId, label);
  });

  ipcMain.handle('studio:delete-persona', (_e, personaId: string) => {
    return personaManager.deletePersona(personaId);
  });

  ipcMain.handle('studio:update-profile', (_e, updates) => {
    return personaManager.getActiveContext().db.updateProfile(updates);
  });

  ipcMain.handle('studio:create-album', (_e, input) => {
    return personaManager.getActiveContext().db.createAlbum(input);
  });

  ipcMain.handle('studio:delete-album', (_e, albumId: string) => {
    personaManager.getActiveContext().db.deleteAlbum(albumId);
    return { ok: true };
  });

  ipcMain.handle('studio:add-photo', (_e, input) => {
    return personaManager.getActiveContext().db.addPhotoToAlbum(input);
  });

  ipcMain.handle('studio:pick-and-import-photo', async (_e, albumId: string) => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Photo for Album',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const imported = personaManager.getActiveContext().mediaProcessor.importLocalPhoto(result.filePaths[0], albumId);
    return imported;
  });

  ipcMain.handle('studio:delete-photo', (_e, photoId: string) => {
    personaManager.getActiveContext().db.deletePhoto(photoId);
    return { ok: true };
  });

  ipcMain.handle('studio:create-item', (_e, input) => {
    return personaManager.getActiveContext().db.createItem(input);
  });

  ipcMain.handle('studio:delete-item', (_e, itemId: string) => {
    personaManager.getActiveContext().db.deleteItem(itemId);
    return { ok: true };
  });

  ipcMain.handle('studio:add-friend', (_e, input) => {
    return personaManager.getActiveContext().db.addOrUpdateFriend(input);
  });

  ipcMain.handle('studio:set-friend-visibility', (_e, friendId: string, visibility: 'private' | 'public') => {
    return personaManager.getActiveContext().db.setFriendVisibility(friendId, visibility);
  });

  ipcMain.handle('studio:delete-friend', (_e, friendId: string) => {
    personaManager.getActiveContext().db.deleteFriend(friendId);
    return { ok: true };
  });

  ipcMain.handle('studio:add-webring', (_e, input) => {
    return personaManager.getActiveContext().db.addWebring(input);
  });

  ipcMain.handle('studio:update-webring', (_e, ringId: string, updates) => {
    return personaManager.getActiveContext().db.updateWebring(ringId, updates);
  });

  ipcMain.handle('studio:delete-webring', (_e, ringId: string) => {
    personaManager.getActiveContext().db.deleteWebring(ringId);
    return { ok: true };
  });

  ipcMain.handle('studio:crawl-friend', async (_e, siteUrl: string, localDirOverride?: string) => {
    return await personaManager.getActiveContext().ringCrawler.crawlFriendSite(siteUrl, localDirOverride);
  });

  ipcMain.handle('studio:crawl-all-friends', async () => {
    return await personaManager.getActiveContext().ringCrawler.crawlAllFriends();
  });

  ipcMain.handle('studio:sync-webring-hub', async (_e, hubUrl: string) => {
    return await personaManager.getActiveContext().ringCrawler.syncWebringHub(hubUrl);
  });

  ipcMain.handle('studio:choose-export-folder', async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose Export Folder for Static Profile Website',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('studio:export-local', (_e, targetDir?: string) => {
    const ctx = personaManager.getActiveContext();
    const profile = ctx.db.getProfile();
    const defaultExportFolder =
      ctx.persona.id === 'default'
        ? 'exported-profile-site'
        : `exported-profile-site-${ctx.persona.id}`;
    const outDir =
      targetDir ||
      profile.publishSettings?.exportPath ||
      path.join(app.getPath('userData'), defaultExportFolder);
    const result = ctx.sitePublisher.publishToLocalDirectory(outDir);
    if (result.success) {
      ctx.db.updateProfile({ publishSettings: { ...profile.publishSettings, exportPath: outDir } });
    }
    return result;
  });

  ipcMain.handle('studio:test-export-preview', async (_e, openInBrowser?: boolean) => {
    const ctx = personaManager.getActiveContext();
    const previewDir = path.join(app.getPath('userData'), `test-preview-site-${ctx.persona.id}`);
    const result = await localPreviewServer.runTestExportAndServe(ctx.siteGenerator, previewDir);
    if (openInBrowser && result.previewUrl) {
      await shell.openExternal(result.previewUrl);
    }
    return result;
  });

  ipcMain.handle('studio:open-external', async (_e, url: string) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      await shell.openExternal(url);
    }
    return { ok: true };
  });

  ipcMain.handle('studio:publish-remote', async (_e, settings) => {
    const ctx = personaManager.getActiveContext();
    const currentProfile = ctx.db.getProfile();
    ctx.db.updateProfile({
      publishSettings: {
        ...currentProfile.publishSettings,
        ...(settings || {}),
      },
    });
    const stagingDir = path.join(app.getPath('temp'), `webring-studio-staging-${ctx.persona.id}`);
    if (fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
    return await ctx.sitePublisher.publishToRemoteHost(settings, stagingDir);
  });

  ipcMain.handle('studio:publish-github', async (_e, settings) => {
    const ctx = personaManager.getActiveContext();
    const currentProfile = ctx.db.getProfile();
    ctx.db.updateProfile({
      publishSettings: {
        ...currentProfile.publishSettings,
        ...(settings || {}),
      },
    });
    const stagingDir = path.join(app.getPath('temp'), `webring-studio-github-staging-${ctx.persona.id}`);
    if (fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
    return await ctx.sitePublisher.publishToGitHubPages(settings, stagingDir);
  });

  ipcMain.handle('studio:check-github-repo', async (_e, settings) => {
    const ctx = personaManager.getActiveContext();
    return await ctx.sitePublisher.checkGitHubRepo(settings);
  });

  ipcMain.handle('studio:open-path', async (_e, targetPath: string) => {
    await shell.openPath(targetPath);
    return { ok: true };
  });

  ipcMain.handle('studio:simulate-peer-site', async () => {
    const ctx = personaManager.getActiveContext();
    // Creates a local simulated friend's published static site on disk and crawls it!
    const peerDir = path.join(app.getPath('userData'), 'simulated-peer-maya');
    const peerDb = new StudioDatabase(peerDir, 'maya.sqlite');
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
    const targetItemUrl =
      myBundle.items.items.find((i) => i.type === 'post')?.canonicalUrl ||
      myBundle.items.items[0]?.canonicalUrl ||
      myBundle.albums.albums[0]?.photos[0]?.canonicalUrl ||
      `${myProfile.siteUrl}/api/profile.json`;

    peerDb.createItem({
      type: 'post',
      title: 'Late-Night Buchla & Tape Loop Session',
      category: 'status',
      commentary:
        'Just finished splicing a 14-second quarter-inch tape loop through a spring reverb tank. Posting this directly from my static JSON wall!',
      mediaUrl:
        'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&auto=format&fit=crop&q=80',
      tags: ['synth', 'status', 'webring'],
    });

    peerDb.createItem({
      type: 'comment',
      title: `Reply to ${myProfile.displayName}`,
      targetUrl: targetItemUrl,
      targetAuthorUrl: myProfile.siteUrl,
      targetAuthorName: myProfile.displayName,
      category: 'comment',
      commentary:
        'Love this post! So cool seeing wall posts and comments federate across our static sites without a central server.',
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
    const peerGen = new StaticSiteGenerator(peerDb);
    peerGen.generateToDirectory(peerSiteOut);
    peerDb.close();

    return await ctx.ringCrawler.crawlFriendSite('https://maya.indiering.social', peerSiteOut);
  });

  ipcMain.handle('studio:get-mcp-info', () => {
    const cliScriptPath = path.resolve(__dirname, 'mcp/cli.js');
    return {
      status: mcpHttpServer.getStatus(),
      cliScriptPath,
      userDataDir: app.getPath('userData'),
      tools: webringMcpServer.getTools(),
      resources: webringMcpServer.getResources(),
      prompts: webringMcpServer.getPrompts(),
      activityLog: webringMcpServer.getActivityLog(),
    };
  });

  ipcMain.handle(
    'studio:call-mcp-tool',
    async (_e, toolName: string, args?: Record<string, unknown>) => {
      return await webringMcpServer.executeToolCall(toolName, args);
    }
  );
}

