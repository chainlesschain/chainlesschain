/**
 * cc statusline — command surface (preview / show), spawnSync + settings stubbed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import { registerStatuslineCommand } from "../../src/commands/statusline.js";
import sl from "../../src/lib/status-line.cjs";

let logSpy;

async function run(...argv) {
  logSpy.mockClear();
  const program = new Command();
  program.exitOverride();
  registerStatuslineCommand(program);
  await program.parseAsync(["node", "cc", "statusline", ...argv]);
  return logSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
}

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  // settings layer with a statusLine + a fake fast command
  sl._deps.readSettings = () => [
    { statusLine: { type: "command", command: "fake-status" } },
  ];
  sl._deps.spawnSync = vi.fn(() => ({
    status: 0,
    stdout: "★ STATUS LINE",
    stderr: "",
  }));
});
afterEach(() => vi.restoreAllMocks());

describe("cc statusline show", () => {
  it("shows the resolved config as JSON", async () => {
    const out = await run("show", "--json");
    expect(JSON.parse(out)).toMatchObject({ command: "fake-status" });
  });
});

describe("cc statusline preview", () => {
  it("renders the configured command (JSON)", async () => {
    const out = await run("preview", "--json");
    expect(JSON.parse(out).line).toBe("★ STATUS LINE");
  });

  it("reports when no statusLine is configured", async () => {
    sl._deps.readSettings = () => [{}];
    const out = await run("show");
    expect(out).toMatch(/No statusLine configured/);
  });
});
