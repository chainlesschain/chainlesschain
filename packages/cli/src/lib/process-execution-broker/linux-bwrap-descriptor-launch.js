/**
 * Descriptor-bound pre-exec launcher shared by the Linux bubblewrap backends.
 *
 * Node maps every declared stdio entry onto a contiguous child descriptor.
 * The pinned Bash executable is appended after that declared range. Bash then
 * closes its own descriptor and every unknown inherited descriptor above the
 * range before executing the already-pinned target executable by descriptor.
 */

import crypto from "node:crypto";

export const LINUX_BWRAP_DESCRIPTOR_SCRUBBER_PATH = "/usr/bin/bash";
export const LINUX_BWRAP_DESCRIPTOR_SCRUBBER_KIND =
  "linux-bwrap-inherited-fd-scrubber-v1";
export const LINUX_BWRAP_DESCRIPTOR_SCRUBBER_MECHANISM =
  "pinned-root-owned-bash-appended-fd-three-pass-proc-self-fd-sweep-v1";
export const LINUX_BWRAP_DESCRIPTOR_SCRUBBER_ARGV0 =
  "chainless-bwrap-fd-scrubber-v1";
export const LINUX_BWRAP_DESCRIPTOR_SCRUBBER_PASSES = 3;
export const LINUX_BWRAP_DESCRIPTOR_SCRUBBER_FAILURE_STATUS = 125;

// This script is fixed application code. Values derived from a launch plan are
// passed only as positional arguments and are validated as decimal integers;
// untrusted target arguments are forwarded exclusively through quoted "$@".
export const LINUX_BWRAP_DESCRIPTOR_SCRUBBER_SCRIPT = [
  "set -u",
  "shopt -s execfail",
  'chainless_preserved_max_fd="$1"',
  'chainless_executable_fd="$2"',
  "shift 2",
  'case "$chainless_preserved_max_fd" in',
  `  ""|*[!0-9]*) exit ${LINUX_BWRAP_DESCRIPTOR_SCRUBBER_FAILURE_STATUS} ;;`,
  "esac",
  'case "$chainless_executable_fd" in',
  `  ""|*[!0-9]*) exit ${LINUX_BWRAP_DESCRIPTOR_SCRUBBER_FAILURE_STATUS} ;;`,
  "esac",
  "if [[ ! $chainless_preserved_max_fd =~ ^[1-9][0-9]*$ ||",
  "      ! $chainless_executable_fd =~ ^[1-9][0-9]*$ ||",
  "      ${#chainless_preserved_max_fd} -gt 10 ||",
  "      ${#chainless_executable_fd} -gt 10 ]]; then",
  `  exit ${LINUX_BWRAP_DESCRIPTOR_SCRUBBER_FAILURE_STATUS}`,
  "fi",
  "if (( chainless_preserved_max_fd < 3 ||",
  "      chainless_preserved_max_fd > 2147483647 ||",
  "      chainless_executable_fd < 3 ||",
  "      chainless_executable_fd > 2147483647 ||",
  "      chainless_executable_fd > chainless_preserved_max_fd )); then",
  `  exit ${LINUX_BWRAP_DESCRIPTOR_SCRUBBER_FAILURE_STATUS}`,
  "fi",
  "chainless_sweep_fds() {",
  "  local chainless_fd_path chainless_fd",
  "  chainless_sweep_found=0",
  "  chainless_sweep_seen_executable=0",
  "  for chainless_fd_path in /proc/self/fd/*; do",
  // Bash's glob enumeration can briefly contribute its own now-stale procfs
  // entry. -L is a Bash builtin and distinguishes that closed entry without
  // opening another descriptor or following the descriptor's target.
  '    [[ -L "$chainless_fd_path" ]] || continue',
  '    chainless_fd="${chainless_fd_path##*/}"',
  '    case "$chainless_fd" in',
  `      ""|*[!0-9]*) exit ${LINUX_BWRAP_DESCRIPTOR_SCRUBBER_FAILURE_STATUS} ;;`,
  "    esac",
  "    if (( chainless_fd == chainless_executable_fd )); then",
  "      chainless_sweep_seen_executable=1",
  "    fi",
  "    if (( chainless_fd > chainless_preserved_max_fd )); then",
  "      chainless_sweep_found=1",
  // Bash's variable-fd close form handles descriptors above 9 without eval.
  `      exec {chainless_fd}>&- || exit ${LINUX_BWRAP_DESCRIPTOR_SCRUBBER_FAILURE_STATUS}`,
  "    fi",
  "  done",
  "  if (( chainless_sweep_seen_executable != 1 )); then",
  `    return ${LINUX_BWRAP_DESCRIPTOR_SCRUBBER_FAILURE_STATUS}`,
  "  fi",
  "}",
  `chainless_sweep_fds || exit ${LINUX_BWRAP_DESCRIPTOR_SCRUBBER_FAILURE_STATUS}`,
  `chainless_sweep_fds || exit ${LINUX_BWRAP_DESCRIPTOR_SCRUBBER_FAILURE_STATUS}`,
  'chainless_second_sweep_found="$chainless_sweep_found"',
  `chainless_sweep_fds || exit ${LINUX_BWRAP_DESCRIPTOR_SCRUBBER_FAILURE_STATUS}`,
  'chainless_third_sweep_found="$chainless_sweep_found"',
  "if (( chainless_second_sweep_found != 0 ||",
  "      chainless_third_sweep_found != 0 )); then",
  `  exit ${LINUX_BWRAP_DESCRIPTOR_SCRUBBER_FAILURE_STATUS}`,
  "fi",
  'exec /proc/self/fd/"$chainless_executable_fd" "$@"',
  `exit ${LINUX_BWRAP_DESCRIPTOR_SCRUBBER_FAILURE_STATUS}`,
].join("\n");

export const LINUX_BWRAP_DESCRIPTOR_SCRUBBER_SCRIPT_SHA256 = crypto
  .createHash("sha256")
  .update(LINUX_BWRAP_DESCRIPTOR_SCRUBBER_SCRIPT)
  .digest("hex");

const FIXED_PREFIX = Object.freeze([
  "--noprofile",
  "--norc",
  "-c",
  LINUX_BWRAP_DESCRIPTOR_SCRUBBER_SCRIPT,
  LINUX_BWRAP_DESCRIPTOR_SCRUBBER_ARGV0,
]);

function childFd(value) {
  return Number.isSafeInteger(value) && value >= 3 ? value : null;
}

function denseDataArraySnapshot(value) {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const lengthDescriptor = descriptors.length;
  if (
    !lengthDescriptor ||
    !("value" in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    Reflect.ownKeys(descriptors).length !== lengthDescriptor.value + 1
  ) {
    return null;
  }
  const snapshot = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor)) {
      return null;
    }
    snapshot.push(descriptor.value);
  }
  return Object.freeze(snapshot);
}

function ownDataDescriptorSnapshot(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !("value" in descriptors[key])) {
      return null;
    }
  }
  return descriptors;
}

function fixedEnvironmentSnapshot(value) {
  const descriptors = ownDataDescriptorSnapshot(value);
  if (
    !descriptors ||
    Reflect.ownKeys(descriptors).length !== 3 ||
    descriptors.PATH?.value !== "/usr/bin:/bin" ||
    descriptors.LANG?.value !== "C" ||
    descriptors.LC_ALL?.value !== "C"
  ) {
    return null;
  }
  return Object.freeze({
    PATH: descriptors.PATH.value,
    LANG: descriptors.LANG.value,
    LC_ALL: descriptors.LC_ALL.value,
  });
}

/** Build the exact Bash argv wrapper around a descriptor-backed executable. */
export function buildLinuxBwrapDescriptorScrubbedLaunch({
  scrubberChildFd,
  preservedMaxFd,
  executableChildFd,
  executableArgs,
}) {
  const executableArgsSnapshot = denseDataArraySnapshot(executableArgs);
  if (
    childFd(scrubberChildFd) === null ||
    childFd(preservedMaxFd) === null ||
    childFd(executableChildFd) === null ||
    scrubberChildFd !== preservedMaxFd + 1 ||
    executableChildFd > preservedMaxFd ||
    !executableArgsSnapshot ||
    !executableArgsSnapshot.every((value) => typeof value === "string")
  ) {
    throw new Error("linux_bwrap_descriptor_scrubber_layout_invalid");
  }
  return Object.freeze({
    command: `/proc/self/fd/${scrubberChildFd}`,
    args: Object.freeze([
      ...FIXED_PREFIX,
      String(preservedMaxFd),
      String(executableChildFd),
      ...executableArgsSnapshot,
    ]),
  });
}

/**
 * Parse only the current exact wrapper grammar. Direct legacy fd launches,
 * altered scripts/options, sparse layouts, and non-numeric fd arguments fail.
 */
export function parseLinuxBwrapDescriptorScrubbedLaunch(
  command,
  args,
  options,
  { activeStdioThrough = 2 } = {},
) {
  const argsSnapshot = denseDataArraySnapshot(args);
  const optionDescriptors = ownDataDescriptorSnapshot(options);
  const stdio = denseDataArraySnapshot(optionDescriptors?.stdio?.value);
  const callerEnvironment = fixedEnvironmentSnapshot(
    optionDescriptors?.env?.value,
  );
  if (
    !argsSnapshot ||
    !optionDescriptors ||
    optionDescriptors.shell?.value !== false ||
    (optionDescriptors.serialization &&
      optionDescriptors.serialization.value !== undefined) ||
    !stdio ||
    stdio.length < 5 ||
    !callerEnvironment
  ) {
    return null;
  }
  const optionsSnapshot = {};
  for (const key of Reflect.ownKeys(optionDescriptors)) {
    if (key === "stdio" || key === "env" || key === "shell") continue;
    Object.defineProperty(optionsSnapshot, key, {
      value: optionDescriptors[key].value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  Object.defineProperties(optionsSnapshot, {
    shell: {
      value: false,
      enumerable: true,
      configurable: true,
      writable: true,
    },
    stdio: {
      value: stdio,
      enumerable: true,
      configurable: true,
      writable: true,
    },
    env: {
      value: callerEnvironment,
      enumerable: true,
      configurable: true,
      writable: true,
    },
  });
  const scrubberChildFd = stdio.length - 1;
  const preservedMaxFd = scrubberChildFd - 1;
  if (
    !Number.isSafeInteger(activeStdioThrough) ||
    activeStdioThrough < 2 ||
    activeStdioThrough > preservedMaxFd
  ) {
    return null;
  }
  if (
    command !== `/proc/self/fd/${scrubberChildFd}` ||
    !Number.isInteger(stdio[scrubberChildFd]) ||
    argsSnapshot.length < FIXED_PREFIX.length + 2 ||
    !FIXED_PREFIX.every((value, index) => argsSnapshot[index] === value) ||
    argsSnapshot[FIXED_PREFIX.length] !== String(preservedMaxFd) ||
    !/^[1-9]\d*$/.test(argsSnapshot[FIXED_PREFIX.length + 1] || "")
  ) {
    return null;
  }
  const parentFds = new Set();
  let nodeIpcChildFd = null;
  for (let index = 3; index <= scrubberChildFd; index += 1) {
    if (!Object.hasOwn(stdio, index)) {
      return null;
    }
    const value = stdio[index];
    if (index <= activeStdioThrough) {
      if (value !== "pipe" && value !== "ipc") {
        return null;
      }
      if (value === "ipc") {
        if (nodeIpcChildFd !== null) return null;
        nodeIpcChildFd = index;
      }
      continue;
    }
    if (!Number.isSafeInteger(value) || value < 0 || parentFds.has(value)) {
      return null;
    }
    parentFds.add(value);
  }
  const executableChildFd = Number(argsSnapshot[FIXED_PREFIX.length + 1]);
  if (
    !Number.isSafeInteger(executableChildFd) ||
    String(executableChildFd) !== argsSnapshot[FIXED_PREFIX.length + 1] ||
    executableChildFd < 3 ||
    executableChildFd > preservedMaxFd ||
    !Number.isInteger(stdio[executableChildFd])
  ) {
    return null;
  }
  const executableArgs = Object.freeze([
    ...argsSnapshot.slice(FIXED_PREFIX.length + 2),
  ]);
  if (!executableArgs.every((value) => typeof value === "string")) {
    return null;
  }
  return Object.freeze({
    scrubberChildFd,
    preservedMaxFd,
    activeStdioThrough,
    nodeIpcChildFd,
    executableChildFd,
    executableArgs,
    launchArgs: argsSnapshot,
    options: Object.freeze(optionsSnapshot),
    stdio,
    callerEnvironment,
    shell: false,
    serialization: undefined,
  });
}

export function linuxBwrapDescriptorScrubberPolicyBinding(
  executableIdentity,
  layout,
) {
  const identitySnapshot = Object.freeze({
    path: executableIdentity?.path,
    fileId: Object.freeze({
      dev: String(executableIdentity?.fileId?.dev),
      ino: String(executableIdentity?.fileId?.ino),
    }),
    sha256: executableIdentity?.sha256,
    bytes: executableIdentity?.bytes,
    mtimeMs: executableIdentity?.mtimeMs,
    mode: executableIdentity?.mode,
    uid: executableIdentity?.uid,
    gid: executableIdentity?.gid,
  });
  return Object.freeze({
    kind: LINUX_BWRAP_DESCRIPTOR_SCRUBBER_KIND,
    mechanism: LINUX_BWRAP_DESCRIPTOR_SCRUBBER_MECHANISM,
    scriptSha256: LINUX_BWRAP_DESCRIPTOR_SCRUBBER_SCRIPT_SHA256,
    executableIdentity: identitySnapshot,
    executablePinned: true,
    argvFixed: true,
    callerEnvironmentFixed: true,
    nodeRuntimeEnvironmentInjection:
      layout.nodeIpcChildFd === null || layout.nodeIpcChildFd === undefined
        ? "none"
        : "node-child-process-exact-ipc-v1",
    nodeIpcChildFd: layout.nodeIpcChildFd ?? null,
    nodeIpcSerializationMode:
      layout.nodeIpcChildFd === null || layout.nodeIpcChildFd === undefined
        ? null
        : "json",
    procSelfFdPasses: LINUX_BWRAP_DESCRIPTOR_SCRUBBER_PASSES,
    closesUnknownInheritedDescriptors: true,
    verificationPassesFailClosed: true,
    policyBound: true,
    scrubberChildFd: layout.scrubberChildFd,
    preservedMaxFd: layout.preservedMaxFd,
    activeStdioThrough: layout.activeStdioThrough ?? 2,
    executableChildFd: layout.executableChildFd,
  });
}
