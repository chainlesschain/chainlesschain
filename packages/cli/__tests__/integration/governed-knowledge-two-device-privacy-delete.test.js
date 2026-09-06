import { generateKeyPairSync, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { createGovernedKnowledgeNodeCryptoAuthority } from "../../src/lib/evolution/governed-knowledge-node-crypto-authority.js";
import { GovernedKnowledgeDependencyInventoryPlanner } from "../../src/lib/evolution/governed-knowledge-dependency-inventory.js";
import {
  openKnowledgeSkillRollbackStore,
  source,
  tenantId,
} from "../fixtures/governed-knowledge-skill-rollback.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function cryptoPair() {
  const a = generateKeyPairSync("ed25519");
  const b = generateKeyPairSync("ed25519");
  const scopeKeys = [
    {
      tenantId,
      scope: "project",
      scopeId: "project:1",
      keyRef: "kms:project:1:v1",
      key: randomBytes(32),
      active: true,
    },
  ];
  const peerIdentities = [
    { tenantId, deviceId: "device:a", publicKey: a.publicKey },
    { tenantId, deviceId: "device:b", publicKey: b.publicKey },
  ];
  return {
    a: createGovernedKnowledgeNodeCryptoAuthority({
      tenantId,
      deviceId: "device:a",
      privateKey: a.privateKey,
      scopeKeys,
      peerIdentities,
    }),
    b: createGovernedKnowledgeNodeCryptoAuthority({
      tenantId,
      deviceId: "device:b",
      privateKey: b.privateKey,
      scopeKeys,
      peerIdentities,
    }),
  };
}

async function openDevice(root, deviceId, cryptoAuthority, seed) {
  return openKnowledgeSkillRollbackStore(root, {
    seed,
    localDeviceId: deviceId,
    cryptoAuthority,
    wikiProvenance: true,
    wikiTombstone: "combined",
  });
}

function eventCount(device, type) {
  return device.resources.backend.ledger
    .read()
    .filter((event) => event.type === type).length;
}

function localPlanner(device) {
  return new GovernedKnowledgeDependencyInventoryPlanner({
    tenantId,
    candidateRegistry: device.release.candidateRegistry,
    releaseRegistry: device.release.pruningRollbackOptions.releaseRegistry,
    wikiAdapters: [device.wiki.adapter],
  });
}

it("propagates an encrypted privacy tombstone to an offline device before either device commits it", async () => {
  const rootA = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-privacy-device-a-"),
  );
  const rootB = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-privacy-device-b-"),
  );
  roots.push(rootA, rootB);
  const crypto = cryptoPair();
  const deviceA = await openDevice(rootA, "device:a", crypto.a, true);
  let deviceB = await openDevice(rootB, "device:b", crypto.b, true);
  expect(deviceA.knowledge.dependencies[0].digest).not.toBe(
    deviceB.knowledge.dependencies[0].digest,
  );
  let deviceBSync = deviceB.makeSync(deviceB.executor, localPlanner(deviceB));

  const initial = {
    tenantId,
    knowledgeId: deviceA.knowledge.knowledgeId,
    scope: "project",
    scopeId: "project:1",
    action: "upsert",
    contentDigest: source.digest,
    vectorClock: { "device:a": 1 },
    approvalReceiptDigest: null,
    revocationReceiptDigest: null,
    dependencies: [],
  };
  const initialEnvelope = await deviceA.makeSync().publish(initial);
  await expect(deviceBSync.receive(initialEnvelope)).resolves.toMatchObject({
    applied: true,
    action: "upsert",
  });

  // Device B is now offline. Device A performs the privacy deletion locally;
  // its three real dependency effects must settle before its sync commit.
  const deletion = {
    ...deviceA.knowledge,
    action: "tombstone",
    vectorClock: { "device:a": 2 },
  };
  const deletedEnvelope = await deviceA.makeSync().publish(deletion);
  expect(deletedEnvelope.signature).toMatchObject({ algorithm: "Ed25519" });
  expect(deletedEnvelope.keyRef).toBe("kms:project:1:v1");
  expect(deletedEnvelope.ciphertext).not.toContain(initial.knowledgeId);
  expect(deviceA.release.readActive().release).toEqual(
    deviceA.release.baseline,
  );
  expect(
    deviceA.wiki.adapter.loadWiki().state.patterns["pat-knowledge"].status,
  ).toBe("tombstoned");

  const aEvents = deviceA.resources.backend.ledger.read();
  const aSettled = aEvents.findLast(
    (event) => event.type === "knowledge.revocation-dependencies.settled",
  );
  const aCommitted = aEvents.findLast(
    (event) => event.type === "knowledge.sync.committed",
  );
  expect(aSettled.sequence).toBeLessThan(aCommitted.sequence);

  // Reconnect B with its old local state. A's vector dominates, so B must
  // authenticate/decrypt and execute its own real effects before remote commit.
  // Simulate a process failure after those effects but before that commit.
  let loseRemoteCommit = true;
  deviceBSync = deviceB.makeSync(deviceB.executor, localPlanner(deviceB), {
    commit: async (request) => {
      if (
        loseRemoteCommit &&
        request.disposition === "remote" &&
        request.knowledge.action === "tombstone"
      ) {
        loseRemoteCommit = false;
        throw new Error("simulated remote commit response loss");
      }
      return deviceB.persisted.commit(request);
    },
  });
  await expect(deviceBSync.receive(deletedEnvelope)).rejects.toThrow(
    /simulated remote commit response loss/u,
  );
  expect(loseRemoteCommit).toBe(false);
  expect(deviceB.release.readActive().release).toEqual(
    deviceB.release.baseline,
  );
  expect(
    deviceB.wiki.adapter.loadWiki().state.patterns["pat-knowledge"].status,
  ).toBe("tombstoned");
  await expect(
    deviceB.persisted.load({ knowledgeId: initial.knowledgeId }),
  ).resolves.toMatchObject({
    action: "upsert",
    vectorClock: { "device:a": 1 },
  });

  // A fresh process recovers the locally prepared plan rather than rescanning
  // the now-rolled-back/tombstoned state, then commits the remote revocation.
  deviceB = await openDevice(rootB, "device:b", crypto.b, false);
  deviceBSync = deviceB.makeSync(deviceB.executor, localPlanner(deviceB));
  await expect(deviceBSync.receive(deletedEnvelope)).resolves.toMatchObject({
    applied: true,
    action: "tombstone",
  });
  await expect(
    deviceB.persisted.load({ knowledgeId: initial.knowledgeId }),
  ).resolves.toMatchObject({
    action: "tombstone",
    vectorClock: { "device:a": 2 },
  });
  await expect(deviceB.persisted.listConflicts()).resolves.toMatchObject({
    items: [],
    total: 0,
  });

  const bEvents = deviceB.resources.backend.ledger.read();
  const bSettled = bEvents.findLast(
    (event) => event.type === "knowledge.revocation-dependencies.settled",
  );
  const bCommitted = bEvents.findLast(
    (event) => event.type === "knowledge.sync.committed",
  );
  expect(bSettled.sequence).toBeLessThan(bCommitted.sequence);
  expect(eventCount(deviceA, "knowledge.revocation-dependencies.settled")).toBe(
    1,
  );
  expect(eventCount(deviceB, "knowledge.revocation-dependencies.settled")).toBe(
    1,
  );

  // Re-delivery authenticates the same persisted receipt. Artifact lifecycle
  // recovery may append its own receipts, but destructive effects do not repeat.
  const beforeReplay = deviceB.resources.backend.ledger.read().length;
  await expect(deviceBSync.receive(deletedEnvelope)).resolves.toMatchObject({
    recovered: true,
  });
  expect(
    deviceB.resources.backend.ledger
      .read()
      .slice(beforeReplay)
      .map((event) => event.type),
  ).toEqual([
    "evolvable-artifact.candidate.persisted",
    "evolvable-artifact.transition.committed",
  ]);
  expect(eventCount(deviceB, "knowledge.revocation-dependencies.settled")).toBe(
    1,
  );
  expect(deviceB.release.inspect().transitions).toHaveLength(3);
  expect(eventCount(deviceB, "wiki.revision.committed")).toBe(3);
}, 360_000);
