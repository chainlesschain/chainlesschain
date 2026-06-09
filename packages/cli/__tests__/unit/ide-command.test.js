/**
 * `cc ide` command surface (list / status / doctor) — JSON shape + the security
 * invariant that the raw bearer token is NEVER printed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import { registerIdeCommand } from "../../src/commands/ide.js";
import { _deps } from "../../src/lib/ide-bridge.js";

const NOW = 1_700_000_000_000;
let files;
const orig = {};
let logSpy;

async function run(...argv) {
  logSpy.mockClear();
  const program = new Command();
  program.exitOverride();
  registerIdeCommand(program);
  await program.parseAsync(["node", "cc", "ide", ...argv]);
  return logSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
}

beforeEach(() => {
  for (const k of Object.keys(_deps)) orig[k] = _deps[k];
  files = {
    "53690.json": JSON.stringify({
      ide: "vscode",
      transport: "sse",
      url: "http://127.0.0.1:53690/sse",
      port: 53690,
      workspaceFolders: ["/abs/ws"],
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
  vi.restoreAllMocks();
});

describe("cc ide list --json", () => {
  it("lists the lock with hasToken, never the raw token", async () => {
    const out = await run("list", "--json");
    expect(out).not.toMatch(/SUPER-SECRET-TOKEN/);
    const parsed = JSON.parse(out);
    expect(parsed.count).toBe(1);
    expect(parsed.locks[0]).toMatchObject({ port: 53690, hasToken: true });
    expect(parsed.locks[0].token).toBeUndefined();
    expect(parsed.locks[0]._file).toBeUndefined();
  });
});

describe("cc ide status --json", () => {
  it("redacts the bearer token in chosen + mcpConfig", async () => {
    const out = await run("status", "--ide", "--json");
    expect(out).not.toMatch(/SUPER-SECRET-TOKEN/);
    const parsed = JSON.parse(out);
    expect(parsed.chosen).toMatchObject({ port: 53690, hasToken: true });
    expect(parsed.chosen.token).toBeUndefined();
    expect(parsed.mcpConfig.headers.Authorization).toBe("Bearer ***");
  });
});

describe("cc ide doctor --json", () => {
  it("reports the forced match + never leaks the token", async () => {
    const out = await run("doctor", "--ide", "--json");
    expect(out).not.toMatch(/SUPER-SECRET-TOKEN/);
    const parsed = JSON.parse(out);
    expect(parsed.chosen).toMatchObject({ port: 53690 });
    expect(parsed.locks[0]).toMatchObject({ hasToken: true });
    expect(parsed.locks[0].token).toBeUndefined();
  });
});
