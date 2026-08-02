import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
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
  withinRoot,
  _internals,
  _deps,
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

  it("routes checkpoint git calls through literal brokered argv", () => {
    const original = _deps.spawnSync;
    _deps.spawnSync = vi.fn(() => ({
      status: 0,
      stdout: "true\n",
      stderr: "",
    }));

    try {
      expect(isCheckpointAvailable(repo)).toBe(true);
      expect(_deps.spawnSync).toHaveBeenCalledWith(
        "git",
        ["rev-parse", "--is-inside-work-tree"],
        expect.objectContaining({
          origin: "checkpoint:git",
          scope: "checkpoint",
          policy: "allow",
          shell: false,
          cwd: repo,
        }),
      );
    } finally {
      _deps.spawnSync = original;
    }
  });

  it("preserves non-secret git settings without forwarding provider secrets", () => {
    const original = _deps.spawnSync;
    const priorLfs = process.env.GIT_LFS_SKIP_SMUDGE;
    const priorApiKey = process.env.OPENAI_API_KEY;
    process.env.GIT_LFS_SKIP_SMUDGE = "1";
    process.env.OPENAI_API_KEY = "checkpoint-test-secret";
    _deps.spawnSync = vi.fn(() => ({
      status: 0,
      stdout: "true\n",
      stderr: "",
    }));

    try {
      expect(isCheckpointAvailable(repo)).toBe(true);
      const options = _deps.spawnSync.mock.calls[0][2];
      expect(options.env.GIT_LFS_SKIP_SMUDGE).toBe("1");
      expect(options.env).not.toHaveProperty("OPENAI_API_KEY");
    } finally {
      _deps.spawnSync = original;
      if (priorLfs === undefined) delete process.env.GIT_LFS_SKIP_SMUDGE;
      else process.env.GIT_LFS_SKIP_SMUDGE = priorLfs;
      if (priorApiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = priorApiKey;
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

  it("creates shadow commits without relying on global git author config", () => {
    const fresh = mkdtempSync(join(tmpdir(), "cc-cpstore-no-identity-"));
    git(fresh, "init", "-q");
    writeFileSync(join(fresh, "a.txt"), "fresh\n", "utf8");
    const priorNoSystem = process.env.GIT_CONFIG_NOSYSTEM;
    const priorGlobal = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    process.env.GIT_CONFIG_GLOBAL = join(fresh, "missing-global-config");

    try {
      const checkpoint = createCheckpoint(fresh, { label: "root" });
      expect(checkpoint.commit).toMatch(/^[a-f0-9]{40}$/);
      expect(
        git(fresh, "show", "-s", "--format=%an <%ae>", checkpoint.commit),
      ).toBe("cc-checkpoint <checkpoint@chainlesschain.local>");
    } finally {
      if (priorNoSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
      else process.env.GIT_CONFIG_NOSYSTEM = priorNoSystem;
      if (priorGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = priorGlobal;
      rmSync(fresh, { recursive: true, force: true });
    }
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

  it("retries a concurrent id/tip publication without overwriting its checkpoint", () => {
    const session = "race";
    const prefix = `refs/cc-checkpoints/${session}`;
    const base = createCheckpoint(repo, { session, label: "base" });
    writeFileSync(join(repo, "a.txt"), "outer-change\n", "utf8");

    const originalSpawnSync = _deps.spawnSync;
    let firstAttemptInput = "";
    let competing = null;
    let injected = false;
    _deps.spawnSync = (command, args, options) => {
      if (
        !injected &&
        command === "git" &&
        args?.[0] === "update-ref" &&
        args?.[1] === "--stdin" &&
        options?.input?.includes(`update ${prefix}/cp0002 `)
      ) {
        // Publish a complete competing checkpoint after the outer call scanned
        // cp0002 and the old tip, but before its ref transaction executes.
        // The outer transaction must lose both CAS checks, preserve this ref,
        // then rebuild its commit on the competing tip under a new id.
        injected = true;
        firstAttemptInput = options.input;
        competing = createCheckpoint(repo, {
          session,
          label: "concurrent-winner",
        });
      }
      return originalSpawnSync(command, args, options);
    };

    let created;
    try {
      created = createCheckpoint(repo, { session, label: "outer-retry" });
    } finally {
      _deps.spawnSync = originalSpawnSync;
    }

    expect(injected).toBe(true);
    expect(competing.id).toBe("cp0002");
    expect(created.id).toBe("cp0003");
    expect(git(repo, "rev-parse", competing.ref)).toBe(competing.commit);
    expect(git(repo, "rev-parse", `${prefix}/_tip`)).toBe(created.commit);
    expect(git(repo, "rev-parse", `${created.commit}^`)).toBe(competing.commit);

    const zeroOid = "0".repeat(base.commit.length);
    expect(firstAttemptInput).toMatch(
      new RegExp(`update ${prefix}/cp0002 [a-f0-9]+ ${zeroOid}\\n`),
    );
    expect(firstAttemptInput).toMatch(
      new RegExp(`update ${prefix}/_tip [a-f0-9]+ ${base.commit}\\n`),
    );
    expect(listCheckpoints(repo, { session }).map((row) => row.id)).toEqual([
      "cp0003",
      "cp0002",
      "cp0001",
    ]);
  });

  it("bounds repeated checkpoint ref transaction conflicts", () => {
    const originalSpawnSync = _deps.spawnSync;
    let attempts = 0;
    _deps.spawnSync = (command, args, options) => {
      if (
        command === "git" &&
        args?.[0] === "update-ref" &&
        args?.[1] === "--stdin"
      ) {
        attempts += 1;
        return {
          status: 1,
          stdout: "",
          stderr:
            "fatal: prepare: cannot lock ref 'refs/cc-checkpoints/busy/cp0001': reference already exists",
        };
      }
      return originalSpawnSync(command, args, options);
    };

    let thrown = null;
    try {
      createCheckpoint(repo, { session: "busy", label: "bounded" });
    } catch (error) {
      thrown = error;
    } finally {
      _deps.spawnSync = originalSpawnSync;
    }

    expect(thrown).toMatchObject({
      code: "CHECKPOINT_REF_CONFLICT",
      attempts: _internals.MAX_REF_PUBLISH_ATTEMPTS,
    });
    expect(attempts).toBe(_internals.MAX_REF_PUBLISH_ATTEMPTS);
    expect(listCheckpoints(repo, { session: "busy" })).toHaveLength(0);
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

  it("returns a stable full-tree workspace binding from repo subdirectories", () => {
    const cp = createCheckpoint(repo, { label: "bound" });
    writeFileSync(join(repo, "a.txt"), "alpha-bound-dirty\n", "utf8");
    const nested = join(repo, "nested", "deeper");
    mkdirSync(nested, { recursive: true });

    const fromRoot = statusAgainst(repo, cp.id);
    const repeated = statusAgainst(repo, cp.id);
    const fromNested = statusAgainst(nested, cp.id);

    expect(repeated.workspaceBinding).toEqual(fromRoot.workspaceBinding);
    expect(fromNested.workspaceBinding).toEqual(fromRoot.workspaceBinding);
    expect(fromRoot.workspaceBinding).toEqual({
      schema: "cc-checkpoint-workspace-binding/v1",
      version: 1,
      engine: "git",
      workspaceRoot: realpathSync.native(repo),
      scopeIdentity: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      prestateIdentity: expect.stringMatching(
        /^git-tree:(?:[a-f0-9]{40}|[a-f0-9]{64})$/,
      ),
      writePlanIdentity: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      targetPoststateIdentity: `git-tree:${git(repo, "rev-parse", `${cp.commit}^{tree}`)}`,
    });

    const restored = rewindTo(nested, cp.id, {
      expectedWorkspaceBinding: fromNested.workspaceBinding,
      skipSafety: true,
    });
    expect(restored.restored).toBe(true);
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("alpha-1\n");
  });

  it("rejects same-classification workspace drift before safety or restore writes", () => {
    const cp = createCheckpoint(repo, { label: "prestate" });
    writeFileSync(join(repo, "a.txt"), "alpha-preview-state\n", "utf8");
    const preview = statusAgainst(repo, cp.id);
    writeFileSync(join(repo, "a.txt"), "alpha-confirm-state\n", "utf8");
    const drifted = statusAgainst(repo, cp.id);
    expect(drifted.modified).toEqual(preview.modified);
    expect(drifted.added).toEqual(preview.added);
    expect(drifted.deleted).toEqual(preview.deleted);
    expect(drifted.workspaceBinding.prestateIdentity).not.toBe(
      preview.workspaceBinding.prestateIdentity,
    );

    const originalSpawnSync = _deps.spawnSync;
    let safetyPublishes = 0;
    let restoreWrites = 0;
    _deps.spawnSync = (command, args, options) => {
      if (
        command === "git" &&
        args?.[0] === "update-ref" &&
        args?.[1] === "--stdin"
      ) {
        safetyPublishes += 1;
      }
      if (command === "git" && args?.[0] === "checkout-index") {
        restoreWrites += 1;
      }
      return originalSpawnSync(command, args, options);
    };

    let thrown = null;
    try {
      rewindTo(repo, cp.id, {
        expectedIdentity: `git:${cp.commit}`,
        expectedWorkspaceBinding: preview.workspaceBinding,
      });
    } catch (error) {
      thrown = error;
    } finally {
      _deps.spawnSync = originalSpawnSync;
    }

    expect(thrown).toMatchObject({
      code: "CHECKPOINT_WORKSPACE_STALE",
      reason: "mismatch:prestateIdentity",
    });
    expect(safetyPublishes).toBe(0);
    expect(restoreWrites).toBe(0);
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe(
      "alpha-confirm-state\n",
    );
    expect(listCheckpoints(repo)).toHaveLength(1);
  });

  it("fails closed on a malformed expected workspace binding", () => {
    const cp = createCheckpoint(repo, { label: "invalid-binding" });
    writeFileSync(join(repo, "a.txt"), "alpha-still-dirty\n", "utf8");
    const binding = statusAgainst(repo, cp.id).workspaceBinding;
    const countBefore = listCheckpoints(repo).length;

    expect(() =>
      rewindTo(repo, cp.id, {
        expectedWorkspaceBinding: { ...binding, unexpected: true },
      }),
    ).toThrow(
      expect.objectContaining({
        code: "CHECKPOINT_WORKSPACE_STALE",
        reason: "invalid-expected-binding",
      }),
    );
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe(
      "alpha-still-dirty\n",
    );
    expect(listCheckpoints(repo)).toHaveLength(countBefore);
  });

  it("rejects a retargeted checkpoint ref before status or restore writes", () => {
    const original = createCheckpoint(repo, { label: "original-target" });
    writeFileSync(join(repo, "a.txt"), "alpha-second-target\n", "utf8");
    const replacement = createCheckpoint(repo, { label: "replacement" });
    writeFileSync(join(repo, "a.txt"), "alpha-current-workspace\n", "utf8");
    const expectedIdentity = `git:${original.commit}`;

    expect(
      statusAgainst(repo, original.id, { expectedIdentity }).modified,
    ).toContain("a.txt");
    git(repo, "update-ref", original.ref, replacement.commit);
    const countBefore = listCheckpoints(repo).length;

    expect(() =>
      statusAgainst(repo, original.id, { expectedIdentity }),
    ).toThrow(expect.objectContaining({ code: "CHECKPOINT_IDENTITY_STALE" }));
    expect(() => rewindTo(repo, original.id, { expectedIdentity })).toThrow(
      expect.objectContaining({ code: "CHECKPOINT_IDENTITY_STALE" }),
    );
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe(
      "alpha-current-workspace\n",
    );
    expect(listCheckpoints(repo)).toHaveLength(countBefore);
  });

  it("attaches the immutable safety checkpoint when git restore fails", () => {
    const target = createCheckpoint(repo, { label: "target" });
    writeFileSync(join(repo, "a.txt"), "alpha-dirty-before-failure\n", "utf8");
    const originalSpawnSync = _deps.spawnSync;
    _deps.spawnSync = (command, args, options) => {
      if (command === "git" && args?.[0] === "checkout-index") {
        return {
          status: 1,
          stdout: "",
          stderr: "injected checkout-index failure",
        };
      }
      return originalSpawnSync(command, args, options);
    };

    let thrown = null;
    try {
      rewindTo(repo, target.id, { expectedIdentity: `git:${target.commit}` });
    } catch (error) {
      thrown = error;
    } finally {
      _deps.spawnSync = originalSpawnSync;
    }

    expect(thrown).toMatchObject({
      restorePhase: "workspace-mutation",
      safetyId: expect.any(String),
      safetyIdentity: expect.stringMatching(
        /^git:(?:[a-f0-9]{40}|[a-f0-9]{64})$/,
      ),
    });
    expect(resolveCheckpoint(repo, thrown.safetyId)).toBe(
      thrown.safetyIdentity.slice("git:".length),
    );
    expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe(
      "alpha-dirty-before-failure\n",
    );
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

  describe("maxPerSession prune (auto-checkpoint history bound)", () => {
    it("keeps only the newest N checkpoints, pruning the oldest", () => {
      const session = "autotest";
      for (let i = 0; i < 6; i++) {
        writeFileSync(join(repo, "a.txt"), `v${i}\n`, "utf8");
        createCheckpoint(repo, { session, label: `cp${i}`, maxPerSession: 3 });
      }
      const rows = listCheckpoints(repo, { session });
      expect(rows.length).toBe(3); // capped at maxPerSession
      const labels = rows.map((r) => r.label);
      expect(labels).toContain("cp5"); // newest kept
      expect(labels).toContain("cp3");
      expect(labels).not.toContain("cp0"); // oldest pruned
      expect(labels).not.toContain("cp2");
    });

    it("does not prune when maxPerSession is omitted (manual = unbounded)", () => {
      const session = "manual";
      for (let i = 0; i < 5; i++) {
        writeFileSync(join(repo, "a.txt"), `m${i}\n`, "utf8");
        createCheckpoint(repo, { session, label: `m${i}` });
      }
      expect(listCheckpoints(repo, { session }).length).toBe(5);
    });

    it("a pruned checkpoint's predecessor tree is still restorable via the kept chain", () => {
      const session = "chain";
      // 3 checkpoints, cap 2: the first is pruned but its tree lives on as the
      // parent of the survivors — rewinding to a kept checkpoint still works.
      writeFileSync(join(repo, "a.txt"), "one\n", "utf8");
      createCheckpoint(repo, { session, label: "one", maxPerSession: 2 });
      writeFileSync(join(repo, "a.txt"), "two\n", "utf8");
      const keep = createCheckpoint(repo, {
        session,
        label: "two",
        maxPerSession: 2,
      });
      writeFileSync(join(repo, "a.txt"), "three\n", "utf8");
      createCheckpoint(repo, { session, label: "three", maxPerSession: 2 });

      expect(listCheckpoints(repo, { session }).length).toBe(2);
      // The kept "two" checkpoint still rewinds cleanly.
      rewindTo(repo, keep.id, { session, skipSafety: true });
      expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("two\n");
    });
  });
});

describe("sanitizeSession — ref-format hardening", () => {
  const { sanitizeSession } = _internals;

  it("strips a leading dot (git forbids a component beginning with '.')", () => {
    expect(sanitizeSession(".hidden")).toBe("hidden");
    expect(sanitizeSession("...x")).toBe("x");
  });

  it("collapses '..' which git forbids in a refname", () => {
    expect(sanitizeSession("a..b")).toBe("a.b");
    expect(sanitizeSession("a....b")).toBe("a.b");
  });

  it("avoids a trailing dot and a '.lock' ending", () => {
    expect(sanitizeSession("trailing.")).toBe("trailing");
    expect(sanitizeSession("my.lock")).toBe("my-lock");
  });

  it("collapses '/' (no namespace traversal) and falls back to 'default'", () => {
    expect(sanitizeSession("a/b")).toBe("a-b");
    expect(sanitizeSession("..")).toBe("default"); // collapses to '.', stripped → empty
    expect(sanitizeSession("")).toBe("default");
    expect(sanitizeSession(null)).toBe("default");
  });

  it("leaves an ordinary session untouched", () => {
    expect(sanitizeSession("sess-2026_06")).toBe("sess-2026_06");
  });
});

describe("sanitizeSession — end-to-end with a real repo", () => {
  let repo;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "cc-cpsess-"));
    spawnSync("git", ["init", "-q"], { cwd: repo });
    spawnSync("git", ["config", "user.email", "t@test.local"], { cwd: repo });
    spawnSync("git", ["config", "user.name", "tester"], { cwd: repo });
    writeFileSync(join(repo, "a.txt"), "x\n", "utf8");
    spawnSync("git", ["add", "-A"], { cwd: repo });
    spawnSync("git", ["commit", "-q", "-m", "init"], { cwd: repo });
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("a dotted session name that git would reject still checkpoints", () => {
    // Before hardening, the ".hidden" ref component made git reject every op.
    const cp = createCheckpoint(repo, { session: ".hidden", label: "ok" });
    expect(cp.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(listCheckpoints(repo, { session: ".hidden" })).toHaveLength(1);
  });
});

describe("tempIndexPath — uniqueness guard", () => {
  it("never repeats within a process even in the same millisecond", () => {
    const { tempIndexPath } = _internals;
    const seen = new Set();
    for (let i = 0; i < 1000; i++) seen.add(tempIndexPath("/git/dir"));
    expect(seen.size).toBe(1000);
  });
});

describe("withinRoot — restore containment guard", () => {
  it("accepts the root and paths inside it", () => {
    const root = join(tmpdir(), "cc-repo");
    expect(withinRoot(root, root)).toBe(true);
    expect(withinRoot(root, join(root, "src", "a.txt"))).toBe(true);
  });

  it("rejects paths that escape the root", () => {
    const root = join(tmpdir(), "cc-repo");
    expect(withinRoot(root, join(root, "..", "evil.txt"))).toBe(false);
    expect(withinRoot(root, join(tmpdir(), "cc-repo-sibling", "x"))).toBe(
      false,
    );
  });

  it("normalizes separator style (git forward-slash root vs native abs)", () => {
    // repoRoot() returns a forward-slash path from `git rev-parse
    // --show-toplevel`, but path.resolve(root, rel) yields native separators on
    // Windows — both sides must resolve to the same form or the guard would
    // wrongly reject (and skip deleting) legitimate in-repo files.
    const fwd = "C:/Users/x/repo";
    expect(withinRoot(fwd, "C:/Users/x/repo/new-file.txt")).toBe(true);
    expect(withinRoot(fwd, "C:/Users/x/repo-other/y.txt")).toBe(false);
  });
});
