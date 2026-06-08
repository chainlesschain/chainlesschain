import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCheckpoint,
  getCheckpoint,
  listCheckpoints,
  diffCheckpoint,
  restoreCheckpoint,
  deleteCheckpoint,
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
  });

  it("diff reports modified / unchanged / deleted", () => {
    const m = mk();
    writeFileSync(join(work, "a.txt"), "CHANGED-A", "utf-8"); // modify
    rmSync(join(work, "b.txt")); // delete
    const d = diffCheckpoint(m.id, { root });
    expect(d.modified).toEqual(["a.txt"]);
    expect(d.deleted).toEqual(["b.txt"]);
    expect(d.unchanged).toEqual([]);
  });

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
});
