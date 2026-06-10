/**
 * cc loop — integration (multi-module, in-process, no internal mocks).
 *
 * Where the unit tests isolate the pure driver and the command surface, this
 * wires the real pieces together: the registered Commander command + the real
 * JSONL session store + real child processes. It exercises the seams that only
 * appear when those modules cooperate:
 *   - a save → resume → resume chain with cumulative iteration accounting and
 *     faithful loop_config reconstruction,
 *   - CLI flags overriding saved config on resume (interval + budget),
 *   - --dynamic directives driving cadence across rounds and being persisted,
 *   - the loop subcommand assembling into a real program with its full option set.
 *
 * Sessions are written to the real store under a unique id and cleaned up.
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
let exitCodeBefore;
let tmpDir;
const createdSessions = [];

function uniqueId() {
  return `cc-loop-it-${Math.random().toString(36).slice(2)}`;
}

function writeScript(body) {
  const p = path.join(tmpDir, `s${Math.random().toString(36).slice(2)}.js`);
  fs.writeFileSync(p, body, "utf-8");
  return p;
}

/** Drive `cc loop ...` against a fresh program; return captured stdout. */
async function run(...argv) {
  logSpy.mockClear();
  errSpy.mockClear();
  const program = new Command();
  program.exitOverride();
  registerLoopCommand(program);
  await program.parseAsync(["node", "cc", "loop", ...argv]);
  return logSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
}

/** Parse the trailing --json summary object out of captured stdout. */
function summaryOf(out) {
  return JSON.parse(out.slice(out.indexOf("{")));
}

beforeEach(() => {
  exitCodeBefore = process.exitCode;
  process.exitCode = undefined;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-loop-it-"));
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
  while (createdSessions.length) {
    try {
      fs.rmSync(sessionPath(createdSessions.pop()), { force: true });
    } catch {
      /* best-effort */
    }
  }
});

describe("cc loop integration — persistence chain", () => {
  it("save → resume → resume accumulates iterations and replays config", async () => {
    const id = uniqueId();
    createdSessions.push(id);
    // Script file, not `node -e "process.exit(0)"`: exec mode is shell:true and
    // the inline "()" is a POSIX /bin/sh (dash) syntax error. A path is portable.
    const script = writeScript("process.exit(0);");
    const exec = ["--", "node", script];

    // Save: 2 iterations.
    const a = summaryOf(
      await run(
        "--save",
        id,
        "--every",
        "1ms",
        "--max-iterations",
        "2",
        "--json",
        ...exec,
      ),
    );
    expect(a.iterations).toBe(2);
    expect(a.sessionId).toBe(id);

    // Resume to 4 (no command — reconstructed from saved loop_config).
    const b = summaryOf(
      await run(
        "--resume",
        id,
        "--max-iterations",
        "4",
        "--every",
        "1ms",
        "--json",
      ),
    );
    expect(b.iterations).toBe(4);

    // Resume again to 6.
    const c = summaryOf(
      await run(
        "--resume",
        id,
        "--max-iterations",
        "6",
        "--every",
        "1ms",
        "--json",
      ),
    );
    expect(c.iterations).toBe(6);

    const events = readEvents(id);
    // One config, six iteration records (2+2+2), three end markers.
    expect(events.filter((e) => e.type === "loop_config")).toHaveLength(1);
    expect(events.filter((e) => e.type === "loop_iteration")).toHaveLength(6);
    expect(events.filter((e) => e.type === "loop_end")).toHaveLength(3);
    // Config faithfully captured the exec invocation.
    const cfg = events.find((e) => e.type === "loop_config").data;
    expect(cfg.execMode).toBe(true);
    expect(cfg.operands).toEqual(["node", script]);
    // Iteration numbers are cumulative across the three runs.
    const ns = events
      .filter((e) => e.type === "loop_iteration")
      .map((e) => e.data.n);
    expect(ns).toEqual([1, 2, 3, 4, 5, 6]);
    // Each persisted iteration carries a measured duration.
    expect(
      events
        .filter((e) => e.type === "loop_iteration")
        .every((e) => typeof e.data.durationMs === "number"),
    ).toBe(true);
  });

  it("a re-passed flag overrides saved config on resume (interval)", async () => {
    const id = uniqueId();
    createdSessions.push(id);

    // Save with a 60s interval but only 1 iteration (no inter-run sleep yet).
    await run(
      "--save",
      id,
      "--every",
      "60000ms",
      "--max-iterations",
      "1",
      "--json",
      "--",
      "node",
      writeScript("process.exit(0);"),
    );

    // Resume extending to 3 (runs iterations 2 & 3 → one inter-run sleep) and
    // overriding --every to 1ms. If the saved 60s were used instead, that one
    // sleep would blow the 60s test timeout. Honored, only subprocess overhead
    // remains — a 30s budget tolerates a loaded full-suite run (observed ~8s
    // under contention) while cleanly separating the 60s fallback. The interval
    // override isn't persisted per-iteration, so wall-clock is the only signal.
    const started = Date.now();
    const out = summaryOf(
      await run(
        "--resume",
        id,
        "--max-iterations",
        "3",
        "--every",
        "1ms",
        "--json",
      ),
    );
    const elapsedMs = Date.now() - started;
    expect(out.iterations).toBe(3);
    expect(out.stoppedBy).toBe("max-iterations");
    expect(elapsedMs).toBeLessThan(30000);
  });
});

describe("cc loop integration — dynamic across rounds, persisted", () => {
  it("drives next→next→stop via directives and records them", async () => {
    const id = uniqueId();
    createdSessions.push(id);
    const counter = path.join(tmpDir, "cnt");
    // Emits [[loop:next 1ms]] for rounds 1-2, then [[loop:stop]] on round 3.
    const script = writeScript(`
      const fs = require('fs');
      let n = fs.existsSync(${JSON.stringify(counter)})
        ? Number(fs.readFileSync(${JSON.stringify(counter)}, 'utf8')) : 0;
      n++; fs.writeFileSync(${JSON.stringify(counter)}, String(n));
      process.stdout.write(n >= 3 ? 'done [[loop:stop]]' : 'go [[loop:next 1ms]]');
    `);

    const out = summaryOf(
      await run(
        "--save",
        id,
        "--dynamic",
        "--every",
        "9999ms",
        "--json",
        "--",
        "node",
        script,
      ),
    );
    expect(out.iterations).toBe(3);
    expect(out.stoppedBy).toBe("done");

    const iters = readEvents(id).filter((e) => e.type === "loop_iteration");
    expect(iters).toHaveLength(3);
    // Rounds 1-2 scheduled a 1ms next; round 3 stopped.
    expect(iters[0].data.nextDelayMs).toBe(1);
    expect(iters[1].data.nextDelayMs).toBe(1);
    expect(iters[2].data.done).toBe(true);
  });
});

describe("cc loop integration — registration", () => {
  it("assembles into a program with the full option surface", () => {
    const program = new Command();
    registerLoopCommand(program);
    const loop = program.commands.find((c) => c.name() === "loop");
    expect(loop).toBeTruthy();
    const flags = loop.options.map((o) => o.long);
    for (const f of [
      "--every",
      "--max-iterations",
      "--until-exit-zero",
      "--until",
      "--dynamic",
      "--save",
      "--resume",
      "--json",
    ]) {
      expect(flags).toContain(f);
    }
  });
});
