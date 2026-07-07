import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadRegistry } from "../../src/commands/team.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, "..", "..", "bin", "chainlesschain.js");

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-team-io-"));
});
afterEach(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

function writeGraph(name, tasks) {
  const f = path.join(dir, name);
  fs.writeFileSync(f, JSON.stringify({ tasks }), "utf8");
  return f;
}

describe("cc team loadRegistry dependsOn validation", () => {
  it("rejects a dependsOn key that names no task (typo guard)", () => {
    // Pre-fix: the typo'd dependency made the task permanently unclaimable —
    // the run silently exited 1 and `plan` dropped it from the waves with no
    // diagnosis at all.
    const f = writeGraph("bad.json", [
      { key: "build", title: "build", command: "echo build" },
      {
        key: "test",
        title: "test",
        dependsOn: ["biuld"], // typo
        command: "echo test",
      },
    ]);
    expect(() => loadRegistry(f)).toThrow(/unknown task "biuld"/);
  });

  it("accepts a valid graph (including deps declared before their tasks)", () => {
    const f = writeGraph("good.json", [
      { key: "test", title: "test", dependsOn: ["build"], command: "x" },
      { key: "build", title: "build", command: "y" },
    ]);
    const reg = loadRegistry(f);
    expect(
      reg
        .list()
        .map((t) => t.key)
        .sort(),
    ).toEqual(["build", "test"]);
  });
});

describe("cc team run --state atomic persistence (CLI-level)", () => {
  it("writes the state file via tmp+rename and leaves no .tmp behind", () => {
    const graph = writeGraph("g.json", [
      { key: "a", title: "a", command: "echo a" },
      { key: "b", title: "b", dependsOn: ["a"], command: "echo b" },
    ]);
    const state = path.join(dir, "state.json");
    // Default mode is a dry-run (no side effects) but --state still persists
    // after each settle + at the end.
    execFileSync(
      process.execPath,
      [BIN, "team", "run", "--tasks", graph, "--state", state],
      { encoding: "utf8", timeout: 60000, cwd: dir },
    );
    const snap = JSON.parse(fs.readFileSync(state, "utf8"));
    expect(snap.version).toBe(2);
    expect(snap.registry).toBeTruthy();
    // Atomicity contract: the temp file must have been renamed away.
    expect(fs.existsSync(`${state}.tmp`)).toBe(false);
  });

  it("surfaces the unknown-dependency error to the CLI user (exit 1 + message)", () => {
    const graph = writeGraph("bad.json", [
      { key: "build", title: "build", command: "echo build" },
      { key: "test", title: "test", dependsOn: ["biuld"], command: "echo t" },
    ]);
    let failed = null;
    try {
      execFileSync(process.execPath, [BIN, "team", "run", "--tasks", graph], {
        encoding: "utf8",
        timeout: 60000,
        cwd: dir,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      failed = err;
    }
    expect(failed).toBeTruthy();
    const output = `${failed.stdout || ""}${failed.stderr || ""}`;
    expect(output).toMatch(/unknown task "biuld"/);
  });
});
