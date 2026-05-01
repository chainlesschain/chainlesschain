/**
 * Integration test: cc mtc publish-skills (Phase 2 marketplace publisher).
 * --once mode is exercised; the daemon loop is structurally identical.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CLI_BIN = path.resolve(process.cwd(), "bin/chainlesschain.js");

function extractJson(text) {
  const lines = text.split(/\r?\n/);
  for (let s = 0; s < lines.length; s++) {
    const t = lines[s].trimStart();
    if (t.startsWith("{") || t.startsWith("[")) {
      for (let e = lines.length; e > s; e--) {
        try {
          return JSON.parse(lines.slice(s, e).join("\n"));
        } catch (_err) {
          /* try shorter */
        }
      }
    }
  }
  throw new Error(`No JSON in: ${text.slice(0, 300)}`);
}

describe("cc mtc publish-skills — marketplace daemon (--once)", () => {
  let tmpDir;

  function runCli(args) {
    return spawnSync(process.execPath, [CLI_BIN, ...args], {
      encoding: "utf-8",
      timeout: 30_000,
      env: { ...process.env, CHAINLESSCHAIN_HOME: tmpDir },
    });
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mtc-publish-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("--help advertises the command", () => {
    const r = spawnSync(process.execPath, [CLI_BIN, "mtc", "--help"], {
      encoding: "utf-8",
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("publish-skills");
  });

  it("first --once iteration publishes seq 000001", () => {
    const out = path.join(tmpDir, "out");
    const stateFile = path.join(tmpDir, "state.json");
    const r = runCli([
      "mtc",
      "publish-skills",
      "--namespace-prefix",
      "mtc/v1/skill",
      "--issuer",
      "mtca:cc:test-publisher",
      "--out",
      out,
      "--state-file",
      stateFile,
      "--once",
      "--json",
    ]);
    expect(r.status, r.stderr).toBe(0);

    const result = extractJson(r.stdout);
    if (
      result.iteration === "skipped" &&
      result.reason === "no skills discovered"
    ) {
      // Acceptable in environments without any skill packs — still verifies command wiring.
      return;
    }
    expect(result.iteration).toBe("published");
    expect(result.seq).toBe("000001");
    expect(result.namespace).toBe("mtc/v1/skill/000001");
    expect(result.tree_head_id).toMatch(/^sha256:/);
    expect(fs.existsSync(result.landmark_path)).toBe(true);
    expect(fs.existsSync(stateFile)).toBe(true);

    const state = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
    expect(state.last_seq).toBe(1);
    expect(state.history).toHaveLength(1);
  });

  it("second --once iteration with unchanged skills is a no-op", () => {
    const out = path.join(tmpDir, "out");
    const stateFile = path.join(tmpDir, "state.json");
    const args = [
      "mtc",
      "publish-skills",
      "--namespace-prefix",
      "mtc/v1/skill",
      "--issuer",
      "mtca:cc:test-publisher",
      "--out",
      out,
      "--state-file",
      stateFile,
      "--once",
      "--json",
    ];

    const first = runCli(args);
    expect(first.status, first.stderr).toBe(0);
    const firstResult = extractJson(first.stdout);
    if (firstResult.iteration === "skipped") {
      // Skip the rest — environment has no skills to publish.
      return;
    }

    const second = runCli(args);
    expect(second.status, second.stderr).toBe(0);
    const secondResult = extractJson(second.stdout);
    expect(secondResult.iteration).toBe("skipped");
    expect(secondResult.reason).toBe("fingerprint unchanged");
  });
});
