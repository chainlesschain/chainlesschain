/**
 * @module did/did-v2-manager
 * Phase 90: W3C DID v2.0, Verifiable Presentations, recovery, roaming, reputation
 */
const EventEmitter = require("events");
const { logger } = require("../utils/logger.js");

class DIDv2Manager extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;
    this._dids = new Map();
    this._presentations = new Map();
    this._recoveryKeys = new Map();
    this._reputations = new Map();
  }

  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this._ensureTables();
    await this._loadDIDs();
    this.initialized = true;
    logger.info(`[DIDv2] Initialized with ${this._dids.size} DIDs`);
  }

  _ensureTables() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS did_v2_documents (
          id TEXT PRIMARY KEY, controller TEXT, document TEXT,
          recovery_keys TEXT, status TEXT DEFAULT 'active', created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS did_v2_presentations (
          id TEXT PRIMARY KEY, did_id TEXT, credentials TEXT, verifier TEXT,
          status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS did_v2_reputation (
          did_id TEXT PRIMARY KEY, score REAL DEFAULT 0, sources TEXT,
          updated_at TEXT DEFAULT (datetime('now'))
        );
      `);
    } catch (error) {
      logger.warn("[DIDv2] Table creation warning:", error.message);
    }
  }

  async _loadDIDs() {
    try {
      const rows = this.db
        .prepare("SELECT * FROM did_v2_documents WHERE status = 'active'")
        .all();
      for (const row of rows) {
        this._dids.set(row.id, {
          ...row,
          document: JSON.parse(row.document || "{}"),
          recovery_keys: JSON.parse(row.recovery_keys || "[]"),
        });
      }
    } catch (error) {
      logger.warn("[DIDv2] Failed to load DIDs:", error.message);
    }
  }

  create(options = {}) {
    const id = `did:chainless:${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const doc = {
      "@context": ["https://www.w3.org/ns/did/v2"],
      id,
      controller: options.controller || id,
      verificationMethod: [
        {
          id: `${id}#key-1`,
          type: "Ed25519VerificationKey2020",
          controller: id,
          publicKeyMultibase: `z${Math.random().toString(36).slice(2, 48)}`,
        },
      ],
      authentication: [`${id}#key-1`],
      assertionMethod: [`${id}#key-1`],
      service: options.services || [],
    };
    const recoveryKeys = options.recoveryKeys || [];
    this._dids.set(id, {
      id,
      controller: doc.controller,
      document: doc,
      recovery_keys: recoveryKeys,
      status: "active",
    });
    try {
      this.db
        .prepare(
          "INSERT INTO did_v2_documents (id, controller, document, recovery_keys) VALUES (?, ?, ?, ?)",
        )
        .run(
          id,
          doc.controller,
          JSON.stringify(doc),
          JSON.stringify(recoveryKeys),
        );
    } catch (error) {
      logger.error("[DIDv2] Persist failed:", error.message);
    }
    this.emit("did:created", { id });
    return doc;
  }

  resolve(didId) {
    const entry = this._dids.get(didId);
    return entry ? entry.document : null;
  }

  present(didId, credentials, verifier) {
    const id = `vp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const presentation = {
      "@context": ["https://www.w3.org/ns/credentials/v2"],
      type: ["VerifiablePresentation"],
      id,
      holder: didId,
      verifiableCredential: credentials,
      proof: {
        type: "Ed25519Signature2020",
        created: new Date().toISOString(),
        verificationMethod: `${didId}#key-1`,
      },
    };
    this._presentations.set(id, {
      ...presentation,
      verifier,
      status: "presented",
    });
    this.emit("did:presented", { id, didId, verifier });
    return presentation;
  }

  verify(presentationId) {
    const pres = this._presentations.get(presentationId);
    if (!pres) {
      return { valid: false, error: "Presentation not found" };
    }
    return {
      valid: true,
      holder: pres.holder,
      credentials: pres.verifiableCredential?.length || 0,
    };
  }

  recover(didId, recoveryProof) {
    const entry = this._dids.get(didId);
    if (!entry) {
      return { success: false, error: "DID not found" };
    }
    // Simplified recovery check
    if (!recoveryProof || !recoveryProof.key) {
      return { success: false, error: "Invalid recovery proof" };
    }
    this.emit("did:recovered", { id: didId });
    return { success: true, didId };
  }

  roam(didId, targetPlatform) {
    const entry = this._dids.get(didId);
    if (!entry) {
      return null;
    }
    return {
      didId,
      targetPlatform,
      document: entry.document,
      exportedAt: Date.now(),
    };
  }

  aggregateReputation(didId, sources = []) {
    const scores = sources.map((s) => s.score || 0);
    const avgScore =
      scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const reputation = {
      didId,
      score: avgScore,
      sources,
      updatedAt: Date.now(),
    };
    this._reputations.set(didId, reputation);
    try {
      this.db
        .prepare(
          "INSERT OR REPLACE INTO did_v2_reputation (did_id, score, sources, updated_at) VALUES (?, ?, ?, datetime('now'))",
        )
        .run(didId, avgScore, JSON.stringify(sources));
    } catch (error) {
      logger.error("[DIDv2] Reputation persist failed:", error.message);
    }
    return reputation;
  }

  exportDID(didId) {
    const entry = this._dids.get(didId);
    if (!entry) {
      return null;
    }
    return {
      did: entry.document,
      reputation: this._reputations.get(didId) || null,
    };
  }
}

let instance = null;
function getDIDv2Manager() {
  if (!instance) {
    instance = new DIDv2Manager();
  }
  return instance;
}
module.exports = { DIDv2Manager, getDIDv2Manager };
