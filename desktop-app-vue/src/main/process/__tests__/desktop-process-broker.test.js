const { installDesktopProcessBroker, redact } = require("../desktop-process-broker");

function fakeChildProcess() {
  const calls = [];
  const cp = {};
  for (const name of [
    "spawn",
    "spawnSync",
    "exec",
    "execSync",
    "execFile",
    "execFileSync",
    "fork",
  ]) {
    cp[name] = (...args) => {
      calls.push({ name, args });
      return { name, args };
    };
  }
  return { cp, calls };
}

describe("desktop process broker", () => {
  it("routes every child_process entry point and preserves calls", () => {
    const { cp, calls } = fakeChildProcess();
    const audit = [];
    const broker = installDesktopProcessBroker({
      childProcess: cp,
      auditSink: (entry) => audit.push(entry),
      now: () => "2026-07-22T00:00:00.000Z",
    });

    cp.spawn("node", ["worker.js"], { origin: "coding-agent" });
    cp.spawnSync("git", ["status"]);
    cp.exec("npm view chainlesschain");
    cp.execSync("node --version");
    cp.execFile("node", ["worker.js"], () => {});
    cp.execFileSync("node", ["--version"]);
    cp.fork("worker.js", []);

    expect(calls).toHaveLength(7);
    expect(audit.map((entry) => entry.operation)).toEqual([
      "spawn",
      "spawnSync",
      "exec",
      "execSync",
      "execFile",
      "execFileSync",
      "fork",
    ]);
    expect(audit[0]).toMatchObject({
      host: "desktop-main",
      origin: "coding-agent",
      command: "node",
    });
    expect(broker.getAuditLog()).toHaveLength(7);
    broker.uninstall();
  });

  it("redacts secrets and bounds command data", () => {
    expect(redact("https://x.test?a=1&token=secret-value")).toBe(
      "https://x.test?a=1&token=[REDACTED]",
    );
    expect(redact("Authorization: Bearer abc123")).toBe(
      "Authorization: Bearer [REDACTED]",
    );
  });
});
