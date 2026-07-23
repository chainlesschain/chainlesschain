const {
  installDesktopProcessBroker,
  spawnWithDesktopBroker,
  spawnSyncWithDesktopBroker,
  execFileSyncWithDesktopBroker,
  redact,
} = require("../desktop-process-broker");

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

    cp.spawn("node", ["worker.js"], {
      origin: "coding-agent",
      provenance: {
        hookId: "hook-1",
        hookName: "token=secret-value",
        ignoredSecret: "password=do-not-record",
      },
    });
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
      provenance: {
        hookId: "hook-1",
        hookName: "token=[REDACTED]",
      },
    });
    expect(JSON.stringify(audit)).not.toContain("do-not-record");
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

  it("exposes a fail-closed spawn facade for desktop modules", () => {
    const { cp, calls } = fakeChildProcess();
    expect(() =>
      spawnWithDesktopBroker("node", ["worker.js"], {}, { childProcess: cp }),
    ).toThrow("desktop_process_broker_not_installed");

    const audit = [];
    const broker = installDesktopProcessBroker({
      childProcess: cp,
      auditSink: (entry) => audit.push(entry),
    });
    spawnWithDesktopBroker(
      "node",
      ["worker.js"],
      { origin: "desktop:test-worker" },
      { childProcess: cp },
    );

    expect(calls).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      operation: "spawn",
      origin: "desktop:test-worker",
    });
    broker.uninstall();
  });

  it("exposes a fail-closed literal-argv execFileSync facade", () => {
    const { cp, calls } = fakeChildProcess();
    expect(() =>
      execFileSyncWithDesktopBroker(
        "git",
        ["diff", "--cached"],
        {},
        { childProcess: cp },
      ),
    ).toThrow("desktop_process_broker_not_installed");

    const audit = [];
    const broker = installDesktopProcessBroker({
      childProcess: cp,
      auditSink: (entry) => audit.push(entry),
    });
    execFileSyncWithDesktopBroker(
      "git",
      ["diff", "--cached"],
      { origin: "desktop:ai-commit-message" },
      { childProcess: cp },
    );

    expect(calls[0]).toMatchObject({
      name: "execFileSync",
      args: ["git", ["diff", "--cached"], expect.any(Object)],
    });
    expect(audit[0]).toMatchObject({
      operation: "execFileSync",
      origin: "desktop:ai-commit-message",
      command: "git",
      args: ["diff", "--cached"],
    });
    broker.uninstall();
  });

  it("exposes a fail-closed literal-argv spawnSync facade", () => {
    const { cp, calls } = fakeChildProcess();
    expect(() =>
      spawnSyncWithDesktopBroker(
        "python",
        ["--version"],
        {},
        { childProcess: cp },
      ),
    ).toThrow("desktop_process_broker_not_installed");

    const audit = [];
    const broker = installDesktopProcessBroker({
      childProcess: cp,
      auditSink: (entry) => audit.push(entry),
    });
    spawnSyncWithDesktopBroker(
      "python",
      ["--version"],
      { origin: "desktop:python-bridge-probe" },
      { childProcess: cp },
    );

    expect(calls[0]).toMatchObject({
      name: "spawnSync",
      args: ["python", ["--version"], expect.any(Object)],
    });
    expect(audit[0]).toMatchObject({
      operation: "spawnSync",
      origin: "desktop:python-bridge-probe",
    });
    broker.uninstall();
  });

  it("audits node-pty without recording inherited environment values", () => {
    const { cp } = fakeChildProcess();
    const calls = [];
    const audit = [];
    const broker = installDesktopProcessBroker({
      childProcess: cp,
      auditSink: (entry) => audit.push(entry),
      now: () => "2026-07-22T00:00:00.000Z",
    });
    const pty = {
      spawn(command, args, options) {
        calls.push({ command, args, options });
        return { pid: 9001 };
      },
    };

    const proc = broker.spawnPty(pty, "pwsh.exe", ["-NoLogo"], {
      cwd: "C:\\work",
      env: { API_TOKEN: "do-not-log", PATH: "safe" },
    });

    expect(proc.pid).toBe(9001);
    expect(calls[0].options.env.API_TOKEN).toBe("do-not-log");
    expect(audit[0]).toMatchObject({
      operation: "pty.spawn",
      command: "pwsh.exe",
      args: ["-NoLogo"],
    });
    expect(JSON.stringify(audit)).not.toContain("do-not-log");
    broker.uninstall();
  });
});
