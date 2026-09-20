import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  VOLCENGINE_FUNCTION_REPLAY_MODE,
  VOLCENGINE_FUNCTION_REPLAY_RESERVATION_SCHEMA,
  VOLCENGINE_FUNCTION_REPLAY_STORE_SCHEMA,
  VOLCENGINE_FUNCTION_REVOCATION_MODE,
  VOLCENGINE_FUNCTION_REVOCATION_SCHEMA,
  captureVolcengineFunctionReplayStore,
  createVolcengineFunctionReplayStore,
} from "../../src/lib/evolution/volcengine-function-replay-store.js";

const NOW = Date.parse("2026-09-21T00:00:00.000Z");
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0`)
    .update(canonical(value))
    .digest("hex")}`;
}

function sha(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function descriptor(overrides = {}) {
  return {
    schema: VOLCENGINE_FUNCTION_REPLAY_STORE_SCHEMA,
    replayStoreId: "replay:test",
    authorityId: "authority:test",
    revocationAuthorityId: "function-revocation:test",
    tenantId: "tenant:test",
    handlerArtifactDigest: sha("handler"),
    policyRevision: "policy-1",
    retentionMs: 65_000,
    mode: VOLCENGINE_FUNCTION_REPLAY_MODE,
    revocationMode: VOLCENGINE_FUNCTION_REVOCATION_MODE,
    ...overrides,
  };
}

function revocation(overrides = {}) {
  const core = {
    schema: VOLCENGINE_FUNCTION_REVOCATION_SCHEMA,
    replayStoreId: "replay:test",
    authorityId: "authority:test",
    revocationAuthorityId: "function-revocation:test",
    tenantId: "tenant:test",
    handlerArtifactDigest: sha("handler"),
    policyRevision: "policy-1",
    revocationId: "revocation-1",
    reasonDigest: sha("operator-request"),
    authorizationRequestDigest: sha("authorization-request"),
    authorizationEvidenceDigest: sha("authorization-evidence"),
    auditEventDigest: sha("revocation-audit"),
    durabilityReceiptDigest: sha("revocation-durability"),
    evidenceResolverDigest: sha("revocation-evidence-resolver"),
    evidenceReadbackDigest: sha("revocation-evidence-readback"),
    revokedAt: new Date(NOW).toISOString(),
    ...overrides,
  };
  return {
    ...core,
    revocationDigest: digest(VOLCENGINE_FUNCTION_REVOCATION_SCHEMA, core),
  };
}

function reservation(overrides = {}) {
  const core = {
    schema: VOLCENGINE_FUNCTION_REPLAY_RESERVATION_SCHEMA,
    replayStoreId: "replay:test",
    authorityId: "authority:test",
    tenantId: "tenant:test",
    handlerArtifactDigest: sha("handler"),
    policyRevision: "policy-1",
    requestId: "request-1",
    requestDigest: sha("request-1"),
    expiresAt: new Date(NOW + 65_000).toISOString(),
    ...overrides,
  };
  return {
    ...core,
    reservationDigest: digest(
      VOLCENGINE_FUNCTION_REPLAY_RESERVATION_SCHEMA,
      core,
    ),
  };
}

function root() {
  const value = mkdtempSync(join(tmpdir(), "cc-volcengine-replay-store-"));
  roots.push(value);
  return value;
}

function store(rootDir, now) {
  return createVolcengineFunctionReplayStore({
    descriptor: descriptor(),
    rootDir,
    now,
  });
}

function runWorker(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(
          new URL(
            "./helpers/volcengine-function-replay-worker.mjs",
            import.meta.url,
          ),
        ),
        ...args,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(`replay worker exited ${code}: ${stderr}`));
        return;
      }
      resolve(JSON.parse(stdout));
    });
  });
}

function runRevocationReader(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(
          new URL(
            "./helpers/volcengine-function-revocation-reader-worker.mjs",
            import.meta.url,
          ),
        ),
        ...args,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(`revocation reader exited ${code}: ${stderr}`));
        return;
      }
      resolve(JSON.parse(stdout));
    });
  });
}

describe("Volcengine function replay store", () => {
  it.each(["v1", "v2"])("rejects legacy %s store descriptors", (version) => {
    expect(() =>
      createVolcengineFunctionReplayStore({
        descriptor: descriptor({
          schema: `chainlesschain.volcengine-function-replay-store/${version}`,
        }),
        rootDir: root(),
        now: () => NOW,
      }),
    ).toThrow("Volcengine function replay store descriptor is invalid");
  });

  it("durably reserves a request and rejects it through a reopened store", () => {
    const rootDir = root();
    const first = store(rootDir, () => NOW);
    const port = captureVolcengineFunctionReplayStore(first);
    const value = reservation();

    expect(Object.isFrozen(first)).toBe(true);
    expect(Reflect.ownKeys(first)).toEqual([]);
    expect(port.reserve(value)).toEqual({
      reservationDigest: value.reservationDigest,
      durable: true,
      readbackVerified: true,
    });
    expect(readdirSync(join(rootDir, "reservations"))).toHaveLength(1);

    const reopened = captureVolcengineFunctionReplayStore(
      store(rootDir, () => NOW),
    );
    expect(() => reopened.reserve(value)).toThrow(
      "Volcengine function request was replayed",
    );
  });

  it("removes an expired reservation under the cross-process lock", () => {
    const rootDir = root();
    let nowMs = NOW;
    const port = captureVolcengineFunctionReplayStore(
      store(rootDir, () => nowMs),
    );
    const first = reservation({ expiresAt: new Date(NOW + 1).toISOString() });
    expect(port.reserve(first).durable).toBe(true);

    nowMs += 2;
    const second = reservation({
      requestDigest: sha("request-1-reused-after-expiry"),
      expiresAt: new Date(NOW + 65_002).toISOString(),
    });
    expect(port.reserve(second)).toMatchObject({
      reservationDigest: second.reservationDigest,
      durable: true,
      readbackVerified: true,
    });
    expect(readdirSync(join(rootDir, "reservations"))).toHaveLength(1);
  });

  it("allows exactly one reservation across competing processes", async () => {
    const rootDir = root();
    const readyDir = join(rootDir, "ready");
    const gatePath = join(rootDir, "start.gate");
    const descriptorPath = join(rootDir, "descriptor.json");
    const reservationPath = join(rootDir, "reservation.json");
    mkdirSync(readyDir);
    writeFileSync(descriptorPath, JSON.stringify(descriptor()), "utf8");
    writeFileSync(reservationPath, JSON.stringify(reservation()), "utf8");
    const args = [
      rootDir,
      descriptorPath,
      reservationPath,
      readyDir,
      gatePath,
      String(NOW),
    ];
    const workers = [runWorker(args), runWorker(args)];
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (readdirSync(readyDir).length === 2) break;
      await delay(10);
    }
    expect(readdirSync(readyDir)).toHaveLength(2);
    expect(existsSync(gatePath)).toBe(false);
    writeFileSync(gatePath, "start", { encoding: "utf8", flag: "wx" });

    const outcomes = await Promise.all(workers);
    expect(outcomes.map((entry) => entry.status).sort()).toEqual([
      "rejected",
      "reserved",
    ]);
    expect(outcomes.find((entry) => entry.status === "rejected")).toMatchObject(
      {
        code: "CC_VOLCENGINE_FUNCTION_REQUEST_REPLAYED",
        message: "Volcengine function request was replayed",
      },
    );
    expect(readdirSync(join(rootDir, "reservations"))).toHaveLength(1);
  });

  it("fails closed and retains the reservation when directory fsync fails", () => {
    const rootDir = root();
    const port = captureVolcengineFunctionReplayStore(
      store(rootDir, () => NOW),
    );
    const originalFsync = fs.fsyncSync;
    let syncCalls = 0;
    const sync = vi.spyOn(fs, "fsyncSync").mockImplementation((descriptor) => {
      syncCalls += 1;
      if (syncCalls === 2) throw new Error("simulated directory sync failure");
      return originalFsync(descriptor);
    });

    try {
      expect(() => port.reserve(reservation())).toThrow(
        expect.objectContaining({
          code: "CC_VOLCENGINE_FUNCTION_REPLAY_DURABILITY_UNKNOWN",
          message:
            "Volcengine function replay reservation durability is unknown",
        }),
      );
    } finally {
      sync.mockRestore();
    }

    const reopened = captureVolcengineFunctionReplayStore(
      store(rootDir, () => NOW),
    );
    expect(() => reopened.reserve(reservation())).toThrow(
      "Volcengine function request was replayed",
    );
  });

  it("retains a malformed crash record without disabling unrelated IDs", () => {
    const rootDir = root();
    const port = captureVolcengineFunctionReplayStore(
      store(rootDir, () => NOW),
    );
    writeFileSync(
      join(rootDir, "reservations", `${"0".repeat(64)}.json`),
      "partial",
      { encoding: "utf8", flag: "wx" },
    );
    const unrelated = reservation({
      requestId: "request-unrelated",
      requestDigest: sha("request-unrelated"),
    });

    expect(port.reserve(unrelated)).toMatchObject({
      reservationDigest: unrelated.reservationDigest,
      durable: true,
      readbackVerified: true,
    });
    expect(readdirSync(join(rootDir, "reservations"))).toHaveLength(2);
  });

  it("rejects forged stores and reservation binding substitution", () => {
    expect(() =>
      captureVolcengineFunctionReplayStore(Object.freeze({})),
    ).toThrow("branded Volcengine function replay store");
    const port = captureVolcengineFunctionReplayStore(store(root(), () => NOW));
    expect(() =>
      port.reserve(reservation({ tenantId: "tenant:foreign" })),
    ).toThrow("Volcengine function replay reservation is invalid");
  });

  it("durably publishes one revocation and reopens it across instances", () => {
    const rootDir = root();
    const first = captureVolcengineFunctionReplayStore(
      store(rootDir, () => NOW),
    );
    const value = revocation();

    expect(first.readRevocation()).toBeNull();
    expect(first.revoke(value)).toEqual({
      revocationDigest: value.revocationDigest,
      durable: true,
      readbackVerified: true,
    });
    const reopened = captureVolcengineFunctionReplayStore(
      store(rootDir, () => NOW),
    );
    expect(reopened.readRevocation()).toMatchObject({
      revocationId: "revocation-1",
      revocationAuthorityId: "function-revocation:test",
      authorizationRequestDigest: sha("authorization-request"),
      evidenceResolverDigest: sha("revocation-evidence-resolver"),
      evidenceReadbackDigest: sha("revocation-evidence-readback"),
      revocationDigest: value.revocationDigest,
    });
    expect(reopened.revoke(value)).toMatchObject({
      revocationDigest: value.revocationDigest,
      durable: true,
      readbackVerified: true,
    });
    expect(() =>
      reopened.revoke(revocation({ revocationId: "revocation-conflict" })),
    ).toThrow("conflicts with existing record");
    expect(() =>
      reopened.revoke(
        revocation({ revocationAuthorityId: "function-revocation:foreign" }),
      ),
    ).toThrow("Volcengine function authority revocation is invalid");
    expect(() =>
      reopened.revoke(
        revocation({
          schema: "chainlesschain.volcengine-function-authority-revocation/v2",
        }),
      ),
    ).toThrow("Volcengine function authority revocation is invalid");
  });

  it("publishes durable revocation to a separate process", async () => {
    const rootDir = root();
    const descriptorPath = join(rootDir, "descriptor.json");
    const readyPath = join(rootDir, "revocation-reader.ready");
    writeFileSync(descriptorPath, JSON.stringify(descriptor()), "utf8");
    const port = captureVolcengineFunctionReplayStore(
      store(rootDir, () => NOW),
    );
    const reader = runRevocationReader([
      rootDir,
      descriptorPath,
      readyPath,
      String(NOW),
    ]);
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (existsSync(readyPath)) break;
      await delay(10);
    }
    expect(existsSync(readyPath)).toBe(true);

    const value = revocation();
    expect(port.revoke(value)).toMatchObject({
      revocationDigest: value.revocationDigest,
      durable: true,
      readbackVerified: true,
    });
    await expect(reader).resolves.toMatchObject({
      status: "revoked",
      revocation: {
        revocationId: value.revocationId,
        revocationDigest: value.revocationDigest,
      },
    });
  });

  it("fails closed but retains revocation when directory fsync fails", () => {
    const rootDir = root();
    const port = captureVolcengineFunctionReplayStore(
      store(rootDir, () => NOW),
    );
    const originalFsync = fs.fsyncSync;
    let syncCalls = 0;
    const sync = vi.spyOn(fs, "fsyncSync").mockImplementation((descriptor) => {
      syncCalls += 1;
      if (syncCalls === 2) throw new Error("simulated directory sync failure");
      return originalFsync(descriptor);
    });

    const value = revocation();
    try {
      expect(() => port.revoke(value)).toThrow(
        expect.objectContaining({
          code: "CC_VOLCENGINE_FUNCTION_REVOCATION_DURABILITY_UNKNOWN",
          message: "Volcengine function revocation durability is unknown",
        }),
      );
    } finally {
      sync.mockRestore();
    }

    const reopened = captureVolcengineFunctionReplayStore(
      store(rootDir, () => NOW),
    );
    expect(reopened.readRevocation()).toMatchObject({
      revocationDigest: value.revocationDigest,
    });
    expect(reopened.revoke(value)).toMatchObject({
      revocationDigest: value.revocationDigest,
      durable: true,
      readbackVerified: true,
    });
  });
});
