/**
 * PowerHandler shutdown/restart — delay injection guard
 *
 * Regression: on Windows, `delay` was interpolated raw into
 * `shutdown /s /t ${delay}`, so a remote value like "0 & calc.exe" injected a
 * second command (the confirm gate is bypassable via confirm:false). delay is
 * now coerced to a non-negative integer before reaching the shell string.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { execMock } = vi.hoisted(() => ({
  execMock: vi.fn((cmd, cb) => cb(null, { stdout: "", stderr: "" })),
}));
vi.mock("child_process", () => ({ exec: execMock }));
vi.mock("../../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { PowerHandler } = require("../power-handler.js");

describe("PowerHandler delay injection guard", () => {
  let handler;
  beforeEach(() => {
    execMock.mockClear();
    handler = new PowerHandler({ requireConfirmation: false });
  });

  it("coerces a malicious shutdown delay so no second command reaches the shell", async () => {
    await handler.shutdown({ delay: "0 & calc.exe", confirm: false });
    const cmd = execMock.mock.calls[0][0];
    expect(cmd).not.toMatch(/calc\.exe/);
    // coerced to integer 0
    expect(cmd).toMatch(/\/t 0\b/);
  });

  it("coerces a malicious restart delay too", async () => {
    await handler.restart({ delay: "5; rm -rf ~", confirm: false });
    const cmd = execMock.mock.calls[0][0];
    expect(cmd).not.toMatch(/rm -rf/);
    expect(cmd).toMatch(/\/t 5\b/);
  });
});
