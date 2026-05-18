/**
 * ZKPEngine unit tests — Phase 88
 *
 * Covers: initialize, compileCircuit, generateProof, verifyProof,
 *         createIdentityProof, selectiveDisclose, getStats
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
const { ZKPEngine } = require("../zkp-engine");

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
describe("ZKPEngine", () => {
  let engine;
  let db;

  beforeEach(() => {
    engine = new ZKPEngine();
    db = createMockDB();
    vi.clearAllMocks();
  });

  // ── Constructor ──────────────────────────────────────────────────────────
  it("should construct with default state", () => {
    expect(engine.initialized).toBe(false);
    expect(engine.db).toBeNull();
    expect(engine._circuits.size).toBe(0);
    expect(engine._proofs.size).toBe(0);
  });

  // ── initialize ───────────────────────────────────────────────────────────
  it("should initialize with database", async () => {
    await engine.initialize(db);
    expect(engine.initialized).toBe(true);
    expect(engine.db).toBe(db);
    expect(db.exec).toHaveBeenCalledTimes(1);
  });

  it("should skip double initialization", async () => {
    await engine.initialize(db);
    await engine.initialize(db);
    expect(db.exec).toHaveBeenCalledTimes(1);
  });

  // ── compileCircuit ───────────────────────────────────────────────────────
  it("should compile a circuit and return it", async () => {
    await engine.initialize(db);
    const def = {
      constraints: ["a * b = c"],
      inputs: ["a", "b"],
      outputs: ["c"],
    };
    const circuit = engine.compileCircuit("multiply", def);
    expect(circuit.id).toMatch(/^circuit-/);
    expect(circuit.name).toBe("multiply");
    expect(circuit.compiled).toBe(true);
    expect(circuit.inputs).toEqual(["a", "b"]);
    expect(circuit.verificationKey).toMatch(/^vk-circuit-/);
  });

  it("should store circuit in internal map", async () => {
    await engine.initialize(db);
    const circuit = engine.compileCircuit("test", { inputs: [] });
    expect(engine._circuits.get(circuit.id)).toBeDefined();
  });

  it("should emit zkp:circuit-compiled event", async () => {
    await engine.initialize(db);
    const listener = vi.fn();
    engine.on("zkp:circuit-compiled", listener);
    engine.compileCircuit("test", {});
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ name: "test" }),
    );
  });

  it("should persist circuit to database", async () => {
    await engine.initialize(db);
    engine.compileCircuit("test", {});
    expect(db.prepare).toHaveBeenCalled();
    expect(db._prep.run).toHaveBeenCalled();
  });

  // ── generateProof ────────────────────────────────────────────────────────
  it("should generate proof for existing circuit", async () => {
    await engine.initialize(db);
    const circuit = engine.compileCircuit("test", {});
    const proof = await engine.generateProof(
      circuit.id,
      { secret: 42 },
      { pub: 1 },
    );
    expect(proof.id).toMatch(/^proof-/);
    expect(proof.circuitId).toBe(circuit.id);
    expect(proof.scheme).toBe("groth16");
    expect(proof.verified).toBe(false);
    expect(proof.publicInputs).toEqual({ pub: 1 });
  });

  it("should throw when generating proof for unknown circuit", async () => {
    await engine.initialize(db);
    await expect(engine.generateProof("nonexistent", {})).rejects.toThrow(
      "not found",
    );
  });

  it("should emit zkp:proof-generated event", async () => {
    await engine.initialize(db);
    const circuit = engine.compileCircuit("test", {});
    const listener = vi.fn();
    engine.on("zkp:proof-generated", listener);
    await engine.generateProof(circuit.id, {});
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ circuitId: circuit.id }),
    );
  });

  // ── verifyProof ──────────────────────────────────────────────────────────
  it("should verify a valid proof", async () => {
    await engine.initialize(db);
    const circuit = engine.compileCircuit("test", {});
    const proof = await engine.generateProof(circuit.id, {});
    const result = engine.verifyProof(proof.id);
    expect(result.valid).toBe(true);
    expect(result.proofId).toBe(proof.id);
    expect(result.scheme).toBe("groth16");
  });

  it("should throw when verifying unknown proof", async () => {
    await engine.initialize(db);
    expect(() => engine.verifyProof("bad-id")).toThrow("not found");
  });

  it("should emit zkp:proof-verified event", async () => {
    await engine.initialize(db);
    const circuit = engine.compileCircuit("test", {});
    const proof = await engine.generateProof(circuit.id, {});
    const listener = vi.fn();
    engine.on("zkp:proof-verified", listener);
    engine.verifyProof(proof.id);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ valid: true }),
    );
  });

  // ── createIdentityProof ──────────────────────────────────────────────────
  it("should create identity proof with selective disclosure", async () => {
    await engine.initialize(db);
    const claims = { name: "Alice", age: 30, country: "US" };
    const proof = engine.createIdentityProof(claims, ["name"]);
    expect(proof.type).toBe("identity");
    expect(proof.disclosed).toEqual({ name: "Alice" });
    expect(proof.hiddenCount).toBe(2);
  });

  it("should emit zkp:identity-proof-created event", async () => {
    await engine.initialize(db);
    const listener = vi.fn();
    engine.on("zkp:identity-proof-created", listener);
    engine.createIdentityProof({ a: 1 }, ["a"]);
    expect(listener).toHaveBeenCalled();
  });

  // ── selectiveDisclose ────────────────────────────────────────────────────
  it("should return disclosure info for existing proof", async () => {
    await engine.initialize(db);
    const proof = engine.createIdentityProof({ a: 1, b: 2 }, ["a"]);
    const result = engine.selectiveDisclose(proof.id, ["b"]);
    expect(result.proofId).toBe(proof.id);
    expect(result.additionalDisclosed).toEqual(["b"]);
  });

  it("should return null for unknown proof", async () => {
    await engine.initialize(db);
    expect(engine.selectiveDisclose("unknown", [])).toBeNull();
  });

  // ── getStats ─────────────────────────────────────────────────────────────
  it("should return correct stats", async () => {
    await engine.initialize(db);
    const circuit = engine.compileCircuit("test", {});
    const proof = await engine.generateProof(circuit.id, {});
    engine.verifyProof(proof.id);
    const stats = engine.getStats();
    expect(stats.circuits).toBe(1);
    expect(stats.proofs).toBeGreaterThanOrEqual(1);
    expect(stats.verifiedProofs).toBe(1);
  });

  it("should return zero stats when empty", () => {
    const stats = engine.getStats();
    expect(stats.circuits).toBe(0);
    expect(stats.proofs).toBe(0);
    expect(stats.verifiedProofs).toBe(0);
  });
});
