import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  openLedgerV2Fixture,
  v2FixtureDomainEvent,
} from "../fixtures/evolution-ledger-v2-store.js";
import { openEvolutionDurableStore } from "../fixtures/evolution-durable-store.js";
import {
  openRevocationReleaseRegistry,
  replicaAuthority,
} from "../fixtures/skill-revocation-release-registry.js";
import { rrsiCampaignInput } from "../fixtures/rrsi-shadow-fixture.js";
import {
  rrsiPmBridgeData,
  openRrsiPmBridgeFixture,
} from "../fixtures/rrsi-pm-bridge.js";
import { buildRrsiCampaign } from "../../src/lib/evolution/rrsi-contracts.js";
import { createEvolutionLedgerPorts } from "../../src/lib/evolution/evolution-ledger-ports.js";
import {
  SkillReleaseRegistry,
  captureSkillReleaseRegistryReader,
} from "../../src/lib/evolution/skill-release-registry.js";
import {
  createRrsiHistoryLedgerAdapter,
  captureRrsiHistoryLedgerAdapter,
} from "../../src/lib/evolution/rrsi-history-ledger-adapter.js";
import { captureEvolutionLedgerArtifactResolverBinding } from "../../src/lib/evolution/evolution-artifact-ports.js";
import { captureEvolutionLedgerFileBackendBinding } from "../../src/lib/evolution/evolution-ledger-file-backend.js";
import {
  createRrsiRegistryHistoryBinding,
  captureRrsiRegistryHistoryBinding,
  recheckRrsiRegistryHistoryBinding,
} from "../../src/lib/evolution/rrsi-registry-history-binding.js";
import {
  createRrsiEffectiveParentBindingV2,
  recheckRrsiEffectiveParent,
  assertRrsiEffectiveParentHistory,
} from "../../src/lib/evolution/rrsi-parent-binding.js";
import {
  createRrsiRuntimeComposition,
  reserveRrsiRuntimePmBroadRound,
  executeRrsiRuntimePmBroadRound,
  inspectRrsiRuntimeHistory,
} from "../../src/lib/evolution/rrsi-runtime-composition.js";

const roots = [],
  temporaryParent = fs.realpathSync.native(os.tmpdir());
const scope = {
  tenantId: "tenant-a",
  artifactTenantId: "artifact-tenant-a-release",
  audience: "evolution-runtime",
};
function directory() {
  const root = fs.mkdtempSync(
    path.join(temporaryParent, "rrsi-storage-binding-"),
  );
  roots.push(root);
  return root;
}
function ports(root, store, artifactPorts = store.artifactPorts) {
  return createEvolutionLedgerPorts({
    artifactPorts,
    ledger: store.backend.ledger,
    artifactTenantId: scope.artifactTenantId,
    audience: scope.audience,
    artifactDurabilityAuthority: replicaAuthority(
      path.join(root, "release-replica"),
    ),
  });
}
function history(store, campaign, resolver = store.resolver) {
  return createRrsiHistoryLedgerAdapter({
    backend: store.backend,
    artifactPorts: store.artifactPorts,
    ledgerArtifactResolver: resolver,
    descriptor: {
      ...scope,
      goalId: campaign.goalId,
      purpose: "evolution-ledger",
    },
    settlementVerifier: null,
    now: store.clock,
  });
}
function fixture({ v2 = true, register = true } = {}) {
  const root = directory(),
    store = (v2 ? openLedgerV2Fixture : openEvolutionDurableStore)(
      path.join(root, "store"),
      scope,
    );
  const p = ports(root, store);
  const releases = new SkillReleaseRegistry({
    tenantId: scope.tenantId,
    rootDir: path.join(root, "skill-releases"),
    transactionLedger: p.transactionLedger,
    fsImpl: store.fsImpl,
    secure: false,
  });
  const campaign = buildRrsiCampaign({
      ...rrsiCampaignInput(),
      tenantId: scope.tenantId,
      goalId: "safe-refactor",
    }),
    adapter = history(store, campaign);
  if (register) adapter.registerCampaign(campaign);
  return {
    root,
    store,
    p,
    releases,
    campaign,
    adapter,
    input: {
      backend: store.backend,
      historyAdapter: adapter,
      releaseRegistry: releases,
      transactionLedger: p.transactionLedger,
    },
  };
}
async function parentFixture() {
  const value = fixture({ register: false });
  const released = await openRevocationReleaseRegistry({
    root: value.root,
    storage: { ...value.store, now: value.store.clock() },
    fsImpl: value.store.fsImpl,
    tenantId: scope.tenantId,
    artifactTenantId: scope.artifactTenantId,
    seed: true,
  });
  const actual = released.readActive(),
    overrides = {
      tenantId: scope.tenantId,
      goalId: actual.release.skillName,
      parentReleaseDigest: actual.release.releaseDigest,
      anchorReleaseDigest: actual.state.lastKnownGoodReleaseDigest,
    };
  const data = rrsiPmBridgeData({}, overrides),
    adapter = history(value.store, data.campaign);
  adapter.registerCampaign(data.campaign);
  const rootInput = {
    backend: value.store.backend,
    historyAdapter: adapter,
    releaseRegistry: released.pruningRollbackOptions.releaseRegistry,
    transactionLedger: released.pruningRollbackOptions.transactionLedger,
  };
  const binding = createRrsiRegistryHistoryBinding(rootInput);
  return {
    ...value,
    adapter,
    campaign: data.campaign,
    released,
    overrides,
    binding,
    parentInput: {
      campaign: data.campaign,
      releaseRegistry: rootInput.releaseRegistry,
      transactionLedger: rootInput.transactionLedger,
      registryHistoryBinding: binding,
      expectedParent: {
        revision: actual.state.revision,
        stateDigest: actual.state.stateDigest,
        contentDigest: actual.release.contentDigest,
      },
    },
  };
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    const target = path.resolve(root);
    if (
      path.dirname(target) !== temporaryParent ||
      !path.basename(target).startsWith("rrsi-storage-binding-")
    )
      throw new Error("unsafe binding fixture cleanup");
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("genuine Registry History backend association", () => {
  it.each([false, true])(
    "binds exact v2=%s backend, registry, journal and artifact resolver without certifying cutover",
    (v2) => {
      const value = fixture({ v2 }),
        binding = createRrsiRegistryHistoryBinding(value.input);
      expect(binding.descriptor).toMatchObject({
        journalKind: v2 ? "manifest-v2" : "file-v1",
        transactionJournalObjectIdentityVerified: true,
        artifactPortsObjectIdentityVerified: true,
        artifactResolverObjectIdentityVerified: true,
        originCutoverAuthenticated: false,
        registryStoreIdentityAuthenticated: false,
        originClassificationAvailable: false,
        productionAuthorityVerified: false,
        qualifiesForPromotion: false,
      });
      expect(
        captureRrsiRegistryHistoryBinding(binding).matchesHistory(
          value.adapter,
        ),
      ).toBe(true);
      expect(recheckRrsiRegistryHistoryBinding(binding)).toMatchObject({
        originalStorageGraphRechecked: true,
        atomicDispatchOrPromotionAuthorized: false,
      });
      expect(() => captureRrsiRegistryHistoryBinding({ ...binding })).toThrow(
        /genuine Registry History/,
      );
    },
    90000,
  );
  it("preserves the original journal identity as valid unrelated events advance its head", () => {
    const value = fixture(),
      binding = createRrsiRegistryHistoryBinding(value.input),
      before = recheckRrsiRegistryHistoryBinding(binding);
    value.store.backend.ledger.appendDomainEvent(
      v2FixtureDomainEvent(value.store, "binding-head-advance"),
    );
    const after = recheckRrsiRegistryHistoryBinding(binding);
    expect(after.currentHead.sequence).toBe(before.currentHead.sequence + 1);
    expect(after.ledgerIdentity).toEqual(before.ledgerIdentity);
    expect(after.originCutoverAuthenticated).toBe(false);
  }, 90000);
  it("rejects another real backend with identical tenant, descriptors and campaign", () => {
    const left = fixture(),
      right = fixture();
    expect(() =>
      createRrsiRegistryHistoryBinding({
        ...left.input,
        backend: right.store.backend,
      }),
    ).toThrow(/same genuine backend journal/);
    expect(() =>
      createRrsiRegistryHistoryBinding({
        ...left.input,
        releaseRegistry: right.releases,
        transactionLedger: right.p.transactionLedger,
      }),
    ).toThrow(/same genuine backend journal/);
    expect(() =>
      createRrsiRegistryHistoryBinding({
        ...left.input,
        releaseRegistry: right.releases,
      }),
    ).toThrow(/another transaction port instance/);
  }, 120000);
  it("rejects a newly opened real artifact port object on the same physical store", () => {
    const value = fixture(),
      reopened = openLedgerV2Fixture(path.join(value.root, "store"), scope),
      different = ports(value.root, value.store, reopened.artifactPorts);
    const releaseRegistry = new SkillReleaseRegistry({
      tenantId: scope.tenantId,
      rootDir: path.join(value.root, "different-releases"),
      transactionLedger: different.transactionLedger,
      fsImpl: value.store.fsImpl,
      secure: false,
    });
    expect(() =>
      createRrsiRegistryHistoryBinding({
        ...value.input,
        releaseRegistry,
        transactionLedger: different.transactionLedger,
      }),
    ).toThrow(/original backend artifact ports and resolver/);
  }, 120000);
  it("rejects a different genuine resolver from the same port instance rather than comparing descriptors", () => {
    const value = fixture(),
      different =
        value.store.artifactPorts.createEvolutionLedgerArtifactResolver({
          purpose: "evolution-ledger",
        });
    expect(
      captureEvolutionLedgerArtifactResolverBinding(
        different,
      ).matchesArtifactPorts(value.store.artifactPorts),
    ).toBe(true);
    expect(
      captureEvolutionLedgerFileBackendBinding(
        value.store.backend,
      ).matchesArtifactResolver(different),
    ).toBe(false);
    const replacement = history(value.store, value.campaign, different);
    expect(() =>
      createRrsiRegistryHistoryBinding({
        ...value.input,
        historyAdapter: replacement,
      }),
    ).toThrow(/original backend artifact ports and resolver/);
  }, 90000);
  it("rejects copied objects, callbacks, proxies and option accessors without invoking them", () => {
    const value = fixture();
    let calls = 0;
    for (const altered of [
      { backend: { ...value.store.backend } },
      { historyAdapter: { ...value.adapter } },
      { releaseRegistry: { readState: () => calls++ } },
      { transactionLedger: { ...value.p.transactionLedger } },
      {
        backend: new Proxy(value.store.backend, {
          get() {
            calls++;
            throw new Error("trap");
          },
        }),
      },
    ])
      expect(() =>
        createRrsiRegistryHistoryBinding({ ...value.input, ...altered }),
      ).toThrow();
    const accessor = { ...value.input };
    Object.defineProperty(accessor, "backend", {
      enumerable: true,
      get() {
        calls++;
        return value.store.backend;
      },
    });
    expect(() => createRrsiRegistryHistoryBinding(accessor)).toThrow(
      /accessors/,
    );
    expect(calls).toBe(0);
  }, 90000);
  it("rechecks actual Registry marker bytes instead of relying on construction identity", () => {
    const value = fixture(),
      binding = createRrsiRegistryHistoryBinding(value.input),
      target = path.join(value.releases.rootDir, "_tenant.json");
    fs.chmodSync(target, 0o600);
    fs.writeFileSync(target, "damaged actual Registry marker");
    expect(() => recheckRrsiRegistryHistoryBinding(binding)).toThrow();
  }, 90000);
  it("refuses a damaged v2 retained payload even while the source WAL remains present", () => {
    const value = fixture(),
      binding = createRrsiRegistryHistoryBinding(value.input),
      target = path.join(
        value.store.manifest.segmentDirectory,
        fs.readdirSync(value.store.manifest.segmentDirectory)[0],
      );
    const stored = JSON.parse(fs.readFileSync(target, "utf8"));
    stored.bytes = Buffer.from("damaged retained payload").toString("base64");
    fs.writeFileSync(target, JSON.stringify(stored));
    expect(fs.existsSync(path.join(value.root, "store", "events"))).toBe(true);
    expect(() => recheckRrsiRegistryHistoryBinding(binding)).toThrow();
  }, 90000);
  it("binds a real promoted parent and refuses stale parent state after genuine rollback", async () => {
    const value = await parentFixture(),
      binding = createRrsiEffectiveParentBindingV2(value.parentInput);
    expect(binding.descriptor).toMatchObject({
      schema: "chainlesschain.rrsi-effective-parent-binding/v2",
      transactionJournalObjectIdentityVerified: true,
      backendArtifactPortsAndResolverIdentityVerified: true,
      registryOriginCutoverAuthenticated: false,
      productionAuthorityVerified: false,
    });
    expect(recheckRrsiEffectiveParent(binding)).toMatchObject({
      schema: "chainlesschain.rrsi-effective-parent-readback/v2",
      originalStorageGraphRechecked: true,
      effectiveParentUnchanged: true,
    });
    expect(() =>
      assertRrsiEffectiveParentHistory(
        binding,
        captureRrsiHistoryLedgerAdapter(value.adapter),
      ),
    ).not.toThrow();
    await value.released.rollbackTo(
      value.released.baseline.releaseDigest,
      "storage-binding-actual-rollback",
    );
    expect(() => recheckRrsiEffectiveParent(binding)).toThrow(
      /frozen active release/,
    );
    expect(
      recheckRrsiRegistryHistoryBinding(value.binding)
        .originalStorageGraphRechecked,
    ).toBe(true);
  }, 240000);
  it("rejects a real PM bridge on another backend before attaching the v2 parent runtime", async () => {
    const value = await parentFixture(),
      parent = createRrsiEffectiveParentBindingV2(value.parentInput);
    const foreign = openRrsiPmBridgeFixture(
      path.join(value.root, "foreign-pm"),
      { campaignOverrides: value.overrides },
    );
    expect(foreign.campaign.campaignDigest).toBe(value.campaign.campaignDigest);
    expect(() =>
      createRrsiRuntimeComposition({
        campaign: foreign.campaign,
        pmBridge: foreign.bridge,
        parentBinding: parent,
        mode: "shadow",
      }),
    ).toThrow(/different genuine History/);
    expect(foreign.adapter.inspect().executions).toHaveLength(0);
    expect(foreign.calls.run).toBe(0);
  }, 240000);
  it("keeps subclass readers rejected and original recovery/read paths independent of subclass overrides", async () => {
    const value = await parentFixture(),
      actualRegistry = value.parentInput.releaseRegistry,
      stale = value.released.readActive();
    const called = [];
    class StaleRegistry extends SkillReleaseRegistry {}
    for (const name of [
      "readActive",
      "readState",
      "readRelease",
      "readInventory",
    ])
      Object.defineProperty(StaleRegistry.prototype, name, {
        value() {
          called.push(name);
          if (name === "readActive") return stale;
          if (name === "readState") return stale.state;
          throw new Error(`Registry subclass override executed: ${name}`);
        },
      });
    const registry = new StaleRegistry({
      tenantId: scope.tenantId,
      rootDir: actualRegistry.baseDir,
      transactionLedger: value.parentInput.transactionLedger,
      fsImpl: value.store.fsImpl,
      secure: false,
    });
    expect(() => captureSkillReleaseRegistryReader(registry)).toThrow(
      /genuine SkillReleaseRegistry/,
    );
    const reader = Object.fromEntries(
      ["readActive", "readState", "readRelease", "readInventory"].map(
        (name) => [
          name,
          (...args) =>
            Reflect.apply(SkillReleaseRegistry.prototype[name], registry, args),
        ],
      ),
    );
    expect(reader.readActive(value.campaign.goalId)).toEqual(stale);
    expect(reader.readInventory().active[0].release).toEqual(stale.release);
    expect(() =>
      createRrsiRegistryHistoryBinding({
        ...value.input,
        historyAdapter: value.adapter,
        releaseRegistry: registry,
        transactionLedger: value.parentInput.transactionLedger,
      }),
    ).toThrow(/genuine SkillReleaseRegistry/);
    const parent = createRrsiEffectiveParentBindingV2(value.parentInput);
    await value.released.rollbackTo(
      value.released.baseline.releaseDigest,
      "storage-binding-subclass-rollback",
    );
    expect(reader.readState(value.campaign.goalId).revision).toBe(3);
    expect(reader.readActive(value.campaign.goalId).release.releaseDigest).toBe(
      value.released.baseline.releaseDigest,
    );
    expect(reader.readInventory().active[0].state.revision).toBe(3);
    expect(reader.readRelease(stale.release.releaseDigest)).toEqual(
      stale.release,
    );
    expect(() => recheckRrsiEffectiveParent(parent)).toThrow(
      /frozen active release/,
    );
    expect(called).toEqual([]);
  }, 300000);
  it("never reads attacker-controlled Registry bind properties and keeps genuine transaction methods frozen", () => {
    const value = fixture({ v2: false });
    const methods = [
      ...["readActive", "readState", "readRelease", "readInventory"].map(
        (name) => SkillReleaseRegistry.prototype[name],
      ),
    ];
    for (const name of ["prepare", "finalize", "migrate", "query"])
      if (typeof value.p.transactionLedger[name] === "function")
        expect(Object.isFrozen(value.p.transactionLedger[name])).toBe(true);
    let calls = 0;
    const installed = [];
    try {
      for (const method of methods) {
        Object.defineProperty(method, "bind", {
          configurable: true,
          get() {
            calls++;
            throw new Error("overridden Registry function.bind executed");
          },
        });
        installed.push(method);
      }
      const registry = new SkillReleaseRegistry({
        tenantId: scope.tenantId,
        rootDir: value.releases.baseDir,
        transactionLedger: value.p.transactionLedger,
        fsImpl: value.store.fsImpl,
        secure: false,
      });
      const reader = captureSkillReleaseRegistryReader(registry);
      expect(reader.readState(value.campaign.goalId).revision).toBe(0);
      expect(reader.readActive(value.campaign.goalId)).toBeNull();
      expect(reader.readInventory()).toEqual({ active: [], releases: [] });
      expect(() =>
        reader.readRelease(value.campaign.parentReleaseDigest),
      ).toThrow();
      const graph = createRrsiRegistryHistoryBinding({
        ...value.input,
        releaseRegistry: registry,
      });
      expect(
        recheckRrsiRegistryHistoryBinding(graph).originalStorageGraphRechecked,
      ).toBe(true);
      expect(calls).toBe(0);
    } finally {
      for (const method of installed) delete method.bind;
    }
  });
  it("binds the same genuine v2 History to a PM runtime, dispatches once and preserves charged unknown cost", async () => {
    const value = await parentFixture(),
      parent = createRrsiEffectiveParentBindingV2(value.parentInput);
    const pm = openRrsiPmBridgeFixture(path.join(value.root, "shared-pm"), {
      campaignOverrides: value.overrides,
      historyStore: {
        adapter: value.adapter,
        store: value.store,
        preparationPlan: (overrides) => ({ maxAttempts: 4, ...overrides }),
      },
    });
    const runtime = createRrsiRuntimeComposition({
      campaign: pm.campaign,
      pmBridge: pm.bridge,
      parentBinding: parent,
      mode: "shadow",
    });
    expect(runtime.descriptor).toMatchObject({
      fullProductionAdmissionVerified: false,
      supportsPromotion: false,
    });
    const response = reserveRrsiRuntimePmBroadRound(
      runtime,
      pm.journal,
      pm.roundInput(),
    );
    const result = await executeRrsiRuntimePmBroadRound(runtime, response);
    expect(result).toMatchObject({
      hostInvoked: true,
      dispatchCommitted: true,
      pmReceiptsVerified: true,
      independentSettlementRequired: true,
      qualifiesForPromotion: false,
    });
    expect(pm.calls.run).toBe(1);
    expect(inspectRrsiRuntimeHistory(runtime)).toMatchObject({
      preparationAttempts: 1,
      chargedResources: { maxCostMicrounits: "100000" },
      executions: [{ status: "unknown", dispatched: true }],
      qualifiesForPromotion: false,
    });
    await expect(
      executeRrsiRuntimePmBroadRound(runtime, response),
    ).rejects.toThrow(/fresh round/);
    expect(pm.calls.run).toBe(1);
    await value.released.rollbackTo(
      value.released.baseline.releaseDigest,
      "shared-pm-parent-drift",
    );
    expect(() =>
      reserveRrsiRuntimePmBroadRound(
        runtime,
        pm.journal,
        pm.roundInput({
          roundId: "pm-round-2",
          slotId: "pm-slot-2",
          executionId: "pm-execution-2",
        }),
      ),
    ).toThrow(/frozen active release/);
    expect(inspectRrsiRuntimeHistory(runtime).preparationAttempts).toBe(1);
    expect(pm.calls.run).toBe(1);
  }, 360000);
});
