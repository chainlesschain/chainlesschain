import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE,
  EVOLUTION_ARTIFACT_ENVELOPE_SCHEMA,
  EVOLUTION_ARTIFACT_EXPIRED_CODE,
  EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
  EVOLUTION_ARTIFACT_INVALID_CODE,
  EVOLUTION_ARTIFACT_LEDGER_RETENTION_TYPES,
  EVOLUTION_ARTIFACT_MAX_CANONICAL_BYTES,
  EVOLUTION_ARTIFACT_MAX_ENVELOPE_BYTES,
  EVOLUTION_ARTIFACT_MAX_INDEX_ENTRIES,
  EVOLUTION_ARTIFACT_RESOLVED_SCHEMA,
  EVOLUTION_ARTIFACT_SIGNATURE_INVALID_CODE,
  EVOLUTION_ARTIFACT_STORE_FAILED_CODE,
  EVOLUTION_ARTIFACT_TYPE_DENIED_CODE,
  EvolutionArtifactPorts,
  createEvolutionLedgerArtifactResolver,
  isEvolutionLedgerArtifactResolver,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import {
  EVOLUTION_ARTIFACT_REF_SCHEMA,
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
} from "../../src/lib/evolution/evolution-ledger.js";

const SECRET = "test-only-evolution-artifact-envelope-secret";
const ALGORITHM = "hmac-sha256";
const KEY_ID = "test:key/evolution-artifacts";
const ROTATED_KEY_ID = "test:key/evolution-artifacts-v2";
const AUTHORITY_DOMAIN =
  "chainlesschain.evolution-artifact-authority-decision/v1\0";
const TENANT_ID = "tenant-a";
const AUDIENCE = "evolution-runtime";
const PURPOSE = "evolution-ledger";

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function digestBytes(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function domainDigest(domain, value) {
  return digestBytes(Buffer.from(`${domain}${canonicalJson(value)}`, "utf8"));
}

function hmac(message, keyId = KEY_ID) {
  const secret =
    keyId === ROTATED_KEY_ID
      ? "test-only-rotated-evolution-artifact-secret"
      : SECRET;
  return crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("base64url");
}

function capturedError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error("expected callback to throw");
}

describe("EvolutionArtifactPorts", () => {
  let tempRoot;
  let storeDir;
  let nowMs;
  let store;
  let authorityState;
  let envelopeSigner;
  let envelopeVerifier;
  let currentAuthorityResolver;
  let ports;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), "cc-evolution-artifacts-"),
    );
    storeDir = path.join(tempRoot, "artifacts");
    nowMs = Date.parse("2026-09-01T10:00:00.000Z");
    authorityState = {
      allowed: true,
      algorithm: ALGORITHM,
      keyId: KEY_ID,
      policyDigest: digestBytes("evolution-artifact-policy-v1"),
      policyRevision: 7,
      revocationRevision: 11,
      revoked: false,
      issuedPolicyTrusted: true,
    };
    envelopeSigner = {
      sign: vi.fn((request) => ({
        algorithm: authorityState.algorithm,
        keyId: authorityState.keyId,
        value: hmac(request.message, authorityState.keyId),
      })),
    };
    envelopeVerifier = {
      verify: vi.fn(
        (request) =>
          request.algorithm === authorityState.algorithm &&
          [KEY_ID, ROTATED_KEY_ID].includes(request.keyId) &&
          request.signature.value === hmac(request.message, request.keyId),
      ),
    };
    currentAuthorityResolver = {
      resolve: vi.fn((request) => {
        const core = {
          action: request.action,
          algorithm: authorityState.algorithm,
          allowed: authorityState.allowed,
          audience: request.audience,
          checkedAt: new Date(nowMs).toISOString(),
          decisionExpiresAt: new Date(nowMs + 30_000).toISOString(),
          digest: request.digest,
          issuedAt: request.issuedAt,
          issuedPolicyDigest: request.issuedPolicyDigest,
          issuedPolicyRevision: request.issuedPolicyRevision,
          issuedPolicyTrusted: authorityState.issuedPolicyTrusted,
          keyId: request.keyId || authorityState.keyId,
          policyDigest: authorityState.policyDigest,
          policyRevision: authorityState.policyRevision,
          purpose: request.purpose,
          requestedAt: request.requestedAt,
          retention: request.retention,
          revocationRevision: authorityState.revocationRevision,
          revoked: authorityState.revoked,
          schema: EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
          tenantId: request.tenantId,
          type: request.type,
        };
        return {
          ...core,
          receiptDigest: domainDigest(AUTHORITY_DOMAIN, core),
        };
      }),
    };
    store = new ArtifactStore({ dir: storeDir, now: () => nowMs });
    ports = new EvolutionArtifactPorts({
      artifactStore: store,
      audience: AUDIENCE,
      currentAuthorityResolver,
      envelopeSigner,
      envelopeVerifier,
      now: () => nowMs,
      tenantId: TENANT_ID,
    });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  function publish(overrides = {}) {
    const retention = overrides.retention || "ttl";
    const context = {
      audience: AUDIENCE,
      purpose: overrides.purpose || PURPOSE,
      retention,
      ...(retention === "ttl" ? { ttlMs: overrides.ttlMs ?? 60_000 } : {}),
    };
    return ports.putCanonical(
      overrides.type || "candidate",
      overrides.value || {
        nested: { score: 0.75, status: "ready" },
        sources: ["recording:one", "recording:two"],
      },
      context,
    );
  }

  function resolveResult(result, overrides = {}) {
    return ports.resolve(result.envelope, {
      expectedDigest: overrides.expectedDigest || result.digest,
      expectedType: overrides.expectedType || "candidate",
      purpose: overrides.purpose || PURPOSE,
      tenantId: overrides.tenantId || TENANT_ID,
    });
  }

  function artifactId(result) {
    return result.ref.ref.slice("cc-evolution-artifact:".length);
  }

  function ledgerRequest(result, overrides = {}) {
    return {
      epoch: "epoch-a",
      ledgerId: "ledger-a",
      ref: overrides.ref || result.ref,
      tenantId: overrides.tenantId || TENANT_ID,
    };
  }

  function readIndex() {
    return fs
      .readFileSync(path.join(storeDir, "index.jsonl"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  function writeIndex(entries) {
    fs.writeFileSync(
      path.join(storeDir, "index.jsonl"),
      `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
      "utf8",
    );
  }

  it("persists canonical bytes with an exact signed-lineage envelope and resolves a frozen value", () => {
    const result = publish();
    const id = artifactId(result);
    const entry = store.get(id);

    expect(result).toMatchObject({
      digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      ref: {
        digest: result.digest,
        ref: `cc-evolution-artifact:${id}`,
        schema: EVOLUTION_ARTIFACT_REF_SCHEMA,
      },
      receipt: {
        persisted: true,
        immutable: true,
        integrityVerified: true,
        readbackVerified: true,
      },
    });
    expect(result.receipt).not.toHaveProperty("durable");
    expect(result.receipt).not.toHaveProperty("worm");
    expect(Buffer.byteLength(result.envelope, "utf8")).toBeLessThanOrEqual(
      EVOLUTION_ARTIFACT_MAX_ENVELOPE_BYTES,
    );
    expect(JSON.parse(result.envelope).schema).toBe(
      EVOLUTION_ARTIFACT_ENVELOPE_SCHEMA,
    );
    expect(entry).toMatchObject({
      immutable: true,
      recordDigest: result.digest,
      lineage: {
        envelope: result.envelope,
        recordDigest: result.digest,
        tenantId: TENANT_ID,
        type: "candidate",
      },
    });
    expect(entry.id).not.toBe(result.digest);

    const resolved = resolveResult(result);
    expect(resolved).toMatchObject({
      authenticated: true,
      digest: result.digest,
      ref: result.ref,
      schema: EVOLUTION_ARTIFACT_RESOLVED_SCHEMA,
      tenantId: TENANT_ID,
      type: "candidate",
      value: {
        nested: { score: 0.75, status: "ready" },
        sources: ["recording:one", "recording:two"],
      },
    });
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.value)).toBe(true);
    expect(Object.isFrozen(resolved.value.nested)).toBe(true);
    expect(Object.isFrozen(resolved.ref)).toBe(true);
    expect(envelopeSigner.sign).toHaveBeenCalledTimes(1);
    expect(envelopeVerifier.verify).toHaveBeenCalled();
  });

  it("returns the existing exact envelope and locator after a response-loss retry", () => {
    const first = publish();
    nowMs += 1_000;
    const second = publish();

    expect(second.ref).toEqual(first.ref);
    expect(second.digest).toBe(first.digest);
    expect(second.envelope).toBe(first.envelope);
    expect(second.receipt.published).toBe(false);
    expect(store.list()).toHaveLength(1);
    expect(store.get(artifactId(second)).lineage.envelope).toBe(first.envelope);
  });

  it("provides a short read-only EvolutionLedger resolver without write authority", () => {
    const result = publish();
    const resolver = createEvolutionLedgerArtifactResolver(ports, {
      purpose: PURPOSE,
    });
    const resolution = resolver(ledgerRequest(result));

    expect(result.ref.ref.length).toBeLessThan(2048);
    expect(resolution).toMatchObject({
      authenticated: true,
      digest: result.digest,
      found: true,
      ref: result.ref.ref,
      schema: EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
    });
    expect(Buffer.isBuffer(resolution.bytes)).toBe(true);
    expect(digestBytes(resolution.bytes)).toBe(result.digest);
    expect(Object.isFrozen(resolver)).toBe(true);
    expect(resolver).not.toHaveProperty("putCanonical");
    expect(resolver).not.toHaveProperty("sign");
  });

  it("rejects accessors, sparse arrays, cycles, unsupported values, oversized values, and non-whitelisted types", () => {
    let getterCalls = 0;
    const accessorValue = {};
    Object.defineProperty(accessorValue, "secret", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "must-not-run";
      },
    });
    expect(
      capturedError(() =>
        ports.putCanonical("candidate", accessorValue, {
          purpose: PURPOSE,
          ttlMs: 60_000,
        }),
      ),
    ).toMatchObject({ code: EVOLUTION_ARTIFACT_INVALID_CODE });
    expect(getterCalls).toBe(0);

    const sparse = [];
    sparse.length = 2;
    sparse[1] = "present";
    expect(
      capturedError(() =>
        ports.putCanonical("candidate", sparse, {
          purpose: PURPOSE,
          ttlMs: 60_000,
        }),
      ).code,
    ).toBe(EVOLUTION_ARTIFACT_INVALID_CODE);

    const cyclic = {};
    cyclic.self = cyclic;
    expect(
      capturedError(() =>
        ports.putCanonical("candidate", cyclic, {
          purpose: PURPOSE,
          ttlMs: 60_000,
        }),
      ).code,
    ).toBe(EVOLUTION_ARTIFACT_INVALID_CODE);
    expect(
      capturedError(() =>
        ports.putCanonical(
          "candidate",
          { bad: undefined },
          {
            purpose: PURPOSE,
            ttlMs: 60_000,
          },
        ),
      ).code,
    ).toBe(EVOLUTION_ARTIFACT_INVALID_CODE);
    expect(
      capturedError(() =>
        ports.putCanonical(
          "candidate",
          "x".repeat(EVOLUTION_ARTIFACT_MAX_CANONICAL_BYTES + 1),
          { purpose: PURPOSE, ttlMs: 60_000 },
        ),
      ).code,
    ).toBe(EVOLUTION_ARTIFACT_INVALID_CODE);
    expect(
      capturedError(() =>
        ports.putCanonical(
          "caller-invented-type",
          { ok: true },
          {
            purpose: PURPOSE,
            ttlMs: 60_000,
          },
        ),
      ).code,
    ).toBe(EVOLUTION_ARTIFACT_TYPE_DENIED_CODE);
  });

  it("rejects every Proxy before reflective traps or persistence can run", () => {
    const trapCalls = {
      getOwnPropertyDescriptor: 0,
      getPrototypeOf: 0,
      ownKeys: 0,
    };
    const trappingHandler = {
      getOwnPropertyDescriptor() {
        trapCalls.getOwnPropertyDescriptor += 1;
        throw new Error("descriptor trap must not execute");
      },
      getPrototypeOf() {
        trapCalls.getPrototypeOf += 1;
        throw new Error("prototype trap must not execute");
      },
      ownKeys() {
        trapCalls.ownKeys += 1;
        return trapCalls.ownKeys % 2 === 0 ? ["second"] : ["first"];
      },
    };
    const values = [
      new Proxy({ transparent: true }, {}),
      new Proxy({ unstable: true }, trappingHandler),
      new Proxy(["unstable"], trappingHandler),
    ];
    for (const value of values) {
      expect(
        capturedError(() =>
          ports.putCanonical("candidate", value, {
            purpose: PURPOSE,
            ttlMs: 60_000,
          }),
        ).code,
      ).toBe(EVOLUTION_ARTIFACT_INVALID_CODE);
    }

    const contextProxy = new Proxy(
      { purpose: PURPOSE, ttlMs: 60_000 },
      trappingHandler,
    );
    expect(
      capturedError(() =>
        ports.putCanonical("candidate", { stable: true }, contextProxy),
      ).code,
    ).toBe(EVOLUTION_ARTIFACT_INVALID_CODE);
    const constructorOptionsProxy = new Proxy(
      {
        artifactStore: new ArtifactStore({
          dir: path.join(tempRoot, "proxy-constructor"),
        }),
        audience: AUDIENCE,
        currentAuthorityResolver,
        envelopeSigner,
        envelopeVerifier,
        tenantId: TENANT_ID,
      },
      trappingHandler,
    );
    expect(
      capturedError(() => new EvolutionArtifactPorts(constructorOptionsProxy))
        .code,
    ).toBe(EVOLUTION_ARTIFACT_INVALID_CODE);
    expect(trapCalls).toEqual({
      getOwnPropertyDescriptor: 0,
      getPrototypeOf: 0,
      ownKeys: 0,
    });
    expect(currentAuthorityResolver.resolve).not.toHaveBeenCalled();
    expect(envelopeSigner.sign).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(storeDir, "index.jsonl"), "utf8")).toBe(
      "",
    );
  });

  it("rejects cross-tenant, cross-audience, wrong-type, wrong-digest, and purpose replay", () => {
    const result = publish();
    const wrongDigest = digestBytes("another-record");

    expect(
      capturedError(() => resolveResult(result, { tenantId: "tenant-b" })).code,
    ).toBe(EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE);
    expect(
      capturedError(() => resolveResult(result, { purpose: "promotion" })).code,
    ).toBe(EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE);
    expect(
      capturedError(() => resolveResult(result, { expectedType: "policy" }))
        .code,
    ).toBe(EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE);
    expect(
      capturedError(() =>
        resolveResult(result, { expectedDigest: wrongDigest }),
      ).code,
    ).toBe(EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE);

    const otherAudiencePorts = new EvolutionArtifactPorts({
      artifactStore: new ArtifactStore({ dir: storeDir, now: () => nowMs }),
      audience: "another-runtime",
      currentAuthorityResolver,
      envelopeSigner,
      envelopeVerifier,
      now: () => nowMs,
      tenantId: TENANT_ID,
    });
    expect(
      capturedError(() =>
        otherAudiencePorts.resolve(result.envelope, {
          expectedDigest: result.digest,
          expectedType: "candidate",
          purpose: PURPOSE,
          tenantId: TENANT_ID,
        }),
      ).code,
    ).toBe(EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE);

    const resolver = ports.createEvolutionLedgerArtifactResolver({
      purpose: PURPOSE,
    });
    expect(
      capturedError(() =>
        resolver(ledgerRequest(result, { tenantId: "tenant-b" })),
      ).code,
    ).toBe(EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE);
  });

  it("rejects expired envelopes and fails closed after ArtifactStore removal", () => {
    const result = publish({ ttlMs: 5_000 });
    nowMs += 5_000;
    expect(capturedError(() => resolveResult(result)).code).toBe(
      EVOLUTION_ARTIFACT_EXPIRED_CODE,
    );

    nowMs -= 5_000;
    expect(store.remove(artifactId(result))).toBe(true);
    expect(capturedError(() => resolveResult(result)).code).toBe(
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
    );
    const resolver = ports.createEvolutionLedgerArtifactResolver({
      purpose: PURPOSE,
    });
    expect(capturedError(() => resolver(ledgerRequest(result))).code).toBe(
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
    );
  });

  it("fails closed after ArtifactStore TTL cleanup removes otherwise-valid bytes", () => {
    let storageNowMs = nowMs;
    const ttlStore = new ArtifactStore({
      dir: path.join(tempRoot, "ttl-artifacts"),
      now: () => storageNowMs,
    });
    const ttlPorts = new EvolutionArtifactPorts({
      artifactStore: ttlStore,
      audience: AUDIENCE,
      currentAuthorityResolver,
      envelopeSigner,
      envelopeVerifier,
      now: () => nowMs,
      tenantId: TENANT_ID,
    });
    const result = ttlPorts.putCanonical(
      "candidate",
      { ttl: "managed" },
      { purpose: PURPOSE, ttlMs: 60_000 },
    );

    storageNowMs += 2 * 24 * 60 * 60 * 1000;
    expect(ttlStore.cleanupExpired()).toEqual({ removed: 1 });
    expect(
      capturedError(() =>
        ttlPorts.resolve(result.envelope, {
          expectedDigest: result.digest,
          expectedType: "candidate",
          purpose: PURPOSE,
          tenantId: TENANT_ID,
        }),
      ).code,
    ).toBe(EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE);
  });

  it("rechecks current revocation and exact policy on every resolution", () => {
    const result = publish();

    authorityState.revoked = true;
    authorityState.revocationRevision += 1;
    expect(capturedError(() => resolveResult(result)).code).toBe(
      EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE,
    );

    authorityState.revoked = false;
    authorityState.policyRevision += 1;
    authorityState.policyDigest = digestBytes("evolution-artifact-policy-v2");
    expect(capturedError(() => resolveResult(result)).code).toBe(
      EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE,
    );
  });

  it("supports only the approved ledger-retention types without an envelope TTL", () => {
    expect(EVOLUTION_ARTIFACT_LEDGER_RETENTION_TYPES).toEqual([
      "skill-release-transition-intent",
      "skill-release-finalization",
      "skill-release-state-migration",
      "skill-mutation-audit",
      "skill-mutation-nonce-claim",
      "skill-promotion-review-decision",
      "skill-promotion-review-packet",
      "skill-registry-transition-attempt",
      "skill-registry-transition-request",
      "skill-registry-transition-settlement",
      "evolution-run-event",
      "evolution-release-train-checkpoint",
      "evolution-release-train-stage-output",
      "evolvable-artifact-candidate",
      "evolvable-artifact-transition",
      "evolution-workbench-metrics-receipt-retention",
      "evolution-workbench-metrics-snapshot",
      "governed-knowledge-sync-record",
      "governed-knowledge-merge-operation",
      "governed-knowledge-dependency-operation",
      "governed-knowledge-trust-record",
      "structured-memory-authority-receipt",
      "structured-memory-event",
      "structured-memory-snapshot",
      "wiki-maintenance-request",
      "wiki-maintenance-settlement",
      "wiki-revision",
      "wiki-skill-proposal",
      "wikiskill-benchmark-envelope-manifest",
      "wikiskill-benchmark-execution-manifest",
      "wikiskill-benchmark-plan",
      "wikiskill-benchmark-report-chunk",
    ]);
    const results = EVOLUTION_ARTIFACT_LEDGER_RETENTION_TYPES.map((type) =>
      publish({
        retention: "ledger",
        type,
        value: { retained: type },
      }),
    );

    for (const result of results) {
      const core = JSON.parse(result.envelope).core;
      const entry = store.get(artifactId(result));
      expect(core).toMatchObject({ expiresAt: null, retention: "ledger" });
      expect(result.receipt).toMatchObject({
        expiresAt: null,
        retention: "ledger",
      });
      expect(result.receipt).not.toHaveProperty("storeExpiresAt");
      expect(Date.parse(entry.expiresAt) - Date.parse(entry.createdAt)).toBe(
        1_000_000 * 24 * 60 * 60 * 1000,
      );
      expect(Number.isFinite(Date.parse(entry.expiresAt))).toBe(true);
    }

    nowMs = Date.parse("2226-09-01T10:00:00.000Z");
    for (const [index, result] of results.entries()) {
      const resolved = resolveResult(result, {
        expectedType: EVOLUTION_ARTIFACT_LEDGER_RETENTION_TYPES[index],
      });
      expect(resolved.retention).toBe("ledger");
      expect(resolved.value).toEqual({
        retained: EVOLUTION_ARTIFACT_LEDGER_RETENTION_TYPES[index],
      });
    }
    const ledgerResolver = ports.createEvolutionLedgerArtifactResolver({
      purpose: PURPOSE,
    });
    expect(isEvolutionLedgerArtifactResolver(ledgerResolver)).toBe(true);
    expect(isEvolutionLedgerArtifactResolver(() => ledgerResolver)).toBe(false);
    expect(ledgerResolver(ledgerRequest(results[0]))).toMatchObject({
      authenticated: true,
      digest: results[0].digest,
      found: true,
    });
  }, 30_000);

  it("lets current authority trust an issued ledger policy after key/policy rotation and still applies revocation", () => {
    const result = publish({
      retention: "ledger",
      type: "skill-release-transition-intent",
      value: { transition: "prepared" },
    });
    const issuedCore = JSON.parse(result.envelope).core;

    authorityState.keyId = ROTATED_KEY_ID;
    authorityState.policyDigest = digestBytes("evolution-artifact-policy-v2");
    authorityState.policyRevision += 1;
    nowMs = Date.parse("2126-09-01T10:00:00.000Z");
    expect(
      resolveResult(result, {
        expectedType: "skill-release-transition-intent",
      }),
    ).toMatchObject({ authenticated: true, retention: "ledger" });
    expect(currentAuthorityResolver.resolve).toHaveBeenLastCalledWith(
      expect.objectContaining({
        issuedAt: issuedCore.issuedAt,
        issuedPolicyDigest: issuedCore.policyDigest,
        issuedPolicyRevision: issuedCore.policyRevision,
        keyId: KEY_ID,
        retention: "ledger",
      }),
    );

    authorityState.issuedPolicyTrusted = false;
    expect(
      capturedError(() =>
        resolveResult(result, {
          expectedType: "skill-release-transition-intent",
        }),
      ).code,
    ).toBe(EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE);

    authorityState.issuedPolicyTrusted = true;
    authorityState.revoked = true;
    authorityState.revocationRevision += 1;
    expect(
      capturedError(() =>
        resolveResult(result, {
          expectedType: "skill-release-transition-intent",
        }),
      ).code,
    ).toBe(EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE);
  });

  it("rejects ledger housekeeping metadata before portable Date arithmetic could overflow", () => {
    const housekeepingDurationMs = 1_000_000 * 24 * 60 * 60 * 1000;
    const unsafeNowMs = 8_640_000_000_000_000 - housekeepingDurationMs + 1;
    const boundaryStoreDir = path.join(tempRoot, "date-boundary");
    const boundaryPorts = new EvolutionArtifactPorts({
      artifactStore: new ArtifactStore({
        dir: boundaryStoreDir,
        now: () => unsafeNowMs,
      }),
      audience: AUDIENCE,
      currentAuthorityResolver,
      envelopeSigner,
      envelopeVerifier,
      now: () => unsafeNowMs,
      tenantId: TENANT_ID,
    });

    expect(
      capturedError(() =>
        boundaryPorts.putCanonical(
          "skill-mutation-audit",
          { boundary: true },
          { purpose: "skill-mutation", retention: "ledger" },
        ),
      ).code,
    ).toBe(EVOLUTION_ARTIFACT_STORE_FAILED_CODE);
    expect(currentAuthorityResolver.resolve).not.toHaveBeenCalled();
    expect(
      fs.readFileSync(path.join(boundaryStoreDir, "index.jsonl"), "utf8"),
    ).toBe("");
  });

  it("denies caller-selected infinite retention without an approved type, purpose, and authority", () => {
    expect(
      capturedError(() =>
        ports.putCanonical(
          "candidate",
          { denied: true },
          {
            purpose: PURPOSE,
            retention: "ledger",
          },
        ),
      ).code,
    ).toBe(EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE);
    expect(
      capturedError(() =>
        ports.putCanonical(
          "skill-release-finalization",
          { denied: true },
          { purpose: "skill-mutation", retention: "ledger" },
        ),
      ).code,
    ).toBe(EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE);
    expect(
      capturedError(() =>
        ports.putCanonical(
          "skill-mutation-nonce-claim",
          { denied: true },
          { purpose: "skill-mutation", retention: "ledger", ttlMs: 1 },
        ),
      ).code,
    ).toBe(EVOLUTION_ARTIFACT_INVALID_CODE);

    authorityState.allowed = false;
    expect(
      capturedError(() =>
        ports.putCanonical(
          "skill-mutation-audit",
          { denied: true },
          { purpose: "skill-mutation", retention: "ledger" },
        ),
      ).code,
    ).toBe(EVOLUTION_ARTIFACT_AUTHORITY_DENIED_CODE);
    expect(store.list()).toHaveLength(0);
  });

  it("rejects a signed envelope replayed with a mutated core", () => {
    const result = publish();
    const tampered = JSON.parse(result.envelope);
    tampered.core.authorityReceiptDigest = digestBytes("substituted-authority");
    const tamperedEnvelope = canonicalJson(tampered);

    expect(
      capturedError(() =>
        ports.resolve(tamperedEnvelope, {
          expectedDigest: result.digest,
          expectedType: "candidate",
          purpose: PURPOSE,
          tenantId: TENANT_ID,
        }),
      ).code,
    ).toBe(EVOLUTION_ARTIFACT_SIGNATURE_INVALID_CODE);
  });

  it("rejects stored-byte replacement even when the index still advertises the original hash", () => {
    const result = publish();
    const storedPath = store.storedPath(artifactId(result));
    fs.chmodSync(storedPath, 0o600);
    fs.writeFileSync(storedPath, "{}", "utf8");

    expect(capturedError(() => resolveResult(result)).code).toBe(
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
    );
  });

  it("rejects index recordDigest and exact-lineage replacement", () => {
    const result = publish();
    const resolver = ports.createEvolutionLedgerArtifactResolver({
      purpose: PURPOSE,
    });
    const rows = readIndex();
    rows[0].recordDigest = digestBytes("substituted-record");
    writeIndex(rows);

    expect(capturedError(() => resolver(ledgerRequest(result))).code).toBe(
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
    );

    rows[0].recordDigest = result.digest;
    rows[0].lineage.purpose = "promotion";
    writeIndex(rows);
    expect(capturedError(() => resolver(ledgerRequest(result))).code).toBe(
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
    );
  });

  it("rejects traversal in a tampered index before following the stored path", () => {
    const result = publish();
    const outside = path.join(tempRoot, "outside.json");
    fs.writeFileSync(outside, "secret-outside-store", "utf8");
    const rows = readIndex();
    rows[0].file = "../outside.json";
    writeIndex(rows);
    const resolver = ports.createEvolutionLedgerArtifactResolver({
      purpose: PURPOSE,
    });

    expect(capturedError(() => resolver(ledgerRequest(result))).code).toBe(
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
    );
    expect(fs.readFileSync(outside, "utf8")).toBe("secret-outside-store");
  });

  it("rejects a hard-linked ArtifactStore index before trusting repository API output", () => {
    const result = publish();
    fs.linkSync(
      path.join(storeDir, "index.jsonl"),
      path.join(tempRoot, "index-hardlink.jsonl"),
    );

    expect(capturedError(() => resolveResult(result)).code).toBe(
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
    );
  });

  it.runIf(process.platform !== "win32")(
    "rejects an ArtifactStore index replaced by a symlink",
    () => {
      const result = publish();
      const indexPath = path.join(storeDir, "index.jsonl");
      const movedIndex = path.join(tempRoot, "moved-index.jsonl");
      fs.renameSync(indexPath, movedIndex);
      fs.symlinkSync(movedIndex, indexPath, "file");

      expect(capturedError(() => resolveResult(result)).code).toBe(
        EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
      );
    },
  );

  it("rejects an ArtifactStore files directory replaced by a symlink or junction", () => {
    const result = publish();
    const filesPath = path.join(storeDir, "files");
    const movedFiles = path.join(tempRoot, "moved-files");
    fs.renameSync(filesPath, movedFiles);
    fs.symlinkSync(
      movedFiles,
      filesPath,
      process.platform === "win32" ? "junction" : "dir",
    );

    expect(capturedError(() => resolveResult(result)).code).toBe(
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
    );
  });

  it("rejects replacement of the captured ArtifactStore root identity", () => {
    const result = publish();
    const movedRoot = path.join(tempRoot, "moved-artifact-root");
    const priorIndex = fs.readFileSync(
      path.join(storeDir, "index.jsonl"),
      "utf8",
    );
    fs.renameSync(storeDir, movedRoot);
    fs.mkdirSync(path.join(storeDir, "files"), { recursive: true });
    fs.writeFileSync(path.join(storeDir, "index.jsonl"), priorIndex, "utf8");

    expect(capturedError(() => resolveResult(result)).code).toBe(
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
    );
  });

  it("rejects a replaced lineage envelope before releasing bytes", () => {
    const result = publish();
    const rows = readIndex();
    const tampered = JSON.parse(rows[0].lineage.envelope);
    tampered.core.policyDigest = digestBytes("attacker-policy");
    rows[0].lineage.envelope = canonicalJson(tampered);
    rows[0].lineage.envelopeDigest = digestBytes(
      Buffer.from(rows[0].lineage.envelope, "utf8"),
    );
    writeIndex(rows);
    const resolver = ports.createEvolutionLedgerArtifactResolver({
      purpose: PURPOSE,
    });

    expect(capturedError(() => resolver(ledgerRequest(result))).code).toBe(
      EVOLUTION_ARTIFACT_SIGNATURE_INVALID_CODE,
    );
  });

  it("requires a unique recordDigest and rejects an index above the adapter admission ceiling", () => {
    const result = publish();
    const rows = readIndex();
    rows.push({
      ...rows[0],
      file: "art_duplicate_00000000.json",
      id: "art_duplicate_00000000",
    });
    writeIndex(rows);
    expect(capturedError(() => resolveResult(result)).code).toBe(
      EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
    );

    class OversizedIndexStore extends ArtifactStore {
      list() {
        return Array.from(
          { length: EVOLUTION_ARTIFACT_MAX_INDEX_ENTRIES + 1 },
          () => ({}),
        );
      }
    }
    const oversizedPorts = new EvolutionArtifactPorts({
      artifactStore: new OversizedIndexStore({
        dir: path.join(tempRoot, "oversized"),
      }),
      audience: AUDIENCE,
      currentAuthorityResolver,
      envelopeSigner,
      envelopeVerifier,
      now: () => nowMs,
      tenantId: TENANT_ID,
    });
    expect(
      capturedError(() =>
        oversizedPorts.resolve(result.envelope, {
          expectedDigest: result.digest,
          expectedType: "candidate",
          purpose: PURPOSE,
          tenantId: TENANT_ID,
        }),
      ).code,
    ).toBe(EVOLUTION_ARTIFACT_STORE_FAILED_CODE);
  });

  it("cross-checks captured ArtifactStore list/get results against the trusted descriptor snapshot", () => {
    const result = publish();
    const forgedRows = readIndex();
    class LyingListStore extends ArtifactStore {
      list() {
        return forgedRows;
      }
    }
    const lyingListPorts = new EvolutionArtifactPorts({
      artifactStore: new LyingListStore({
        dir: path.join(tempRoot, "lying-list"),
      }),
      audience: AUDIENCE,
      currentAuthorityResolver,
      envelopeSigner,
      envelopeVerifier,
      now: () => nowMs,
      tenantId: TENANT_ID,
    });
    expect(
      capturedError(() =>
        lyingListPorts.resolve(result.envelope, {
          expectedDigest: result.digest,
          expectedType: "candidate",
          purpose: PURPOSE,
          tenantId: TENANT_ID,
        }),
      ).code,
    ).toBe(EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE);

    let lieOnGet = false;
    class LyingGetStore extends ArtifactStore {
      get(id) {
        const entry = super.get(id);
        return lieOnGet && entry
          ? { ...entry, title: "substituted title" }
          : entry;
      }
    }
    const lyingGetPorts = new EvolutionArtifactPorts({
      artifactStore: new LyingGetStore({
        dir: path.join(tempRoot, "lying-get"),
        now: () => nowMs,
      }),
      audience: AUDIENCE,
      currentAuthorityResolver,
      envelopeSigner,
      envelopeVerifier,
      now: () => nowMs,
      tenantId: TENANT_ID,
    });
    const lyingGetResult = lyingGetPorts.putCanonical(
      "candidate",
      { trustworthy: true },
      { purpose: PURPOSE, ttlMs: 60_000 },
    );
    lieOnGet = true;
    expect(
      capturedError(() =>
        lyingGetPorts.resolve(lyingGetResult.envelope, {
          expectedDigest: lyingGetResult.digest,
          expectedType: "candidate",
          purpose: PURPOSE,
          tenantId: TENANT_ID,
        }),
      ).code,
    ).toBe(EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE);
  });

  it("captures and freezes trusted ports so later monkeypatching cannot redirect authority", () => {
    expect(Object.isFrozen(store)).toBe(true);
    const result = publish();
    envelopeSigner.sign = () => ({
      algorithm: ALGORITHM,
      keyId: KEY_ID,
      value: "A".repeat(43),
    });
    envelopeVerifier.verify = () => false;
    currentAuthorityResolver.resolve = () => {
      throw new Error("post-construction monkeypatch");
    };

    expect(resolveResult(result).authenticated).toBe(true);
  });

  it("fails putCanonical when a store mutates bytes before immediate readback", () => {
    class TamperingStore extends ArtifactStore {
      publishDataOnce(options) {
        const publication = super.publishDataOnce(options);
        const target = this.storedPath(publication.entry);
        fs.chmodSync(target, 0o600);
        fs.writeFileSync(target, "{}", "utf8");
        return publication;
      }
    }
    const tamperingPorts = new EvolutionArtifactPorts({
      artifactStore: new TamperingStore({
        dir: path.join(tempRoot, "tampering"),
        now: () => nowMs,
      }),
      audience: AUDIENCE,
      currentAuthorityResolver,
      envelopeSigner,
      envelopeVerifier,
      now: () => nowMs,
      tenantId: TENANT_ID,
    });

    expect(
      capturedError(() =>
        tamperingPorts.putCanonical(
          "candidate",
          { ok: true },
          {
            purpose: PURPOSE,
            ttlMs: 60_000,
          },
        ),
      ).code,
    ).toBe(EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE);
  });
});
