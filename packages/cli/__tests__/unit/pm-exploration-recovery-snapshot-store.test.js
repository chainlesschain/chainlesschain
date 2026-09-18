import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { replicaAuthority } from "../fixtures/skill-revocation-release-registry.js";
import {
  PM_EXPLORATION_RECOVERY_SNAPSHOT_ACK_SCHEMA,
  PM_EXPLORATION_RECOVERY_SNAPSHOT_CORRUPT_CODE,
  PM_EXPLORATION_RECOVERY_SNAPSHOT_REQUEST_SCHEMA,
  capturePmExplorationRecoverySnapshotStore,
  createPmExplorationRecoverySnapshotStore,
  verifyPmExplorationRecoverySnapshotAck,
} from "../../src/lib/evolution/pm-exploration-recovery-snapshot-store.js";

const roots = [];

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(Buffer.isBuffer(value) ? value : canonical(value))
    .digest("hex")}`;
}

function sha(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function seal(bytes) {
  const core = {
    schema: "chainlesschain.desktop-pm-database-pre-run-seal/v1",
    databasePathDigest: sha("isolated-clone-path"),
    databaseSnapshotDigest: hash(
      "chainlesschain.desktop-pm-database-snapshot/v1",
      bytes,
    ),
    databaseSnapshotBytes: bytes.byteLength,
    snapshotMethod: "database-manager-backup",
  };
  return Object.freeze({
    ...core,
    sealDigest: hash(core.schema, core),
  });
}

function resources(transform = (value) => value) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-pm-recovery-snapshot-"),
  );
  roots.push(root);
  const authority = transform(replicaAuthority(path.join(root, "replica")));
  const manifestDigest = sha("snapshot-manifest");
  const create = () =>
    capturePmExplorationRecoverySnapshotStore(
      createPmExplorationRecoverySnapshotStore({
        manifestDigest,
        artifactTenantId: "artifact-tenant-pm-recovery",
        purpose: "evolution-ledger",
        durabilityAuthority: authority,
      }),
    );
  return { root, authority, manifestDigest, create };
}

function request(manifestDigest, bytes, transitionKind = "success") {
  return {
    schema: PM_EXPLORATION_RECOVERY_SNAPSHOT_REQUEST_SCHEMA,
    manifestDigest,
    transitionKind,
    snapshotRole: transitionKind === "success" ? "post-run" : "pre-run",
    evidenceDigest: sha(`${transitionKind}-evidence`),
    seal: seal(bytes),
    bytes,
  };
}

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe("PM exploration recovery snapshot store", () => {
  it("retains and exactly reads back success and failure database snapshots", () => {
    const fixture = resources();
    const firstStore = fixture.create();
    const success = request(
      fixture.manifestDigest,
      Buffer.from("sqlite-success-snapshot"),
    );
    const failure = request(
      fixture.manifestDigest,
      Buffer.from("sqlite-pre-failure-snapshot"),
      "failure",
    );

    const successAck = firstStore.retainTransitionSnapshot(success);
    const failureAck = firstStore.retainTransitionSnapshot(failure);
    expect(successAck).toMatchObject({
      schema: PM_EXPLORATION_RECOVERY_SNAPSHOT_ACK_SCHEMA,
      authenticated: true,
      durable: true,
      readbackVerified: true,
      manifestDigest: fixture.manifestDigest,
      transitionKind: "success",
      snapshotRole: "post-run",
      evidenceDigest: success.evidenceDigest,
      sealDigest: success.seal.sealDigest,
      databaseSnapshotDigest: success.seal.databaseSnapshotDigest,
      databaseSnapshotBytes: success.bytes.byteLength,
      qualifiesForPromotion: false,
    });
    expect(failureAck).toMatchObject({
      transitionKind: "failure",
      snapshotRole: "pre-run",
      evidenceDigest: failure.evidenceDigest,
    });
    expect(Object.isFrozen(successAck)).toBe(true);
    expect(
      verifyPmExplorationRecoverySnapshotAck(successAck, {
        manifestDigest: fixture.manifestDigest,
        transitionKind: "success",
        evidenceDigest: success.evidenceDigest,
        sealDigest: success.seal.sealDigest,
      }),
    ).toEqual(successAck);

    const reopened = fixture.create();
    expect(reopened.retainTransitionSnapshot(success)).toEqual(successAck);
    expect(fs.readdirSync(path.join(fixture.root, "replica"))).toHaveLength(2);
  });

  it("rejects wrong bytes, roles, manifests and accessors before retention", () => {
    const fixture = resources();
    const store = fixture.create();
    const bytes = Buffer.from("sqlite-snapshot");
    const valid = request(fixture.manifestDigest, bytes);
    const retain = vi.spyOn(fixture.authority, "retain");

    expect(() =>
      store.retainTransitionSnapshot({
        ...valid,
        bytes: Buffer.from("substituted"),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: PM_EXPLORATION_RECOVERY_SNAPSHOT_CORRUPT_CODE,
      }),
    );
    expect(() =>
      store.retainTransitionSnapshot({ ...valid, snapshotRole: "pre-run" }),
    ).toThrow("request binding is invalid");
    expect(() =>
      store.retainTransitionSnapshot({
        ...valid,
        manifestDigest: sha("substituted-manifest"),
      }),
    ).toThrow("request binding is invalid");

    const getter = vi.fn(() => bytes);
    const accessor = { ...valid };
    Object.defineProperty(accessor, "bytes", { enumerable: true, get: getter });
    expect(() => store.retainTransitionSnapshot(accessor)).toThrow(
      "accessor fields",
    );
    expect(getter).not.toHaveBeenCalled();
    expect(retain).not.toHaveBeenCalled();
  });

  it("rejects non-durable receipts and substituted replica bytes", () => {
    const nonDurable = resources((authority) => ({
      id: authority.id,
      resolve: authority.resolve,
      retain(input) {
        return { ...authority.retain(input), durable: false };
      },
    }));
    expect(() =>
      nonDurable
        .create()
        .retainTransitionSnapshot(
          request(nonDurable.manifestDigest, Buffer.from("snapshot")),
        ),
    ).toThrowError(
      expect.objectContaining({
        code: PM_EXPLORATION_RECOVERY_SNAPSHOT_CORRUPT_CODE,
      }),
    );

    const substituted = resources((authority) => ({
      id: authority.id,
      retain: authority.retain,
      resolve(input) {
        return { ...authority.resolve(input), bytes: Buffer.from("forged") };
      },
    }));
    expect(() =>
      substituted
        .create()
        .retainTransitionSnapshot(
          request(substituted.manifestDigest, Buffer.from("snapshot")),
        ),
    ).toThrowError(
      expect.objectContaining({
        code: PM_EXPLORATION_RECOVERY_SNAPSHOT_CORRUPT_CODE,
      }),
    );
  });

  it("rejects unbranded stores and tampered acknowledgements", () => {
    expect(() => capturePmExplorationRecoverySnapshotStore({})).toThrow(
      "branded PM recovery snapshot store",
    );
    const fixture = resources();
    const input = request(fixture.manifestDigest, Buffer.from("snapshot"));
    const ack = fixture.create().retainTransitionSnapshot(input);
    expect(() =>
      verifyPmExplorationRecoverySnapshotAck({
        ...ack,
        databaseSnapshotBytes: ack.databaseSnapshotBytes + 1,
      }),
    ).toThrow("digest mismatch");

    const getter = vi.fn(() => fixture.manifestDigest);
    const expected = {};
    Object.defineProperty(expected, "manifestDigest", {
      enumerable: true,
      get: getter,
    });
    expect(() => verifyPmExplorationRecoverySnapshotAck(ack, expected)).toThrow(
      "invalid fields",
    );
    expect(getter).not.toHaveBeenCalled();
  });
});
