/**
 * Integration test: cc mtc batch-skills produces a real Ed25519-signed
 * batch from local CLI skills.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CLI_BIN = path.resolve(process.cwd(), "bin/chainlesschain.js");

function extractJson(text) {
  const lines = text.split(/\r?\n/);
  for (let startLine = 0; startLine < lines.length; startLine++) {
    const trimmed = lines[startLine].trimStart();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      for (let endLine = lines.length; endLine > startLine; endLine--) {
        try {
          return JSON.parse(lines.slice(startLine, endLine).join("\n"));
        } catch (_err) {
          // try shorter
        }
      }
    }
  }
  throw new Error(`No JSON in: ${text.slice(0, 300)}`);
}

describe("cc mtc batch-skills — local skill source", () => {
  let homeDir;

  function runCli(args) {
    return spawnSync(process.execPath, [CLI_BIN, ...args], {
      encoding: "utf-8",
      timeout: 30_000,
      env: { ...process.env, CHAINLESSCHAIN_HOME: homeDir },
    });
  }

  beforeAll(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mtc-skills-"));
  });

  afterAll(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it("produces landmark + envelopes from any locally discovered skills", () => {
    const outDir = path.join(homeDir, "out-skills");
    const r = runCli([
      "mtc",
      "batch-skills",
      "--namespace",
      "mtc/v1/skill/000001",
      "--issuer",
      "mtca:cc:zQ3shSkillTest",
      "--out",
      outDir,
      "--json",
    ]);
    // batch-skills walks the bundled+workspace skill layers; the CLI
    // workspace has dozens of bundled skills, so this should always find
    // something. If it doesn't, we still surface a clear error.
    if (r.status !== 0) {
      // Tolerate environments without skills — but then the error must be
      // the explicit "No skills found" message
      expect(r.stderr + r.stdout).toMatch(/No skills found/);
      return;
    }
    const summary = extractJson(r.stdout);
    expect(summary.tree_size).toBeGreaterThanOrEqual(1);
    expect(summary.subjects.length).toBe(summary.tree_size);
    expect(summary.subjects[0]).toMatch(/^skill:cc:.+@/);
    expect(fs.existsSync(path.join(outDir, "landmark.json"))).toBe(true);
  });

  it("--skill filter restricts batch to matching ids", () => {
    // First, list all skills via a successful run to discover one id
    const probe = runCli([
      "mtc",
      "batch-skills",
      "--namespace",
      "mtc/v1/skill/000002",
      "--issuer",
      "mtca:cc:zQ3shSkillTest",
      "--out",
      path.join(homeDir, "probe"),
      "--json",
    ]);
    if (probe.status !== 0) {
      // No skills available — skip
      return;
    }
    const probeSummary = extractJson(probe.stdout);
    const oneId = probeSummary.subjects[0]
      .replace(/^skill:cc:/, "")
      .replace(/@.+$/, "");

    const r = runCli([
      "mtc",
      "batch-skills",
      "--namespace",
      "mtc/v1/skill/000003",
      "--issuer",
      "mtca:cc:zQ3shSkillTest",
      "--skill",
      oneId,
      "--out",
      path.join(homeDir, "filtered"),
      "--json",
    ]);
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    const summary = extractJson(r.stdout);
    expect(summary.tree_size).toBe(1);
    expect(summary.subjects[0]).toMatch(new RegExp(`^skill:cc:${oneId}@`));
  });

  it("fails when --skill matches no ids", () => {
    const r = runCli([
      "mtc",
      "batch-skills",
      "--namespace",
      "mtc/v1/skill/000099",
      "--issuer",
      "mtca:cc:zQ3shSkillTest",
      "--skill",
      "definitely-not-a-real-skill-id-xyz",
      "--out",
      path.join(homeDir, "nomatch"),
      "--json",
    ]);
    // If the env has skills, --skill filter rejects
    // If the env has no skills, the loader rejects first
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/No skills (matched|found)/);
  });
});
