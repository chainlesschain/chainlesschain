#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  MACOS_MCP_LAUNCHER_INPUTS,
  MACOS_MCP_LAUNCHER_INSTALL_CONTRACT_SCHEMA,
  isMacosMcpLauncherPackageVersion,
  verifyMacosMcpLauncherInstallContract,
} from "../src/lib/process-execution-broker/macos-mcp-launcher-contract.js";

export {
  MACOS_MCP_LAUNCHER_INSTALL_CONTRACT_SCHEMA,
  verifyMacosMcpLauncherInstallContract,
};
export const MACOS_MCP_LAUNCHER_SOURCE = MACOS_MCP_LAUNCHER_INPUTS.sourcePath;
export const MACOS_MCP_LAUNCHER_PROTOCOL =
  MACOS_MCP_LAUNCHER_INPUTS.protocolPath;

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function loadMacosMcpLauncherBuildInputs() {
  return MACOS_MCP_LAUNCHER_INPUTS;
}

function cString(value) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError("generated C string must be NUL-free");
  }
  return JSON.stringify(value);
}

export function generatedMacosMcpLauncherHeader(inputs) {
  const { protocol } = inputs;
  return [
    "#ifndef CHAINLESSCHAIN_MACOS_MCP_LAUNCHER_GENERATED_H",
    "#define CHAINLESSCHAIN_MACOS_MCP_LAUNCHER_GENERATED_H",
    `#define CC_PROTOCOL_VERSION ${protocol.protocolVersion}`,
    `#define CC_PROTOCOL_SHA256 ${cString(inputs.protocolSha256)}`,
    `#define CC_HELPER_SOURCE_SHA256 ${cString(inputs.sourceSha256)}`,
    `#define CC_GATE_BOOTSTRAP_SHA256 ${cString(inputs.gateBootstrapSha256)}`,
    `#define CC_GATE_BOOTSTRAP ${cString(inputs.gateBootstrap)}`,
    `#define CC_PACKAGE_IDENTIFIER ${cString(protocol.packageIdentifier)}`,
    `#define CC_HELPER_INSTALL_PATH ${cString(protocol.helperInstallPath)}`,
    `#define CC_INSTALL_CONTRACT_PATH ${cString(protocol.installContractPath)}`,
    `#define CC_SNAPSHOT_ROOT ${cString(protocol.snapshotRoot)}`,
    `#define CC_SNAPSHOT_LOCK_NAME ${cString(protocol.snapshotLockName)}`,
    `#define CC_SANDBOX_EXECUTABLE ${cString(protocol.sandboxExecutable)}`,
    `#define CC_RUNTIME_FD ${protocol.runtimeFd}`,
    `#define CC_ENTRY_FD ${protocol.entryFd}`,
    `#define CC_CAPSULE_ROOT_FD ${protocol.capsuleRootFd}`,
    `#define CC_GATE_FD ${protocol.gateFd}`,
    `#define CC_READY_FD ${protocol.readyFd}`,
    `#define CC_CALLER_LIFELINE_FD ${protocol.callerLifelineFd}`,
    `#define CC_MAXIMUM_RUNTIME_BYTES ${protocol.maximumRuntimeBytes}`,
    `#define CC_MAXIMUM_ENTRY_BYTES ${protocol.maximumEntryBytes}`,
    `#define CC_MAXIMUM_PASSTHROUGH_ARGS ${protocol.maximumPassthroughArgs}`,
    `#define CC_MAX_STALE_SNAPSHOTS ${protocol.maximumStaleSnapshots}`,
    `#define CC_READY_TIMEOUT_MS ${protocol.readyTimeoutMs}`,
    "#endif",
    "",
  ].join("\n");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
    timeout: 120_000,
    ...options,
  });
  if (result.error || result.status !== 0 || result.signal) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw (
      result.error ||
      new Error(
        `${path.basename(command)} failed (${result.status ?? result.signal}): ${detail}`,
      )
    );
  }
  return result;
}

export function macosMcpLauncherCompilerArguments({
  sdkPath,
  temporaryRoot,
  sourcePath = MACOS_MCP_LAUNCHER_SOURCE,
  outputPath,
}) {
  for (const [name, value] of Object.entries({
    sdkPath,
    temporaryRoot,
    sourcePath,
    outputPath,
  })) {
    if (typeof value !== "string" || !path.isAbsolute(value)) {
      throw new TypeError(`${name} must be an absolute path`);
    }
  }
  return [
    "-std=c11",
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-Wno-deprecated-declarations",
    "-mmacosx-version-min=13.0",
    "-isysroot",
    sdkPath,
    "-I",
    temporaryRoot,
    sourcePath,
    "-o",
    outputPath,
  ];
}

export function buildMacosMcpLauncher(outputPath, options = {}) {
  if ((options.platform || process.platform) !== "darwin") {
    throw new Error("macOS MCP launcher can only be compiled on macOS");
  }
  const inputs = loadMacosMcpLauncherBuildInputs();
  const temporaryRoot = fs.mkdtempSync(
    path.join(options.tmpdir || os.tmpdir(), "cc-macos-mcp-launcher-build-"),
  );
  try {
    const header = path.join(temporaryRoot, "macos-mcp-launcher-generated.h");
    fs.writeFileSync(header, generatedMacosMcpLauncherHeader(inputs), {
      mode: 0o600,
    });
    const output = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const clang = run("/usr/bin/xcrun", [
      "--sdk",
      "macosx",
      "--find",
      "clang",
    ]).stdout.trim();
    const sdkPath = fs.realpathSync(
      run("/usr/bin/xcrun", [
        "--sdk",
        "macosx",
        "--show-sdk-path",
      ]).stdout.trim(),
    );
    run(
      clang,
      macosMcpLauncherCompilerArguments({
        sdkPath,
        temporaryRoot,
        outputPath: output,
      }),
    );
    fs.chmodSync(output, 0o755);
    return Object.freeze({ output, ...inputs });
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function parseCodesignDetails(stderr) {
  const details = String(stderr || "");
  const teamIdentifier = details.match(/^TeamIdentifier=(.+)$/mu)?.[1];
  const signingIdentifier = details.match(/^Identifier=(.+)$/mu)?.[1];
  if (!teamIdentifier || !/^[A-Z0-9]{10}$/u.test(teamIdentifier)) {
    throw new Error("signed helper has no valid Developer ID team identifier");
  }
  if (signingIdentifier !== "com.chainlesschain.cli.mcp-launcher") {
    throw new Error("signed helper identifier does not match the launcher");
  }
  if (!/^CodeDirectory .+ flags=.+\(runtime\)/mu.test(details)) {
    throw new Error("signed helper does not require the hardened runtime");
  }
  return { teamIdentifier, signingIdentifier };
}

export function createMacosMcpLauncherInstallContract({
  helperPath,
  expectedTeamIdentifier,
  expectedDesignatedRequirement,
  packageVersion,
  platform = process.platform,
}) {
  if (platform !== "darwin") {
    throw new Error("signed helper contract can only be created on macOS");
  }
  if (!/^[A-Z0-9]{10}$/u.test(expectedTeamIdentifier || "")) {
    throw new Error("expected macOS team identifier is invalid");
  }
  if (
    typeof expectedDesignatedRequirement !== "string" ||
    !expectedDesignatedRequirement.startsWith("identifier ")
  ) {
    throw new Error("expected designated requirement is invalid");
  }
  if (!isMacosMcpLauncherPackageVersion(packageVersion)) {
    throw new Error("macOS MCP launcher package version is invalid");
  }
  const inputs = loadMacosMcpLauncherBuildInputs();
  const helper = path.resolve(helperPath);
  const verification = run("/usr/bin/codesign", [
    "--verify",
    "--strict",
    "--verbose=4",
    `-R=${expectedDesignatedRequirement}`,
    helper,
  ]);
  const description = run("/usr/bin/codesign", ["-dvvv", helper]);
  const signing = parseCodesignDetails(description.stderr);
  const requirement = run("/usr/bin/codesign", [
    "-dr",
    "-",
    helper,
  ]).stderr.match(/^designated => (.+)$/mu)?.[1];
  if (
    verification.status !== 0 ||
    signing.teamIdentifier !== expectedTeamIdentifier ||
    requirement !== expectedDesignatedRequirement
  ) {
    throw new Error("helper signature does not match protected release policy");
  }
  const helperBytes = fs.readFileSync(helper);
  return Object.freeze({
    schema: MACOS_MCP_LAUNCHER_INSTALL_CONTRACT_SCHEMA,
    protocolVersion: inputs.protocol.protocolVersion,
    protocolSha256: inputs.protocolSha256,
    sourceSha256: inputs.sourceSha256,
    gateBootstrapSha256: inputs.gateBootstrapSha256,
    helperSha256: sha256(helperBytes),
    helperBytes: helperBytes.length,
    packageIdentifier: inputs.protocol.packageIdentifier,
    packageVersion,
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
    signingIdentifier: signing.signingIdentifier,
    teamIdentifier: signing.teamIdentifier,
    designatedRequirement: requirement,
    hardenedRuntimeRequired: true,
    notarizedPackageRequired: true,
    rootInstallRequired: true,
    runtimeSnapshotMechanism: "root-copy-hash-protected-path-ready-unlink-v1",
    entrySnapshotMechanism:
      "root-copy-hash-readonly-reopen-unlink-fsync-fd4-v1",
    targetDescriptorMechanism:
      "stdio-fd3-null-fd4-entry-fd5-null-fd6-gate-fd7-ready-bootstrap-close-v1",
    callerLifelineFd: inputs.protocol.callerLifelineFd,
    globalLaunchSerialization: true,
    maximumStaleSnapshots: inputs.protocol.maximumStaleSnapshots,
    sandboxExecLiveGateRequired: true,
    parentDeathLiveGateRequired: true,
    inPlaceOverwriteLiveGateRequired: true,
    signalFloodLiveGateRequired: true,
    snapshotLockUpgradeLiveGateRequired: true,
  });
}

function usage() {
  throw new Error(
    "usage: macos-mcp-launcher-build.mjs build <output> | contract <signed-helper> <team-id> <requirement> <package-version> <output.json>",
  );
}

function main(argv = process.argv.slice(2)) {
  if (argv[0] === "build" && argv.length === 2) {
    const built = buildMacosMcpLauncher(argv[1]);
    process.stdout.write(`${built.sourceSha256}  ${built.output}\n`);
    return;
  }
  if (argv[0] === "contract" && argv.length === 6) {
    const contract = createMacosMcpLauncherInstallContract({
      helperPath: argv[1],
      expectedTeamIdentifier: argv[2],
      expectedDesignatedRequirement: argv[3],
      packageVersion: argv[4],
    });
    verifyMacosMcpLauncherInstallContract(contract);
    fs.writeFileSync(
      path.resolve(argv[5]),
      `${JSON.stringify(contract, null, 2)}\n`,
      {
        mode: 0o600,
      },
    );
    process.stdout.write(`${contract.helperSha256}  ${argv[5]}\n`);
    return;
  }
  usage();
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`macOS MCP launcher build failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
