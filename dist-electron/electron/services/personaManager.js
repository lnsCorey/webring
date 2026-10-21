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
exports.PersonaManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const database_1 = require("../db/database");
const mediaProcessor_1 = require("./mediaProcessor");
const siteGenerator_1 = require("./siteGenerator");
const publisher_1 = require("./publisher");
const ringCrawler_1 = require("./ringCrawler");
/**
 * Manages strictly compartmentalized online personas.
 * Each persona has its own isolated SQLite file, independent Ed25519 keypair,
 * dedicated media-store folder, and independent static-site export settings.
 */
class PersonaManager {
    userDataDir;
    registryPath;
    registry;
    activeContext = null;
    constructor(userDataDir) {
        this.userDataDir = userDataDir;
        if (!fs.existsSync(userDataDir)) {
            fs.mkdirSync(userDataDir, { recursive: true });
        }
        this.registryPath = path.join(userDataDir, 'personas.json');
        this.registry = this.loadOrInitRegistry();
        this.activatePersona(this.registry.activePersonaId);
    }
    loadOrInitRegistry() {
        if (fs.existsSync(this.registryPath)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(this.registryPath, 'utf8'));
                if (Array.isArray(parsed.personas) && parsed.personas.length > 0) {
                    const validActive = parsed.personas.some((p) => p.id === parsed.activePersonaId)
                        ? parsed.activePersonaId
                        : parsed.personas[0].id;
                    return {
                        activePersonaId: validActive,
                        personas: parsed.personas,
                    };
                }
            }
            catch {
                // Fallback to default registry if corrupted
            }
        }
        const initial = {
            activePersonaId: 'default',
            personas: [
                {
                    id: 'default',
                    label: 'Primary Persona',
                    dbFileName: 'webring-studio.sqlite',
                    mediaDirName: 'media-store',
                    createdAt: new Date().toISOString(),
                },
            ],
        };
        this.saveRegistry(initial);
        return initial;
    }
    saveRegistry(reg = this.registry) {
        fs.writeFileSync(this.registryPath, JSON.stringify(reg, null, 2), 'utf8');
    }
    hydratePersonaSummary(record, openDb) {
        const computeSummary = (db) => {
            const p = db.getProfile();
            const albums = db.getAlbums();
            const photoCount = albums.reduce((sum, a) => sum + a.photos.length, 0);
            const itemCount = db.getItems().length;
            const friendCount = db.getFriends().length;
            return {
                id: record.id,
                label: record.label,
                displayName: p.displayName,
                handle: p.handle,
                siteUrl: p.siteUrl,
                did: p.did,
                avatarUrl: p.avatarUrl,
                theme: p.theme,
                dbFileName: record.dbFileName,
                mediaDirName: record.mediaDirName,
                createdAt: record.createdAt,
                stats: {
                    photoCount,
                    itemCount,
                    friendCount,
                },
            };
        };
        if (openDb) {
            return computeSummary(openDb);
        }
        const tempDb = new database_1.StudioDatabase(this.userDataDir, record.dbFileName, {
            seedStarterData: record.id === 'default',
        });
        const summary = computeSummary(tempDb);
        tempDb.close();
        return summary;
    }
    activatePersona(personaId) {
        const record = this.registry.personas.find((p) => p.id === personaId) || this.registry.personas[0];
        if (this.activeContext && this.activeContext.persona.id === record.id) {
            this.activeContext.persona = this.hydratePersonaSummary(record, this.activeContext.db);
            return this.activeContext;
        }
        if (this.activeContext) {
            this.activeContext.db.close();
            this.activeContext = null;
        }
        const mediaStoreDir = path.join(this.userDataDir, record.mediaDirName);
        const defaultExportPath = record.id === 'default'
            ? path.join(this.userDataDir, 'exported-profile-site')
            : path.join(this.userDataDir, `exported-profile-site-${record.id}`);
        const db = new database_1.StudioDatabase(this.userDataDir, record.dbFileName, {
            seedStarterData: record.id === 'default',
            defaultExportPath,
        });
        const mediaProcessor = new mediaProcessor_1.MediaProcessor(mediaStoreDir);
        const siteGenerator = new siteGenerator_1.StaticSiteGenerator(db, mediaStoreDir);
        const sitePublisher = new publisher_1.SitePublisher(siteGenerator);
        const ringCrawler = new ringCrawler_1.RingCrawler(db);
        this.registry.activePersonaId = record.id;
        this.saveRegistry();
        this.activeContext = {
            persona: this.hydratePersonaSummary(record, db),
            db,
            mediaProcessor,
            siteGenerator,
            sitePublisher,
            ringCrawler,
        };
        return this.activeContext;
    }
    getActiveContext() {
        if (!this.activeContext) {
            return this.activatePersona(this.registry.activePersonaId);
        }
        const record = this.registry.personas.find((p) => p.id === this.activeContext.persona.id) ||
            this.registry.personas[0];
        this.activeContext.persona = this.hydratePersonaSummary(record, this.activeContext.db);
        return this.activeContext;
    }
    getActivePersonaId() {
        return this.getActiveContext().persona.id;
    }
    listPersonas() {
        const active = this.getActiveContext();
        const summaries = this.registry.personas.map((rec) => rec.id === active.persona.id
            ? this.hydratePersonaSummary(rec, active.db)
            : this.hydratePersonaSummary(rec));
        return {
            activePersonaId: active.persona.id,
            personas: summaries,
        };
    }
    switchPersona(personaId) {
        const target = this.registry.personas.find((p) => p.id === personaId);
        if (!target) {
            throw new Error(`Persona "${personaId}" not found`);
        }
        this.activatePersona(target.id);
        return this.listPersonas();
    }
    createPersona(input) {
        const suffix = crypto.randomBytes(4).toString('hex');
        const id = `persona-${suffix}`;
        const dbFileName = `${id}.sqlite`;
        const mediaDirName = `media-store-${id}`;
        const createdAt = new Date().toISOString();
        const defaultExportPath = path.join(this.userDataDir, `exported-profile-site-${id}`);
        const record = {
            id,
            label: input.label.trim() || input.displayName.trim() || 'Secondary Persona',
            dbFileName,
            mediaDirName,
            createdAt,
        };
        // Initialize isolated SQLite DB with a fresh Ed25519 keypair and clean slate
        const newDb = new database_1.StudioDatabase(this.userDataDir, dbFileName, {
            seedStarterData: Boolean(input.seedStarterData),
            defaultExportPath,
            initialProfile: {
                siteUrl: input.siteUrl,
                handle: input.handle,
                displayName: input.displayName,
                tagline: input.tagline,
                bio: input.bio,
                avatarUrl: input.avatarUrl,
                theme: input.theme || 'neo-webring',
            },
        });
        newDb.close();
        this.registry.personas.push(record);
        this.registry.activePersonaId = id;
        this.saveRegistry();
        const active = this.activatePersona(id);
        const list = this.listPersonas();
        return {
            created: active.persona,
            activePersonaId: list.activePersonaId,
            personas: list.personas,
        };
    }
    updatePersonaLabel(personaId, label) {
        const rec = this.registry.personas.find((p) => p.id === personaId);
        if (rec && label.trim()) {
            rec.label = label.trim();
            this.saveRegistry();
        }
        return this.listPersonas();
    }
    deletePersona(personaId) {
        if (personaId === 'default' || this.registry.personas.length <= 1) {
            throw new Error('Cannot delete the primary or only remaining persona.');
        }
        const idx = this.registry.personas.findIndex((p) => p.id === personaId);
        if (idx === -1) {
            throw new Error(`Persona "${personaId}" not found.`);
        }
        const [removed] = this.registry.personas.splice(idx, 1);
        if (this.activeContext && this.activeContext.persona.id === personaId) {
            this.activeContext.db.close();
            this.activeContext = null;
        }
        // Delete isolated SQLite database files and media directory
        for (const ext of ['', '-wal', '-shm']) {
            const dbFile = path.join(this.userDataDir, `${removed.dbFileName}${ext}`);
            if (fs.existsSync(dbFile)) {
                try {
                    fs.rmSync(dbFile, { force: true });
                }
                catch {
                    // Ignore file lock races
                }
            }
        }
        const mediaDir = path.join(this.userDataDir, removed.mediaDirName);
        if (fs.existsSync(mediaDir)) {
            try {
                fs.rmSync(mediaDir, { recursive: true, force: true });
            }
            catch {
                // Ignore cleanup errors
            }
        }
        const nextActiveId = this.registry.activePersonaId === personaId
            ? this.registry.personas[0].id
            : this.registry.activePersonaId;
        this.registry.activePersonaId = nextActiveId;
        this.saveRegistry();
        this.activatePersona(nextActiveId);
        return this.listPersonas();
    }
    close() {
        if (this.activeContext) {
            this.activeContext.db.close();
            this.activeContext = null;
        }
    }
    closeAll() {
        this.close();
    }
}
exports.PersonaManager = PersonaManager;
