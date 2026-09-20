import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  VOLCENGINE_FUNCTION_REVOCATION_STATUS_FLOOR_MODE,
  VOLCENGINE_FUNCTION_REVOCATION_STATUS_FLOOR_STORE_SCHEMA,
  VOLCENGINE_FUNCTION_REVOCATION_STATUS_SNAPSHOT_SCHEMA,
  captureVolcengineFunctionRevocationStatusFloorStore,
  createVolcengineFunctionRevocationStatusFloorStore,
  digestVolcengineFunctionRevocationStatusFloorRoot,
} from "../../src/lib/evolution/volcengine-function-revocation-status-floor-store.js";

const roots = [];
const NOW = Date.parse("2026-09-21T03:00:00.000Z");

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function sha(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function root() {
  const value = mkdtempSync(join(tmpdir(), "cc-revocation-status-floor-"));
  roots.push(value);
  return value;
}

function descriptor(directoryPath, overrides = {}) {
  return {
    schema: VOLCENGINE_FUNCTION_REVOCATION_STATUS_FLOOR_STORE_SCHEMA,
    storeId: "revocation-status-floor:test",
    tenantId: "tenant:test",
    handlerArtifactDigest: sha("signed-deployment"),
    revocationAuthorityId: "function-revocation:test",
    trustRootDigest: sha("trust-root"),
    stateRootDigest:
      digestVolcengineFunctionRevocationStatusFloorRoot(directoryPath),
    mode: VOLCENGINE_FUNCTION_REVOCATION_STATUS_FLOOR_MODE,
    ...overrides,
  };
}

function snapshot(revision, overrides = {}) {
  return {
    schema: VOLCENGINE_FUNCTION_REVOCATION_STATUS_SNAPSHOT_SCHEMA,
    storeId: "revocation-status-floor:test",
    tenantId: "tenant:test",
    handlerArtifactDigest: sha("signed-deployment"),
    revocationAuthorityId: "function-revocation:test",
    trustRootDigest: sha("trust-root"),
    revision,
    snapshotDigest: sha(`snapshot-${revision}`),
    issuedAt: new Date(NOW + revision * 1000).toISOString(),
    nextUpdate: new Date(NOW + (revision + 60) * 1000).toISOString(),
    ...overrides,
  };
}

function open(directoryPath, overrides = {}) {
  return captureVolcengineFunctionRevocationStatusFloorStore(
    createVolcengineFunctionRevocationStatusFloorStore({
      descriptor: descriptor(directoryPath, overrides),
      directoryPath,
    }),
  );
}

describe("Volcengine function revocation status floor store", () => {
  it("durably advances one revision floor and preserves it after reopen", () => {
    const directoryPath = root();
    const first = open(directoryPath);

    expect(first.readFloor()).toBeNull();
    const firstAck = first.acceptSnapshot(snapshot(2));
    expect(firstAck).toMatchObject({
      revision: 2,
      snapshotDigest: sha("snapshot-2"),
      durable: true,
      readbackVerified: true,
    });

    const reopened = open(directoryPath);
    expect(reopened.readFloor()).toMatchObject({
      revision: 2,
      snapshotDigest: sha("snapshot-2"),
      headDigest: firstAck.headDigest,
    });
    expect(reopened.acceptSnapshot(snapshot(2))).toEqual(firstAck);
    expect(reopened.acceptSnapshot(snapshot(3))).toMatchObject({
      revision: 3,
      snapshotDigest: sha("snapshot-3"),
      durable: true,
      readbackVerified: true,
    });
  });

  it("rejects rollback and same-revision substitution across instances", () => {
    const directoryPath = root();
    open(directoryPath).acceptSnapshot(snapshot(4));
    const sibling = open(directoryPath);

    expect(() => sibling.acceptSnapshot(snapshot(3))).toThrowError(
      expect.objectContaining({
        code: "CC_VOLCENGINE_FUNCTION_REVOCATION_STATUS_ROLLBACK",
      }),
    );
    expect(() =>
      sibling.acceptSnapshot(
        snapshot(4, { snapshotDigest: sha("substituted-snapshot") }),
      ),
    ).toThrow("conflicts at the current revision");
    expect(() =>
      sibling.acceptSnapshot(
        snapshot(5, { issuedAt: new Date(NOW + 4000).toISOString() }),
      ),
    ).toThrow("issue time did not advance");
  });

  it("fails closed for a forged store, path substitution, or corrupt state", () => {
    expect(() =>
      captureVolcengineFunctionRevocationStatusFloorStore(Object.freeze({})),
    ).toThrow("branded Volcengine function revocation status floor store");

    const directoryPath = root();
    const foreignRoot = root();
    expect(() =>
      createVolcengineFunctionRevocationStatusFloorStore({
        descriptor: descriptor(directoryPath),
        directoryPath: foreignRoot,
      }),
    ).toThrow("state root does not match descriptor");

    const port = open(directoryPath);
    port.acceptSnapshot(snapshot(1));
    writeFileSync(join(directoryPath, "manifest-head.json"), "{", "utf8");
    expect(() => port.readFloor()).toThrow("valid UTF-8 JSON");
  });
});
