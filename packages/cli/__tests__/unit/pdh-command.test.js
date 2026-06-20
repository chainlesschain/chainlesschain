/**
 * `cc pdh` command surface (list / status / doctor) — JSON shape + the security
 * invariant that the raw bearer token is NEVER printed. Mirrors
 * ide-command.test.js for the PDH bridge (module 101).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import { registerPdhCommand } from "../../src/commands/pdh.js";
import { _deps } from "../../src/lib/pdh-bridge.js";

const NOW = 1_700_000_000_000;
let files;
const orig = {};
let logSpy;
const origEnvPort = process.env.CHAINLESSCHAIN_PDH_PORT;
const origEnvFlag = process.env.CHAINLESSCHAIN_PDH;

async function run(...argv) {
  logSpy.mockClear();
  const program = new Command();
  program.exitOverride();
  registerPdhCommand(program);
  await program.parseAsync(["node", "cc", "pdh", ...argv]);
  return logSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
}

beforeEach(() => {
  for (const k of Object.keys(_deps)) orig[k] = _deps[k];
  // A clean env so discovery is deterministic (no inherited PDH wiring).
  delete process.env.CHAINLESSCHAIN_PDH_PORT;
  delete process.env.CHAINLESSCHAIN_PDH;
  files = {
    "41320.json": JSON.stringify({
      kind: "pdh-bridge",
      device: "pixel-7",
      appUid: 10306,
      transport: "http",
      url: "http://127.0.0.1:41320/mcp",
      port: 41320,
      token: "SUPER-SECRET-TOKEN",
      pid: 4242,
      started_at: NOW,
    }),
  };
  _deps.homedir = () => "/home/u";
  _deps.now = () => NOW;
  _deps.processAlive = () => true;
  _deps.readDir = () => Object.keys(files);
  _deps.readFile = (p) => {
    const name = p.replace(/\\/g, "/").split("/").pop();
    if (files[name] === undefined) throw new Error("ENOENT");
    return files[name];
  };
  _deps.statMtimeMs = () => NOW;
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  for (const k of Object.keys(orig)) _deps[k] = orig[k];
  if (origEnvPort === undefined) delete process.env.CHAINLESSCHAIN_PDH_PORT;
  else process.env.CHAINLESSCHAIN_PDH_PORT = origEnvPort;
  if (origEnvFlag === undefined) delete process.env.CHAINLESSCHAIN_PDH;
  else process.env.CHAINLESSCHAIN_PDH = origEnvFlag;
  vi.restoreAllMocks();
});

describe("cc pdh list --json", () => {
  it("lists the lock with hasToken, never the raw token or _file", async () => {
    const out = await run("list", "--json");
    expect(out).not.toMatch(/SUPER-SECRET-TOKEN/);
    const parsed = JSON.parse(out);
    expect(parsed.count).toBe(1);
    expect(parsed.locks[0]).toMatchObject({
      port: 41320,
      device: "pixel-7",
      hasToken: true,
    });
    expect(parsed.locks[0].token).toBeUndefined();
    expect(parsed.locks[0]._file).toBeUndefined();
  });

  it("reports zero locks when the dir is empty", async () => {
    _deps.readDir = () => [];
    const out = await run("list", "--json");
    const parsed = JSON.parse(out);
    expect(parsed.count).toBe(0);
    expect(parsed.locks).toEqual([]);
  });
});

describe("cc pdh status --json", () => {
  it("redacts the bearer token in chosen + mcpConfig", async () => {
    const out = await run("status", "--json");
    expect(out).not.toMatch(/SUPER-SECRET-TOKEN/);
    const parsed = JSON.parse(out);
    expect(parsed.chosen).toMatchObject({ port: 41320, hasToken: true });
    expect(parsed.chosen.token).toBeUndefined();
    expect(parsed.mcpConfig.headers.Authorization).toBe("Bearer ***");
    expect(parsed.mcpConfig.longRunning).toBe(true);
  });

  it("picks the env-named port (path A fast-path)", async () => {
    files["55555.json"] = JSON.stringify({
      kind: "pdh-bridge",
      device: "other",
      transport: "http",
      url: "http://127.0.0.1:55555/mcp",
      port: 55555,
      pid: 99,
      started_at: NOW - 10_000, // older, but env should still win
    });
    process.env.CHAINLESSCHAIN_PDH_PORT = "55555";
    const out = await run("status", "--json");
    const parsed = JSON.parse(out);
    expect(parsed.inPdhTerminal).toBe(true);
    expect(parsed.chosen.port).toBe(55555);
  });
});

describe("cc pdh doctor --json", () => {
  it("reports the chosen server + never leaks the token", async () => {
    const out = await run("doctor", "--json");
    expect(out).not.toMatch(/SUPER-SECRET-TOKEN/);
    const parsed = JSON.parse(out);
    expect(parsed.chosen).toMatchObject({ port: 41320, device: "pixel-7" });
    expect(parsed.locks[0]).toMatchObject({ hasToken: true });
    expect(parsed.locks[0].token).toBeUndefined();
    expect(parsed.reason).toMatch(/newest live lock/);
  });

  it("explains an empty lock dir", async () => {
    _deps.readDir = () => [];
    const out = await run("doctor", "--json");
    const parsed = JSON.parse(out);
    expect(parsed.chosen).toBeNull();
    expect(parsed.reason).toMatch(/no live PDH lockfiles/);
  });
});
