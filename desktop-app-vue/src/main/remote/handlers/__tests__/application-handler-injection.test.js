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

vi.mock("../../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const execMock = vi.fn((_cmd, callback) => callback(null, "", ""));
const childProcess = require("child_process");
const realExec = childProcess.exec;
let ApplicationHandler;
try {
  // application-handler is CommonJS and captures promisify(exec) at module
  // load. Stub that exact dependency so a validation test can never signal a
  // real process on the CI host.
  childProcess.exec = execMock;
  delete require.cache[require.resolve("../application-handler.js")];
  ({ ApplicationHandler } = require("../application-handler.js"));
} finally {
  childProcess.exec = realExec;
}

describe("ApplicationHandler command-injection guards", () => {
  let handler;
  beforeEach(() => {
    execMock.mockClear();
    handler = new ApplicationHandler();
  });

  it("rejects launch args containing shell metacharacters", async () => {
    await expect(
      handler.launch({ name: "Calc", args: ["&", "calc.exe"] }, {}),
    ).rejects.toThrow(/Invalid args/);
  });

  it("rejects CR/LF command separators in names and args", async () => {
    await expect(
      handler.launch({ name: "safe\ntouch tmp", args: [] }, {}),
    ).rejects.toThrow(/Invalid application name/);
    await expect(
      handler.launch({ name: "safe", args: ["ok\r\ntouch tmp"] }, {}),
    ).rejects.toThrow(/Invalid args/);
    expect(execMock).not.toHaveBeenCalled();
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

  it("accepts a clean integer pid and benign args (no false reject)", async () => {
    const result = await handler.close({ pid: 4321 }, {});
    expect(result).toMatchObject({ success: true, pid: 4321 });
    expect(execMock).toHaveBeenCalledTimes(1);
  });
});
