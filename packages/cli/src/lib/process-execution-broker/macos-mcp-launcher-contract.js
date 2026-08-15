import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MCP_STDIO_MACOS_GATED_ENTRY_BOOTSTRAP,
  MCP_STDIO_MACOS_GATED_ENTRY_BOOTSTRAP_SHA256,
} from "./mcp-fd-entry-bootstrap.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROTOCOL_PATH = path.join(MODULE_DIR, "macos-mcp-launcher-protocol.json");
const SOURCE_PATH = path.join(MODULE_DIR, "macos-mcp-launcher.c");

export function isMacosMcpLauncherPackageVersion(value) {
  return /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(value || "");
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function strictObjectKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} fields do not match the fixed contract`);
  }
}

function loadProtocolInputs() {
  const sourceBytes = fs.readFileSync(SOURCE_PATH);
  const protocolBytes = fs.readFileSync(PROTOCOL_PATH);
  const protocol = JSON.parse(protocolBytes.toString("utf8"));
  strictObjectKeys(
    protocol,
    [
      "schema",
      "protocolVersion",
      "backend",
      "packageIdentifier",
      "helperInstallPath",
      "installContractPath",
      "snapshotRoot",
      "snapshotLockName",
      "sandboxExecutable",
      "runtimeFd",
      "entryFd",
      "capsuleRootFd",
      "gateFd",
      "readyFd",
      "callerLifelineFd",
      "maximumRuntimeBytes",
      "maximumEntryBytes",
      "maximumPassthroughArgs",
      "maximumStaleSnapshots",
      "readyTimeoutMs",
      "profileTemplateVersion",
    ],
    "macOS MCP launcher protocol",
  );
  if (
    protocol.schema !== "chainlesschain.macos-mcp-launcher-protocol.v1" ||
    protocol.protocolVersion !== 1 ||
    protocol.backend !== "macos-signed-root-fd-launcher" ||
    protocol.packageIdentifier !== "com.chainlesschain.cli.mcp-launcher.pkg" ||
    protocol.helperInstallPath !==
      "/Library/PrivilegedHelperTools/com.chainlesschain.cli.mcp-launcher" ||
    protocol.installContractPath !==
      "/Library/PrivilegedHelperTools/com.chainlesschain.cli.mcp-launcher.json" ||
    protocol.snapshotRoot !==
      "/Library/Application Support/ChainlessChain/McpLauncher/runtime" ||
    protocol.snapshotLockName !== "launcher.lock" ||
    protocol.sandboxExecutable !== "/usr/bin/sandbox-exec" ||
    protocol.runtimeFd !== 3 ||
    protocol.entryFd !== 4 ||
    protocol.capsuleRootFd !== 5 ||
    protocol.gateFd !== 6 ||
    protocol.readyFd !== 7 ||
    protocol.callerLifelineFd !== 8 ||
    protocol.maximumRuntimeBytes !== 256 * 1024 * 1024 ||
    protocol.maximumEntryBytes !== 64 * 1024 * 1024 ||
    protocol.maximumPassthroughArgs !== 128 ||
    protocol.maximumStaleSnapshots !== 8 ||
    protocol.readyTimeoutMs !== 15_000 ||
    protocol.profileTemplateVersion !== 1
  ) {
    throw new Error("macOS MCP launcher protocol contains unsupported values");
  }
  return Object.freeze({
    sourcePath: SOURCE_PATH,
    sourceBytes,
    sourceSha256: sha256(sourceBytes),
    protocolPath: PROTOCOL_PATH,
    protocolBytes,
    protocol,
    protocolSha256: sha256(protocolBytes),
    gateBootstrap: MCP_STDIO_MACOS_GATED_ENTRY_BOOTSTRAP,
    gateBootstrapSha256: MCP_STDIO_MACOS_GATED_ENTRY_BOOTSTRAP_SHA256,
  });
}

export const MACOS_MCP_LAUNCHER_INPUTS = loadProtocolInputs();
export const MACOS_MCP_LAUNCHER_INSTALL_CONTRACT_SCHEMA =
  "chainlesschain.macos-mcp-launcher-install.v1";

function designatedRequirementMatchesReleaseIdentity(contract) {
  const requirement = contract.designatedRequirement;
  const team = contract.teamIdentifier;
  return (
    typeof requirement === "string" &&
    requirement.length <= 4096 &&
    !requirement.includes("\0") &&
    !/[\r\n]/u.test(requirement) &&
    !/\bor\b/iu.test(requirement) &&
    requirement.includes('identifier "com.chainlesschain.cli.mcp-launcher"') &&
    requirement.includes("anchor apple generic") &&
    requirement.includes(
      "certificate 1[field.1.2.840.113635.100.6.2.6] exists",
    ) &&
    requirement.includes(
      "certificate leaf[field.1.2.840.113635.100.6.1.13] exists",
    ) &&
    requirement.includes(`certificate leaf[subject.OU] = ${team}`)
  );
}

export function verifyMacosMcpLauncherInstallContract(
  contract,
  inputs = MACOS_MCP_LAUNCHER_INPUTS,
) {
  strictObjectKeys(
    contract,
    [
      "schema",
      "protocolVersion",
      "protocolSha256",
      "sourceSha256",
      "gateBootstrapSha256",
      "helperSha256",
      "helperBytes",
      "packageIdentifier",
      "packageVersion",
      "helperInstallPath",
      "installContractPath",
      "snapshotRoot",
      "snapshotLockName",
      "sandboxExecutable",
      "ownerUid",
      "ownerGid",
      "helperMode",
      "contractMode",
      "snapshotRootMode",
      "snapshotLockMode",
      "snapshotLockMechanism",
      "signingIdentifier",
      "teamIdentifier",
      "designatedRequirement",
      "hardenedRuntimeRequired",
      "notarizedPackageRequired",
      "rootInstallRequired",
      "runtimeSnapshotMechanism",
      "entrySnapshotMechanism",
      "targetDescriptorMechanism",
      "callerLifelineFd",
      "globalLaunchSerialization",
      "maximumStaleSnapshots",
      "sandboxExecLiveGateRequired",
      "parentDeathLiveGateRequired",
      "inPlaceOverwriteLiveGateRequired",
      "signalFloodLiveGateRequired",
      "snapshotLockUpgradeLiveGateRequired",
    ],
    "macOS MCP launcher install contract",
  );
  if (
    contract.schema !== MACOS_MCP_LAUNCHER_INSTALL_CONTRACT_SCHEMA ||
    contract.protocolVersion !== 1 ||
    contract.protocolSha256 !== inputs.protocolSha256 ||
    contract.sourceSha256 !== inputs.sourceSha256 ||
    contract.gateBootstrapSha256 !== inputs.gateBootstrapSha256 ||
    !/^[a-f0-9]{64}$/u.test(contract.helperSha256 || "") ||
    !Number.isSafeInteger(contract.helperBytes) ||
    contract.helperBytes <= 0 ||
    contract.helperBytes > 16 * 1024 * 1024 ||
    contract.packageIdentifier !== inputs.protocol.packageIdentifier ||
    !isMacosMcpLauncherPackageVersion(contract.packageVersion) ||
    contract.helperInstallPath !== inputs.protocol.helperInstallPath ||
    contract.installContractPath !== inputs.protocol.installContractPath ||
    contract.snapshotRoot !== inputs.protocol.snapshotRoot ||
    contract.snapshotLockName !== inputs.protocol.snapshotLockName ||
    contract.sandboxExecutable !== inputs.protocol.sandboxExecutable ||
    contract.ownerUid !== 0 ||
    contract.ownerGid !== 0 ||
    contract.helperMode !== "4555" ||
    contract.contractMode !== "0444" ||
    contract.snapshotRootMode !== "0711" ||
    contract.snapshotLockMode !== "0600" ||
    contract.snapshotLockMechanism !==
      "root-helper-openat-o_excl-preserve-inode-across-upgrade-v1" ||
    contract.signingIdentifier !== "com.chainlesschain.cli.mcp-launcher" ||
    !/^[A-Z0-9]{10}$/u.test(contract.teamIdentifier || "") ||
    !designatedRequirementMatchesReleaseIdentity(contract) ||
    contract.hardenedRuntimeRequired !== true ||
    contract.notarizedPackageRequired !== true ||
    contract.rootInstallRequired !== true ||
    contract.runtimeSnapshotMechanism !==
      "root-copy-hash-protected-path-ready-unlink-v1" ||
    contract.entrySnapshotMechanism !==
      "root-copy-hash-readonly-reopen-unlink-fsync-fd4-v1" ||
    contract.targetDescriptorMechanism !==
      "stdio-fd3-null-fd4-entry-fd5-null-fd6-gate-fd7-ready-bootstrap-close-v1" ||
    contract.callerLifelineFd !== inputs.protocol.callerLifelineFd ||
    contract.globalLaunchSerialization !== true ||
    contract.maximumStaleSnapshots !== inputs.protocol.maximumStaleSnapshots ||
    contract.sandboxExecLiveGateRequired !== true ||
    contract.parentDeathLiveGateRequired !== true ||
    contract.inPlaceOverwriteLiveGateRequired !== true ||
    contract.signalFloodLiveGateRequired !== true ||
    contract.snapshotLockUpgradeLiveGateRequired !== true
  ) {
    throw new Error("macOS MCP launcher install contract is invalid");
  }
  return contract;
}

function seatbeltLiteral(value) {
  const text = String(value);
  if (
    [...text].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  ) {
    throw new Error("macOS MCP launcher path contains a control character");
  }
  return text.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}

/** Must remain byte-for-byte equivalent to build_fixed_profile() in C. */
export function generateMacosMcpLauncherSeatbeltProfile({
  snapshotPath,
  capsulePath,
}) {
  const snapshot = seatbeltLiteral(snapshotPath);
  const capsule = seatbeltLiteral(capsulePath);
  return [
    "(version 1)",
    "(deny default)",
    '(import "system.sb")',
    "(allow signal (target self))",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(deny network*)",
    "(deny process-fork)",
    `(allow process-exec (literal "${snapshot}"))`,
    `(allow file-read* (literal "${snapshot}"))`,
    '(allow file-read* (subpath "/bin"))',
    '(allow file-read* (subpath "/usr/bin"))',
    '(allow file-read* (subpath "/usr/lib"))',
    '(allow file-read* (subpath "/usr/libexec"))',
    '(allow file-read* (subpath "/System/Library"))',
    '(allow file-read* (subpath "/Library/Frameworks"))',
    '(allow file-read* (subpath "/usr/local/lib"))',
    `(allow file-read* file-write* (subpath "${capsule}"))`,
    '(allow file-read* file-write* (literal "/dev/null") (literal "/dev/stdin") (literal "/dev/stdout") (literal "/dev/stderr"))',
    '(allow file-read* (literal "/dev/urandom"))',
    '(allow file-read* (literal "/etc/passwd"))',
  ].join("\n");
}

export function macosMcpLauncherPolicyDigest({ snapshotPath, capsulePath }) {
  return sha256(
    generateMacosMcpLauncherSeatbeltProfile({ snapshotPath, capsulePath }),
  );
}
