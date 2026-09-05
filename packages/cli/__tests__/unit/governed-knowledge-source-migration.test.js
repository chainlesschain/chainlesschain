import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  createEvolutionLedgerPorts,
  EVOLUTION_LEDGER_SOURCE_REVOKED_CODE,
  EVOLUTION_LEDGER_PORTS_INVALID_CODE,
} from "../../src/lib/evolution/evolution-ledger-ports.js";
import {
  SKILL_RELEASE_STATE_LEDGER_MIGRATION_SCHEMA,
  SKILL_RELEASE_STATE_MIGRATION_PLAN_SCHEMA,
  SKILL_RELEASE_STATE_MIGRATION_RECEIPT_SCHEMA,
  SKILL_RELEASE_STATE_SCHEMA,
} from "../../src/lib/evolution/skill-release-registry.js";
import { openEvolutionDurableStore } from "../fixtures/evolution-durable-store.js";
import { replicaAuthority } from "../fixtures/skill-revocation-release-registry.js";
import { openKnowledgeSkillRollbackStore } from "../fixtures/governed-knowledge-skill-rollback.js";

const roots = [];
const PREPARED = "knowledge.revocation-dependencies.prepared";
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
const canonical = (value) =>
  value === null || typeof value !== "object"
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? `[${value.map(canonical).join(",")}]`
      : `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(",")}}`;
const digest = (domain, value) =>
  `sha256:${createHash("sha256")
    .update(`${domain}\0${canonical(value)}`)
    .digest("hex")}`;
const D = (value) => digest("test:source-migration", value);
function requestFor(active, lastKnownGood) {
  // A domain-port migration contract test, not production authorization or
  // legacy file conversion. Both targets are real immutable v4 releases.
  const planCore = {
    schema: SKILL_RELEASE_STATE_MIGRATION_PLAN_SCHEMA,
    tenantId: active.tenantId,
    skillName: active.skillName,
    activeReleaseDigest: active.releaseDigest,
    activeReleaseMigrationDigest: D("active-migration"),
    activeReleaseMigrationReceiptDigest: D("active-receipt"),
    dependencyLockDigest: active.dependencyLockDigest,
    lastKnownGoodReleaseDigest: lastKnownGood.releaseDigest,
    lastKnownGoodReleaseMigrationDigest: D("lkg-migration"),
    lastKnownGoodReleaseMigrationReceiptDigest: D("lkg-receipt"),
    legacyActiveReleaseDigest: D("legacy-active"),
    legacyLastKnownGoodReleaseDigest: D("legacy-lkg"),
    legacyFence: 11,
    legacyRevision: 3,
    legacyStateDigest: D("legacy-state"),
    legacyTransactionId: D("legacy-transaction"),
    requiresAuthenticatedLedgerMigration: true,
  };
  const plan = {
    ...planCore,
    stateMigrationDigest: digest(planCore.schema, planCore),
  };
  const stateCore = {
    schema: SKILL_RELEASE_STATE_SCHEMA,
    activeReleaseDigest: active.releaseDigest,
    authorityReceiptDigest: active.authorityReceiptDigest,
    dependencyLockDigest: active.dependencyLockDigest,
    fence: plan.legacyFence,
    lastKnownGoodReleaseDigest: lastKnownGood.releaseDigest,
    revision: plan.legacyRevision,
    skillName: active.skillName,
    tenantId: active.tenantId,
    transactionId: plan.stateMigrationDigest,
  };
  return {
    schema: SKILL_RELEASE_STATE_LEDGER_MIGRATION_SCHEMA,
    plan,
    state: { ...stateCore, stateDigest: digest(stateCore.schema, stateCore) },
    receipt: {
      schema: SKILL_RELEASE_STATE_MIGRATION_RECEIPT_SCHEMA,
      authenticated: true,
      durable: true,
      authorityId: "authority:state-migration",
      trust: "trusted",
      handlerArtifactDigest: D("state-handler"),
      stateMigrationDigest: plan.stateMigrationDigest,
      receiptDigest: D(plan.stateMigrationDigest),
    },
  };
}
async function setup(wikiHops = 0) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-source-migration-"),
  );
  roots.push(root);
  const h = await openKnowledgeSkillRollbackStore(path.join(root, "origin"), {
    seed: true,
    wikiProvenance: wikiHops > 0,
    wikiHops,
  });
  await expect(
    h.makeSync().publish({
      ...h.knowledge,
      dependencies: [
        {
          kind: "candidate",
          digest: D("unlisted-candidate"),
          disposition: "reject-candidate",
        },
      ],
    }),
  ).rejects.toThrow();
  const event = h.resources.backend.ledger
    .read()
    .find((item) => item.type === PREPARED);
  expect(event).toBeDefined();
  const identity = h.resources.backend.ledger.verify();
  const artifact = JSON.parse(
    h.resources
      .resolver({
        epoch: identity.epoch,
        ledgerId: identity.ledgerId,
        tenantId: h.resources.descriptor.artifactTenantId,
        ref: event.subjectRef,
      })
      .bytes.toString("utf8"),
  );
  const resources = openEvolutionDurableStore(path.join(root, "migration"), {
    tenantId: h.descriptor.tenantId,
    streamId: "source-migration",
  });
  // Recreate actual immutable Wiki subjects/events in the migration ledger,
  // with no Skill lineage. Missing upstream proof is not a safe migration.
  const refs = new Map();
  for (const original of h.resources.backend.ledger.read()) {
    if (original.type !== "wiki.revision.committed") continue;
    const record = JSON.parse(
      h.resources
        .resolver({
          epoch: identity.epoch,
          ledgerId: identity.ledgerId,
          tenantId: h.resources.descriptor.artifactTenantId,
          ref: original.subjectRef,
        })
        .bytes.toString("utf8"),
    );
    const subjectRef = resources.artifactPorts.putCanonical(
      record.type,
      record.value,
      {
        audience: record.audience,
        purpose: record.purpose,
        retention: "ledger",
      },
    ).ref;
    resources.backend.ledger.appendDomainEvent({
      type: original.type,
      eventId: original.eventId,
      timestamp: original.timestamp,
      tenantId: original.tenantId,
      artifactTenantId: resources.descriptor.artifactTenantId,
      correlationId: original.correlationId,
      decision: original.decision,
      reason: original.reason,
      skillName: null,
      subjectRef,
      sourceRefs: original.sourceRefs.map((ref) => refs.get(ref.ref)),
    });
    refs.set(original.subjectRef.ref, subjectRef);
  }
  const appendRevocation = () => {
    const subjectRef = resources.artifactPorts.putCanonical(
      artifact.type,
      artifact.value,
      {
        audience: artifact.audience,
        purpose: artifact.purpose,
        retention: "ledger",
      },
    ).ref;
    resources.backend.ledger.appendDomainEvent({
      type: event.type,
      eventId: event.eventId,
      tenantId: event.tenantId,
      artifactTenantId: resources.descriptor.artifactTenantId,
      correlationId: event.correlationId,
      decision: event.decision,
      reason: event.reason,
      skillName: event.skillName,
      sourceRefs: [],
      subjectRef,
    });
  };
  let interleave = null;
  const ports = createEvolutionLedgerPorts({
    artifactPorts: resources.artifactPorts,
    artifactTenantId: resources.descriptor.artifactTenantId,
    audience: resources.descriptor.audience,
    purpose: resources.descriptor.purpose,
    ledger: resources.backend.ledger,
    artifactDurabilityAuthority: replicaAuthority(
      path.join(root, "replica"),
      () => {
        const action = interleave;
        interleave = null;
        action?.();
      },
    ),
  });
  return {
    h,
    resources,
    ports,
    appendRevocation,
    arm: (action) => {
      interleave = action;
    },
  };
}

it.each([
  ["active", 0],
  ["lastKnownGood", 0],
  ["active", 2],
  ["lastKnownGood", 2],
])(
  "blocks revoked provenance in migration %s (%s Wiki hops) without appending a migration",
  async (position, wikiHops) => {
    const h = await setup(wikiHops);
    h.appendRevocation();
    const releases = {
      active: h.h.release.baseline,
      lastKnownGood: h.h.release.baseline,
    };
    releases[position] = h.h.release.candidateRelease;
    const request = requestFor(releases.active, releases.lastKnownGood);
    expect(() =>
      h.ports.transactionLedger.migrate(request, releases),
    ).toThrowError(
      expect.objectContaining({ code: EVOLUTION_LEDGER_SOURCE_REVOKED_CODE }),
    );
    expect(
      h.ports.transactionLedger.query(request.plan.stateMigrationDigest).status,
    ).toBe("absent");
    expect(
      h.resources.backend.ledger
        .read()
        .filter((e) => e.type === "skill.release.state-migration"),
    ).toHaveLength(0);
  },
  180_000,
);

it("requires exact migration release evidence after revocation but admits unrelated state", async () => {
  const h = await setup();
  h.appendRevocation();
  const active = h.h.release.baseline;
  const request = requestFor(active, active);
  for (const releases of [
    undefined,
    { active, lastKnownGood: h.h.release.candidateRelease },
  ]) {
    expect(() =>
      h.ports.transactionLedger.migrate(request, releases),
    ).toThrowError(
      expect.objectContaining({ code: EVOLUTION_LEDGER_PORTS_INVALID_CODE }),
    );
  }
  expect(
    h.ports.transactionLedger.migrate(request, {
      active,
      lastKnownGood: active,
    }),
  ).toMatchObject({ status: "committed", current: true, revision: 3 });
}, 180_000);

it("rechecks a migration after revocation wins the append CAS", async () => {
  const h = await setup();
  const releases = {
    active: h.h.release.candidateRelease,
    lastKnownGood: h.h.release.baseline,
  };
  const request = requestFor(releases.active, releases.lastKnownGood);
  h.arm(h.appendRevocation);
  expect(() =>
    h.ports.transactionLedger.migrate(request, releases),
  ).toThrowError(
    expect.objectContaining({ code: EVOLUTION_LEDGER_SOURCE_REVOKED_CODE }),
  );
  expect(
    h.ports.transactionLedger.query(request.plan.stateMigrationDigest).status,
  ).toBe("absent");
}, 180_000);

it("recovers an already committed migration after revocation without authorizing another migration", async () => {
  const h = await setup();
  const releases = {
    active: h.h.release.candidateRelease,
    lastKnownGood: h.h.release.baseline,
  };
  const request = requestFor(releases.active, releases.lastKnownGood);
  const committed = h.ports.transactionLedger.migrate(request, releases);
  h.appendRevocation();
  expect(h.ports.transactionLedger.migrate(request)).toEqual(committed);
  expect(
    h.resources.backend.ledger
      .read()
      .filter((e) => e.type === "skill.release.state-migration"),
  ).toHaveLength(1);
}, 180_000);
