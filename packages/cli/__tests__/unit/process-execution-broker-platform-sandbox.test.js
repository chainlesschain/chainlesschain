import { EventEmitter, once } from "node:events";
import { spawnSync as nativeSpawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
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

function createLinuxStaticElf64({
  elfClass = 2,
  dataEncoding = 1,
  elfType = 2,
  machine = 62,
  extraProgramType = null,
  programHeaderOffset = 64,
} = {}) {
  const programHeaderCount = extraProgramType === null ? 1 : 2;
  const bytes = 64 + programHeaderCount * 56 + 16;
  const image = Buffer.alloc(bytes);
  image.set([0x7f, 0x45, 0x4c, 0x46], 0);
  image[4] = elfClass;
  image[5] = dataEncoding;
  image[6] = 1;
  image.writeUInt16LE(elfType, 16);
  image.writeUInt16LE(machine, 18);
  image.writeUInt32LE(1, 20);
  image.writeBigUInt64LE(0x400040n, 24);
  image.writeBigUInt64LE(BigInt(programHeaderOffset), 32);
  image.writeUInt16LE(64, 52);
  image.writeUInt16LE(56, 54);
  image.writeUInt16LE(programHeaderCount, 56);

  if (programHeaderOffset + 56 <= image.length) {
    image.writeUInt32LE(1, programHeaderOffset);
    image.writeUInt32LE(0x5, programHeaderOffset + 4);
    image.writeBigUInt64LE(0n, programHeaderOffset + 8);
    image.writeBigUInt64LE(0x400000n, programHeaderOffset + 16);
    image.writeBigUInt64LE(0x400000n, programHeaderOffset + 24);
    image.writeBigUInt64LE(BigInt(image.length), programHeaderOffset + 32);
    image.writeBigUInt64LE(BigInt(image.length), programHeaderOffset + 40);
    image.writeBigUInt64LE(0x1000n, programHeaderOffset + 48);
  }
  if (
    extraProgramType !== null &&
    programHeaderOffset + 2 * 56 <= image.length
  ) {
    image.writeUInt32LE(extraProgramType, programHeaderOffset + 56);
  }
  return image;
}

function createLinuxStrongHarness({
  bwrapStatus = 0,
  bwrapStdout = "chainless-linux-bwrap-plugin-node-v1",
  bwrapHelp = "--ro-bind-fd FD DEST\n--disable-userns\n--assert-userns-disabled\n--seccomp FD\n",
  lddStdout = [
    "libc.so.6 => /lib/libc.so.6 (0x1)",
    "/lib64/ld-linux.so.2 (0x2)",
  ].join("\n"),
  includeBwrap = true,
  tamperSeccompFilter = false,
  entryRuntime = "node",
  nativeEntry = createLinuxStaticElf64(),
} = {}) {
  const nativeStatic = entryRuntime === "native-static-elf";
  const entryPath = nativeStatic ? "/plugin/bin/tool" : "/plugin/bin/tool.js";
  const directories = new Set([
    "/plugin",
    "/plugin/bin",
    "/plugin/lib",
    "/tmp",
  ]);
  const files = new Map([
    [
      entryPath,
      nativeStatic
        ? Buffer.from(nativeEntry)
        : Buffer.from("require('../lib/value.cjs');\n"),
    ],
    ["/plugin/lib/value.cjs", Buffer.from("module.exports = 42;\n")],
    ["/runtime/node", Buffer.from("attested-node-runtime")],
    ["/usr/bin/bwrap", Buffer.from("bubblewrap")],
    ["/usr/bin/ldd", Buffer.from("ldd")],
    ["/lib/libc.so.6", Buffer.from("libc")],
    ["/lib64/ld-linux.so.2", Buffer.from("loader")],
    ["/etc/ld.so.cache", Buffer.from("loader-cache")],
    [
      "/proc/self/mountinfo",
      Buffer.from("1 0 0:1 / / rw,relatime - ext4 /dev/root rw\n"),
    ],
  ]);
  if (!includeBwrap) files.delete("/usr/bin/bwrap");
  const identities = new Map();
  const openFiles = new Map();
  const detachedContents = new Map();
  const anonymousFiles = new Set();
  const fdOffsets = new Map();
  const mountIds = new Map();
  const lddInspectionSources = [];
  let nextIno = 700;
  let nextFd = 40;
  let nextTempDirectory = 1;
  for (const value of [...directories, ...files.keys()]) {
    identities.set(value, nextIno++);
  }
  const missing = (value) => {
    const error = new Error(`missing ${value}`);
    error.code = "ENOENT";
    return error;
  };
  const resolveFdPath = (value) => {
    const filePath = String(value);
    const match = filePath.match(/^\/proc\/self\/fd\/(\d+)(?:\/(.*))?$/);
    if (!match) return filePath;
    const base = openFiles.get(Number(match[1]));
    if (!base) throw missing(filePath);
    return match[2] ? path.posix.join(base, match[2]) : base;
  };
  const statFor = (value) => {
    const filePath = resolveFdPath(value);
    if (!directories.has(filePath) && !files.has(filePath)) {
      throw missing(filePath);
    }
    const isDirectory = directories.has(filePath);
    const contents = files.get(filePath);
    return {
      dev: 11,
      ino: identities.get(filePath),
      size: contents?.length || 0,
      mtimeMs: 1234,
      nlink: 1,
      mode: isDirectory
        ? 0o040755
        : filePath === entryPath && !nativeStatic
          ? 0o100644
          : 0o100755,
      uid: 0,
      isFile: () => !isDirectory,
      isDirectory: () => isDirectory,
      isSymbolicLink: () => false,
      isSocket: () => false,
      isFIFO: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
    };
  };
  const fsRuntime = {
    constants: {
      O_RDONLY: 0,
      O_RDWR: 0x2,
      O_CREAT: 0x40,
      O_EXCL: 0x80,
      O_TMPFILE: 0x410000,
      O_NONBLOCK: 0x800,
      O_DIRECTORY: 0x10000,
      O_NOFOLLOW: 0x20000,
    },
    existsSync: vi.fn((value) => {
      const filePath = resolveFdPath(value);
      return directories.has(filePath) || files.has(filePath);
    }),
    realpathSync: Object.assign(
      vi.fn((value) => {
        const filePath = resolveFdPath(value);
        if (!directories.has(filePath) && !files.has(filePath)) {
          throw missing(filePath);
        }
        return filePath;
      }),
      {
        native: vi.fn((value) => {
          const filePath = resolveFdPath(value);
          if (!directories.has(filePath) && !files.has(filePath)) {
            throw missing(filePath);
          }
          return filePath;
        }),
      },
    ),
    lstatSync: vi.fn(statFor),
    statSync: vi.fn(statFor),
    readFileSync: vi.fn((value) => {
      const fdInfo = String(value).match(/^\/proc\/self\/fdinfo\/(\d+)$/);
      if (fdInfo) {
        const openPath = openFiles.get(Number(fdInfo[1]));
        if (!openPath) throw missing(String(value));
        return Buffer.from(
          `pos:\t0\nflags:\t0100000\nmnt_id:\t${
            mountIds.get(openPath) || 77
          }\n`,
        );
      }
      const filePath =
        typeof value === "number" ? openFiles.get(value) : resolveFdPath(value);
      if (!files.has(filePath)) throw missing(filePath);
      return Buffer.from(files.get(filePath));
    }),
    readSync: vi.fn((fd, buffer, offset, length, position) => {
      const filePath = openFiles.get(fd);
      const contents = detachedContents.get(fd) || files.get(filePath);
      if (!filePath || !contents) throw missing(`fd:${fd}`);
      const available = Math.max(
        0,
        Math.min(length, contents.length - position),
      );
      if (available > 0) {
        contents.copy(buffer, offset, position, position + available);
      }
      return available;
    }),
    readdirSync: vi.fn((value) => {
      const directory = resolveFdPath(value);
      if (!directories.has(directory)) throw missing(directory);
      const children = new Set();
      for (const candidate of [...directories, ...files.keys()]) {
        if (candidate === directory) continue;
        if (path.posix.dirname(candidate) === directory) {
          children.add(path.posix.basename(candidate));
        }
      }
      return [...children].map((name) => ({ name }));
    }),
    mkdtempSync: vi.fn((prefix) => {
      const directory = `${prefix}${nextTempDirectory++}`;
      directories.add(directory);
      identities.set(directory, nextIno++);
      return directory;
    }),
    openSync: vi.fn((value, flags = 0) => {
      let filePath = resolveFdPath(value);
      const anonymous =
        (Number(flags) & fsRuntime.constants.O_TMPFILE) ===
        fsRuntime.constants.O_TMPFILE;
      if (anonymous) {
        if (!directories.has(filePath)) throw missing(filePath);
        filePath = `anonymous-seccomp-${nextIno}`;
        files.set(filePath, Buffer.alloc(0));
        identities.set(filePath, nextIno++);
        anonymousFiles.add(filePath);
      }
      const create = (Number(flags) & 0x40) !== 0;
      const exclusive = (Number(flags) & 0x80) !== 0;
      if (create && exclusive && files.has(filePath)) {
        const error = new Error(`exists ${filePath}`);
        error.code = "EEXIST";
        throw error;
      }
      if (create && !files.has(filePath) && !directories.has(filePath)) {
        files.set(filePath, Buffer.alloc(0));
        identities.set(filePath, nextIno++);
      }
      if (!files.has(filePath) && !directories.has(filePath)) {
        throw missing(filePath);
      }
      const fd = nextFd++;
      openFiles.set(fd, filePath);
      fdOffsets.set(fd, 0);
      if (anonymous) detachedContents.set(fd, Buffer.alloc(0));
      return fd;
    }),
    writeSync: vi.fn((fd, buffer, offset, length, position) => {
      const filePath = openFiles.get(fd);
      if (!filePath || !files.has(filePath)) throw missing(`fd:${fd}`);
      const previous = files.get(filePath);
      const required = position + length;
      const contents =
        previous.length >= required
          ? Buffer.from(previous)
          : Buffer.concat([previous, Buffer.alloc(required - previous.length)]);
      buffer.copy(contents, position, offset, offset + length);
      files.set(filePath, contents);
      if (detachedContents.has(fd)) {
        detachedContents.set(fd, Buffer.from(contents));
      }
      return length;
    }),
    fchmodSync: vi.fn(),
    fsyncSync: vi.fn((fd) => {
      if (!tamperSeccompFilter || !detachedContents.has(fd)) return;
      const filePath = openFiles.get(fd);
      const contents = Buffer.from(files.get(filePath));
      contents[contents.length - 1] ^= 0xff;
      files.set(filePath, contents);
      detachedContents.set(fd, Buffer.from(contents));
    }),
    fstatSync: vi.fn((fd) => {
      const filePath = openFiles.get(fd);
      if (!filePath) throw missing(`fd:${fd}`);
      return statFor(filePath);
    }),
    closeSync: vi.fn((fd) => {
      const filePath = openFiles.get(fd);
      if (!openFiles.delete(fd)) throw missing(`fd:${fd}`);
      if (anonymousFiles.delete(filePath)) {
        files.delete(filePath);
        identities.delete(filePath);
      }
      detachedContents.delete(fd);
      fdOffsets.delete(fd);
    }),
    unlinkSync: vi.fn((value) => {
      const filePath = String(value);
      const contents = files.get(filePath);
      for (const [fd, openPath] of openFiles) {
        if (openPath === filePath && contents) {
          detachedContents.set(fd, Buffer.from(contents));
        }
      }
      if (!files.delete(filePath)) throw missing(filePath);
      identities.delete(filePath);
    }),
    rmdirSync: vi.fn((value) => {
      const directory = String(value);
      if (!directories.delete(directory)) throw missing(directory);
      identities.delete(directory);
    }),
  };
  const spawnSync = vi.fn((command, args, options) => {
    if (command === "/usr/bin/ldd") {
      const inspectionChildFd = Number(
        String(args?.[0] || "").match(/^\/proc\/self\/fd\/(\d+)$/)?.[1],
      );
      const inspectionParentFd = options?.stdio?.[inspectionChildFd];
      lddInspectionSources.push(openFiles.get(inspectionParentFd) || null);
      return {
        status: 0,
        stdout: lddStdout,
        stderr: "",
      };
    }
    if (command === "/usr/bin/bwrap") {
      if (args?.[0] === "--help") {
        return {
          status: 0,
          stdout: bwrapHelp,
          stderr: "",
        };
      }
      const seccompIndex = args.indexOf("--seccomp");
      const seccompChildFd = Number(args[seccompIndex + 1]);
      const seccompParentFd = options?.stdio?.[seccompChildFd];
      const seccompContents = detachedContents.get(seccompParentFd);
      const seccompOffset = fdOffsets.get(seccompParentFd);
      if (
        seccompIndex < 0 ||
        !seccompContents ||
        seccompOffset !== 0 ||
        seccompContents.length === 0 ||
        seccompContents.length % 8 !== 0
      ) {
        return {
          status: 1,
          stdout: "",
          stderr: "invalid seccomp filter descriptor",
        };
      }
      fdOffsets.set(seccompParentFd, seccompContents.length);
      return { status: bwrapStatus, stdout: bwrapStdout, stderr: "" };
    }
    throw new Error(`unexpected command ${command}`);
  });
  const identityFor = (filePath) => {
    const stat = statFor(filePath);
    return Object.freeze({
      contractVersion: 1,
      realPath: filePath,
      sha256: crypto
        .createHash("sha256")
        .update(files.get(filePath))
        .digest("hex"),
      bytes: stat.size,
      fileId: Object.freeze({
        dev: String(stat.dev),
        ino: String(stat.ino),
      }),
      mtimeMs: stat.mtimeMs,
      attestation: "realpath-file-id-sha256",
    });
  };
  const contract = Object.freeze({
    contractVersion: 1,
    kind: nativeStatic
      ? "strict-plugin-native-static-elf-bin"
      : "strict-plugin-node-bin",
    pluginRoot: "/plugin",
    workingDirectory: "/plugin",
    runtimePath: "/runtime/node",
    rootIdentity: Object.freeze({
      realPath: "/plugin",
      fileId: Object.freeze({
        dev: String(statFor("/plugin").dev),
        ino: String(statFor("/plugin").ino),
      }),
      attestation: "realpath-directory-file-id",
    }),
    entryIdentity: identityFor(entryPath),
    runtimeIdentity: identityFor("/runtime/node"),
  });
  return {
    contract,
    detachedContents,
    directories,
    entryPath,
    files,
    fsRuntime,
    identities,
    fdOffsets,
    lddInspectionSources,
    mountIds,
    openFiles,
    spawnSync,
    statFor,
  };
}

function applyLinuxStrongNativeHarness(harness, args = ["--label", "ready"]) {
  const requiredBoundaries = [
    SANDBOX_BOUNDARIES.FILESYSTEM,
    SANDBOX_BOUNDARIES.NETWORK,
  ];
  return applySandbox(
    harness.entryPath,
    args,
    {
      cwd: "/plugin",
      shell: false,
      env: {
        PATH: "/host/path",
        LD_LIBRARY_PATH: "/host/plugin-native-libs",
      },
    },
    {
      profile: "strict",
      requiredBoundaries,
    },
    {
      platform: "linux",
      arch: "x64",
      fs: harness.fsRuntime,
      homedir: () => "/home/tester",
      spawnSync: harness.spawnSync,
    },
    {
      profile: "strict",
      requiredBoundaries,
      sync: true,
      executionContract: harness.contract,
    },
  );
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

  it("requires a trusted execution contract before probing or starting bubblewrap", () => {
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
      reason: "linux_bwrap_execution_contract_missing",
      guarantees: [],
      runtimeProbe: {
        kind: "linux-bwrap-plugin-node-policy-v1",
        attempted: false,
        runnable: false,
        reason: "execution_contract_missing",
      },
    });
    expect(probeSpawnSync).not.toHaveBeenCalled();
  });

  it("builds an attested empty-root bwrap plan for one direct Plugin Node bin", () => {
    const harness = createLinuxStrongHarness();
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js", "--label", "ready"],
      {
        cwd: "/plugin",
        shell: false,
        env: {
          PATH: "/host/path",
          NODE_OPTIONS: "--require=/host/secret.js",
          SSH_AUTH_SOCK: "/run/user/1000/ssh-agent",
          CC_SESSION_ID: "session-1",
        },
      },
      {
        profile: "strict",
        requiredBoundaries: [
          SANDBOX_BOUNDARIES.FILESYSTEM,
          SANDBOX_BOUNDARIES.NETWORK,
        ],
      },
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [
          SANDBOX_BOUNDARIES.FILESYSTEM,
          SANDBOX_BOUNDARIES.NETWORK,
        ],
        sync: true,
        executionContract: harness.contract,
      },
    );

    expect(plan).toMatchObject({
      applied: true,
      backend: "linux-bwrap",
      enforcement: "linux-bwrap",
      policyAttested: true,
      reason: null,
      guarantees: [SANDBOX_BOUNDARIES.FILESYSTEM, SANDBOX_BOUNDARIES.NETWORK],
      runtimeProbe: {
        attempted: true,
        runnable: true,
        reason: null,
      },
    });
    expect(plan.policyDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.command).toBe("/usr/bin/bwrap");
    expect(plan.args).toContain("--unshare-user");
    expect(plan.args).toContain("--disable-userns");
    expect(plan.args).toContain("--unshare-net");
    expect(plan.args).toContain("--seccomp");
    expect(plan.args).toContain("--clearenv");
    expect(plan.args).toContain("--remount-ro");
    expect(plan.args.join("\0")).not.toContain("--ro-bind\0/\0/");
    expect(plan.args).toEqual(
      expect.arrayContaining([
        "--ro-bind-fd",
        expect.any(String),
        "/opt/chainless/plugin/bin/tool.js",
      ]),
    );
    expect(plan.args).not.toContain("/plugin");
    const libDirectoryIndex = plan.args.findIndex(
      (value, index) => value === "--dir" && plan.args[index + 1] === "/lib",
    );
    const libBindIndex = plan.args.findIndex(
      (value, index) =>
        value === "--ro-bind-fd" && plan.args[index + 2] === "/lib/libc.so.6",
    );
    expect(libDirectoryIndex).toBeGreaterThan(-1);
    expect(libBindIndex).toBeGreaterThan(libDirectoryIndex);
    expect(plan.args.slice(-5)).toEqual([
      "--",
      "/opt/chainless/runtime/node",
      "/opt/chainless/plugin/bin/tool.js",
      "--label",
      "ready",
    ]);
    expect(plan.options).toMatchObject({
      cwd: "/",
      shell: false,
      detached: false,
      env: {
        PATH: "/usr/bin:/bin",
        LANG: "C",
        LC_ALL: "C",
      },
    });
    expect(plan.args.join("\0")).not.toContain("NODE_OPTIONS");
    expect(plan.args.join("\0")).not.toContain("SSH_AUTH_SOCK");
    expect(plan.args.join("\0")).not.toContain("CC_SESSION_ID");
    expect(harness.spawnSync.mock.calls.map(([command]) => command)).toEqual([
      "/usr/bin/bwrap",
      "/usr/bin/ldd",
      "/usr/bin/bwrap",
    ]);
    expect(plan.options.stdio.length).toBeGreaterThan(3);
    const anonymousFilterOpens = harness.fsRuntime.openSync.mock.calls.filter(
      ([value, flags, mode]) =>
        value === "/tmp" &&
        (Number(flags) & harness.fsRuntime.constants.O_TMPFILE) ===
          harness.fsRuntime.constants.O_TMPFILE &&
        mode === 0o400,
    );
    expect(anonymousFilterOpens).toHaveLength(2);
    expect(harness.fsRuntime.mkdtempSync).not.toHaveBeenCalled();
    const seccompIndex = plan.args.indexOf("--seccomp");
    expect(plan.args[seccompIndex + 1]).toBe(
      String(plan.options.stdio.length - 1),
    );
    const actualSeccompFd =
      plan.options.stdio[Number(plan.args[seccompIndex + 1])];
    expect(harness.fdOffsets.get(actualSeccompFd)).toBe(0);
    const seccompProgram = harness.detachedContents.get(actualSeccompFd);
    expect(seccompProgram.length % 8).toBe(0);
    const seccompConstants = [];
    for (let offset = 0; offset < seccompProgram.length; offset += 8) {
      seccompConstants.push(seccompProgram.readUInt32LE(offset + 4));
    }
    const expectedSocketSyscalls =
      process.arch === "arm64" || process.arch === "riscv64"
        ? [198, 199]
        : [41, 53];
    expect(seccompConstants).toEqual(
      expect.arrayContaining([
        ...expectedSocketSyscalls,
        425,
        0x00050001,
        0x7fff0000,
      ]),
    );
    const descriptorReaddirPaths = harness.fsRuntime.readdirSync.mock.calls
      .map(([value]) => String(value))
      .filter((value) => value.startsWith("/proc/self/fd/"));
    expect(descriptorReaddirPaths.length).toBeGreaterThanOrEqual(3);
    expect(
      descriptorReaddirPaths.every((value) =>
        /^\/proc\/self\/fd\/\d+$/.test(value),
      ),
    ).toBe(true);
    expect(harness.openFiles.size).toBeGreaterThan(0);
    plan.cleanup();
    expect(harness.openFiles.size).toBe(0);
  });

  it("builds an attested bwrap plan for one direct static ELF native bin", () => {
    const harness = createLinuxStrongHarness({
      entryRuntime: "native-static-elf",
    });
    const plan = applyLinuxStrongNativeHarness(harness);

    expect(harness.contract.kind).toBe("strict-plugin-native-static-elf-bin");
    expect(plan).toMatchObject({
      applied: true,
      backend: "linux-bwrap",
      enforcement: "linux-bwrap",
      policyAttested: true,
      reason: null,
      guarantees: [SANDBOX_BOUNDARIES.FILESYSTEM, SANDBOX_BOUNDARIES.NETWORK],
      runtimeProbe: {
        kind: "linux-bwrap-plugin-native-static-elf-policy-v1",
        attempted: true,
        runnable: true,
        reason: null,
        probeRuntime: "node",
        targetRuntime: "native-static-elf",
        contentSnapshot: false,
        handleAtomic: false,
      },
    });
    expect(plan.args).toEqual(
      expect.arrayContaining([
        "--ro-bind-fd",
        expect.any(String),
        "/opt/chainless/plugin/bin/tool",
      ]),
    );
    expect(plan.args.slice(-4)).toEqual([
      "--",
      "/opt/chainless/plugin/bin/tool",
      "--label",
      "ready",
    ]);
    expect(plan.args.join("\0")).not.toContain("LD_LIBRARY_PATH");
    expect(harness.lddInspectionSources).toEqual(["/runtime/node"]);
    const policyProbeCall = harness.spawnSync.mock.calls.find(
      ([command, probeArgs]) =>
        command === "/usr/bin/bwrap" && probeArgs?.[0] !== "--help",
    );
    const probeSeparator = policyProbeCall[1].lastIndexOf("--");
    expect(
      policyProbeCall[1].slice(probeSeparator + 1, probeSeparator + 3),
    ).toEqual(["/opt/chainless/runtime/node", "-e"]);
    expect(
      policyProbeCall[1]
        .slice(probeSeparator + 1)
        .includes("/opt/chainless/plugin/bin/tool"),
    ).toBe(false);
    expect(harness.openFiles.size).toBeGreaterThan(0);

    plan.cleanup();
    expect(harness.openFiles.size).toBe(0);
  });

  it.each([
    [
      "PT_INTERP",
      createLinuxStaticElf64({ extraProgramType: 3 }),
      "native_entry_interpreter_unsupported",
    ],
    [
      "PT_DYNAMIC",
      createLinuxStaticElf64({ extraProgramType: 2 }),
      "native_entry_dynamic_elf_unsupported",
    ],
    [
      "ET_DYN",
      createLinuxStaticElf64({ elfType: 3 }),
      "native_entry_not_static_et_exec",
    ],
    [
      "ELF32",
      createLinuxStaticElf64({ elfClass: 1 }),
      "native_entry_not_elf64",
    ],
    [
      "big-endian ELF",
      createLinuxStaticElf64({ dataEncoding: 2 }),
      "native_entry_not_little_endian",
    ],
    [
      "foreign architecture",
      createLinuxStaticElf64({ machine: 183 }),
      "native_entry_architecture_mismatch",
    ],
    [
      "out-of-bounds program headers",
      createLinuxStaticElf64({ programHeaderOffset: 4096 }),
      "native_entry_program_headers_out_of_bounds",
    ],
    [
      "executable script",
      Buffer.from("#!/bin/sh\nexit 0\n".padEnd(128, "#")),
      "native_entry_not_elf",
    ],
  ])(
    "rejects a native %s before the bwrap policy probe or target spawn",
    (_label, nativeEntry, expectedReason) => {
      const harness = createLinuxStrongHarness({
        entryRuntime: "native-static-elf",
        nativeEntry,
      });
      const plan = applyLinuxStrongNativeHarness(harness);

      expect(plan).toMatchObject({
        applied: false,
        backend: null,
        candidateBackend: "linux-bwrap",
        policyAttested: false,
        reason: "linux_bwrap_execution_contract_invalid",
        guarantees: [],
        runtimeProbe: {
          kind: "linux-bwrap-plugin-native-static-elf-policy-v1",
          attempted: false,
          runnable: false,
          reason: expectedReason,
          probeRuntime: "node",
          targetRuntime: "native-static-elf",
          contentSnapshot: false,
          handleAtomic: false,
        },
      });
      expect(harness.lddInspectionSources).toEqual([]);
      expect(harness.spawnSync).not.toHaveBeenCalled();
      expect(
        harness.spawnSync.mock.calls.filter(
          ([command, probeArgs]) =>
            command === "/usr/bin/bwrap" && probeArgs?.[0] !== "--help",
        ),
      ).toHaveLength(0);
      expect(
        harness.spawnSync.mock.calls.some(([, spawnArgs]) =>
          spawnArgs?.includes("/opt/chainless/plugin/bin/tool"),
        ),
      ).toBe(false);
      expect(harness.openFiles.size).toBe(0);
    },
  );

  it.each([
    ["x64", 0xc000003e, 41, 53, 0xbfffffff],
    ["arm64", 0xc00000b7, 198, 199, null],
    ["riscv64", 0xc00000f3, 198, 199, null],
  ])(
    "emits the exact fail-closed network cBPF program for %s",
    (arch, auditArch, socketSyscall, socketpairSyscall, syscallMask) => {
      const harness = createLinuxStrongHarness();
      const plan = applySandbox(
        "/runtime/node",
        ["/plugin/bin/tool.js"],
        { cwd: "/plugin", shell: false },
        "strict",
        {
          platform: "linux",
          arch,
          fs: harness.fsRuntime,
          homedir: () => "/home/tester",
          spawnSync: harness.spawnSync,
        },
        {
          profile: "strict",
          requiredBoundaries: [SANDBOX_BOUNDARIES.NETWORK],
          sync: true,
          executionContract: harness.contract,
        },
      );

      expect(plan.applied).toBe(true);
      const seccompIndex = plan.args.indexOf("--seccomp");
      const seccompFd = plan.options.stdio[Number(plan.args[seccompIndex + 1])];
      const program = harness.detachedContents.get(seccompFd);
      const decoded = [];
      for (let offset = 0; offset < program.length; offset += 8) {
        decoded.push([
          program.readUInt16LE(offset),
          program.readUInt8(offset + 2),
          program.readUInt8(offset + 3),
          program.readUInt32LE(offset + 4),
        ]);
      }
      expect(decoded).toEqual([
        [0x20, 0, 0, 4],
        [0x15, 1, 0, auditArch],
        [0x06, 0, 0, 0x80000000],
        [0x20, 0, 0, 0],
        ...(syscallMask === null ? [] : [[0x54, 0, 0, syscallMask]]),
        [0x15, 0, 1, socketSyscall],
        [0x06, 0, 0, 0x00050001],
        [0x15, 0, 1, socketpairSyscall],
        [0x06, 0, 0, 0x00050001],
        [0x15, 0, 1, 425],
        [0x06, 0, 0, 0x00050001],
        [0x06, 0, 0, 0x7fff0000],
      ]);
      plan.cleanup();
      expect(harness.openFiles.size).toBe(0);
    },
  );

  it("rejects an async strong Plugin Node contract before probing bwrap", () => {
    const harness = createLinuxStrongHarness();
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js"],
      { cwd: "/plugin", shell: false },
      "strict",
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [
          SANDBOX_BOUNDARIES.FILESYSTEM,
          SANDBOX_BOUNDARIES.NETWORK,
        ],
        sync: false,
        executionContract: harness.contract,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_bwrap_execution_contract_invalid",
      guarantees: [],
      runtimeProbe: {
        attempted: false,
        runnable: false,
        reason: "unsupported_launch_options",
      },
    });
    expect(harness.spawnSync).not.toHaveBeenCalled();
    expect(harness.openFiles.size).toBe(0);
  });

  it("keeps the policy digest independent of user argv values", () => {
    const createPlan = (userArg) => {
      const harness = createLinuxStrongHarness();
      const plan = applySandbox(
        "/runtime/node",
        ["/plugin/bin/tool.js", "--token", userArg],
        { cwd: "/plugin", shell: false },
        "strict",
        {
          platform: "linux",
          fs: harness.fsRuntime,
          homedir: () => "/home/tester",
          spawnSync: harness.spawnSync,
        },
        {
          profile: "strict",
          requiredBoundaries: [
            SANDBOX_BOUNDARIES.FILESYSTEM,
            SANDBOX_BOUNDARIES.NETWORK,
          ],
          sync: true,
          executionContract: harness.contract,
        },
      );
      return { harness, plan };
    };
    const left = createPlan("first-sensitive-value");
    const right = createPlan("different-sensitive-value");

    expect(left.plan.policyDigest).toBe(right.plan.policyDigest);
    left.plan.cleanup();
    right.plan.cleanup();
    expect(left.harness.openFiles.size).toBe(0);
    expect(right.harness.openFiles.size).toBe(0);
  });

  it("keeps a failed fixed-policy bwrap probe as a candidate with no guarantee", () => {
    const harness = createLinuxStrongHarness({ bwrapStatus: 1 });
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js"],
      { cwd: "/plugin", shell: false },
      "strict",
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [
          SANDBOX_BOUNDARIES.FILESYSTEM,
          SANDBOX_BOUNDARIES.NETWORK,
        ],
        sync: true,
        executionContract: harness.contract,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      backend: null,
      candidateBackend: "linux-bwrap",
      policyAttested: false,
      reason: "linux_bwrap_policy_probe_failed",
      guarantees: [],
      runtimeProbe: {
        attempted: true,
        runnable: false,
        reason: "probe_failed",
      },
    });
    expect(plan.policyDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(harness.openFiles.size).toBe(0);
  });

  it("re-attests the target after the policy probe before returning a guarantee", () => {
    const harness = createLinuxStrongHarness();
    const originalSpawnSync = harness.spawnSync.getMockImplementation();
    harness.spawnSync.mockImplementation((command, args, options) => {
      const result = originalSpawnSync(command, args, options);
      if (command === "/usr/bin/bwrap" && args?.[0] !== "--help") {
        harness.files.set(
          "/plugin/bin/tool.js",
          Buffer.from("process.stdout.write('changed after probe')"),
        );
      }
      return result;
    });
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js"],
      { cwd: "/plugin", shell: false },
      "strict",
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        sync: true,
        executionContract: harness.contract,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      policyAttested: false,
      reason: "linux_bwrap_execution_contract_changed",
      guarantees: [],
      runtimeProbe: {
        attempted: true,
        runnable: false,
        reason: "post_probe_execution_identity_changed",
      },
    });
  });

  it.each([
    ["shell", { shell: true }],
    ["detached", { shell: false, detached: true }],
    ["ipc", { shell: false, stdio: ["pipe", "pipe", "pipe", "ipc"] }],
    ["numeric fd", { shell: false, stdio: ["pipe", "pipe", 9] }],
  ])(
    "rejects unsupported %s Plugin Node launch options before probing bwrap",
    (_label, launchOptions) => {
      const harness = createLinuxStrongHarness();
      const plan = applySandbox(
        "/runtime/node",
        ["/plugin/bin/tool.js"],
        { cwd: "/plugin", ...launchOptions },
        "strict",
        {
          platform: "linux",
          fs: harness.fsRuntime,
          homedir: () => "/home/tester",
          spawnSync: harness.spawnSync,
        },
        {
          profile: "strict",
          requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
          sync: true,
          executionContract: harness.contract,
        },
      );

      expect(plan).toMatchObject({
        applied: false,
        policyAttested: false,
        reason: "linux_bwrap_execution_contract_invalid",
        guarantees: [],
        runtimeProbe: {
          attempted: false,
          runnable: false,
          reason: "unsupported_launch_options",
        },
      });
      expect(harness.spawnSync).not.toHaveBeenCalled();
    },
  );

  it("rejects an entry identity change before probing or starting bwrap", () => {
    const harness = createLinuxStrongHarness();
    harness.files.set(
      "/plugin/bin/tool.js",
      Buffer.from("require('node:fs').writeFileSync('/tmp/marker', 'x')"),
    );
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js"],
      { cwd: "/plugin", shell: false },
      "strict",
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        sync: true,
        executionContract: harness.contract,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_bwrap_execution_contract_invalid",
      guarantees: [],
      runtimeProbe: {
        attempted: false,
        reason: "execution_identity_changed",
      },
    });
    expect(harness.spawnSync).not.toHaveBeenCalled();
  });

  it("rejects a nested host mount inside the plugin root", () => {
    const harness = createLinuxStrongHarness();
    harness.files.set(
      "/proc/self/mountinfo",
      Buffer.from(
        [
          "1 0 0:1 / / rw,relatime - ext4 /dev/root rw",
          "2 1 0:1 /secret /plugin/lib/mounted rw,relatime - ext4 /dev/root rw",
        ].join("\n"),
      ),
    );
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js"],
      { cwd: "/plugin", shell: false },
      "strict",
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        sync: true,
        executionContract: harness.contract,
      },
    );

    expect(plan.runtimeProbe).toMatchObject({
      attempted: false,
      runnable: false,
      reason: "plugin_tree_unattested",
    });
    expect(plan.guarantees).toEqual([]);
    expect(harness.spawnSync).not.toHaveBeenCalled();
  });

  it.each(["fuse.sshfs", "nfs", "cifs", "9p", "virtiofs", "unknownfs"])(
    "rejects a plugin root backed by %s before probing bubblewrap",
    (filesystemType) => {
      const harness = createLinuxStrongHarness();
      harness.files.set(
        "/proc/self/mountinfo",
        Buffer.from(
          [
            "1 0 0:1 / / rw,relatime - ext4 /dev/root rw",
            `2 1 0:2 /source /plugin rw,relatime - ${filesystemType} source rw`,
          ].join("\n"),
        ),
      );
      const plan = applySandbox(
        "/runtime/node",
        ["/plugin/bin/tool.js"],
        { cwd: "/plugin", shell: false },
        "strict",
        {
          platform: "linux",
          fs: harness.fsRuntime,
          homedir: () => "/home/tester",
          spawnSync: harness.spawnSync,
        },
        {
          profile: "strict",
          requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
          sync: true,
          executionContract: harness.contract,
        },
      );

      expect(plan.runtimeProbe).toMatchObject({
        attempted: false,
        runnable: false,
        reason: "plugin_tree_unattested",
      });
      expect(plan.guarantees).toEqual([]);
      expect(harness.spawnSync).not.toHaveBeenCalled();
    },
  );

  it("rejects an exact local bind mount at the plugin root", () => {
    const harness = createLinuxStrongHarness();
    harness.files.set(
      "/proc/self/mountinfo",
      Buffer.from(
        [
          "1 0 0:1 / / rw,relatime - ext4 /dev/root rw",
          "2 1 0:1 /other-plugin /plugin rw,relatime - ext4 /dev/root rw",
        ].join("\n"),
      ),
    );
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js"],
      { cwd: "/plugin", shell: false },
      "strict",
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        sync: true,
        executionContract: harness.contract,
      },
    );

    expect(plan.runtimeProbe).toMatchObject({
      attempted: false,
      runnable: false,
      reason: "plugin_tree_unattested",
    });
    expect(plan.guarantees).toEqual([]);
    expect(harness.spawnSync).not.toHaveBeenCalled();
  });

  it("rejects a plugin subtree that crosses a mount identity through a directory fd", () => {
    const harness = createLinuxStrongHarness();
    harness.mountIds.set("/plugin/lib", 88);
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js"],
      { cwd: "/plugin", shell: false },
      "strict",
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        sync: true,
        executionContract: harness.contract,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_bwrap_plugin_tree_unattested",
      guarantees: [],
    });
    expect(harness.openFiles.size).toBe(0);
    expect(
      harness.spawnSync.mock.calls.filter(
        ([command, args]) =>
          command === "/usr/bin/bwrap" && args?.[0] !== "--help",
      ),
    ).toHaveLength(0);
  });

  it("rejects a plugin root inode replacement between validation and pinning", () => {
    const harness = createLinuxStrongHarness();
    const originalSpawnSync = harness.spawnSync.getMockImplementation();
    harness.spawnSync.mockImplementation((command, args, options) => {
      const result = originalSpawnSync(command, args, options);
      if (command === "/usr/bin/ldd") {
        harness.identities.set("/plugin", 9_999);
      }
      return result;
    });
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js"],
      { cwd: "/plugin", shell: false },
      "strict",
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        sync: true,
        executionContract: harness.contract,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_bwrap_plugin_tree_unattested",
      guarantees: [],
      runtimeProbe: {
        attempted: false,
        runnable: false,
        reason: "plugin_root_not_directory",
      },
    });
    expect(harness.openFiles.size).toBe(0);
  });

  it("rejects a root-wide plugin contract before probing bwrap", () => {
    const harness = createLinuxStrongHarness();
    harness.directories.add("/");
    harness.identities.set("/", 1);
    const contract = Object.freeze({
      ...harness.contract,
      pluginRoot: "/",
      workingDirectory: "/",
      rootIdentity: Object.freeze({
        realPath: "/",
        fileId: Object.freeze({
          dev: String(harness.statFor("/").dev),
          ino: String(harness.statFor("/").ino),
        }),
        attestation: "realpath-directory-file-id",
      }),
    });
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js"],
      { cwd: "/", shell: false },
      "strict",
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        sync: true,
        executionContract: contract,
      },
    );

    expect(plan.runtimeProbe).toMatchObject({
      attempted: false,
      runnable: false,
      reason: "broad_plugin_root_disallowed",
    });
    expect(plan.guarantees).toEqual([]);
    expect(harness.spawnSync).not.toHaveBeenCalled();
  });

  it("reports an unattested or missing fixed bwrap binary without running ldd", () => {
    const harness = createLinuxStrongHarness({ includeBwrap: false });
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js"],
      { cwd: "/plugin", shell: false },
      "strict",
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.NETWORK],
        sync: true,
        executionContract: harness.contract,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_bwrap_unavailable",
      guarantees: [],
      runtimeProbe: {
        attempted: false,
        runnable: false,
        reason: "binary_missing_or_unattested",
      },
    });
    expect(harness.spawnSync).not.toHaveBeenCalled();
  });

  it("fails closed when bubblewrap lacks descriptor-backed bind support", () => {
    const harness = createLinuxStrongHarness({
      bwrapHelp: "--disable-userns\n--assert-userns-disabled\n",
    });
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js"],
      { cwd: "/plugin", shell: false },
      "strict",
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        sync: true,
        executionContract: harness.contract,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_bwrap_unavailable",
      guarantees: [],
      runtimeProbe: {
        attempted: true,
        runnable: false,
        reason: "required_option_missing:ro-bind-fd",
      },
    });
    expect(harness.spawnSync).toHaveBeenCalledOnce();
  });

  it("fails closed when bubblewrap cannot install the network seccomp filter", () => {
    const harness = createLinuxStrongHarness({
      bwrapHelp:
        "--ro-bind-fd FD DEST\n--disable-userns\n--assert-userns-disabled\n",
    });
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js"],
      { cwd: "/plugin", shell: false },
      "strict",
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.NETWORK],
        sync: true,
        executionContract: harness.contract,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_bwrap_unavailable",
      guarantees: [],
      runtimeProbe: {
        attempted: true,
        runnable: false,
        reason: "required_option_missing:seccomp",
      },
    });
    expect(harness.spawnSync).toHaveBeenCalledOnce();
  });

  it("fails closed and releases every pin on an unsupported seccomp architecture", () => {
    const harness = createLinuxStrongHarness();
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js"],
      { cwd: "/plugin", shell: false },
      "strict",
      {
        platform: "linux",
        arch: "unsupported-test-arch",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.NETWORK],
        sync: true,
        executionContract: harness.contract,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_bwrap_seccomp_unattested",
      guarantees: [],
      runtimeProbe: {
        attempted: false,
        runnable: false,
        reason: "unsupported_seccomp_architecture:unsupported-test-arch",
      },
    });
    expect(harness.spawnSync.mock.calls.map(([command]) => command)).toEqual([
      "/usr/bin/bwrap",
      "/usr/bin/ldd",
    ]);
    expect(harness.openFiles.size).toBe(0);
  });

  it("fails closed when the anonymous seccomp filter bytes change before handoff", () => {
    const harness = createLinuxStrongHarness({
      tamperSeccompFilter: true,
    });
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js"],
      { cwd: "/plugin", shell: false },
      "strict",
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.NETWORK],
        sync: true,
        executionContract: harness.contract,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_bwrap_seccomp_unattested",
      guarantees: [],
      runtimeProbe: {
        attempted: false,
        runnable: false,
        reason: "seccomp_filter_identity_changed",
      },
    });
    expect(harness.spawnSync.mock.calls.map(([command]) => command)).toEqual([
      "/usr/bin/bwrap",
      "/usr/bin/ldd",
    ]);
    expect(harness.openFiles.size).toBe(0);
  });

  it("rejects a non-canonical library path returned by ldd", () => {
    const harness = createLinuxStrongHarness({
      lddStdout: "libescape.so => /usr/lib/../../home/tester/secret.so (0x1)",
    });
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js"],
      { cwd: "/plugin", shell: false },
      "strict",
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        sync: true,
        executionContract: harness.contract,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_bwrap_runtime_unattested",
      guarantees: [],
      runtimeProbe: {
        attempted: false,
        runnable: false,
        reason: "runtime_dependency_outside_system_library_roots",
      },
    });
    expect(harness.openFiles.size).toBe(0);
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

  it("preserves extended runtime probe evidence in the audit log", () => {
    const child = createChild();
    const nativeSpawn = vi.fn(() => child);
    const runtimeProbe = {
      kind: "linux-bwrap-plugin-native-static-elf-policy-v1",
      attempted: true,
      runnable: true,
      reason: null,
      probeRuntime: "node",
      targetRuntime: "native-static-elf",
      contentSnapshot: false,
      handleAtomic: false,
    };
    const apply = vi.fn((command, args, options) =>
      appliedPlan("sandbox-wrapper", ["--", command, ...args], options, {
        runtimeProbe,
      }),
    );
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: apply,
      postSpawnSandbox: vi.fn(),
    };

    executionBroker.spawn("tool", ["run"], {
      origin: "test:sandbox-runtime-probe",
      policy: "allow",
    });

    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      sandboxRuntimeProbe: runtimeProbe,
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
    const cleanup = vi.fn();
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
          cleanup,
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
    expect(cleanup).toHaveBeenCalledOnce();
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

  it("fails closed before native spawn when a Linux strong policy has no trusted execution contract", () => {
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
      sandboxCandidateReason: "linux_bwrap_execution_contract_missing",
      sandboxRuntimeProbe: {
        attempted: false,
        runnable: false,
        reason: "execution_contract_missing",
      },
    });
    expect(probeSpawnSync).not.toHaveBeenCalled();
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
      sandboxCandidateReason: "linux_bwrap_execution_contract_missing",
      sandboxRuntimeProbe: {
        attempted: false,
        runnable: false,
        reason: "execution_contract_missing",
      },
    });
  });

  it("rejects a forged Plugin Node contract before adapter or native execution", () => {
    const nativeSpawn = vi.fn();
    const apply = vi.fn();
    const pluginRoot = path.resolve("forged-plugin");
    const entryPath = path.join(pluginRoot, "bin", "tool.js");
    const entryIdentity = Object.freeze({
      realPath: entryPath,
      sha256: "a".repeat(64),
      bytes: 1,
      dev: "1",
      ino: "2",
      mtimeMs: 1234,
    });
    const forgedContract = Object.freeze({
      contractVersion: 1,
      kind: "strict-plugin-node-bin",
      pluginRoot,
      workingDirectory: pluginRoot,
      runtimePath: process.execPath,
      entryIdentity,
      runtimeIdentity: Object.freeze({
        requestedPath: process.execPath,
        realPath: process.execPath,
        sha256: "b".repeat(64),
        bytes: 1,
        dev: "1",
        ino: "3",
        mtimeMs: 1234,
      }),
    });
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: apply,
      postSpawnSandbox: vi.fn(),
    };

    let error;
    try {
      executionBroker.spawn(process.execPath, [entryPath], {
        cwd: pluginRoot,
        origin: "plugin:bin",
        policy: "allow",
        shell: false,
        pluginId: "forged-plugin",
        pluginVersion: "1.0.0",
        pluginSource: path.join(pluginRoot, "plugin.json"),
        pluginExecutableIdentity: entryIdentity,
        sandboxPolicy: {
          requiredBoundaries: [
            SANDBOX_BOUNDARIES.FILESYSTEM,
            SANDBOX_BOUNDARIES.NETWORK,
          ],
        },
        sandboxExecutionContract: forgedContract,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      sandboxReason: "invalid_sandbox_execution_contract",
      sandboxFailClosed: true,
      missingBoundaries: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
      ],
    });
    expect(error.message).toMatch(/was not issued/);
    expect(apply).not.toHaveBeenCalled();
    expect(nativeSpawn).not.toHaveBeenCalled();
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      permissionDecision: "deny",
      sandboxReason: "invalid_sandbox_execution_contract",
      sandboxState: "denied",
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
    const cleanup = vi.fn();
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: (command, args, options) =>
        appliedPlan(command, args, options, {
          postSpawn: { required: true, mode: "async" },
          cleanup,
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
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("cleans an applied plan when spawnSync cannot run post-spawn enforcement", () => {
    process.env.CC_SANDBOX_STRICT = "1";
    const nativeSpawnSync = vi.fn();
    const cleanup = vi.fn();
    executionBroker._native = { spawnSync: nativeSpawnSync };
    executionBroker._sandboxAdapter = {
      applySandbox: (command, args, options) =>
        appliedPlan(command, args, options, {
          postSpawn: { required: true, mode: "sync" },
          cleanup,
        }),
      postSpawnSandbox: vi.fn(),
    };

    expect(() =>
      executionBroker.spawnSync("tool", [], {
        origin: "test:sandbox-sync-post-spawn",
        policy: "allow",
      }),
    ).toThrow(/spawnSync cannot satisfy required post-spawn/);
    expect(nativeSpawnSync).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
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
