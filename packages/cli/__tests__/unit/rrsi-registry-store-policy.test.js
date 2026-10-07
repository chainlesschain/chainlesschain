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
function emulateLargeFileIds(parentDir, collision = null) {
  const lstat = fs.lstatSync;
  const fstat = fs.fstatSync;
  const open = fs.openSync;
  const close = fs.closeSync;
  const descriptors = new Map();
  const identities = new Map();
  const base = 1n << 60n;
  const contains = (target) =>
    typeof target === "string" &&
    (target === parentDir || target.startsWith(`${parentDir}${path.sep}`));
  const remap = (stat, original) => {
    // This fixture stays on one volume. Key by the real BigInt inode, never
    // its rounded Number or libuv's differing path/handle device projection.
    const key = String(original.ino);
    if (!identities.has(key)) {
      identities.set(key, {
        inode: base + BigInt(identities.size + 1),
        directory: original.isDirectory(),
      });
    }
    const entry = identities.get(key);
    const inode =
      (collision === "directory" && entry.directory) ||
      (collision === "marker" && !entry.directory)
        ? base + 32n
        : entry.inode;
    return Object.defineProperty(stat, "ino", {
      value: typeof stat.ino === "bigint" ? inode : Number(inode),
      enumerable: true,
      configurable: true,
    });
  };
  vi.spyOn(fs, "lstatSync").mockImplementation((target, ...args) => {
    const stat = lstat(target, ...args);
    return contains(target)
      ? remap(
          stat,
          typeof stat.ino === "bigint" ? stat : lstat(target, { bigint: true }),
        )
      : stat;
  });
  vi.spyOn(fs, "openSync").mockImplementation((target, ...args) => {
    const fd = open(target, ...args);
    if (contains(target)) descriptors.set(fd, target);
    return fd;
  });
  vi.spyOn(fs, "fstatSync").mockImplementation((fd, ...args) => {
    const stat = fstat(fd, ...args);
    // The staging file's first identity read is fstat, before any lstat.
    return descriptors.has(fd)
      ? remap(
          stat,
          typeof stat.ino === "bigint" ? stat : fstat(fd, { bigint: true }),
        )
      : stat;
  });
  vi.spyOn(fs, "closeSync").mockImplementation((fd) => {
    try {
      return close(fd);
    } finally {
      descriptors.delete(fd);
    }
  });
  return identities;
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
  describe("64-bit provisioning identities", () => {
    const largeRoots = [];
    let largeFixture;
    beforeAll(() => {
      largeFixture = fixture({}, largeRoots);
    }, 60_000);
    afterAll(() => cleanupFixtures(largeRoots), 60_000);

    it("commits and reopens distinct 64-bit file IDs that collide as Numbers", () => {
      const { root, store, policy, request } = largeFixture;
      const identities = emulateLargeFileIds(request.parentDir);
      const result = policy.provisionFresh(request);
      expect(result.phase).toBe("committed");
      expect(policy.read(request.operationId)).toEqual(result);
      const reopenedStore = openLedgerV2Fixture(
        path.join(root, "store"),
        scope,
      );
      const reopened = createRrsiRegistryStorePolicy(
        composition(reopenedStore),
      );
      expect(reopened.read(request.operationId)).toEqual(result);
      expect(policyEvents(store)).toHaveLength(3);

      const entries = [...identities.values()];
      expect(entries.filter((entry) => entry.directory)).toHaveLength(8);
      expect(entries.filter((entry) => !entry.directory)).toHaveLength(2);
      expect(new Set(entries.map((entry) => entry.inode)).size).toBe(10);
      expect(new Set(entries.map((entry) => Number(entry.inode))).size).toBe(1);
      expect([
        result.prepared.parent.identity,
        ...result.prepared.directories.map((entry) => entry.identity),
      ]).toEqual(
        expect.arrayContaining(
          entries
            .filter((entry) => entry.directory)
            .map((entry) =>
              expect.stringMatching(new RegExp(`:${entry.inode}$`)),
            ),
        ),
      );
    }, 60_000);
  });

  it.each(["directory", "marker"])(
    "keeps genuinely identical 64-bit %s identities on HOLD",
    (collision) => {
      const { store, policy, request } = fixture();
      emulateLargeFileIds(request.parentDir, collision);
      expect(() => policy.provisionFresh(request)).toThrowError(
        expect.objectContaining({
          code: RRSI_REGISTRY_STORE_POLICY_HOLD_CODE,
          message:
            collision === "directory"
              ? "prepared directories are not independent"
              : "marker files must be independent",
        }),
      );
      expect(policyEvents(store)).toHaveLength(
        collision === "directory" ? 0 : 2,
      );
    },
    60_000,
  );

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

    it("verifies native private permissions and rejects current unbound constructors before initialization", () => {
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
      // Current constructors reject the reserved namespace before a v1
      // bootstrap. This does not claim to execute historical binary writers.
      expect(
        () =>
          new SkillCandidateRegistry({
            tenantId: scope.tenantId,
            rootDir: result.prepared.candidate.baseDir,
            secure: false,
            targetMatrixAdmissionAuthority: admission(),
            fsImpl: store.fsImpl,
          }),
      ).toThrow(
        expect.objectContaining({ code: RRSI_REGISTRY_STORE_POLICY_HOLD_CODE }),
      );
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
      ).toThrow(
        expect.objectContaining({ code: RRSI_REGISTRY_STORE_POLICY_HOLD_CODE }),
      );
      // Rejection precedes even the participating writer's sibling lock.
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

  describe.sequential.each(["candidate", "release"])(
    "committed %s marker identity",
    (name) => {
      const sharedRoots = [];
      let root, policy, request, result;
      beforeAll(() => {
        ({ root, policy, request } = fixture({}, sharedRoots));
      }, 60_000);
      beforeAll(() => {
        result = policy.provisionFresh(request);
      }, 60_000);
      afterAll(() => cleanupFixtures(sharedRoots), 60_000);
      it(`never repairs a missing committed ${name} marker or accepts a same-bytes replacement`, () => {
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
      }, 60_000);
    },
  );

  describe.sequential("committed physical and marker tampering", () => {
    const sharedRoots = [];
    let root, policy, request, result;
    beforeAll(() => {
      ({ root, policy, request } = fixture({}, sharedRoots));
    }, 60_000);
    beforeAll(() => {
      result = policy.provisionFresh(request);
    }, 60_000);
    afterAll(() => cleanupFixtures(sharedRoots), 60_000);
    it("rejects directory replacement, lowered marker floors and unknown bootstrap files", () => {
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
      const extra = path.join(
        result.prepared.release.rootDir,
        "unexpected.tmp",
      );
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
  });

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

  describe.sequential("prepared single-link marker recovery", () => {
    const sharedRoots = [];
    let root, store, policy, request, prepared, markers, reopenedStore;
    beforeAll(() => {
      ({ root, store, policy, request } = fixture({}, sharedRoots));
    }, 60_000);
    beforeAll(() => {
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
      try {
        expect(() => policy.provisionFresh(request)).toThrow(
          /second marker cleanup/,
        );
      } finally {
        interruption.mockRestore();
      }
      expect(policyEvents(store)).toHaveLength(1);
      prepared = preparedFrom(store);
      markers = ["candidate", "release"].map((name) =>
        fs.readFileSync(markerPath(prepared, name)),
      );
    }, 60_000);
    beforeAll(() => {
      reopenedStore = openLedgerV2Fixture(path.join(root, "store"), scope);
    }, 60_000);
    afterAll(() => cleanupFixtures(sharedRoots), 60_000);
    it("recovers prepared only when both original single-link markers were fully installed", () => {
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
  });

  describe.sequential.each([2, 3])(
    "staged retained response loss at phase %i",
    (phase) => {
      const sharedRoots = [];
      let armed = false,
        fired = false,
        baseline = 0;
      let root, store, policy, request, names, reopenedStore;
      beforeAll(() => {
        ({ root, store, policy, request } = fixture(
          {
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
          },
          sharedRoots,
        ));
      }, 60_000);
      beforeAll(() => {
        baseline = store.manifest.counts.head;
        armed = true;
        expect(() => policy.provisionFresh(request)).toThrow(
          /commit is uncertain/,
        );
        expect(fired).toBe(true);
        names = fs.readdirSync(request.parentDir);
      }, 60_000);
      beforeAll(() => {
        reopenedStore = openLedgerV2Fixture(path.join(root, "store"), scope);
      }, 60_000);
      afterAll(() => cleanupFixtures(sharedRoots), 60_000);
      it(`recovers retained phase ${phase} after a real manifest head commit loses its response`, () => {
        expect(policyEvents(reopenedStore)).toHaveLength(phase);
        const reopened = createRrsiRegistryStorePolicy(
          composition(reopenedStore),
        );
        const recovered = reopened.recover(request.operationId);
        expect(recovered.phase).toBe("committed");
        expect(policyEvents(reopenedStore)).toHaveLength(3);
        expect(fs.readdirSync(request.parentDir)).toEqual(names);
        expect(reopened.recover(request.operationId)).toEqual(recovered);
      }, 60_000);
    },
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

  describe.sequential("failed allocation orphans", () => {
    const sharedRoots = [];
    let policy, request, store, orphans;
    beforeAll(() => {
      ({ policy, request, store } = fixture({}, sharedRoots));
    }, 60_000);
    beforeAll(() => {
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
      try {
        expect(() => policy.provisionFresh(request)).toThrow(
          /allocation stopped/,
        );
      } finally {
        failed.mockRestore();
      }
      orphans = fs.readdirSync(request.parentDir);
      expect(orphans).toHaveLength(1);
      expect(policyEvents(store)).toHaveLength(0);
    }, 60_000);
    afterAll(() => cleanupFixtures(sharedRoots), 60_000);
    it("retains orphans from failed allocation and never adopts caller-selected debris", () => {
      const result = policy.provisionFresh(request);
      expect(orphans).not.toContain(result.prepared.namespaceId);
      expect(fs.readdirSync(request.parentDir).sort()).toEqual(
        [...orphans, result.prepared.namespaceId].sort(),
      );
      expect(fs.readdirSync(path.join(request.parentDir, orphans[0]))).toEqual(
        [],
      );
    }, 60_000);
  });

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

  describe.sequential("operation lock rejection and genuine handles", () => {
    const sharedRoots = [];
    let policy, request, result;
    beforeAll(() => {
      ({ policy, request } = fixture({}, sharedRoots));
    }, 60_000);
    beforeAll(() => {
      expect(() => policy.recover(request.operationId)).toThrow(/unregistered/);
      result = policy.provisionFresh(request);
    }, 60_000);
    afterAll(() => cleanupFixtures(sharedRoots), 60_000);
    it("releases its operation lock after rejection and uses genuine live policy handles only", () => {
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
  });

  describe.sequential("native parent permission boundary", () => {
    const sharedRoots = [];
    let policy, request;
    beforeAll(() => {
      ({ policy, request } = fixture({}, sharedRoots));
    }, 60_000);
    afterAll(() => cleanupFixtures(sharedRoots), 60_000);
    it("checks parent permissions before allocation and on reopen without repairing caller storage", () => {
      const broaden = () => {
        if (process.platform === "win32") {
          const result = spawnSync(
            "icacls.exe",
            [request.parentDir, "/grant", "*S-1-1-0:(OI)(CI)(F)"],
            { encoding: "utf8", windowsHide: true, timeout: 15_000 },
          );
          expect(result.status, result.stderr).toBe(0);
        } else fs.chmodSync(request.parentDir, 0o777);
        const inspected = inspectPrivatePaths([request.parentDir])[0];
        // A failed helper is not evidence that icacls changed an actual ACL.
        expect(inspected.exists).toBe(true);
        expect(inspected.ok).toBe(false);
        if (process.platform === "win32")
          expect(inspected.details).toMatchObject({
            ok: false,
            error: "path is not owner-only",
            errorCode: null,
          });
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
  });

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
