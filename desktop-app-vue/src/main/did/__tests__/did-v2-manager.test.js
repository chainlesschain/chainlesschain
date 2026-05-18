/**
 * DIDv2Manager unit tests — Phase 90
 *
 * Covers: initialize, create, resolve, present, verify, recover, roam,
 *         aggregateReputation, exportDID
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ─────────────────────────────────────────────────────────────
vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────
const { DIDv2Manager } = require("../did-v2-manager");

// ─── Helpers ─────────────────────────────────────────────────────────────────
function createMockDB() {
  const prep = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return {
    exec: vi.fn(),
    prepare: vi.fn().mockReturnValue(prep),
    _prep: prep,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────
describe("DIDv2Manager", () => {
  let manager;
  let db;

  beforeEach(() => {
    manager = new DIDv2Manager();
    db = createMockDB();
    vi.clearAllMocks();
  });

  // ── Constructor ──────────────────────────────────────────────────────────
  it("should construct with default state", () => {
    expect(manager.initialized).toBe(false);
    expect(manager._dids.size).toBe(0);
    expect(manager._presentations.size).toBe(0);
  });

  // ── initialize ───────────────────────────────────────────────────────────
  it("should initialize with database", async () => {
    await manager.initialize(db);
    expect(manager.initialized).toBe(true);
    expect(db.exec).toHaveBeenCalledTimes(1);
  });

  it("should skip double initialization", async () => {
    await manager.initialize(db);
    await manager.initialize(db);
    expect(db.exec).toHaveBeenCalledTimes(1);
  });

  // ── create ───────────────────────────────────────────────────────────────
  it("should create a DID document", async () => {
    await manager.initialize(db);
    const doc = manager.create();
    expect(doc.id).toMatch(/^did:chainless:/);
    expect(doc["@context"]).toContain("https://www.w3.org/ns/did/v2");
    expect(doc.verificationMethod).toHaveLength(1);
    expect(doc.authentication).toHaveLength(1);
  });

  it("should store created DID internally", async () => {
    await manager.initialize(db);
    const doc = manager.create();
    expect(manager._dids.has(doc.id)).toBe(true);
  });

  it("should emit did:created event", async () => {
    await manager.initialize(db);
    const listener = vi.fn();
    manager.on("did:created", listener);
    const doc = manager.create();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ id: doc.id }),
    );
  });

  it("should accept custom controller option", async () => {
    await manager.initialize(db);
    const doc = manager.create({ controller: "did:example:controller" });
    expect(doc.controller).toBe("did:example:controller");
  });

  // ── resolve ──────────────────────────────────────────────────────────────
  it("should resolve existing DID", async () => {
    await manager.initialize(db);
    const doc = manager.create();
    const resolved = manager.resolve(doc.id);
    expect(resolved.id).toBe(doc.id);
  });

  it("should return null for unknown DID", async () => {
    await manager.initialize(db);
    expect(manager.resolve("did:chainless:unknown")).toBeNull();
  });

  // ── present ──────────────────────────────────────────────────────────────
  it("should create a verifiable presentation", async () => {
    await manager.initialize(db);
    const doc = manager.create();
    const credentials = [{ type: "TestCredential", value: "test" }];
    const vp = manager.present(doc.id, credentials, "verifier-1");
    expect(vp.id).toMatch(/^vp-/);
    expect(vp.holder).toBe(doc.id);
    expect(vp.verifiableCredential).toEqual(credentials);
    expect(vp.type).toContain("VerifiablePresentation");
  });

  it("should emit did:presented event", async () => {
    await manager.initialize(db);
    const doc = manager.create();
    const listener = vi.fn();
    manager.on("did:presented", listener);
    manager.present(doc.id, [], "verifier-1");
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ didId: doc.id }),
    );
  });

  // ── verify ───────────────────────────────────────────────────────────────
  it("should verify valid presentation", async () => {
    await manager.initialize(db);
    const doc = manager.create();
    const vp = manager.present(doc.id, [{ type: "vc" }], "verifier-1");
    const result = manager.verify(vp.id);
    expect(result.valid).toBe(true);
    expect(result.holder).toBe(doc.id);
    expect(result.credentials).toBe(1);
  });

  it("should return invalid for unknown presentation", async () => {
    await manager.initialize(db);
    const result = manager.verify("unknown-vp");
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  // ── recover ──────────────────────────────────────────────────────────────
  it("should recover DID with valid recovery proof", async () => {
    await manager.initialize(db);
    const doc = manager.create({ recoveryKeys: ["key1"] });
    const result = manager.recover(doc.id, { key: "key1" });
    expect(result.success).toBe(true);
    expect(result.didId).toBe(doc.id);
  });

  it("should fail recovery for unknown DID", async () => {
    await manager.initialize(db);
    const result = manager.recover("did:chainless:unknown", { key: "k" });
    expect(result.success).toBe(false);
  });

  it("should fail recovery with invalid proof", async () => {
    await manager.initialize(db);
    const doc = manager.create();
    const result = manager.recover(doc.id, null);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid/);
  });

  // ── roam ─────────────────────────────────────────────────────────────────
  it("should roam DID to another platform", async () => {
    await manager.initialize(db);
    const doc = manager.create();
    const result = manager.roam(doc.id, "platform-b");
    expect(result.didId).toBe(doc.id);
    expect(result.targetPlatform).toBe("platform-b");
    expect(result.document).toBeDefined();
  });

  it("should return null when roaming unknown DID", async () => {
    await manager.initialize(db);
    expect(manager.roam("unknown", "platform")).toBeNull();
  });

  // ── aggregateReputation ──────────────────────────────────────────────────
  it("should aggregate reputation from multiple sources", async () => {
    await manager.initialize(db);
    const doc = manager.create();
    const rep = manager.aggregateReputation(doc.id, [
      { source: "A", score: 0.8 },
      { source: "B", score: 0.6 },
    ]);
    expect(rep.score).toBeCloseTo(0.7);
    expect(rep.sources).toHaveLength(2);
  });

  it("should return zero score with no sources", async () => {
    await manager.initialize(db);
    const rep = manager.aggregateReputation("did:test", []);
    expect(rep.score).toBe(0);
  });

  // ── exportDID ────────────────────────────────────────────────────────────
  it("should export DID with reputation", async () => {
    await manager.initialize(db);
    const doc = manager.create();
    manager.aggregateReputation(doc.id, [{ score: 0.9 }]);
    const exported = manager.exportDID(doc.id);
    expect(exported.did.id).toBe(doc.id);
    expect(exported.reputation).toBeDefined();
    expect(exported.reputation.score).toBeCloseTo(0.9);
  });

  it("should return null for unknown DID export", async () => {
    await manager.initialize(db);
    expect(manager.exportDID("unknown")).toBeNull();
  });
});
