import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { openLedgerV2Fixture } from "../fixtures/evolution-ledger-v2-store.js";
import { openEvolutionDurableStore } from "../fixtures/evolution-durable-store.js";
import {
  SkillCandidateRegistry,
  SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_AUTHORITY_SCHEMA,
} from "../../src/lib/evolution/skill-candidate-registry.js";
import { SkillReleaseRegistry } from "../../src/lib/evolution/skill-release-registry.js";
import {
  inspectPrivatePaths,
  repairPrivatePath,
  _deps as privateStorageDeps,
} from "../../src/lib/secure-fs.js";
import { rrsiCanonical, rrsiHash } from "../../src/lib/evolution/rrsi-data.js";
import {
  createRrsiRegistryStorePolicy,
  captureRrsiRegistryStorePolicy,
  RRSI_REGISTRY_STORE_POLICY_EVENT_TYPE,
  RRSI_REGISTRY_STORE_POLICY_ARTIFACT_TYPE,
  RRSI_REGISTRY_STORE_POLICY_HOLD_CODE,
} from "../../src/lib/evolution/rrsi-registry-store-policy.js";

const roots = [];
const temporaryParent = fs.realpathSync.native(os.tmpdir());
const scope = {
  tenantId: "tenant-a",
  artifactTenantId: "artifact-tenant-a-release",
  audience: "evolution-runtime",
};
function directory(cleanupRoots = roots) {
  const root = fs.mkdtempSync(
    path.join(temporaryParent, "cc-rrsi-store-policy-"),
  );
  cleanupRoots.push(root);
  return root;
}
function composition(store) {
  return {
    backend: store.backend,
    artifactPorts: store.artifactPorts,
    ledgerArtifactResolver: store.resolver,
    descriptor: { ...scope, purpose: "evolution-ledger" },
  };
}
function fixture(options = {}, cleanupRoots = roots) {
  const root = directory(cleanupRoots);
  const store = openLedgerV2Fixture(path.join(root, "store"), {
    ...scope,
    ...options,
  });
  const parentDir = path.join(root, "provisioned");
  fs.mkdirSync(parentDir, { mode: 0o700 });
  repairPrivatePath(parentDir);
  const policy = createRrsiRegistryStorePolicy(composition(store));
  return {
    root,
    store,
    policy,
    request: { parentDir, operationId: "test:provision:first" },
  };
}
function policyEvents(store) {
  return store.journal
    .read()
    .filter((event) => event.type === RRSI_REGISTRY_STORE_POLICY_EVENT_TYPE);
}
function preparedFrom(store) {
  const event = policyEvents(store)[0];
  const resolution = store.resolver({
    epoch: event.epoch,
    ledgerId: event.ledgerId,
    ref: { ...event.subjectRef },
    tenantId: scope.artifactTenantId,
  });
  return JSON.parse(resolution.bytes.toString("utf8")).value.payload;
}
function markerPath(prepared, name) {
  return path.join(prepared[name].rootDir, "_tenant.json");
}
function admission() {
  return {
    schema: SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_AUTHORITY_SCHEMA,
    trust: "trusted",
    authorityId: "test-only:blocked-store",
    revision: 1,
    handlerArtifactDigest: `sha256:${"a".repeat(64)}`,
    resolve() {
      throw new Error("target admission must never be reached");
    },
  };
}
function legacyMarker(prepared, name) {
  const core = {
    schema: `chainlesschain.skill-${name}-tenant-marker/v1`,
    component: `skill-${name}-registry`,
    tenantId: scope.tenantId,
    tenantKey: prepared[name].tenantKey,
  };
  return Buffer.from(
    `${rrsiCanonical({ ...core, markerDigest: rrsiHash(core.schema, core) })}\n`,
  );
}
function cleanupFixtures(cleanupRoots) {
  for (const root of cleanupRoots.splice(0)) {
    if (
      path.dirname(path.resolve(root)) !== temporaryParent ||
      !path.basename(root).startsWith("cc-rrsi-store-policy-")
    )
      throw new Error("unsafe store policy fixture cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  }
}
afterEach(() => {
  vi.restoreAllMocks();
  cleanupFixtures(roots);
});

describe("authenticated fresh Registry provisioning before Registry construction", () => {
  describe.sequential("committed fresh pair readback and containment", () => {
    const sharedRoots = [];
    let shared, before, result;
    // Each case starts from the same genuine committed pair and leaves its
    // retained state unchanged; none depends on another test having run.
    beforeAll(() => {
      shared = fixture({}, sharedRoots);
      before = shared.store.journal.verify().sequence;
    }, 60_000);
    beforeAll(() => {
      result = shared.policy.provisionFresh(shared.request);
    }, 60_000);
    afterAll(() => cleanupFixtures(sharedRoots), 60_000);

    it("retains three ordered phases and installs independent v2 floors", () => {
      const { store } = shared;
      expect(result).toMatchObject({
        phase: "committed",
        historyAuthenticated: true,
        freshPhysicalPairProvisioningCommitted: true,
        writerFloorInstalled: true,
        originCutoverAuthenticated: false,
        originClassificationAvailable: false,
        legacyWriterDrainVerified: false,
        productionAuthorityVerified: false,
        grantsMutationOrPromotionAuthority: false,
        readyForExecution: false,
        qualifiesForPromotion: false,
      });
      expect(result.records.map((record) => record.phase)).toEqual([
        "prepared",
        "markers-installed",
        "committed",
      ]);
      expect(store.journal.verify().sequence).toBe(before + 3);
      for (const name of ["candidate", "release"]) {
        const marker = JSON.parse(
          fs.readFileSync(
            path.join(result.prepared[name].rootDir, "_tenant.json"),
            "utf8",
          ),
        );
        expect(marker.schema).toBe(
          `chainlesschain.skill-${name}-tenant-marker/v2`,
        );
        expect(marker.writerFloor).toBe(2);
        expect(marker.storeId).toBe(result.prepared[name].storeId);
        expect(marker.peerStoreId).toBe(
          result.prepared[name === "candidate" ? "release" : "candidate"]
            .storeId,
        );
        expect(marker.journalIdentity).toEqual(result.prepared.journalIdentity);
      }
      expect(result.prepared.candidate.storeId).not.toBe(
        result.prepared.release.storeId,
      );
    }, 60_000);

    it("idempotently recovers and genuinely reopens only the original physical pair with branded handles", () => {
      const { root, store, policy, request } = shared;
      expect(policy.provisionFresh(request)).toEqual(result);
      expect(policy.recover(request.operationId)).toEqual(result);
      const reopenedStore = openLedgerV2Fixture(
        path.join(root, "store"),
        scope,
      );
      const reopened = createRrsiRegistryStorePolicy(
        composition(reopenedStore),
      );
      expect(reopened.read(request.operationId)).toEqual(result);
      const captured = captureRrsiRegistryStorePolicy(policy);
      expect(captured.matchesBackend(store.backend)).toBe(true);
      expect(captured.matchesBackend(reopenedStore.backend)).toBe(false);
      expect(captured.matchesArtifactPorts(store.artifactPorts)).toBe(true);
      expect(captured.matchesArtifactResolver(store.resolver)).toBe(true);
      expect(() => captureRrsiRegistryStorePolicy({ ...policy })).toThrow(
        /genuine/,
      );
    }, 60_000);

    it("verifies native private permissions and rejects the unchanged v1 constructors", () => {
      const { store, policy, request } = shared;
      expect(
        inspectPrivatePaths(
          [
            ...result.prepared.directories.map((entry) => entry.path),
            markerPath(result.prepared, "candidate"),
            markerPath(result.prepared, "release"),
          ],
          { failIfUnavailable: true },
        ).every((entry) => entry.ok),
      ).toBe(true);
      // These are the actual unchanged v1-marker constructors, not a fabricated
      // legacy-drain receipt or a claim of running every historical binary.
      expect(
        () =>
          new SkillCandidateRegistry({
            tenantId: scope.tenantId,
            rootDir: result.prepared.candidate.baseDir,
            secure: false,
            targetMatrixAdmissionAuthority: admission(),
            fsImpl: store.fsImpl,
          }),
      ).toThrow(/marker/);
      const never = () => {
        throw new Error("transaction port must never be reached");
      };
      expect(
        () =>
          new SkillReleaseRegistry({
            tenantId: scope.tenantId,
            rootDir: result.prepared.release.baseDir,
            secure: false,
            fsImpl: store.fsImpl,
            transactionLedger: {
              prepare: never,
              finalize: never,
              query: never,
            },
          }),
      ).toThrow(/marker/);
      // The participating v1 constructor lock is a sibling in tenants, and does
      // not leave a file behind after rejecting the marker.
      expect(policy.read(request.operationId)).toEqual(result);
    }, 60_000);

    it("cannot reset the registered operation or select a different parent", () => {
      const { root, policy, request } = shared;
      expect(() =>
        policy.provisionFresh({
          ...request,
          operationId: "test:new-operation",
        }),
      ).toThrow(/already has/);
      expect(() =>
        policy.provisionFresh({ ...request, parentDir: root }),
      ).toThrow(/already has/);
      expect(fs.readdirSync(request.parentDir)).toEqual([
        result.prepared.namespaceId,
      ]);
    }, 60_000);

    it("rejects nesting a second policy inside Registry or pair storage", () => {
      const { root, policy, request } = shared;
      const otherStore = openLedgerV2Fixture(
        path.join(root, "other-store"),
        scope,
      );
      const otherPolicy = createRrsiRegistryStorePolicy(
        composition(otherStore),
      );
      for (const parentDir of [
        result.prepared.candidate.baseDir,
        result.prepared.release.rootDir,
        path.dirname(result.prepared.candidate.rootDir),
        result.prepared.directories[0].path,
      ])
        expect(() =>
          otherPolicy.provisionFresh({ ...request, parentDir }),
        ).toThrow(/Registry/);
      expect(policy.read(request.operationId)).toEqual(result);
      expect(() => otherPolicy.read(request.operationId)).toThrow(
        /unregistered/,
      );
    }, 60_000);
  });

  it("rejects v1, copied graphs, alternate genuine resolvers, proxies, accessors and caller fields before allocation", () => {
    const { root, store, request } = fixture();
    const input = composition(store);
    const other = openLedgerV2Fixture(path.join(root, "other-store"), scope);
    const v1 = openEvolutionDurableStore(path.join(root, "v1-store"), scope);
    let traps = 0;
    const trap = () => {
      traps++;
      throw new Error("composition trap");
    };
    const accessor = { ...input };
    Object.defineProperty(accessor, "backend", { enumerable: true, get: trap });
    for (const altered of [
      composition(v1),
      { ...input, backend: { ...store.backend } },
      { ...input, artifactPorts: other.artifactPorts },
      { ...input, ledgerArtifactResolver: other.resolver },
      {
        ...input,
        ledgerArtifactResolver:
          store.artifactPorts.createEvolutionLedgerArtifactResolver({
            purpose: "evolution-ledger",
          }),
      },
      {
        ...input,
        descriptor: { ...input.descriptor, tenantId: "foreign-tenant" },
      },
      {
        ...input,
        descriptor: { ...input.descriptor, audience: "foreign-runtime" },
      },
      { ...input, backend: new Proxy(store.backend, { get: trap }) },
      accessor,
      new Proxy(input, { getPrototypeOf: trap, ownKeys: trap }),
      { ...input, fsImpl: fs },
      { ...input, originPolicy: { admitted: true } },
    ])
      expect(() => createRrsiRegistryStorePolicy(altered)).toThrow();
    expect(traps).toBe(0);
    expect(fs.readdirSync(request.parentDir)).toEqual([]);
  }, 60_000);

  describe("unregistered provisioning input rejection", () => {
    const sharedRoots = [];
    let shared;
    beforeAll(() => {
      shared = fixture({}, sharedRoots);
    }, 60_000);
    afterAll(() => cleanupFixtures(sharedRoots), 60_000);

    it("rejects caller-selected roots, invalid parents and protected Ledger storage before allocation", () => {
      const { root, store, policy, request } = shared;
      for (const invalid of [
        { ...request, rootDir: request.parentDir },
        { ...request, quiescent: true },
        { ...request, parentDir: "relative" },
        { ...request, parentDir: path.join(root, "missing") },
        { ...request, parentDir: store.backend.descriptor.authorityRootDir },
      ])
        expect(() => policy.provisionFresh(invalid)).toThrow();
      expect(fs.readdirSync(request.parentDir)).toEqual([]);
    }, 60_000);
  });

  it("rechecks Registry ancestry after native parent inspection before creating a pair", () => {
    const { store, policy, request } = fixture();
    const original = fs.lstatSync(request.parentDir);
    const marker = path.join(request.parentDir, "_tenant.json");
    let injected = false;
    const insertMarker = () => {
      fs.writeFileSync(marker, "TEST ONLY concurrent Registry marker", {
        flag: "wx",
      });
      injected = true;
    };
    if (process.platform === "win32") {
      const nativeSpawn = privateStorageDeps.spawnSync;
      vi.spyOn(privateStorageDeps, "spawnSync").mockImplementation(
        (file, args, options) => {
          const result = Reflect.apply(nativeSpawn, privateStorageDeps, [
            file,
            args,
            options,
          ]);
          const inspection =
            typeof options?.input === "string"
              ? JSON.parse(options.input)
              : null;
          if (
            !injected &&
            inspection?.operation === "inspect" &&
            inspection.targets.length === 1 &&
            inspection.targets[0] === request.parentDir
          ) {
            expect(result.error).toBeUndefined();
            expect(result.status, result.stderr).toBe(0);
            const parsed = JSON.parse(result.stdout.trim());
            const entries = Array.isArray(parsed) ? parsed : [parsed];
            expect(entries).toEqual([
              expect.objectContaining({
                target: request.parentDir,
                exists: true,
                ok: true,
              }),
            ]);
            insertMarker();
          }
          return result;
        },
      );
    } else {
      const nativeLstat = fs.lstatSync;
      vi.spyOn(fs, "lstatSync").mockImplementation((target, ...args) => {
        const stat = nativeLstat(target, ...args);
        if (!injected && target === request.parentDir) {
          const nativeUid = stat.uid;
          // inspectPrivatePath reads uid after the real mode check. Directory
          // identity checks do not read uid, so the early ancestry scan has
          // already completed when this hook inserts the marker.
          Object.defineProperty(stat, "uid", {
            configurable: true,
            enumerable: true,
            get() {
              if (!injected) insertMarker();
              return nativeUid;
            },
          });
        }
        return stat;
      });
    }
    const nativeMkdir = fs.mkdirSync;
    const pairDirectories = [];
    vi.spyOn(fs, "mkdirSync").mockImplementation((target, options) => {
      if (path.basename(String(target)).startsWith("pair."))
        pairDirectories.push(target);
      return nativeMkdir(target, options);
    });
    expect(() => policy.provisionFresh(request)).toThrow(/Registry/);
    vi.restoreAllMocks();
    expect(injected).toBe(true);
    const current = fs.lstatSync(request.parentDir);
    expect([current.dev, current.ino]).toEqual([original.dev, original.ino]);
    expect(pairDirectories).toEqual([]);
    expect(fs.readdirSync(request.parentDir)).toEqual(["_tenant.json"]);
    expect(policyEvents(store)).toHaveLength(0);
  }, 60_000);

  it.each(["candidate", "release"])(
    "never repairs a missing committed %s marker or accepts a same-bytes replacement",
    (name) => {
      const { root, policy, request } = fixture();
      const result = policy.provisionFresh(request);
      const target = markerPath(result.prepared, name);
      const original = fs.readFileSync(target);
      fs.renameSync(target, path.join(root, "retired-marker"));
      expect(() => policy.read(request.operationId)).toThrow();
      expect(() => policy.recover(request.operationId)).toThrow();
      expect(() => policy.provisionFresh(request)).toThrow();
      expect(fs.existsSync(target)).toBe(false);
      fs.writeFileSync(target, original, { flag: "wx" });
      expect(() => policy.read(request.operationId)).toThrow(
        /physical identity/,
      );
      expect(fs.readFileSync(target)).toEqual(original);
    },
    60_000,
  );

  it("rejects directory replacement, lowered marker floors and unknown bootstrap files", () => {
    const { root, policy, request } = fixture();
    const result = policy.provisionFresh(request);
    const target = markerPath(result.prepared, "candidate");
    const original = fs.readFileSync(target);
    const altered = JSON.parse(original);
    altered.writerFloor = 1;
    const { markerDigest: ignoredDigest, ...core } = altered;
    fs.writeFileSync(
      target,
      `${rrsiCanonical({ ...core, markerDigest: rrsiHash(core.schema, core) })}\n`,
    );
    expect(ignoredDigest).toBeDefined();
    expect(() => policy.read(request.operationId)).toThrow(/floor differ/);
    fs.writeFileSync(target, original);
    const extra = path.join(result.prepared.release.rootDir, "unexpected.tmp");
    fs.writeFileSync(extra, "TEST ONLY debris");
    expect(() => policy.recover(request.operationId)).toThrow(/inventory/);
    fs.unlinkSync(extra);
    const candidateRoot = result.prepared.candidate.rootDir;
    fs.renameSync(candidateRoot, path.join(root, "retired-directory"));
    fs.mkdirSync(candidateRoot);
    fs.writeFileSync(target, original);
    expect(() => policy.read(request.operationId)).toThrow(
      /directory identity/,
    );
  }, 60_000);

  it("preserves the v2 winner and private debris when the second marker publication fails", () => {
    const { store, policy, request } = fixture();
    const link = fs.linkSync;
    const failing = vi
      .spyOn(fs, "linkSync")
      .mockImplementation((source, target) => {
        if (
          path.basename(target) === "_tenant.json" &&
          target.includes(`${path.sep}release${path.sep}`)
        )
          throw Object.assign(
            new Error("TEST ONLY second publication failed"),
            { code: "EIO" },
          );
        return link(source, target);
      });
    expect(() => policy.provisionFresh(request)).toThrow(/second publication/);
    failing.mockRestore();
    const prepared = preparedFrom(store);
    const candidate = fs.readFileSync(markerPath(prepared, "candidate"));
    expect(JSON.parse(candidate).writerFloor).toBe(2);
    expect(fs.existsSync(markerPath(prepared, "release"))).toBe(false);
    const before = fs.readdirSync(prepared.release.rootDir);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatch(/^\.rrsi-marker-.*\.tmp$/u);
    for (const action of [
      () => policy.recover(request.operationId),
      () => policy.provisionFresh(request),
    ])
      expect(action).toThrow(/inventory/);
    expect(fs.readFileSync(markerPath(prepared, "candidate"))).toEqual(
      candidate,
    );
    expect(fs.readdirSync(prepared.release.rootDir)).toEqual(before);
    expect(policyEvents(store)).toHaveLength(1);
  }, 60_000);

  it("cannot overwrite a v1 initializer winner between marker staging and atomic link", () => {
    const { store, policy, request } = fixture();
    const link = fs.linkSync;
    let winner;
    const racing = vi
      .spyOn(fs, "linkSync")
      .mockImplementation((source, target) => {
        if (!winner && path.basename(target) === "_tenant.json") {
          winner = legacyMarker(preparedFrom(store), "candidate");
          fs.writeFileSync(target, winner, { flag: "wx" });
        }
        return link(source, target);
      });
    expect(() => policy.provisionFresh(request)).toThrowError(
      expect.objectContaining({ code: "EEXIST" }),
    );
    racing.mockRestore();
    expect(winner).toBeInstanceOf(Buffer);
    const prepared = preparedFrom(store);
    expect(fs.readFileSync(markerPath(prepared, "candidate"))).toEqual(winner);
    expect(() => policy.recover(request.operationId)).toThrow();
    expect(policyEvents(store)).toHaveLength(1);
  }, 60_000);

  it("recovers prepared only when both original single-link markers were fully installed", () => {
    const { root, store, policy, request } = fixture();
    const unlink = fs.unlinkSync;
    let stopped = false;
    const interruption = vi
      .spyOn(fs, "unlinkSync")
      .mockImplementation((target) => {
        const result = unlink(target);
        if (
          !stopped &&
          target.includes(`${path.sep}release${path.sep}`) &&
          path.basename(target).startsWith(".rrsi-marker-")
        ) {
          stopped = true;
          throw new Error("TEST ONLY stopped after second marker cleanup");
        }
        return result;
      });
    expect(() => policy.provisionFresh(request)).toThrow(
      /second marker cleanup/,
    );
    interruption.mockRestore();
    expect(policyEvents(store)).toHaveLength(1);
    const prepared = preparedFrom(store);
    const markers = ["candidate", "release"].map((name) =>
      fs.readFileSync(markerPath(prepared, name)),
    );
    const reopenedStore = openLedgerV2Fixture(path.join(root, "store"), scope);
    const recovered = createRrsiRegistryStorePolicy(
      composition(reopenedStore),
    ).recover(request.operationId);
    expect(recovered.phase).toBe("committed");
    expect(recovered.prepared).toEqual(prepared);
    expect(policyEvents(reopenedStore)).toHaveLength(3);
    expect(
      ["candidate", "release"].map((name) =>
        fs.readFileSync(markerPath(prepared, name)),
      ),
    ).toEqual(markers);
  }, 60_000);

  it.each([2, 3])(
    "recovers retained phase %i after a real manifest head commit loses its response",
    (phase) => {
      let armed = false,
        fired = false,
        baseline = 0;
      const { root, store, policy, request } = fixture({
        fault(current, counts) {
          if (
            armed &&
            !fired &&
            current === "after-head" &&
            counts.head === baseline + phase
          ) {
            fired = true;
            throw new Error("TEST ONLY retained response lost");
          }
        },
      });
      baseline = store.manifest.counts.head;
      armed = true;
      expect(() => policy.provisionFresh(request)).toThrow(
        /commit is uncertain/,
      );
      expect(fired).toBe(true);
      const names = fs.readdirSync(request.parentDir);
      const reopenedStore = openLedgerV2Fixture(
        path.join(root, "store"),
        scope,
      );
      expect(policyEvents(reopenedStore)).toHaveLength(phase);
      const reopened = createRrsiRegistryStorePolicy(
        composition(reopenedStore),
      );
      const recovered = reopened.recover(request.operationId);
      expect(recovered.phase).toBe("committed");
      expect(policyEvents(reopenedStore)).toHaveLength(3);
      expect(fs.readdirSync(request.parentDir)).toEqual(names);
      expect(reopened.recover(request.operationId)).toEqual(recovered);
    },
    60_000,
  );

  it("keeps a retained prepared operation without markers on HOLD after response loss", () => {
    let armed = false,
      fired = false;
    const { root, policy, request } = fixture({
      fault(current) {
        if (armed && !fired && current === "after-head") {
          fired = true;
          throw new Error("TEST ONLY prepared response lost");
        }
      },
    });
    armed = true;
    expect(() => policy.provisionFresh(request)).toThrow(/commit is uncertain/);
    const reopenedStore = openLedgerV2Fixture(path.join(root, "store"), scope);
    expect(policyEvents(reopenedStore)).toHaveLength(1);
    const prepared = preparedFrom(reopenedStore);
    const reopened = createRrsiRegistryStorePolicy(composition(reopenedStore));
    for (const action of [
      () => reopened.recover(request.operationId),
      () => reopened.provisionFresh(request),
    ])
      expect(action).toThrow(/inventory/);
    expect(fs.existsSync(markerPath(prepared, "candidate"))).toBe(false);
    expect(fs.existsSync(markerPath(prepared, "release"))).toBe(false);
    expect(fs.readdirSync(request.parentDir)).toEqual([prepared.namespaceId]);
  }, 60_000);

  it("retains orphans from failed allocation and never adopts caller-selected debris", () => {
    const { policy, request, store } = fixture();
    const mkdir = fs.mkdirSync;
    let fail = true;
    const failed = vi
      .spyOn(fs, "mkdirSync")
      .mockImplementation((target, options) => {
        if (
          fail &&
          path.basename(target) === "candidate" &&
          target.includes("pair.")
        ) {
          fail = false;
          throw new Error("TEST ONLY allocation stopped");
        }
        return mkdir(target, options);
      });
    expect(() => policy.provisionFresh(request)).toThrow(/allocation stopped/);
    failed.mockRestore();
    const orphans = fs.readdirSync(request.parentDir);
    expect(orphans).toHaveLength(1);
    expect(policyEvents(store)).toHaveLength(0);
    const result = policy.provisionFresh(request);
    expect(orphans).not.toContain(result.prepared.namespaceId);
    expect(fs.readdirSync(request.parentDir).sort()).toEqual(
      [...orphans, result.prepared.namespaceId].sort(),
    );
    expect(fs.readdirSync(path.join(request.parentDir, orphans[0]))).toEqual(
      [],
    );
  }, 60_000);

  it("requires dedicated ledger-retained artifacts and rejects signed out-of-order policy records", () => {
    const { store, policy } = fixture();
    const context = {
      audience: scope.audience,
      purpose: "evolution-ledger",
      retention: "ledger",
    };
    expect(() =>
      store.artifactPorts.putCanonical(
        RRSI_REGISTRY_STORE_POLICY_ARTIFACT_TYPE,
        { testOnly: true },
        { ...context, ttlMs: 1000 },
      ),
    ).toThrow();
    const subject = store.artifactPorts.putCanonical(
      RRSI_REGISTRY_STORE_POLICY_ARTIFACT_TYPE,
      { schema: "TEST ONLY invalid phase", phase: "committed" },
      context,
    );
    store.journal.appendDomainEvent({
      type: RRSI_REGISTRY_STORE_POLICY_EVENT_TYPE,
      eventId: "test:forged-policy",
      tenantId: scope.tenantId,
      artifactTenantId: scope.artifactTenantId,
      skillName: null,
      decision: "committed",
      reason: "TEST ONLY authenticated invalid policy",
      correlationId: policy.descriptor.scopeId,
      sourceRefs: [],
      subjectRef: subject.ref,
    });
    expect(() => createRrsiRegistryStorePolicy(composition(store))).toThrow();
    expect(() => policy.read("test:provision:first")).toThrow();
  }, 60_000);

  it("releases its operation lock after rejection and uses genuine live policy handles only", () => {
    const { policy, request } = fixture();
    expect(() => policy.recover(request.operationId)).toThrow(/unregistered/);
    const result = policy.provisionFresh(request);
    expect(
      captureRrsiRegistryStorePolicy(policy).read(request.operationId),
    ).toEqual(result);
    expect(() => policy.read("test:missing")).toThrowError(
      expect.objectContaining({ code: RRSI_REGISTRY_STORE_POLICY_HOLD_CODE }),
    );
    expect(policy.read(request.operationId)).toEqual(result);
    let traps = 0;
    expect(() =>
      captureRrsiRegistryStorePolicy(
        new Proxy(policy, {
          get() {
            traps++;
          },
        }),
      ),
    ).toThrow(/genuine/);
    expect(traps).toBe(0);
  }, 60_000);

  it("checks parent permissions before allocation and on reopen without repairing caller storage", () => {
    const { policy, request } = fixture();
    const broaden = () => {
      if (process.platform === "win32") {
        const result = spawnSync(
          "icacls.exe",
          [request.parentDir, "/grant", "*S-1-1-0:(OI)(CI)(F)"],
          { encoding: "utf8", windowsHide: true, timeout: 15_000 },
        );
        expect(result.status, result.stderr).toBe(0);
      } else fs.chmodSync(request.parentDir, 0o777);
      expect(inspectPrivatePaths([request.parentDir])[0].ok).toBe(false);
    };
    broaden();
    expect(() => policy.provisionFresh(request)).toThrow(/owner-only/);
    expect(fs.readdirSync(request.parentDir)).toEqual([]);
    expect(inspectPrivatePaths([request.parentDir])[0].ok).toBe(false);
    repairPrivatePath(request.parentDir);
    const result = policy.provisionFresh(request);
    broaden();
    expect(() => policy.read(request.operationId)).toThrow(/owner-only/);
    expect(() => policy.recover(request.operationId)).toThrow(/owner-only/);
    expect(inspectPrivatePaths([request.parentDir])[0].ok).toBe(false);
    repairPrivatePath(request.parentDir);
    expect(policy.read(request.operationId)).toEqual(result);
  }, 90_000);

  it.each([
    "before-mkdir",
    "before-temp-open",
    "before-temp-write",
    "before-temp-acl",
  ])(
    "stops new mutations after ownership is lost at %s and leaves the new owner untouched",
    (boundary) => {
      const { store, policy, request } = fixture();
      const ownerFile = path.join(
        store.backend.descriptor.authorityRootDir,
        "rrsi-registry-store-policy-operations.lock",
        "owner.json",
      );
      const replacements = [];
      const replaceOwner = () => {
        const owner = {
          ...JSON.parse(fs.readFileSync(ownerFile, "utf8")),
          token: "test-only-replacement-owner-token",
        };
        fs.writeFileSync(ownerFile, JSON.stringify(owner));
        replacements.push(owner);
      };
      const mkdir = fs.mkdirSync,
        readdir = fs.readdirSync,
        open = fs.openSync,
        read = fs.readSync;
      let armed = boundary === "before-mkdir",
        touched = false;
      let temporaryOpened = false,
        temporaryWrites = 0,
        temporaryFd = null;
      let permissionMutationsAfterLoss = 0;
      const nativeSpawn = privateStorageDeps.spawnSync;
      vi.spyOn(privateStorageDeps, "spawnSync").mockImplementation(
        (file, args, options) => {
          const request =
            typeof options?.input === "string"
              ? JSON.parse(options.input)
              : null;
          if (
            replacements.length &&
            request?.operation === "repair" &&
            request.targets.some((target) => target.includes("pair."))
          )
            permissionMutationsAfterLoss++;
          return Reflect.apply(nativeSpawn, privateStorageDeps, [
            file,
            args,
            options,
          ]);
        },
      );
      const chmod = fs.chmodSync;
      vi.spyOn(fs, "chmodSync").mockImplementation((target, mode) => {
        if (replacements.length && String(target).includes("pair."))
          permissionMutationsAfterLoss++;
        return chmod(target, mode);
      });
      if (boundary === "before-mkdir") {
        const lstat = fs.lstatSync;
        vi.spyOn(fs, "lstatSync").mockImplementation((target, ...args) => {
          const result = lstat(target, ...args);
          if (
            armed &&
            target === request.parentDir &&
            fs.existsSync(ownerFile)
          ) {
            armed = false;
            replaceOwner();
          }
          return result;
        });
      }
      vi.spyOn(fs, "mkdirSync").mockImplementation((target, options) => {
        if (String(target).includes("pair.")) touched = true;
        return mkdir(target, options);
      });
      if (boundary === "before-temp-open")
        vi.spyOn(fs, "readdirSync").mockImplementation((target, ...args) => {
          const result = readdir(target, ...args);
          if (
            !replacements.length &&
            String(target).includes(
              `${path.sep}candidate${path.sep}tenants${path.sep}`,
            ) &&
            policyEvents(store).length === 1
          )
            replaceOwner();
          return result;
        });
      vi.spyOn(fs, "openSync").mockImplementation((target, flags, mode) => {
        const fd = open(target, flags, mode);
        if (
          path.basename(String(target)).startsWith(".rrsi-marker-") &&
          flags === "wx"
        ) {
          temporaryOpened = true;
          if (boundary === "before-temp-write") replaceOwner();
        }
        if (
          boundary === "before-temp-acl" &&
          path.basename(String(target)).startsWith(".rrsi-marker-") &&
          flags !== "wx"
        )
          temporaryFd = fd;
        return fd;
      });
      const write = fs.writeFileSync;
      vi.spyOn(fs, "writeFileSync").mockImplementation((target, ...args) => {
        if (typeof target === "number" && temporaryOpened) temporaryWrites++;
        return write(target, ...args);
      });
      if (boundary === "before-temp-acl")
        vi.spyOn(fs, "readSync").mockImplementation(
          (fd, buffer, offset, length, position) => {
            const result = read(fd, buffer, offset, length, position);
            if (
              !replacements.length &&
              fd === temporaryFd &&
              length === 1 &&
              result === 0
            )
              replaceOwner();
            return result;
          },
        );
      expect(() => policy.provisionFresh(request)).toThrowError(
        expect.objectContaining({ code: "STATE_LOCK_OWNERSHIP_LOST" }),
      );
      vi.restoreAllMocks();
      expect(replacements).toHaveLength(1);
      expect(permissionMutationsAfterLoss).toBe(0);
      expect(JSON.parse(fs.readFileSync(ownerFile, "utf8"))).toEqual(
        replacements[0],
      );
      if (boundary === "before-mkdir") {
        expect(touched).toBe(false);
        expect(fs.readdirSync(request.parentDir)).toEqual([]);
      } else {
        const prepared = preparedFrom(store);
        expect(fs.existsSync(markerPath(prepared, "candidate"))).toBe(false);
        expect(policyEvents(store)).toHaveLength(1);
        if (boundary === "before-temp-open")
          expect(temporaryOpened).toBe(false);
        if (boundary === "before-temp-write") expect(temporaryWrites).toBe(0);
      }
    },
    90_000,
  );
});
