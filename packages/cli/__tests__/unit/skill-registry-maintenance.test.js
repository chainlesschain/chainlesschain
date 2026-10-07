import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openEvolutionDurableStore } from "../fixtures/evolution-durable-store.js";
import { openRevocationReleaseRegistry } from "../fixtures/skill-revocation-release-registry.js";
import {
  SkillCandidateRegistry,
  captureSkillCandidateRegistryWriterControl,
  captureSkillCandidateRegistryReader,
} from "../../src/lib/evolution/skill-candidate-registry.js";
import {
  SkillReleaseRegistry,
  captureSkillReleaseRegistryWriterControl,
} from "../../src/lib/evolution/skill-release-registry.js";
import { withSkillRegistryMaintenance } from "../../src/lib/evolution/skill-registry-maintenance.js";

const roots = [],
  temporaryParent = fs.realpathSync.native(os.tmpdir());
const scope = {
  tenantId: "tenant-a",
  artifactTenantId: "artifact-tenant-a-release",
  audience: "evolution-runtime",
};
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function derivedInput(value, suffix = "new-draft") {
  const source = value.candidateRelease.candidate;
  return {
    ...Object.fromEntries(
      [
        "tenantId",
        "skillName",
        "content",
        "parentDigest",
        "dependencyLock",
        "runtimeManifest",
        "targetMatrix",
        "sourceEvidenceRefs",
        "derivationMode",
        "wikiRevision",
        "proposerModel",
        "requestedCapabilities",
        "evalRunId",
      ].map((name) => [name, source[name]]),
    ),
    parentDigest: source.contentDigest,
    content: source.content + `\nTEST ONLY ${suffix}\n`,
  };
}
async function fixture(options = {}) {
  const root = fs.mkdtempSync(
    path.join(temporaryParent, "cc-registry-maintenance-"),
  );
  roots.push(root);
  const storage = openEvolutionDurableStore(path.join(root, "store"), scope);
  const value = await openRevocationReleaseRegistry({
    root,
    storage: { ...storage, now: storage.clock() },
    fsImpl: storage.fsImpl,
    tenantId: scope.tenantId,
    artifactTenantId: scope.artifactTenantId,
    seed: true,
    ...options,
  });
  const input = {
    candidateRegistry: value.candidateRegistry,
    releaseRegistry: value.pruningRollbackOptions.releaseRegistry,
  };
  return { root, storage, value, input };
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    const resolved = path.resolve(root);
    if (
      path.dirname(resolved) !== temporaryParent ||
      !path.basename(resolved).startsWith("cc-registry-maintenance-")
    )
      throw new Error("unsafe Registry maintenance fixture cleanup");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

describe("actual participating Registry writer exclusion", () => {
  it("holds both stores through await, leaves old artifact bytes readable and exposes no cutover authority", async () => {
    const { input, value } = await fixture();
    const before = value.readActive(),
      files = fs.readdirSync(input.candidateRegistry.rootDir).sort();
    let captured;
    await withSkillRegistryMaintenance(input, async (context) => {
      captured = context;
      expect(context.descriptor).toMatchObject({
        participatingWriterExclusionVerified: true,
        preTransitionBinaryWritersExcluded: false,
        persistentStoreIdentityAuthenticated: false,
        originCutoverAuthenticated: false,
        qualifiesForPromotion: false,
      });
      expect(context.assertCurrent()).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(() => value.createDerivedCandidate()).toThrow(/already active/);
      await expect(
        value.rollbackTo(
          value.baseline.releaseDigest,
          "maintenance:denied-rollback",
        ),
      ).rejects.toThrow(/already active/);
      expect(value.readActive()).toEqual(before);
      expect(
        captureSkillCandidateRegistryReader(
          input.candidateRegistry,
        ).readInventory(),
      ).toHaveLength(2);
      expect(fs.readdirSync(input.candidateRegistry.rootDir).sort()).toEqual(
        files,
      );
      expect(context.assertCurrent()).toBe(true);
    });
    expect(() => captured.assertCurrent()).toThrow(/no longer live/);
    expect(value.createDerivedCandidate().candidateId).toBeDefined();
    await value.rollbackTo(
      value.baseline.releaseDigest,
      "maintenance:allowed-rollback",
    );
    expect(value.readActive().state.revision).toBe(3);
  });
  it("uses the same physical lock for reopened controls and denies constructor recovery while maintenance is active", async () => {
    const { input, storage, value } = await fixture();
    const candidateControl = captureSkillCandidateRegistryWriterControl(
      input.candidateRegistry,
    );
    const releaseControl = captureSkillReleaseRegistryWriterControl(
      input.releaseRegistry,
    );
    expect(candidateControl.descriptor.tenantId).toBe(
      releaseControl.descriptor.tenantId,
    );
    expect(candidateControl.orderKey).not.toBe(releaseControl.orderKey);
    await withSkillRegistryMaintenance(input, async () => {
      expect(
        () =>
          new SkillReleaseRegistry({
            tenantId: scope.tenantId,
            rootDir: input.releaseRegistry.baseDir,
            transactionLedger: value.pruningRollbackOptions.transactionLedger,
            fsImpl: storage.fsImpl,
            secure: false,
          }),
      ).toThrow(/could not be initialized safely/);
      expect(
        () =>
          new SkillCandidateRegistry({
            tenantId: scope.tenantId,
            rootDir: input.candidateRegistry.baseDir,
            // Lock acquisition precedes target admission or any marker write.
            targetMatrixAdmissionAuthority: {
              ...input.candidateRegistry.targetMatrixAdmissionAuthority,
              resolve() {
                throw new Error("admission must not be reached");
              },
            },
            fsImpl: storage.fsImpl,
            secure: false,
          }),
      ).toThrow(/could not be initialized safely/);
    });
    const reopened = new SkillReleaseRegistry({
      tenantId: scope.tenantId,
      rootDir: input.releaseRegistry.baseDir,
      transactionLedger: value.pruningRollbackOptions.transactionLedger,
      fsImpl: storage.fsImpl,
      secure: false,
    });
    const other = captureSkillReleaseRegistryWriterControl(reopened);
    expect(other).not.toBe(releaseControl);
    expect(other.orderKey).toBe(releaseControl.orderKey);
    expect(reopened.readActive("safe-refactor")).toEqual(value.readActive());
  });
  it.each([
    "after-journal",
    "after-prepare",
    "after-pointer",
    "after-finalize",
  ])(
    "keeps exclusion during a real transition awaiting %s and releases only after cleanup",
    async (phase) => {
      const ready = deferred(),
        finish = deferred();
      let armed = false;
      const { input, value } = await fixture({
        onTransition: async (current) => {
          if (armed && current === phase) {
            ready.resolve();
            await finish.promise;
          }
        },
      });
      armed = true;
      const pending = value.rollbackTo(
        value.baseline.releaseDigest,
        `maintenance:await-${phase}`,
      );
      try {
        await ready.promise;
        let calls = 0;
        await expect(
          withSkillRegistryMaintenance(input, () => {
            calls++;
          }),
        ).rejects.toThrow(/already active/);
        expect(calls).toBe(0);
        // The failed second-store acquisition cannot strand the first store.
        expect(
          input.candidateRegistry.create(derivedInput(value, phase)).created,
        ).toBe(true);
      } finally {
        finish.resolve();
      }
      await pending;
      expect(value.readActive().release.releaseDigest).toBe(
        value.baseline.releaseDigest,
      );
      expect(
        fs.readdirSync(path.join(input.releaseRegistry.rootDir, "journals")),
      ).toEqual([]);
      expect(
        fs.readdirSync(path.join(input.releaseRegistry.rootDir, "locks")),
      ).toEqual([]);
      await withSkillRegistryMaintenance(input, (context) =>
        expect(context.assertCurrent()).toBe(true),
      );
    },
  );
  it("releases both locks after rejection and rejects reentry instead of blocking the owner event loop", async () => {
    const { input, value } = await fixture();
    const sentinel = new Error("TEST maintenance rejected");
    await expect(
      withSkillRegistryMaintenance(input, async (context) => {
        await expect(
          withSkillRegistryMaintenance(input, () => {}),
        ).rejects.toThrow(/already active/);
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(context.assertCurrent()).toBe(true);
        throw sentinel;
      }),
    ).rejects.toBe(sentinel);
    expect(value.createDerivedCandidate().candidateId).toBeDefined();
    await value.rollbackTo(
      value.baseline.releaseDigest,
      "maintenance:after-rejection",
    );
    expect(value.readActive().state.revision).toBe(3);
  });
  it("rejects copied registries, foreign tenants, proxies and accessors without calling traps", async () => {
    const { input, storage, value } = await fixture();
    let calls = 0;
    const trap = () => {
      calls++;
      throw new Error("maintenance trap");
    };
    const accessor = { ...input };
    Object.defineProperty(accessor, "candidateRegistry", {
      enumerable: true,
      get: trap,
    });
    const foreign = new SkillReleaseRegistry({
      tenantId: "foreign-tenant",
      rootDir: input.releaseRegistry.baseDir,
      transactionLedger: value.pruningRollbackOptions.transactionLedger,
      secure: false,
      fsImpl: storage.fsImpl,
    });
    for (const altered of [
      { ...input, candidateRegistry: { ...input.candidateRegistry } },
      { ...input, releaseRegistry: { ...input.releaseRegistry } },
      { ...input, releaseRegistry: foreign },
      {
        ...input,
        candidateRegistry: new Proxy(input.candidateRegistry, {
          get: trap,
          getPrototypeOf: trap,
        }),
      },
      accessor,
      new Proxy(input, { ownKeys: trap, getPrototypeOf: trap }),
    ])
      await expect(
        withSkillRegistryMaintenance(altered, trap),
      ).rejects.toThrow();
    expect(calls).toBe(0);
    expect(
      captureSkillReleaseRegistryWriterControl(foreign).descriptor.tenantId,
    ).toBe("foreign-tenant");
  });
});
