/**
 * Sandbox filesystem path policy — the pure decision that gates read/write
 * access under allow/deny roots. Verifies it closes the three bypasses the old
 * `filePath.startsWith(root)` check let through: path traversal, boundary
 * confusion, and symlink escape. Paths are built with `path.resolve` so the
 * suite is platform-agnostic (Windows drive letters + POSIX both work).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  evaluatePathAccess,
  isWithinRoot,
} from "../../src/lib/sandbox-fs-policy.js";

const R = (p) => path.resolve(p); // platform-native absolute form

describe("isWithinRoot", () => {
  it("treats a path as inside its own root and nested children", () => {
    expect(isWithinRoot(R("/tmp"), R("/tmp"))).toBe(true);
    expect(isWithinRoot(R("/tmp"), path.join(R("/tmp"), "a", "b"))).toBe(true);
  });
  it("rejects a sibling that only shares a string prefix (boundary)", () => {
    // `/tmpfoo` starts with `/tmp` as a STRING but is a different tree.
    expect(isWithinRoot(R("/tmp"), path.join(R("/tmpfoo"), "x"))).toBe(false);
  });
  it("rejects an escape via ..", () => {
    expect(isWithinRoot(R("/tmp"), R("/etc"))).toBe(false);
  });
});

describe("evaluatePathAccess — legitimate access", () => {
  it("allows a read inside an allowed root", () => {
    const r = evaluatePathAccess(path.join(R("/tmp"), "foo.txt"), {
      mode: "read",
      policy: { read: [R("/tmp")] },
    });
    expect(r.allowed).toBe(true);
  });
  it("allows a write inside an allowed write root but not read (separate lists)", () => {
    const target = path.join(R("/data"), "out.bin");
    expect(
      evaluatePathAccess(target, {
        mode: "write",
        policy: { write: [R("/data")] },
      }).allowed,
    ).toBe(true);
    // read list is empty → reading the same path is denied.
    expect(
      evaluatePathAccess(target, {
        mode: "read",
        policy: { write: [R("/data")] },
      }).allowed,
    ).toBe(false);
  });
  it("resolves a relative target against cwd", () => {
    const r = evaluatePathAccess(path.join("sub", "f.txt"), {
      mode: "read",
      cwd: R("/work"),
      policy: { read: [R("/work")] },
    });
    expect(r.allowed).toBe(true);
  });
});

describe("evaluatePathAccess — the three bypasses", () => {
  it("BLOCKS path traversal that escapes an allowed root", () => {
    // `/tmp/../etc/passwd` — startsWith('/tmp') is true, but it resolves to /etc.
    const traversal =
      R("/tmp") + path.sep + ".." + path.sep + "etc" + path.sep + "passwd";
    const r = evaluatePathAccess(traversal, {
      mode: "read",
      policy: { read: [R("/tmp")] },
    });
    expect(r.allowed).toBe(false);
  });

  it("BLOCKS boundary confusion (/tmpfoo vs /tmp)", () => {
    const r = evaluatePathAccess(path.join(R("/tmpfoo"), "secret"), {
      mode: "read",
      policy: { read: [R("/tmp")] },
    });
    expect(r.allowed).toBe(false);
  });

  it("BLOCKS a symlink inside an allowed root that points outside it", () => {
    const base = R("/tmp/safe");
    const linkDir = path.join(base, "link");
    const escaped = R("/etc");
    // Injected realpath: linkDir (and its children) really live under /etc.
    const realpath = (p) => {
      const rel = path.relative(linkDir, p);
      if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
        return path.join(escaped, rel);
      }
      return p; // identity elsewhere (root `base` stays put)
    };
    const r = evaluatePathAccess(path.join(linkDir, "creds"), {
      mode: "read",
      policy: { read: [base] },
      realpath,
    });
    expect(r.allowed).toBe(false); // resolved real path is /etc/creds → outside
    expect(r.reason).not.toMatch(/within/);
  });
});

describe("evaluatePathAccess — precedence + defaults", () => {
  it("denies when the path falls under a deny root even if also allowed", () => {
    const r = evaluatePathAccess(path.join(R("/tmp"), "secret", "k"), {
      mode: "read",
      policy: { read: [R("/tmp")], denied: [path.join(R("/tmp"), "secret")] },
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/denied/);
  });
  it("default-denies with an empty allow list", () => {
    expect(
      evaluatePathAccess(path.join(R("/tmp"), "x"), {
        mode: "read",
        policy: { read: [] },
      }).allowed,
    ).toBe(false);
  });
  it("rejects an unknown mode and an empty path", () => {
    expect(
      evaluatePathAccess(R("/tmp/x"), {
        mode: "exec",
        policy: { read: [R("/tmp")] },
      }).allowed,
    ).toBe(false);
    expect(evaluatePathAccess("", { mode: "read" }).allowed).toBe(false);
    expect(evaluatePathAccess(null, { mode: "read" }).allowed).toBe(false);
  });
});

describe("evaluatePathAccess — real filesystem symlink (skips if unprivileged)", () => {
  it("catches a real on-disk symlink escaping the allowed dir", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-fsp-"));
    const safe = path.join(tmp, "safe");
    const outside = path.join(tmp, "outside");
    fs.mkdirSync(safe);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "secret.txt"), "TOP", "utf8");
    let linked = false;
    try {
      fs.symlinkSync(outside, path.join(safe, "link"), "dir");
      linked = true;
    } catch {
      // Windows without Developer Mode / admin can't create symlinks → skip.
    }
    try {
      if (!linked) return; // environment can't exercise this path
      const r = evaluatePathAccess(path.join(safe, "link", "secret.txt"), {
        mode: "read",
        policy: { read: [safe] }, // only `safe` is allowed
      });
      // The symlink resolves outside `safe`, so a real read would escape — deny.
      expect(r.allowed).toBe(false);
      // Sanity: a genuine file directly inside `safe` is allowed.
      fs.writeFileSync(path.join(safe, "ok.txt"), "hi", "utf8");
      expect(
        evaluatePathAccess(path.join(safe, "ok.txt"), {
          mode: "read",
          policy: { read: [safe] },
        }).allowed,
      ).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
