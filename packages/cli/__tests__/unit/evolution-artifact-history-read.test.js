import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EvolutionArtifactPorts,
  captureEvolutionLedgerWholeHistoryReader,
  EVOLUTION_ARTIFACT_EXPIRED_CODE,
  EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
  EVOLUTION_ARTIFACT_INVALID_CODE,
  EVOLUTION_ARTIFACT_MAX_CANONICAL_BYTES,
  EVOLUTION_ARTIFACT_MAX_INDEX_ENTRIES,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import { openArtifactByteFixture } from "../fixtures/evolution-artifact-bytes.js";
import { evolutionDurableStoreConfiguration } from "../fixtures/evolution-durable-store.js";

const temp = fs.realpathSync.native(os.tmpdir());
let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(temp, "cc-artifact-history-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  if (
    path.dirname(root) !== temp ||
    !path.basename(root).startsWith("cc-artifact-history-")
  )
    throw new Error("unsafe history test cleanup");
  fs.rmSync(root, { recursive: true, force: true });
});

function fixture(options = {}) {
  const result = openArtifactByteFixture(path.join(root, "artifacts"), options);
  const config = evolutionDurableStoreConfiguration(root, {
    artifactTenantId: "bytes-artifacts",
    audience: "bytes-runtime",
  });
  const hooks = {
    calls: 0,
    signatures: 0,
    now: config.clock(),
    onResolve: null,
    firstLeaseMs: null,
  };
  const ports = new EvolutionArtifactPorts({
    artifactStore: result.store,
    tenantId: "bytes-artifacts",
    audience: "bytes-runtime",
    now: () => hooks.now,
    ...config.artifactAuthority,
    currentAuthorityResolver: {
      resolve(request) {
        hooks.calls += 1;
        hooks.onResolve?.(hooks.calls);
        const decision =
          config.artifactAuthority.currentAuthorityResolver.resolve(request);
        if (hooks.calls === 1 && hooks.firstLeaseMs !== null) {
          const { receiptDigest: _receipt, ...core } = decision;
          core.decisionExpiresAt = new Date(
            hooks.now + hooks.firstLeaseMs,
          ).toISOString();
          const canonical = `{${Object.keys(core)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${JSON.stringify(core[key])}`)
            .join(",")}}`;
          return {
            ...core,
            receiptDigest: `sha256:${createHash("sha256").update(`chainlesschain.evolution-artifact-authority-decision/v1\0${canonical}`).digest("hex")}`,
          };
        }
        return decision;
      },
    },
    envelopeVerifier: {
      verify(request) {
        hooks.signatures += 1;
        return config.artifactAuthority.envelopeVerifier.verify(request);
      },
    },
  });
  const resolver = ports.createEvolutionLedgerArtifactResolver({
    purpose: "evolution-ledger",
  });
  return {
    ...result,
    hooks,
    resolver,
    read: captureEvolutionLedgerWholeHistoryReader(resolver),
    requests: (count) =>
      Array.from({ length: count }, () => structuredClone(result.request)),
  };
}

function countOpens(target, onOpen = () => {}) {
  const original = fs.openSync;
  let count = 0;
  vi.spyOn(fs, "openSync").mockImplementation((name, ...args) => {
    if (name === target) onOpen(++count);
    return original(name, ...args);
  });
  return () => count;
}

describe("sealed evolution artifact history", () => {
  it("authenticates all 129 payloads and authorities between two complete index reads", () => {
    const f = fixture();
    const opened = vi.spyOn(fs, "openSync");
    const results = f.read(f.requests(129));
    expect(results).toHaveLength(129);
    expect(Object.isFrozen(results)).toBe(true);
    expect(
      results.every((result) => result.authenticated && result.found),
    ).toBe(true);
    expect(f.hooks.calls).toBe(129);
    expect(f.hooks.signatures).toBe(129);
    expect(
      opened.mock.calls.filter(([target]) => target === f.target),
    ).toHaveLength(129);
    expect(
      opened.mock.calls.filter(([target]) => target === f.store._indexFile()),
    ).toHaveLength(2);
  });

  it("withholds the complete result when the final chunk changes index bytes", () => {
    const f = fixture();
    f.hooks.onResolve = (count) => {
      if (count === 129) fs.appendFileSync(f.store._indexFile(), "\n");
    };
    let released;
    expect(() => {
      released = f.read(f.requests(129));
    }).toThrowError(
      expect.objectContaining({
        code: EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
      }),
    );
    expect(f.hooks.calls).toBe(129);
    expect(released).toBeUndefined();
  });

  it("withholds earlier results when a later payload has same-size tampering", () => {
    const f = fixture();
    const before = fs.statSync(f.target);
    f.hooks.onResolve = (count) => {
      if (count !== 129) return;
      const bytes = fs.readFileSync(f.target);
      const index = bytes.indexOf(Buffer.from("genuine"));
      expect(index).toBeGreaterThan(0);
      bytes[index] = "G".charCodeAt(0);
      fs.chmodSync(f.target, 0o600);
      fs.writeFileSync(f.target, bytes);
      fs.utimesSync(f.target, before.atime, before.mtime);
    };
    expect(() => f.read(f.requests(129))).toThrowError(
      expect.objectContaining({
        code: EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
      }),
    );
    expect(fs.statSync(f.target).size).toBe(before.size);
    expect(f.hooks.calls).toBe(129);
  });

  it("rechecks every lease after the final index read before releasing history", () => {
    const f = fixture();
    f.hooks.firstLeaseMs = 1;
    const opens = countOpens(f.store._indexFile(), (count) => {
      // Only the first item's lease expires; the later 128 remain valid.
      if (count === 2) f.hooks.now += 1;
    });
    expect(() => f.read(f.requests(129))).toThrowError(
      expect.objectContaining({
        code: EVOLUTION_ARTIFACT_EXPIRED_CODE,
        message: "artifact authority expired before ledger history release",
      }),
    );
    expect(opens()).toBe(2);
    expect(f.hooks.calls).toBe(129);
  });

  it("withholds results and normalizes a held-directory identity failure at final release", () => {
    const f = fixture();
    const originalOpen = fs.openSync,
      originalStat = fs.fstatSync;
    let directoryFd = null,
      payloadOpens = 0,
      injected = false;
    vi.spyOn(fs, "openSync").mockImplementation((target, ...args) => {
      const fd = originalOpen(target, ...args);
      if (target === path.dirname(f.target)) directoryFd = fd;
      if (target === f.target) payloadOpens += 1;
      return fd;
    });
    vi.spyOn(fs, "fstatSync").mockImplementation((fd, ...args) => {
      const stat = originalStat(fd, ...args);
      if (fd === directoryFd && payloadOpens === 129) {
        injected = true;
        stat.ino += typeof stat.ino === "bigint" ? 1n : 1;
      }
      return stat;
    });
    expect(() => f.read(f.requests(129))).toThrowError(
      expect.objectContaining({
        code: EVOLUTION_ARTIFACT_INTEGRITY_FAILED_CODE,
        cause: expect.objectContaining({
          code: "CC_ARTIFACT_BOUNDED_READ_FAILED",
        }),
      }),
    );
    expect(injected).toBe(true);
    expect(f.hooks.calls).toBe(129);
  });

  it("captures future chunk requests before invoking any authority callback", () => {
    const f = fixture();
    const requests = f.requests(129);
    f.hooks.onResolve = (count) => {
      if (count === 1) requests[128].tenantId = "other-tenant";
    };
    expect(f.read(requests)).toHaveLength(129);
    expect(requests[128].tenantId).toBe("other-tenant");
  });

  it("does not invoke inherited array slice or species callbacks", () => {
    const f = fixture();
    class HostileArray extends Array {
      slice() {
        throw new Error("caller slice invoked");
      }
      static get [Symbol.species]() {
        throw new Error("caller species invoked");
      }
    }
    const requests = new HostileArray();
    requests.push(...f.requests(129));
    expect(f.read(requests)).toHaveLength(129);
  });

  it("keeps the 10000-request admission limit and per-chunk canonical budget", () => {
    const f = fixture();
    const requests = f.requests(EVOLUTION_ARTIFACT_MAX_INDEX_ENTRIES);
    expect(Buffer.byteLength(JSON.stringify(requests))).toBeGreaterThan(
      EVOLUTION_ARTIFACT_MAX_CANONICAL_BYTES,
    );
    f.hooks.onResolve = () => {
      throw new Error("admitted history reached authority");
    };
    expect(() => f.read(requests)).toThrow();
    expect(f.hooks.calls).toBe(1);
    requests.push(structuredClone(f.request));
    expect(() => f.read(requests)).toThrowError(
      expect.objectContaining({ code: EVOLUTION_ARTIFACT_INVALID_CODE }),
    );
    expect(f.hooks.calls).toBe(1);
  });

  it("denies unbranded and counterfeit resolver capabilities", () => {
    expect(() => captureEvolutionLedgerWholeHistoryReader(() => {})).toThrow(
      TypeError,
    );
    const f = fixture();
    expect(() =>
      captureEvolutionLedgerWholeHistoryReader(new Proxy(f.resolver, {})),
    ).toThrow(TypeError);
  });

  it.each(["plain", "get", "list", "verifyIntegrity"])(
    "preserves the legacy path for a store subclass (%s)",
    (method) => {
      class CustomStore extends ArtifactStore {}
      const calls = [];
      if (method !== "plain") {
        CustomStore.prototype[method] = function (...args) {
          calls.push(method);
          return ArtifactStore.prototype[method].apply(this, args);
        };
      }
      const f = fixture({ Store: CustomStore });
      expect(f.read).toBeNull();
      calls.length = 0;
      expect(f.resolver(f.request)).toMatchObject({
        authenticated: true,
        found: true,
      });
      if (method === "verifyIntegrity") expect(calls).toEqual([method, method]);
    },
  );

  it("uses full per-file verification if a retained reader loses default path methods", () => {
    const f = fixture();
    const original = ArtifactStore.prototype._filesDir;
    vi.spyOn(ArtifactStore.prototype, "_filesDir").mockImplementation(
      function () {
        return original.call(this);
      },
    );
    expect(captureEvolutionLedgerWholeHistoryReader(f.resolver)).toBeNull();
    const opens = countOpens(f.target);
    expect(f.read(f.requests(2))).toHaveLength(2);
    // Captured default integrity hook before, authenticated read, hook after.
    expect(opens()).toBe(6);
  });
});
