const {
  installDesktopProcessBroker,
  spawnWithDesktopBroker,
  spawnSyncWithDesktopBroker,
  execFileWithDesktopBroker,
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

  it("exposes a fail-closed literal-argv execFile facade", () => {
    const { cp, calls } = fakeChildProcess();
    const callback = () => {};
    expect(() =>
      execFileWithDesktopBroker("piper", ["--help"], {}, callback, {
        childProcess: cp,
      }),
    ).toThrow("desktop_process_broker_not_installed");

    const audit = [];
    const broker = installDesktopProcessBroker({
      childProcess: cp,
      auditSink: (entry) => audit.push(entry),
    });
    execFileWithDesktopBroker(
      "piper",
      ["--help"],
      { origin: "desktop:speech-local-tts-probe" },
      callback,
      { childProcess: cp },
    );

    expect(calls[0]).toMatchObject({
      name: "execFile",
      args: ["piper", ["--help"], expect.any(Object), callback],
    });
    expect(audit[0]).toMatchObject({
      operation: "execFile",
      origin: "desktop:speech-local-tts-probe",
      command: "piper",
      args: ["--help"],
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
      origin: "terminal:pty",
      policy: "allow",
      scope: "terminal",
    });

    expect(proc.pid).toBe(9001);
    expect(calls[0].options.env.API_TOKEN).toBe("do-not-log");
    expect(calls[0].options).not.toHaveProperty("origin");
    expect(calls[0].options).not.toHaveProperty("policy");
    expect(calls[0].options).not.toHaveProperty("scope");
    expect(calls[0].options).not.toHaveProperty("sandboxPolicy");
    expect(audit[0]).toMatchObject({
      operation: "pty.spawn",
      origin: "terminal:pty",
      command: "pwsh.exe",
      args: ["-NoLogo"],
      sandboxed: false,
      sandboxRequired: [],
      sandboxGuarantees: [],
      sandboxBackend: null,
      sandboxState: "not-required",
      sandboxReason: "native_pty_host_boundary",
    });
    expect(JSON.stringify(audit)).not.toContain("do-not-log");
    broker.uninstall();
  });

  it("denies required PTY boundaries with a structured audit and never calls node-pty", () => {
    const { cp } = fakeChildProcess();
    const calls = [];
    const audit = [];
    const broker = installDesktopProcessBroker({
      childProcess: cp,
      auditSink: (entry) => audit.push(entry),
      now: () => "2026-07-22T00:00:00.000Z",
    });
    const pty = {
      spawn(...args) {
        calls.push(args);
        return { pid: 9001 };
      },
    };
    const sandboxPolicy = Object.freeze({
      requiredBoundaries: Object.freeze(["filesystem", "network"]),
    });

    let error;
    try {
      broker.spawnPty(pty, "pwsh.exe", [], {
        cwd: "C:\\work",
        env: { API_TOKEN: "do-not-log" },
        origin: "terminal:pty",
        policy: "allow",
        scope: "terminal",
        sandboxPolicy,
      });
    } catch (caught) {
      error = caught;
    }

    expect(calls).toHaveLength(0);
    expect(error).toMatchObject({
      code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      sandboxReason: "required_boundaries_unsatisfied",
      sandboxFailClosed: true,
      requiredBoundaries: ["filesystem", "network"],
      actualGuarantees: [],
      missingBoundaries: ["filesystem", "network"],
      sandboxBackend: null,
    });
    expect(error.auditEntry).toBe(audit[0]);
    expect(audit[0]).toMatchObject({
      operation: "pty.spawn",
      origin: "terminal:pty",
      sandboxed: false,
      sandboxRequired: ["filesystem", "network"],
      sandboxGuarantees: [],
      sandboxBackend: null,
      sandboxState: "denied",
      sandboxReason: "required_boundaries_unsatisfied",
    });
    expect(JSON.stringify(audit)).not.toContain("do-not-log");
    broker.uninstall();
  });
});
