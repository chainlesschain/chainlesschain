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
  openRegistries,
  candidateOptions,
  releaseOptions,
  scope,
  operationId,
} from "../fixtures/rrsi-registry-read-only.js";
import {
  SkillCandidateRegistry,
  captureSkillCandidateRegistryReader,
  captureSkillCandidateRegistryWriterControl,
} from "../../src/lib/evolution/skill-candidate-registry.js";
import {
  SkillReleaseRegistry,
  captureSkillReleaseRegistryReader,
  captureSkillReleaseRegistryWriterControl,
} from "../../src/lib/evolution/skill-release-registry.js";
import {
  captureRrsiRegistryComponentBinding,
  RRSI_REGISTRY_STORE_POLICY_HOLD_CODE as HOLD,
} from "../../src/lib/evolution/rrsi-registry-store-policy.js";
import {
  createEvolutionLedgerPorts,
  captureSkillReleaseOperationReader,
} from "../../src/lib/evolution/evolution-ledger-ports.js";
import { replicaAuthority } from "../fixtures/skill-revocation-release-registry.js";
import {
  _deps as privateStorageDeps,
  inspectPrivatePaths,
  repairPrivatePath,
} from "../../src/lib/secure-fs.js";

const temporaryParent = fs.realpathSync.native(os.tmpdir());
let root, fixture, other, provisioned, bindings, registries;
function expectHold(operation) {
  expect(operation).toThrow(expect.objectContaining({ code: HOLD }));
}
function assertNoMutations(operation) {
  // Genuine v2 reads keep the established journal maintenance protocol. Only
  // its exact transient lock paths are allowed here, never Registry/policy
  // locks, business publication, ACL repair or journal payload changes.
  const journalLock = path.join(
    fixture.store.backend.descriptor.authorityRootDir,
    "manifest-cutover-v2.lock",
  );
  const allowed = (target) => {
    // Node's native recursive rm delegates to rmdir with Buffer path names.
    if (Buffer.isBuffer(target)) target = target.toString("utf8");
    if (typeof target !== "string") return false;
    const relative = path.relative(
      path.dirname(journalLock),
      path.resolve(target),
    );
    return /^(?:manifest-cutover-v2|ledger-v2)\.lock(?:\.(?:acquire|release|reclaim)-[a-f0-9-]+)?(?:[\\/].*)?$/u.test(
      relative,
    );
  };
  const names = [
    "mkdirSync",
    "writeFileSync",
    "appendFileSync",
    "linkSync",
    "renameSync",
    "unlinkSync",
    "rmSync",
    "rmdirSync",
    "chmodSync",
    "truncateSync",
  ];
  const spies = names.map((name) => vi.spyOn(fs, name));
  const original = fs.openSync;
  const writeOpens = [];
  const opened = vi
    .spyOn(fs, "openSync")
    .mockImplementation((target, flags, ...args) => {
      if (
        (typeof flags === "string" && /[wa+]/u.test(flags)) ||
        (typeof flags === "number" &&
          flags &
            (fs.constants.O_WRONLY |
              fs.constants.O_RDWR |
              fs.constants.O_CREAT |
              fs.constants.O_TRUNC |
              fs.constants.O_APPEND))
      )
        if (!allowed(target)) writeOpens.push({ target, flags });
      return original(target, flags, ...args);
    });
  const nativeSpawn = vi.spyOn(privateStorageDeps, "spawnSync");
  function verify() {
    for (let index = 0; index < spies.length; index++) {
      const forbidden = spies[index].mock.calls.filter(
        (args) =>
          !allowed(args[0]) ||
          (["renameSync", "linkSync"].includes(names[index]) &&
            !allowed(args[1])),
      );
      expect(
        forbidden,
        `${names[index]} ${JSON.stringify(forbidden.slice(0, 2))}`,
      ).toEqual([]);
    }
    expect(writeOpens).toEqual([]);
    for (const [, args, options] of nativeSpawn.mock.calls) {
      const request =
        typeof options?.input === "string" ? JSON.parse(options.input) : null;
      if (request?.operation === "repair")
        expect(request.targets.filter((target) => !allowed(target))).toEqual(
          [],
        );
      if (args?.at(-1) === "repair")
        expect(
          allowed(args.at(-2)),
          "single-path native permission repair",
        ).toBe(true);
    }
  }
  function restore() {
    for (const spy of spies) spy.mockRestore();
    opened.mockRestore();
    nativeSpawn.mockRestore();
  }
  let asynchronous = false;
  try {
    const result = operation();
    if (result && typeof result.then === "function") {
      asynchronous = true;
      return result
        .then((value) => {
          verify();
          return value;
        })
        .finally(restore);
    }
    verify();
    return result;
  } finally {
    if (!asynchronous) restore();
  }
}
function marker(component) {
  return path.join(provisioned.prepared[component].rootDir, "_tenant.json");
}
function pairSnapshot() {
  const values = [];
  const visit = (target) => {
    const stat = fs.lstatSync(target);
    values.push({
      path: target,
      identity: `${stat.dev}:${stat.ino}`,
      bytes: stat.isFile() ? fs.readFileSync(target).toString("base64") : null,
    });
    if (stat.isDirectory())
      for (const name of fs.readdirSync(target).sort())
        visit(path.join(target, name));
  };
  visit(provisioned.prepared.directories[0].path);
  return values;
}

describe.sequential(
  "genuine v2 Registry read-only open before origin admission",
  () => {
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(temporaryParent, "cc-rrsi-read-only-"));
      fixture = openFixture(root);
    }, 60_000);
    beforeAll(() => {
      provisioned = provisionFixture(fixture);
    }, 60_000);
    beforeAll(() => {
      bindings = bindFixture(fixture);
      registries = openRegistries(bindings, fixture.ports);
      other = openFixture(path.join(root, "other"));
    }, 60_000);
    afterEach(() => vi.restoreAllMocks());
    afterAll(() => {
      if (!root) return;
      if (
        path.dirname(path.resolve(root)) !== temporaryParent ||
        !path.basename(root).startsWith("cc-rrsi-read-only-")
      )
        throw new Error("unsafe Registry read-only fixture cleanup");
      fs.rmSync(root, { recursive: true, force: true });
    }, 60_000);

    it("opens the exact physical pair and genuine readers without Registry/policy locks, ACL repair or runtime bootstrap", () => {
      const before = fixture.store.journal.verify();
      assertNoMutations(() => {
        const opened = openRegistries(bindings, fixture.ports);
        const candidate = captureSkillCandidateRegistryReader(opened.candidate);
        const release = captureSkillReleaseRegistryReader(opened.release);
        expect(candidate.readInventory()).toEqual([]);
        expect(release.readInventory()).toEqual({ active: [], releases: [] });
        expect(release.readState("safe-refactor")).toMatchObject({
          tenantId: scope.tenantId,
          revision: 0,
        });
        expect(release.readActive("safe-refactor")).toBeNull();
        expect(candidate.matchesStorePolicyBinding(bindings.candidate)).toBe(
          true,
        );
        expect(release.matchesStorePolicyBinding(bindings.release)).toBe(true);
        for (const reader of [candidate, release])
          expect(reader.storePolicyDescriptor).toMatchObject({
            persistentStoreIdentityAuthenticated: true,
            originCutoverAuthenticated: false,
            originClassificationAvailable: false,
            grantsMutationOrPromotionAuthority: false,
          });
      });
      expect(fixture.store.journal.verify()).toEqual(before);
      for (const component of ["candidate", "release"])
        expect(fs.readdirSync(provisioned.prepared[component].rootDir)).toEqual(
          ["_tenant.json"],
        );
    });

    it("returns existing empty/not-found semantics only after physical revalidation", () => {
      expect(registries.candidate.list()).toEqual([]);
      expect(() =>
        registries.candidate.read(`sha256:${"a".repeat(64)}`),
      ).toThrow(expect.objectContaining({ code: "SKILL_CANDIDATE_NOT_FOUND" }));
      expect(() =>
        registries.release.readRelease(`sha256:${"a".repeat(64)}`),
      ).toThrow(expect.objectContaining({ code: "SKILL_RELEASE_NOT_FOUND" }));
      expect(() => registries.release.pinActive("safe-refactor")).toThrow(
        expect.objectContaining({ code: "SKILL_RELEASE_NOT_ACTIVE" }),
      );
      expect(() =>
        captureSkillCandidateRegistryWriterControl(registries.candidate),
      ).toThrow();
      expect(() =>
        captureSkillReleaseRegistryWriterControl(registries.release),
      ).toThrow();
    });

    it("holds all public writes and migrations before writer lock, admission callback or capability access", async () => {
      const touched = vi.fn(() => {
        throw new Error("caller input must not be reached");
      });
      const input = new Proxy({}, { get: touched, ownKeys: touched });
      assertNoMutations(() => {
        expect(() => registries.candidate.create(input)).toThrow(
          expect.objectContaining({ code: HOLD }),
        );
        expect(() =>
          registries.candidate.migrateLegacy(input, input, input),
        ).toThrow(expect.objectContaining({ code: HOLD }));
        expect(() =>
          registries.candidate.migrateLegacyStore(root, touched, input),
        ).toThrow(expect.objectContaining({ code: HOLD }));
        expect(() =>
          registries.release.migrateLegacyRelease(input, input),
        ).toThrow(expect.objectContaining({ code: HOLD }));
        expect(() =>
          registries.release.migrateLegacyState(input, input),
        ).toThrow(expect.objectContaining({ code: HOLD }));
      });
      await assertNoMutations(() =>
        expect(registries.release.applyTransition(input)).rejects.toMatchObject(
          { code: HOLD },
        ),
      );
      expect(touched).not.toHaveBeenCalled();
    });

    it("keeps public candidate bootstrap helpers existing-only", () => {
      assertNoMutations(() => {
        expect(
          registries.candidate._initializeTenantMarker().marker.schema,
        ).toMatch(/\/v2$/u);
        expect(
          registries.candidate._initializeDirectory(
            registries.candidate.rootDir,
          ),
        ).toEqual(
          captureRrsiRegistryComponentBinding(bindings.candidate).boundaries
            .tenantRoot,
        );
        expect(() =>
          registries.candidate._initializeDirectory(
            path.join(root, "unowned-new-path"),
          ),
        ).toThrow(expect.objectContaining({ code: HOLD }));
      });
      expect(fs.existsSync(path.join(root, "unowned-new-path"))).toBe(false);
    });

    it.each(["candidate", "release"])(
      "rejects copied, serialized, proxied and accessor %s bindings",
      (component) => {
        const construct = (value) =>
          component === "candidate"
            ? new SkillCandidateRegistry({
                ...candidateOptions(bindings.candidate),
                storePolicyBinding: value,
              })
            : new SkillReleaseRegistry({
                ...releaseOptions(bindings.release, fixture.ports),
                storePolicyBinding: value,
              });
        const accessed = vi.fn();
        assertNoMutations(() => {
          for (const fake of [
            { ...bindings[component] },
            JSON.parse(JSON.stringify(bindings[component])),
            new Proxy(bindings[component], {}),
            {
              get descriptor() {
                accessed();
                return bindings[component].descriptor;
              },
            },
          ])
            expect(() => construct(fake)).toThrow(
              expect.objectContaining({ code: HOLD }),
            );
        });

        expect(accessed).not.toHaveBeenCalled();
      },
    );

    it("rejects a current v1 instance's public directory helper before it can create inside the reserved namespace", () => {
      const legacy = new SkillCandidateRegistry({
        ...candidateOptions(bindings.candidate),
        rootDir: path.join(root, "legacy-helper"),
        storePolicyBinding: undefined,
        secure: false,
      });
      const target = path.join(
        provisioned.prepared.candidate.baseDir,
        "unbound-helper-created",
      );
      const before = pairSnapshot();
      assertNoMutations(() =>
        expectHold(() =>
          legacy._initializeDirectory(target, { recursive: true }),
        ),
      );
      expect(fs.existsSync(target)).toBe(false);
      expect(pairSnapshot()).toEqual(before);
    });

    it("rejects an unbound subclass's redirected canonical base before virtual helpers can initialize a reserved store", () => {
      const touched = vi.fn();
      class RedirectedCandidate extends SkillCandidateRegistry {
        _initializeDirectory() {
          touched();
          const target = provisioned.prepared.candidate.baseDir,
            stat = fs.lstatSync(target);
          return { path: target, identity: `${stat.dev}:${stat.ino}` };
        }
      }
      assertNoMutations(() =>
        expectHold(
          () =>
            new RedirectedCandidate({
              ...candidateOptions(bindings.candidate),
              rootDir: path.join(root, "subclass-redirect"),
              storePolicyBinding: undefined,
              secure: false,
            }),
        ),
      );
      expect(touched).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["candidate", true],
      ["release", true],
      ["candidate", false],
      ["release", false],
    ])(
      "holds %s initialization when an ancestor alias changes after preflight (base existed: %s)",
      (component, existed) => {
        const aliasParent = path.join(
            root,
            `late-${component}-${existed}-alias`,
          ),
          saved = path.join(root, `saved-${component}-${existed}-alias`);
        fs.mkdirSync(aliasParent);
        const requested = path.join(aliasParent, component);
        if (existed) fs.mkdirSync(requested);
        const before = pairSnapshot(),
          lstat = fs.lstatSync;
        let injected = false;
        const redirect = () => {
          injected = true;
          fs.renameSync(aliasParent, saved);
          fs.symlinkSync(
            provisioned.prepared.directories[0].path,
            aliasParent,
            process.platform === "win32" ? "junction" : "dir",
          );
        };
        const hook = vi
          .spyOn(fs, "lstatSync")
          .mockImplementation((target, ...args) => {
            try {
              const stat = lstat(target, ...args);
              if (target === requested && !injected) redirect();
              return stat;
            } catch (error) {
              if (target === requested && !injected && error.code === "ENOENT")
                redirect();
              throw error;
            }
          });
        const mkdir = vi.spyOn(fs, "mkdirSync");
        try {
          const Class =
            component === "candidate"
              ? SkillCandidateRegistry
              : SkillReleaseRegistry;
          const options =
            component === "candidate"
              ? candidateOptions(bindings.candidate)
              : releaseOptions(bindings.release, fixture.ports);
          expectHold(
            () =>
              new Class({
                ...options,
                rootDir: requested,
                storePolicyBinding: undefined,
                secure: false,
                tenantId: "unregistered-tenant",
              }),
          );
          expect(injected).toBe(true);
          expect(mkdir).not.toHaveBeenCalled();
          expect(pairSnapshot()).toEqual(before);
        } finally {
          hook.mockRestore();
          mkdir.mockRestore();
          if (injected) {
            fs.unlinkSync(aliasParent);
            fs.renameSync(saved, aliasParent);
          }
          if (existed) fs.rmdirSync(requested);
          fs.rmdirSync(aliasParent);
        }
      },
    );
    it.each(["candidate", "release"])(
      "rejects cross-component, tenant, path, custom filesystem and insecure %s options before bootstrap",
      (component) => {
        const Class =
          component === "candidate"
            ? SkillCandidateRegistry
            : SkillReleaseRegistry;
        const options =
          component === "candidate"
            ? candidateOptions(bindings.candidate)
            : releaseOptions(bindings.release, fixture.ports);
        assertNoMutations(() => {
          for (const override of [
            {
              storePolicyBinding:
                bindings[component === "candidate" ? "release" : "candidate"],
            },
            { tenantId: "other-tenant" },
            { rootDir: path.join(root, "unexpected-new-base") },
            { secure: false },
            { fsImpl: { ...fs } },
          ])
            expect(() => new Class({ ...options, ...override })).toThrow(
              expect.objectContaining({ code: HOLD }),
            );
        });
      },
    );

    it("rejects subclasses before candidate override callbacks can initialize paths", () => {
      const override = vi.fn();
      class CandidateSubclass extends SkillCandidateRegistry {
        _initializeDirectory() {
          override();
        }
      }
      class ReleaseSubclass extends SkillReleaseRegistry {}
      assertNoMutations(() => {
        expect(
          () => new CandidateSubclass(candidateOptions(bindings.candidate)),
        ).toThrow(expect.objectContaining({ code: HOLD }));
        expect(
          () =>
            new ReleaseSubclass(
              releaseOptions(bindings.release, fixture.ports),
            ),
        ).toThrow(expect.objectContaining({ code: HOLD }));
      });
      expect(override).not.toHaveBeenCalled();
    });

    it("rejects forged transaction methods before getters and genuine ports from another journal or ArtifactPorts", () => {
      const getter = vi.fn();
      const fake = Object.fromEntries(
        ["prepare", "finalize", "query"].map((key) => [key, () => {}]),
      );
      const accessors = Object.defineProperties(
        {},
        Object.fromEntries(
          ["prepare", "finalize", "query"].map((key) => [
            key,
            { enumerable: true, get: getter },
          ]),
        ),
      );
      const differentPorts = createEvolutionLedgerPorts({
        artifactPorts: other.store.artifactPorts,
        ledger: fixture.store.journal,
        artifactTenantId: scope.artifactTenantId,
        audience: scope.audience,
        artifactDurabilityAuthority: replicaAuthority(
          path.join(root, "other-ports-replica"),
        ),
      });
      assertNoMutations(() => {
        for (const transactionLedger of [
          fake,
          accessors,
          { ...fixture.ports.transactionLedger },
          other.ports.transactionLedger,
          differentPorts.transactionLedger,
        ])
          expectHold(
            () =>
              new SkillReleaseRegistry({
                ...releaseOptions(bindings.release, fixture.ports),
                transactionLedger,
              }),
          );
      });
      expect(getter).not.toHaveBeenCalled();
    });

    it("requires the actual normalized artifact tenant, explicit audience and purpose even for genuine same-object transaction ports", () => {
      const configuration = {
        artifactPorts: fixture.store.artifactPorts,
        ledger: fixture.store.journal,
        artifactTenantId: scope.artifactTenantId,
        audience: scope.audience,
        purpose: "evolution-ledger",
        artifactDurabilityAuthority: replicaAuthority(
          path.join(root, "scope-replica"),
        ),
      };
      const omittedAudience = { ...configuration };
      delete omittedAudience.audience;
      const wrong = [
        { ...configuration, artifactTenantId: "artifact-other-tenant" },
        { ...configuration, audience: "other-runtime" },
        omittedAudience,
        { ...configuration, purpose: "other-purpose" },
      ].map((options) => createEvolutionLedgerPorts(options));
      const correct = createEvolutionLedgerPorts(configuration);
      for (const ports of [...wrong, correct]) {
        const reader = captureSkillReleaseOperationReader(
          ports.transactionLedger,
        );
        expect(reader.matchesLedger(fixture.store.journal)).toBe(true);
        expect(reader.matchesArtifactPorts(fixture.store.artifactPorts)).toBe(
          true,
        );
        expect(Object.isFrozen(reader.scope)).toBe(true);
      }
      expect(
        captureSkillReleaseOperationReader(wrong[2].transactionLedger).scope
          .audience,
      ).toBeNull();
      assertNoMutations(() => {
        for (const ports of wrong)
          expectHold(
            () =>
              new SkillReleaseRegistry(releaseOptions(bindings.release, ports)),
          );
        const release = new SkillReleaseRegistry(
          releaseOptions(bindings.release, correct),
        );
        expect(
          captureSkillReleaseRegistryReader(release).matchesTransactionLedger(
            correct.transactionLedger,
          ),
        ).toBe(true);
        expect(release.readInventory()).toEqual({ active: [], releases: [] });
      });
    });

    it.each(["candidate", "release"])(
      "does not recreate a deleted %s marker through a bound handle, unbound reopen or candidate bootstrap helper",
      (component) => {
        const target = marker(component),
          saved = path.join(root, `saved-${component}-marker`);
        fs.renameSync(target, saved);
        try {
          assertNoMutations(() => {
            expectHold(() => registries.candidate.readInventory());
            expectHold(() =>
              registries.candidate.read(`sha256:${"a".repeat(64)}`),
            );
            expectHold(() => registries.release.readState("safe-refactor"));
            expectHold(() => openRegistries(bindings, fixture.ports));
            expectHold(() => registries.candidate._initializeTenantMarker());
            expect(
              () =>
                new SkillCandidateRegistry({
                  ...candidateOptions(bindings.candidate),
                  storePolicyBinding: undefined,
                }),
            ).toThrow(expect.objectContaining({ code: HOLD }));
            expect(
              () =>
                new SkillReleaseRegistry({
                  ...releaseOptions(bindings.release, fixture.ports),
                  storePolicyBinding: undefined,
                }),
            ).toThrow(expect.objectContaining({ code: HOLD }));
          });
          expect(fs.existsSync(target)).toBe(false);
        } finally {
          fs.renameSync(saved, target);
        }
      },
    );

    it.each(["candidate", "release"])(
      "rejects same-byte %s marker inode replacement on both readers",
      (component) => {
        const target = marker(component),
          saved = path.join(root, `saved-${component}-marker`);
        const bytes = fs.readFileSync(target);
        fs.renameSync(target, saved);
        fs.writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
        try {
          assertNoMutations(() => {
            expectHold(() => registries.candidate.readInventory());
            expectHold(() => registries.release.readInventory());
          });
          expect(fs.readFileSync(target)).toEqual(bytes);
        } finally {
          fs.unlinkSync(target);
          fs.renameSync(saved, target);
        }
      },
    );

    it.each(["candidate", "release"])(
      "holds removed/replaced authenticated %s roots without mkdir fallback",
      (component) => {
        const target = provisioned.prepared[component].rootDir,
          saved = path.join(root, `saved-${component}-root`);
        fs.renameSync(target, saved);
        try {
          assertNoMutations(() =>
            expectHold(() => openRegistries(bindings, fixture.ports)),
          );
          expect(fs.existsSync(target)).toBe(false);
          fs.mkdirSync(target, { mode: 0o700 });
          assertNoMutations(() =>
            expectHold(() => openRegistries(bindings, fixture.ports)),
          );
          expect(fs.readdirSync(target)).toEqual([]);
        } finally {
          if (fs.existsSync(target)) fs.rmdirSync(target);
          fs.renameSync(saved, target);
        }
      },
    );

    it.each([
      "artifacts",
      "active",
      "journals",
      "locks",
      "state-migrations",
      "staging",
    ])(
      "holds the unregistered %s runtime directory and retains its contents",
      (area) => {
        const target = path.join(provisioned.prepared.release.rootDir, area);
        fs.mkdirSync(target);
        const debris = path.join(target, "untrusted-debris.json");
        fs.writeFileSync(debris, "TEST ONLY retained evidence");
        try {
          assertNoMutations(() => {
            expectHold(() => registries.release.readState("safe-refactor"));
            expectHold(() => registries.release.readInventory());
            expectHold(
              () =>
                new SkillReleaseRegistry(
                  releaseOptions(bindings.release, fixture.ports),
                ),
            );
          });
          expect(fs.readFileSync(debris, "utf8")).toBe(
            "TEST ONLY retained evidence",
          );
        } finally {
          fs.unlinkSync(debris);
          fs.rmdirSync(target);
        }
      },
    );

    it("does not classify injected candidate bytes as non-RRSI or admit a draft by filename", () => {
      const target = path.join(
        provisioned.prepared.candidate.rootDir,
        `${"a".repeat(64)}.json`,
      );
      fs.writeFileSync(target, "TEST ONLY unknown content");
      try {
        assertNoMutations(() => {
          expectHold(() =>
            registries.candidate.read(`sha256:${"a".repeat(64)}`),
          );
          expectHold(() => registries.candidate.readInventory());
          expectHold(() => registries.release.readInventory());
        });
        expect(fs.readFileSync(target, "utf8")).toBe(
          "TEST ONLY unknown content",
        );
      } finally {
        fs.unlinkSync(target);
      }
    });

    it("rejects unbound filesystem aliases into the reserved pair even when the marker is absent", () => {
      const target = marker("candidate"),
        saved = path.join(root, "saved-alias-marker");
      const alias = path.join(root, "candidate-alias");
      fs.symlinkSync(
        provisioned.prepared.candidate.baseDir,
        alias,
        process.platform === "win32" ? "junction" : "dir",
      );
      fs.renameSync(target, saved);
      try {
        assertNoMutations(() =>
          expect(
            () =>
              new SkillCandidateRegistry({
                ...candidateOptions(bindings.candidate),
                rootDir: alias,
                storePolicyBinding: undefined,
              }),
          ).toThrow(expect.objectContaining({ code: HOLD })),
        );
        expect(fs.existsSync(target)).toBe(false);
      } finally {
        fs.renameSync(saved, target);
        fs.unlinkSync(alias);
      }
    });

    it("rejects uncommitted or caller-nominated operation bindings", () => {
      expect(() =>
        fixture.policy.bindComponent({
          operationId: "test:unregistered",
          component: "candidate",
        }),
      ).toThrow();
      expect(() =>
        fixture.policy.bindComponent({
          operationId,
          component: "candidate",
          readyForExecution: true,
        }),
      ).toThrow();
      expect(() =>
        fixture.policy.bindComponent({ operationId, component: "other" }),
      ).toThrow();
      expect(() =>
        other.policy.bindComponent({ operationId, component: "candidate" }),
      ).toThrow();
    });

    it("rechecks current native parent permissions when an existing binding reopens and never repairs them", () => {
      const parent = provisioned.prepared.parent.path;
      if (process.platform === "win32") {
        const result = spawnSync(
          "icacls.exe",
          [parent, "/grant", "*S-1-1-0:(OI)(CI)(F)"],
          { encoding: "utf8", windowsHide: true, timeout: 15_000 },
        );
        expect(result.status, result.stderr).toBe(0);
      } else fs.chmodSync(parent, 0o777);
      try {
        expect(inspectPrivatePaths([parent])[0].ok).toBe(false);
        assertNoMutations(() =>
          expectHold(() => openRegistries(bindings, fixture.ports)),
        );
        expect(inspectPrivatePaths([parent])[0].ok).toBe(false);
      } finally {
        repairPrivatePath(parent);
      }
      expect(
        openRegistries(bindings, fixture.ports).release.readInventory(),
      ).toEqual({ active: [], releases: [] });
    });

    it("rechecks both marker bytes after final inventory enumeration before returning an initial state", () => {
      const target = marker("candidate"),
        original = fs.readFileSync(target),
        before = fs.lstatSync(target);
      const readdir = fs.readdirSync;
      let enumerations = 0,
        injected = false;
      const hook = vi
        .spyOn(fs, "readdirSync")
        .mockImplementation((directory, ...args) => {
          const names = readdir(directory, ...args);
          if (
            directory === provisioned.prepared.release.rootDir &&
            ++enumerations === 2
          ) {
            fs.writeFileSync(
              target,
              Buffer.concat([original, Buffer.from(" ")]),
            );
            injected = true;
          }
          return names;
        });
      try {
        expectHold(() => registries.release.readState("safe-refactor"));
        expect(injected).toBe(true);
        const after = fs.lstatSync(target);
        expect([after.dev, after.ino]).toEqual([before.dev, before.ino]);
      } finally {
        hook.mockRestore();
        fs.writeFileSync(target, original);
      }
    });
  },
);
