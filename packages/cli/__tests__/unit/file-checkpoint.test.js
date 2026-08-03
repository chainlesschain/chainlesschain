import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, parse, resolve } from "node:path";

const privateAuthorityCalls = vi.hoisted(() => ({
  inspections: [],
  repairs: [],
}));

// Starting PowerShell for every DACL assertion makes this unit suite take
// several minutes on Windows. Keep the structural tests synchronous and fast;
// the Windows ACL regression below runs the unmocked production modules in a
// child process against a real Everyone:F grant.
vi.mock("../../src/lib/secure-fs.js", async (importOriginal) => {
  const actual = await importOriginal();
  if (process.platform !== "win32") return actual;
  const runtimeFs = (await import("node:fs")).default;
  const inspect = (target) => {
    try {
      const stat = runtimeFs.lstatSync(target);
      return {
        target,
        exists: true,
        ok: !stat.isSymbolicLink(),
        platform: "win32-unit-double",
      };
    } catch (error) {
      return {
        target,
        exists: false,
        ok: false,
        platform: "win32-unit-double",
        error: error.message,
      };
    }
  };
  return {
    ...actual,
    ensurePrivateDirectory(target) {
      runtimeFs.mkdirSync(target, { recursive: true, mode: 0o700 });
      const stat = runtimeFs.lstatSync(target);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`Expected owner-private directory: ${target}`);
      }
      return target;
    },
    inspectPrivatePaths(targets) {
      const uniqueTargets = [...new Set((targets || []).map(String))];
      privateAuthorityCalls.inspections.push(uniqueTargets);
      return uniqueTargets.map(inspect);
    },
    repairPrivatePaths(targets) {
      const uniqueTargets = [...new Set((targets || []).map(String))];
      privateAuthorityCalls.repairs.push(uniqueTargets);
      return uniqueTargets.map((target) => {
        const result = inspect(target);
        if (result.exists && !result.ok) {
          throw new Error(`Refusing linked authority path: ${target}`);
        }
        return result.exists
          ? { ...result, ok: true }
          : { ...result, ok: true, skipped: true };
      });
    },
  };
});

import {
  createCheckpoint,
  getCheckpoint,
  listCheckpoints,
  diffCheckpoint,
  restoreCheckpoint,
  deleteCheckpoint,
  clearCheckpoints,
  computeCheckpointIdentity,
  prepareCheckpointRollback,
  executeCheckpointRollback,
  SKIP_DIRS,
  _fileCheckpointInternals,
  _fileCheckpointStoreDeps,
} from "../../src/lib/file-checkpoint.js";
import {
  CHECKPOINT_RESTORE_SAGA_ERROR_CODES,
  CheckpointRestoreSagaStore,
} from "../../src/lib/checkpoint-restore-saga.js";

const AFFECTED_WINDOWS_UV_VERSIONS = Object.freeze(["1.49.1", "1.50.0"]);
const COPY_STORE_AUTHORITY_DIR = ".cc-copy-store-authority";
const COPY_STORE_AUTHORITY_SCHEMA = "cc-copy-checkpoint-store-authority/v1";
const COPY_STORE_AUTHORITY_DIGEST_DOMAIN =
  "cc-copy-checkpoint-store-authority-root/v1\0";

function filesystemObjectIdentity(stat) {
  const ns = (field, fallback) =>
    stat[field] != null
      ? String(stat[field])
      : String(Math.trunc(Number(stat[fallback] || 0) * 1_000_000));
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    mode: String(stat.mode),
    nlink: String(stat.nlink),
    size: String(stat.size),
    mtimeNs: ns("mtimeNs", "mtimeMs"),
  };
}

function findRestoreArm(root, safetyId, predicate) {
  const armDir = join(root, safetyId, ".restore-safety-arms");
  for (const name of readdirSync(armDir)) {
    const armPath = join(armDir, name);
    const arm = JSON.parse(readFileSync(armPath, "utf8"));
    if (predicate(arm)) return { arm, armPath };
  }
  throw new Error(`Restore arm was not found for ${safetyId}`);
}

function projectedStat(stat, overrides) {
  return new Proxy(stat, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) return overrides[property];
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function pathKey(filePath) {
  const canonical = resolve(String(filePath));
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

function projectedFileIdentityOptions(
  target,
  {
    uvVersion = "1.49.1",
    pathDevice = 987654321n,
    handleDevice = 77n,
    pathOverrides = () => ({}),
    handleOverrides = () => ({}),
    parentDevice = String(handleDevice),
  } = {},
) {
  const targetKey = pathKey(target);
  const nativeLstatSync = fs.lstatSync.bind(fs);
  const nativeFstatSync = fs.fstatSync.bind(fs);
  let pathSample = 0;
  let handleSample = 0;
  const runtimeFs = {
    ...fs,
    constants: fs.constants,
    realpathSync: fs.realpathSync,
    lstatSync(filePath, options) {
      const stat = nativeLstatSync(filePath, options);
      if (pathKey(filePath) !== targetKey) return stat;
      pathSample += 1;
      return projectedStat(stat, {
        dev: pathDevice,
        ...pathOverrides(stat, pathSample),
      });
    },
    fstatSync(descriptor, options) {
      const stat = nativeFstatSync(descriptor, options);
      handleSample += 1;
      return projectedStat(stat, {
        dev: handleDevice,
        ...handleOverrides(stat, handleSample),
      });
    },
  };
  return {
    runtimeFs,
    runtime: { platform: "win32", uvVersion },
    secureFileParent(_runtimeFs, filePath, callback) {
      return callback({
        canonicalPath: filePath,
        parentDevice,
      });
    },
  };
}

describe("file-checkpoint store", () => {
  let work; // the "project" dir holding files
  let root; // checkpoint store root
  let retentionStateDir;
  let retentionLockDir;
  let priorNodeEnv;

  beforeEach(() => {
    priorNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    privateAuthorityCalls.inspections.length = 0;
    privateAuthorityCalls.repairs.length = 0;
    // macOS commonly exposes /var as /private/var, while hosted Windows
    // runners may expose an 8.3 TEMP alias. The production readers correctly
    // reject aliased authority roots, so keep the fixture on its canonical
    // path instead of turning the first identity test into a suite-wide
    // manifest-read cascade.
    const base = realpathSync.native(mkdtempSync(join(tmpdir(), "cp-test-")));
    work = join(base, "work");
    root = join(base, "store");
    retentionStateDir = join(base, "restore-state");
    retentionLockDir = join(base, "workspace-locks");
    mkdirSync(work, { recursive: true });
    writeFileSync(join(work, "a.txt"), "ORIGINAL-A", "utf-8");
    writeFileSync(join(work, "b.txt"), "ORIGINAL-B", "utf-8");
  });
  afterEach(() => {
    rmSync(join(work, ".."), { recursive: true, force: true });
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = priorNodeEnv;
  });

  const mk = (label) =>
    createCheckpoint(["a.txt", "b.txt"], { cwd: work, root, label });

  const retentionOptions = (cwd = work) => ({
    root,
    cwd,
    retentionAllowTestRuntime: true,
    retentionStateDir,
    retentionWorkspaceLockOptions: {
      lockDir: retentionLockDir,
      allowNonCanonicalLockDirForTests: true,
      timeoutMs: 1_000,
      retryMs: 1,
    },
  });

  const retainCopyCheckpoint = (manifest, operationId) => {
    const store = new CheckpointRestoreSagaStore({
      workspaceRoot: realpathSync.native(work),
      stateDir: retentionStateDir,
    });
    store.create({
      operationId,
      evidence: {
        restoreKind: "copy",
        restoreSurface: "direct",
        checkpointId: manifest.id,
        checkpointIdentity: computeCheckpointIdentity(manifest),
      },
    });
    return store;
  };

  const mixedRollbackResidue = (failAfterIndex) => {
    const c = join(work, "c.txt");
    writeFileSync(join(work, "a.txt"), "FORWARD-A", "utf8");
    writeFileSync(join(work, "b.txt"), "FORWARD-B", "utf8");
    writeFileSync(c, "FORWARD-C", "utf8");
    const forward = createCheckpoint(["a.txt", "b.txt", "c.txt"], {
      cwd: work,
      root,
      label: "mixed-forward-target",
    });

    writeFileSync(join(work, "a.txt"), "SAFETY-A", "utf8");
    rmSync(join(work, "b.txt"));
    writeFileSync(c, "SAFETY-C", "utf8");
    const original = restoreCheckpoint(forward.id, {
      root,
      cwd: work,
      expectedIdentity: computeCheckpointIdentity(forward),
    });
    rmSync(c);

    let mutationCount = null;
    let failure = null;
    try {
      restoreCheckpoint(original.safetyId, {
        root,
        cwd: work,
        expectedIdentity: original.safetyIdentity,
        expectedSafetyPlanIdentity: original.safetyPlanIdentity,
        onMutationStarted: (evidence) => {
          mutationCount = evidence.mutationCount;
        },
        onTargetPublished: ({ index }) => {
          if (index === failAfterIndex) {
            const error = new Error("stop mixed restore after publish");
            error.code = "INJECTED_MIXED_RESTORE_STOP";
            throw error;
          }
        },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: "INJECTED_MIXED_RESTORE_STOP",
      safetyCoverage: "full",
    });
    expect(mutationCount).toBe(3);
    return {
      originalId: original.safetyId,
      originalIdentity: original.safetyIdentity,
      safetyId: failure.safetyId,
      safetyIdentity: failure.safetyIdentity,
      safetyPlanIdentity: failure.safetyPlanIdentity,
      originalMutationTargetCount: mutationCount,
    };
  };

  const ownedLease = () => ({
    canonicalWorkspaceRoot: realpathSync.native(work),
    assertOwned: vi.fn(),
  });

  it.each(AFFECTED_WINDOWS_UV_VERSIONS)(
    "accepts trusted cross-API device projections in all checkpoint readers on libuv %s",
    (uvVersion) => {
      const target = join(work, "a.txt");
      const content = Buffer.from("ORIGINAL-A", "utf8");
      const options = projectedFileIdentityOptions(target, { uvVersion });

      expect(
        _fileCheckpointInternals
          .readBoundedPlainFile(target, content.length, options)
          .equals(content),
      ).toBe(true);

      const inspected = _fileCheckpointInternals.inspectTarget(
        work,
        target,
        "a.txt",
        options,
      );
      expect(inspected.content.equals(content)).toBe(true);
      expect(inspected.prestate.objectIdentity.dev).toBe("77");

      const plannedIdentity =
        _fileCheckpointInternals.inspectPlannedRegularFile(
          { id: "projected-reader-test" },
          target,
          {
            rel: "a.txt",
            targetSha256: createHash("sha256").update(content).digest("hex"),
            targetBytes: content.length,
          },
          options,
        );
      expect(plannedIdentity.dev).toBe("77");
      expect(plannedIdentity.size).toBe(String(content.length));
    },
  );

  it("rejects cross-API device projections outside the affected runtime", () => {
    const target = join(work, "a.txt");
    const options = projectedFileIdentityOptions(target, {
      uvVersion: "1.51.0",
    });

    expect(() =>
      _fileCheckpointInternals.readBoundedPlainFile(target, 64, options),
    ).toThrow(/identity changed while opening/u);
  });

  it("keeps path and handle snapshots exact while bridging the device field", () => {
    const target = join(work, "a.txt");
    const pathDrift = projectedFileIdentityOptions(target, {
      pathOverrides: (stat, sample) =>
        sample === 3 ? { ctimeNs: stat.ctimeNs + 1n } : {},
    });
    const handleDrift = projectedFileIdentityOptions(target, {
      handleOverrides: (stat, sample) =>
        sample === 2 ? { ctimeNs: stat.ctimeNs + 1n } : {},
    });

    expect(() =>
      _fileCheckpointInternals.readBoundedPlainFile(target, 64, pathDrift),
    ).toThrow(/changed during read/u);
    expect(() =>
      _fileCheckpointInternals.readBoundedPlainFile(target, 64, handleDrift),
    ).toThrow(/changed during read/u);
  });

  it.skipIf(process.platform !== "win32")(
    "combines projected target lstat with the production trusted-parent authority",
    () => {
      const target = join(work, "a.txt");
      const targetKey = pathKey(target);
      const nativeLstatSync = fs.lstatSync.bind(fs);
      const runtimeFs = {
        ...fs,
        constants: fs.constants,
        realpathSync: fs.realpathSync,
        lstatSync(filePath, options) {
          const stat = nativeLstatSync(filePath, options);
          return pathKey(filePath) === targetKey
            ? projectedStat(stat, { dev: 0n })
            : stat;
        },
      };

      const inspected = _fileCheckpointInternals.inspectTarget(
        work,
        target,
        "a.txt",
        {
          runtimeFs,
          runtime: { platform: "win32", uvVersion: "1.49.1" },
        },
      );

      expect(inspected.content.toString("utf8")).toBe("ORIGINAL-A");
      expect(inspected.prestate.objectIdentity.dev).not.toBe("0");
    },
  );

  it("creates a checkpoint capturing file contents", () => {
    const m = mk("v1");
    expect(m.fileCount).toBe(2);
    expect(m.label).toBe("v1");
    expect(m.files.map((f) => f.rel).sort()).toEqual(["a.txt", "b.txt"]);
    expect(getCheckpoint(m.id, { root })).toMatchObject({ id: m.id });
    expect(listCheckpoints({ root }).map((c) => c.id)).toContain(m.id);
    expect(listCheckpoints({ root })[0].identity).toBe(
      computeCheckpointIdentity(m),
    );
  });

  it("rejects a replaced manifest identity before diffing or writing", () => {
    const m = mk("immutable");
    const expectedIdentity = computeCheckpointIdentity(m);
    writeFileSync(join(work, "a.txt"), "CHANGED-A", "utf-8");
    writeFileSync(join(work, "b.txt"), "CHANGED-B", "utf-8");
    writeFileSync(
      join(root, `${m.id}.json`),
      JSON.stringify({ ...m, label: "replaced" }, null, 2),
      "utf-8",
    );

    expect(() => diffCheckpoint(m.id, { root, expectedIdentity })).toThrow(
      expect.objectContaining({ code: "CHECKPOINT_IDENTITY_STALE" }),
    );
    expect(() => restoreCheckpoint(m.id, { root, expectedIdentity })).toThrow(
      expect.objectContaining({ code: "CHECKPOINT_IDENTITY_STALE" }),
    );
    expect(readFileSync(join(work, "a.txt"), "utf-8")).toBe("CHANGED-A");
    expect(readFileSync(join(work, "b.txt"), "utf-8")).toBe("CHANGED-B");
  });

  it.each([
    ["missing", "CHECKPOINT_BLOB_MISSING"],
    ["corrupt", "CHECKPOINT_BLOB_CORRUPT"],
  ])(
    "rejects a %s identity-bound blob before any workspace write",
    (mode, code) => {
      const m = mk(mode);
      const expectedIdentity = computeCheckpointIdentity(m);
      const blobPath = join(root, m.id, m.files[1].sha256);
      if (mode === "missing") rmSync(blobPath);
      else writeFileSync(blobPath, "CORRUPT-BLOB", "utf-8");
      writeFileSync(join(work, "a.txt"), "CHANGED-A", "utf-8");
      writeFileSync(join(work, "b.txt"), "CHANGED-B", "utf-8");

      expect(() => restoreCheckpoint(m.id, { root, expectedIdentity })).toThrow(
        expect.objectContaining({ code }),
      );
      expect(readFileSync(join(work, "a.txt"), "utf-8")).toBe("CHANGED-A");
      expect(readFileSync(join(work, "b.txt"), "utf-8")).toBe("CHANGED-B");
      expect(listCheckpoints({ root })).toHaveLength(1);
    },
  );

  it("diff reports modified / unchanged / deleted", () => {
    const m = mk();
    writeFileSync(join(work, "a.txt"), "CHANGED-A", "utf-8"); // modify
    rmSync(join(work, "b.txt")); // delete
    const d = diffCheckpoint(m.id, { root });
    expect(d.modified).toEqual(["a.txt"]);
    expect(d.deleted).toEqual(["b.txt"]);
    expect(d.unchanged).toEqual([]);
  });

  it("binds the complete copy-checkpoint scope and prestate to the workspace", () => {
    const m = mk("workspace-binding");
    const expectedIdentity = computeCheckpointIdentity(m);
    writeFileSync(join(work, "a.txt"), "CHANGED-A", "utf-8");
    rmSync(join(work, "b.txt"));

    const first = diffCheckpoint(m.id, {
      root,
      cwd: work,
      expectedIdentity,
    });
    const second = diffCheckpoint(m.id, {
      root,
      cwd: work,
      expectedIdentity,
    });

    expect(first).toMatchObject({
      checkpointIdentity: expectedIdentity,
      modified: ["a.txt"],
      deleted: ["b.txt"],
      unchanged: [],
      workspaceBinding: {
        schema: "cc-checkpoint-workspace-binding/v1",
        version: 1,
        engine: "copy",
        workspaceRoot: realpathSync.native(work),
        scopeIdentity: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        prestateIdentity: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        writePlanIdentity: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        targetPoststateIdentity: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    });
    expect(second.workspaceBinding).toEqual(first.workspaceBinding);

    const restored = restoreCheckpoint(m.id, {
      root,
      cwd: work,
      expectedIdentity,
      expectedWorkspaceBinding: first.workspaceBinding,
      skipSafety: true,
    });
    expect(restored.restored.sort()).toEqual(["a.txt", "b.txt"]);
  });

  it("rejects a timeline checkpoint whose manifest cwd differs", () => {
    const m = mk("cwd-mismatch");
    const other = join(work, "..", "other-workspace");
    mkdirSync(other, { recursive: true });

    expect(() =>
      diffCheckpoint(m.id, {
        root,
        cwd: other,
        expectedIdentity: computeCheckpointIdentity(m),
      }),
    ).toThrow(
      expect.objectContaining({ code: "CHECKPOINT_WORKSPACE_SCOPE_INVALID" }),
    );
  });

  it("rejects the active platform filesystem root as a copy workspace", () => {
    const m = mk("filesystem-root");
    const filesystemRoot = parse(realpathSync.native(work)).root;
    const replaced = {
      ...m,
      cwd: filesystemRoot,
      files: m.files.map((file) => ({
        ...file,
        abs: join(filesystemRoot, file.rel),
      })),
    };
    writeFileSync(
      join(root, `${m.id}.json`),
      JSON.stringify(replaced, null, 2),
      "utf-8",
    );

    expect(() =>
      diffCheckpoint(m.id, {
        root,
        cwd: filesystemRoot,
        expectedIdentity: computeCheckpointIdentity(replaced),
      }),
    ).toThrow(
      expect.objectContaining({ code: "CHECKPOINT_WORKSPACE_SCOPE_INVALID" }),
    );
  });

  it.each([
    [
      "parent traversal",
      (manifest) => ({
        ...manifest,
        files: [
          {
            ...manifest.files[0],
            rel: "../outside.txt",
            abs: join(work, "..", "outside.txt"),
          },
        ],
        fileCount: 1,
      }),
    ],
    [
      "abs/rel disagreement",
      (manifest) => ({
        ...manifest,
        files: [
          {
            ...manifest.files[0],
            abs: join(work, "b.txt"),
          },
        ],
        fileCount: 1,
      }),
    ],
    [
      "duplicate target alias",
      (manifest) => ({
        ...manifest,
        files: [manifest.files[0], { ...manifest.files[0] }],
        fileCount: 2,
      }),
    ],
    [
      "a mismatched manifest id",
      (manifest) => ({ ...manifest, id: "../escaped-store" }),
    ],
  ])("rejects an untrusted manifest with %s", (_label, mutate) => {
    const m = mk("untrusted-manifest");
    const replaced = mutate(m);
    writeFileSync(
      join(root, `${m.id}.json`),
      JSON.stringify(replaced, null, 2),
      "utf-8",
    );

    expect(() =>
      diffCheckpoint(m.id, {
        root,
        cwd: work,
        expectedIdentity: computeCheckpointIdentity(replaced),
      }),
    ).toThrow(
      expect.objectContaining({ code: "CHECKPOINT_WORKSPACE_SCOPE_INVALID" }),
    );
  });

  it("rejects a target whose existing parent becomes a filesystem alias", () => {
    mkdirSync(join(work, "nested"), { recursive: true });
    writeFileSync(join(work, "nested", "c.txt"), "ORIGINAL-C", "utf-8");
    const m = createCheckpoint(["nested/c.txt"], { cwd: work, root });
    const moved = join(work, "..", "nested-real");
    renameSync(join(work, "nested"), moved);
    symlinkSync(
      moved,
      join(work, "nested"),
      process.platform === "win32" ? "junction" : "dir",
    );

    expect(() =>
      diffCheckpoint(m.id, {
        root,
        cwd: work,
        expectedIdentity: computeCheckpointIdentity(m),
      }),
    ).toThrow(
      expect.objectContaining({ code: "CHECKPOINT_WORKSPACE_SCOPE_INVALID" }),
    );
  });

  it("preflights every checkpoint blob before returning a workspace binding", () => {
    const m = mk("binding-blob-preflight");
    writeFileSync(join(root, m.id, m.files[1].sha256), "CORRUPT-BLOB", "utf-8");

    expect(() =>
      diffCheckpoint(m.id, {
        root,
        cwd: work,
        expectedIdentity: computeCheckpointIdentity(m),
      }),
    ).toThrow(expect.objectContaining({ code: "CHECKPOINT_BLOB_CORRUPT" }));
  });

  it("rejects modified-to-another-modified drift before safety or writes", () => {
    const m = mk("modified-drift");
    const expectedIdentity = computeCheckpointIdentity(m);
    writeFileSync(join(work, "a.txt"), "MODIFIED-ONE", "utf-8");
    const preview = diffCheckpoint(m.id, {
      root,
      cwd: work,
      expectedIdentity,
    });
    writeFileSync(join(work, "a.txt"), "MODIFIED-TWO", "utf-8");

    expect(() =>
      restoreCheckpoint(m.id, {
        root,
        cwd: work,
        expectedIdentity,
        expectedWorkspaceBinding: preview.workspaceBinding,
      }),
    ).toThrow(expect.objectContaining({ code: "CHECKPOINT_WORKSPACE_STALE" }));
    expect(readFileSync(join(work, "a.txt"), "utf-8")).toBe("MODIFIED-TWO");
    expect(readFileSync(join(work, "b.txt"), "utf-8")).toBe("ORIGINAL-B");
    expect(listCheckpoints({ root })).toHaveLength(1);
  });

  it.each([
    [
      "missing to present",
      () => rmSync(join(work, "a.txt")),
      () => writeFileSync(join(work, "a.txt"), "NEW-A", "utf-8"),
      () => expect(readFileSync(join(work, "a.txt"), "utf-8")).toBe("NEW-A"),
    ],
    [
      "present to missing",
      () => {},
      () => rmSync(join(work, "a.txt")),
      () => expect(existsSync(join(work, "a.txt"))).toBe(false),
    ],
  ])(
    "rejects %s drift before safety or writes",
    (_label, arrangePreview, drift, assertUnchanged) => {
      const m = mk("presence-drift");
      const expectedIdentity = computeCheckpointIdentity(m);
      arrangePreview();
      const preview = diffCheckpoint(m.id, {
        root,
        cwd: work,
        expectedIdentity,
      });
      drift();

      expect(() =>
        restoreCheckpoint(m.id, {
          root,
          cwd: work,
          expectedIdentity,
          expectedWorkspaceBinding: preview.workspaceBinding,
        }),
      ).toThrow(
        expect.objectContaining({ code: "CHECKPOINT_WORKSPACE_STALE" }),
      );
      assertUnchanged();
      expect(readFileSync(join(work, "b.txt"), "utf-8")).toBe("ORIGINAL-B");
      expect(listCheckpoints({ root })).toHaveLength(1);
    },
  );

  it("restore rolls files back to snapshot content", () => {
    const m = mk();
    writeFileSync(join(work, "a.txt"), "CHANGED-A", "utf-8");
    rmSync(join(work, "b.txt"));
    const r = restoreCheckpoint(m.id, { root, skipSafety: true });
    expect(r.restored.sort()).toEqual(["a.txt", "b.txt"]);
    expect(readFileSync(join(work, "a.txt"), "utf-8")).toBe("ORIGINAL-A");
    expect(readFileSync(join(work, "b.txt"), "utf-8")).toBe("ORIGINAL-B");
  });

  it("dry-run reports changes without writing", () => {
    const m = mk();
    writeFileSync(join(work, "a.txt"), "CHANGED-A", "utf-8");
    const r = restoreCheckpoint(m.id, { root, dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.restored).toEqual(["a.txt"]);
    // file NOT reverted
    expect(readFileSync(join(work, "a.txt"), "utf-8")).toBe("CHANGED-A");
  });

  it("restore is reversible via the auto safety checkpoint", () => {
    const m = mk();
    writeFileSync(join(work, "a.txt"), "CHANGED-A", "utf-8");
    const r = restoreCheckpoint(m.id, { root }); // safety on by default
    expect(r.safetyId).toBeTruthy();
    expect(readFileSync(join(work, "a.txt"), "utf-8")).toBe("ORIGINAL-A");
    // undo the restore using the safety checkpoint
    restoreCheckpoint(r.safetyId, { root, skipSafety: true });
    expect(readFileSync(join(work, "a.txt"), "utf-8")).toBe("CHANGED-A");
  });

  it("copy rollback adapter restores an exact modified, added, and deleted tree", () => {
    const fixture = mixedRollbackResidue(2);
    const prepared = prepareCheckpointRollback(
      work,
      fixture.originalId,
      fixture.safetyId,
      {
        root,
        expectedOriginalIdentity: fixture.originalIdentity,
        expectedSafetyIdentity: fixture.safetyIdentity,
        expectedSafetyPlanIdentity: fixture.safetyPlanIdentity,
        originalMutationTargetCount: fixture.originalMutationTargetCount,
      },
    );

    expect(Object.keys(prepared).sort()).toEqual(
      [
        "checkpointNamespace",
        "currentRollbackPaths",
        "engine",
        "expectedRollbackStateDigest",
        "expectedWorkspaceBinding",
        "originalBindingVerification",
        "originalCheckpoint",
        "originalMutationPaths",
        "originalMutationTargetCount",
        "originalPlanAuthority",
        "originalWorkspaceBinding",
        "rollbackPlanIdentity",
        "rollbackPrestateDigest",
        "safetyCheckpoint",
        "schema",
        "targetCount",
        "version",
        "workspaceRoot",
      ].sort(),
    );
    expect(prepared).toMatchObject({
      schema: "chainlesschain.checkpoint-rollback-plan",
      version: 1,
      engine: "copy",
      checkpointNamespace: null,
      originalCheckpoint: {
        id: fixture.originalId,
        identity: fixture.originalIdentity,
        treeIdentity: null,
      },
      safetyCheckpoint: {
        id: fixture.safetyId,
        identity: fixture.safetyIdentity,
        planIdentity: fixture.safetyPlanIdentity,
        treeIdentity: null,
      },
      originalBindingVerification: "durable-safety-plan-v2",
      originalWorkspaceBinding: null,
      originalMutationPaths: ["a.txt", "b.txt", "c.txt"],
      currentRollbackPaths: ["a.txt", "b.txt", "c.txt"],
      originalMutationTargetCount: 3,
      targetCount: 3,
      rollbackPrestateDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      rollbackPlanIdentity: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      expectedRollbackStateDigest: expect.stringMatching(
        /^sha256:[a-f0-9]{64}$/,
      ),
      originalPlanAuthority: {
        sourceCheckpointId: fixture.originalId,
        sourceCheckpointIdentity: fixture.originalIdentity,
        safetyPlanIdentity: fixture.safetyPlanIdentity,
        mutationSetIdentity: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        bindingReconstructable: false,
      },
    });
    expect(prepared.rollbackPlanIdentity).toBe(
      prepared.expectedWorkspaceBinding.writePlanIdentity,
    );
    expect(Object.keys(prepared.originalCheckpoint).sort()).toEqual([
      "id",
      "identity",
      "treeIdentity",
    ]);
    expect(Object.keys(prepared.safetyCheckpoint).sort()).toEqual([
      "id",
      "identity",
      "planIdentity",
      "treeIdentity",
    ]);
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.currentRollbackPaths)).toBe(true);

    const lease = ownedLease();
    const result = executeCheckpointRollback(work, prepared, {
      root,
      workspaceLease: lease,
    });

    expect(result).toEqual({
      schema: "chainlesschain.checkpoint-rollback-result",
      version: 1,
      engine: "copy",
      rolledBackCount: 3,
      rollbackStateDigest: prepared.expectedRollbackStateDigest,
    });
    expect(lease.assertOwned).toHaveBeenCalled();
    expect(readFileSync(join(work, "a.txt"), "utf8")).toBe("FORWARD-A");
    expect(readFileSync(join(work, "b.txt"), "utf8")).toBe("FORWARD-B");
    expect(existsSync(join(work, "c.txt"))).toBe(false);
    expect(
      diffCheckpoint(fixture.safetyId, {
        root,
        cwd: work,
        expectedIdentity: fixture.safetyIdentity,
        expectedSafetyPlanIdentity: fixture.safetyPlanIdentity,
      }),
    ).toMatchObject({ modified: [], deleted: [] });

    const settled = prepareCheckpointRollback(
      work,
      fixture.originalId,
      fixture.safetyId,
      {
        root,
        expectedOriginalIdentity: fixture.originalIdentity,
        expectedSafetyIdentity: fixture.safetyIdentity,
        expectedSafetyPlanIdentity: fixture.safetyPlanIdentity,
        originalMutationTargetCount: 3,
      },
    );
    expect(settled).toMatchObject({
      currentRollbackPaths: [],
      targetCount: 0,
      expectedRollbackStateDigest: prepared.expectedRollbackStateDigest,
    });
    expect(
      executeCheckpointRollback(work, settled, {
        root,
        workspaceLease: ownedLease(),
      }),
    ).toEqual({
      schema: "chainlesschain.checkpoint-rollback-result",
      version: 1,
      engine: "copy",
      rolledBackCount: 0,
      rollbackStateDigest: prepared.expectedRollbackStateDigest,
    });
  });

  it("copy rollback adapter plans only the exact partial mutation residue", () => {
    const fixture = mixedRollbackResidue(0);
    const prepared = prepareCheckpointRollback(
      work,
      fixture.originalId,
      fixture.safetyId,
      {
        root,
        expectedOriginalIdentity: fixture.originalIdentity,
        expectedSafetyIdentity: fixture.safetyIdentity,
        expectedSafetyPlanIdentity: fixture.safetyPlanIdentity,
        originalMutationTargetCount: 3,
      },
    );

    expect(prepared.originalMutationPaths).toEqual(["a.txt", "b.txt", "c.txt"]);
    expect(prepared.currentRollbackPaths).toEqual(["a.txt"]);
    expect(prepared).toMatchObject({
      originalMutationTargetCount: 3,
      targetCount: 1,
    });

    expect(
      executeCheckpointRollback(work, prepared, {
        root,
        workspaceLease: ownedLease(),
      }),
    ).toMatchObject({
      rolledBackCount: 1,
      rollbackStateDigest: prepared.expectedRollbackStateDigest,
    });
    expect(readFileSync(join(work, "a.txt"), "utf8")).toBe("FORWARD-A");
    expect(readFileSync(join(work, "b.txt"), "utf8")).toBe("FORWARD-B");
    expect(existsSync(join(work, "c.txt"))).toBe(false);
  });

  it("copy rollback adapter rejects a same-content third-party successor", () => {
    const fixture = mixedRollbackResidue(0);
    const target = join(work, "a.txt");
    renameSync(target, join(work, "armed-a-predecessor.txt"));
    writeFileSync(target, "SAFETY-A", "utf8");

    expect(() =>
      prepareCheckpointRollback(work, fixture.originalId, fixture.safetyId, {
        root,
        expectedOriginalIdentity: fixture.originalIdentity,
        expectedSafetyIdentity: fixture.safetyIdentity,
        expectedSafetyPlanIdentity: fixture.safetyPlanIdentity,
        originalMutationTargetCount: 3,
      }),
    ).toThrow(
      expect.objectContaining({ code: "CHECKPOINT_ROLLBACK_RESIDUE_INVALID" }),
    );
    expect(readFileSync(target, "utf8")).toBe("SAFETY-A");

    const deletedFixture = mixedRollbackResidue(0);
    const deletedTarget = join(work, "b.txt");
    renameSync(deletedTarget, join(work, "deleted-b-predecessor.txt"));
    writeFileSync(deletedTarget, "FORWARD-B", "utf8");
    expect(() =>
      prepareCheckpointRollback(
        work,
        deletedFixture.originalId,
        deletedFixture.safetyId,
        {
          root,
          expectedOriginalIdentity: deletedFixture.originalIdentity,
          expectedSafetyIdentity: deletedFixture.safetyIdentity,
          expectedSafetyPlanIdentity: deletedFixture.safetyPlanIdentity,
          originalMutationTargetCount: 3,
        },
      ),
    ).toThrow(
      expect.objectContaining({ code: "CHECKPOINT_ROLLBACK_RESIDUE_INVALID" }),
    );
    expect(readFileSync(deletedTarget, "utf8")).toBe("FORWARD-B");
  });

  it("copy rollback adapter handles an ordinary checkpoint partial forward restore", () => {
    const original = mk("ordinary-partial-forward");
    const originalIdentity = computeCheckpointIdentity(original);
    writeFileSync(join(work, "a.txt"), "PRESTATE-A", "utf8");
    writeFileSync(join(work, "b.txt"), "PRESTATE-B", "utf8");
    let failure;
    try {
      restoreCheckpoint(original.id, {
        root,
        cwd: work,
        expectedIdentity: originalIdentity,
        onTargetPublished: ({ index }) => {
          if (index === 0) {
            const error = new Error("stop ordinary restore after one target");
            error.code = "INJECTED_ORDINARY_RESTORE_STOP";
            throw error;
          }
        },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: "INJECTED_ORDINARY_RESTORE_STOP",
      safetyCoverage: "full",
    });

    const prepared = prepareCheckpointRollback(
      work,
      original.id,
      failure.safetyId,
      {
        root,
        expectedOriginalIdentity: originalIdentity,
        expectedSafetyIdentity: failure.safetyIdentity,
        expectedSafetyPlanIdentity: failure.safetyPlanIdentity,
        originalMutationTargetCount: 2,
      },
    );
    expect(prepared).toMatchObject({
      originalMutationPaths: ["a.txt", "b.txt"],
      currentRollbackPaths: ["a.txt"],
      originalMutationTargetCount: 2,
      targetCount: 1,
    });
    expect(
      executeCheckpointRollback(work, prepared, {
        root,
        workspaceLease: ownedLease(),
      }),
    ).toMatchObject({ rolledBackCount: 1 });
    expect(readFileSync(join(work, "a.txt"), "utf8")).toBe("PRESTATE-A");
    expect(readFileSync(join(work, "b.txt"), "utf8")).toBe("PRESTATE-B");
  });

  it("copy rollback adapter rejects identity, plan, count, and binding drift", () => {
    const fixture = mixedRollbackResidue(0);
    const exact = {
      root,
      expectedOriginalIdentity: fixture.originalIdentity,
      expectedSafetyIdentity: fixture.safetyIdentity,
      expectedSafetyPlanIdentity: fixture.safetyPlanIdentity,
      originalMutationTargetCount: 3,
    };
    expect(() =>
      prepareCheckpointRollback(work, fixture.originalId, fixture.safetyId, {
        ...exact,
        expectedOriginalIdentity: `sha256:${"1".repeat(64)}`,
      }),
    ).toThrow(expect.objectContaining({ code: "CHECKPOINT_IDENTITY_STALE" }));
    expect(() =>
      prepareCheckpointRollback(work, fixture.originalId, fixture.safetyId, {
        ...exact,
        expectedSafetyIdentity: `sha256:${"2".repeat(64)}`,
      }),
    ).toThrow(expect.objectContaining({ code: "CHECKPOINT_IDENTITY_STALE" }));
    expect(() =>
      prepareCheckpointRollback(work, fixture.originalId, fixture.safetyId, {
        ...exact,
        expectedSafetyPlanIdentity: `sha256:${"3".repeat(64)}`,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "CHECKPOINT_ROLLBACK_AUTHORITY_INVALID",
      }),
    );
    expect(() =>
      prepareCheckpointRollback(work, fixture.originalId, fixture.safetyId, {
        ...exact,
        originalMutationTargetCount: 2,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "CHECKPOINT_ROLLBACK_AUTHORITY_INVALID",
      }),
    );

    const prepared = prepareCheckpointRollback(
      work,
      fixture.originalId,
      fixture.safetyId,
      exact,
    );
    const forged = {
      ...prepared,
      expectedWorkspaceBinding: {
        ...prepared.expectedWorkspaceBinding,
        prestateIdentity: `sha256:${"4".repeat(64)}`,
      },
    };
    expect(() =>
      executeCheckpointRollback(work, forged, {
        root,
        workspaceLease: ownedLease(),
      }),
    ).toThrow(
      expect.objectContaining({ code: "CHECKPOINT_ROLLBACK_PLAN_STALE" }),
    );
  });

  it("copy rollback adapter rejects missing or tampered private authority", () => {
    const fixture = mixedRollbackResidue(0);
    const exact = {
      root,
      expectedOriginalIdentity: fixture.originalIdentity,
      expectedSafetyIdentity: fixture.safetyIdentity,
      expectedSafetyPlanIdentity: fixture.safetyPlanIdentity,
      originalMutationTargetCount: 3,
    };
    const { armPath } = findRestoreArm(
      root,
      fixture.safetyId,
      (arm) => arm.kind === "stage-forward" && arm.rel === "a.txt",
    );
    rmSync(armPath);
    expect(() =>
      prepareCheckpointRollback(
        work,
        fixture.originalId,
        fixture.safetyId,
        exact,
      ),
    ).toThrow(
      expect.objectContaining({ code: "CHECKPOINT_RECOVERY_REQUIRED" }),
    );

    const replacement = mixedRollbackResidue(0);
    const armed = findRestoreArm(
      root,
      replacement.safetyId,
      (arm) => arm.kind === "stage-forward" && arm.rel === "a.txt",
    );
    armed.arm.planIdentity = `sha256:${"5".repeat(64)}`;
    writeFileSync(armed.armPath, JSON.stringify(armed.arm, null, 2), "utf8");
    if (process.platform !== "win32") fs.chmodSync(armed.armPath, 0o600);
    expect(() =>
      prepareCheckpointRollback(
        work,
        replacement.originalId,
        replacement.safetyId,
        {
          root,
          expectedOriginalIdentity: replacement.originalIdentity,
          expectedSafetyIdentity: replacement.safetyIdentity,
          expectedSafetyPlanIdentity: replacement.safetyPlanIdentity,
          originalMutationTargetCount: 3,
        },
      ),
    ).toThrow(
      expect.objectContaining({ code: "CHECKPOINT_SAFETY_PLAN_INVALID" }),
    );
  });

  it("copy rollback adapter rejects an out-of-workspace safety mutation", () => {
    const fixture = mixedRollbackResidue(0);
    const manifestPath = join(root, `${fixture.safetyId}.json`);
    const safety = getCheckpoint(fixture.safetyId, { root });
    safety.restoreSafetyPlan.mutations[0].rel = "../escape.txt";
    writeFileSync(manifestPath, JSON.stringify(safety, null, 2), "utf8");
    if (process.platform !== "win32") fs.chmodSync(manifestPath, 0o600);

    expect(() =>
      prepareCheckpointRollback(work, fixture.originalId, fixture.safetyId, {
        root,
        expectedOriginalIdentity: fixture.originalIdentity,
        expectedSafetyIdentity: computeCheckpointIdentity(safety),
        expectedSafetyPlanIdentity: fixture.safetyPlanIdentity,
        originalMutationTargetCount: 3,
      }),
    ).toThrow(
      expect.objectContaining({ code: "CHECKPOINT_SAFETY_PLAN_INVALID" }),
    );
    expect(existsSync(join(work, "..", "escape.txt"))).toBe(false);
  });

  it("copy rollback adapter requires a synchronous owned lease and forbids hooks", () => {
    const fixture = mixedRollbackResidue(0);
    const prepared = prepareCheckpointRollback(
      work,
      fixture.originalId,
      fixture.safetyId,
      {
        root,
        expectedOriginalIdentity: fixture.originalIdentity,
        expectedSafetyIdentity: fixture.safetyIdentity,
        expectedSafetyPlanIdentity: fixture.safetyPlanIdentity,
        originalMutationTargetCount: 3,
      },
    );
    expect(() =>
      executeCheckpointRollback(work, prepared, {
        root,
        workspaceLease: { assertOwned: () => Promise.resolve() },
      }),
    ).toThrow(
      expect.objectContaining({ code: "CHECKPOINT_ROLLBACK_LEASE_INVALID" }),
    );
    expect(() =>
      executeCheckpointRollback(work, prepared, {
        root,
        workspaceLease: ownedLease(),
        onWorkspaceApplied: () => {},
      }),
    ).toThrow(
      expect.objectContaining({ code: "CHECKPOINT_ROLLBACK_PLAN_STALE" }),
    );
  });

  it.runIf(process.platform === "win32")(
    "secures every authority arm temp before its atomic publish",
    () => {
      const m = mk("acl-batch-count");
      writeFileSync(join(work, "a.txt"), "CHANGED-A", "utf8");
      const nativeRename = fs.renameSync.bind(fs);
      const publishedArmTemps = [];
      const rename = vi
        .spyOn(fs, "renameSync")
        .mockImplementation((source, destination) => {
          if (
            resolve(destination).startsWith(`${resolve(root)}\\`) &&
            resolve(destination).includes("\\.restore-safety-arms\\")
          ) {
            const resolvedSource = resolve(source);
            expect(
              privateAuthorityCalls.repairs.some((targets) =>
                targets.includes(resolvedSource),
              ),
            ).toBe(true);
            publishedArmTemps.push(resolvedSource);
          }
          return nativeRename(source, destination);
        });

      let restored;
      try {
        restored = restoreCheckpoint(m.id, {
          root,
          expectedIdentity: computeCheckpointIdentity(m),
        });
      } finally {
        rename.mockRestore();
      }

      expect(restored.safetyCoverage).toBe("full");
      expect(publishedArmTemps.length).toBeGreaterThan(0);
      const restoreAuthorityInspections =
        privateAuthorityCalls.inspections.filter((targets) =>
          targets.includes(resolve(root)),
        );
      expect(restoreAuthorityInspections).toHaveLength(1);
      expect(privateAuthorityCalls.repairs[0]).toEqual([resolve(root)]);
      expect(
        privateAuthorityCalls.repairs.some((targets) =>
          targets.includes(resolve(root)),
        ),
      ).toBe(true);
      expect(restoreAuthorityInspections[0]).toContain(resolve(root));
    },
  );

  it("attaches an immutable safety snapshot when a restore partially writes", () => {
    const m = mk("partial");
    const expectedIdentity = computeCheckpointIdentity(m);
    rmSync(join(work, "a.txt"));
    writeFileSync(join(work, "b.txt"), "CHANGED-B", "utf-8");
    const blockedTarget = join(work, "b.txt");
    const renameSync = fs.renameSync.bind(fs);
    const rename = vi
      .spyOn(fs, "renameSync")
      .mockImplementation((source, target) => {
        if (String(target) === blockedTarget) {
          const error = new Error("injected second-file rename failure");
          error.code = "INJECTED_RESTORE_WRITE_FAILURE";
          throw error;
        }
        return renameSync(source, target);
      });

    let thrown = null;
    try {
      restoreCheckpoint(m.id, { root, expectedIdentity });
    } catch (error) {
      thrown = error;
    } finally {
      rename.mockRestore();
    }

    expect(thrown).toMatchObject({
      code: "INJECTED_RESTORE_WRITE_FAILURE",
      restorePhase: "workspace-mutation",
      safetyId: expect.any(String),
      safetyIdentity: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      safetyPlanIdentity: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      safetyCoverage: "full",
      createdPaths: ["a.txt"],
    });
    expect(readFileSync(join(work, "a.txt"), "utf-8")).toBe("ORIGINAL-A");
    expect(readFileSync(join(work, "b.txt"), "utf-8")).toBe("CHANGED-B");
    expect(
      computeCheckpointIdentity(getCheckpoint(thrown.safetyId, { root })),
    ).toBe(thrown.safetyIdentity);

    restoreCheckpoint(thrown.safetyId, {
      root,
      expectedIdentity: thrown.safetyIdentity,
      skipSafety: true,
    });
    expect(existsSync(join(work, "a.txt"))).toBe(false);
    expect(readFileSync(join(work, "b.txt"), "utf-8")).toBe("CHANGED-B");
  });

  it("reports only missing paths whose atomic restore write completed", () => {
    const m = mk("partial-created-paths");
    const expectedIdentity = computeCheckpointIdentity(m);
    rmSync(join(work, "a.txt"));
    rmSync(join(work, "b.txt"));
    const blockedTarget = join(work, "b.txt");
    const renameSync = fs.renameSync.bind(fs);
    const rename = vi
      .spyOn(fs, "renameSync")
      .mockImplementation((source, target) => {
        if (String(target) === blockedTarget) {
          const error = new Error(
            "injected second-created-file rename failure",
          );
          error.code = "INJECTED_RESTORE_WRITE_FAILURE";
          throw error;
        }
        return renameSync(source, target);
      });

    let thrown = null;
    try {
      restoreCheckpoint(m.id, { root, expectedIdentity });
    } catch (error) {
      thrown = error;
    } finally {
      rename.mockRestore();
    }

    expect(thrown).toMatchObject({
      code: "INJECTED_RESTORE_WRITE_FAILURE",
      restorePhase: "workspace-mutation",
      safetyId: expect.any(String),
      safetyIdentity: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      safetyPlanIdentity: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      safetyCoverage: "full",
      createdPaths: ["a.txt"],
    });
    expect(readFileSync(join(work, "a.txt"), "utf-8")).toBe("ORIGINAL-A");
    expect(existsSync(join(work, "b.txt"))).toBe(false);

    restoreCheckpoint(thrown.safetyId, {
      root,
      expectedIdentity: thrown.safetyIdentity,
      expectedSafetyPlanIdentity: thrown.safetyPlanIdentity,
      skipSafety: true,
    });
    expect(existsSync(join(work, "a.txt"))).toBe(false);
    expect(existsSync(join(work, "b.txt"))).toBe(false);
  });

  it("durably arms a stable safety plan before publish and recovers a post-rename crash", () => {
    const m = mk("kill-after-publish");
    const expectedIdentity = computeCheckpointIdentity(m);
    const target = join(work, "a.txt");
    rmSync(target);
    const events = [];
    let ready = null;
    const renameSync = fs.renameSync.bind(fs);
    const rename = vi
      .spyOn(fs, "renameSync")
      .mockImplementation((source, destination) => {
        if (String(destination) === target) {
          renameSync(source, destination);
          const error = new Error("simulated kill after target rename");
          error.code = "INJECTED_POST_RENAME_KILL";
          throw error;
        }
        return renameSync(source, destination);
      });

    let thrown;
    try {
      restoreCheckpoint(m.id, {
        root,
        expectedIdentity,
        onSafetyReady: (evidence) => {
          events.push("safety-ready");
          ready = evidence;
          expect(existsSync(target)).toBe(false);
        },
        onMutationStarted: () => {
          events.push("mutation-started");
          expect(existsSync(target)).toBe(false);
        },
      });
    } catch (error) {
      thrown = error;
    } finally {
      rename.mockRestore();
    }

    expect(events).toEqual(["safety-ready", "mutation-started"]);
    expect(thrown).toMatchObject({
      code: "INJECTED_POST_RENAME_KILL",
      safetyId: ready.safetyId,
      safetyIdentity: ready.safetyIdentity,
      safetyPlanIdentity: ready.safetyPlanIdentity,
      safetyCoverage: "full",
      createdPaths: ["a.txt"],
      safetyEvidence: {
        checkpointIdentity: ready.safetyIdentity,
        planIdentity: ready.safetyPlanIdentity,
        tombstones: [{ rel: "a.txt", state: "armed" }],
      },
    });
    expect(
      computeCheckpointIdentity(getCheckpoint(ready.safetyId, { root })),
    ).toBe(ready.safetyIdentity);
    expect(readFileSync(target, "utf8")).toBe("ORIGINAL-A");

    restoreCheckpoint(ready.safetyId, {
      root,
      expectedIdentity: ready.safetyIdentity,
      expectedSafetyPlanIdentity: ready.safetyPlanIdentity,
      skipSafety: true,
    });
    expect(existsSync(target)).toBe(false);
  });

  it("keeps an armed tombstone recoverable when failure happens before target rename", () => {
    const m = mk("kill-before-publish");
    const target = join(work, "a.txt");
    rmSync(target);
    const renameSync = fs.renameSync.bind(fs);
    const rename = vi
      .spyOn(fs, "renameSync")
      .mockImplementation((source, destination) => {
        if (String(destination) === target) {
          const error = new Error("simulated kill before target rename");
          error.code = "INJECTED_PRE_RENAME_KILL";
          throw error;
        }
        return renameSync(source, destination);
      });

    let thrown;
    try {
      restoreCheckpoint(m.id, {
        root,
        expectedIdentity: computeCheckpointIdentity(m),
      });
    } catch (error) {
      thrown = error;
    } finally {
      rename.mockRestore();
    }

    expect(thrown).toMatchObject({
      code: "INJECTED_PRE_RENAME_KILL",
      safetyCoverage: "full",
      createdPaths: [],
      safetyEvidence: {
        tombstones: [{ rel: "a.txt", state: "armed" }],
      },
    });
    expect(existsSync(target)).toBe(false);
    expect(() =>
      restoreCheckpoint(thrown.safetyId, {
        root,
        expectedIdentity: thrown.safetyIdentity,
        expectedSafetyPlanIdentity: thrown.safetyPlanIdentity,
        skipSafety: true,
      }),
    ).not.toThrow();
  });

  it("fails closed when a planned stage is created but cannot be armed", () => {
    const m = mk("stage-before-arm");
    const target = join(work, "a.txt");
    rmSync(target);
    const writeFile = fs.writeFileSync.bind(fs);
    const write = vi
      .spyOn(fs, "writeFileSync")
      .mockImplementation((file, data, options) => {
        const result = writeFile(file, data, options);
        if (String(file).endsWith(".forward.stage")) {
          const error = new Error("simulated kill after stage create");
          error.code = "INJECTED_STAGE_PRE_ARM_KILL";
          throw error;
        }
        return result;
      });

    let thrown;
    try {
      restoreCheckpoint(m.id, {
        root,
        expectedIdentity: computeCheckpointIdentity(m),
      });
    } catch (error) {
      thrown = error;
    } finally {
      write.mockRestore();
    }

    expect(thrown).toMatchObject({
      code: "INJECTED_STAGE_PRE_ARM_KILL",
      safetyCoverage: "unknown",
      safetyEvidence: {
        durable: false,
        validationError: { code: "CHECKPOINT_RECOVERY_REQUIRED" },
      },
    });
    expect(existsSync(target)).toBe(false);
    const safety = getCheckpoint(thrown.safetyId, { root });
    const stageRel = safety.restoreSafetyPlan.mutations[0].forwardStagingRel;
    expect(existsSync(join(root, safety.id, stageRel))).toBe(true);
    expect(() =>
      restoreCheckpoint(safety.id, {
        root,
        expectedIdentity: thrown.safetyIdentity,
        expectedSafetyPlanIdentity: thrown.safetyPlanIdentity,
        skipSafety: true,
      }),
    ).toThrow(
      expect.objectContaining({ code: "CHECKPOINT_RECOVERY_REQUIRED" }),
    );
    expect(existsSync(target)).toBe(false);
  });

  it("never deletes a same-content successor", () => {
    const m = mk("successor");
    const target = join(work, "a.txt");
    const predecessor = join(work, "predecessor-a.txt");
    const lifecycle = [];
    rmSync(target);
    const restored = restoreCheckpoint(m.id, {
      root,
      expectedIdentity: computeCheckpointIdentity(m),
      onTargetPublished: ({ rel, operation }) => {
        lifecycle.push(`${operation}:${rel}`);
        expect(readFileSync(target, "utf8")).toBe("ORIGINAL-A");
      },
      onWorkspaceApplied: ({ createdPaths, mutationCount, appliedCount }) => {
        lifecycle.push("workspace-applied");
        expect(createdPaths).toEqual(["a.txt"]);
        expect(mutationCount).toBe(1);
        expect(appliedCount).toBe(1);
      },
    });
    expect(lifecycle).toEqual(["write:a.txt", "workspace-applied"]);
    renameSync(target, predecessor);
    writeFileSync(target, "ORIGINAL-A", "utf8");

    expect(() =>
      restoreCheckpoint(restored.safetyId, {
        root,
        expectedIdentity: restored.safetyIdentity,
        expectedSafetyPlanIdentity: restored.safetyPlanIdentity,
        skipSafety: true,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "CHECKPOINT_TOMBSTONE_IDENTITY_MISMATCH",
        path: "a.txt",
      }),
    );
    expect(readFileSync(target, "utf8")).toBe("ORIGINAL-A");
    expect(readFileSync(predecessor, "utf8")).toBe("ORIGINAL-A");
  });

  it("quarantines but never unlinks a same-content successor injected at delete", () => {
    const m = mk("successor-at-delete");
    const target = join(work, "a.txt");
    const predecessor = join(work, "predecessor-at-delete.txt");
    rmSync(target);
    const restored = restoreCheckpoint(m.id, {
      root,
      expectedIdentity: computeCheckpointIdentity(m),
    });
    const safety = getCheckpoint(restored.safetyId, { root });
    const mutation = safety.restoreSafetyPlan.mutations.find(
      (entry) => entry.rel === "a.txt",
    );
    const quarantine = join(root, safety.id, mutation.quarantineRel);
    const renameFile = fs.renameSync.bind(fs);
    const rename = vi
      .spyOn(fs, "renameSync")
      .mockImplementation((source, destination) => {
        if (String(source) === target && String(destination) === quarantine) {
          renameFile(target, predecessor);
          writeFileSync(target, "ORIGINAL-A", "utf8");
        }
        return renameFile(source, destination);
      });

    try {
      expect(() =>
        restoreCheckpoint(restored.safetyId, {
          root,
          expectedIdentity: restored.safetyIdentity,
          expectedSafetyPlanIdentity: restored.safetyPlanIdentity,
          skipSafety: true,
        }),
      ).toThrow(
        expect.objectContaining({
          code: "CHECKPOINT_RECOVERY_REQUIRED",
          quarantineRel: mutation.quarantineRel,
        }),
      );
    } finally {
      rename.mockRestore();
    }

    expect(existsSync(target)).toBe(false);
    expect(readFileSync(predecessor, "utf8")).toBe("ORIGINAL-A");
    expect(readFileSync(quarantine, "utf8")).toBe("ORIGINAL-A");
  });

  it("ignores changed non-authoritative trash after interruption", () => {
    const m = mk("post-quarantine-rename");
    const target = join(work, "a.txt");
    rmSync(target);
    const restored = restoreCheckpoint(m.id, {
      root,
      expectedIdentity: computeCheckpointIdentity(m),
    });
    const safety = getCheckpoint(restored.safetyId, { root });
    const mutation = safety.restoreSafetyPlan.mutations.find(
      (entry) => entry.rel === "a.txt",
    );
    const quarantine = join(root, safety.id, mutation.quarantineRel);
    const renameFile = fs.renameSync.bind(fs);
    const rename = vi
      .spyOn(fs, "renameSync")
      .mockImplementation((source, destination) => {
        if (String(source) === target && String(destination) === quarantine) {
          renameFile(source, destination);
          const error = new Error("simulated kill after quarantine rename");
          error.code = "INJECTED_POST_QUARANTINE_RENAME_KILL";
          throw error;
        }
        return renameFile(source, destination);
      });

    let thrown;
    try {
      restoreCheckpoint(restored.safetyId, {
        root,
        expectedIdentity: restored.safetyIdentity,
        expectedSafetyPlanIdentity: restored.safetyPlanIdentity,
        skipSafety: true,
      });
    } catch (error) {
      thrown = error;
    } finally {
      rename.mockRestore();
    }

    expect(thrown).toMatchObject({
      code: "INJECTED_POST_QUARANTINE_RENAME_KILL",
      safetyCoverage: "full",
      safetyEvidence: {
        durable: true,
        quarantinePolicy: "non-authoritative-trash/v1",
        mutations: [
          expect.objectContaining({
            rel: "a.txt",
            quarantineRel: mutation.quarantineRel,
            quarantineState: "untrusted-trash-present",
          }),
        ],
      },
    });
    expect(existsSync(target)).toBe(false);
    expect(readFileSync(quarantine, "utf8")).toBe("ORIGINAL-A");
    writeFileSync(quarantine, "ATTACKER-CONTROLLED-TRASH", "utf8");

    const recovered = restoreCheckpoint(restored.safetyId, {
      root,
      expectedIdentity: restored.safetyIdentity,
      expectedSafetyPlanIdentity: restored.safetyPlanIdentity,
      skipSafety: true,
    });
    expect(recovered.unchanged).toContain("a.txt");
    expect(recovered.retainedQuarantines).toEqual([]);
    expect(recovered.safetyEvidence).toMatchObject({
      durable: true,
      quarantinePolicy: "non-authoritative-trash/v1",
    });
    expect(existsSync(target)).toBe(false);
    expect(readFileSync(quarantine, "utf8")).toBe("ATTACKER-CONTROLLED-TRASH");
  });

  it.each([
    ["corrupt", () => Buffer.from("not-json")],
    ["oversized", () => Buffer.alloc(70 * 1024, 0x61)],
  ])("fails closed on a %s tombstone arm", (_label, replacement) => {
    const m = mk("bad-arm");
    const target = join(work, "a.txt");
    rmSync(target);
    const restored = restoreCheckpoint(m.id, {
      root,
      expectedIdentity: computeCheckpointIdentity(m),
    });
    const armDir = join(root, restored.safetyId, ".restore-safety-arms");
    const armPath = join(
      armDir,
      readdirSync(armDir).find((name) => name.endsWith(".json")),
    );
    writeFileSync(armPath, replacement());
    if (process.platform !== "win32") fs.chmodSync(armPath, 0o600);

    expect(() =>
      restoreCheckpoint(restored.safetyId, {
        root,
        expectedIdentity: restored.safetyIdentity,
        expectedSafetyPlanIdentity: restored.safetyPlanIdentity,
        skipSafety: true,
      }),
    ).toThrow(
      expect.objectContaining({ code: "CHECKPOINT_SAFETY_PLAN_INVALID" }),
    );
    expect(readFileSync(target, "utf8")).toBe("ORIGINAL-A");
  });

  it.runIf(process.platform !== "win32")(
    "fails closed on a symlinked tombstone arm",
    () => {
      const m = mk("symlink-arm");
      const target = join(work, "a.txt");
      rmSync(target);
      const restored = restoreCheckpoint(m.id, {
        root,
        expectedIdentity: computeCheckpointIdentity(m),
      });
      const armDir = join(root, restored.safetyId, ".restore-safety-arms");
      const armPath = join(
        armDir,
        readdirSync(armDir).find((name) => name.endsWith(".json")),
      );
      const outside = join(work, "outside-arm.json");
      writeFileSync(outside, readFileSync(armPath));
      rmSync(armPath);
      symlinkSync(outside, armPath, "file");

      expect(() =>
        restoreCheckpoint(restored.safetyId, {
          root,
          expectedIdentity: restored.safetyIdentity,
          expectedSafetyPlanIdentity: restored.safetyPlanIdentity,
          skipSafety: true,
        }),
      ).toThrow(
        expect.objectContaining({ code: "CHECKPOINT_SAFETY_PLAN_INVALID" }),
      );
      expect(readFileSync(target, "utf8")).toBe("ORIGINAL-A");
    },
  );

  it("fails closed when a published create loses its tombstone arm", () => {
    const m = mk("lost-monotonic-tombstone-arm");
    const targetA = join(work, "a.txt");
    const targetB = join(work, "b.txt");
    rmSync(targetA);
    rmSync(targetB);
    let safetyId;
    let thrown;

    try {
      restoreCheckpoint(m.id, {
        root,
        expectedIdentity: computeCheckpointIdentity(m),
        onSafetyReady: (evidence) => {
          safetyId = evidence.safetyId;
        },
        onTargetPublished: ({ index, rel }) => {
          if (index !== 0) return;
          expect(rel).toBe("a.txt");
          const { armPath } = findRestoreArm(
            root,
            safetyId,
            (arm) => arm.kind === "tombstone" && arm.rel === "a.txt",
          );
          rmSync(armPath);
        },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: "CHECKPOINT_RECOVERY_REQUIRED",
      restorePhase: "workspace-mutation",
      safetyCoverage: "unknown",
      createdPaths: ["a.txt"],
      safetyEvidence: {
        durable: false,
        validationError: { code: "CHECKPOINT_RECOVERY_REQUIRED" },
      },
    });
    expect(readFileSync(targetA, "utf8")).toBe("ORIGINAL-A");
    expect(existsSync(targetB)).toBe(false);
  });

  it("rejects a replacement namespace even when its arm is synchronously rewritten", () => {
    const m = mk("replacement-namespace-and-arm");
    const target = join(work, "a.txt");
    writeFileSync(target, "CHANGED-A", "utf8");

    expect(() =>
      restoreCheckpoint(m.id, {
        root,
        expectedIdentity: computeCheckpointIdentity(m),
        onMutationStarted: ({ safetyId }) => {
          const safety = getCheckpoint(safetyId, { root });
          const namespacePath = resolve(
            root,
            safetyId,
            ...safety.restoreSafetyPlan.namespace.rel.split("/"),
          );
          renameSync(namespacePath, `${namespacePath}.predecessor`);
          mkdirSync(namespacePath, { mode: 0o700 });
          if (process.platform !== "win32") fs.chmodSync(namespacePath, 0o700);

          const { arm, armPath } = findRestoreArm(
            root,
            safetyId,
            (candidate) => candidate.kind === "namespace",
          );
          arm.objectIdentity = filesystemObjectIdentity(
            fs.lstatSync(namespacePath, { bigint: true }),
          );
          writeFileSync(armPath, JSON.stringify(arm, null, 2), "utf8");
          if (process.platform !== "win32") fs.chmodSync(armPath, 0o600);
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: "CHECKPOINT_SAFETY_PLAN_INVALID",
        safetyCoverage: "unknown",
      }),
    );
    expect(readFileSync(target, "utf8")).toBe("CHANGED-A");
    expect(readFileSync(join(work, "b.txt"), "utf8")).toBe("ORIGINAL-B");
  });

  it("revalidates complete workspace identity after onWorkspaceApplied", () => {
    const m = mk("workspace-applied-successor");
    const target = join(work, "a.txt");
    const predecessor = join(work, "restored-a-predecessor.txt");
    writeFileSync(target, "CHANGED-A", "utf8");
    let thrown;

    try {
      restoreCheckpoint(m.id, {
        root,
        expectedIdentity: computeCheckpointIdentity(m),
        onWorkspaceApplied: () => {
          renameSync(target, predecessor);
          writeFileSync(target, "ORIGINAL-A", "utf8");
        },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: "CHECKPOINT_RECOVERY_REQUIRED",
      restorePhase: "workspace-applied",
      safetyCoverage: "unknown",
      createdPaths: [],
    });
    expect(readFileSync(target, "utf8")).toBe("ORIGINAL-A");
    expect(readFileSync(predecessor, "utf8")).toBe("ORIGINAL-A");
  });

  it.runIf(process.platform === "win32")(
    "repairs an Everyone:F safety root before reporting full coverage",
    () => {
      const fileCheckpointUrl = new URL(
        "../../src/lib/file-checkpoint.js",
        import.meta.url,
      ).href;
      const secureFsUrl = new URL("../../src/lib/secure-fs.js", import.meta.url)
        .href;
      const script = `
        import fs from "node:fs";
        import { spawnSync } from "node:child_process";
        const { createCheckpoint, computeCheckpointIdentity, getCheckpoint, restoreCheckpoint } = await import(${JSON.stringify(fileCheckpointUrl)});
        const { inspectPrivatePaths } = await import(${JSON.stringify(secureFsUrl)});
        const [work, root] = process.argv.slice(1);
        const a = work + "\\\\a.txt";
        const b = work + "\\\\b.txt";
        fs.writeFileSync(a, "ORIGINAL-A", "utf8");
        fs.writeFileSync(b, "ORIGINAL-B", "utf8");
        const checkpoint = createCheckpoint([a, b], { cwd: work, root });
        fs.writeFileSync(a, "CHANGED-A", "utf8");
        const grant = spawnSync("icacls.exe", [root, "/inheritance:e", "/grant", "*S-1-1-0:(OI)(CI)F"], { encoding: "utf8", windowsHide: true });
        let outcome;
        try {
          const restored = restoreCheckpoint(checkpoint.id, { root, expectedIdentity: computeCheckpointIdentity(checkpoint) });
          outcome = { ok: true, safetyCoverage: restored.safetyCoverage, safetyId: restored.safetyId };
        } catch (error) {
          outcome = { ok: false, code: error?.code || null, message: error?.message || String(error), safetyCoverage: error?.safetyCoverage || null };
        }
        const after = inspectPrivatePaths([root])[0];
        let armInspections = [];
        if (outcome.ok) {
          const safety = getCheckpoint(outcome.safetyId, { root });
          const armDir = root + "\\\\" + safety.id + "\\\\.restore-safety-arms";
          armInspections = inspectPrivatePaths(
            fs.readdirSync(armDir).map((name) => armDir + "\\\\" + name),
          );
        }
        console.log("ACL_RESULT:" + JSON.stringify({ grantStatus: grant.status, grantError: grant.error?.message || null, after, armInspections, outcome, content: fs.readFileSync(a, "utf8") }));
      `;
      const child = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", script, work, root],
        {
          cwd: resolve("."),
          encoding: "utf8",
          windowsHide: true,
          timeout: 180_000,
          maxBuffer: 4 * 1024 * 1024,
        },
      );
      expect(child.error).toBeUndefined();
      expect(child.status, child.stderr).toBe(0);
      const marker = String(child.stdout)
        .split(/\r?\n/u)
        .find((line) => line.startsWith("ACL_RESULT:"));
      expect(marker, child.stderr).toBeTruthy();
      const result = JSON.parse(marker.slice("ACL_RESULT:".length));
      expect(result.grantStatus, result.grantError).toBe(0);
      expect(result.outcome).toMatchObject({
        ok: true,
        safetyCoverage: "full",
        safetyId: expect.any(String),
      });
      expect(result.after).toMatchObject({ exists: true, ok: true });
      expect(result.armInspections.length).toBeGreaterThan(0);
      for (const inspection of result.armInspections) {
        expect(inspection).toMatchObject({
          exists: true,
          ok: true,
          details: {
            ownerSid: expect.any(String),
            currentSid: expect.any(String),
            protected: true,
          },
        });
        expect(inspection.details.ownerSid).toBe(inspection.details.currentSid);
      }
      expect(result.content).toBe("ORIGINAL-A");
    },
    200_000,
  );

  it.runIf(process.platform === "win32")(
    "recovers in a fresh process after an Everyone:F target is hard-stopped post-rename",
    () => {
      const fileCheckpointUrl = new URL(
        "../../src/lib/file-checkpoint.js",
        import.meta.url,
      ).href;
      const secureFsUrl = new URL("../../src/lib/secure-fs.js", import.meta.url)
        .href;
      const setupScript = `
        import fs from "node:fs";
        import path from "node:path";
        const { createCheckpoint, computeCheckpointIdentity, getCheckpoint, restoreCheckpoint } = await import(${JSON.stringify(fileCheckpointUrl)});
        const [work, root] = process.argv.slice(1);
        const target = path.join(work, "a.txt");
        const other = path.join(work, "b.txt");
        fs.writeFileSync(target, "ORIGINAL-A", "utf8");
        fs.writeFileSync(other, "ORIGINAL-B", "utf8");
        const source = createCheckpoint([target, other], { cwd: work, root });
        fs.rmSync(target);
        const restored = restoreCheckpoint(source.id, { root, expectedIdentity: computeCheckpointIdentity(source) });
        const safety = getCheckpoint(restored.safetyId, { root });
        const mutation = safety.restoreSafetyPlan.mutations.find((entry) => entry.rel === "a.txt");
        console.log("SETUP_RESULT:" + JSON.stringify({
          safetyId: restored.safetyId,
          safetyIdentity: restored.safetyIdentity,
          safetyPlanIdentity: restored.safetyPlanIdentity,
          target,
          trash: path.join(root, restored.safetyId, ...mutation.quarantineRel.split("/"))
        }));
      `;
      const setup = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", setupScript, work, root],
        {
          cwd: resolve("."),
          encoding: "utf8",
          windowsHide: true,
          timeout: 120_000,
          maxBuffer: 4 * 1024 * 1024,
        },
      );
      expect(setup.error).toBeUndefined();
      expect(setup.status, setup.stderr).toBe(0);
      const setupMarker = String(setup.stdout)
        .split(/\r?\n/u)
        .find((line) => line.startsWith("SETUP_RESULT:"));
      expect(setupMarker, setup.stderr).toBeTruthy();
      const prepared = JSON.parse(setupMarker.slice("SETUP_RESULT:".length));

      const grant = spawnSync(
        "icacls.exe",
        [prepared.target, "/inheritance:e", "/grant", "*S-1-1-0:F"],
        { encoding: "utf8", windowsHide: true },
      );
      expect(grant.error).toBeUndefined();
      expect(grant.status, grant.stderr).toBe(0);

      const hardStopMarker = join(work, "..", "post-rename-hard-stop.marker");
      const hardStopScript = `
        import fs from "node:fs";
        import path from "node:path";
        const { restoreCheckpoint } = await import(${JSON.stringify(fileCheckpointUrl)});
        const [root, safetyId, safetyIdentity, safetyPlanIdentity, target, trash, marker] = process.argv.slice(1);
        const nativeRename = fs.renameSync.bind(fs);
        fs.renameSync = (source, destination) => {
          const result = nativeRename(source, destination);
          if (path.resolve(source) === path.resolve(target) && path.resolve(destination) === path.resolve(trash)) {
            fs.writeFileSync(marker, "renamed", { encoding: "utf8", flush: true });
            process.kill(process.pid, "SIGKILL");
            process.abort();
          }
          return result;
        };
        restoreCheckpoint(safetyId, { root, expectedIdentity: safetyIdentity, expectedSafetyPlanIdentity: safetyPlanIdentity, skipSafety: true });
      `;
      const hardStop = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          hardStopScript,
          root,
          prepared.safetyId,
          prepared.safetyIdentity,
          prepared.safetyPlanIdentity,
          prepared.target,
          prepared.trash,
          hardStopMarker,
        ],
        {
          cwd: resolve("."),
          encoding: "utf8",
          windowsHide: true,
          timeout: 60_000,
          maxBuffer: 4 * 1024 * 1024,
        },
      );
      expect(hardStop.error).toBeUndefined();
      expect(hardStop.status).not.toBe(0);
      expect(existsSync(hardStopMarker)).toBe(true);
      expect(existsSync(prepared.target)).toBe(false);
      expect(existsSync(prepared.trash)).toBe(true);

      const recoveryScript = `
        import fs from "node:fs";
        const { restoreCheckpoint } = await import(${JSON.stringify(fileCheckpointUrl)});
        const { inspectPrivatePaths } = await import(${JSON.stringify(secureFsUrl)});
        const [root, safetyId, safetyIdentity, safetyPlanIdentity, target, trash] = process.argv.slice(1);
        const trashInspection = inspectPrivatePaths([trash])[0];
        fs.writeFileSync(trash, "ATTACKER-CONTROLLED-TRASH", "utf8");
        const recovered = restoreCheckpoint(safetyId, { root, expectedIdentity: safetyIdentity, expectedSafetyPlanIdentity: safetyPlanIdentity, skipSafety: true });
        console.log("RECOVERY_RESULT:" + JSON.stringify({
          trashInspection,
          safetyCoverage: recovered.safetyCoverage,
          safetyEvidence: recovered.safetyEvidence,
          targetExists: fs.existsSync(target),
          trashContent: fs.readFileSync(trash, "utf8")
        }));
      `;
      const recovery = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          recoveryScript,
          root,
          prepared.safetyId,
          prepared.safetyIdentity,
          prepared.safetyPlanIdentity,
          prepared.target,
          prepared.trash,
        ],
        {
          cwd: resolve("."),
          encoding: "utf8",
          windowsHide: true,
          timeout: 120_000,
          maxBuffer: 4 * 1024 * 1024,
        },
      );
      expect(recovery.error).toBeUndefined();
      expect(recovery.status, recovery.stderr).toBe(0);
      const recoveryMarker = String(recovery.stdout)
        .split(/\r?\n/u)
        .find((line) => line.startsWith("RECOVERY_RESULT:"));
      expect(recoveryMarker, recovery.stderr).toBeTruthy();
      const result = JSON.parse(
        recoveryMarker.slice("RECOVERY_RESULT:".length),
      );
      expect(result.trashInspection).toMatchObject({ exists: true, ok: false });
      expect(result).toMatchObject({
        safetyCoverage: "full",
        safetyEvidence: {
          durable: true,
          quarantinePolicy: "non-authoritative-trash/v1",
        },
        targetExists: false,
        trashContent: "ATTACKER-CONTROLLED-TRASH",
      });
    },
    300_000,
  );

  it.each(["onSafetyReady", "onMutationStarted"])(
    "%s failure leaves the workspace untouched",
    (hookName) => {
      const m = mk(`hook-${hookName}`);
      const target = join(work, "a.txt");
      rmSync(target);
      const error = new Error(`blocked by ${hookName}`);
      error.code = "INJECTED_HOOK_FAILURE";

      expect(() =>
        restoreCheckpoint(m.id, {
          root,
          expectedIdentity: computeCheckpointIdentity(m),
          [hookName]: () => {
            expect(existsSync(target)).toBe(false);
            throw error;
          },
        }),
      ).toThrow(
        expect.objectContaining({
          code: "INJECTED_HOOK_FAILURE",
          restorePhase: "safety-ready",
          safetyCoverage: "full",
        }),
      );
      expect(existsSync(target)).toBe(false);
    },
  );

  it("revalidates the durable manifest after onMutationStarted returns", () => {
    const m = mk("mutation-hook-manifest-loss");
    const target = join(work, "a.txt");
    rmSync(target);

    expect(() =>
      restoreCheckpoint(m.id, {
        root,
        expectedIdentity: computeCheckpointIdentity(m),
        onMutationStarted: ({ safetyId }) => {
          rmSync(join(root, `${safetyId}.json`));
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: "CHECKPOINT_RECOVERY_REQUIRED",
        safetyCoverage: "unknown",
      }),
    );
    expect(existsSync(target)).toBe(false);
    expect(readFileSync(join(work, "b.txt"), "utf8")).toBe("ORIGINAL-B");
  });

  it("stops before the next target when onTargetPublished removes safety", () => {
    const m = mk("published-hook-manifest-loss");
    writeFileSync(join(work, "a.txt"), "CHANGED-A", "utf8");
    writeFileSync(join(work, "b.txt"), "CHANGED-B", "utf8");
    let safetyId;

    expect(() =>
      restoreCheckpoint(m.id, {
        root,
        expectedIdentity: computeCheckpointIdentity(m),
        onSafetyReady: (evidence) => {
          safetyId = evidence.safetyId;
        },
        onTargetPublished: ({ index }) => {
          if (index === 0) rmSync(join(root, `${safetyId}.json`));
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: "CHECKPOINT_RECOVERY_REQUIRED",
        safetyCoverage: "unknown",
        createdPaths: [],
      }),
    );
    expect(readFileSync(join(work, "a.txt"), "utf8")).toBe("ORIGINAL-A");
    expect(readFileSync(join(work, "b.txt"), "utf8")).toBe("CHANGED-B");
  });

  it("fails closed when the final onTargetPublished removes safety", () => {
    const m = mk("final-published-hook-manifest-loss");
    writeFileSync(join(work, "a.txt"), "CHANGED-A", "utf8");
    let safetyId;

    expect(() =>
      restoreCheckpoint(m.id, {
        root,
        expectedIdentity: computeCheckpointIdentity(m),
        onSafetyReady: (evidence) => {
          safetyId = evidence.safetyId;
        },
        onTargetPublished: () => {
          rmSync(join(root, `${safetyId}.json`));
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: "CHECKPOINT_RECOVERY_REQUIRED",
        safetyCoverage: "unknown",
      }),
    );
    expect(readFileSync(join(work, "a.txt"), "utf8")).toBe("ORIGINAL-A");
    expect(readFileSync(join(work, "b.txt"), "utf8")).toBe("ORIGINAL-B");
  });

  it.each([
    ["async", async () => {}],
    ["thenable", () => ({ then: () => {} })],
  ])("rejects an %s safety hook before workspace writes", (_label, hook) => {
    const m = mk("invalid-hook");
    const target = join(work, "a.txt");
    rmSync(target);
    expect(() =>
      restoreCheckpoint(m.id, {
        root,
        expectedIdentity: computeCheckpointIdentity(m),
        onSafetyReady: hook,
      }),
    ).toThrow(
      expect.objectContaining({ code: "CHECKPOINT_RESTORE_HOOK_INVALID" }),
    );
    expect(existsSync(target)).toBe(false);
  });

  it("fails closed instead of creating an untracked parent directory", () => {
    mkdirSync(join(work, "nested"));
    writeFileSync(join(work, "nested", "c.txt"), "ORIGINAL-C", "utf8");
    const m = createCheckpoint(["nested/c.txt"], { cwd: work, root });
    rmSync(join(work, "nested"), { recursive: true });

    expect(() =>
      restoreCheckpoint(m.id, {
        root,
        expectedIdentity: computeCheckpointIdentity(m),
      }),
    ).toThrow(
      expect.objectContaining({
        code: "CHECKPOINT_SAFETY_PARENT_CREATION_UNSUPPORTED",
      }),
    );
    expect(existsSync(join(work, "nested"))).toBe(false);
  });

  it("rejects a checkpoint safety store that overlaps the workspace", () => {
    const overlappingRoot = join(work, "checkpoint-store");
    const m = createCheckpoint(["a.txt"], {
      cwd: work,
      root: overlappingRoot,
    });
    writeFileSync(join(work, "a.txt"), "CHANGED-A", "utf8");
    const before = readdirSync(overlappingRoot).sort();

    expect(() =>
      restoreCheckpoint(m.id, {
        root: overlappingRoot,
        expectedIdentity: computeCheckpointIdentity(m),
      }),
    ).toThrow(
      expect.objectContaining({ code: "CHECKPOINT_SAFETY_STORE_OVERLAP" }),
    );
    expect(readdirSync(overlappingRoot).sort()).toEqual(before);
    expect(readFileSync(join(work, "a.txt"), "utf8")).toBe("CHANGED-A");
  });

  it("delete removes manifest + blobs", () => {
    const m = mk();
    expect(deleteCheckpoint(m.id, retentionOptions())).toBe(true);
    expect(getCheckpoint(m.id, { root })).toBeNull();
    expect(deleteCheckpoint(m.id, retentionOptions())).toBe(false); // already gone
  });

  it("keeps the maintenance lock disjoint from create, delete, and clear ids", () => {
    const legacyLockId = ".copy-checkpoint-store-maintenance.lock";
    const first = createCheckpoint(["a.txt"], {
      cwd: work,
      root,
      id: legacyLockId,
      label: "legacy-lock-name",
    });
    expect(existsSync(join(root, first.id, first.files[0].sha256))).toBe(true);
    expect(deleteCheckpoint(first.id, retentionOptions())).toBe(true);
    expect(getCheckpoint(first.id, { root })).toBeNull();

    const recreated = createCheckpoint(["a.txt"], {
      cwd: work,
      root,
      id: legacyLockId,
      label: "legacy-lock-name-recreated",
    });
    const ordinary = mk("ordinary");
    expect(clearCheckpoints(retentionOptions())).toBe(2);
    expect(getCheckpoint(recreated.id, { root })).toBeNull();
    expect(getCheckpoint(ordinary.id, { root })).toBeNull();
  });

  it("bootstraps one root-bound owner authority and keeps clear outside it", () => {
    const checkpoint = mk("authority-bootstrap");
    const canonicalRoot = realpathSync.native(root);
    const authorityDir = join(root, COPY_STORE_AUTHORITY_DIR);
    const sentinelPath = join(authorityDir, "authority.json");
    const sentinel = JSON.parse(readFileSync(sentinelPath, "utf8"));
    const expectedDigest = createHash("sha256")
      .update(COPY_STORE_AUTHORITY_DIGEST_DOMAIN, "utf8")
      .update(canonicalRoot, "utf8")
      .digest("hex");

    expect(sentinel).toEqual({
      schema: COPY_STORE_AUTHORITY_SCHEMA,
      canonicalRootDigest: expectedDigest,
    });
    expect(readdirSync(authorityDir)).toEqual(["authority.json"]);
    expect(clearCheckpoints(retentionOptions())).toBe(1);
    expect(getCheckpoint(checkpoint.id, { root })).toBeNull();
    expect(readFileSync(sentinelPath, "utf8")).toContain(expectedDigest);
  });

  it.each([
    ["missing", null],
    ["malformed", "{"],
    [
      "mismatched",
      JSON.stringify({
        schema: COPY_STORE_AUTHORITY_SCHEMA,
        canonicalRootDigest: "0".repeat(64),
      }),
    ],
  ])(
    "fails closed for a %s pre-existing authority sentinel",
    (_kind, value) => {
      const authorityDir = join(root, COPY_STORE_AUTHORITY_DIR);
      const sentinelPath = join(authorityDir, "authority.json");
      mkdirSync(authorityDir, { recursive: true, mode: 0o700 });
      if (value != null) writeFileSync(sentinelPath, value, { mode: 0o600 });
      writeFileSync(join(authorityDir, "legacy-checkpoint-blob"), "legacy", {
        mode: 0o600,
      });
      const before = readdirSync(authorityDir).sort();

      expect(() => createCheckpoint(["a.txt"], { cwd: work, root })).toThrow(
        expect.objectContaining({
          code: CHECKPOINT_RESTORE_SAGA_ERROR_CODES.RETENTION_UNVERIFIED,
        }),
      );
      expect(readdirSync(authorityDir).sort()).toEqual(before);
    },
  );

  it("reserves authority ids and every casefold-equivalent root component", () => {
    for (const id of [
      COPY_STORE_AUTHORITY_DIR,
      COPY_STORE_AUTHORITY_DIR.toUpperCase(),
    ]) {
      expect(() =>
        createCheckpoint(["a.txt"], { cwd: work, root, id }),
      ).toThrow(/Unsafe checkpoint id/);
    }

    const base = join(work, "..");
    const casefoldAuthority = COPY_STORE_AUTHORITY_DIR.toUpperCase();
    for (const maliciousRoot of [
      join(base, casefoldAuthority),
      join(base, casefoldAuthority, "nested"),
      join(root, COPY_STORE_AUTHORITY_DIR, "maintenance.lock", "nested"),
    ]) {
      expect(() =>
        createCheckpoint(["a.txt"], {
          cwd: work,
          root: maliciousRoot,
          id: "nested-store",
        }),
      ).toThrow(
        expect.objectContaining({
          code: CHECKPOINT_RESTORE_SAGA_ERROR_CODES.RETENTION_UNVERIFIED,
        }),
      );
      expect(existsSync(maliciousRoot)).toBe(false);
    }
  });

  it("rejects custom roots at or below an existing checkpoint blob directory", () => {
    const outer = createCheckpoint(["a.txt"], {
      cwd: work,
      root,
      id: "outer-blob",
    });
    const blobRoot = join(root, outer.id);
    for (const nestedRoot of [blobRoot, join(blobRoot, "deep", "store")]) {
      expect(() =>
        createCheckpoint(["a.txt"], {
          cwd: work,
          root: nestedRoot,
          id: "nested",
        }),
      ).toThrow(
        expect.objectContaining({
          code: CHECKPOINT_RESTORE_SAGA_ERROR_CODES.RETENTION_UNVERIFIED,
        }),
      );
      expect(existsSync(join(nestedRoot, COPY_STORE_AUTHORITY_DIR))).toBe(
        false,
      );
    }
    expect(getCheckpoint(outer.id, { root })).not.toBeNull();
  });

  it("rejects a nested root after its ancestor authority publishes but before its manifest", () => {
    const originalWithFileLock = _fileCheckpointStoreDeps.withFileLock;
    let nestedError = null;
    let injected = false;
    _fileCheckpointStoreDeps.withFileLock = (target, callback) => {
      if (
        !injected &&
        target === join(root, COPY_STORE_AUTHORITY_DIR, "maintenance")
      ) {
        injected = true;
        try {
          createCheckpoint(["a.txt"], {
            cwd: work,
            root: join(root, "future-blob"),
            id: "nested-before-manifest",
          });
        } catch (error) {
          nestedError = error;
        }
      }
      return callback({ locked: true });
    };

    let outer;
    try {
      outer = createCheckpoint(["a.txt"], {
        cwd: work,
        root,
        id: "future-blob",
      });
    } finally {
      _fileCheckpointStoreDeps.withFileLock = originalWithFileLock;
    }

    expect(injected).toBe(true);
    expect(nestedError).toMatchObject({
      code: CHECKPOINT_RESTORE_SAGA_ERROR_CODES.RETENTION_UNVERIFIED,
    });
    expect(getCheckpoint(outer.id, { root })).not.toBeNull();
  });

  it("refuses to delete a pre-existing nested store from a checkpoint blob", () => {
    const outer = createCheckpoint(["a.txt"], {
      cwd: work,
      root,
      id: "nested-delete",
    });
    const nestedAuthority = join(root, outer.id, COPY_STORE_AUTHORITY_DIR);
    mkdirSync(nestedAuthority, { recursive: true });
    writeFileSync(join(nestedAuthority, "authority.json"), "legacy-nested");

    expect(() => deleteCheckpoint(outer.id, retentionOptions())).toThrow(
      expect.objectContaining({
        code: CHECKPOINT_RESTORE_SAGA_ERROR_CODES.RETENTION_UNVERIFIED,
      }),
    );
    expect(getCheckpoint(outer.id, { root })).not.toBeNull();
    expect(readFileSync(join(nestedAuthority, "authority.json"), "utf8")).toBe(
      "legacy-nested",
    );
  });

  it("preflights every blob layout before clear removes any checkpoint", () => {
    const safe = createCheckpoint(["a.txt"], {
      cwd: work,
      root,
      id: "a-safe-clear",
    });
    const nested = createCheckpoint(["b.txt"], {
      cwd: work,
      root,
      id: "z-nested-clear",
    });
    const nestedAuthority = join(root, nested.id, COPY_STORE_AUTHORITY_DIR);
    mkdirSync(nestedAuthority, { recursive: true });
    writeFileSync(join(nestedAuthority, "authority.json"), "legacy-nested");

    expect(() => clearCheckpoints(retentionOptions())).toThrow(
      expect.objectContaining({
        code: CHECKPOINT_RESTORE_SAGA_ERROR_CODES.RETENTION_UNVERIFIED,
      }),
    );
    expect(getCheckpoint(safe.id, { root })).not.toBeNull();
    expect(getCheckpoint(nested.id, { root })).not.toBeNull();
    expect(readFileSync(join(nestedAuthority, "authority.json"), "utf8")).toBe(
      "legacy-nested",
    );
  });

  it("uses one root-derived lock across homes and isolates different roots", () => {
    const originalWithFileLock = _fileCheckpointStoreDeps.withFileLock;
    const priorHome = process.env.CHAINLESSCHAIN_HOME;
    const targets = [];
    _fileCheckpointStoreDeps.withFileLock = (target, callback) => {
      targets.push(target);
      return callback({ locked: true });
    };
    try {
      process.env.CHAINLESSCHAIN_HOME = join(work, "..", "home-a");
      createCheckpoint(["a.txt"], {
        cwd: work,
        root,
        id: "home-a",
      });
      process.env.CHAINLESSCHAIN_HOME = join(work, "..", "home-b");
      createCheckpoint(["a.txt"], {
        cwd: work,
        root,
        id: "home-b",
      });
      createCheckpoint(["a.txt"], {
        cwd: work,
        root: join(work, "..", "other-store"),
        id: "other-root",
      });
    } finally {
      _fileCheckpointStoreDeps.withFileLock = originalWithFileLock;
      if (priorHome === undefined) delete process.env.CHAINLESSCHAIN_HOME;
      else process.env.CHAINLESSCHAIN_HOME = priorHome;
    }

    expect(targets).toHaveLength(3);
    expect(targets[0]).toBe(targets[1]);
    expect(targets[2]).not.toBe(targets[0]);
    expect(targets[0]).toBe(
      join(root, COPY_STORE_AUTHORITY_DIR, "maintenance"),
    );
  });

  it("fails clear on a casefold-reserved manifest without touching authority", () => {
    const checkpoint = mk("reserved-manifest-clear");
    const sentinelPath = join(root, COPY_STORE_AUTHORITY_DIR, "authority.json");
    const sentinelBefore = readFileSync(sentinelPath, "utf8");
    writeFileSync(
      join(root, `${COPY_STORE_AUTHORITY_DIR.toUpperCase()}.json`),
      "{}",
      "utf8",
    );

    expect(() => clearCheckpoints(retentionOptions())).toThrow(
      expect.objectContaining({
        code: CHECKPOINT_RESTORE_SAGA_ERROR_CODES.RETENTION_UNVERIFIED,
      }),
    );
    expect(getCheckpoint(checkpoint.id, { root })).not.toBeNull();
    expect(readFileSync(sentinelPath, "utf8")).toBe(sentinelBefore);
  });

  it("rejects a duplicate id but permits a successor after exact deletion", () => {
    const id = "duplicate-id";
    const original = createCheckpoint(["a.txt"], {
      cwd: work,
      root,
      id,
      label: "original",
    });
    const originalIdentity = computeCheckpointIdentity(original);
    writeFileSync(join(work, "a.txt"), "DUPLICATE-REPLACEMENT", "utf8");

    expect(() =>
      createCheckpoint(["a.txt"], {
        cwd: work,
        root,
        id,
        label: "forbidden-replacement",
      }),
    ).toThrow(expect.objectContaining({ code: "CHECKPOINT_ID_CONFLICT" }));
    expect(computeCheckpointIdentity(getCheckpoint(id, { root }))).toBe(
      originalIdentity,
    );

    expect(deleteCheckpoint(id, retentionOptions())).toBe(true);
    const successor = createCheckpoint(["a.txt"], {
      cwd: work,
      root,
      id,
      label: "allowed-successor",
    });
    expect(successor.label).toBe("allowed-successor");
    expect(computeCheckpointIdentity(successor)).not.toBe(originalIdentity);
  });

  it("does not replace active retained copy checkpoint authority", () => {
    const original = createCheckpoint(["a.txt"], {
      cwd: work,
      root,
      id: "retained-original",
      label: "retained-original",
    });
    const originalIdentity = computeCheckpointIdentity(original);
    retainCopyCheckpoint(original, "copy-retained-original-no-replace");
    writeFileSync(join(work, "a.txt"), "RETAINED-REPLACEMENT", "utf8");

    expect(() =>
      createCheckpoint(["a.txt"], {
        cwd: work,
        root,
        id: original.id,
        label: "forbidden-retained-replacement",
      }),
    ).toThrow(expect.objectContaining({ code: "CHECKPOINT_ID_CONFLICT" }));
    expect(
      computeCheckpointIdentity(getCheckpoint(original.id, { root })),
    ).toBe(originalIdentity);
  });

  it("does not replace active retained copy restore safety authority", () => {
    const source = createCheckpoint(["a.txt"], {
      cwd: work,
      root,
      id: "restore-source",
    });
    writeFileSync(join(work, "a.txt"), "DIRTY-BEFORE-RESTORE", "utf8");
    const restored = restoreCheckpoint(source.id, {
      root,
      cwd: work,
      expectedIdentity: computeCheckpointIdentity(source),
    });
    const safety = getCheckpoint(restored.safetyId, { root });
    const safetyIdentity = computeCheckpointIdentity(safety);
    retainCopyCheckpoint(safety, "copy-retained-safety-no-replace");

    expect(() =>
      createCheckpoint(["a.txt"], {
        cwd: work,
        root,
        id: safety.id,
        label: "forbidden-safety-replacement",
      }),
    ).toThrow(expect.objectContaining({ code: "CHECKPOINT_ID_CONFLICT" }));
    expect(computeCheckpointIdentity(getCheckpoint(safety.id, { root }))).toBe(
      safetyIdentity,
    );
  });

  it("fails closed when generated restore safety id is already reserved", () => {
    const fixedNow = 1_777_777_777_777;
    const fixedRandom = 0.123456789;
    const collidingSafetyId = `cp-${fixedNow}-${fixedRandom
      .toString(36)
      .slice(2, 8)}`;
    const occupied = createCheckpoint(["a.txt"], {
      cwd: work,
      root,
      id: collidingSafetyId,
      label: "occupied-safety-id",
    });
    const occupiedIdentity = computeCheckpointIdentity(occupied);
    const source = createCheckpoint(["a.txt"], {
      cwd: work,
      root,
      id: "collision-source",
    });
    writeFileSync(join(work, "a.txt"), "DIRTY-COLLISION", "utf8");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(fixedNow);
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(fixedRandom);
    try {
      expect(() =>
        restoreCheckpoint(source.id, {
          root,
          cwd: work,
          expectedIdentity: computeCheckpointIdentity(source),
        }),
      ).toThrow(expect.objectContaining({ code: "CHECKPOINT_ID_CONFLICT" }));
    } finally {
      nowSpy.mockRestore();
      randomSpy.mockRestore();
    }

    expect(
      computeCheckpointIdentity(getCheckpoint(occupied.id, { root })),
    ).toBe(occupiedIdentity);
    expect(readFileSync(join(work, "a.txt"), "utf8")).toBe("DIRTY-COLLISION");
  });

  it("fails a group clear before deleting free or retained authority", () => {
    const retained = mk("retained");
    writeFileSync(join(work, "a.txt"), "FREE-A", "utf8");
    const free = mk("free");
    retainCopyCheckpoint(retained, "copy-retention-clear");

    expect(() => clearCheckpoints(retentionOptions())).toThrow(
      expect.objectContaining({
        code: CHECKPOINT_RESTORE_SAGA_ERROR_CODES.RETENTION_PROTECTED,
      }),
    );
    expect(getCheckpoint(retained.id, { root })).not.toBeNull();
    expect(getCheckpoint(free.id, { root })).not.toBeNull();
  });

  it("binds list, delete, and clear to one exact copy workspace", () => {
    const own = mk("own");
    const otherWork = join(work, "..", "other-work");
    mkdirSync(otherWork);
    writeFileSync(join(otherWork, "other.txt"), "OTHER", "utf8");
    const other = createCheckpoint(["other.txt"], {
      cwd: otherWork,
      root,
      label: "other",
    });

    expect(listCheckpoints({ root, cwd: work }).map((row) => row.id)).toEqual([
      own.id,
    ]);
    expect(getCheckpoint(other.id, { root, cwd: work })).toBeNull();
    expect(() => deleteCheckpoint(other.id, retentionOptions(work))).toThrow(
      expect.objectContaining({
        code: CHECKPOINT_RESTORE_SAGA_ERROR_CODES.RETENTION_UNVERIFIED,
      }),
    );

    expect(clearCheckpoints(retentionOptions(work))).toBe(1);
    expect(getCheckpoint(own.id, { root })).toBeNull();
    expect(getCheckpoint(other.id, { root })).not.toBeNull();
  });

  it("re-reads immutable identity under the guard before deleting an id successor", () => {
    const original = mk("original");
    const successor = { ...original, label: "successor" };
    const manifestPath = join(root, `${original.id}.json`);
    const guard = vi
      .spyOn(
        CheckpointRestoreSagaStore.prototype,
        "withCheckpointRetentionGuard",
      )
      .mockImplementation((request, callback) => {
        writeFileSync(manifestPath, JSON.stringify(successor, null, 2), "utf8");
        return callback({
          protectedCandidates: [],
          deletableCandidates: request.candidates,
        });
      });

    try {
      expect(() => deleteCheckpoint(original.id, retentionOptions())).toThrow(
        expect.objectContaining({
          code: CHECKPOINT_RESTORE_SAGA_ERROR_CODES.RETENTION_UNVERIFIED,
        }),
      );
      expect(getCheckpoint(original.id, { root })).toMatchObject({
        label: "successor",
      });
      expect(existsSync(join(root, original.id))).toBe(true);
    } finally {
      guard.mockRestore();
    }
  });

  it("serializes same-id create after the final deletion identity read", () => {
    const original = mk("original");
    const originalWithFileLock = _fileCheckpointStoreDeps.withFileLock;
    const originalBeforeDelete =
      _fileCheckpointStoreDeps.beforeDeleteCopyAuthorityForTests;
    let activeTarget = null;
    let blockedCreate = null;
    _fileCheckpointStoreDeps.withFileLock = (target, callback) => {
      if (activeTarget === target) {
        const error = new Error("copy checkpoint store is already locked");
        error.code = "STATE_LOCK_UNAVAILABLE";
        throw error;
      }
      const priorTarget = activeTarget;
      activeTarget = target;
      try {
        return callback({ locked: true });
      } finally {
        activeTarget = priorTarget;
      }
    };
    _fileCheckpointStoreDeps.beforeDeleteCopyAuthorityForTests = () => {
      try {
        createCheckpoint(["a.txt", "b.txt"], {
          cwd: work,
          root,
          id: original.id,
          label: "racing-successor",
        });
      } catch (error) {
        blockedCreate = error;
      }
    };

    try {
      expect(deleteCheckpoint(original.id, retentionOptions())).toBe(true);
      expect(blockedCreate).toMatchObject({ code: "STATE_LOCK_UNAVAILABLE" });
      expect(getCheckpoint(original.id, { root })).toBeNull();

      const successor = createCheckpoint(["a.txt", "b.txt"], {
        cwd: work,
        root,
        id: original.id,
        label: "serialized-successor",
      });
      expect(getCheckpoint(original.id, { root })).toMatchObject({
        label: "serialized-successor",
      });
      expect(computeCheckpointIdentity(successor)).toBe(
        computeCheckpointIdentity(getCheckpoint(original.id, { root })),
      );
    } finally {
      _fileCheckpointStoreDeps.withFileLock = originalWithFileLock;
      _fileCheckpointStoreDeps.beforeDeleteCopyAuthorityForTests =
        originalBeforeDelete;
    }
  });

  it("rejects copy retention authority redirection outside the test runtime", () => {
    const checkpoint = mk("redirect");
    const priorNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() => deleteCheckpoint(checkpoint.id, retentionOptions())).toThrow(
        expect.objectContaining({
          code: CHECKPOINT_RESTORE_SAGA_ERROR_CODES.RETENTION_UNVERIFIED,
        }),
      );
    } finally {
      if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = priorNodeEnv;
    }
    expect(getCheckpoint(checkpoint.id, { root })).not.toBeNull();
  });

  it("rejects an empty path list and a non-existent path", () => {
    expect(() => createCheckpoint([], { cwd: work, root })).toThrow(
      /at least one path/,
    );
    expect(() => createCheckpoint(["nope.txt"], { cwd: work, root })).toThrow(
      /no such path/,
    );
  });

  it("enforces the maxFiles guard", () => {
    expect(() =>
      createCheckpoint(["a.txt", "b.txt"], { cwd: work, root, maxFiles: 1 }),
    ).toThrow(/exceeds 1 files/);
  });

  it("rejects path-traversal checkpoint ids (no escape of the store)", () => {
    for (const bad of [
      "../evil",
      "../../etc/passwd",
      "a/b",
      "a\\b",
      "..",
      "C:\\x",
    ]) {
      // create: explicit unsafe id is rejected before any blob is written.
      expect(() =>
        createCheckpoint(["a.txt"], { cwd: work, root, id: bad }),
      ).toThrow(/Unsafe checkpoint id/);
      // read/delete fail safe (no fs access outside the store).
      expect(getCheckpoint(bad, { root })).toBeNull();
      expect(deleteCheckpoint(bad, { root })).toBe(false);
    }
  });

  it("walks directories but skips heavy dirs (node_modules)", () => {
    mkdirSync(join(work, "sub"), { recursive: true });
    writeFileSync(join(work, "sub", "c.txt"), "C", "utf-8");
    mkdirSync(join(work, "node_modules"), { recursive: true });
    writeFileSync(join(work, "node_modules", "junk.txt"), "JUNK", "utf-8");
    const m = createCheckpoint(["."], { cwd: work, root });
    const rels = m.files.map((f) => f.rel.replace(/\\/g, "/")).sort();
    expect(rels).toContain("sub/c.txt");
    expect(rels.some((r) => r.includes("node_modules"))).toBe(false);
    expect(SKIP_DIRS.has("node_modules")).toBe(true);
  });

  it("content-addresses duplicate files (dedupes blobs)", () => {
    writeFileSync(join(work, "b.txt"), "ORIGINAL-A", "utf-8"); // same as a.txt
    const m = createCheckpoint(["a.txt", "b.txt"], { cwd: work, root });
    expect(m.files[0].sha256).toBe(m.files[1].sha256);
    // a single blob file exists for the shared content
    expect(existsSync(join(root, m.id, m.files[0].sha256))).toBe(true);
  });

  it("writes manifest, blobs, and restores atomically with no .tmp leftovers", () => {
    const m = mk("atomic");
    // Manifest dir holds exactly `<id>.json` (+ the blob dir) — no `.tmp` files.
    const rootEntries = readdirSync(root);
    expect(rootEntries).toContain(`${m.id}.json`);
    expect(rootEntries.some((n) => n.endsWith(".tmp"))).toBe(false);
    // Blob dir holds only sha-named blobs — no `.tmp` files.
    const blobEntries = readdirSync(join(root, m.id));
    expect(blobEntries.length).toBe(2);
    expect(blobEntries.some((n) => n.endsWith(".tmp"))).toBe(false);
    // Manifest is fully-formed valid JSON (atomic rename → never half-written).
    expect(getCheckpoint(m.id, { root })).toMatchObject({ id: m.id });

    // Restore is atomic too: correct content, no `.tmp` left in the work dir.
    writeFileSync(join(work, "a.txt"), "CHANGED-A", "utf-8");
    restoreCheckpoint(m.id, { root, skipSafety: true });
    expect(readFileSync(join(work, "a.txt"), "utf-8")).toBe("ORIGINAL-A");
    expect(readdirSync(work).some((n) => n.endsWith(".tmp"))).toBe(false);
  });
});
