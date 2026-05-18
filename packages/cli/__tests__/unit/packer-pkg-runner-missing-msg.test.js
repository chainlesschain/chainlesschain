/**
 * Unit tests: src/lib/packer/pkg-runner.js — buildPkgMissingMessage()
 *
 * The CLI is shipped in three install shapes (monorepo workspace, npm -g
 * global, plain local install). Each one needs a different `npm install`
 * invocation to add @yao-pkg/pkg to the right node_modules. A misleading
 * hint already burned a real user (test1 project, global nvm install) —
 * lock the three branches in.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPkgMissingMessage } from "../../src/lib/packer/pkg-runner.js";

describe("buildPkgMissingMessage", () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pkg-runner-msg-"));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("monorepo: parent package.json declares workspaces → suggests --workspace command", () => {
    const repoRoot = path.join(tmpRoot, "repo");
    const cliRoot = path.join(repoRoot, "packages", "cli");
    fs.mkdirSync(cliRoot, { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({ name: "monorepo", workspaces: ["packages/*"] }),
    );

    const msg = buildPkgMissingMessage(cliRoot);
    expect(msg).toContain(
      "npm install -D @yao-pkg/pkg --workspace packages/cli",
    );
    expect(msg).not.toContain("cd ");
  });

  it("global: cliRoot's parent is node_modules → suggests cd <cliRoot> && npm install", () => {
    const cliRoot = path.join(tmpRoot, "node_modules", "chainlesschain");
    fs.mkdirSync(cliRoot, { recursive: true });

    const msg = buildPkgMissingMessage(cliRoot);
    expect(msg).toContain(`cd "${cliRoot}"`);
    expect(msg).toContain("npm install @yao-pkg/pkg");
    expect(msg).not.toContain("--workspace");
    expect(msg).not.toContain("-D @yao-pkg/pkg");
  });

  it("standalone: no workspaces ancestor and not in node_modules → generic cd <cliRoot> && npm install -D", () => {
    const cliRoot = path.join(tmpRoot, "some-checkout");
    fs.mkdirSync(cliRoot, { recursive: true });

    const msg = buildPkgMissingMessage(cliRoot);
    expect(msg).toContain(`cd "${cliRoot}"`);
    expect(msg).toContain("npm install -D @yao-pkg/pkg");
    expect(msg).not.toContain("--workspace");
  });

  it("malformed ancestor package.json does not crash classification", () => {
    const repoRoot = path.join(tmpRoot, "broken-repo");
    const cliRoot = path.join(repoRoot, "packages", "cli");
    fs.mkdirSync(cliRoot, { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "package.json"), "{ not valid json");

    const msg = buildPkgMissingMessage(cliRoot);
    expect(msg).toContain("@yao-pkg/pkg");
    expect(msg).toContain(cliRoot);
  });
});
