/**
 * cc hook replay / hook events-log + the settings-hook-events recording wire.
 *
 * Drives the Commander subcommands against a seeded temp log (via --file so no
 * real home dir is touched) and asserts the opt-in recording wire: a fired
 * settings hook is persisted to the log only when CC_HOOK_EVENT_LOG is enabled.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { registerHookCommand } from "../../src/commands/hook.js";

const require = createRequire(import.meta.url);
const { appendHookEvent } = require("../../src/lib/hook-event-log.cjs");
const { buildHookEnvelope } = require("../../src/lib/hook-event-bus.cjs");

let tmp, file, logSpy, errSpy;

function makeProgram() {
  const program = new Command();
  program.exitOverride();
  registerHookCommand(program);
  return program;
}

async function run(...argv) {
  logSpy.mockClear();
  errSpy.mockClear();
  process.exitCode = 0;
  await makeProgram().parseAsync(["node", "cc", "hook", ...argv]);
  return logSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
}

function seed(eventType, data, deliveryId) {
  appendHookEvent(
    buildHookEnvelope({ eventType, data, sessionId: "s1", now: 1, deliveryId }),
    { filePath: file },
  );
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-hookreplay-"));
  file = path.join(tmp, "hook-events.jsonl");
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "cwd").mockReturnValue(tmp);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CC_HOOK_EVENT_LOG;
  process.exitCode = 0;
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("cc hook events-log", () => {
  it("lists recorded events as JSON", async () => {
    seed("SessionEnd", { source: "clear" }, "evt_obs");
    const out = await run("events-log", "--json", "--file", file);
    const parsed = JSON.parse(out);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0].event_id).toBe("evt_obs");
  });

  it("verifies the hash chain", async () => {
    seed("SessionEnd", { a: 1 }, "evt_a");
    seed("Stop", { a: 2 }, "evt_b");
    const out = await run("events-log", "--verify", "--json", "--file", file);
    expect(JSON.parse(out)).toMatchObject({ ok: true, length: 2 });
  });
});

describe("cc hook replay", () => {
  it("errors on an unknown event id", async () => {
    await run("replay", "evt_missing", "--file", file);
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.flat().join("\n")).toMatch(/not found/i);
  });

  it("dry-runs an observe-only event (marks replay payload)", async () => {
    seed("SessionEnd", { source: "clear" }, "evt_obs");
    const out = await run("replay", "evt_obs", "--json", "--file", file);
    const plan = JSON.parse(out);
    expect(plan.ok).toBe(true);
    expect(plan.executed).toBe(false);
    expect(plan.payload.replay).toBe(true);
    expect(plan.payload.replay_of).toBe("evt_obs");
  });

  it("refuses a decision-hook replay without --sandbox", async () => {
    seed("UserPromptSubmit", { prompt: "hi" }, "evt_dec");
    const out = await run("replay", "evt_dec", "--json", "--file", file);
    expect(JSON.parse(out).ok).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it("allows a decision-hook dry-run with --sandbox but never executes it", async () => {
    seed("UserPromptSubmit", { prompt: "hi" }, "evt_dec");
    const dry = await run(
      "replay",
      "evt_dec",
      "--sandbox",
      "--json",
      "--file",
      file,
    );
    expect(JSON.parse(dry)).toMatchObject({
      ok: true,
      sandboxed: true,
      executed: false,
    });
    const ran = await run(
      "replay",
      "evt_dec",
      "--run",
      "--sandbox",
      "--json",
      "--file",
      file,
    );
    expect(JSON.parse(ran).executed).toBe(false); // no real sandbox executor yet
  });

  it("executes an observe-only replay with --run (no matching hooks → 0)", async () => {
    seed("SessionEnd", { source: "clear" }, "evt_obs");
    const out = await run(
      "replay",
      "evt_obs",
      "--run",
      "--json",
      "--file",
      file,
    );
    const res = JSON.parse(out);
    expect(res.executed).toBe(true);
    expect(res.outcome.results).toEqual([]);
  });
});

describe("settings-hook-events recording wire (opt-in)", () => {
  let hookLog, settingsHookEvents, origOs;

  beforeEach(() => {
    hookLog = require("../../src/lib/hook-event-log.cjs");
    settingsHookEvents = require("../../src/lib/settings-hook-events.cjs");
    origOs = hookLog._deps.os;
    hookLog._deps.os = { homedir: () => tmp }; // redirect default log path into tmp
  });

  afterEach(() => {
    hookLog._deps.os = origOs;
  });

  const defaultLog = () =>
    path.join(tmp, ".chainlesschain", "hook-events.jsonl");

  it("does NOT record when disabled", () => {
    settingsHookEvents.runObserveHooks(
      { Stop: [{ matcher: "*", hooks: [{ command: "node -e \"''\"" }] }] },
      "Stop",
      {},
      { cwd: tmp },
    );
    expect(fs.existsSync(defaultLog())).toBe(false);
  });

  it("records the delivered envelope when CC_HOOK_EVENT_LOG is on", () => {
    process.env.CC_HOOK_EVENT_LOG = "1";
    settingsHookEvents.runObserveHooks(
      { Stop: [{ matcher: "*", hooks: [{ command: "node -e \"''\"" }] }] },
      "Stop",
      {},
      { cwd: tmp },
    );
    expect(fs.existsSync(defaultLog())).toBe(true);
    const records = hookLog.readHookEventRecords({ filePath: defaultLog() });
    expect(records).toHaveLength(1);
    expect(records[0].envelope.event_type).toBe("Stop");
  });
});
