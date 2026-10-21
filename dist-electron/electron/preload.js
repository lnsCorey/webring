"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('studioApi', {
    getBundle: () => electron_1.ipcRenderer.invoke('studio:get-bundle'),
    listPersonas: () => electron_1.ipcRenderer.invoke('studio:list-personas'),
    createPersona: (input) => electron_1.ipcRenderer.invoke('studio:create-persona', input),
    switchPersona: (personaId) => electron_1.ipcRenderer.invoke('studio:switch-persona', personaId),
    updatePersonaLabel: (personaId, label) => electron_1.ipcRenderer.invoke('studio:update-persona-label', personaId, label),
    deletePersona: (personaId, deleteFiles) => electron_1.ipcRenderer.invoke('studio:delete-persona', personaId, deleteFiles),
    updateProfile: (updates) => electron_1.ipcRenderer.invoke('studio:update-profile', updates),
    createAlbum: (input) => electron_1.ipcRenderer.invoke('studio:create-album', input),
    deleteAlbum: (albumId) => electron_1.ipcRenderer.invoke('studio:delete-album', albumId),
    addPhoto: (input) => electron_1.ipcRenderer.invoke('studio:add-photo', input),
    pickAndImportPhoto: (albumId) => electron_1.ipcRenderer.invoke('studio:pick-and-import-photo', albumId),
    deletePhoto: (photoId) => electron_1.ipcRenderer.invoke('studio:delete-photo', photoId),
    createItem: (input) => electron_1.ipcRenderer.invoke('studio:create-item', input),
    deleteItem: (itemId) => electron_1.ipcRenderer.invoke('studio:delete-item', itemId),
    addFriend: (input) => electron_1.ipcRenderer.invoke('studio:add-friend', input),
    setFriendVisibility: (friendId, visibility) => electron_1.ipcRenderer.invoke('studio:set-friend-visibility', friendId, visibility),
    deleteFriend: (friendId) => electron_1.ipcRenderer.invoke('studio:delete-friend', friendId),
    addWebring: (input) => electron_1.ipcRenderer.invoke('studio:add-webring', input),
    deleteWebring: (ringId) => electron_1.ipcRenderer.invoke('studio:delete-webring', ringId),
    crawlFriend: (siteUrl, localDirOverride) => electron_1.ipcRenderer.invoke('studio:crawl-friend', siteUrl, localDirOverride),
    crawlAllFriends: () => electron_1.ipcRenderer.invoke('studio:crawl-all-friends'),
    syncWebringHub: (hubUrl) => electron_1.ipcRenderer.invoke('studio:sync-webring-hub', hubUrl),
    chooseExportFolder: () => electron_1.ipcRenderer.invoke('studio:choose-export-folder'),
    exportLocal: (targetDir) => electron_1.ipcRenderer.invoke('studio:export-local', targetDir),
    testExportPreview: (openInBrowser) => electron_1.ipcRenderer.invoke('studio:test-export-preview', openInBrowser),
    openExternal: (url) => electron_1.ipcRenderer.invoke('studio:open-external', url),
    publishRemote: (settings) => electron_1.ipcRenderer.invoke('studio:publish-remote', settings),
    openPath: (targetPath) => electron_1.ipcRenderer.invoke('studio:open-path', targetPath),
    simulatePeerSite: () => electron_1.ipcRenderer.invoke('studio:simulate-peer-site'),
    getMcpInfo: () => electron_1.ipcRenderer.invoke('studio:get-mcp-info'),
    callMcpTool: (toolName, args) => electron_1.ipcRenderer.invoke('studio:call-mcp-tool', toolName, args),
    onMcpActivity: (callback) => {
        const listener = (_event, entry) => callback(entry);
        electron_1.ipcRenderer.on('studio:mcp-activity', listener);
        return () => electron_1.ipcRenderer.removeListener('studio:mcp-activity', listener);
    },
    onDeepLink: (callback) => {
        const listener = (_event, action) => callback(action);
        electron_1.ipcRenderer.on('webring:deep-link', listener);
        return () => electron_1.ipcRenderer.removeListener('webring:deep-link', listener);
    },
});
