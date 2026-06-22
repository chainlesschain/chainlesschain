/**
 * E2E: `cc memory export/import` through the real cc bin + an isolated DB
 * (CHAINLESSCHAIN_HOME). Validates the full command path
 * (commander → bootstrap → ctx.db → exportMemory/importMemory → JSON) and an
 * add → export → import → export round-trip across two homes.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { testHome, CLI_BIN } from "./_helpers/cli-e2e.js";

function cc(home, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    env: home.env(),
    encoding: "utf-8",
    timeout: 90_000,
  });
}

/** Pull the JSON payload out of stdout (last line that parses as JSON). */
function jsonFromStdout(stdout) {
  const lines = (stdout || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].startsWith("[") || lines[i].startsWith("{")) {
      try {
        return JSON.parse(lines[i]);
      } catch {
        /* keep scanning upward */
      }
    }
  }
  throw new Error(`no JSON in stdout: ${stdout?.slice(0, 200)}`);
}

describe("cc memory export/import — e2e", () => {
  it("export on an empty home yields an empty array (command path works)", () => {
    const a = testHome("mem-e2e-empty");
    const r = cc(a, ["memory", "export", "--json"]);
    expect(r.status).toBe(0);
    expect(jsonFromStdout(r.stdout)).toEqual([]);
  });

  it("add → export → import into a fresh home → export shows the entry", () => {
    const a = testHome("mem-e2e-a");
    const b = testHome("mem-e2e-b");

    expect(cc(a, ["memory", "add", "妈妈=张三", "--json"]).status).toBe(0);

    const exp = cc(a, ["memory", "export", "--json"]);
    expect(exp.status).toBe(0);
    const entries = jsonFromStdout(exp.stdout);
    expect(entries.some((e) => String(e.content).includes("妈妈"))).toBe(true);

    fs.mkdirSync(b.home, { recursive: true });
    const file = path.join(b.home, "mem-export.json");
    fs.writeFileSync(file, JSON.stringify(entries), "utf-8");

    const imp = cc(b, ["memory", "import", "--input", file, "--json"]);
    expect(imp.status).toBe(0);
    expect(jsonFromStdout(imp.stdout).imported).toBeGreaterThanOrEqual(1);

    const expB = cc(b, ["memory", "export", "--json"]);
    expect(jsonFromStdout(expB.stdout).some((e) => String(e.content).includes("妈妈"))).toBe(true);
  });

  it("cc instinct export on an empty home yields []", () => {
    const r = cc(testHome("inst-e2e"), ["instinct", "export", "--json"]);
    expect(r.status).toBe(0);
    expect(jsonFromStdout(r.stdout)).toEqual([]);
  });

  it("cc learning export on an empty home yields []", () => {
    const r = cc(testHome("learn-e2e"), ["learning", "export", "--json"]);
    expect(r.status).toBe(0);
    expect(jsonFromStdout(r.stdout)).toEqual([]);
  });
});
