/**
 * PowerHandler shutdown/restart — delay injection guard
 *
 * Regression: on Windows, `delay` was interpolated raw into
 * `shutdown /s /t ${delay}`, so a remote value like "0 & calc.exe" injected a
 * second command (the confirm gate is bypassable via confirm:false). delay is
 * now coerced to a non-negative integer before reaching the shell string.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const execMock = vi.fn((_cmd, callback) => callback(null, "", ""));
const childProcess = require("child_process");
const realExec = childProcess.exec;
let PowerHandler;
try {
  // power-handler is CommonJS and captures promisify(exec) at module load, so
  // an ESM vi.mock does not protect CI from a real shutdown command.
  childProcess.exec = execMock;
  delete require.cache[require.resolve("../power-handler.js")];
  ({ PowerHandler } = require("../power-handler.js"));
} finally {
  childProcess.exec = realExec;
}

describe("PowerHandler delay injection guard", () => {
  let handler;
  beforeEach(() => {
    execMock.mockClear();
    handler = new PowerHandler({ requireConfirmation: false });
  });

  it("coerces a malicious shutdown delay so no second command reaches the shell", async () => {
    const result = await handler.shutdown({
      delay: "0 & calc.exe",
      confirm: false,
    });
    const cmd = execMock.mock.calls[0][0];
    expect(cmd).not.toMatch(/calc\.exe/);
    expect(cmd).not.toContain("&");
    expect(result.delay).toBe(0);
    if (process.platform === "win32") {
      expect(cmd).toMatch(/\/t 0\b/);
    }
  });

  it("coerces a malicious restart delay too", async () => {
    const result = await handler.restart({
      delay: "5; rm -rf ~",
      confirm: false,
    });
    const cmd = execMock.mock.calls[0][0];
    expect(cmd).not.toMatch(/rm -rf/);
    expect(cmd).not.toContain(";");
    expect(result.delay).toBe(5);
    if (process.platform === "win32") {
      expect(cmd).toMatch(/\/t 5\b/);
    }
  });
});
