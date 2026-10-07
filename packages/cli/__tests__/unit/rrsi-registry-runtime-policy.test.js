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
import {
  openFixture,
  provisionFixture,
  bindFixture,
  candidateOptions,
  releaseOptions,
  operationId,
} from "../fixtures/rrsi-registry-read-only.js";
import {
  createRrsiRegistryRuntimePolicy,
  captureRrsiRegistryRuntimePolicy,
  RRSI_REGISTRY_RUNTIME_EVENT_TYPE,
} from "../../src/lib/evolution/rrsi-registry-runtime-policy.js";
import {
  RRSI_REGISTRY_STORE_POLICY_HOLD_CODE as HOLD,
  captureRrsiRegistryStorePolicy,
} from "../../src/lib/evolution/rrsi-registry-store-policy.js";
import {
  _deps as privateStorageDeps,
  inspectPrivatePaths,
  repairPrivatePath,
} from "../../src/lib/secure-fs.js";
import { SkillCandidateRegistry } from "../../src/lib/evolution/skill-candidate-registry.js";
import { SkillReleaseRegistry } from "../../src/lib/evolution/skill-release-registry.js";
const parent = fs.realpathSync.native(os.tmpdir());
let root,
  fixture,
  other,
  provision,
  runtime,
  originalBindings,
  result,
  attachedBindings;
const registry = {};
const areas = [
  "artifacts",
  "active",
  "journals",
  "locks",
  "state-migrations",
  "staging",
];
function composition(value = fixture) {
  return {
    storePolicy: value.policy,
    backend: value.store.backend,
    artifactPorts: value.store.artifactPorts,
    ledgerArtifactResolver: value.store.resolver,
  };
}
function bindings() {
  return Object.fromEntries(
    ["candidate", "release"].map((component) => [
      component,
      fixture.policy.bindComponent({
        operationId,
        component,
        runtimePolicy: runtime,
      }),
    ]),
  );
}
function hold(operation) {
  expect(operation).toThrow(expect.objectContaining({ code: HOLD }));
}
function artifactSnapshot(target) {
  const entries = [];
  function visit(current) {
    const stat = fs.lstatSync(current);
    entries.push({
      path: path.relative(target, current),
      identity: `${stat.dev}:${stat.ino}`,
      bytes: stat.isFile() ? fs.readFileSync(current).toString("base64") : null,
    });
    if (stat.isDirectory())
      for (const name of fs.readdirSync(current).sort())
        visit(path.join(current, name));
  }
  visit(target);
  return entries;
}
describe.sequential(
  "authenticated empty Registry runtime directory initialization",
  () => {
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(parent, "cc-rrsi-runtime-policy-"));
      fixture = openFixture(root);
    }, 60_000);
    beforeAll(() => {
      provision = provisionFixture(fixture);
      originalBindings = bindFixture(fixture);
      runtime = createRrsiRegistryRuntimePolicy(composition());
    }, 60_000);
    beforeAll(() => {
      result = runtime.initialize(operationId);
      // Eight independently durable phases share one public operation. This is
      // its aggregate test budget, not a change to any native ACL helper budget.
    }, 180_000);
    beforeAll(() => {
      attachedBindings = bindings();
    }, 60_000);
    beforeAll(() => {
      registry.candidate = new SkillCandidateRegistry(
        candidateOptions(attachedBindings.candidate),
      );
    }, 60_000);
    beforeAll(() => {
      registry.release = new SkillReleaseRegistry(
        releaseOptions(attachedBindings.release, fixture.ports),
      );
    }, 60_000);
    beforeAll(() => {
      other = openFixture(path.join(root, "other"));
      provisionFixture(other);
    }, 60_000);
    afterEach(() => vi.restoreAllMocks());
    afterAll(() => {
      if (!root) return;
      if (
        path.dirname(path.resolve(root)) !== parent ||
        !path.basename(root).startsWith("cc-rrsi-runtime-policy-")
      )
        throw new Error("unsafe runtime fixture cleanup");
      fs.rmSync(root, { recursive: true, force: true });
    }, 60_000);
    it("retains eight distinct ordered phases bound to original provisioning and six independent real directory identities", () => {
      const events = fixture.store.journal
        .read()
        .filter((event) => event.type === RRSI_REGISTRY_RUNTIME_EVENT_TYPE);
      expect(events).toHaveLength(8);
      expect(new Set(events.map((event) => event.eventId)).size).toBe(8);
      const phases = events.map(
        (event) =>
          JSON.parse(
            fixture.store
              .resolver({
                ledgerId: event.ledgerId,
                epoch: event.epoch,
                tenantId: fixture.store.descriptor.artifactTenantId,
                ref: event.subjectRef,
              })
              .bytes.toString(),
          ).value.phase,
      );
      expect(phases).toEqual([
        "prepared",
        ...areas.map((name) => `${name}-installed`),
        "committed",
      ]);
      expect(result).toMatchObject({
        runtimeDirectoryIdentityAuthenticated: true,
        originCutoverAuthenticated: false,
        grantsMutationOrPromotionAuthority: false,
      });
      expect(Object.keys(result.directories)).toEqual(areas);
      expect(
        new Set(
          Object.values(result.directories).map((entry) => entry.identity),
        ).size,
      ).toBe(6);
      for (const [name, entry] of Object.entries(result.directories)) {
        expect(entry.path).toBe(
          path.join(provision.prepared.release.rootDir, name),
        );
        expect(fs.readdirSync(entry.path)).toEqual([]);
      }
    }, 60_000);
    it("idempotently recovers the same runtime without directory creation or cleanup", () => {
      const mkdir = vi.spyOn(fs, "mkdirSync"),
        unlink = vi.spyOn(fs, "unlinkSync");
      expect(runtime.recover(operationId)).toEqual(runtime.read(operationId));
      expect(
        mkdir.mock.calls.filter(([target]) =>
          String(target).includes(provision.prepared.namespaceId),
        ),
      ).toEqual([]);
      expect(
        unlink.mock.calls.filter(([target]) =>
          String(target).includes(provision.prepared.namespaceId),
        ),
      ).toEqual([]);
    }, 60_000);
    it("opens genuine Registry empty readers only with the explicit authenticated attachment and keeps every writer held", async () => {
      expect(registry.candidate.readInventory()).toEqual([]);
      expect(registry.release.readInventory()).toEqual({
        active: [],
        releases: [],
      });
      expect(registry.release.readState("safe-refactor")).toMatchObject({
        revision: 0,
      });
      hold(() => registry.candidate.create({}));
      await expect(registry.release.applyTransition({})).rejects.toMatchObject({
        code: HOLD,
      });
      hold(
        () =>
          new SkillCandidateRegistry(
            candidateOptions(originalBindings.candidate),
          ),
      );
      hold(
        () =>
          new SkillReleaseRegistry(
            releaseOptions(originalBindings.release, fixture.ports),
          ),
      );
      hold(() =>
        fixture.policy.bindComponent({ operationId, component: "release" }),
      );
    }, 60_000);
    it.each(areas)(
      "holds missing or replaced registered %s without recreating it",
      (name) => {
        const entry = result.directories[name],
          saved = path.join(root, `saved-${name}`);
        fs.renameSync(entry.path, saved);
        try {
          hold(() => runtime.read(operationId));
          hold(() => runtime.recover(operationId));
          expect(fs.existsSync(entry.path)).toBe(false);
          fs.mkdirSync(entry.path);
          hold(() => runtime.read(operationId));
          expect(fs.readdirSync(entry.path)).toEqual([]);
        } finally {
          if (fs.existsSync(entry.path)) fs.rmdirSync(entry.path);
          fs.renameSync(saved, entry.path);
        }
      },
      60_000,
    );
    it("never adopts business content or cleans recovery evidence in authenticated containers", () => {
      const target = path.join(
        result.directories.journals.path,
        "safe-refactor.json",
      );
      fs.writeFileSync(target, "TEST ONLY unknown recovery evidence");
      try {
        hold(() => runtime.read(operationId));
        hold(() => runtime.recover(operationId));
        hold(() => bindings());
        expect(fs.readFileSync(target, "utf8")).toBe(
          "TEST ONLY unknown recovery evidence",
        );
      } finally {
        fs.unlinkSync(target);
      }
    }, 60_000);
    it("rejects copied attachments and altered original composition", () => {
      hold(() => captureRrsiRegistryRuntimePolicy({ ...runtime }));
      hold(() =>
        fixture.policy.bindComponent({
          operationId,
          component: "release",
          runtimePolicy: { ...runtime },
        }),
      );
      expect(() =>
        createRrsiRegistryRuntimePolicy({
          ...composition(),
          artifactPorts: {},
        }),
      ).toThrow();
      const accessed = vi.fn();
      const input = { ...composition() };
      Object.defineProperty(input, "backend", {
        enumerable: true,
        get: accessed,
      });
      hold(() => createRrsiRegistryRuntimePolicy(input));
      expect(accessed).not.toHaveBeenCalled();
      const otherRuntime = createRrsiRegistryRuntimePolicy(composition(other));
      hold(() =>
        other.policy.bindComponent({
          operationId,
          component: "release",
          runtimePolicy: runtime,
        }),
      );
      hold(() =>
        fixture.policy.bindComponent({
          operationId,
          component: "release",
          runtimePolicy: otherRuntime,
        }),
      );
      expect(() =>
        createRrsiRegistryRuntimePolicy({
          ...composition(),
          backend: other.store.backend,
        }),
      ).toThrow();
      const trapped = vi.fn();
      hold(() =>
        createRrsiRegistryRuntimePolicy(
          new Proxy(composition(), { get: trapped }),
        ),
      );
      expect(trapped).not.toHaveBeenCalled();
    });
    it.each(["missing", "replaced"])(
      "rechecks the final runtime identity after staging enumeration (%s)",
      (mode) => {
        const entry = result.directories.staging,
          saved = path.join(root, "saved-staging-race");
        const opendir = fs.opendirSync;
        for (const operation of ["read", "recover"]) {
          let fired = false;
          vi.spyOn(fs, "opendirSync").mockImplementation((target, ...args) => {
            const handle = opendir(target, ...args);
            if (target === entry.path && !fired) {
              const next = handle.readSync.bind(handle);
              handle.readSync = () => {
                const item = next();
                if (item === null && !fired) {
                  fired = true;
                  fs.renameSync(entry.path, saved);
                  if (mode === "replaced") fs.mkdirSync(entry.path);
                }
                return item;
              };
            }
            return handle;
          });
          try {
            let failure;
            try {
              runtime[operation](operationId);
            } catch (error) {
              failure = error;
            }
            expect(failure).toMatchObject({ code: HOLD });
            if (mode === "missing")
              expect(failure.cause).toMatchObject({ code: "ENOENT" });
            expect(fired).toBe(true);
          } finally {
            vi.restoreAllMocks();
            if (fs.existsSync(entry.path)) fs.rmdirSync(entry.path);
            fs.renameSync(saved, entry.path);
          }
        }
      },
      60_000,
    );
    it("rechecks same-inode marker bytes after the last inventory enumeration", () => {
      const marker = path.join(
          provision.prepared.release.rootDir,
          "_tenant.json",
        ),
        bytes = fs.readFileSync(marker);
      const stat = fs.lstatSync(marker),
        opendir = fs.opendirSync;
      let fired = false;
      vi.spyOn(fs, "opendirSync").mockImplementation((target, ...args) => {
        const handle = opendir(target, ...args);
        if (target === result.directories.staging.path && !fired) {
          const next = handle.readSync.bind(handle);
          handle.readSync = () => {
            const item = next();
            if (item === null && !fired) {
              fired = true;
              fs.writeFileSync(
                marker,
                Buffer.from("TEST ONLY altered same-inode marker"),
              );
            }
            return item;
          };
        }
        return handle;
      });
      try {
        hold(() => runtime.read(operationId));
        expect(fired).toBe(true);
        expect(fs.lstatSync(marker).ino).toBe(stat.ino);
      } finally {
        fs.writeFileSync(marker, bytes);
      }
    }, 60_000);
    it.each(["parent", "staging"])(
      "idempotent recovery refuses broadened %s permissions without repairing them",
      (name) => {
        const target =
          name === "parent"
            ? provision.prepared.parent.path
            : result.directories.staging.path;
        if (process.platform === "win32") {
          const changed = spawnSync(
            "icacls.exe",
            [target, "/grant", "*S-1-1-0:(OI)(CI)(F)"],
            { encoding: "utf8", windowsHide: true, timeout: 15_000 },
          );
          expect(changed.status, changed.stderr).toBe(0);
        } else fs.chmodSync(target, 0o777);
        const repair = vi.spyOn(privateStorageDeps, "spawnSync"),
          chmod = vi.spyOn(fs, "chmodSync");
        try {
          expect(inspectPrivatePaths([target])[0].ok).toBe(false);
          hold(() => runtime.recover(operationId));
          expect(inspectPrivatePaths([target])[0].ok).toBe(false);
          const repairs = repair.mock.calls.filter(([, args, options]) => {
            const request =
              typeof options?.input === "string"
                ? JSON.parse(options.input)
                : null;
            return (
              (request?.operation === "repair" &&
                request.targets.includes(target)) ||
              (args?.at(-1) === "repair" && args.at(-2) === target)
            );
          });
          expect(repairs).toEqual([]);
          expect(
            chmod.mock.calls.filter(([value]) => value === target),
          ).toEqual([]);
        } finally {
          vi.restoreAllMocks();
          repairPrivatePath(target);
        }
      },
      60_000,
    );
    it("stops artifact publication if operation ownership is lost during the pre-publication layout", () => {
      const uninitialized = createRrsiRegistryRuntimePolicy(composition(other));
      const policy = other.policy.bindComponent({
        operationId,
        component: "release",
      });
      const ownerFile = path.join(
        other.store.backend.descriptor.authorityRootDir,
        "rrsi-registry-store-policy-operations.lock",
        "owner.json",
      );
      const opendir = fs.opendirSync,
        artifactRoot = path.join(other.root, "store", "artifacts");
      const before = artifactSnapshot(artifactRoot);
      let reads = 0,
        replacement;
      vi.spyOn(fs, "opendirSync").mockImplementation((target, ...args) => {
        const handle = opendir(target, ...args);
        if (target === policy.descriptor.rootDir && ++reads === 3) {
          const next = handle.readSync.bind(handle);
          handle.readSync = () => {
            const item = next();
            if (item === null && !replacement) {
              replacement = {
                ...JSON.parse(fs.readFileSync(ownerFile, "utf8")),
                token: "test-only-runtime-replacement-owner",
              };
              fs.writeFileSync(ownerFile, JSON.stringify(replacement));
            }
            return item;
          };
        }
        return handle;
      });
      expect(() => uninitialized.initialize(operationId)).toThrow(
        expect.objectContaining({ code: "STATE_LOCK_OWNERSHIP_LOST" }),
      );
      expect(replacement).toBeDefined();
      expect(artifactSnapshot(artifactRoot)).toEqual(before);
      expect(JSON.parse(fs.readFileSync(ownerFile, "utf8"))).toEqual(
        replacement,
      );
      expect(fs.readdirSync(policy.descriptor.rootDir)).toEqual([
        "_tenant.json",
      ]);
      expect(
        other.store.journal
          .read()
          .filter((event) => event.type === RRSI_REGISTRY_RUNTIME_EVENT_TYPE),
      ).toEqual([]);
    }, 60_000);
    it("rejects a ninth authenticated runtime event inserted after snapshot capture instead of rebasing the old state", () => {
      const opendir = fs.opendirSync;
      const captured = captureRrsiRegistryStorePolicy(
        fixture.policy,
      ).captureCommittedBoundary(operationId);
      const prior = fixture.store.journal
        .read()
        .filter((event) => event.type === RRSI_REGISTRY_RUNTIME_EVENT_TYPE)
        .at(-1);
      let fired = false;
      vi.spyOn(fs, "opendirSync").mockImplementation((target, ...args) => {
        const handle = opendir(target, ...args);
        if (target === provision.prepared.release.rootDir && !fired) {
          fired = true;
          fixture.store.journal.appendDomainEvent({
            type: RRSI_REGISTRY_RUNTIME_EVENT_TYPE,
            eventId: "test-only-invalid-ninth-runtime",
            tenantId: "tenant-a",
            artifactTenantId: "artifact-tenant-a-release",
            correlationId: runtime.descriptor.scopeId,
            skillName: null,
            decision: "committed",
            reason: "TEST ONLY late runtime insertion",
            subjectRef: {
              schema: prior.subjectRef.schema,
              ref: prior.subjectRef.ref,
              digest: prior.subjectRef.digest,
            },
            sourceRefs: [],
          });
        }
        return handle;
      });
      hold(() => runtime.read(operationId));
      expect(fired).toBe(true);
      vi.restoreAllMocks();
      hold(() => captured.recheck());
      expect(
        fixture.store.journal
          .read()
          .filter((event) => event.type === RRSI_REGISTRY_RUNTIME_EVENT_TYPE),
      ).toHaveLength(9);
      hold(() => runtime.read(operationId));
    }, 60_000);
  },
);
