import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  admitLinuxGenericSandboxExecutionContract,
  issueLinuxGenericSandboxExecutionContract,
  planLinuxGenericBubblewrap,
  verifyIssuedLinuxGenericSandboxExecutionContract,
  verifyLinuxGenericBubblewrapPlan,
} from "../../src/lib/process-execution-broker/linux-generic-bwrap.js";
import { parseLinuxBwrapDescriptorScrubbedLaunch } from "../../src/lib/process-execution-broker/linux-bwrap-descriptor-launch.js";
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";
import runtimeProvenanceLedger from "../../src/lib/runtime-provenance-ledger.js";

const ROOT = "/work/project";
const CWD = "/work/project/subdir";
const ROOT_IDENTITY = Object.freeze({
  realPath: ROOT,
  fileId: Object.freeze({ dev: "11", ino: "22" }),
  mode: 0o040755,
  uid: 1000,
  gid: 1000,
});
const CWD_IDENTITY = Object.freeze({
  realPath: CWD,
  fileId: Object.freeze({ dev: "11", ino: "23" }),
  mode: 0o040755,
  uid: 1000,
  gid: 1000,
});
const SYSTEM_DIRECTORY = Object.freeze({
  realPath: "/usr",
  fileId: Object.freeze({ dev: "1", ino: "2" }),
  mode: 0o040755,
  uid: 0,
  gid: 0,
});
const SYSTEM_FILE = Object.freeze({
  realPath: "/usr/bin/node",
  fileId: Object.freeze({ dev: "1", ino: "3" }),
  mode: 0o100755,
  uid: 0,
  gid: 0,
});
const ETC_FILE = Object.freeze({
  realPath: "/etc/passwd",
  fileId: Object.freeze({ dev: "1", ino: "4" }),
  mode: 0o100644,
  uid: 0,
  gid: 0,
});
const PTY_LAUNCHER_FILE = Object.freeze({
  realPath: "/usr/bin/setsid",
  fileId: Object.freeze({ dev: "1", ino: "5" }),
  mode: 0o100755,
  uid: 0,
  gid: 0,
});
const MOUNT_TOPOLOGY = Object.freeze({
  version: 1,
  source: "proc-self-mountinfo",
  workspaceRoot: ROOT,
  digest: "f".repeat(64),
  lineageEntryCount: 1,
  filesystemEntryCount: 1,
  aliasCount: 1,
  forbiddenIdentityCount: 8,
  sourceMountSetDigest: "e".repeat(64),
  sourceMountCount: 3,
  importedMountEntryCount: 3,
  sourceMountPropagationPrivateAtAttestation: true,
  strictDescendantMountsAtAttestation: 0,
  rootAliasAttested: true,
  recursiveBind: true,
  mountTopologyAtomic: false,
});

function attestWorkspace(root = ROOT, cwd = CWD) {
  return {
    workspaceRoot: root,
    workingDirectory: cwd,
    rootIdentity:
      root === ROOT
        ? ROOT_IDENTITY
        : {
            ...ROOT_IDENTITY,
            realPath: root,
          },
    cwdIdentity:
      cwd === CWD
        ? CWD_IDENTITY
        : {
            ...CWD_IDENTITY,
            realPath: cwd,
          },
  };
}

function provenance(overrides = {}) {
  return {
    origin: "plugin:mcp",
    command: "node",
    args: ["server.js"],
    cwd: CWD,
    shell: false,
    sync: false,
    stdio: ["pipe", "pipe", "pipe"],
    requiredBoundaries: ["filesystem", "network"],
    ...overrides,
  };
}

function issue(overrides = {}, attest = attestWorkspace) {
  const spec = provenance(overrides);
  return issueLinuxGenericSandboxExecutionContract(
    {
      ...spec,
      workspaceRoot: overrides.workspaceRoot || ROOT,
    },
    { attestWorkspace: attest },
  );
}

function rootOwnedFile(realPath, ino) {
  return {
    realPath,
    fileId: { dev: "1", ino: String(ino) },
    mode: 0o100755,
    uid: 0,
    gid: 0,
  };
}

function resources(contract, overrides = {}) {
  const closeProbe = vi.fn();
  const cleanup = vi.fn();
  return {
    attestedContractDigest: contract.contractDigest,
    attestContract: vi.fn(() => true),
    attestFinal: vi.fn(() => true),
    closeProbe,
    cleanup,
    supervisor: {
      probeFd: 100,
      finalFd: 200,
      identity: rootOwnedFile("/usr/bin/bwrap", 10),
      sha256: "b".repeat(64),
      bytes: 1024,
    },
    descriptorScrubber: {
      probeFd: 106,
      finalFd: 206,
      identity: rootOwnedFile("/usr/bin/bash", 15),
      sha256: "c".repeat(64),
      bytes: 2048,
      mtimeMs: 1,
    },
    workspace: {
      probeFd: 101,
      finalFd: 201,
      identity: ROOT_IDENTITY,
      mountTopology: MOUNT_TOPOLOGY,
    },
    system: [
      {
        destination: "/usr",
        probeFd: 102,
        finalFd: 202,
        identity: SYSTEM_DIRECTORY,
      },
    ],
    systemSymlinks: [
      { destination: "/bin", target: "usr/bin" },
      { destination: "/lib", target: "usr/lib" },
      { destination: "/lib64", target: "usr/lib64" },
    ],
    etc: [
      {
        destination: "/etc/passwd",
        probeFd: 103,
        finalFd: 203,
        identity: ETC_FILE,
      },
    ],
    seccomp: {
      probeFd: 104,
      finalFd: 204,
      sha256: "a".repeat(64),
      policy: "deny-network-creation",
    },
    target: {
      attestedContractDigest: contract.contractDigest,
      requestedCommand: "node",
      resolvedCommand: "/usr/bin/node",
      args: ["server.js"],
      scope: "system",
      identity: SYSTEM_FILE,
    },
    ...overrides,
  };
}

function successfulProbe(call) {
  return {
    runnable: true,
    policyDigest: call.policyDigest,
    contractDigest: call.contractDigest,
    emptyRoot: true,
    undeclaredRootReadOnly: true,
    workspaceReadWrite: true,
    workspaceMountTopologyAttested: true,
    anonymousDevWritable: true,
    systemReadOnly: true,
    hostHomeHidden: true,
    outsideMarkerHidden: true,
    networkNamespace: true,
    networkNamespaceChanged: true,
    pidNamespace: true,
    pidNamespaceChanged: true,
    processTreeCloseProbe: true,
    socketCreationDenied: true,
  };
}

describe("Linux generic bubblewrap authority contract", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects a forged writable host root and a cwd symlink escape", () => {
    expect(() =>
      issue({ workspaceRoot: "/", cwd: "/" }, () => attestWorkspace("/", "/")),
    ).toThrow(/unsafe writable workspace root/);

    expect(() =>
      issue({ cwd: "/outside" }, () => attestWorkspace(ROOT, "/outside")),
    ).toThrow(/escapes the canonical workspace root/);

    expect(() =>
      issueLinuxGenericSandboxExecutionContract(
        {
          ...provenance({ cwd: "/home/alice" }),
          workspaceRoot: "/home/alice",
        },
        {
          attestWorkspace: () => attestWorkspace("/home/alice", "/home/alice"),
          homedir: () => "/home/alice",
        },
      ),
    ).toThrow(/unsafe writable workspace root/);
    expect(() =>
      issueLinuxGenericSandboxExecutionContract(
        {
          ...provenance({ cwd: "/home" }),
          workspaceRoot: "/home",
        },
        {
          attestWorkspace: () => attestWorkspace("/home", "/home"),
          homedir: () => "/home/alice",
        },
      ),
    ).toThrow(/unsafe writable workspace root/);
    for (const broadRoot of [
      "/tmp",
      "/var",
      "/var/tmp",
      "/run",
      "/opt",
      "/mnt",
      "/media",
      "/srv",
      "/home/sandbox",
    ]) {
      expect(() =>
        issueLinuxGenericSandboxExecutionContract(
          {
            ...provenance({ cwd: broadRoot }),
            workspaceRoot: broadRoot,
          },
          {
            attestWorkspace: () => attestWorkspace(broadRoot, broadRoot),
            homedir: () => "/home/alice",
          },
        ),
      ).toThrow(/unsafe writable workspace root/);
    }
  });

  it("binds origin, command, argv, cwd, shell mode, sync, stdio and tightens boundaries only", () => {
    const commandContract = issue({
      requiredBoundaries: ["filesystem"],
    });
    expect(
      verifyIssuedLinuxGenericSandboxExecutionContract(
        commandContract,
        provenance({
          requiredBoundaries: ["filesystem", "network", "process-tree"],
        }),
      ),
    ).toBe(true);
    expect(
      verifyIssuedLinuxGenericSandboxExecutionContract(
        commandContract,
        provenance({
          command: "python3",
          requiredBoundaries: ["filesystem", "network"],
        }),
      ),
    ).toBe(false);
    expect(
      verifyIssuedLinuxGenericSandboxExecutionContract(
        commandContract,
        provenance({ requiredBoundaries: ["network"] }),
      ),
    ).toBe(false);
    expect(() =>
      issue({ requiredBoundaries: ["filesystem", "process-exec"] }),
    ).toThrow(/filesystem, network, and process-tree/);

    const ptyContract = issue({ pty: true });
    expect(
      verifyIssuedLinuxGenericSandboxExecutionContract(
        ptyContract,
        provenance({ pty: true }),
      ),
    ).toBe(true);
    expect(
      verifyIssuedLinuxGenericSandboxExecutionContract(
        ptyContract,
        provenance(),
      ),
    ).toBe(false);
  });

  it("is one-shot and refuses command drift without consuming the valid contract", () => {
    const commandContract = issue();
    const drift = planLinuxGenericBubblewrap(
      {
        contract: commandContract,
        provenance: provenance({ args: ["replacement.js"] }),
        resources: resources(commandContract),
        probe: successfulProbe,
      },
      { platform: "linux" },
    );
    expect(drift.applied).toBe(false);
    expect(drift.reason).toBe("linux_generic_execution_contract_invalid");

    const accepted = planLinuxGenericBubblewrap(
      {
        contract: commandContract,
        provenance: provenance(),
        resources: resources(commandContract),
        probe: successfulProbe,
      },
      { platform: "linux" },
    );
    expect(accepted.applied).toBe(true);

    const replay = planLinuxGenericBubblewrap(
      {
        contract: commandContract,
        provenance: provenance(),
        resources: resources(commandContract),
        probe: successfulProbe,
      },
      { platform: "linux" },
    );
    expect(replay.applied).toBe(false);
    expect(replay.reason).toBe("linux_generic_execution_contract_invalid");
  });

  it("uses separate one-shot Broker admission and platform authorities", () => {
    const commandContract = issue();
    const admitted = admitLinuxGenericSandboxExecutionContract(
      commandContract,
      provenance(),
    );
    expect(admitted).toMatchObject({
      kind: "strict-workspace-command",
      workspaceRoot: ROOT,
      workingDirectory: CWD,
    });
    expect(
      verifyIssuedLinuxGenericSandboxExecutionContract(
        commandContract,
        provenance(),
      ),
    ).toBe(false);

    const plan = planLinuxGenericBubblewrap(
      {
        contract: admitted,
        provenance: provenance(),
        resources: resources(commandContract),
        probe: successfulProbe,
      },
      { platform: "linux" },
    );
    expect(plan.applied).toBe(true);
    expect(
      planLinuxGenericBubblewrap(
        {
          contract: admitted,
          provenance: provenance(),
          resources: resources(commandContract),
          probe: successfulProbe,
        },
        { platform: "linux" },
      ).reason,
    ).toBe("linux_generic_execution_contract_invalid");
  });
});

describe("Linux generic bubblewrap exact mount plan", () => {
  it("uses a pinned setsid controlling-terminal launcher without bwrap session detachment", () => {
    const commandContract = issue({ pty: true });
    const plan = planLinuxGenericBubblewrap(
      {
        contract: commandContract,
        provenance: provenance({ pty: true }),
        resources: resources(commandContract, {
          ptyLauncher: {
            probeFd: 105,
            finalFd: 205,
            identity: PTY_LAUNCHER_FILE,
            sha256: "c".repeat(64),
            bytes: 2048,
          },
        }),
        probe: successfulProbe,
      },
      { platform: "linux" },
    );

    expect(plan.applied).toBe(true);
    expect(plan.command).toBe("/proc/self/fd/3");
    expect(plan.args.slice(0, 2)).toEqual(["--ctty", "/proc/self/fd/9"]);
    const descriptorLaunch = parseLinuxBwrapDescriptorScrubbedLaunch(
      plan.args[1],
      plan.args.slice(2),
      plan.options,
    );
    expect(descriptorLaunch).toMatchObject({
      scrubberChildFd: 9,
      preservedMaxFd: 8,
      executableChildFd: 4,
    });
    const ptyLauncherDestination = descriptorLaunch.executableArgs.indexOf(
      "/run/.chainless-pty-launcher",
    );
    expect(
      descriptorLaunch.executableArgs.slice(
        ptyLauncherDestination - 2,
        ptyLauncherDestination + 1,
      ),
    ).toEqual(["--file", "3", "/run/.chainless-pty-launcher"]);
    expect(plan.args).toContain("--die-with-parent");
    expect(plan.args).not.toContain("--new-session");
    expect(plan.args).toContain("/run/.chainless-pty-launcher");
    expect(plan.ptyPolicy).toEqual({
      mode: "dedicated-controlling-terminal",
      launcherPath: "/usr/bin/setsid",
      launcherSha256: "c".repeat(64),
      launcherBytes: 2048,
      launcherDescriptorBound: true,
      launcherExecutablePinned: true,
      launcherDescriptorConsumedBeforeTarget: true,
      launcherStagingPathHidden: true,
      bwrapNewSession: false,
    });
    expect(verifyLinuxGenericBubblewrapPlan(plan)).toBe(true);
  });

  it("maps only rw workspace, anonymous scratch, root-owned runtime, and exact /etc files", () => {
    const commandContract = issue();
    const hostHomeSecret = "/home/alice/.ssh/id_ed25519";
    const outsideMarker = "/work/outside-marker";
    const plan = planLinuxGenericBubblewrap(
      {
        contract: commandContract,
        provenance: provenance(),
        resources: resources(commandContract),
        environment: {
          HOME: "/home/alice",
          LD_PRELOAD: "/tmp/evil.so",
          LD_PROFILE: "/tmp/profile",
          NODE_CHANNEL_FD: "99",
          NODE_CHANNEL_SERIALIZATION_MODE: "advanced",
          SAFE_FLAG: "yes",
        },
        probe: successfulProbe,
      },
      { platform: "linux" },
    );

    expect(plan.applied).toBe(true);
    expect(plan.guarantees).toEqual(["filesystem", "network", "process-tree"]);
    expect(plan.filesystemPolicy).toMatchObject({
      workspaceRoot: ROOT,
      workspaceAccess: "read-write",
      systemAccess: "read-only",
      hostRootMapped: false,
      hostHomeMapped: false,
      workspaceDescriptorBound: true,
      workspaceRecursiveBind: true,
      workspaceMountTopology:
        "no-strict-descendants-or-forbidden-root-aliases-at-attestation",
      mountTopologySource: "proc-self-mountinfo",
      mountTopologyDigest: MOUNT_TOPOLOGY.digest,
      sourceMountSetDigest: MOUNT_TOPOLOGY.sourceMountSetDigest,
      sourceMountPropagationPrivateAtAttestation: true,
      mountTopologyAtomic: false,
    });
    expect(plan.args).toContain("--bind-fd");
    expect(plan.args).toContain("--ro-bind-fd");
    expect(plan.args).toContain("--die-with-parent");
    expect(plan.args).toContain("--unshare-pid");
    expect(plan.args).not.toContain("--as-pid-1");
    expect(plan.args).toContain("--unshare-net");
    expect(plan.args).toContain("--seccomp");
    expect(plan.args).toContain("--remount-ro");
    expect(plan.args[plan.args.indexOf("--remount-ro") + 1]).toBe("/");
    expect(plan.args.indexOf("--remount-ro")).toBeLessThan(
      plan.args.indexOf("--tmpfs"),
    );
    expect(plan.args.indexOf("--symlink")).toBeLessThan(
      plan.args.indexOf("--remount-ro"),
    );
    expect(plan.args.indexOf("--ro-bind-fd")).toBeLessThan(
      plan.args.indexOf("--remount-ro"),
    );
    expect(plan.args.indexOf("--tmpfs")).toBeLessThan(
      plan.args.indexOf("--bind-fd"),
    );
    expect(plan.args.indexOf("--file")).toBeLessThan(
      plan.args.findIndex(
        (value, index) =>
          value === "/run" && plan.args[index - 1] === "--tmpfs",
      ),
    );
    expect(plan.args).not.toContain("--ro-bind");
    expect(
      plan.args.some(
        (value, index) =>
          value === "/" &&
          ["--bind-fd", "--ro-bind-fd"].includes(plan.args[index - 2]),
      ),
    ).toBe(false);
    expect(plan.args).not.toContain("/home/alice");
    expect(plan.args).not.toContain(hostHomeSecret);
    expect(plan.args).not.toContain(outsideMarker);
    expect(plan.args).not.toContain("/tmp/evil.so");
    expect(plan.args).not.toContain("/tmp/profile");
    expect(plan.args).not.toContain("99");
    expect(plan.args).not.toContain("advanced");
    expect(plan.args).not.toContain("NODE_CHANNEL_FD");
    expect(plan.args).not.toContain("NODE_CHANNEL_SERIALIZATION_MODE");
    expect(plan.args).toContain("/etc/passwd");
    for (const exactFile of ["/etc/passwd", "/etc/group", "/etc/hosts"]) {
      expect(
        plan.args.some(
          (value, index) =>
            value === exactFile && plan.args[index - 1] === "--dir",
        ),
      ).toBe(false);
    }
    const broadEtcBind = plan.args.some(
      (value, index) =>
        value === "/etc" &&
        ["--bind-fd", "--ro-bind-fd"].includes(plan.args[index - 2]),
    );
    expect(broadEtcBind).toBe(false);
    expect(verifyLinuxGenericBubblewrapPlan(plan)).toBe(true);
    const trustedLaunchContext = {
      builtInSandboxAdapter: true,
      executionContract: commandContract,
      cwd: CWD,
    };
    const validatedPlan = executionBroker._validateSandboxPlan(
      plan,
      trustedLaunchContext,
    );
    expect(validatedPlan).toMatchObject({
      backend: "linux-bwrap-workspace",
      policyAttested: true,
      runtimeProbe: {
        kind: "linux-bwrap-generic-workspace-policy-v1",
        descriptorMounts: true,
        workspaceMountTopologyAttested: true,
        workspaceRootAliasAttested: true,
        pidNamespace: true,
        pidNamespaceChanged: true,
        processTreeCloseProbe: true,
        bubblewrapPid1Reaper: true,
        dieWithParent: true,
        closeImpliesProcessTreeClosed: true,
        mountTopologyDigest: MOUNT_TOPOLOGY.digest,
        sourceMountSetDigest: MOUNT_TOPOLOGY.sourceMountSetDigest,
        sourceMountPropagationPrivateAtAttestation: true,
        mountTopologyAtomic: false,
      },
    });
    const audit = {};
    executionBroker._applySandboxAudit(audit, validatedPlan, true);
    expect(audit).toMatchObject({
      sandboxFilesystemPolicy: {
        workspaceRoot: ROOT,
        workingDirectory: CWD,
        workspaceAccess: "read-write",
        systemAccess: "read-only",
        undeclaredRootAccess: "read-only",
        hostRootMapped: false,
        hostHomeMapped: false,
        workspaceDescriptorBound: true,
        systemDescriptorBound: true,
        exactEtcFileDescriptors: true,
        workspaceRecursiveBind: true,
        workspaceMountTopology:
          "no-strict-descendants-or-forbidden-root-aliases-at-attestation",
        mountTopologySource: "proc-self-mountinfo",
        mountTopologyDigest: MOUNT_TOPOLOGY.digest,
        sourceMountSetDigest: MOUNT_TOPOLOGY.sourceMountSetDigest,
        sourceMountPropagationPrivateAtAttestation: true,
        mountTopologyAtomic: false,
      },
      sandboxNetworkPolicy: {
        namespace: "new",
        namespaceIdentityChanged: true,
        seccomp: "deny-network-creation",
      },
      sandboxProcessTreePolicy: {
        namespace: "new",
        namespaceIdentityChanged: true,
        init: "bubblewrap-pid1-reaper",
        parentDeathSignal: "SIGKILL",
        asPid1: false,
        closeFence: "pid-namespace-empty-or-killed",
      },
    });
    expect(audit.sandboxFilesystemPolicy.anonymousWritablePaths).toEqual([
      "/home/sandbox",
      "/dev",
      "/run",
      "/tmp",
      "/var/tmp",
    ]);
    expect(() =>
      executionBroker._validateSandboxPlan(
        {
          ...plan,
          filesystemPolicy: {
            ...plan.filesystemPolicy,
            anonymousWritablePaths: [
              ...plan.filesystemPolicy.anonymousWritablePaths,
              "/host-forgery",
            ],
          },
        },
        trustedLaunchContext,
      ),
    ).toThrow(/typed descriptor-bound empty-root contract/);
    expect(() =>
      executionBroker._validateSandboxPlan(
        {
          ...plan,
          filesystemPolicy: {
            ...plan.filesystemPolicy,
            sourceMountSetDigest: "invalid",
          },
        },
        trustedLaunchContext,
      ),
    ).toThrow(/typed descriptor-bound empty-root contract/);
    expect(() =>
      executionBroker._validateSandboxPlan(
        {
          ...plan,
          runtimeProbe: {
            ...plan.runtimeProbe,
            sourceMountPropagationPrivateAtAttestation: false,
          },
        },
        trustedLaunchContext,
      ),
    ).toThrow(/typed descriptor-bound empty-root contract/);
    expect(() =>
      executionBroker._validateSandboxPlan(
        {
          ...plan,
          args: plan.args.filter((value) => value !== "--unshare-pid"),
        },
        trustedLaunchContext,
      ),
    ).toThrow(/typed descriptor-bound empty-root contract/);
    expect(() =>
      executionBroker._validateSandboxPlan(
        {
          ...plan,
          runtimeProbe: {
            ...plan.runtimeProbe,
            pidNamespaceChanged: false,
          },
        },
        trustedLaunchContext,
      ),
    ).toThrow(/typed descriptor-bound empty-root contract/);
    expect(() =>
      executionBroker._validateSandboxPlan(
        {
          ...plan,
          processTreePolicy: {
            ...plan.processTreePolicy,
            closeFence: "unproven",
          },
        },
        trustedLaunchContext,
      ),
    ).toThrow(/typed descriptor-bound empty-root contract/);
    expect(() =>
      executionBroker._validateSandboxPlan(
        {
          ...plan,
          runtimeProbe: {
            ...plan.runtimeProbe,
            mountTopologyDigest: "0".repeat(64),
          },
        },
        trustedLaunchContext,
      ),
    ).toThrow(/typed descriptor-bound empty-root contract/);
    expect(() =>
      executionBroker._validateSandboxPlan(
        {
          ...plan,
          enforcement: "other-backend",
          backend: "other-backend",
          runtimeProbe: {
            kind: "other-policy-v1",
            attempted: true,
            runnable: true,
            reason: null,
            contractDigest: plan.runtimeProbe.contractDigest,
          },
        },
        trustedLaunchContext,
      ),
    ).toThrow(
      /generic workspace evidence requires its typed runtime probe kind/,
    );
  });

  it("preserves an IPC fd3 and allocates private descriptors after it", () => {
    const stdio = ["ignore", "pipe", "pipe", "ipc"];
    const commandContract = issue({ stdio });
    const seen = [];
    const plan = planLinuxGenericBubblewrap(
      {
        contract: commandContract,
        provenance: provenance({ stdio }),
        resources: resources(commandContract),
        probe(call) {
          seen.push(call);
          return successfulProbe(call);
        },
      },
      { platform: "linux" },
    );

    expect(plan.applied).toBe(true);
    expect(plan.options.stdio.slice(0, 4)).toEqual(stdio);
    expect(plan.command).toBe("/proc/self/fd/9");
    expect(plan.options.stdio.slice(4)).toEqual([200, 201, 202, 203, 204, 206]);
    expect(seen[0].options.stdio.slice(0, 4)).toEqual([
      "ignore",
      "pipe",
      "pipe",
      "pipe",
    ]);
    expect(
      parseLinuxBwrapDescriptorScrubbedLaunch(
        plan.command,
        plan.args,
        plan.options,
        { activeStdioThrough: 3 },
      ),
    ).toMatchObject({
      scrubberChildFd: 9,
      preservedMaxFd: 8,
      activeStdioThrough: 3,
      nodeIpcChildFd: 3,
      executableChildFd: 4,
    });
    expect(plan.runtimeProbe.descriptorScrubber).toMatchObject({
      callerEnvironmentFixed: true,
      nodeRuntimeEnvironmentInjection: "node-child-process-exact-ipc-v1",
      nodeIpcChildFd: 3,
      nodeIpcSerializationMode: "json",
      policyBound: true,
    });
    const channelIndex = plan.args.indexOf("NODE_CHANNEL_FD");
    expect(plan.args[channelIndex + 1]).toBe("3");
  });

  it("rejects untrusted runtime mounts and exact /etc allowlist escapes", () => {
    const first = issue();
    const untrusted = resources(first);
    untrusted.system[0] = {
      ...untrusted.system[0],
      identity: { ...SYSTEM_DIRECTORY, uid: 1000 },
    };
    expect(
      planLinuxGenericBubblewrap(
        {
          contract: first,
          provenance: provenance(),
          resources: untrusted,
          probe: successfulProbe,
        },
        { platform: "linux" },
      ).reason,
    ).toBe("linux_generic_resources_unattested");

    const second = issue();
    const broadEtc = resources(second);
    broadEtc.etc[0] = {
      ...broadEtc.etc[0],
      destination: "/etc/shadow",
    };
    expect(
      planLinuxGenericBubblewrap(
        {
          contract: second,
          provenance: provenance(),
          resources: broadEtc,
          probe: successfulProbe,
        },
        { platform: "linux" },
      ).reason,
    ).toBe("linux_generic_resources_unattested");
  });

  it("binds resolved target argv and rejects shell reinterpretation", () => {
    const drifted = issue();
    const driftedResources = resources(drifted);
    driftedResources.target.args = ["server.js", "--drift"];
    expect(
      planLinuxGenericBubblewrap(
        {
          contract: drifted,
          provenance: provenance(),
          resources: driftedResources,
          probe: successfulProbe,
        },
        { platform: "linux" },
      ).reason,
    ).toBe("linux_generic_resources_unattested");

    expect(() =>
      issue({
        command: "printf ok",
        args: ["&&", "printf done"],
        shell: true,
      }),
    ).toThrow(/requires shell:false/);
  });

  it("fails closed when policy-digest or final attestation evidence is tampered", () => {
    const first = issue();
    const digestMismatch = planLinuxGenericBubblewrap(
      {
        contract: first,
        provenance: provenance(),
        resources: resources(first),
        probe(call) {
          return {
            ...successfulProbe(call),
            policyDigest: "0".repeat(64),
          };
        },
      },
      { platform: "linux" },
    );
    expect(digestMismatch.applied).toBe(false);
    expect(digestMismatch.reason).toBe("linux_generic_policy_probe_failed");

    const second = issue();
    const changed = resources(second, { attestFinal: vi.fn(() => false) });
    const finalMismatch = planLinuxGenericBubblewrap(
      {
        contract: second,
        provenance: provenance(),
        resources: changed,
        probe: successfulProbe,
      },
      { platform: "linux" },
    );
    expect(finalMismatch.applied).toBe(false);
    expect(finalMismatch.reason).toBe(
      "linux_generic_execution_contract_changed",
    );

    const third = issue();
    const cleanup = vi.fn();
    const throwing = resources(third, {
      cleanup,
      attestFinal: vi.fn(() => {
        throw new Error("EIO");
      }),
    });
    let thrown = null;
    let attestationFailure;
    try {
      attestationFailure = planLinuxGenericBubblewrap(
        {
          contract: third,
          provenance: provenance(),
          resources: throwing,
          probe: successfulProbe,
        },
        { platform: "linux" },
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeNull();
    expect(attestationFailure).toMatchObject({
      applied: false,
      reason: "linux_generic_execution_contract_changed",
      guarantees: [],
    });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("rejects runnable probe output that does not prove root and system mounts read-only", () => {
    for (const field of [
      "undeclaredRootReadOnly",
      "systemReadOnly",
      "pidNamespace",
      "pidNamespaceChanged",
      "processTreeCloseProbe",
    ]) {
      const commandContract = issue();
      const plan = planLinuxGenericBubblewrap(
        {
          contract: commandContract,
          provenance: provenance(),
          resources: resources(commandContract),
          probe(call) {
            return { ...successfulProbe(call), [field]: false };
          },
        },
        { platform: "linux" },
      );
      expect(plan).toMatchObject({
        applied: false,
        reason: "linux_generic_policy_probe_failed",
        guarantees: [],
      });
    }
  });

  it("rejects resources without typed no-alias mount-topology evidence", () => {
    const commandContract = issue();
    const acquired = resources(commandContract);
    acquired.workspace = {
      ...acquired.workspace,
      mountTopology: {
        ...acquired.workspace.mountTopology,
        rootAliasAttested: false,
      },
    };
    const plan = planLinuxGenericBubblewrap(
      {
        contract: commandContract,
        provenance: provenance(),
        resources: acquired,
        probe: successfulProbe,
      },
      { platform: "linux" },
    );

    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_generic_resources_unattested",
      guarantees: [],
    });
    expect(acquired.cleanup).toHaveBeenCalledOnce();
  });

  it("rejects resources without private bind-source propagation evidence", () => {
    const commandContract = issue();
    const acquired = resources(commandContract);
    acquired.workspace = {
      ...acquired.workspace,
      mountTopology: {
        ...acquired.workspace.mountTopology,
        sourceMountPropagationPrivateAtAttestation: false,
      },
    };
    const plan = planLinuxGenericBubblewrap(
      {
        contract: commandContract,
        provenance: provenance(),
        resources: acquired,
        probe: successfulProbe,
      },
      { platform: "linux" },
    );

    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_generic_resources_unattested",
      guarantees: [],
    });
    expect(acquired.cleanup).toHaveBeenCalledOnce();
  });

  it("binds the seccomp bytes, supervisor image, and system target identity into policyDigest", () => {
    const variants = [
      (value) => value,
      (value) => {
        value.seccomp = {
          ...value.seccomp,
          sha256: "c".repeat(64),
        };
        return value;
      },
      (value) => {
        value.supervisor = {
          ...value.supervisor,
          sha256: "d".repeat(64),
        };
        return value;
      },
      (value) => {
        value.target = {
          ...value.target,
          identity: rootOwnedFile("/usr/bin/node", 999),
        };
        return value;
      },
      (value) => {
        value.workspace = {
          ...value.workspace,
          mountTopology: {
            ...value.workspace.mountTopology,
            digest: "9".repeat(64),
          },
        };
        return value;
      },
    ];
    const plans = variants.map((mutate) => {
      const commandContract = issue();
      return planLinuxGenericBubblewrap(
        {
          contract: commandContract,
          provenance: provenance(),
          resources: mutate(resources(commandContract)),
          probe: successfulProbe,
        },
        { platform: "linux" },
      );
    });

    expect(plans.every((plan) => plan.applied)).toBe(true);
    expect(new Set(plans.map((plan) => plan.policyDigest)).size).toBe(
      variants.length,
    );
    for (const plan of plans) plan.cleanup();
  });

  it("rejects numeric/inherited descriptors before issuing authority", () => {
    expect(() => issue({ stdio: ["ignore", "pipe", 9] })).toThrow(
      /rejects inherited\/numeric stdio/,
    );
    expect(() => issue({ stdio: "inherit" })).toThrow(
      /requires pipe\/ignore\/array stdio/,
    );
    expect(() =>
      issue({ stdio: ["ignore", "pipe", "pipe", "ignore"] }),
    ).toThrow(/rejects non-overwriting stdio at fd 3/);
    expect(() =>
      issue({ stdio: ["ignore", "pipe", "pipe", undefined] }),
    ).toThrow(/rejects non-overwriting stdio at fd 3/);
    const sparseStdio = ["ignore", "pipe", "pipe"];
    sparseStdio.length = 4;
    expect(() => issue({ stdio: sparseStdio })).toThrow(
      /rejects sparse\/accessor stdio at fd 3/,
    );
    const deletedStdio = ["ignore", "pipe", "pipe", "pipe", "pipe"];
    delete deletedStdio[3];
    expect(() => issue({ stdio: deletedStdio })).toThrow(
      /rejects sparse\/accessor stdio at fd 3/,
    );
    const sparseArgs = ["server.js"];
    sparseArgs.length = 2;
    expect(() => issue({ args: sparseArgs })).toThrow(
      /args\[1\] must be an own data property/,
    );
    expect(() => issue({ args: [7] })).toThrow(
      /args\[0\] must be a non-empty NUL-free string/,
    );
    expect(() =>
      issue({
        sync: true,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      }),
    ).toThrow(/IPC cannot be synchronous/);
    expect(() => issue({ detached: true })).toThrow(
      /rejects detached\/identity\/argv0\/serialization overrides/,
    );
  });

  it("rejects an injected adapter's generic plan and releases every parent descriptor", () => {
    const planningContract = issue();
    const acquiredResources = resources(planningContract);
    const plan = planLinuxGenericBubblewrap(
      {
        contract: planningContract,
        provenance: provenance(),
        resources: acquiredResources,
        probe: successfulProbe,
      },
      { platform: "linux" },
    );
    const launchContract = issue();
    const child = new EventEmitter();
    child.pid = 4321;
    child.kill = vi.fn();
    const nativeSpawn = vi.fn(() => child);
    const previous = {
      native: executionBroker._native,
      adapter: executionBroker._sandboxAdapter,
      sandboxEnabled: executionBroker._sandboxEnabled,
      platformEnabled: executionBroker._platformSandboxEnabled,
      credentialFiltering: executionBroker._credentialFilteringEnabled,
      credentialAgent: executionBroker._credentialAgentEnabled,
      disabled: process.env.CC_SANDBOX_DISABLE,
      strict: process.env.CC_SANDBOX_STRICT,
    };

    try {
      delete process.env.CC_SANDBOX_DISABLE;
      process.env.CC_SANDBOX_STRICT = "1";
      executionBroker._sandboxEnabled = true;
      executionBroker._platformSandboxEnabled = true;
      executionBroker._credentialFilteringEnabled = false;
      executionBroker._credentialAgentEnabled = false;
      executionBroker._native = { spawn: nativeSpawn };
      executionBroker._sandboxAdapter = {
        applySandbox: vi.fn(() => plan),
        postSpawnSandbox: vi.fn(),
      };

      expect(() =>
        executionBroker.spawn("node", ["server.js"], {
          origin: "plugin:mcp",
          cwd: CWD,
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
          policy: "allow",
          sandboxPolicy: {
            requiredBoundaries: ["filesystem", "network"],
          },
          sandboxExecutionContract: launchContract,
        }),
      ).toThrow(/require the built-in sandbox adapter/);

      expect(nativeSpawn).not.toHaveBeenCalled();
      expect(acquiredResources.cleanup).toHaveBeenCalledOnce();
    } finally {
      executionBroker._native = previous.native;
      executionBroker._sandboxAdapter = previous.adapter;
      executionBroker._sandboxEnabled = previous.sandboxEnabled;
      executionBroker._platformSandboxEnabled = previous.platformEnabled;
      executionBroker._credentialFilteringEnabled =
        previous.credentialFiltering;
      executionBroker._credentialAgentEnabled = previous.credentialAgent;
      if (previous.disabled === undefined) {
        delete process.env.CC_SANDBOX_DISABLE;
      } else {
        process.env.CC_SANDBOX_DISABLE = previous.disabled;
      }
      if (previous.strict === undefined) {
        delete process.env.CC_SANDBOX_STRICT;
      } else {
        process.env.CC_SANDBOX_STRICT = previous.strict;
      }
      executionBroker.flushAuditLog();
    }
  });

  it("records sanitized generic policy evidence in the hash-chained RPL", () => {
    const before = runtimeProvenanceLedger.getProvenance().length;
    executionBroker._writeRplEntry(
      {
        executionId: "generic-rpl-test",
        origin: "test:generic-rpl",
        command: "node",
        args: ["server.js"],
        cwd: CWD,
        exitCode: 0,
        permissionDecision: "allow",
        policy: "allow",
        scope: "sandbox-test",
        sandboxed: true,
        sandboxBackend: "linux-bwrap-workspace",
        sandboxGuarantees: ["filesystem", "network", "process-tree"],
        sandboxPolicyAttested: true,
        sandboxPolicyDigest: "e".repeat(64),
        sandboxFilesystemPolicy: {
          workspaceRoot: ROOT,
          workingDirectory: CWD,
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
          mountTopologyDigest: MOUNT_TOPOLOGY.digest,
          sourceMountSetDigest: MOUNT_TOPOLOGY.sourceMountSetDigest,
          sourceMountPropagationPrivateAtAttestation: true,
          mountTopologyAtomic: false,
        },
        sandboxNetworkPolicy: {
          namespace: "new",
          namespaceIdentityChanged: true,
          seccomp: "deny-network-creation",
        },
        sandboxProcessTreePolicy: {
          namespace: "new",
          namespaceIdentityChanged: true,
          init: "bubblewrap-pid1-reaper",
          parentDeathSignal: "SIGKILL",
          asPid1: false,
          closeFence: "pid-namespace-empty-or-killed",
        },
      },
      "completed",
    );

    const entries = runtimeProvenanceLedger.getProvenance();
    expect(entries).toHaveLength(before + 1);
    expect(entries.at(-1)).toMatchObject({
      type: "process.execution",
      source: "test:generic-rpl",
      artifactId: "generic-rpl-test",
      sandbox: {
        applied: true,
        backend: "linux-bwrap-workspace",
        guarantees: ["filesystem", "network", "process-tree"],
        policyAttested: true,
        policyDigest: "e".repeat(64),
        filesystemPolicy: {
          workspaceRoot: ROOT,
          workingDirectory: CWD,
          mountTopologyDigest: MOUNT_TOPOLOGY.digest,
          sourceMountSetDigest: MOUNT_TOPOLOGY.sourceMountSetDigest,
          sourceMountPropagationPrivateAtAttestation: true,
          mountTopologyAtomic: false,
        },
        networkPolicy: {
          namespace: "new",
          namespaceIdentityChanged: true,
          seccomp: "deny-network-creation",
        },
        processTreePolicy: {
          namespace: "new",
          namespaceIdentityChanged: true,
          init: "bubblewrap-pid1-reaper",
          parentDeathSignal: "SIGKILL",
          asPid1: false,
          closeFence: "pid-namespace-empty-or-killed",
        },
      },
    });
    expect(runtimeProvenanceLedger.verifyIntegrity()).toBe(true);
  });
});
