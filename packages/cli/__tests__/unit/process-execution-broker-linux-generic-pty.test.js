import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";
import { issueLinuxGenericSandboxExecutionContract } from "../../src/lib/process-execution-broker/linux-generic-bwrap.js";

const ROOT = "/work/project";
const ROOT_IDENTITY = Object.freeze({
  realPath: ROOT,
  fileId: Object.freeze({ dev: "10", ino: "20" }),
  mode: 0o040755,
  uid: 1000,
  gid: 1000,
});

function issuePtyContract(options) {
  return issueLinuxGenericSandboxExecutionContract(
    {
      origin: options.origin,
      command: "bash",
      args: [],
      cwd: ROOT,
      workspaceRoot: ROOT,
      shell: false,
      sync: false,
      pty: true,
      requiredBoundaries: options.sandboxPolicy.requiredBoundaries,
    },
    {
      homedir: () => "/home/alice",
      attestWorkspace: () => ({
        workspaceRoot: ROOT,
        workingDirectory: ROOT,
        rootIdentity: ROOT_IDENTITY,
        cwdIdentity: ROOT_IDENTITY,
      }),
    },
  );
}

function genericPtyPlan(cleanup) {
  return {
    contractVersion: 1,
    applied: true,
    platform: "linux",
    profile: "strict",
    command: "/proc/self/fd/3",
    args: ["--ctty", "/proc/self/fd/4", "--die-with-parent", "--"],
    options: {
      cwd: "/",
      shell: false,
      env: { PATH: "/usr/bin:/bin" },
      stdio: ["pipe", "pipe", "pipe", 31],
    },
    enforcement: "linux-bwrap-workspace",
    backend: "linux-bwrap-workspace",
    candidateBackend: null,
    guarantees: ["filesystem", "network"],
    requiredBoundaries: ["filesystem", "network"],
    policyAttested: true,
    policyDigest: "a".repeat(64),
    runtimeProbe: {
      kind: "linux-bwrap-generic-workspace-policy-v1",
      attempted: true,
      runnable: true,
      reason: null,
    },
    filesystemPolicy: {
      workspaceRoot: ROOT,
      workingDirectory: ROOT,
      workspaceAccess: "read-write",
      systemAccess: "read-only",
      undeclaredRootAccess: "read-only",
      anonymousWritablePaths: [
        "/home/sandbox",
        "/dev",
        "/run",
        "/tmp",
        "/var/tmp",
      ],
      hostRootMapped: false,
      hostHomeMapped: false,
      workspaceDescriptorBound: true,
      systemDescriptorBound: true,
      exactEtcFileDescriptors: true,
      workspaceRecursiveBind: true,
      workspaceMountTopology:
        "no-strict-descendants-or-forbidden-root-aliases-at-attestation",
      mountTopologySource: "proc-self-mountinfo",
      mountTopologyDigest: "b".repeat(64),
      mountTopologyAtomic: false,
    },
    networkPolicy: {
      namespace: "new",
      namespaceIdentityChanged: true,
      seccomp: "deny-network-creation",
    },
    ptyPolicy: {
      mode: "dedicated-controlling-terminal",
      launcherPath: "/usr/bin/setsid",
      launcherSha256: "c".repeat(64),
      launcherBytes: 4096,
      launcherDescriptorBound: true,
      launcherExecutablePinned: true,
      launcherDescriptorConsumedBeforeTarget: true,
      launcherStagingPathHidden: true,
      bwrapNewSession: false,
    },
    postSpawn: { required: false, mode: "none" },
    cleanup,
  };
}

describe("ProcessExecutionBroker Linux generic PTY", () => {
  let originalPrepare;
  let originalNative;
  let originalPtyAdapter;

  beforeEach(() => {
    originalPrepare = executionBroker._prepareSandboxPlan;
    originalNative = executionBroker._native;
    originalPtyAdapter = executionBroker._ptyAdapter;
    executionBroker.flushAuditLog();
  });

  afterEach(() => {
    executionBroker._prepareSandboxPlan = originalPrepare;
    executionBroker._native = originalNative;
    executionBroker._ptyAdapter = originalPtyAdapter;
    vi.restoreAllMocks();
  });

  it("maps a dedicated slave onto fd 0/1/2 and preserves pinned bwrap descriptors", () => {
    const cleanup = vi.fn();
    const plan = genericPtyPlan(cleanup);
    const prepare = vi.fn(() => plan);
    executionBroker._prepareSandboxPlan = prepare;

    const child = new EventEmitter();
    child.pid = 4321;
    child.kill = vi.fn(() => true);
    const nativeSpawn = vi.fn(() => child);
    executionBroker._native = { spawn: nativeSpawn };

    const terminal = {
      cols: 100,
      rows: 30,
    };
    const ptyAdapter = {
      allocate: vi.fn(() => terminal),
      openBlockingSlave: vi.fn(() => 90),
      closeFd: vi.fn(),
      getCols: vi.fn(() => terminal.cols),
      getRows: vi.fn(() => terminal.rows),
      onData: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      clear: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      setEncoding: vi.fn(),
      releaseTerminal: vi.fn(),
    };
    executionBroker._ptyAdapter = ptyAdapter;

    const ptyModule = { spawn: vi.fn(), open: vi.fn() };
    const sandboxPolicy = Object.freeze({
      requiredBoundaries: Object.freeze(["filesystem", "network"]),
    });
    const options = {
      origin: "terminal:pty",
      scope: "terminal",
      policy: "allow",
      cwd: ROOT,
      shell: false,
      name: "xterm-256color",
      cols: 100,
      rows: 30,
      env: { PATH: "/usr/bin", TERM: "untrusted" },
      sandboxPolicy,
    };
    options.sandboxExecutionContract = issuePtyContract(options);

    const proc = executionBroker.spawnPty(ptyModule, "bash", [], options);

    expect(prepare).toHaveBeenCalledWith(
      "bash",
      [],
      expect.objectContaining({
        cwd: ROOT,
        shell: false,
        env: expect.objectContaining({ TERM: "xterm-256color" }),
      }),
      expect.objectContaining({
        pty: true,
        sandboxPolicy: expect.objectContaining({
          requiredBoundaries: ["filesystem", "network"],
        }),
      }),
    );
    expect(ptyAdapter.allocate).toHaveBeenCalledWith(ptyModule, {
      cols: 100,
      rows: 30,
      encoding: undefined,
    });
    expect(nativeSpawn).toHaveBeenCalledWith(
      plan.command,
      plan.args,
      expect.objectContaining({
        stdio: [90, 90, 90, 31],
      }),
    );
    expect(ptyModule.spawn).not.toHaveBeenCalled();
    expect(ptyAdapter.closeFd).toHaveBeenCalledWith(90);
    expect(cleanup).toHaveBeenCalledOnce();

    proc.write("echo ok\n");
    proc.resize(120, 40);
    expect(ptyAdapter.write).toHaveBeenCalledWith(terminal, "echo ok\n");
    expect(ptyAdapter.resize).toHaveBeenCalledWith(terminal, 120, 40);

    const onExit = vi.fn();
    proc.onExit(onExit);
    child.emit("exit", 0, null);
    expect(onExit).toHaveBeenCalledWith({ exitCode: 0, signal: null });
    expect(ptyAdapter.releaseTerminal).toHaveBeenCalledOnce();

    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      operation: "pty.spawn",
      pty: true,
      sandboxed: true,
      sandboxBackend: "linux-bwrap-workspace",
      sandboxGuarantees: ["filesystem", "network"],
      sandboxPtyPolicy: {
        mode: "dedicated-controlling-terminal",
        launcherPath: "/usr/bin/setsid",
        launcherDescriptorBound: true,
        launcherExecutablePinned: true,
        launcherDescriptorConsumedBeforeTarget: true,
        launcherStagingPathHidden: true,
        bwrapNewSession: false,
      },
    });
  });

  it("fails closed before spawn when the raw node-pty native seam is unavailable", () => {
    const cleanup = vi.fn();
    executionBroker._prepareSandboxPlan = vi.fn(() => genericPtyPlan(cleanup));
    const nativeSpawn = vi.fn();
    executionBroker._native = { spawn: nativeSpawn };

    const sandboxPolicy = Object.freeze({
      requiredBoundaries: Object.freeze(["filesystem", "network"]),
    });
    const options = {
      origin: "terminal:pty-native-missing",
      scope: "terminal",
      policy: "allow",
      cwd: ROOT,
      shell: false,
      name: "xterm-256color",
      sandboxPolicy,
    };
    options.sandboxExecutionContract = issuePtyContract(options);

    expect(() =>
      executionBroker.spawnPty({ spawn: vi.fn() }, "bash", [], options),
    ).toThrow(
      expect.objectContaining({
        code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
        sandboxReason: "pty_allocation_or_spawn_failed",
        sandboxFailClosed: true,
      }),
    );
    expect(nativeSpawn).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      permissionDecision: "deny",
      sandboxState: "denied",
      sandboxReason: "pty_allocation_or_spawn_failed",
      sandboxBackend: "linux-bwrap-workspace",
    });
  });

  it.runIf(process.platform === "linux")(
    "adapts raw node-pty native descriptors for typed data and queued writes",
    async () => {
      const importedPty = await import("node-pty");
      const ptyModule = importedPty.default || importedPty;
      const adapter = originalPtyAdapter;
      const terminal = adapter.allocate(ptyModule, {
        cols: 90,
        rows: 28,
        encoding: "utf8",
      });
      let slaveFd = null;
      let subscription = null;
      let output = "";
      try {
        slaveFd = adapter.openBlockingSlave(terminal);
        subscription = adapter.onData(terminal, (data) => {
          output += String(data);
        });

        expect(adapter.getCols(terminal)).toBe(90);
        expect(adapter.getRows(terminal)).toBe(28);
        expect(() =>
          adapter.write(terminal, Buffer.alloc(1024 * 1024 + 1)),
        ).toThrow(
          expect.objectContaining({
            code: "ERR_PTY_WRITE_BACKPRESSURE",
          }),
        );
        adapter.write(terminal, "raw-adapter-echo");
        await vi.waitFor(
          () => {
            expect(output).toContain("raw-adapter-echo");
          },
          { timeout: 2_000 },
        );

        adapter.resize(terminal, 120, 42);
        expect(adapter.getCols(terminal)).toBe(120);
        expect(adapter.getRows(terminal)).toBe(42);
      } finally {
        subscription?.dispose();
        if (Number.isInteger(slaveFd)) {
          adapter.closeFd(slaveFd);
        }
        adapter.releaseTerminal(terminal);
      }
    },
  );
});
