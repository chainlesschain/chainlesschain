import { EventEmitter, once } from "node:events";
import { spawnSync as nativeSpawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  applySandbox,
  applyWindowsSandbox,
  resetWindowsSandboxAdapterCache,
  SANDBOX_BOUNDARIES,
} from "../../src/lib/process-execution-broker/platform-sandbox.js";
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";

const windowsSandboxSource = readFileSync(
  new URL(
    "../../src/lib/process-execution-broker/windows-sandbox.ps1",
    import.meta.url,
  ),
  "utf8",
);

function createChild(pid = 4102) {
  const child = new EventEmitter();
  child.pid = pid;
  child.kill = vi.fn(() => true);
  return child;
}

function createWindowsAdapterHarness({
  helperSpawnSync = vi.fn(() => {
    throw new Error("Unexpected Windows native helper invocation");
  }),
  readFileSync: readFile = vi.fn(),
  preexistingPaths = [],
} = {}) {
  const files = new Set(preexistingPaths.map(String));
  const contents = new Map();
  const identities = new Map();
  let nextFileIdentity = 100;
  const putFile = (value, content) => {
    const filePath = String(value);
    const identity = nextFileIdentity;
    nextFileIdentity += 1;
    files.add(filePath);
    contents.set(filePath, Buffer.from(content));
    identities.set(filePath, identity);
  };
  for (const filePath of files) {
    putFile(filePath, `preexisting:${filePath}`);
  }
  const missingPathError = (filePath) => {
    const error = new Error(`Path does not exist: ${filePath}`);
    error.code = "ENOENT";
    return error;
  };
  const statFile = (value) => {
    const filePath = String(value);
    if (!files.has(filePath)) throw missingPathError(filePath);
    const identity = BigInt(identities.get(filePath));
    const size = BigInt(contents.get(filePath).length);
    return {
      dev: 1n,
      ino: identity,
      size,
      mode: 33_206n,
      birthtimeNs: identity * 1_000_000n,
      ctimeNs: identity * 1_000_000n,
      mtimeNs: identity * 1_000_000n,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
  };
  const fsRuntime = {
    existsSync: vi.fn((value) => {
      const filePath = String(value);
      return (
        filePath.toLowerCase().endsWith("\\powershell.exe") ||
        files.has(filePath)
      );
    }),
    readFileSync: vi.fn((value, encoding) => {
      const filePath = String(value);
      if (files.has(filePath)) {
        const content = contents.get(filePath);
        return encoding ? content.toString(encoding) : Buffer.from(content);
      }
      return readFile(value, encoding);
    }),
    writeFileSync: vi.fn((value, _content, options) => {
      const filePath = String(value);
      if (options?.flag === "wx" && files.has(filePath)) {
        const error = new Error(`Path already exists: ${filePath}`);
        error.code = "EEXIST";
        throw error;
      }
      putFile(filePath, _content);
    }),
    unlinkSync: vi.fn((value) => {
      const filePath = String(value);
      if (!files.delete(filePath)) {
        throw missingPathError(filePath);
      }
      contents.delete(filePath);
      identities.delete(filePath);
    }),
    lstatSync: vi.fn(statFile),
    statSync: vi.fn(statFile),
  };
  const spawnSync = vi.fn((command, args, options) => {
    if (args?.includes("-CompileOnly")) {
      const executableIndex = args.indexOf("-CacheExecutable") + 1;
      putFile(args[executableIndex], "freshly compiled Windows native adapter");
      return { status: 0, stdout: "", stderr: "" };
    }
    return helperSpawnSync(command, args, options);
  });
  return {
    files,
    fsRuntime,
    helperSpawnSync,
    replaceFile: putFile,
    spawnSync,
  };
}

function appliedPlan(command, args, options, overrides = {}) {
  return {
    contractVersion: 1,
    applied: true,
    platform: "test",
    profile: "default",
    command,
    args,
    options,
    enforcement: "test-sandbox",
    reason: null,
    postSpawn: { required: false, mode: "none" },
    ...overrides,
  };
}

afterAll(() => {
  expect(resetWindowsSandboxAdapterCache()).toBe(true);
});

describe("platform sandbox adapter contract", () => {
  beforeEach(() => {
    resetWindowsSandboxAdapterCache();
  });

  it("reports the implicit macOS profile unavailable without altering the invocation", () => {
    const options = { shell: true, cwd: "/workspace" };
    const plan = applySandbox("echo ready", [], options, "default", {
      platform: "darwin",
      fs: { existsSync: vi.fn(() => true) },
    });

    expect(plan).toMatchObject({
      applied: false,
      platform: "darwin",
      profile: "default",
      command: "echo ready",
      args: [],
      options,
      reason: "macos_default_profile_requires_explicit_policy",
      guarantees: [],
    });
  });

  it("returns a macOS Seatbelt wrapper as the executable spawn plan", () => {
    const fsRuntime = {
      existsSync: vi.fn(() => true),
      writeFileSync: vi.fn(),
      unlinkSync: vi.fn(),
    };
    const options = { cwd: "/workspace", env: { PATH: "/usr/bin" } };

    const plan = applySandbox("node", ["script.js"], options, "strict", {
      platform: "darwin",
      fs: fsRuntime,
      tmpdir: () => "/sandbox-tmp",
      randomBytes: () => Buffer.from("0123456789abcdef", "hex"),
    });

    expect(plan).toMatchObject({
      contractVersion: 1,
      applied: true,
      platform: "darwin",
      profile: "strict",
      command: "/usr/bin/sandbox-exec",
      enforcement: "macos-seatbelt",
      backend: "macos-seatbelt",
      guarantees: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
        SANDBOX_BOUNDARIES.PROCESS_EXEC,
      ],
      postSpawn: { required: false, mode: "none" },
    });
    expect(plan.args[0]).toBe("-f");
    expect(plan.args.slice(2)).toEqual(["node", "script.js"]);
    expect(plan.options).toEqual(options);
    expect(fsRuntime.writeFileSync).toHaveBeenCalledOnce();
    const profile = fsRuntime.writeFileSync.mock.calls[0][1];
    expect(profile).toContain('(import "system.sb")');
    expect(profile).toContain("(deny network*)");
    expect(profile).toContain('(allow file-read* (subpath "/usr/bin"))');
    expect(profile).toContain(
      '(allow file-read* file-write* (literal "/dev/null")',
    );

    plan.cleanup();
    expect(fsRuntime.unlinkSync).toHaveBeenCalledOnce();
  });

  it("preserves shell command semantics behind an explicit macOS wrapper", () => {
    const fsRuntime = {
      existsSync: vi.fn(() => true),
      writeFileSync: vi.fn(),
      unlinkSync: vi.fn(),
    };
    const plan = applySandbox(
      "node script.js",
      [],
      { shell: true, cwd: "/workspace" },
      "network-only",
      {
        platform: "darwin",
        fs: fsRuntime,
        tmpdir: () => "/sandbox-tmp",
        randomBytes: () => Buffer.from("0123456789abcdef", "hex"),
      },
    );

    expect(plan.args.slice(-3)).toEqual(["/bin/sh", "-c", "node script.js"]);
    expect(plan.options).toMatchObject({
      cwd: "/workspace",
      shell: false,
    });
    plan.cleanup();
  });

  it("returns the Linux prlimit wrapper and marked child environment", () => {
    const options = { cwd: "/workspace", env: { PATH: "/usr/bin" } };
    const probeSpawnSync = vi.fn();
    const plan = applySandbox("node", ["script.js"], options, "default", {
      platform: "linux",
      fs: { existsSync: vi.fn(() => true) },
      spawnSync: probeSpawnSync,
    });

    expect(plan).toMatchObject({
      contractVersion: 1,
      applied: true,
      platform: "linux",
      profile: "default",
      command: "/usr/bin/prlimit",
      enforcement: "linux-prlimit",
      backend: "linux-prlimit",
      guarantees: [SANDBOX_BOUNDARIES.RESOURCE_LIMITS],
    });
    expect(plan.args).toEqual([
      "--cpu=30",
      "--nofile=256",
      "--",
      "node",
      "script.js",
    ]);
    expect(plan.guarantees).toEqual([SANDBOX_BOUNDARIES.RESOURCE_LIMITS]);
    expect(plan.options.env).toEqual({
      PATH: "/usr/bin",
      CHAINLESS_SANDBOXED: "1",
    });
    expect(options.env).toEqual({ PATH: "/usr/bin" });
    expect(probeSpawnSync).not.toHaveBeenCalled();
  });

  it("treats a failed namespace smoke as unavailable instead of trusting the bwrap binary", () => {
    const probeSpawnSync = vi.fn(() => ({ status: 1 }));
    const plan = applySandbox(
      "node",
      ["script.js"],
      { cwd: "/workspace" },
      {
        profile: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
      },
      {
        platform: "linux",
        fs: { existsSync: vi.fn(() => true) },
        spawnSync: probeSpawnSync,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      platform: "linux",
      profile: "strict",
      command: "node",
      args: ["script.js"],
      backend: null,
      candidateBackend: "linux-bwrap",
      policyAttested: false,
      reason: "linux_bwrap_unavailable",
      guarantees: [],
      runtimeProbe: {
        kind: "linux-bwrap-runtime-smoke-v1",
        attempted: true,
        runnable: false,
        reason: "probe_failed",
      },
    });
    expect(probeSpawnSync).toHaveBeenCalledWith(
      "/usr/bin/bwrap",
      [
        "--die-with-parent",
        "--new-session",
        "--unshare-all",
        "--ro-bind",
        "/",
        "/",
        "--proc",
        "/proc",
        "--dev",
        "/dev",
        "--tmpfs",
        "/tmp",
        "--",
        "/bin/true",
      ],
      expect.objectContaining({
        shell: false,
        stdio: "ignore",
        timeout: 5_000,
      }),
    );
  });

  it("does not promote filesystem or network guarantees after a successful bwrap runtime probe", () => {
    const probeSpawnSync = vi.fn(() => ({ status: 0 }));
    const plan = applySandbox(
      "node",
      ["script.js"],
      {},
      "strict",
      {
        platform: "linux",
        fs: { existsSync: vi.fn(() => true) },
        spawnSync: probeSpawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [
          SANDBOX_BOUNDARIES.FILESYSTEM,
          SANDBOX_BOUNDARIES.NETWORK,
        ],
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      backend: null,
      candidateBackend: "linux-bwrap",
      policyAttested: false,
      reason: "linux_bwrap_policy_unattested",
      guarantees: [],
      runtimeProbe: {
        attempted: true,
        runnable: true,
        reason: null,
      },
    });
    expect(plan.guarantees).not.toContain(SANDBOX_BOUNDARIES.FILESYSTEM);
    expect(plan.guarantees).not.toContain(SANDBOX_BOUNDARIES.NETWORK);
    expect(probeSpawnSync).toHaveBeenCalledOnce();
  });

  it("preserves shell command semantics behind the Linux wrapper", () => {
    const plan = applySandbox(
      "node script.js",
      [],
      { shell: true, cwd: "/workspace" },
      "default",
      {
        platform: "linux",
        fs: { existsSync: vi.fn(() => true) },
      },
    );

    expect(plan.args.slice(-3)).toEqual(["/bin/sh", "-c", "node script.js"]);
    expect(plan.options).toMatchObject({
      cwd: "/workspace",
      shell: false,
    });
  });

  it("returns the Windows Job Object + restricted-token wrapper plan", () => {
    const harness = createWindowsAdapterHarness();
    const options = { windowsHide: true, env: { PATH: "C:\\Windows" } };
    const plan = applyWindowsSandbox(
      "tool.exe",
      ["run"],
      options,
      { profileName: "strict" },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsDir: () => "C:\\Windows",
        windowsAdapterContent: "param([string]$Payload)",
        tmpdir: () => "C:\\temp",
        randomBytes: (size) => Buffer.alloc(size, 7),
        joinPath: path.win32.join,
        spawnSync: harness.spawnSync,
      },
    );

    expect(plan).toMatchObject({
      applied: true,
      platform: "win32",
      profile: "strict",
      command: expect.stringMatching(
        /^C:\\temp\\chainless-win-sandbox-[a-f0-9]+\.exe$/,
      ),
      enforcement: "windows-job-restricted-token",
      backend: "windows-job-restricted-token",
      guarantees: [
        SANDBOX_BOUNDARIES.PROCESS_TREE,
        SANDBOX_BOUNDARIES.RESOURCE_LIMITS,
        SANDBOX_BOUNDARIES.PRIVILEGE_REDUCTION,
      ],
      postSpawn: { required: false, mode: "none" },
    });
    const payload = JSON.parse(
      Buffer.from(plan.args.at(-1), "base64").toString("utf8"),
    );
    expect(payload).toEqual({
      cpuSeconds: 0,
      processMemoryBytes: 256 * 1024 * 1024,
      activeProcessLimit: 16,
      command: "tool.exe",
      args: ["run"],
      nodeIpcFd: -1,
      detached: false,
      windowsHide: true,
    });
    expect(plan.guarantees).toEqual([
      SANDBOX_BOUNDARIES.PROCESS_TREE,
      SANDBOX_BOUNDARIES.RESOURCE_LIMITS,
      SANDBOX_BOUNDARIES.PRIVILEGE_REDUCTION,
    ]);
    expect(plan.guarantees).not.toContain(SANDBOX_BOUNDARIES.FILESYSTEM);
    expect(plan.guarantees).not.toContain(SANDBOX_BOUNDARIES.NETWORK);
    expect(plan.options).toMatchObject({
      windowsHide: true,
      shell: false,
      env: {
        PATH: "C:\\Windows",
        CC_WINDOWS_SANDBOXED: "1",
        CC_WINDOWS_SANDBOX_PROFILE: "strict",
      },
    });
    expect(harness.fsRuntime.writeFileSync).toHaveBeenCalledOnce();
    expect(harness.fsRuntime.writeFileSync.mock.calls[0][2]).toEqual({
      mode: 0o600,
      flag: "wx",
    });
    expect(harness.fsRuntime.unlinkSync).toHaveBeenCalledWith(
      expect.stringMatching(/\.ps1$/),
    );
    expect(options).toEqual({
      windowsHide: true,
      env: { PATH: "C:\\Windows" },
    });
    plan.cleanup();
    expect(harness.files.has(plan.command)).toBe(true);
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
    expect(harness.fsRuntime.unlinkSync).toHaveBeenCalledWith(plan.command);
    expect(windowsSandboxSource).toContain("PROC_THREAD_ATTRIBUTE_HANDLE_LIST");
    expect(windowsSandboxSource).toContain("EXTENDED_STARTUPINFO_PRESENT");
    expect(windowsSandboxSource).toContain("BuildInheritedHandleList");
    expect(windowsSandboxSource).toContain("InitializeProcThreadAttributeList");
    expect(windowsSandboxSource).toContain("UpdateProcThreadAttribute");
    expect(windowsSandboxSource).toContain("DeleteProcThreadAttributeList");
    expect(windowsSandboxSource).toContain("_get_osfhandle(nodeIpcFd)");
    expect(windowsSandboxSource).toMatch(
      /CREATE_SUSPENDED\s*\|\s*CREATE_UNICODE_ENVIRONMENT\s*\|\s*EXTENDED_STARTUPINFO_PRESENT/,
    );
  });

  it("fresh-compiles a random Windows helper and never trusts a prepositioned hash cache", () => {
    const oldHashExecutable =
      "C:\\temp\\chainless-win-sandbox-0123456789abcdef01234567.exe";
    const harness = createWindowsAdapterHarness({
      preexistingPaths: [oldHashExecutable],
    });
    const plan = applyWindowsSandbox(
      "tool.exe",
      [],
      {},
      { profileName: "default" },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "param()",
        windowsDir: () => "C:\\Windows",
        tmpdir: () => "C:\\temp",
        randomBytes: (size) => Buffer.alloc(size, 0xa1),
        joinPath: path.win32.join,
        spawnSync: harness.spawnSync,
      },
    );

    expect(plan).toMatchObject({
      applied: true,
      command: "C:\\temp\\chainless-win-sandbox-" + `${"a1".repeat(24)}.exe`,
    });
    expect(plan.command).not.toBe(oldHashExecutable);
    const compileCall = harness.spawnSync.mock.calls.find(([, helperArgs]) =>
      helperArgs.includes("-CompileOnly"),
    );
    expect(compileCall).toBeDefined();
    expect(compileCall[0]).toBe(
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    );
    expect(compileCall[1]).toContain(plan.command);
    expect(
      harness.spawnSync.mock.calls.some(
        ([executable]) => executable === oldHashExecutable,
      ),
    ).toBe(false);

    plan.cleanup();
    expect(harness.files.has(plan.command)).toBe(true);
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
    expect(harness.fsRuntime.unlinkSync).toHaveBeenCalledWith(plan.command);
    expect(harness.fsRuntime.unlinkSync).not.toHaveBeenCalledWith(
      oldHashExecutable,
    );
    expect(harness.files.has(oldHashExecutable)).toBe(true);
  });

  it("shares one attested helper across ordinary plans in the same process", () => {
    const harness = createWindowsAdapterHarness();
    const runtime = {
      platform: "win32",
      fs: harness.fsRuntime,
      windowsAdapterContent: "param()",
      windowsDir: () => "C:\\Windows",
      tmpdir: () => "C:\\temp",
      randomBytes: (size) => Buffer.alloc(size, 0xb1),
      joinPath: path.win32.join,
      spawnSync: harness.spawnSync,
    };

    const first = applyWindowsSandbox(
      "first.exe",
      [],
      {},
      { profileName: "default" },
      runtime,
    );
    const second = applyWindowsSandbox(
      "second.exe",
      [],
      {},
      { profileName: "default" },
      runtime,
    );

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(true);
    expect(second.command).toBe(first.command);
    expect(
      harness.spawnSync.mock.calls.filter(([, helperArgs]) =>
        helperArgs.includes("-CompileOnly"),
      ),
    ).toHaveLength(1);

    first.cleanup();
    second.cleanup();
    expect(harness.files.has(first.command)).toBe(true);
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
    expect(harness.files.has(first.command)).toBe(false);
  });

  it("deletes a quiescent cached helper after the unref idle TTL", () => {
    vi.useFakeTimers();
    const harness = createWindowsAdapterHarness();
    try {
      const plan = applyWindowsSandbox(
        "tool.exe",
        [],
        {},
        { profileName: "default" },
        {
          platform: "win32",
          fs: harness.fsRuntime,
          windowsAdapterContent: "param()",
          windowsDir: () => "C:\\Windows",
          windowsAdapterIdleTtlMs: 50,
          tmpdir: () => "C:\\temp",
          randomBytes: (size) => Buffer.alloc(size, 0xb3),
          joinPath: path.win32.join,
          spawnSync: harness.spawnSync,
        },
      );

      plan.cleanup();
      expect(harness.files.has(plan.command)).toBe(true);
      vi.advanceTimersByTime(49);
      expect(harness.files.has(plan.command)).toBe(true);
      vi.advanceTimersByTime(1);
      expect(harness.files.has(plan.command)).toBe(false);
    } finally {
      vi.useRealTimers();
      expect(resetWindowsSandboxAdapterCache()).toBe(true);
    }
  });

  it("rejects and recompiles a cached helper when its digest or file identity changes", () => {
    const harness = createWindowsAdapterHarness();
    let helperNonce = 0xc0;
    const runtime = {
      platform: "win32",
      fs: harness.fsRuntime,
      windowsAdapterContent: "param()",
      windowsDir: () => "C:\\Windows",
      tmpdir: () => "C:\\temp",
      randomBytes: (size) => {
        helperNonce += 1;
        return Buffer.alloc(size, helperNonce);
      },
      joinPath: path.win32.join,
      spawnSync: harness.spawnSync,
    };

    const first = applyWindowsSandbox(
      "first.exe",
      [],
      {},
      { profileName: "default" },
      runtime,
    );
    first.cleanup();
    harness.replaceFile(first.command, "tampered executable");

    const second = applyWindowsSandbox(
      "second.exe",
      [],
      {},
      { profileName: "default" },
      runtime,
    );
    expect(second.command).not.toBe(first.command);
    expect(harness.files.has(first.command)).toBe(false);
    second.cleanup();

    // Byte-identical replacement still changes stable file identity.
    harness.replaceFile(
      second.command,
      "freshly compiled Windows native adapter",
    );
    const third = applyWindowsSandbox(
      "third.exe",
      [],
      {},
      { profileName: "default" },
      runtime,
    );
    expect(third.command).not.toBe(second.command);
    expect(
      harness.spawnSync.mock.calls.filter(([, helperArgs]) =>
        helperArgs.includes("-CompileOnly"),
      ),
    ).toHaveLength(3);

    third.cleanup();
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
  });

  it("invalidates the process-local helper when built-in adapter content changes", () => {
    const harness = createWindowsAdapterHarness();
    let helperNonce = 0xd0;
    const runtime = {
      platform: "win32",
      fs: harness.fsRuntime,
      windowsAdapterContent: "param([string]$First)",
      windowsDir: () => "C:\\Windows",
      tmpdir: () => "C:\\temp",
      randomBytes: (size) => {
        helperNonce += 1;
        return Buffer.alloc(size, helperNonce);
      },
      joinPath: path.win32.join,
      spawnSync: harness.spawnSync,
    };

    const first = applyWindowsSandbox(
      "first.exe",
      [],
      {},
      { profileName: "default" },
      runtime,
    );
    first.cleanup();
    const second = applyWindowsSandbox(
      "second.exe",
      [],
      {},
      { profileName: "default" },
      {
        ...runtime,
        windowsAdapterContent: "param([string]$Second)",
      },
    );

    expect(second.command).not.toBe(first.command);
    expect(harness.files.has(first.command)).toBe(false);
    expect(
      harness.spawnSync.mock.calls.filter(([, helperArgs]) =>
        helperArgs.includes("-CompileOnly"),
      ),
    ).toHaveLength(2);
    second.cleanup();
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
  });

  it("returns an attested zero-capability AppContainer plan for required filesystem and network boundaries", () => {
    const appContainerSid = "S-1-15-2-1-2-3-4-5-6-7";
    const helperSpawnSync = vi.fn((helper, helperArgs) => {
      if (helperArgs[0] === "--prepare-appcontainer") {
        return {
          status: 0,
          stdout: JSON.stringify({
            ready: true,
            profileName: helperArgs[1],
            appContainerSid,
            capabilityCount: 0,
            tokenAttested: true,
            restrictedTokenAttested: true,
          }),
          stderr: "",
        };
      }
      if (helperArgs[0] === "--delete-appcontainer") {
        return {
          status: 0,
          stdout: JSON.stringify({
            deleted: true,
            absent: true,
            profileName: helperArgs[1],
          }),
          stderr: "",
        };
      }
      throw new Error(`Unexpected helper invocation: ${helper} ${helperArgs}`);
    });
    const harness = createWindowsAdapterHarness({ helperSpawnSync });
    const plan = applyWindowsSandbox(
      "tool.exe",
      ["run"],
      { env: { PATH: "C:\\Windows" } },
      {
        profileName: "strict",
        requiredBoundaries: [
          SANDBOX_BOUNDARIES.FILESYSTEM,
          SANDBOX_BOUNDARIES.NETWORK,
        ],
        sync: true,
      },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "param()",
        tmpdir: () => "C:\\temp",
        randomBytes: (size) => Buffer.alloc(size, 9),
        joinPath: path.win32.join,
        spawnSync: harness.spawnSync,
      },
    );

    expect(plan).toMatchObject({
      applied: true,
      backend: "windows-appcontainer-job-restricted-token",
      enforcement: "windows-appcontainer-job-restricted-token",
      policyAttested: true,
      guarantees: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
        SANDBOX_BOUNDARIES.PROCESS_TREE,
        SANDBOX_BOUNDARIES.RESOURCE_LIMITS,
        SANDBOX_BOUNDARIES.PRIVILEGE_REDUCTION,
      ],
      runtimeProbe: {
        kind: "windows-appcontainer-launch-attestation-v1",
        attempted: true,
        runnable: true,
        reason: null,
      },
      postSpawn: { required: false, mode: "none" },
    });
    const readinessCall = helperSpawnSync.mock.calls[0];
    expect(readinessCall[1]).toEqual([
      "--prepare-appcontainer",
      "ChainlessChain.CliSandbox.090909090909090909090909",
    ]);
    expect(readinessCall[2]).toMatchObject({
      shell: false,
      windowsHide: true,
      encoding: "utf8",
      timeout: 30_000,
    });
    const payload = JSON.parse(
      Buffer.from(plan.args[0], "base64").toString("utf8"),
    );
    expect(payload).toMatchObject({
      command: "tool.exe",
      args: ["run"],
      appContainerProfileName:
        "ChainlessChain.CliSandbox.090909090909090909090909",
      appContainerSid,
      detached: false,
    });
    expect(payload).not.toHaveProperty("identityPath");
    expect(plan.options.env).toMatchObject({
      CC_WINDOWS_APPCONTAINER: "1",
      CC_WINDOWS_APPCONTAINER_PROFILE:
        "ChainlessChain.CliSandbox.090909090909090909090909",
      CC_WINDOWS_APPCONTAINER_SID: appContainerSid,
    });

    plan.cleanup();
    expect(helperSpawnSync.mock.calls[1][1]).toEqual([
      "--delete-appcontainer",
      "ChainlessChain.CliSandbox.090909090909090909090909",
      appContainerSid,
    ]);
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
    expect(harness.fsRuntime.unlinkSync).toHaveBeenCalledWith(plan.command);
  });

  it("re-attests and refreshes the helper before AppContainer cleanup invocation", () => {
    const appContainerSid = "S-1-15-2-21-22-23-24-25-26-27";
    const helperSpawnSync = vi.fn((_helper, helperArgs) => {
      if (helperArgs[0] === "--prepare-appcontainer") {
        return {
          status: 0,
          stdout: JSON.stringify({
            ready: true,
            profileName: helperArgs[1],
            appContainerSid,
            capabilityCount: 0,
            tokenAttested: true,
            restrictedTokenAttested: true,
          }),
          stderr: "",
        };
      }
      if (helperArgs[0] === "--delete-appcontainer") {
        return {
          status: 0,
          stdout: JSON.stringify({
            deleted: true,
            absent: true,
            profileName: helperArgs[1],
          }),
          stderr: "",
        };
      }
      throw new Error(`Unexpected helper invocation: ${helperArgs}`);
    });
    const harness = createWindowsAdapterHarness({ helperSpawnSync });
    let helperNonce = 0;
    const plan = applyWindowsSandbox(
      "tool.exe",
      [],
      {},
      {
        profileName: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        sync: true,
      },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "param()",
        tmpdir: () => "C:\\temp",
        randomBytes: (size) => {
          if (size === 12) return Buffer.alloc(size, 0x2a);
          helperNonce += 1;
          return Buffer.alloc(size, helperNonce);
        },
        joinPath: path.win32.join,
        spawnSync: harness.spawnSync,
      },
    );
    expect(plan.applied).toBe(true);
    const initialHelper = plan.command;
    harness.replaceFile(initialHelper, "tampered before cleanup");

    plan.cleanup();

    expect(helperSpawnSync.mock.calls[0][0]).toBe(initialHelper);
    expect(helperSpawnSync.mock.calls[1][0]).not.toBe(initialHelper);
    expect(helperSpawnSync.mock.calls[1][1][0]).toBe("--delete-appcontainer");
    expect(harness.files.has(initialHelper)).toBe(false);
    expect(
      harness.spawnSync.mock.calls.filter(([, helperArgs]) =>
        helperArgs.includes("-CompileOnly"),
      ),
    ).toHaveLength(2);
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
  });

  it("keeps AppContainer guarantees unavailable when synchronous launch attestation fails", () => {
    const warn = vi.fn();
    const helperSpawnSync = vi
      .fn()
      .mockReturnValueOnce({
        status: 125,
        stdout: "",
        stderr: "CreateAppContainerProfile failed",
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          deleted: true,
          absent: true,
          profileName: "ChainlessChain.CliSandbox.060606060606060606060606",
        }),
        stderr: "",
      });
    const harness = createWindowsAdapterHarness({ helperSpawnSync });
    const plan = applyWindowsSandbox(
      "tool.exe",
      [],
      {},
      {
        profileName: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        sync: true,
      },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "param()",
        tmpdir: () => "C:\\temp",
        randomBytes: (size) => Buffer.alloc(size, 6),
        joinPath: path.win32.join,
        spawnSync: harness.spawnSync,
        warn,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      backend: null,
      candidateBackend: "windows-appcontainer-job-restricted-token",
      policyAttested: false,
      reason: "windows_appcontainer_readiness_failed",
      guarantees: [],
      runtimeProbe: {
        kind: "windows-appcontainer-launch-attestation-v1",
        attempted: true,
        runnable: false,
        reason: "probe_failed",
      },
    });
    expect(helperSpawnSync.mock.calls[1][1]).toEqual([
      "--delete-appcontainer",
      "ChainlessChain.CliSandbox.060606060606060606060606",
    ]);
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
    expect(harness.fsRuntime.unlinkSync).toHaveBeenCalledWith(
      expect.stringMatching(/chainless-win-sandbox-[a-f0-9]+\.exe$/),
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("requires per-target AppContainer identity attestation for asynchronous Windows launches", () => {
    const appContainerSid = "S-1-15-2-11-12-13-14-15-16-17";
    let identityPath;
    const readFileSync = vi.fn((filePath) => {
      identityPath = filePath;
      return JSON.stringify({
        targetPid: 5103,
        helperPid: 4102,
        appContainer: true,
        appContainerSid,
        capabilityCount: 0,
      });
    });
    const helperSpawnSync = vi.fn((helper, helperArgs) => {
      if (helperArgs[0] === "--prepare-appcontainer") {
        return {
          status: 0,
          stdout: JSON.stringify({
            ready: true,
            profileName: helperArgs[1],
            appContainerSid,
            capabilityCount: 0,
            tokenAttested: true,
            restrictedTokenAttested: true,
          }),
          stderr: "",
        };
      }
      if (helperArgs[0] === "--delete-appcontainer") {
        return {
          status: 0,
          stdout: JSON.stringify({
            deleted: true,
            absent: true,
            profileName: helperArgs[1],
          }),
          stderr: "",
        };
      }
      throw new Error(`Unexpected helper invocation: ${helper} ${helperArgs}`);
    });
    const harness = createWindowsAdapterHarness({
      helperSpawnSync,
      readFileSync,
    });
    const plan = applyWindowsSandbox(
      "tool.exe",
      [],
      { stdio: "ignore" },
      {
        profileName: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.NETWORK],
        sync: false,
      },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "param()",
        tmpdir: () => "C:\\temp",
        now: vi.fn(() => 100),
        sleepSync: vi.fn(),
        randomBytes: (size) => Buffer.alloc(size, 8),
        joinPath: path.win32.join,
        spawnSync: harness.spawnSync,
      },
    );

    expect(plan.postSpawn).toEqual({ required: true, mode: "sync" });
    const payload = JSON.parse(
      Buffer.from(plan.args[0], "base64").toString("utf8"),
    );
    expect(payload.identityPath).toMatch(
      /^C:\\temp\\chainless-win-sandbox-identity-[a-f0-9]+\.json$/,
    );
    const child = createChild(4102);
    expect(plan.postSpawnWindows(child)).toEqual({
      targetPid: 5103,
      wrapperPid: 4102,
      appContainerProfileName:
        "ChainlessChain.CliSandbox.080808080808080808080808",
      appContainerSid,
      capabilityCount: 0,
    });
    expect(child).toMatchObject({
      pid: 5103,
      sandboxWrapperPid: 4102,
      sandboxTargetPid: 5103,
      sandboxAppContainerProfile:
        "ChainlessChain.CliSandbox.080808080808080808080808",
      sandboxAppContainerSid: appContainerSid,
    });
    expect(identityPath).toBe(payload.identityPath);
    plan.cleanup();
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
    expect(harness.fsRuntime.unlinkSync).toHaveBeenCalledWith(plan.command);
  });

  it("uses only documented AppContainer attributes and attests the suspended target before resume", () => {
    expect(windowsSandboxSource).toContain(
      "PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES",
    );
    expect(windowsSandboxSource).toContain("new IntPtr(0x00020009)");
    expect(windowsSandboxSource).toContain("CreateAppContainerProfile");
    expect(windowsSandboxSource).toContain("DeleteAppContainerProfile");
    expect(windowsSandboxSource).toContain("TokenIsAppContainer");
    expect(windowsSandboxSource).toContain("TokenCapabilities");
    expect(windowsSandboxSource).toContain("TokenAppContainerSid");
    expect(windowsSandboxSource).toContain("EqualSid");
    expect(windowsSandboxSource).toContain("CreateProcessAsUser");
    expect(windowsSandboxSource).toContain("TerminateAndAwaitEmptyJob");
    expect(windowsSandboxSource).toContain(
      "Refusing to trust a pre-existing native adapter executable",
    );
    expect(windowsSandboxSource).toContain(
      "[IO.File]::Move($temporaryExecutable, $CacheExecutable)",
    );
    expect(windowsSandboxSource).not.toContain(
      "if (-not (Test-Path -LiteralPath $CacheExecutable))",
    );
    expect(windowsSandboxSource).not.toMatch(
      /SetNamedSecurityInfo|AddAccessAllowedAce|SetEntriesInAcl/,
    );
    expect(
      windowsSandboxSource.indexOf(
        "attestedAppContainerSid = AttestAppContainerTarget",
      ),
    ).toBeLessThan(
      windowsSandboxSource.indexOf(
        "if (ResumeThread(processInfo.hThread) == UInt32.MaxValue)",
      ),
    );
  });

  it("reports detached numeric file stdio as unavailable on Windows", () => {
    const options = {
      detached: true,
      stdio: ["ignore", 17, 17],
      windowsHide: true,
    };
    const plan = applyWindowsSandbox(
      "node.exe",
      ["worker.mjs"],
      options,
      { profileName: "default" },
      { platform: "win32" },
    );

    expect(plan).toMatchObject({
      applied: false,
      backend: "windows-job-restricted-token",
      reason: "windows_detached_file_stdio_unsupported",
      command: "node.exe",
      args: ["worker.mjs"],
      options,
      guarantees: [],
    });
  });

  it("reports Windows unavailable when its native host is missing", () => {
    const plan = applyWindowsSandbox(
      "tool.exe",
      [],
      {},
      { profileName: "strict" },
      {
        platform: "win32",
        fs: {
          existsSync: vi.fn(() => false),
          writeFileSync: vi.fn(),
          unlinkSync: vi.fn(),
        },
        windowsDir: () => "C:\\Windows",
        windowsAdapterContent: "param()",
        tmpdir: () => "C:\\temp",
        randomBytes: () => Buffer.alloc(12, 3),
      },
    );
    expect(plan).toMatchObject({
      applied: false,
      reason: "windows_powershell_host_unavailable",
    });
  });

  it("preserves Node IPC stdio in the Windows restricted-token plan", () => {
    const harness = createWindowsAdapterHarness();
    const plan = applyWindowsSandbox(
      process.execPath,
      ["child.js"],
      { stdio: ["ignore", "pipe", "pipe", "ipc"] },
      { profileName: "default" },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "param()",
        tmpdir: () => "C:\\temp",
        randomBytes: (size) => Buffer.alloc(size, 4),
        joinPath: path.win32.join,
        spawnSync: harness.spawnSync,
      },
    );
    expect(plan).toMatchObject({
      applied: true,
      enforcement: "windows-job-restricted-token",
      options: { stdio: ["ignore", "pipe", "pipe", "ipc"] },
      postSpawn: { required: false, mode: "none" },
    });
    plan.cleanup();
  });

  it("fails closed for unsupported Windows descriptors above the IPC fd", () => {
    const plan = applyWindowsSandbox(
      process.execPath,
      ["child.js"],
      { stdio: ["ignore", "pipe", "pipe", "ipc", "pipe"] },
      { profileName: "strict" },
      {
        platform: "win32",
        fs: { existsSync: vi.fn(() => true) },
      },
    );
    expect(plan).toMatchObject({
      applied: false,
      command: process.execPath,
      args: ["child.js"],
      reason: "windows_extra_descriptor_unsupported",
    });
  });

  it("resolves detached Windows launches to the target PID synchronously", () => {
    const readFileSync = vi.fn(() =>
      JSON.stringify({ targetPid: 5103, helperPid: 4102 }),
    );
    const harness = createWindowsAdapterHarness({ readFileSync });
    const plan = applyWindowsSandbox(
      process.execPath,
      ["worker.js"],
      { detached: true, stdio: "ignore" },
      { profileName: "default" },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "param()",
        tmpdir: () => "C:\\temp",
        randomBytes: (size) => Buffer.alloc(size, 5),
        joinPath: path.win32.join,
        spawnSync: harness.spawnSync,
      },
    );
    expect(plan).toMatchObject({
      applied: true,
      enforcement: "windows-job-restricted-token",
      options: { detached: true, stdio: "ignore" },
      postSpawn: { required: true, mode: "sync" },
    });
    const payload = JSON.parse(
      Buffer.from(plan.args[0], "base64").toString("utf8"),
    );
    expect(payload).toMatchObject({
      command: process.execPath,
      args: ["worker.js"],
      detached: true,
      nodeIpcFd: -1,
    });
    const child = createChild(4102);
    expect(plan.postSpawnWindows(child)).toEqual({
      targetPid: 5103,
      wrapperPid: 4102,
    });
    expect(child).toMatchObject({
      pid: 5103,
      sandboxTargetPid: 5103,
      sandboxWrapperPid: 4102,
    });
    expect(readFileSync).toHaveBeenCalledOnce();
    expect(harness.fsRuntime.unlinkSync).toHaveBeenCalledWith(
      payload.identityPath,
    );
    plan.cleanup();
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
    expect(harness.fsRuntime.unlinkSync).toHaveBeenCalledWith(plan.command);
  });

  it("reports Linux unavailable when the wrapper is missing", () => {
    const plan = applySandbox("node", [], {}, "default", {
      platform: "linux",
      fs: { existsSync: vi.fn(() => false) },
    });

    expect(plan).toMatchObject({
      applied: false,
      command: "node",
      args: [],
      reason: "linux_prlimit_unavailable",
    });
  });
});

describe.runIf(process.platform === "win32")(
  "Windows sandbox live enforcement",
  () => {
    it("launches an attested AppContainer target and leaves no profile behind when the OS supports it", () => {
      const command = path.join(process.env.WINDIR, "System32", "cmd.exe");
      const plan = applyWindowsSandbox(
        command,
        ["/d", "/c", "echo %CC_WINDOWS_APPCONTAINER%"],
        {
          encoding: "utf8",
          timeout: 30_000,
          windowsHide: true,
          env: process.env,
        },
        {
          profileName: "strict",
          requiredBoundaries: [
            SANDBOX_BOUNDARIES.FILESYSTEM,
            SANDBOX_BOUNDARIES.NETWORK,
          ],
          sync: true,
        },
        { platform: "win32" },
      );

      if (!plan.applied) {
        expect(plan).toMatchObject({
          backend: null,
          candidateBackend: "windows-appcontainer-job-restricted-token",
          policyAttested: false,
          reason: expect.stringMatching(
            /^windows_appcontainer_readiness_(?:failed|cleanup_unverified)$/,
          ),
          guarantees: [],
          runtimeProbe: {
            kind: "windows-appcontainer-launch-attestation-v1",
            attempted: true,
            runnable: false,
          },
        });
        return;
      }

      const launchSpec = JSON.parse(
        Buffer.from(plan.args[0], "base64").toString("utf8"),
      );
      let result;
      try {
        result = nativeSpawnSync(plan.command, [...plan.args], {
          ...plan.options,
        });
      } finally {
        plan.cleanup();
      }
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe("1");

      const absence = nativeSpawnSync(
        plan.command,
        ["--assert-appcontainer-absent", launchSpec.appContainerProfileName],
        {
          encoding: "utf8",
          timeout: 30_000,
          windowsHide: true,
        },
      );
      expect(absence.error).toBeUndefined();
      expect(absence.status, absence.stderr).toBe(0);
      expect(JSON.parse(absence.stdout)).toEqual({
        absent: true,
        profileName: launchSpec.appContainerProfileName,
      });
    }, 60_000);

    it("starts a real child only after the native wrapper is active", () => {
      const previousStrict = process.env.CC_SANDBOX_STRICT;
      const previousDisable = process.env.CC_SANDBOX_DISABLE;
      const previousSandboxEnabled = executionBroker._sandboxEnabled;
      const previousPlatformEnabled = executionBroker._platformSandboxEnabled;
      process.env.CC_SANDBOX_STRICT = "1";
      delete process.env.CC_SANDBOX_DISABLE;
      executionBroker._sandboxEnabled = true;
      executionBroker._platformSandboxEnabled = true;
      try {
        const result = executionBroker.spawnSync(
          process.execPath,
          [
            "-e",
            [
              "const { spawn } = require('node:child_process');",
              "const grandchild = spawn(",
              "  process.execPath,",
              "  ['-e', 'setInterval(() => {}, 1000)'],",
              "  { detached: true, stdio: 'ignore' },",
              ");",
              "grandchild.unref();",
              "process.stdout.write(JSON.stringify({",
              "  sandboxed: process.env.CC_WINDOWS_SANDBOXED,",
              "  profile: process.env.CC_WINDOWS_SANDBOX_PROFILE,",
              "  grandchildPid: grandchild.pid,",
              "}));",
            ].join("\n"),
          ],
          {
            origin: "test:windows-native-sandbox-live",
            policy: "allow",
            encoding: "utf8",
            timeout: 30_000,
            env: process.env,
          },
        );
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(0);
        expect(result.stderr).toBe("");
        const childReport = JSON.parse(result.stdout);
        expect(childReport).toMatchObject({
          sandboxed: "1",
          profile: "strict",
        });
        expect(childReport.grandchildPid).toBeGreaterThan(0);

        // Query the restricted token through a second direct adapter launch.
        // Starting whoami as a nested process is flaky on hosted Windows
        // runners (STATUS_DLL_INIT_FAILED) and tests the nested loader more
        // than the token assigned by this adapter.
        const privilegeResult = executionBroker.spawnSync(
          path.join(process.env.WINDIR, "System32", "whoami.exe"),
          ["/priv"],
          {
            origin: "test:windows-restricted-token-live",
            policy: "allow",
            encoding: "utf8",
            timeout: 30_000,
            env: process.env,
          },
        );
        expect(privilegeResult.error).toBeUndefined();
        expect(privilegeResult.status, privilegeResult.stderr).toBe(0);
        const privileges = [
          ...(privilegeResult.stdout || "").matchAll(
            /\bSe[A-Za-z]+Privilege\b/g,
          ),
        ].map((match) => match[0]);
        expect(
          privileges.every((name) => name === "SeChangeNotifyPrivilege"),
        ).toBe(true);
        expect(() => process.kill(childReport.grandchildPid, 0)).toThrow();
        expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
          sandboxed: true,
          sandboxState: "ready",
          sandboxEnforcement: "windows-job-restricted-token",
        });

        const shellResult = executionBroker.spawnSync(
          "echo windows-shell-ok",
          [],
          {
            origin: "test:windows-native-sandbox-shell",
            policy: "allow",
            shell: true,
            encoding: "utf8",
            timeout: 30_000,
            env: process.env,
          },
        );
        expect(shellResult.status, shellResult.stderr).toBe(0);
        expect(shellResult.stdout.trim()).toBe("windows-shell-ok");

        const quotedShellResult = executionBroker.spawnSync(
          `"${process.execPath}" -e "process.stdout.write('quoted-shell-ok')"`,
          [],
          {
            origin: "test:windows-native-sandbox-quoted-shell",
            policy: "allow",
            shell: true,
            encoding: "utf8",
            timeout: 30_000,
            env: process.env,
          },
        );
        expect(quotedShellResult.status, quotedShellResult.stderr).toBe(0);
        expect(quotedShellResult.stdout).toBe("quoted-shell-ok");

        const largeShellResult = executionBroker.spawnSync(
          `"${process.execPath}" -e "process.stdout.write('x'.repeat(2*1024*1024))"`,
          [],
          {
            origin: "test:windows-native-sandbox-large-shell",
            policy: "allow",
            shell: true,
            encoding: "utf8",
            maxBuffer: 64 * 1024 * 1024,
            timeout: 30_000,
            env: process.env,
          },
        );
        expect(largeShellResult.status, largeShellResult.stderr).toBe(0);
        expect(largeShellResult.stdout).toHaveLength(2 * 1024 * 1024);
      } finally {
        if (previousStrict === undefined) {
          delete process.env.CC_SANDBOX_STRICT;
        } else {
          process.env.CC_SANDBOX_STRICT = previousStrict;
        }
        if (previousDisable === undefined) {
          delete process.env.CC_SANDBOX_DISABLE;
        } else {
          process.env.CC_SANDBOX_DISABLE = previousDisable;
        }
        executionBroker._sandboxEnabled = previousSandboxEnabled;
        executionBroker._platformSandboxEnabled = previousPlatformEnabled;
      }
    }, 45_000);

    it("preserves a real Node fd3 IPC channel through the native adapter", async () => {
      const previousStrict = process.env.CC_SANDBOX_STRICT;
      const previousDisable = process.env.CC_SANDBOX_DISABLE;
      const previousSandboxEnabled = executionBroker._sandboxEnabled;
      const previousPlatformEnabled = executionBroker._platformSandboxEnabled;
      process.env.CC_SANDBOX_STRICT = "1";
      delete process.env.CC_SANDBOX_DISABLE;
      executionBroker._sandboxEnabled = true;
      executionBroker._platformSandboxEnabled = true;
      let child;
      try {
        child = executionBroker.spawn(
          process.execPath,
          [
            "-e",
            [
              "process.on('message', (message) => {",
              "  process.send({",
              "    echo: message,",
              "    sandboxed: process.env.CC_WINDOWS_SANDBOXED,",
              "    pid: process.pid,",
              "  }, () => {",
              "    process.disconnect();",
              "    setTimeout(() => process.exit(0), 500);",
              "  });",
              "});",
              "process.send({ ready: true });",
            ].join("\n"),
          ],
          {
            origin: "test:windows-native-sandbox-ipc-live",
            policy: "allow",
            stdio: ["ignore", "pipe", "pipe", "ipc"],
            timeout: 30_000,
            env: process.env,
          },
        );
        const stderr = [];
        child.stderr.on("data", (chunk) => stderr.push(chunk));
        const disconnectPromise = once(child, "disconnect");
        const exitPromise = once(child, "exit");
        const report = await new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Timed out waiting for sandbox IPC")),
            30_000,
          );
          child.once("error", reject);
          child.once("exit", (code, signal) => {
            reject(
              new Error(
                `Sandbox IPC child exited before echo (${code}/${signal}): ${Buffer.concat(
                  stderr,
                ).toString()}`,
              ),
            );
          });
          child.on("message", (message) => {
            if (message?.ready) {
              child.send({ ping: "pong" }, (error) => {
                if (error) reject(error);
              });
              return;
            }
            clearTimeout(timeout);
            resolve(message);
          });
        });
        expect(report).toMatchObject({
          echo: { ping: "pong" },
          sandboxed: "1",
        });
        expect(report.pid).toBeGreaterThan(0);
        await disconnectPromise;
        expect(child.connected).toBe(false);
        expect(child.exitCode).toBeNull();
        const [code, signal] = await exitPromise;
        expect({
          code,
          signal,
          stderr: Buffer.concat(stderr).toString(),
        }).toEqual({
          code: 0,
          signal: null,
          stderr: "",
        });
        expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
          sandboxed: true,
          sandboxState: "ready",
          sandboxEnforcement: "windows-job-restricted-token",
        });
      } finally {
        try {
          child?.kill();
        } catch {
          // The child normally exits after its echo.
        }
        if (previousStrict === undefined) {
          delete process.env.CC_SANDBOX_STRICT;
        } else {
          process.env.CC_SANDBOX_STRICT = previousStrict;
        }
        if (previousDisable === undefined) {
          delete process.env.CC_SANDBOX_DISABLE;
        } else {
          process.env.CC_SANDBOX_DISABLE = previousDisable;
        }
        executionBroker._sandboxEnabled = previousSandboxEnabled;
        executionBroker._platformSandboxEnabled = previousPlatformEnabled;
      }
    }, 45_000);

    it("exposes and supervises the real detached target PID", async () => {
      const previousStrict = process.env.CC_SANDBOX_STRICT;
      const previousDisable = process.env.CC_SANDBOX_DISABLE;
      const previousSandboxEnabled = executionBroker._sandboxEnabled;
      const previousPlatformEnabled = executionBroker._platformSandboxEnabled;
      process.env.CC_SANDBOX_STRICT = "1";
      delete process.env.CC_SANDBOX_DISABLE;
      executionBroker._sandboxEnabled = true;
      executionBroker._platformSandboxEnabled = true;
      let child;
      let targetPid;
      try {
        child = executionBroker.spawn(
          process.execPath,
          ["-e", "setInterval(() => {}, 1000)"],
          {
            origin: "test:windows-native-sandbox-detached-live",
            policy: "allow",
            detached: true,
            stdio: "ignore",
            timeout: 30_000,
            env: process.env,
          },
        );
        targetPid = child.pid;
        expect(child).toMatchObject({
          pid: targetPid,
          sandboxTargetPid: targetPid,
        });
        expect(child.sandboxWrapperPid).toBeGreaterThan(0);
        expect(child.sandboxWrapperPid).not.toBe(targetPid);
        expect(() => process.kill(targetPid, 0)).not.toThrow();
        expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
          pid: targetPid,
          sandboxWrapperPid: child.sandboxWrapperPid,
          sandboxTargetPid: targetPid,
          sandboxed: true,
          sandboxState: "ready",
          sandboxEnforcement: "windows-job-restricted-token",
        });

        const exitPromise = once(child, "exit");
        expect(child.kill()).toBe(true);
        await exitPromise;
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          try {
            process.kill(targetPid, 0);
          } catch {
            targetPid = null;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(targetPid).toBeNull();
      } finally {
        try {
          child?.kill();
        } catch {
          // Best-effort cleanup for a failed assertion.
        }
        if (targetPid) {
          try {
            process.kill(targetPid);
          } catch {
            // The Job may already have reaped it.
          }
        }
        if (previousStrict === undefined) {
          delete process.env.CC_SANDBOX_STRICT;
        } else {
          process.env.CC_SANDBOX_STRICT = previousStrict;
        }
        if (previousDisable === undefined) {
          delete process.env.CC_SANDBOX_DISABLE;
        } else {
          process.env.CC_SANDBOX_DISABLE = previousDisable;
        }
        executionBroker._sandboxEnabled = previousSandboxEnabled;
        executionBroker._platformSandboxEnabled = previousPlatformEnabled;
      }
    }, 45_000);

    it("fails closed for detached numeric file stdio in strict mode", () => {
      const previousStrict = process.env.CC_SANDBOX_STRICT;
      const previousDisable = process.env.CC_SANDBOX_DISABLE;
      const previousSandboxEnabled = executionBroker._sandboxEnabled;
      const previousPlatformEnabled = executionBroker._platformSandboxEnabled;
      process.env.CC_SANDBOX_STRICT = "1";
      delete process.env.CC_SANDBOX_DISABLE;
      executionBroker._sandboxEnabled = true;
      executionBroker._platformSandboxEnabled = true;
      try {
        let failure;
        try {
          executionBroker.spawn(process.execPath, ["worker.mjs"], {
            origin: "test:windows-native-sandbox-detached-file-stdio-live",
            policy: "allow",
            detached: true,
            stdio: ["ignore", 17, 17],
            windowsHide: true,
            timeout: 30_000,
            env: process.env,
          });
        } catch (error) {
          failure = error;
        }
        expect(failure).toMatchObject({
          code: "ERR_PROCESS_SANDBOX",
          sandboxReason: "windows_detached_file_stdio_unsupported",
        });
        expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
          sandboxed: false,
          sandboxState: "denied",
          sandboxReason: "windows_detached_file_stdio_unsupported",
        });
      } finally {
        if (previousStrict === undefined) {
          delete process.env.CC_SANDBOX_STRICT;
        } else {
          process.env.CC_SANDBOX_STRICT = previousStrict;
        }
        if (previousDisable === undefined) {
          delete process.env.CC_SANDBOX_DISABLE;
        } else {
          process.env.CC_SANDBOX_DISABLE = previousDisable;
        }
        executionBroker._sandboxEnabled = previousSandboxEnabled;
        executionBroker._platformSandboxEnabled = previousPlatformEnabled;
      }
    }, 45_000);
  },
);

describe("ProcessExecutionBroker sandbox-plan consumption", () => {
  let originalNative;
  let originalAdapter;
  let originalSandboxEnabled;
  let originalPlatformSandboxEnabled;
  let originalCredentialFiltering;
  let originalCredentialAgentEnabled;
  let originalDisable;
  let originalStrict;
  let emitWarning;

  beforeEach(() => {
    originalNative = executionBroker._native;
    originalAdapter = executionBroker._sandboxAdapter;
    originalSandboxEnabled = executionBroker._sandboxEnabled;
    originalPlatformSandboxEnabled = executionBroker._platformSandboxEnabled;
    originalCredentialFiltering = executionBroker._credentialFilteringEnabled;
    originalCredentialAgentEnabled = executionBroker._credentialAgentEnabled;
    originalDisable = process.env.CC_SANDBOX_DISABLE;
    originalStrict = process.env.CC_SANDBOX_STRICT;

    delete process.env.CC_SANDBOX_DISABLE;
    delete process.env.CC_SANDBOX_STRICT;
    executionBroker._sandboxEnabled = true;
    executionBroker._platformSandboxEnabled = true;
    executionBroker._credentialFilteringEnabled = false;
    executionBroker._credentialAgentEnabled = false;
    executionBroker.flushAuditLog();
    emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
  });

  afterEach(() => {
    executionBroker._native = originalNative;
    executionBroker._sandboxAdapter = originalAdapter;
    executionBroker._sandboxEnabled = originalSandboxEnabled;
    executionBroker._platformSandboxEnabled = originalPlatformSandboxEnabled;
    executionBroker._credentialFilteringEnabled = originalCredentialFiltering;
    executionBroker._credentialAgentEnabled = originalCredentialAgentEnabled;
    if (originalDisable === undefined) {
      delete process.env.CC_SANDBOX_DISABLE;
    } else {
      process.env.CC_SANDBOX_DISABLE = originalDisable;
    }
    if (originalStrict === undefined) {
      delete process.env.CC_SANDBOX_STRICT;
    } else {
      process.env.CC_SANDBOX_STRICT = originalStrict;
    }
    executionBroker.flushAuditLog();
    emitWarning.mockRestore();
  });

  it("passes adapter command, args, and options to async native spawn", () => {
    const child = createChild();
    const nativeSpawn = vi.fn(() => child);
    const apply = vi.fn((command, args, options) =>
      appliedPlan("sandbox-wrapper", ["--", command, ...args], {
        ...options,
        sandboxOption: true,
      }),
    );
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: apply,
      postSpawnSandbox: vi.fn(),
    };

    const returned = executionBroker.spawn("tool", ["run"], {
      origin: "test:sandbox-plan",
      policy: "allow",
      env: { PATH: "safe" },
    });

    expect(returned).toBe(child);
    expect(nativeSpawn).toHaveBeenCalledWith(
      "sandbox-wrapper",
      ["--", "tool", "run"],
      expect.objectContaining({
        sandboxOption: true,
        env: { PATH: "safe" },
      }),
    );
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      sandboxed: true,
      sandboxProfile: "default",
      sandboxEnforcement: "test-sandbox",
      sandboxBackend: "test-sandbox",
      sandboxRequired: [],
      sandboxGuarantees: [],
      sandboxState: "ready",
    });
  });

  it("enforces and audits a satisfied typed boundary policy", async () => {
    const child = createChild();
    const nativeSpawn = vi.fn(() => child);
    const apply = vi.fn((command, args, options, profile) =>
      appliedPlan("seatbelt-wrapper", [command, ...args], options, {
        platform: "darwin",
        profile,
        enforcement: "macos-seatbelt",
        backend: "macos-seatbelt",
        guarantees: [SANDBOX_BOUNDARIES.FILESYSTEM, SANDBOX_BOUNDARIES.NETWORK],
      }),
    );
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: apply,
      postSpawnSandbox: vi.fn(),
    };

    executionBroker.spawn("tool", ["run"], {
      origin: "test:sandbox-required-satisfied",
      policy: "allow",
      sandboxPolicy: {
        profile: "strict",
        requiredBoundaries: [
          SANDBOX_BOUNDARIES.FILESYSTEM,
          SANDBOX_BOUNDARIES.NETWORK,
        ],
      },
    });

    expect(apply).toHaveBeenCalledWith(
      "tool",
      ["run"],
      expect.not.objectContaining({
        sandboxPolicy: expect.anything(),
        requiredBoundaries: expect.anything(),
      }),
      "strict",
      undefined,
      {
        profile: "strict",
        requiredBoundaries: [
          SANDBOX_BOUNDARIES.FILESYSTEM,
          SANDBOX_BOUNDARIES.NETWORK,
        ],
        sync: false,
      },
    );
    const nativeOptions = nativeSpawn.mock.calls[0][2];
    expect(nativeOptions).not.toHaveProperty("sandboxPolicy");
    expect(nativeOptions).not.toHaveProperty("requiredBoundaries");
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      sandboxed: true,
      sandboxBackend: "macos-seatbelt",
      sandboxRequired: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
      ],
      sandboxGuarantees: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
      ],
      sandboxState: "ready",
    });
    await expect(child.sandboxReady).resolves.toEqual({
      applied: true,
      backend: "macos-seatbelt",
      guarantees: [SANDBOX_BOUNDARIES.FILESYSTEM, SANDBOX_BOUNDARIES.NETWORK],
    });
  });

  it("fails closed before spawn when actual guarantees miss a required boundary", () => {
    const nativeSpawn = vi.fn();
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: (command, args, options) =>
        appliedPlan(command, args, options, {
          platform: "win32",
          enforcement: "windows-job-restricted-token",
          backend: "windows-job-restricted-token",
          guarantees: [
            SANDBOX_BOUNDARIES.PROCESS_TREE,
            SANDBOX_BOUNDARIES.RESOURCE_LIMITS,
            SANDBOX_BOUNDARIES.PRIVILEGE_REDUCTION,
          ],
        }),
      postSpawnSandbox: vi.fn(),
    };

    let error;
    try {
      executionBroker.spawn("tool.exe", [], {
        origin: "test:sandbox-required-unsatisfied",
        policy: "allow",
        sandboxPolicy: {
          requiredBoundaries: [
            SANDBOX_BOUNDARIES.FILESYSTEM,
            SANDBOX_BOUNDARIES.NETWORK,
          ],
        },
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      sandboxReason: "required_boundaries_unsatisfied",
      sandboxFailClosed: true,
      requiredBoundaries: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
      ],
      actualGuarantees: [
        SANDBOX_BOUNDARIES.PROCESS_TREE,
        SANDBOX_BOUNDARIES.RESOURCE_LIMITS,
        SANDBOX_BOUNDARIES.PRIVILEGE_REDUCTION,
      ],
      missingBoundaries: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
      ],
      sandboxBackend: "windows-job-restricted-token",
    });
    expect(nativeSpawn).not.toHaveBeenCalled();
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      permissionDecision: "deny",
      sandboxed: false,
      sandboxState: "denied",
      sandboxReason: "required_boundaries_unsatisfied",
      sandboxRequired: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
      ],
      sandboxGuarantees: [
        SANDBOX_BOUNDARIES.PROCESS_TREE,
        SANDBOX_BOUNDARIES.RESOURCE_LIMITS,
        SANDBOX_BOUNDARIES.PRIVILEGE_REDUCTION,
      ],
      sandboxMissing: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
      ],
      sandboxBackend: "windows-job-restricted-token",
    });
  });

  it("fails closed before native spawn when Linux bwrap runs but its policy is unattested", () => {
    const nativeSpawn = vi.fn();
    const probeSpawnSync = vi.fn(() => ({ status: 0 }));
    const apply = vi.fn(
      (command, args, options, profile, _runtime, sandboxRequest) =>
        applySandbox(
          command,
          args,
          options,
          profile,
          {
            platform: "linux",
            fs: { existsSync: vi.fn(() => true) },
            spawnSync: probeSpawnSync,
          },
          sandboxRequest,
        ),
    );
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: apply,
      postSpawnSandbox: vi.fn(),
    };

    let error;
    try {
      executionBroker.spawn("target-with-side-effect", [], {
        origin: "test:linux-bwrap-policy-unattested",
        policy: "allow",
        sandboxPolicy: {
          profile: "strict",
          requiredBoundaries: [
            SANDBOX_BOUNDARIES.FILESYSTEM,
            SANDBOX_BOUNDARIES.NETWORK,
          ],
        },
      });
    } catch (caught) {
      error = caught;
    }

    expect(apply).toHaveBeenCalledWith(
      "target-with-side-effect",
      [],
      expect.not.objectContaining({
        sandboxPolicy: expect.anything(),
        requiredBoundaries: expect.anything(),
      }),
      "strict",
      undefined,
      {
        profile: "strict",
        requiredBoundaries: [
          SANDBOX_BOUNDARIES.FILESYSTEM,
          SANDBOX_BOUNDARIES.NETWORK,
        ],
        sync: false,
      },
    );
    expect(error).toMatchObject({
      code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      sandboxReason: "required_boundaries_unsatisfied",
      sandboxFailClosed: true,
      actualGuarantees: [],
      missingBoundaries: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
      ],
      sandboxBackend: null,
      sandboxCandidateBackend: "linux-bwrap",
      sandboxPolicyAttested: false,
      sandboxCandidateReason: "linux_bwrap_policy_unattested",
      sandboxRuntimeProbe: {
        attempted: true,
        runnable: true,
        reason: null,
      },
    });
    expect(probeSpawnSync).toHaveBeenCalledOnce();
    expect(nativeSpawn).not.toHaveBeenCalled();
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      permissionDecision: "deny",
      sandboxed: false,
      sandboxState: "denied",
      sandboxRequired: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
      ],
      sandboxGuarantees: [],
      sandboxBackend: null,
      sandboxCandidateBackend: "linux-bwrap",
      sandboxPolicyAttested: false,
      sandboxCandidateReason: "linux_bwrap_policy_unattested",
      sandboxRuntimeProbe: {
        attempted: true,
        runnable: true,
        reason: null,
      },
    });
  });

  it("supports the top-level requiredBoundaries alias on spawnSync", () => {
    const nativeSpawnSync = vi.fn(() => ({ status: 0 }));
    executionBroker._native = { spawnSync: nativeSpawnSync };
    executionBroker._sandboxAdapter = {
      applySandbox: (command, args, options) =>
        appliedPlan(command, args, options, {
          platform: "linux",
          enforcement: "linux-prlimit",
          backend: "linux-prlimit",
          guarantees: [SANDBOX_BOUNDARIES.RESOURCE_LIMITS],
        }),
      postSpawnSandbox: vi.fn(),
    };

    executionBroker.spawnSync("tool", [], {
      origin: "test:sandbox-required-sync",
      policy: "allow",
      requiredBoundaries: [SANDBOX_BOUNDARIES.RESOURCE_LIMITS],
    });

    expect(nativeSpawnSync).toHaveBeenCalledOnce();
    expect(nativeSpawnSync.mock.calls[0][2]).not.toHaveProperty(
      "requiredBoundaries",
    );
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      sandboxBackend: "linux-prlimit",
      sandboxRequired: [SANDBOX_BOUNDARIES.RESOURCE_LIMITS],
      sandboxGuarantees: [SANDBOX_BOUNDARIES.RESOURCE_LIMITS],
    });
  });

  it("rejects unknown boundary identifiers before consulting the adapter", () => {
    const nativeSpawn = vi.fn();
    const apply = vi.fn();
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: apply,
      postSpawnSandbox: vi.fn(),
    };

    let error;
    try {
      executionBroker.spawn("tool", [], {
        origin: "test:sandbox-required-invalid",
        policy: "allow",
        requiredBoundaries: ["imaginary-boundary"],
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      sandboxReason: "invalid_required_boundary",
      missingBoundaries: ["imaginary-boundary"],
    });
    expect(apply).not.toHaveBeenCalled();
    expect(nativeSpawn).not.toHaveBeenCalled();
  });

  it("fails closed when a native PTY cannot provide a required boundary", () => {
    const ptyModule = { spawn: vi.fn() };
    let error;
    try {
      executionBroker.spawnPty(ptyModule, "shell", [], {
        origin: "test:pty-required-boundary",
        policy: "allow",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      sandboxReason: "required_boundaries_unsatisfied",
      requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
      missingBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
    });
    expect(ptyModule.spawn).not.toHaveBeenCalled();
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      permissionDecision: "deny",
      sandboxRequired: [SANDBOX_BOUNDARIES.FILESYSTEM],
      sandboxGuarantees: [],
      sandboxBackend: null,
      sandboxState: "denied",
    });
  });

  it("passes adapter command, args, and options to native spawnSync", () => {
    const nativeSpawnSync = vi.fn(() => ({ status: 0 }));
    const apply = vi.fn((command, args, options) =>
      appliedPlan("sandbox-wrapper", ["--", command, ...args], {
        ...options,
        sandboxOption: true,
      }),
    );
    executionBroker._native = { spawnSync: nativeSpawnSync };
    executionBroker._sandboxAdapter = {
      applySandbox: apply,
      postSpawnSandbox: vi.fn(),
    };

    executionBroker.spawnSync("tool", ["run"], {
      origin: "test:sandbox-plan-sync",
      policy: "allow",
    });

    expect(nativeSpawnSync).toHaveBeenCalledWith(
      "sandbox-wrapper",
      ["--", "tool", "run"],
      expect.objectContaining({ sandboxOption: true }),
    );
    expect(apply.mock.calls[0][5]).toEqual({
      profile: "default",
      requiredBoundaries: [],
      sync: true,
    });
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      sandboxed: true,
      sandboxEnforcement: "test-sandbox",
    });
  });

  it("honors CC_SANDBOX_DISABLE without calling the adapter", () => {
    process.env.CC_SANDBOX_DISABLE = "1";
    const child = createChild();
    const nativeSpawn = vi.fn(() => child);
    const apply = vi.fn();
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: apply,
      postSpawnSandbox: vi.fn(),
    };

    executionBroker.spawn("tool", ["run"], {
      origin: "test:sandbox-disabled",
      policy: "allow",
    });

    expect(apply).not.toHaveBeenCalled();
    expect(nativeSpawn).toHaveBeenCalledWith(
      "tool",
      ["run"],
      expect.any(Object),
    );
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      sandboxed: false,
      sandboxState: "unavailable",
      sandboxReason: "disabled_by_environment",
    });
  });

  it("does not let CC_SANDBOX_DISABLE bypass strict mode", () => {
    process.env.CC_SANDBOX_DISABLE = "1";
    process.env.CC_SANDBOX_STRICT = "1";
    const nativeSpawn = vi.fn();
    const apply = vi.fn();
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: apply,
      postSpawnSandbox: vi.fn(),
    };

    expect(() =>
      executionBroker.spawn("tool", [], {
        origin: "test:sandbox-disabled-strict",
        policy: "allow",
      }),
    ).toThrow(/disabled_by_environment/);
    expect(apply).not.toHaveBeenCalled();
    expect(nativeSpawn).not.toHaveBeenCalled();
  });

  it("rejects an unavailable platform before spawn in strict mode", () => {
    process.env.CC_SANDBOX_STRICT = "1";
    const nativeSpawn = vi.fn();
    const apply = vi.fn((command, args, options, profile) => ({
      contractVersion: 1,
      applied: false,
      platform: "win32",
      profile,
      command,
      args,
      options,
      enforcement: null,
      reason: "windows_native_job_object_unavailable",
      postSpawn: { required: false, mode: "none" },
    }));
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: apply,
      postSpawnSandbox: vi.fn(),
    };

    expect(() =>
      executionBroker.spawn("tool", [], {
        origin: "test:sandbox-strict",
        policy: "allow",
      }),
    ).toThrow(/windows_native_job_object_unavailable/);
    expect(apply).toHaveBeenCalledWith(
      "tool",
      [],
      expect.any(Object),
      "strict",
      undefined,
      {
        profile: "strict",
        requiredBoundaries: [],
        sync: false,
      },
    );
    expect(nativeSpawn).not.toHaveBeenCalled();
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      sandboxed: false,
      sandboxState: "denied",
      sandboxReason: "windows_native_job_object_unavailable",
    });
  });

  it("rejects the legacy newCommand/newArgs adapter shape", () => {
    process.env.CC_SANDBOX_STRICT = "1";
    const nativeSpawn = vi.fn();
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: () => ({
        applied: true,
        newCommand: "legacy-wrapper",
        newArgs: ["tool"],
      }),
      postSpawnSandbox: vi.fn(),
    };

    expect(() =>
      executionBroker.spawn("tool", [], {
        origin: "test:sandbox-legacy-plan",
        policy: "allow",
      }),
    ).toThrow(/contractVersion must be 1/);
    expect(nativeSpawn).not.toHaveBeenCalled();
  });

  it("rejects required async post-spawn enforcement before strict spawn", () => {
    process.env.CC_SANDBOX_STRICT = "1";
    const nativeSpawn = vi.fn();
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: (command, args, options) =>
        appliedPlan(command, args, options, {
          postSpawn: { required: true, mode: "async" },
        }),
      postSpawnSandbox: vi.fn(),
    };

    expect(() =>
      executionBroker.spawn("tool", [], {
        origin: "test:sandbox-strict-async",
        policy: "allow",
      }),
    ).toThrow(/synchronous post-spawn enforcement/);
    expect(nativeSpawn).not.toHaveBeenCalled();
  });

  it("kills the child and throws when strict synchronous post-spawn fails", () => {
    process.env.CC_SANDBOX_STRICT = "1";
    const child = createChild();
    const nativeSpawn = vi.fn(() => child);
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: (command, args, options) =>
        appliedPlan(command, args, options, {
          postSpawn: { required: true, mode: "sync" },
        }),
      postSpawnSandbox: () => {
        throw new Error("job association failed");
      },
    };

    expect(() =>
      executionBroker.spawn("tool", [], {
        origin: "test:sandbox-post-spawn",
        policy: "allow",
      }),
    ).toThrow(/Post-spawn sandbox setup failed/);
    expect(nativeSpawn).toHaveBeenCalledOnce();
    expect(child.kill).toHaveBeenCalledOnce();
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      sandboxed: false,
      sandboxState: "denied",
      sandboxReason: "post_spawn_failed",
    });
  });

  it("exposes non-strict asynchronous post-spawn failure on sandboxReady", async () => {
    const child = createChild();
    executionBroker._native = { spawn: vi.fn(() => child) };
    executionBroker._sandboxAdapter = {
      applySandbox: (command, args, options) =>
        appliedPlan(command, args, options, {
          postSpawn: { required: true, mode: "async" },
        }),
      postSpawnSandbox: () => Promise.reject(new Error("late failure")),
    };

    executionBroker.spawn("tool", [], {
      origin: "test:sandbox-async-observable",
      policy: "allow",
    });

    await expect(child.sandboxReady).rejects.toThrow("late failure");
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      sandboxed: false,
      sandboxState: "failed",
      sandboxReason: "post_spawn_failed: late failure",
    });
    expect(emitWarning).toHaveBeenCalled();
  });
});
