import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isCheckpointAvailable,
  createCheckpoint,
  listCheckpoints,
  resolveCheckpoint,
  rewindTo,
  diffCheckpoint,
  statusAgainst,
  showCheckpoint,
  deleteCheckpoint,
  clearCheckpoints,
} from "../../src/lib/checkpoint-store.js";

/** Run git in the repo (test helper). */
function git(repo, ...args) {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf-8" });
  if (r.status !== 0)
    throw new Error(r.stderr || `git ${args.join(" ")} failed`);
  return (r.stdout || "").trim();
}

describe("checkpoint-store (git engine)", () => {
  let repo;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "cc-cpstore-"));
    git(repo, "init", "-q");
    git(repo, "config", "user.email", "t@test.local");
    git(repo, "config", "user.name", "tester");
    // Pin line-ending handling so byte comparisons are deterministic on Windows
    // (default core.autocrlf=true would rewrite \n→\r\n on checkout-index).
    git(repo, "config", "core.autocrlf", "false");
    writeFileSync(join(repo, "a.txt"), "alpha-1\n", "utf8");
    writeFileSync(join(repo, "b.txt"), "beta-1\n", "utf8");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "init");
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("reports availability inside vs outside a git work tree", () => {
    expect(isCheckpointAvailable(repo)).toBe(true);
    const plain = mkdtempSync(join(tmpdir(), "cc-nogit-"));
    try {
      expect(isCheckpointAvailable(plain)).toBe(false);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it("creates a checkpoint as a shadow ref without touching index/working tree", () => {
    const before = git(repo, "status", "--porcelain");
    const cp = createCheckpoint(repo, { label: "first" });
    expect(cp.id).toBe("cp0001");
    expect(cp.label).toBe("first");
    expect(cp.commit).toMatch(/^[0-9a-f]{40}$/);
    // The real index / working tree are untouched by capture.
    expect(git(repo, "status", "--porcelain")).toBe(before);
    // A shadow ref now exists.
    expect(git(repo, "rev-parse", cp.ref)).toBe(cp.commit);
  });

  it("lists checkpoints newest-first and resolves ids", () => {
    const c1 = createCheckpoint(repo, { label: "one" });
    writeFileSync(join(repo, "a.txt"), "alpha-2\n", "utf8");
    const c2 = createCheckpoint(repo, { label: "two" });
    const rows = listCheckpoints(repo);
    expect(rows.map((r) => r.id)).toEqual([c2.id, c1.id]); // newest first
    expect(rows[0].label).toBe("two");
    expect(resolveCheckpoint(repo, c1.id)).toBe(c1.commit);
  });

  it("rewind restores modified files and takes a safety checkpoint", () => {
    const cp = createCheckpoint(repo, { label: "clean" });
    writeFileSync(join(repo, "a.txt"), "alpha-MUTATED\n", "utf8");

    const res = rewindTo(repo, cp.id);
    expect(res.restored).toBe(true);
    expect(res.modified).toBe(1);
    expect(res.safetyId).toBeTruthy();
    // File content is back to the checkpoint state.
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("alpha-1\n");

    // The safety checkpoint captured the mutated state → rewinding to it redoes.
    rewindTo(repo, res.safetyId);
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("alpha-MUTATED\n");
  });

  it("rewind deletes files created after the checkpoint", () => {
    const cp = createCheckpoint(repo, { label: "base" });
    writeFileSync(join(repo, "new-file.txt"), "added later\n", "utf8");
    expect(existsSync(join(repo, "new-file.txt"))).toBe(true);

    const res = rewindTo(repo, cp.id);
    expect(res.deleted).toBe(1);
    expect(existsSync(join(repo, "new-file.txt"))).toBe(false);
  });

  it("rewind recreates files deleted after the checkpoint", () => {
    const cp = createCheckpoint(repo, { label: "has-b" });
    rmSync(join(repo, "b.txt"));
    expect(existsSync(join(repo, "b.txt"))).toBe(false);

    rewindTo(repo, cp.id);
    expect(existsSync(join(repo, "b.txt"))).toBe(true);
    expect(readFileSync(join(repo, "b.txt"), "utf8")).toBe("beta-1\n");
  });

  it("dry-run reports changes without writing or creating a safety checkpoint", () => {
    const cp = createCheckpoint(repo, { label: "dry" });
    writeFileSync(join(repo, "a.txt"), "alpha-DIRTY\n", "utf8");
    writeFileSync(join(repo, "c.txt"), "brand new\n", "utf8");
    const countBefore = listCheckpoints(repo).length;

    const res = rewindTo(repo, cp.id, { dryRun: true });
    expect(res.dryRun).toBe(true);
    expect(res.modified).toBe(1);
    expect(res.deleted).toBe(1); // c.txt would be removed
    // Nothing was written or snapshotted.
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("alpha-DIRTY\n");
    expect(existsSync(join(repo, "c.txt"))).toBe(true);
    expect(listCheckpoints(repo).length).toBe(countBefore);
  });

  it("statusAgainst classifies modified / added / deleted", () => {
    const cp = createCheckpoint(repo, { label: "snap" });
    writeFileSync(join(repo, "a.txt"), "alpha-X\n", "utf8"); // modified
    writeFileSync(join(repo, "d.txt"), "new\n", "utf8"); // added
    rmSync(join(repo, "b.txt")); // deleted
    const s = statusAgainst(repo, cp.id);
    expect(s.modified).toContain("a.txt");
    expect(s.added).toContain("d.txt");
    expect(s.deleted).toContain("b.txt");
  });

  it("diffCheckpoint returns a patch / stat against current state", () => {
    const cp = createCheckpoint(repo, { label: "d" });
    writeFileSync(join(repo, "a.txt"), "alpha-PATCHED\n", "utf8");
    const patch = diffCheckpoint(repo, cp.id);
    expect(patch).toContain("a.txt");
    expect(patch).toContain("alpha-PATCHED");
    const stat = diffCheckpoint(repo, cp.id, { stat: true });
    expect(stat).toContain("a.txt");
  });

  it("showCheckpoint lists the captured files with sizes", () => {
    const cp = createCheckpoint(repo, { label: "show" });
    const info = showCheckpoint(repo, cp.id);
    const names = info.files.map((f) => f.rel);
    expect(names).toContain("a.txt");
    expect(names).toContain("b.txt");
    expect(info.files.find((f) => f.rel === "a.txt").bytes).toBeGreaterThan(0);
  });

  it("respects .gitignore (ignored files are not snapshotted)", () => {
    writeFileSync(join(repo, ".gitignore"), "ignored/\n", "utf8");
    mkdirSync(join(repo, "ignored"));
    writeFileSync(join(repo, "ignored", "secret.txt"), "nope\n", "utf8");
    const cp = createCheckpoint(repo, { label: "ig" });
    const names = showCheckpoint(repo, cp.id).files.map((f) => f.rel);
    expect(names.some((n) => n.includes("ignored/secret.txt"))).toBe(false);
  });

  it("delete removes one checkpoint; clear removes all in a session", () => {
    const c1 = createCheckpoint(repo, { label: "x" });
    createCheckpoint(repo, { label: "y" });
    expect(deleteCheckpoint(repo, c1.id)).toBe(true);
    expect(deleteCheckpoint(repo, c1.id)).toBe(false); // already gone
    expect(listCheckpoints(repo).length).toBe(1);

    const removed = clearCheckpoints(repo);
    expect(removed).toBe(1);
    expect(listCheckpoints(repo).length).toBe(0);
  });

  it("scopes checkpoints by session namespace", () => {
    createCheckpoint(repo, { session: "alpha", label: "a" });
    createCheckpoint(repo, { session: "beta", label: "b" });
    expect(listCheckpoints(repo, { session: "alpha" }).length).toBe(1);
    expect(listCheckpoints(repo, { session: "beta" }).length).toBe(1);
    expect(listCheckpoints(repo, { session: "alpha" })[0].label).toBe("a");
  });

  it("resolveCheckpoint throws on an unknown id", () => {
    expect(() => resolveCheckpoint(repo, "cp9999")).toThrow(/not found/i);
  });

  it("skipIfUnchanged reuses the prior checkpoint when nothing changed", () => {
    const c1 = createCheckpoint(repo, { label: "base" });
    // No edits since c1 → reuse it instead of making a duplicate ref.
    const again = createCheckpoint(repo, { skipIfUnchanged: true });
    expect(again.reused).toBe(true);
    expect(again.id).toBe(c1.id);
    expect(listCheckpoints(repo).length).toBe(1);

    // After a real change, skipIfUnchanged makes a fresh checkpoint.
    writeFileSync(join(repo, "a.txt"), "changed\n", "utf8");
    const c2 = createCheckpoint(repo, { skipIfUnchanged: true });
    expect(c2.reused).toBeFalsy();
    expect(c2.id).not.toBe(c1.id);
    expect(listCheckpoints(repo).length).toBe(2);
  });
});
