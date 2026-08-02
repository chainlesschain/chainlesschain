import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
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
import { join, parse } from "node:path";
import {
  createCheckpoint,
  getCheckpoint,
  listCheckpoints,
  diffCheckpoint,
  restoreCheckpoint,
  deleteCheckpoint,
  computeCheckpointIdentity,
  SKIP_DIRS,
} from "../../src/lib/file-checkpoint.js";

describe("file-checkpoint store", () => {
  let work; // the "project" dir holding files
  let root; // checkpoint store root

  beforeEach(() => {
    const base = mkdtempSync(join(tmpdir(), "cp-test-"));
    work = join(base, "work");
    root = join(base, "store");
    mkdirSync(work, { recursive: true });
    writeFileSync(join(work, "a.txt"), "ORIGINAL-A", "utf-8");
    writeFileSync(join(work, "b.txt"), "ORIGINAL-B", "utf-8");
  });
  afterEach(() => {
    rmSync(join(work, ".."), { recursive: true, force: true });
  });

  const mk = (label) =>
    createCheckpoint(["a.txt", "b.txt"], { cwd: work, root, label });

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
      safetyCoverage: "partial",
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
    // The copy safety checkpoint cannot encode a tombstone for a file that was
    // absent before restore; diagnostics must call this partial, not promise a
    // complete rollback.
    expect(readFileSync(join(work, "a.txt"), "utf-8")).toBe("ORIGINAL-A");
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
      safetyId: null,
      safetyIdentity: null,
      safetyCoverage: "partial",
      createdPaths: ["a.txt"],
    });
    expect(readFileSync(join(work, "a.txt"), "utf-8")).toBe("ORIGINAL-A");
    expect(existsSync(join(work, "b.txt"))).toBe(false);
  });

  it("delete removes manifest + blobs", () => {
    const m = mk();
    expect(deleteCheckpoint(m.id, { root })).toBe(true);
    expect(getCheckpoint(m.id, { root })).toBeNull();
    expect(deleteCheckpoint(m.id, { root })).toBe(false); // already gone
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
