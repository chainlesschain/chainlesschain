import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { resolveContainedProjectPath } = require("../project-path-security.js");

const temporaryRoots = [];

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "cc-project-path-"));
  temporaryRoots.push(base);
  const root = path.join(base, "projects");
  const outside = path.join(base, "outside");
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  return { base, root, outside };
}

afterEach(() => {
  for (const target of temporaryRoots.splice(0)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("resolveContainedProjectPath", () => {
  it("resolves project-relative and virtual project paths", () => {
    const { root } = fixture();
    expect(resolveContainedProjectPath(root, "alpha/file.txt")).toBe(
      path.join(root, "alpha", "file.txt"),
    );
    expect(
      resolveContainedProjectPath(root, "/data/projects/beta/file.txt"),
    ).toBe(path.join(root, "beta", "file.txt"));
  });

  it("rejects traversal and absolute paths outside the project root", () => {
    const { root, outside } = fixture();
    expect(() =>
      resolveContainedProjectPath(root, "../outside/secret.txt"),
    ).toThrow(/outside the projects root/);
    expect(() =>
      resolveContainedProjectPath(root, path.join(outside, "secret.txt")),
    ).toThrow(/outside the projects root/);
  });

  it("rejects a missing target beneath a symlink or junction escape", () => {
    const { root, outside } = fixture();
    const link = path.join(root, "linked");
    fs.symlinkSync(
      outside,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(() =>
      resolveContainedProjectPath(root, "linked/new-file.txt"),
    ).toThrow(/escapes the projects root through a symlink/);
  });

  it("fails closed when the configured project root cannot be verified", () => {
    const missing = path.join(os.tmpdir(), `cc-missing-${Date.now()}`);
    expect(() => resolveContainedProjectPath(missing, "file.txt")).toThrow(
      /Projects root cannot be verified/,
    );
  });
});
