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
import {
  sessionPath,
  readEvents,
} from "../../src/harness/jsonl-session-store.js";

let logSpy;
let errSpy;
let chainlesschainHomeBefore;
let exitCodeBefore;
let tmpDir;
const createdSessions = [];

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
  chainlesschainHomeBefore = process.env.CHAINLESSCHAIN_HOME;
  process.env.CHAINLESSCHAIN_HOME = path.join(tmpDir, "home");
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
  // Remove any real session files the persistence tests created.
  while (createdSessions.length) {
    try {
      fs.rmSync(sessionPath(createdSessions.pop()), { force: true });
    } catch {
      /* best-effort */
    }
  }
  if (chainlesschainHomeBefore === undefined) {
    delete process.env.CHAINLESSCHAIN_HOME;
  } else {
    process.env.CHAINLESSCHAIN_HOME = chainlesschainHomeBefore;
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
      // A script file, not `node -e "process.exit(2)"`: exec mode is shell:true,
      // and under POSIX /bin/sh (dash) the "()" in an inline -e is a syntax
      // error. A plain path has no shell metachars and works cross-platform.
      writeScript("process.exit(2);"),
    );
    const summary = JSON.parse(out.slice(out.indexOf("{")));
    expect(summary.iterations).toBe(3);
    expect(summary.stoppedBy).toBe("max-iterations");
    expect(summary.lastExitCode).toBe(2);
    // exit code mirrors the last iteration when stopped on a condition.
    expect(process.exitCode).toBe(2);
  });

  it("stops early on --until-exit-zero", async () => {
    // A command that always exits 0; with untilExitZero the loop stops after
    // iteration 1. Script file (not `node -e`) — see the exec-mode note above.
    const out = await run(
      "--every",
      "1ms",
      "--max-iterations",
      "10",
      "--until-exit-zero",
      "--json",
      "--",
      "node",
      writeScript("process.exit(0);"),
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
      writeScript("console.log('READY');"),
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

  it("honors a [[loop:next]] directive (persists the directive interval)", async () => {
    // Deterministic (no wall-clock): persist via --save and assert the parsed
    // directive interval landed on the iteration record. The earlier wall-clock
    // form (elapsed < 5s vs a 9999ms fallback) flaked under full-suite load,
    // where subprocess spawn alone took ~8s. runLoop's use of nextDelayMs over
    // the fixed interval is covered deterministically in loop-core. A tiny 1ms
    // fallback keeps this fast whether or not the directive is honored.
    const id = `cc-loop-test-${Math.random().toString(36).slice(2)}`;
    createdSessions.push(id);
    const script = writeScript("console.log('[[loop:next 1ms]]');");
    const out = await run(
      "--save",
      id,
      "--dynamic",
      "--every",
      "1ms",
      "--max-iterations",
      "2",
      "--json",
      "--",
      "node",
      script,
    );
    const summary = JSON.parse(out.slice(out.indexOf("{")));
    expect(summary.iterations).toBe(2);
    expect(summary.stoppedBy).toBe("max-iterations");
    const iters = readEvents(id).filter((e) => e.type === "loop_iteration");
    expect(iters[0].data.nextDelayMs).toBe(1); // directive parsed & recorded
  });
});

describe("cc loop — --save / --resume persistence", () => {
  it("persists a loop then resumes it with cumulative iteration counting", async () => {
    const id = `cc-loop-test-${Math.random().toString(36).slice(2)}`;
    createdSessions.push(id);

    // 1) Save a 2-iteration loop.
    const out1 = await run(
      "--save",
      id,
      "--every",
      "1ms",
      "--max-iterations",
      "2",
      "--json",
      "--",
      "node",
      writeScript("process.exit(0);"),
    );
    const s1 = JSON.parse(out1.slice(out1.indexOf("{")));
    expect(s1.iterations).toBe(2);
    expect(s1.sessionId).toBe(id);

    const events1 = readEvents(id);
    expect(events1.filter((e) => e.type === "loop_config")).toHaveLength(1);
    expect(events1.filter((e) => e.type === "loop_iteration")).toHaveLength(2);
    expect(events1.filter((e) => e.type === "loop_end")).toHaveLength(1);

    // 2) Resume with an extended budget — no command needed (comes from config).
    const out2 = await run(
      "--resume",
      id,
      "--max-iterations",
      "4",
      "--every",
      "1ms",
      "--json",
    );
    const s2 = JSON.parse(out2.slice(out2.indexOf("{")));
    // 2 prior + 2 new = 4 cumulative.
    expect(s2.iterations).toBe(4);
    expect(s2.stoppedBy).toBe("max-iterations");

    const events2 = readEvents(id);
    expect(events2.filter((e) => e.type === "loop_iteration")).toHaveLength(4);
  });

  it("errors when resuming a non-existent session", async () => {
    await run("--resume", "definitely-not-a-real-session-xyz");
    const err = errSpy.mock.calls
      .map((c) => c.map(String).join(" "))
      .join("\n");
    expect(err).toMatch(/no such loop session/);
    expect(process.exitCode).toBe(1);
  });
});
