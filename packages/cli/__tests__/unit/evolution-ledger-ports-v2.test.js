import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLedgerV2FixtureBackend,
  openLedgerV2Fixture,
  V2_FIXTURE_RETENTION,
} from "../fixtures/evolution-ledger-v2-store.js";
import {
  evolutionDurableStoreConfiguration,
  openEvolutionDurableStore,
} from "../fixtures/evolution-durable-store.js";
import {
  openRevocationReleaseRegistry,
  replicaAuthority,
} from "../fixtures/skill-revocation-release-registry.js";
import {
  captureSkillReleaseOperationReader,
  createEvolutionLedgerPorts,
} from "../../src/lib/evolution/evolution-ledger-ports.js";
import {
  SKILL_MUTATION_AUDIT_SCHEMA,
  SKILL_MUTATION_NONCE_CLAIM_SCHEMA,
} from "../../src/lib/evolution/skill-mutation-authority.js";
import { rrsiHash } from "../../src/lib/evolution/rrsi-data.js";
import { EvolutionLedger } from "../../src/lib/evolution/evolution-ledger.js";
import { EvolutionArtifactPorts } from "../../src/lib/evolution/evolution-artifact-ports.js";
import { createEvolutionLedgerV2JournalFromFactory } from "../../src/lib/evolution/evolution-ledger-v2-journal.js";

const roots = [];
const temporaryParent = fs.realpathSync.native(os.tmpdir());
const scope = Object.freeze({
  tenantId: "tenant-a",
  artifactTenantId: "artifact-tenant-a-release",
  audience: "evolution-runtime",
});
const digest = (label) => rrsiHash("test-only-v2-ports", label);
function root() {
  const directory = fs.mkdtempSync(path.join(temporaryParent, "cc-ports-v2-"));
  roots.push(directory);
  return directory;
}
function openPorts(directory, storage, ledger = storage.backend.ledger) {
  return createEvolutionLedgerPorts({
    artifactDurabilityAuthority: replicaAuthority(
      path.join(directory, "release-replica"),
    ),
    artifactPorts: storage.artifactPorts,
    artifactTenantId: scope.artifactTenantId,
    audience: scope.audience,
    ledger,
  });
}
function nonce(storage, label, tenantId = scope.tenantId) {
  const now = storage.clock();
  const core = {
    audience: scope.audience,
    claimedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 120000).toISOString(),
    nonce: digest(`nonce:${label}`).slice(7),
    operationId: `operation:${label}`,
    requestDigest: digest(`request:${label}`),
    schema: SKILL_MUTATION_NONCE_CLAIM_SCHEMA,
    tenantId,
  };
  return {
    ...core,
    claimDigest: rrsiHash("chainlesschain.skill-mutation-nonce-claim/v1", core),
  };
}
function deniedAudit(storage, tenantId) {
  const core = {
    audience: null,
    code: "CC_SKILL_MUTATION_REQUEST_INVALID",
    decision: "deny",
    expectedTargetDigest: null,
    expectedTargetRevision: null,
    expiresAt: null,
    nonce: null,
    occurredAt: new Date(storage.clock()).toISOString(),
    operation: null,
    operationId: null,
    phase: "authorize",
    principalId: null,
    requestDigest: null,
    role: null,
    schema: SKILL_MUTATION_AUDIT_SCHEMA,
    skillName: null,
    targetScope: null,
    tenantId,
    transitionSubjectDigest: null,
  };
  return {
    ...core,
    auditDigest: rrsiHash("chainlesschain.skill-mutation-audit/v3", core),
  };
}
afterEach(() => {
  for (const directory of roots.splice(0)) {
    const target = path.resolve(directory);
    if (
      path.dirname(target) !== temporaryParent ||
      !path.basename(target).startsWith("cc-ports-v2-")
    )
      throw new Error("v2 ports cleanup escaped its temporary root");
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("release domain ports bound to genuine v2 journals", () => {
  it("commits real promotions and rollback, then recovers exact Registry state through v2 ports", async () => {
    const directory = root();
    const storage = openLedgerV2Fixture(directory, scope);
    const value = await openRevocationReleaseRegistry({
      root: directory,
      storage: { ...storage, now: storage.clock() },
      fsImpl: storage.fsImpl,
      tenantId: scope.tenantId,
      artifactTenantId: scope.artifactTenantId,
      seed: true,
    });
    const transactionLedger = value.pruningRollbackOptions.transactionLedger;
    const reader = captureSkillReleaseOperationReader(transactionLedger);
    expect(reader.matchesLedger(storage.journal)).toBe(true);
    expect(reader.matchesArtifactPorts(storage.artifactPorts)).toBe(true);
    const before = value.readActive();
    expect(before.state.revision).toBe(2);
    expect(transactionLedger.query(before.state.transactionId)).toMatchObject({
      status: "committed",
      current: true,
      authenticated: true,
      durable: true,
      stateDigest: before.state.stateDigest,
    });
    await value.rollbackTo(value.baseline.releaseDigest, "test:v2-rollback");
    const after = value.readActive();
    expect(after.state.revision).toBe(3);
    expect(after.release.releaseDigest).toBe(value.baseline.releaseDigest);
    const reopenedStorage = openLedgerV2Fixture(directory, scope);
    const reopened = await openRevocationReleaseRegistry({
      root: directory,
      storage: { ...reopenedStorage, now: reopenedStorage.clock() },
      fsImpl: reopenedStorage.fsImpl,
      tenantId: scope.tenantId,
      artifactTenantId: scope.artifactTenantId,
    });
    expect(reopened.readActive()).toEqual(after);
    expect(storage.manifest.backend.readEvents()).toEqual(
      storage.journal.read(),
    );
    expect(
      reopened.pruningRollbackOptions.transactionLedger.query(
        after.state.transactionId,
      ),
    ).toMatchObject({
      status: "committed",
      stateDigest: after.state.stateDigest,
    });
  }, 300000);

  it("authenticates a real old receipt after cutover and blocks the original v1 writer", () => {
    const directory = root();
    const legacy = openEvolutionDurableStore(directory, scope);
    const originalPorts = openPorts(directory, legacy);
    const claim = nonce(legacy, "before-cutover");
    const original = originalPorts.nonceStore.claim(claim);
    const oldEvent = legacy.backend.ledger.read().at(-1);
    const oldReceipt = legacy.backend.ledger.recoverReceipt({
      eventId: oldEvent.eventId,
    });
    const storage = openLedgerV2Fixture(directory, scope);
    const ports = openPorts(directory, storage);
    expect(storage.journal.verifyReceipt(oldReceipt)).toMatchObject({
      valid: true,
      authenticated: true,
      durable: true,
      event: oldEvent,
    });
    expect(ports.nonceStore.claim(claim)).toMatchObject({
      persisted: true,
      claimed: false,
      claimDigest: original.claimDigest,
      sequence: original.sequence,
      headDigest: original.headDigest,
    });
    const reader = captureSkillReleaseOperationReader(ports.transactionLedger);
    expect(reader.matchesLedger(legacy.backend.ledger)).toBe(false);
    const before = storage.journal.verify();
    expect(() =>
      originalPorts.nonceStore.claim(nonce(legacy, "illegal-v1-write")),
    ).toThrowError(
      expect.objectContaining({ code: "CC_EVOLUTION_LEDGER_V2_REQUIRED" }),
    );
    expect(storage.journal.verify().sequence).toBe(before.sequence);
    const reopened = openLedgerV2Fixture(directory, scope);
    expect(openPorts(directory, reopened).nonceStore.claim(claim).claimed).toBe(
      false,
    );
  }, 180000);

  it("rejects copied, inherited and proxied journals and keeps exact ledger/artifact ownership", () => {
    const directory = root();
    const storage = openLedgerV2Fixture(directory, scope);
    const foreign = openLedgerV2Fixture(root(), scope);
    const ports = openPorts(directory, storage);
    const reader = captureSkillReleaseOperationReader(ports.transactionLedger);
    expect(reader.matchesLedger(storage.journal)).toBe(true);
    expect(reader.matchesLedger(foreign.journal)).toBe(false);
    expect(reader.matchesArtifactPorts(storage.artifactPorts)).toBe(true);
    expect(reader.matchesArtifactPorts(foreign.artifactPorts)).toBe(false);
    let calls = 0;
    const proxy = new Proxy(storage.journal, {
      get() {
        calls++;
        throw new Error("journal proxy trap executed");
      },
    });
    for (const forged of [
      { ...storage.journal },
      Object.create(storage.journal),
      proxy,
    ])
      expect(() => openPorts(directory, storage, forged)).toThrow();
    expect(calls).toBe(0);
    expect(() =>
      captureSkillReleaseOperationReader({ ...ports.transactionLedger }),
    ).toThrow(/branded/);
  }, 180000);

  it("never invokes caller-overridden bind/call properties on original artifact or genuine v2 methods", () => {
    const directory = root();
    const targets = [
      [EvolutionArtifactPorts.prototype.putCanonical, "bind"],
      [
        EvolutionArtifactPorts.prototype.createEvolutionLedgerArtifactResolver,
        "call",
      ],
    ];
    const names = [
      "appendDomainEvent",
      "query",
      "read",
      "verify",
      "verifyReceipt",
    ];
    let calls = 0;
    const installed = [];
    const install = (method, property) => {
      Object.defineProperty(method, property, {
        configurable: true,
        get() {
          calls++;
          throw new Error("overridden function invocation property executed");
        },
      });
      installed.push([method, property]);
    };
    try {
      for (const [method, property] of targets) install(method, property);
      // Install before constructing the journal: its original artifact capture
      // must be independent of the caller-reachable function properties too.
      const storage = openLedgerV2Fixture(directory, scope);
      for (const name of names) install(storage.journal[name], "bind");
      const ports = openPorts(directory, storage);
      const reader = captureSkillReleaseOperationReader(
        ports.transactionLedger,
      );
      expect(reader.currentContext().checkpoint).toMatchObject({
        ledgerId: storage.journal.verify().ledgerId,
      });
      expect(
        ports.nonceStore.claim(nonce(storage, "captured-methods")),
      ).toMatchObject({
        persisted: true,
        claimed: true,
      });
      expect(calls).toBe(0);
    } finally {
      for (const [method, property] of installed) delete method[property];
    }
  }, 180000);

  it("never dispatches through overrides on a genuinely constructed source subclass", () => {
    const directory = root();
    const legacy = openEvolutionDurableStore(directory, scope);
    const configuration = evolutionDurableStoreConfiguration(directory, scope);
    const called = [];
    class ShadowLedger extends EvolutionLedger {}
    for (const name of [
      "read",
      "query",
      "queryMany",
      "verify",
      "verifyReceipt",
      "findByEventId",
      "recoverReceipt",
      "getAuthority",
      "checkpointState",
      "exportAuditBundle",
    ])
      Object.defineProperty(ShadowLedger.prototype, name, {
        value() {
          called.push(name);
          throw new Error(`source subclass override executed: ${name}`);
        },
      });
    for (const name of ["rootDir", "authorityRootDir"])
      Object.defineProperty(ShadowLedger.prototype, name, {
        get() {
          called.push(name);
          throw new Error(`source subclass getter executed: ${name}`);
        },
      });
    // Real private fields and the real migration-source WeakMap registration;
    // this is not Object.create(prototype) or a structural fake.
    const source = new ShadowLedger({
      rootDir: legacy.backend.ledger.rootDir,
      authorityRootDir: legacy.backend.ledger.authorityRootDir,
      fsImpl: legacy.fsImpl,
      secure: false,
      clock: legacy.clock,
      trust: configuration.ledgerAuthority.trust,
      sign: configuration.ledgerAuthority.signer.sign,
      verifySignature: configuration.ledgerAuthority.verifier.verify,
      verifyWitnessSignature: configuration.witnessAuthority.verifier.verify,
      witnessTrust: configuration.witnessAuthority.trust,
      witness: legacy.backend.witness,
      artifactResolver: legacy.resolver,
    });
    expect(Object.isFrozen(source)).toBe(true);
    let manifest;
    const journal = createEvolutionLedgerV2JournalFromFactory(source, {
      descriptor: scope,
      artifactPorts: legacy.artifactPorts,
      minimumRetainedUntil: V2_FIXTURE_RETENTION,
      createBackend(request) {
        manifest = createLedgerV2FixtureBackend(directory, request);
        return manifest.backend;
      },
    });
    const ports = openPorts(directory, legacy, journal);
    const claim = nonce(legacy, "genuine-subclass");
    expect(ports.nonceStore.claim(claim).claimed).toBe(true);
    const event = journal.read().at(-1);
    expect(journal.query({ eventId: event.eventId }).event).toEqual(event);
    expect(journal.queryMany([{ eventId: event.eventId }])[0].event).toEqual(
      event,
    );
    expect(journal.findByEventId(event.eventId)).toEqual(event);
    const receipt = journal.recoverReceipt({ eventId: event.eventId });
    expect(journal.verifyReceipt(receipt).valid).toBe(true);
    expect(journal.getAuthority().ledgerId).toBe(event.ledgerId);
    expect(journal.checkpointState()).toBeTruthy();
    expect(journal.exportAuditBundle()).toBeTruthy();
    expect(journal.verify().status).toBe("verified");
    expect(journal.rootDir).toBe(legacy.backend.ledger.rootDir);
    expect(journal.authorityRootDir).toBe(
      legacy.backend.ledger.authorityRootDir,
    );
    expect(manifest.backend.readEvents()).toEqual(journal.read());
    expect(called).toEqual([]);
  }, 180000);

  it("rejects foreign and anonymous audit tenants without rewriting or appending them", () => {
    const directory = root();
    const storage = openLedgerV2Fixture(directory, scope);
    const ports = openPorts(directory, storage);
    const before = storage.journal.verify();
    for (const tenant of [null, "foreign-tenant"])
      expect(() =>
        ports.auditSink.append(deniedAudit(storage, tenant)),
      ).toThrow(/live event type or tenant is invalid/);
    expect(() =>
      ports.nonceStore.claim(nonce(storage, "foreign-claim", "foreign-tenant")),
    ).toThrow(/live event type or tenant is invalid/);
    expect(storage.journal.verify().sequence).toBe(before.sequence);
  }, 180000);

  it("reports actual v2 retention failure after WAL commit and recovers the exact nonce once", () => {
    const directory = root();
    let armed = false;
    const storage = openLedgerV2Fixture(directory, {
      ...scope,
      fault(phase) {
        if (armed && phase === "before-retain")
          throw new Error("TEST retained segment service unavailable");
      },
    });
    const ports = openPorts(directory, storage);
    const claim = nonce(storage, "recover-v2-retain");
    const before = storage.journal.verify();
    armed = true;
    expect(() => ports.nonceStore.claim(claim)).toThrowError(
      expect.objectContaining({
        code: "CC_EVOLUTION_LEDGER_V2_JOURNAL_COMMIT_UNKNOWN",
        commitState: "unknown",
      }),
    );
    expect(storage.manifest.backend.read().head.sequence).toBe(before.sequence);
    // While the real retention fault persists even a query cannot claim success.
    expect(() => ports.nonceStore.claim(claim)).toThrow();
    armed = false;
    const reopened = openLedgerV2Fixture(directory, scope);
    const recoveredPorts = openPorts(directory, reopened);
    expect(recoveredPorts.nonceStore.claim(claim)).toMatchObject({
      persisted: true,
      claimed: false,
      claimDigest: claim.claimDigest,
      sequence: before.sequence + 1,
    });
    expect(recoveredPorts.nonceStore.claim(claim).claimed).toBe(false);
    expect(reopened.journal.verify().sequence).toBe(before.sequence + 1);
    expect(
      reopened.journal
        .read()
        .filter((event) => event.reason === claim.claimDigest),
    ).toHaveLength(1);
    expect(reopened.manifest.backend.readEvents()).toEqual(
      reopened.journal.read(),
    );
  }, 180000);

  it("rejects corrupted retained v2 bytes even when the source WAL is still authentic", () => {
    const directory = root();
    const legacy = openEvolutionDurableStore(directory, scope);
    const storage = openLedgerV2Fixture(directory, scope);
    const ports = openPorts(directory, storage);
    const claim = nonce(storage, "retained-corruption");
    ports.nonceStore.claim(claim);
    const event = storage.journal.read().at(-1);
    const nativeReceipt = storage.journal.recoverReceipt({
      eventId: event.eventId,
    });
    const reader = captureSkillReleaseOperationReader(ports.transactionLedger);
    const target = path.join(
      storage.manifest.segmentDirectory,
      fs.readdirSync(storage.manifest.segmentDirectory)[0],
    );
    const original = fs.readFileSync(target);
    const retained = JSON.parse(original.toString("utf8"));
    retained.bytes = Buffer.from(
      "authenticated proof with substituted payload",
    ).toString("base64");
    fs.writeFileSync(target, JSON.stringify(retained));
    try {
      expect(legacy.backend.ledger.verify().status).toBe("verified");
      expect(legacy.backend.ledger.verifyReceipt(nativeReceipt).valid).toBe(
        true,
      );
      expect(() => reader.currentContext()).toThrow();
      expect(() => ports.nonceStore.claim(claim)).toThrow();
      expect(() =>
        ports.transactionLedger.query(digest("absent-tx")),
      ).toThrow();
      expect(() => storage.journal.verifyReceipt(nativeReceipt)).toThrow();
    } finally {
      fs.writeFileSync(target, original);
    }
  }, 180000);
});
