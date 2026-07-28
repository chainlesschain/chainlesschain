import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { applySandbox } from "../../src/lib/process-execution-broker/platform-sandbox.js";
import {
  admitLinuxGenericSandboxExecutionContract,
  issueLinuxGenericSandboxExecutionContract,
} from "../../src/lib/process-execution-broker/linux-generic-bwrap.js";
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";

const ROOT = "/work/project";
const ROOT_STAT = Object.freeze({
  dev: 10,
  ino: 20,
  mode: 0o040755,
  uid: 1000,
  gid: 1000,
});

function typedStat(raw) {
  const value = { nlink: 1, size: 0, mtimeMs: 1, ...raw };
  return {
    ...value,
    isDirectory: () => (value.mode & 0o170000) === 0o040000,
    isFile: () => (value.mode & 0o170000) === 0o100000,
    isSymbolicLink: () => (value.mode & 0o170000) === 0o120000,
  };
}

function createLinuxRuntime({
  omitCapability = null,
  omitSystemNode = false,
  mutateSystemTargetAfterProbe = false,
  finalReadError = false,
  mountInfo = "20 1 8:1 / / rw,relatime - ext4 /dev/root rw\n",
  mountInfoAfterProbe = null,
  homeIdentityAlias = false,
} = {}) {
  const bwrapContents = Buffer.from("ELF-bwrap-supervisor");
  const nodeContents = Buffer.from("ELF-node-runtime");
  const pythonContents = Buffer.from("ELF-python-runtime");
  const passwdContents = Buffer.from("root:x:0:0:root:/root:/bin/sh\n");
  const entries = new Map([
    [ROOT, { stat: typedStat(ROOT_STAT), buffer: null }],
    [
      "/home/alice",
      {
        stat: typedStat(
          homeIdentityAlias
            ? ROOT_STAT
            : {
                dev: 10,
                ino: 21,
                mode: 0o040700,
                uid: 1000,
                gid: 1000,
              },
        ),
        buffer: null,
      },
    ],
    [
      "/usr",
      {
        stat: typedStat({
          dev: 1,
          ino: 2,
          mode: 0o040755,
          uid: 0,
          gid: 0,
        }),
        buffer: null,
      },
    ],
    [
      "/usr/bin/bwrap",
      {
        stat: typedStat({
          dev: 1,
          ino: 3,
          mode: 0o100755,
          uid: 0,
          gid: 0,
          size: bwrapContents.length,
        }),
        buffer: bwrapContents,
      },
    ],
    [
      "/usr/bin/node",
      {
        stat: typedStat({
          dev: 1,
          ino: 4,
          mode: 0o100755,
          uid: 0,
          gid: 0,
          size: nodeContents.length,
        }),
        buffer: nodeContents,
      },
    ],
    [
      "/usr/bin/python3",
      {
        stat: typedStat({
          dev: 1,
          ino: 6,
          mode: 0o100755,
          uid: 0,
          gid: 0,
          size: pythonContents.length,
        }),
        buffer: pythonContents,
      },
    ],
    [
      "/etc/passwd",
      {
        stat: typedStat({
          dev: 1,
          ino: 5,
          mode: 0o100644,
          uid: 0,
          gid: 0,
          size: passwdContents.length,
        }),
        buffer: passwdContents,
      },
    ],
  ]);
  if (omitSystemNode) entries.delete("/usr/bin/node");
  const symlinks = new Map([
    ["/bin", "usr/bin"],
    ["/sbin", "usr/sbin"],
    ["/lib", "usr/lib"],
    ["/lib64", "usr/lib64"],
  ]);
  const syntheticDirectories = new Set([
    "/usr/bin",
    "/usr/sbin",
    "/usr/lib",
    "/usr/lib64",
  ]);
  const openFiles = new Map();
  const hostFiles = new Map();
  const closed = [];
  let nextFd = 50;
  let failDescriptorReads = false;
  let probeCompleted = false;

  const getEntry = (value) => {
    const entry = entries.get(value);
    if (!entry) {
      const error = new Error(`ENOENT: ${value}`);
      error.code = "ENOENT";
      throw error;
    }
    return entry;
  };
  const openSync = (source, flags, mode) => {
    let entry;
    if (
      source === "/tmp" &&
      (Number(flags) & Number(fs.constants.O_TMPFILE || 0x410000)) !== 0
    ) {
      entry = {
        stat: typedStat({
          dev: 2,
          ino: nextFd + 1000,
          mode: 0o100000 | Number(mode || 0o400),
          uid: 1000,
          gid: 1000,
          size: 0,
        }),
        buffer: Buffer.alloc(0),
      };
    } else {
      entry = getEntry(source);
    }
    const fd = nextFd++;
    openFiles.set(fd, entry);
    return fd;
  };
  const realpathSync = vi.fn((value) => {
    if (entries.has(value)) return value;
    if (value === "/usr/local/bin/node") throw new Error("ENOENT");
    if (syntheticDirectories.has(value)) return value;
    throw new Error(`ENOENT: ${value}`);
  });
  realpathSync.native = realpathSync;
  const fakeFs = {
    constants: fs.constants,
    realpathSync,
    existsSync(value) {
      return (
        entries.has(value) ||
        symlinks.has(value) ||
        syntheticDirectories.has(value)
      );
    },
    lstatSync(value) {
      if (symlinks.has(value)) {
        return typedStat({
          dev: 1,
          ino: 100 + [...symlinks.keys()].indexOf(value),
          mode: 0o120777,
          uid: 0,
          gid: 0,
          size: symlinks.get(value).length,
        });
      }
      return getEntry(value).stat;
    },
    statSync(value) {
      return getEntry(value).stat;
    },
    readlinkSync(value) {
      if (value === "/proc/self/ns/net") return "net:[4026531992]";
      if (!symlinks.has(value)) throw new Error("EINVAL");
      return symlinks.get(value);
    },
    accessSync(value) {
      const stat = getEntry(value).stat;
      if (!stat.isFile() || (stat.mode & 0o111) === 0) {
        throw new Error("EACCES");
      }
    },
    openSync,
    fstatSync(fd) {
      return (
        openFiles.get(fd)?.stat ||
        (() => {
          throw new Error("EBADF");
        })()
      );
    },
    readSync(fd, output, offset, length, position) {
      if (failDescriptorReads) {
        const error = new Error("EIO");
        error.code = "EIO";
        throw error;
      }
      const source = openFiles.get(fd)?.buffer;
      if (!source) return 0;
      const available = Math.max(0, Math.min(length, source.length - position));
      if (available > 0) {
        source.copy(output, offset, position, position + available);
      }
      return available;
    },
    writeSync(fd, input, offset, length, position) {
      const entry = openFiles.get(fd);
      if (!entry) throw new Error("EBADF");
      const required = position + length;
      if (entry.buffer.length < required) {
        const expanded = Buffer.alloc(required);
        entry.buffer.copy(expanded);
        entry.buffer = expanded;
      }
      input.copy(entry.buffer, position, offset, offset + length);
      entry.stat = typedStat({ ...entry.stat, size: entry.buffer.length });
      return length;
    },
    fchmodSync(fd, mode) {
      const entry = openFiles.get(fd);
      entry.stat = typedStat({
        ...entry.stat,
        mode: 0o100000 | Number(mode),
      });
    },
    fsyncSync() {},
    closeSync(fd) {
      if (!openFiles.delete(fd)) throw new Error("EBADF");
      closed.push(fd);
    },
    writeFileSync(value, contents, options) {
      if (options?.flag === "wx" && hostFiles.has(value)) {
        throw new Error("EEXIST");
      }
      hostFiles.set(value, String(contents));
    },
    readFileSync(value, encoding) {
      if (value === "/proc/self/mountinfo") {
        const contents =
          probeCompleted && mountInfoAfterProbe !== null
            ? mountInfoAfterProbe
            : mountInfo;
        return encoding ? contents : Buffer.from(contents);
      }
      if (!hostFiles.has(value)) throw new Error("ENOENT");
      const contents = hostFiles.get(value);
      return encoding ? contents : Buffer.from(contents);
    },
    unlinkSync(value) {
      if (!hostFiles.delete(value)) throw new Error("ENOENT");
    },
  };

  const capabilities = [
    "--assert-userns-disabled",
    "--bind-fd",
    "--disable-userns",
    "--file",
    "--perms",
    "--remount-ro",
    "--ro-bind-fd",
    "--seccomp",
  ].filter((entry) => entry !== omitCapability);
  const calls = [];
  const spawnSync = vi.fn((command, args, options) => {
    calls.push({ command, args, options });
    if (args.length === 1 && args[0] === "--help") {
      return { status: 0, stdout: capabilities.join(" "), stderr: "" };
    }
    const script = args.at(-1);
    const digests = String(script).match(/[a-f0-9]{64}/g) || [];
    if (mutateSystemTargetAfterProbe) {
      const target = entries.get("/usr/bin/node");
      if (target) {
        target.stat = typedStat({ ...target.stat, ino: 404 });
      }
    }
    if (finalReadError) failDescriptorReads = true;
    probeCompleted = true;
    return {
      status: 0,
      stdout: `${digests[0]}\n${digests[1]}\n`,
      stderr: "",
    };
  });

  return {
    runtime: {
      platform: "linux",
      arch: "x64",
      execPath: "/usr/bin/node",
      fs: fakeFs,
      homedir: () => "/home/alice",
      tmpdir: () => "/tmp",
      randomBytes: () => Buffer.from("0102030405060708090a0b0c", "hex"),
      spawnSync,
    },
    calls,
    closed,
    openFiles,
  };
}

function issueAndAdmit({ command = "node", args = ["server.js"] } = {}) {
  const provenance = {
    origin: "mcp:server:test",
    command,
    args,
    cwd: ROOT,
    shell: false,
    sync: false,
    stdio: ["pipe", "pipe", "pipe"],
    requiredBoundaries: ["filesystem", "network"],
  };
  const contract = issueLinuxGenericSandboxExecutionContract(
    { ...provenance, workspaceRoot: ROOT },
    {
      homedir: () => "/home/alice",
      attestWorkspace: () => ({
        workspaceRoot: ROOT,
        workingDirectory: ROOT,
        rootIdentity: {
          realPath: ROOT,
          fileId: {
            dev: String(ROOT_STAT.dev),
            ino: String(ROOT_STAT.ino),
          },
          mode: ROOT_STAT.mode,
          uid: ROOT_STAT.uid,
          gid: ROOT_STAT.gid,
        },
        cwdIdentity: {
          realPath: ROOT,
          fileId: {
            dev: String(ROOT_STAT.dev),
            ino: String(ROOT_STAT.ino),
          },
          mode: ROOT_STAT.mode,
          uid: ROOT_STAT.uid,
          gid: ROOT_STAT.gid,
        },
      }),
    },
  );
  return {
    admitted: admitLinuxGenericSandboxExecutionContract(contract, provenance),
    provenance,
  };
}

function applyHarness(harness, admitted, overrides = {}) {
  const spawnOptions = {
    cwd: ROOT,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    env: { PATH: "/usr/bin", HOME: "/home/alice" },
    origin: "mcp:server:test",
  };
  return applySandbox(
    overrides.command || "node",
    overrides.args || ["server.js"],
    spawnOptions,
    "strict",
    harness.runtime,
    {
      profile: "strict",
      requiredBoundaries: ["filesystem", "network"],
      sync: false,
      executionContract: admitted,
    },
  );
}

describe("Linux generic production runtime integration", () => {
  it("acquires trusted descriptors and returns a typed empty-root plan", () => {
    const harness = createLinuxRuntime();
    const { admitted } = issueAndAdmit();
    const plan = applyHarness(harness, admitted);

    expect(plan).toMatchObject({
      applied: true,
      backend: "linux-bwrap-workspace",
      guarantees: ["filesystem", "network"],
      policyAttested: true,
      filesystemPolicy: {
        workspaceRoot: ROOT,
        hostRootMapped: false,
        hostHomeMapped: false,
        workspaceDescriptorBound: true,
        systemDescriptorBound: true,
        exactEtcFileDescriptors: true,
        workspaceRecursiveBind: true,
        workspaceMountTopology:
          "no-strict-descendants-or-forbidden-root-aliases-at-attestation",
        mountTopologySource: "proc-self-mountinfo",
        mountTopologyAtomic: false,
      },
      networkPolicy: {
        namespace: "new",
        seccomp: "deny-network-creation",
      },
      runtimeProbe: {
        kind: "linux-bwrap-generic-workspace-policy-v1",
        emptyRoot: true,
        undeclaredRootReadOnly: true,
        workspaceReadWrite: true,
        workspaceMountTopologyAttested: true,
        workspaceRootAliasAttested: true,
        anonymousDevWritable: true,
        mountTopologyAtomic: false,
        systemReadOnly: true,
        hostHomeHidden: true,
        outsideMarkerHidden: true,
        networkNamespace: true,
        networkNamespaceChanged: true,
        socketCreationDenied: true,
      },
    });
    expect(executionBroker._validateSandboxPlan(plan).applied).toBe(true);
    expect(plan.args).toContain("--bind-fd");
    expect(plan.args).toContain("--ro-bind-fd");
    expect(plan.args).toContain("--remount-ro");
    expect(plan.args).toContain("--unshare-net");
    expect(plan.args).toContain("--seccomp");
    expect(plan.args).not.toContain("/home/alice");
    expect(
      plan.args.some(
        (value, index) =>
          value === "/" &&
          ["--bind-fd", "--ro-bind-fd"].includes(plan.args[index - 2]),
      ),
    ).toBe(false);
    expect(harness.calls).toHaveLength(2);
    const probeScript = harness.calls[1].args.at(-1);
    expect(probeScript).toContain("net:[4026531992]");
    expect(probeScript).toContain("mount_is_read_only /");
    expect(probeScript).toContain("mount_is_read_only /usr");
    expect(probeScript).toContain("/proc/self/mountinfo");
    expect(probeScript).toContain("workspace_mount_topology_is_attested");
    expect(probeScript).toContain("want='/work/project'");
    expect(probeScript).toContain("/chainless-undeclared-root");
    expect(probeScript).toContain("/usr/.chainless-system-write");
    expect(probeScript).toContain("/dev/shm/.chainless-bwrap-dev-shm-");

    plan.cleanup();
    expect(harness.openFiles.size).toBe(0);
  });

  it("fails closed when bind-fd capability is absent", () => {
    const harness = createLinuxRuntime({ omitCapability: "--bind-fd" });
    const { admitted } = issueAndAdmit();
    const plan = applyHarness(harness, admitted);

    expect(plan).toMatchObject({
      applied: false,
      candidateBackend: "linux-bwrap-workspace",
      guarantees: [],
      policyAttested: false,
      reason: "linux_generic_bwrap_unavailable",
    });
    expect(harness.openFiles.size).toBe(0);
  });

  it("uses a root-owned system Python fallback when Node lives outside mounted system roots", () => {
    const harness = createLinuxRuntime({ omitSystemNode: true });
    harness.runtime.execPath = "/opt/hostedtoolcache/node/bin/node";
    const { admitted } = issueAndAdmit({
      command: "/usr/bin/python3",
      args: ["server.py"],
    });
    const plan = applyHarness(harness, admitted, {
      command: "/usr/bin/python3",
      args: ["server.py"],
    });

    expect(plan.applied).toBe(true);
    const probeScript = harness.calls[1].args.at(-1);
    expect(probeScript).toContain("/usr/bin/python3");
    expect(probeScript).toContain("'-I' '-S' '-c'");
    expect(probeScript).toContain("import errno,socket,sys");
    plan.cleanup();
  });

  it("rejects argv drift after Broker admission and consumes the authority", () => {
    const harness = createLinuxRuntime();
    const { admitted } = issueAndAdmit();
    const drifted = applyHarness(harness, admitted, {
      args: ["server.js", "--drift"],
    });
    expect(drifted).toMatchObject({
      applied: false,
      reason: "linux_generic_execution_contract_invalid",
      guarantees: [],
    });

    const replay = applyHarness(harness, admitted);
    expect(replay.reason).toBe("linux_generic_execution_contract_invalid");
    expect(harness.openFiles.size).toBe(0);
  });

  it("rejects a root-owned system target whose inode changes after the policy probe", () => {
    const harness = createLinuxRuntime({
      mutateSystemTargetAfterProbe: true,
    });
    const { admitted } = issueAndAdmit();
    const plan = applyHarness(harness, admitted);

    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_generic_execution_contract_changed",
      guarantees: [],
    });
    expect(harness.openFiles.size).toBe(0);
  });

  it("rejects an escaped strict-descendant mount imported by recursive bind-fd", () => {
    const harness = createLinuxRuntime({
      mountInfo: [
        "20 1 8:1 / / rw,relatime - ext4 /dev/root rw",
        "21 20 0:44 / /work/project/escape\\040home rw,nosuid - fuse.bindfs bindfs rw",
        "",
      ].join("\n"),
    });
    const { admitted } = issueAndAdmit();
    const plan = applyHarness(harness, admitted);

    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_generic_resources_unattested",
      guarantees: [],
    });
    expect(harness.calls).toHaveLength(0);
    expect(harness.openFiles.size).toBe(0);
  });

  it("rejects a workspace root whose directory identity aliases host HOME", () => {
    const harness = createLinuxRuntime({
      homeIdentityAlias: true,
    });
    const { admitted } = issueAndAdmit();
    const plan = applyHarness(harness, admitted);

    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_generic_resources_unattested",
      guarantees: [],
    });
    expect(harness.openFiles.size).toBe(0);
  });

  it("rejects root mount provenance sourced from a forbidden system subtree", () => {
    const harness = createLinuxRuntime({
      mountInfo: [
        "20 1 8:1 / / rw,relatime - ext4 /dev/root rw",
        "21 20 8:1 /etc/project /work/project rw,relatime - ext4 /dev/root rw",
        "",
      ].join("\n"),
    });
    const { admitted } = issueAndAdmit();
    const plan = applyHarness(harness, admitted);

    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_generic_resources_unattested",
      guarantees: [],
    });
    expect(harness.openFiles.size).toBe(0);
  });

  it("fails closed for an opaque FUSE workspace-root origin", () => {
    const harness = createLinuxRuntime({
      mountInfo: [
        "20 1 8:1 / / rw,relatime - ext4 /dev/root rw",
        "21 20 0:44 / /work/project rw,nosuid - fuse.bindfs bindfs rw",
        "",
      ].join("\n"),
    });
    const { admitted } = issueAndAdmit();
    const plan = applyHarness(harness, admitted);

    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_generic_resources_unattested",
      guarantees: [],
    });
    expect(harness.openFiles.size).toBe(0);
  });

  it("re-attests mount topology after the probe and rejects escaped drift", () => {
    const initial = "20 1 8:1 / / rw,relatime - ext4 /dev/root rw\n";
    const harness = createLinuxRuntime({
      mountInfo: initial,
      mountInfoAfterProbe: [
        initial.trimEnd(),
        "21 20 0:44 / /work/project/late\\040escape rw,nosuid - fuse.bindfs bindfs rw",
        "",
      ].join("\n"),
    });
    const { admitted } = issueAndAdmit();
    const plan = applyHarness(harness, admitted);

    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_generic_execution_contract_changed",
      guarantees: [],
    });
    expect(harness.calls).toHaveLength(2);
    expect(harness.openFiles.size).toBe(0);
  });

  it("closes every descriptor when final supervisor hashing throws EIO", () => {
    const harness = createLinuxRuntime({ finalReadError: true });
    const { admitted } = issueAndAdmit();
    let thrown = null;
    let plan;
    try {
      plan = applyHarness(harness, admitted);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeNull();
    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_generic_execution_contract_changed",
      guarantees: [],
    });
    expect(harness.openFiles.size).toBe(0);
  });
});
