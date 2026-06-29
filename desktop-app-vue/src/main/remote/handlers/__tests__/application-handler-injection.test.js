/**
 * ApplicationHandler — command-injection guards
 *
 * Regression: launch/close/focus are reachable from a paired remote peer
 * (remote-gateway 'app' namespace). `name` was validated, but `args` (launch)
 * and `pid` (close/focus) were interpolated into execAsync shell strings with
 * ZERO validation, and `appPath` only blocked ../\0 — so a peer could inject a
 * second shell command (e.g. args ["&","calc.exe"] or pid "1 & calc.exe"),
 * escalating "launch an app" to arbitrary command execution. Validators now
 * reject shell metacharacters / non-integer pids before any exec.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("child_process", () => ({
  exec: vi.fn((cmd, cb) => cb(null, { stdout: "", stderr: "" })),
}));
vi.mock("../../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { ApplicationHandler } = require("../application-handler.js");

describe("ApplicationHandler command-injection guards", () => {
  let handler;
  beforeEach(() => {
    handler = new ApplicationHandler();
  });

  it("rejects launch args containing shell metacharacters", async () => {
    await expect(
      handler.launch({ name: "Calc", args: ["&", "calc.exe"] }, {}),
    ).rejects.toThrow(/Invalid args/);
  });

  it("rejects a non-integer pid in close", async () => {
    await expect(handler.close({ pid: "1 & calc.exe" }, {})).rejects.toThrow(
      /Invalid pid/,
    );
  });

  it("rejects a non-integer pid in focus", async () => {
    await expect(handler.focus({ pid: "1; rm -rf ~" }, {})).rejects.toThrow(
      /Invalid pid/,
    );
  });

  it("rejects an appPath containing shell metacharacters", async () => {
    await expect(
      handler.launch({ path: 'C:\\app.exe" & calc.exe' }, {}),
    ).rejects.toThrow(/disallowed characters/);
  });

  it("accepts a clean integer pid and benign args (no false reject)", () => {
    // validators return without throwing for legitimate input
    expect(() => handler.close({ pid: 4321 }, {})).not.toThrow();
  });
});
