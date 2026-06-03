/**
 * build-win-with-deref unit tests for the symlink helpers.
 *
 * Coverage:
 *   - isSymlink: real symlink/junction → true; regular dir/missing → false
 *   - dereferenceOne: replaces symlink with verbatim copy, records original
 *     target; skips when not a symlink; throws when source missing; filters
 *     workspace pkg's own node_modules/ from the copy
 *   - detachTopLevelLinkOne: removes symlink, records target; skips when
 *     not a symlink
 *   - restoreOne / restoreTopLevelLinkOne: recreate as 'junction' on win32
 *     (the critical anti-EPERM rule from issue #6 attempt)
 *
 * Doesn't cover main() — that runs electron-builder via spawnSync. Mocking
 * spawnSync via vi.mock("child_process") is unreliable in vitest forks pool
 * (per .claude/rules/testing.md). The unit boundary is the pure-fs helpers;
 * the spawnSync wrapper is small and tested empirically by `npm run make:win:builder`.
 *
 * Windows symlink note: junction creation requires no admin privs (vs 'dir'
 * symlinks which need SeCreateSymbolicLinkPrivilege). All tests use 'junction'
 * to ensure they run in unprivileged CI environments.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isSymlink,
  dereferenceOne,
  detachTopLevelLinkOne,
  restoreOne,
  restoreTopLevelLinkOne,
  WORKSPACE_PKGS,
  TOP_LEVEL_DETACH_LINKS,
} from "../../../scripts/build-win-with-deref.js";

let tmp;

function mkdir(rel) {
  const full = path.join(tmp, rel);
  fs.mkdirSync(full, { recursive: true });
  return full;
}

function write(rel, body) {
  const full = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, "utf-8");
  return full;
}

/**
 * Create a directory symlink. On Windows uses 'junction' (no admin needed).
 * On posix this is silently treated as 'dir'.
 */
function symlinkDir(target, linkPath) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  const linkType = process.platform === "win32" ? "junction" : "dir";
  fs.symlinkSync(target, linkPath, linkType);
}

beforeEach(() => {
  // macOS symlinks `/var → /private/var`, so `os.tmpdir()` returns the
  // un-canonicalized form but anything the SUT runs through fs.realpath /
  // readlink resolves to the `/private/var/...` canonical form. Canonicalize
  // at creation time so path-equality assertions hold cross-platform.
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "build-deref-")));
});

afterEach(() => {
  if (tmp && fs.existsSync(tmp)) {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

describe("isSymlink", () => {
  it("returns true for a directory symlink/junction", () => {
    const target = mkdir("target");
    fs.writeFileSync(path.join(target, "x.txt"), "hi");
    const link = path.join(tmp, "linked");
    symlinkDir(target, link);
    expect(isSymlink(link)).toBe(true);
  });

  it("returns false for a regular directory", () => {
    const dir = mkdir("plain");
    expect(isSymlink(dir)).toBe(false);
  });

  it("returns false for a missing path", () => {
    expect(isSymlink(path.join(tmp, "nonexistent"))).toBe(false);
  });

  it("returns false for a regular file", () => {
    const f = write("f.txt", "x");
    expect(isSymlink(f)).toBe(false);
  });
});

describe("dereferenceOne", () => {
  it("replaces a workspace symlink with a verbatim copy and records the original target", () => {
    // Source pkg ("../packages/core-mtc"-like).
    const source = mkdir("packages/core-mtc");
    fs.writeFileSync(
      path.join(source, "package.json"),
      '{"name":"@chainlesschain/core-mtc","version":"1.0.0"}',
    );
    fs.writeFileSync(path.join(source, "lib.js"), "module.exports = 1;\n");

    // node_modules/@chainlesschain/core-mtc → source.
    const scopeDir = mkdir("node_modules/@chainlesschain");
    const link = path.join(scopeDir, "core-mtc");
    symlinkDir(source, link);

    const record = dereferenceOne(
      { name: "core-mtc", sourcePath: source },
      scopeDir,
    );

    expect(record).not.toBeNull();
    expect(record.name).toBe("core-mtc");
    expect(path.resolve(record.originalTarget)).toBe(path.resolve(source));

    // The link is now a real directory (not a symlink) with copied contents.
    expect(isSymlink(link)).toBe(false);
    expect(fs.existsSync(path.join(link, "package.json"))).toBe(true);
    expect(fs.readFileSync(path.join(link, "lib.js"), "utf-8")).toBe(
      "module.exports = 1;\n",
    );
  });

  it("filters the source pkg's own node_modules/ out of the verbatim copy", () => {
    const source = mkdir("packages/core-mtc");
    fs.writeFileSync(path.join(source, "package.json"), '{"name":"core-mtc"}');
    // Source has a hefty dev-only node_modules/ — should NOT land in the copy.
    const sourceNm = path.join(source, "node_modules");
    fs.mkdirSync(path.join(sourceNm, "vitest"), { recursive: true });
    fs.writeFileSync(
      path.join(sourceNm, "vitest", "package.json"),
      '{"name":"vitest"}',
    );

    const scopeDir = mkdir("node_modules/@chainlesschain");
    const link = path.join(scopeDir, "core-mtc");
    symlinkDir(source, link);

    dereferenceOne({ name: "core-mtc", sourcePath: source }, scopeDir);

    // Filter dropped node_modules/ entirely.
    expect(fs.existsSync(path.join(link, "node_modules"))).toBe(false);
    // Other contents preserved.
    expect(fs.existsSync(path.join(link, "package.json"))).toBe(true);
  });

  it("returns null when the link is not a symlink (already dereferenced)", () => {
    const scopeDir = mkdir("node_modules/@chainlesschain");
    // Plain directory, no symlink.
    mkdir("node_modules/@chainlesschain/core-mtc");
    fs.writeFileSync(
      path.join(scopeDir, "core-mtc", "package.json"),
      '{"name":"core-mtc"}',
    );

    const source = mkdir("packages/core-mtc");
    const record = dereferenceOne(
      { name: "core-mtc", sourcePath: source },
      scopeDir,
    );

    expect(record).toBeNull();
  });

  it("throws when sourcePath is missing", () => {
    const scopeDir = mkdir("node_modules/@chainlesschain");
    const link = path.join(scopeDir, "core-mtc");
    // Symlink to a target that exists at link-time but we pass a different
    // (missing) sourcePath as a sanity-check parameter.
    const realTarget = mkdir("packages/something-else");
    symlinkDir(realTarget, link);

    expect(() =>
      dereferenceOne(
        {
          name: "core-mtc",
          sourcePath: path.join(tmp, "packages", "missing"),
        },
        scopeDir,
      ),
    ).toThrow(/source path missing/);
  });
});

describe("detachTopLevelLinkOne", () => {
  it("removes the symlink and records its target", () => {
    const repoRoot = mkdir("repo-root");
    fs.writeFileSync(path.join(repoRoot, "marker"), "x");
    const linkPath = path.join(tmp, "node_modules", "chainlesschain");
    symlinkDir(repoRoot, linkPath);

    const record = detachTopLevelLinkOne({ name: "chainlesschain", linkPath });

    expect(record).not.toBeNull();
    expect(record.name).toBe("chainlesschain");
    // After detach the link must be gone.
    expect(fs.existsSync(linkPath)).toBe(false);
  });

  it("returns null when the link is not a symlink", () => {
    const linkPath = mkdir("node_modules/plain-dir");
    const record = detachTopLevelLinkOne({ name: "plain-dir", linkPath });
    expect(record).toBeNull();
    // We did NOT delete it.
    expect(fs.existsSync(linkPath)).toBe(true);
  });
});

describe("restoreOne", () => {
  it("recreates the workspace symlink pointing to original target (junction on win32)", () => {
    const target = mkdir("packages/core-mtc");
    fs.writeFileSync(path.join(target, "x"), "x");
    const scopeDir = mkdir("node_modules/@chainlesschain");

    // Pretend a verbatim copy lives at the link path post-dereference.
    const link = path.join(scopeDir, "core-mtc");
    fs.mkdirSync(link, { recursive: true });
    fs.writeFileSync(path.join(link, "stale"), "stale");

    restoreOne({ name: "core-mtc", originalTarget: target }, scopeDir);

    // Link is a real symlink/junction now.
    expect(isSymlink(link)).toBe(true);
    // realpath resolves to the original target.
    expect(path.resolve(fs.realpathSync(link))).toBe(path.resolve(target));
    // Contents come from target, not the stale copy.
    expect(fs.existsSync(path.join(link, "stale"))).toBe(false);
    expect(fs.existsSync(path.join(link, "x"))).toBe(true);
  });
});

describe("restoreTopLevelLinkOne", () => {
  it("recreates the top-level symlink at its original location", () => {
    const repoRoot = mkdir("repo-root");
    fs.writeFileSync(path.join(repoRoot, "marker"), "x");
    const linkPath = path.join(tmp, "node_modules", "chainlesschain");
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });

    restoreTopLevelLinkOne({
      name: "chainlesschain",
      linkPath,
      originalTarget: repoRoot,
    });

    expect(isSymlink(linkPath)).toBe(true);
    expect(path.resolve(fs.realpathSync(linkPath))).toBe(
      path.resolve(repoRoot),
    );
  });

  it("clobbers any pre-existing path at linkPath before recreating", () => {
    const repoRoot = mkdir("repo-root");
    const linkPath = path.join(tmp, "node_modules", "chainlesschain");
    fs.mkdirSync(linkPath, { recursive: true });
    fs.writeFileSync(path.join(linkPath, "stale"), "stale");

    restoreTopLevelLinkOne({
      name: "chainlesschain",
      linkPath,
      originalTarget: repoRoot,
    });

    expect(isSymlink(linkPath)).toBe(true);
    expect(fs.existsSync(path.join(linkPath, "stale"))).toBe(false);
  });
});

describe("module-level constants", () => {
  it("declares the 2 workspace pkgs that need dereferencing", () => {
    expect(WORKSPACE_PKGS.map((p) => p.name).sort()).toEqual([
      "core-mtc",
      "session-core",
    ]);
    for (const pkg of WORKSPACE_PKGS) {
      expect(pkg.sourcePath).toMatch(/packages[\\/](core-mtc|session-core)$/);
    }
  });

  it("declares the top-level chainlesschain link to detach", () => {
    expect(TOP_LEVEL_DETACH_LINKS.map((e) => e.name)).toEqual([
      "chainlesschain",
    ]);
    expect(TOP_LEVEL_DETACH_LINKS[0].linkPath).toMatch(
      /node_modules[\\/]chainlesschain$/,
    );
  });
});
