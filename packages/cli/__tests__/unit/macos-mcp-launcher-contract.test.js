import crypto from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  MACOS_MCP_LAUNCHER_INPUTS,
  generateMacosMcpLauncherSeatbeltProfile,
  macosMcpLauncherPolicyDigest,
  verifyMacosMcpLauncherInstallContract,
} from "../../src/lib/process-execution-broker/macos-mcp-launcher-contract.js";
import {
  MCP_STDIO_FD_ENTRY_BOOTSTRAP,
  MCP_STDIO_MACOS_GATED_ENTRY_BOOTSTRAP,
  MCP_STDIO_MACOS_GATED_ENTRY_BOOTSTRAP_SHA256,
  createMcpStdioFdEntryBootstrap,
} from "../../src/lib/process-execution-broker/mcp-fd-entry-bootstrap.js";
import {
  generatedMacosMcpLauncherHeader,
  loadMacosMcpLauncherBuildInputs,
} from "../../scripts/macos-mcp-launcher-build.mjs";

const temporaryRoots = [];
const activeChildren = new Set();

afterEach(async () => {
  const children = [...activeChildren];
  for (const child of children) {
    try {
      child.kill("SIGKILL");
    } catch {
      // A concurrently reaped child needs no cleanup.
    }
  }
  await Promise.all(
    children.map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await Promise.race([
        once(child, "close").catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
    }),
  );
  activeChildren.clear();
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function trackChild(child) {
  activeChildren.add(child);
  child.once("close", () => activeChildren.delete(child));
  return child;
}

function childResult(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (status, signal) => resolve({ status, signal }));
  });
}

function waitForReady(child, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timed out waiting for the actual Node READY byte"));
    }, timeoutMs);
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onClose = (status, signal) => {
      cleanup();
      reject(
        new Error(
          `Node exited before READY (status=${status}, signal=${signal})`,
        ),
      );
    };
    const onReady = (chunk) => {
      cleanup();
      resolve(chunk);
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off("error", onError);
      child.off("close", onClose);
      child.stdio[7].off("data", onReady);
    };
    child.once("error", onError);
    child.once("close", onClose);
    child.stdio[7].once("data", onReady);
  });
}

function writeGate(child) {
  return new Promise((resolve, reject) => {
    child.stdio[6].once("error", reject);
    child.stdio[6].write("G", (error) => (error ? reject(error) : resolve()));
  });
}

function releaseRequirement(teamIdentifier = "ABCDEFGHIJ") {
  return (
    'identifier "com.chainlesschain.cli.mcp-launcher" and anchor apple generic ' +
    "and certificate 1[field.1.2.840.113635.100.6.2.6] exists " +
    "and certificate leaf[field.1.2.840.113635.100.6.1.13] exists " +
    `and certificate leaf[subject.OU] = ${teamIdentifier}`
  );
}

function validInstallContract() {
  const inputs = MACOS_MCP_LAUNCHER_INPUTS;
  return {
    schema: "chainlesschain.macos-mcp-launcher-install.v1",
    protocolVersion: 1,
    protocolSha256: inputs.protocolSha256,
    sourceSha256: inputs.sourceSha256,
    gateBootstrapSha256: inputs.gateBootstrapSha256,
    helperSha256: "a".repeat(64),
    helperBytes: 4096,
    packageIdentifier: inputs.protocol.packageIdentifier,
    packageVersion: "0.162.0",
    helperInstallPath: inputs.protocol.helperInstallPath,
    installContractPath: inputs.protocol.installContractPath,
    snapshotRoot: inputs.protocol.snapshotRoot,
    snapshotLockName: inputs.protocol.snapshotLockName,
    sandboxExecutable: inputs.protocol.sandboxExecutable,
    ownerUid: 0,
    ownerGid: 0,
    helperMode: "4555",
    contractMode: "0444",
    snapshotRootMode: "0711",
    snapshotLockMode: "0600",
    snapshotLockMechanism:
      "root-helper-openat-o_excl-preserve-inode-across-upgrade-v1",
    signingIdentifier: "com.chainlesschain.cli.mcp-launcher",
    teamIdentifier: "ABCDEFGHIJ",
    designatedRequirement: releaseRequirement(),
    hardenedRuntimeRequired: true,
    notarizedPackageRequired: true,
    rootInstallRequired: true,
    runtimeSnapshotMechanism: "root-copy-hash-protected-path-ready-unlink-v1",
    entrySnapshotMechanism:
      "root-copy-hash-readonly-reopen-unlink-fsync-fd4-v1",
    targetDescriptorMechanism:
      "stdio-fd3-null-fd4-entry-fd5-null-fd6-gate-fd7-ready-bootstrap-close-v1",
    callerLifelineFd: 8,
    globalLaunchSerialization: true,
    maximumStaleSnapshots: 8,
    sandboxExecLiveGateRequired: true,
    parentDeathLiveGateRequired: true,
    inPlaceOverwriteLiveGateRequired: true,
    signalFloodLiveGateRequired: true,
    snapshotLockUpgradeLiveGateRequired: true,
  };
}

describe("signed macOS MCP launcher contract", () => {
  it("derives both bootstraps and generated C constants from one source", () => {
    const inputs = loadMacosMcpLauncherBuildInputs();
    expect(inputs).toBe(MACOS_MCP_LAUNCHER_INPUTS);
    expect(createMcpStdioFdEntryBootstrap()).toBe(MCP_STDIO_FD_ENTRY_BOOTSTRAP);
    expect(createMcpStdioFdEntryBootstrap({ gated: true })).toBe(
      MCP_STDIO_MACOS_GATED_ENTRY_BOOTSTRAP,
    );
    expect(
      crypto
        .createHash("sha256")
        .update(MCP_STDIO_MACOS_GATED_ENTRY_BOOTSTRAP)
        .digest("hex"),
    ).toBe(MCP_STDIO_MACOS_GATED_ENTRY_BOOTSTRAP_SHA256);

    const header = generatedMacosMcpLauncherHeader(inputs);
    expect(header).toContain(
      `#define CC_PROTOCOL_SHA256 "${inputs.protocolSha256}"`,
    );
    expect(header).toContain(
      `#define CC_HELPER_SOURCE_SHA256 "${inputs.sourceSha256}"`,
    );
    expect(header).toContain("#define CC_CALLER_LIFELINE_FD 8");
    expect(header).toContain(
      '#define CC_PACKAGE_IDENTIFIER "com.chainlesschain.cli.mcp-launcher.pkg"',
    );
    expect(header).toContain("#define CC_MAX_STALE_SNAPSHOTS 8");
    expect(header).toContain(
      `#define CC_GATE_BOOTSTRAP ${JSON.stringify(
        MCP_STDIO_MACOS_GATED_ENTRY_BOOTSTRAP,
      )}`,
    );
  });

  it("requires the exact signed/root/notarized live-gate install contract", () => {
    const contract = validInstallContract();
    expect(verifyMacosMcpLauncherInstallContract(contract)).toBe(contract);
    for (const mutation of [
      { helperMode: "0755" },
      { packageVersion: "1.0" },
      { packageVersion: "01.2.3" },
      { packageVersion: "1.02.3" },
      { packageVersion: "1.2.03" },
      { packageVersion: "1.2.3-beta.1" },
      { ownerUid: 501 },
      { callerLifelineFd: 7 },
      { globalLaunchSerialization: false },
      { parentDeathLiveGateRequired: false },
      { inPlaceOverwriteLiveGateRequired: false },
      { signalFloodLiveGateRequired: false },
      { snapshotLockUpgradeLiveGateRequired: false },
      { snapshotLockMechanism: "pkg-payload-replaced-lock" },
      {
        designatedRequirement:
          releaseRequirement() + ' or identifier "com.attacker.helper"',
      },
    ]) {
      expect(() =>
        verifyMacosMcpLauncherInstallContract({ ...contract, ...mutation }),
      ).toThrow(/install contract is invalid/u);
    }
    expect(() =>
      verifyMacosMcpLauncherInstallContract({ ...contract, unexpected: true }),
    ).toThrow(/fields do not match/u);
  });

  it("keeps the JS policy bytes and digest fixed for the C helper", () => {
    const input = {
      snapshotPath:
        "/Library/Application Support/ChainlessChain/McpLauncher/runtime/" +
        `${"a".repeat(64)}/node`,
      capsulePath: '/Users/test/MCP "capsule"',
    };
    const profile = generateMacosMcpLauncherSeatbeltProfile(input);
    expect(profile).toContain("(deny default)");
    expect(profile).toContain("(deny network*)");
    expect(profile).toContain("(deny process-fork)");
    expect(profile).not.toContain("(allow process-fork)");
    expect(profile).toContain(
      `(allow file-read* (literal "${input.snapshotPath}"))`,
    );
    expect(profile).toContain(
      '(allow file-read* file-write* (subpath "/Users/test/MCP \\"capsule\\""))',
    );
    expect(macosMcpLauncherPolicyDigest(input)).toBe(
      crypto.createHash("sha256").update(profile).digest("hex"),
    );
  });

  it("emits READY from the actual Node image and blocks entry on fd 6", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-macos-gate-"));
    temporaryRoots.push(root);
    const original = path.join(root, "entry.cjs");
    const snapshot = path.join(root, "entry.snapshot");
    fs.writeFileSync(original, 'process.stdout.write("original-entry");\n');
    fs.copyFileSync(original, snapshot);
    const entryFd = fs.openSync(snapshot, "r");
    fs.unlinkSync(snapshot);
    fs.writeFileSync(original, 'process.stdout.write("replaced-entry");\n');

    const child = trackChild(
      spawn(
        process.execPath,
        ["-e", MCP_STDIO_MACOS_GATED_ENTRY_BOOTSTRAP, "--"],
        {
          stdio: [
            "ignore",
            "pipe",
            "pipe",
            "ignore",
            entryFd,
            "ignore",
            "pipe",
            "pipe",
          ],
        },
      ),
    );
    fs.closeSync(entryFd);
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    const closePromise = childResult(child);
    try {
      expect((await waitForReady(child)).toString()).toBe("R");
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(stdout).toBe("");
      await writeGate(child);
      expect(await closePromise).toEqual({ status: 0, signal: null });
      expect(stdout).toBe("original-entry");
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await Promise.race([
          closePromise.catch(() => {}),
          new Promise((resolve) => setTimeout(resolve, 2_000)),
        ]);
      }
    }
  });

  it("keeps entry blocked and fails closed when the gate parent closes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-macos-gate-eof-"));
    temporaryRoots.push(root);
    const snapshot = path.join(root, "entry.snapshot");
    fs.writeFileSync(snapshot, 'process.stdout.write("must-not-run");\n');
    const entryFd = fs.openSync(snapshot, "r");
    fs.unlinkSync(snapshot);
    const child = trackChild(
      spawn(
        process.execPath,
        ["-e", MCP_STDIO_MACOS_GATED_ENTRY_BOOTSTRAP, "--"],
        {
          stdio: [
            "ignore",
            "pipe",
            "pipe",
            "ignore",
            entryFd,
            "ignore",
            "pipe",
            "pipe",
          ],
        },
      ),
    );
    fs.closeSync(entryFd);
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    const closePromise = childResult(child);
    try {
      expect((await waitForReady(child)).toString()).toBe("R");
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(stdout).toBe("");
      child.stdio[6].destroy();
      expect(await closePromise).toEqual({ status: 126, signal: null });
      expect(stdout).toBe("");
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await Promise.race([
          closePromise.catch(() => {}),
          new Promise((resolve) => setTimeout(resolve, 2_000)),
        ]);
      }
    }
  });

  it("contains the fail-closed C process tree and byte-copy invariants", () => {
    const source = MACOS_MCP_LAUNCHER_INPUTS.sourceBytes.toString("utf8");
    const ordered = (...needles) =>
      needles.reduce((previous, needle) => {
        const index = source.indexOf(needle, previous + 1);
        expect(index, needle).toBeGreaterThan(previous);
        return index;
      }, -1);

    expect(source).not.toContain("getresuid(");
    expect(source).not.toContain("getresgid(");
    expect(source).toContain("getuid() == 0 || getgid() == 0");
    expect(source).toContain("setgroups(0, NULL)");
    expect(source).toContain("seteuid(0) == 0 || setegid(0) == 0");
    expect(source).toContain("O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW");
    expect(source).toContain("entryRootOwnedAnonymousSnapshot");
    expect(source).toContain("entryUnlinkedAndDirectoryFsyncedBeforeTarget");
    expect(source).toContain("CC_CALLER_LIFELINE_FD");
    expect(source).toContain("F_SETFL, control_flags | O_NONBLOCK");
    expect(source).toContain("POLLIN | POLLHUP | POLLERR | POLLNVAL");
    expect(source).toContain("closefrom(CC_CALLER_LIFELINE_FD)");
    expect(source).toContain("closefrom(CC_CALLER_LIFELINE_FD + 1)");
    expect(source).toContain('open("/dev/null", O_RDONLY | O_CLOEXEC)');
    expect(source).toContain("install_null_placeholders() != 0");
    expect(source).toContain("runtimeAndCapsuleSlotsNullBeforeExec");
    expect(source).toContain("bootstrapClosesNullAndReadyDescriptors");
    expect(source).toContain('"OPENSSL_CONF"');
    expect(source).toContain('"OPENSSL_CONF_INCLUDE"');
    expect(source).toContain('"OPENSSL_MODULES"');
    expect(source).toContain('"OPENSSL_ENGINES"');
    expect(source).toContain(
      "O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC",
    );
    expect(source).toContain('strcmp(argv[1], "--install-lock-v1")');
    expect(source).toContain("relayParentCredentialsDropped");
    expect(source.match(/drop_to_caller\(/gu)).toHaveLength(3);
    expect(validInstallContract().targetDescriptorMechanism).toBe(
      "stdio-fd3-null-fd4-entry-fd5-null-fd6-gate-fd7-ready-bootstrap-close-v1",
    );
    expect(MCP_STDIO_MACOS_GATED_ENTRY_BOOTSTRAP).toContain(
      "for(const fd of [3,5,7])",
    );
    expect(source).toContain("cleanup_snapshot_directory(root_fd");
    expect(source).toContain("signal_target_tree(target_pid, SIGKILL)");
    ordered(
      "setgroups(0, NULL)",
      "setgid(gid)",
      "setuid(uid)",
      "validate_capsule_descriptor(request, evidence, capsule_path)",
      "sanitized_environment()",
    );
    ordered(
      "close(writer_fd)",
      "openat(directory_fd, snapshot_name",
      "unlinkat(directory_fd, snapshot_name, 0)",
      "fsync(directory_fd)",
    );
    ordered(
      "poll_ready_or_parent",
      "cleanup_snapshot_directory(root_fd, request->nonce, 1)",
      'write(gate_pipe[1], "G", 1)',
    );
    const postinstall = fs.readFileSync(
      new URL(
        "../../scripts/macos-mcp-launcher-postinstall.sh",
        import.meta.url,
      ),
      "utf8",
    );
    expect(postinstall).toContain('"$helper" --install-lock-v1');
    expect(postinstall).not.toMatch(/\b(?:chown|chmod)\b/u);
  });
});
