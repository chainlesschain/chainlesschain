/**
 * cc loop — command surface (src/commands/loop.js).
 *
 * Drives the registered Commander command end-to-end against a real (fast)
 * child process in exec mode, so the full path — option parsing, `--` mode
 * detection, spawn + tee, stop conditions, summary — runs. Uses tiny
 * `node -e` children so the loop completes in well under a second.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { registerLoopCommand } from "../../src/commands/loop.js";

let logSpy;
let errSpy;
let exitCodeBefore;
let tmpDir;

/** Write a throwaway .js script (no shell-fragile embedded-space args). */
function writeScript(body) {
  const p = path.join(tmpDir, `s${Math.random().toString(36).slice(2)}.js`);
  fs.writeFileSync(p, body, "utf-8");
  return p;
}

function makeProgram() {
  const program = new Command();
  program.exitOverride();
  registerLoopCommand(program);
  return program;
}

/** Run `cc loop ...`; the trailing `--` + command, if any, must be in argv. */
async function run(...argv) {
  logSpy.mockClear();
  errSpy.mockClear();
  const program = makeProgram();
  await program.parseAsync(["node", "cc", "loop", ...argv]);
  return logSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
}

beforeEach(() => {
  exitCodeBefore = process.exitCode;
  process.exitCode = undefined;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-loop-"));
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
  process.exitCode = exitCodeBefore;
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("cc loop — validation", () => {
  it("errors with no prompt or command", async () => {
    await run();
    const err = errSpy.mock.calls
      .map((c) => c.map(String).join(" "))
      .join("\n");
    expect(err).toMatch(/nothing to loop/);
    expect(process.exitCode).toBe(1);
  });

  it("rejects a bad --every", async () => {
    await run("--every", "soon", "--", "node", "-e", "0");
    const err = errSpy.mock.calls
      .map((c) => c.map(String).join(" "))
      .join("\n");
    expect(err).toMatch(/invalid duration/);
    expect(process.exitCode).toBe(1);
  });

  it("rejects a non-positive --max-iterations", async () => {
    await run("--max-iterations", "0", "--", "node", "-e", "0");
    const err = errSpy.mock.calls
      .map((c) => c.map(String).join(" "))
      .join("\n");
    expect(err).toMatch(/positive integer/);
    expect(process.exitCode).toBe(1);
  });

  it("rejects an invalid --until regex", async () => {
    await run("--until", "(", "--", "node", "-e", "0");
    const err = errSpy.mock.calls
      .map((c) => c.map(String).join(" "))
      .join("\n");
    expect(err).toMatch(/invalid --until regex/);
    expect(process.exitCode).toBe(1);
  });
});

describe("cc loop — exec mode", () => {
  it("runs an external command --max-iterations times and reports JSON", async () => {
    const out = await run(
      "--every",
      "1ms",
      "--max-iterations",
      "3",
      "--json",
      "--",
      "node",
      "-e",
      "process.exit(2)",
    );
    const summary = JSON.parse(out.slice(out.indexOf("{")));
    expect(summary.iterations).toBe(3);
    expect(summary.stoppedBy).toBe("max-iterations");
    expect(summary.lastExitCode).toBe(2);
    // exit code mirrors the last iteration when stopped on a condition.
    expect(process.exitCode).toBe(2);
  });

  it("stops early on --until-exit-zero", async () => {
    // Child exits 0 on the 2nd run by toggling a temp marker via env-free state:
    // use a counter file is overkill — instead a command that always exits 0,
    // with untilExitZero it must stop after iteration 1.
    const out = await run(
      "--every",
      "1ms",
      "--max-iterations",
      "10",
      "--until-exit-zero",
      "--json",
      "--",
      "node",
      "-e",
      "process.exit(0)",
    );
    const summary = JSON.parse(out.slice(out.indexOf("{")));
    expect(summary.iterations).toBe(1);
    expect(summary.stoppedBy).toBe("exit-zero");
    expect(process.exitCode).toBe(0);
  });

  it("stops on --until output match", async () => {
    const out = await run(
      "--every",
      "1ms",
      "--max-iterations",
      "10",
      "--until",
      "READY",
      "--json",
      "--",
      "node",
      "-e",
      "console.log('READY')",
    );
    const summary = JSON.parse(out.slice(out.indexOf("{")));
    expect(summary.iterations).toBe(1);
    expect(summary.stoppedBy).toBe("match");
  });
});

describe("cc loop — dynamic mode (exec)", () => {
  it("stops on a [[loop:stop]] directive printed by the command", async () => {
    const script = writeScript("console.log('working [[loop:stop]]');");
    const out = await run(
      "--dynamic",
      "--every",
      "1ms",
      "--max-iterations",
      "10",
      "--json",
      "--",
      "node",
      script,
    );
    const summary = JSON.parse(out.slice(out.indexOf("{")));
    expect(summary.iterations).toBe(1);
    expect(summary.stoppedBy).toBe("done");
  });

  it("honors a [[loop:next]] directive (uses it, not the --every fallback)", async () => {
    // Fallback is 9999ms; the directive sets 1ms. If the directive were ignored
    // the two-iteration run would take ~10s — it completes near-instantly.
    const script = writeScript("console.log('[[loop:next 1ms]]');");
    const startedAt = Date.now();
    const out = await run(
      "--dynamic",
      "--every",
      "9999ms",
      "--max-iterations",
      "2",
      "--json",
      "--",
      "node",
      script,
    );
    const elapsedMs = Date.now() - startedAt;
    const summary = JSON.parse(out.slice(out.indexOf("{")));
    expect(summary.iterations).toBe(2);
    expect(summary.stoppedBy).toBe("max-iterations");
    expect(elapsedMs).toBeLessThan(5000); // proves the 1ms directive was honored
  });
});
