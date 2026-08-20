import { createHash } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TextDecoder } from "node:util";
import {
  EXECUTION_LOCATION_TARGET_ATTESTATION_SCHEMA,
  createExecutionLocationTargetAttestation,
  normalizeExecutionLocationBinding,
} from "./execution-location-contract.js";
import { containsSecret } from "./secret-scan.js";
import {
  sameFileStatIdentity,
  samePathHandleFileIdentity,
  withTrustedFileParentSync,
} from "./secure-file-identity.js";
import { canonicalJson } from "./scheduler-kernel/contract.js";
import { executionBroker } from "./process-execution-broker/index.js";
import {
  MAX_EXECUTION_LOCATION_RESULT_BUNDLE_BYTES,
  normalizeExecutionLocationResultBundle,
  verifyExecutionLocationResultBundle,
} from "./execution-location-result.js";

export const EXECUTION_LOCATION_PROFILE_SCHEMA =
  "cc-execution-location-profile/v1";
export { EXECUTION_LOCATION_TARGET_ATTESTATION_SCHEMA };
export const EXECUTION_LOCATION_TARGET_RESUME_SCHEMA =
  "cc-execution-location-target-resume/v1";
export const EXECUTION_LOCATION_TARGET_RESULT_COLLECTION_SCHEMA =
  "cc-execution-location-target-result-collection/v1";
export const EXECUTION_LOCATION_TARGET_RESULT_COLLECTION_REQUEST_SCHEMA =
  "cc-execution-location-target-result-collection-request/v1";

const SESSION_LOCATION_AUTHORITY_SCHEMA =
  "cc-session-execution-location-authority/v1";
const SESSION_LOCATION_HANDOFF_INSTALL_SCHEMA =
  "chainlesschain.session-execution-location-handoff-install/v1";
const PROFILE_TARGETS = new Set(["wsl", "ssh", "container"]);
const SESSION_STORE_MODES = new Set(["replicated", "shared"]);
const SHA256_RE = /^sha256:[a-f0-9]{64}$/u;
const COMMIT_RE = /^[a-f0-9]{40,64}$/u;
const MAX_PROFILE_BYTES = 1024 * 1024;
const MAX_PROBE_BYTES = 1024 * 1024;
const MAX_REPLICA_BYTES = 64 * 1024 * 1024;
const RESULT_MEDIA_TYPE_RE =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u;

function digest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update(canonicalJson(value, "executionLocationTarget"), "utf8")
    .digest("hex")}`;
}

function safeString(value, field, max = 4096) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > max ||
    [...value].some((character) => {
      const code = character.codePointAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw new TypeError(`${field} is invalid`);
  }
  return value;
}

function safeName(value, field, max = 256) {
  const normalized = safeString(value, field, max);
  if (
    normalized.startsWith("-") ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@+-]*$/u.test(normalized)
  ) {
    throw new TypeError(`${field} is invalid`);
  }
  return normalized;
}

function safePath(value, field) {
  const normalized = safeString(value, field);
  if (normalized.startsWith("-") || normalized.includes("\0")) {
    throw new TypeError(`${field} is invalid`);
  }
  return normalized;
}

function exactObject(value, fields, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((entry, index) => entry !== expected[index])
  ) {
    throw new TypeError(`${field} has an invalid schema`);
  }
  return value;
}

function normalizeTools(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    throw new TypeError("profile.expected.tools is invalid");
  }
  const tools = value.map((entry) => safeName(entry, "expected tool", 128));
  if (new Set(tools).size !== tools.length) {
    throw new TypeError("profile.expected.tools contains duplicates");
  }
  return tools.sort();
}

function normalizeSessionStore(value) {
  if (value == null) return null;
  const input = exactObject(
    value,
    ["mode", "targetSessionId", "headHash", "eventCount"],
    "profile.sessionStore",
  );
  const mode = safeName(input.mode, "profile.sessionStore.mode", 32);
  const targetSessionId = safeName(
    input.targetSessionId,
    "profile.sessionStore.targetSessionId",
  );
  const headHash = safeName(
    input.headHash,
    "profile.sessionStore.headHash",
    64,
  ).toLowerCase();
  const eventCount = Number(input.eventCount);
  if (
    !SESSION_STORE_MODES.has(mode) ||
    !/^[a-f0-9]{64}$/u.test(headHash) ||
    !Number.isSafeInteger(eventCount) ||
    eventCount < 1
  ) {
    throw new TypeError("profile.sessionStore is invalid");
  }
  return Object.freeze({ mode, targetSessionId, headHash, eventCount });
}

function normalizeTransport(target, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("profile.transport must be an object");
  }
  if (target === "wsl") {
    const input = exactObject(value, ["distro"], "profile.transport");
    return Object.freeze({
      distro: safeName(input.distro, "profile.transport.distro"),
    });
  }
  if (target === "container") {
    const input = exactObject(value, ["container"], "profile.transport");
    return Object.freeze({
      container: safeName(input.container, "profile.transport.container"),
    });
  }
  const allowed = new Set([
    "host",
    "user",
    "port",
    "identityFile",
    "knownHostsFile",
    "knownHostsDigest",
  ]);
  if (
    Object.keys(value).some((field) => !allowed.has(field)) ||
    ![
      "host",
      "user",
      "port",
      "identityFile",
      "knownHostsFile",
      "knownHostsDigest",
    ].every((field) => Object.hasOwn(value, field))
  ) {
    throw new TypeError("profile.transport has an invalid schema");
  }
  const host = safeName(value.host, "profile.transport.host");
  const user =
    value.user == null ? null : safeName(value.user, "profile.transport.user");
  const port = Number(value.port);
  const identityFile =
    value.identityFile == null
      ? null
      : path.resolve(
          safePath(value.identityFile, "profile.transport.identityFile"),
        );
  const knownHostsFile = path.resolve(
    safePath(value.knownHostsFile, "profile.transport.knownHostsFile"),
  );
  const knownHostsDigest = safeString(
    value.knownHostsDigest,
    "profile.transport.knownHostsDigest",
    80,
  ).toLowerCase();
  if (
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !SHA256_RE.test(knownHostsDigest)
  ) {
    throw new TypeError("profile.transport SSH authority is invalid");
  }
  return Object.freeze({
    host,
    user,
    port,
    identityFile,
    knownHostsFile,
    knownHostsDigest,
  });
}

export function normalizeExecutionLocationProfile(value) {
  const baseFields = [
    "schema",
    "id",
    "target",
    "evidenceId",
    "cliCommand",
    "cwd",
    "transport",
    "expected",
    "sessionStore",
  ];
  const suppliedDigest = value?.profileDigest;
  const input = exactObject(
    value,
    suppliedDigest == null ? baseFields : [...baseFields, "profileDigest"],
    "execution location profile",
  );
  if (input.schema !== EXECUTION_LOCATION_PROFILE_SCHEMA) {
    throw new TypeError(
      `execution location profile must use ${EXECUTION_LOCATION_PROFILE_SCHEMA}`,
    );
  }
  if (containsSecret(JSON.stringify(input))) {
    throw new TypeError(
      "execution location profile contains secret-shaped data",
    );
  }
  const target = safeName(input.target, "profile.target", 32).toLowerCase();
  if (!PROFILE_TARGETS.has(target)) {
    throw new TypeError(
      "profile.target is not supported by the target launcher",
    );
  }
  const expected = exactObject(
    input.expected,
    ["platform", "arch", "cliVersion", "gitCommit", "tools"],
    "profile.expected",
  );
  const gitCommit = safeName(
    expected.gitCommit,
    "profile.expected.gitCommit",
    64,
  ).toLowerCase();
  if (!COMMIT_RE.test(gitCommit)) {
    throw new TypeError("profile.expected.gitCommit is invalid");
  }
  const profile = {
    schema: EXECUTION_LOCATION_PROFILE_SCHEMA,
    id: safeName(input.id, "profile.id"),
    target,
    evidenceId: safeName(input.evidenceId, "profile.evidenceId"),
    cliCommand: safePath(input.cliCommand, "profile.cliCommand"),
    cwd: safePath(input.cwd, "profile.cwd"),
    transport: normalizeTransport(target, input.transport),
    expected: Object.freeze({
      platform: safeName(expected.platform, "profile.expected.platform", 64),
      arch: safeName(expected.arch, "profile.expected.arch", 64),
      cliVersion: safeName(
        expected.cliVersion,
        "profile.expected.cliVersion",
        64,
      ),
      gitCommit,
      tools: Object.freeze(normalizeTools(expected.tools)),
    }),
    sessionStore: normalizeSessionStore(input.sessionStore),
  };
  const profileDigest = digest(
    "chainlesschain.execution-location.profile.v1\0",
    profile,
  );
  if (suppliedDigest != null && suppliedDigest !== profileDigest) {
    throw new TypeError("execution location profile digest is invalid");
  }
  return Object.freeze({
    ...profile,
    profileDigest,
  });
}

function readBoundedRegularFile(filePath, maxBytes, label, runtimeFs = fs) {
  return withTrustedFileParentSync(
    runtimeFs,
    path.resolve(filePath),
    ({ canonicalPath, parentDevice }) => {
      const before = runtimeFs.lstatSync(canonicalPath, { bigint: true });
      if (
        before.isSymbolicLink() ||
        !before.isFile() ||
        Number(before.nlink) !== 1 ||
        Number(before.size) <= 0 ||
        Number(before.size) > maxBytes
      ) {
        throw new Error(
          `${label} must be a bounded, regular, single-link file`,
        );
      }
      let descriptor;
      try {
        descriptor = runtimeFs.openSync(
          canonicalPath,
          runtimeFs.constants.O_RDONLY |
            Number(runtimeFs.constants.O_NOFOLLOW || 0),
        );
        const opened = runtimeFs.fstatSync(descriptor, { bigint: true });
        if (
          !opened.isFile() ||
          Number(opened.nlink) !== 1 ||
          !samePathHandleFileIdentity(before, opened, parentDevice)
        ) {
          throw new Error(`${label} identity changed while opening`);
        }
        const bytes = runtimeFs.readFileSync(descriptor);
        const after = runtimeFs.fstatSync(descriptor, { bigint: true });
        if (
          bytes.length <= 0 ||
          bytes.length > maxBytes ||
          !sameFileStatIdentity(opened, after)
        ) {
          throw new Error(`${label} changed while reading`);
        }
        return bytes;
      } finally {
        if (descriptor !== undefined) runtimeFs.closeSync(descriptor);
      }
    },
  );
}

export function readExecutionLocationProfile(filePath, deps = {}) {
  const bytes = readBoundedRegularFile(
    filePath,
    MAX_PROFILE_BYTES,
    "execution location profile",
    deps.fs || fs,
  );
  let parsed;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    throw new Error("execution location profile is not strict UTF-8 JSON");
  }
  return normalizeExecutionLocationProfile(parsed);
}

function quotePosix(value) {
  return `'${String(value).replace(/'/gu, `'"'"'`)}'`;
}

function materializeKnownHostsAuthority(bytes, deps = {}) {
  const runtimeFs = deps.fs || fs;
  const root = runtimeFs.mkdtempSync(
    path.join(deps.tmpdir || tmpdir(), "cc-target-known-hosts-"),
  );
  const authorityPath = path.join(root, "known_hosts");
  let descriptor;
  try {
    descriptor = runtimeFs.openSync(
      authorityPath,
      runtimeFs.constants.O_CREAT |
        runtimeFs.constants.O_EXCL |
        runtimeFs.constants.O_WRONLY,
      0o600,
    );
    runtimeFs.writeFileSync(descriptor, bytes);
    runtimeFs.fsyncSync(descriptor);
  } catch (error) {
    try {
      runtimeFs.rmSync(root, { recursive: true, force: true });
    } catch {
      // Preserve the original materialization failure.
    }
    throw error;
  } finally {
    if (descriptor !== undefined) runtimeFs.closeSync(descriptor);
  }
  return Object.freeze({
    path: authorityPath,
    cleanup: () => runtimeFs.rmSync(root, { recursive: true, force: true }),
  });
}

function targetInvocation(profile, cliArgs, deps = {}, options = {}) {
  if (profile.target === "wsl") {
    if ((deps.platform || process.platform) !== "win32") {
      throw new Error("WSL target launch requires a Windows host");
    }
    return Object.freeze({
      file: "wsl.exe",
      args: Object.freeze([
        "--distribution",
        profile.transport.distro,
        "--cd",
        profile.cwd,
        "--exec",
        profile.cliCommand,
        ...cliArgs,
      ]),
      cleanup: null,
    });
  }
  if (profile.target === "container") {
    return Object.freeze({
      file: "docker",
      args: Object.freeze([
        "exec",
        ...(options.input == null ? [] : ["-i"]),
        "--workdir",
        profile.cwd,
        profile.transport.container,
        profile.cliCommand,
        ...cliArgs,
      ]),
      cleanup: null,
    });
  }
  const transport = profile.transport;
  const knownHostsBytes = readBoundedRegularFile(
    transport.knownHostsFile,
    MAX_PROFILE_BYTES,
    "SSH known-hosts authority",
    deps.fs || fs,
  );
  const actualKnownHostsDigest = `sha256:${createHash("sha256")
    .update(knownHostsBytes)
    .digest("hex")}`;
  if (actualKnownHostsDigest !== transport.knownHostsDigest) {
    throw new Error("SSH known-hosts authority digest mismatch");
  }
  const knownHostsAuthority = materializeKnownHostsAuthority(
    knownHostsBytes,
    deps,
  );
  const args = [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "NumberOfPasswordPrompts=0",
    "-o",
    "ConnectTimeout=10",
    "-o",
    `UserKnownHostsFile=${knownHostsAuthority.path}`,
    "-p",
    String(transport.port),
  ];
  if (transport.identityFile) {
    args.push("-o", "IdentitiesOnly=yes", "-i", transport.identityFile);
  }
  const target = transport.user
    ? `${transport.user}@${transport.host}`
    : transport.host;
  args.push(
    target,
    `cd ${quotePosix(profile.cwd)} && ${[profile.cliCommand, ...cliArgs]
      .map(quotePosix)
      .join(" ")}`,
  );
  return Object.freeze({
    file: "ssh",
    args: Object.freeze(args),
    cleanup: knownHostsAuthority.cleanup,
  });
}

function runTargetCommand(profile, cliArgs, deps = {}, options = {}) {
  const invocation = targetInvocation(profile, cliArgs, deps, options);
  const spawnSync =
    deps.spawnSync ||
    ((file, args, spawnOptions) =>
      executionBroker.spawnSync(file, args, spawnOptions));
  try {
    const maxBuffer = Number(options.maxBuffer ?? MAX_PROBE_BYTES);
    if (
      !Number.isSafeInteger(maxBuffer) ||
      maxBuffer < 1 ||
      maxBuffer > MAX_EXECUTION_LOCATION_RESULT_BUNDLE_BYTES
    ) {
      throw new Error("target command output boundary is invalid");
    }
    const result = spawnSync(invocation.file, invocation.args, {
      origin: "execution-location:target",
      scope: "execution-location",
      policy: "allow",
      shell: false,
      encoding: "utf8",
      timeout: options.interactive ? undefined : 30000,
      maxBuffer: options.interactive ? undefined : maxBuffer,
      ...(options.input == null ? {} : { input: options.input }),
      stdio: options.interactive
        ? "inherit"
        : [options.input == null ? "ignore" : "pipe", "pipe", "pipe"],
    });
    if (result?.error) throw result.error;
    if (!result || result.status !== 0) {
      const error = new Error(
        `target command failed with status ${result?.status ?? "unknown"}`,
      );
      error.code = "CC_EXECUTION_LOCATION_TARGET_COMMAND_FAILED";
      throw error;
    }
    return options.interactive ? null : result.stdout;
  } finally {
    invocation.cleanup?.();
  }
}

function parseTargetProjection(raw, label) {
  const bytes = Buffer.byteLength(String(raw || ""), "utf8");
  if (bytes <= 0 || bytes > MAX_PROBE_BYTES) {
    throw new Error(`${label} output is empty or exceeds its byte limit`);
  }
  let projection;
  try {
    projection = JSON.parse(String(raw));
  } catch {
    throw new Error(`${label} output is not one exact JSON object`);
  }
  if (
    !projection ||
    typeof projection !== "object" ||
    Array.isArray(projection) ||
    containsSecret(JSON.stringify(projection))
  ) {
    throw new Error(`${label} output is invalid or secret-bearing`);
  }
  return projection;
}

function validateProfileHandoff(profile, handoff) {
  if (!handoff?.allowed) {
    throw new Error("execution location handoff is not allowed");
  }
  if (
    handoff.target?.location !== profile.target ||
    handoff.target?.evidenceId !== profile.evidenceId
  ) {
    throw new Error("execution location profile does not match handoff target");
  }
  if (
    handoff.transfer?.git?.baseCommit !== profile.expected.gitCommit ||
    handoff.target?.dataBoundary?.root !== profile.cwd
  ) {
    throw new Error("execution location profile source or boundary drifted");
  }
  if (profile.sessionStore) {
    if (
      profile.sessionStore.targetSessionId !== handoff.session?.sessionId ||
      profile.sessionStore.headHash !== handoff.session?.headHash ||
      profile.sessionStore.eventCount !== handoff.session?.eventCount
    ) {
      throw new Error("target session-store authority does not match handoff");
    }
  }
}

function validateCurrentProjection(profile, rawProjection) {
  if (
    rawProjection.schema !== SESSION_LOCATION_AUTHORITY_SCHEMA ||
    rawProjection.authority !== "current-process-observation"
  ) {
    throw new Error("target current-location projection has invalid authority");
  }
  const binding = normalizeExecutionLocationBinding(rawProjection.binding);
  const expected = profile.expected;
  const missingTools = expected.tools.filter(
    (tool) => !binding.runtime.tools.includes(tool),
  );
  if (
    binding.observed !== true ||
    binding.location !== profile.target ||
    binding.source.cwd !== profile.cwd ||
    binding.source.git.commit !== expected.gitCommit ||
    binding.runtime.platform !== expected.platform ||
    binding.runtime.arch !== expected.arch ||
    binding.runtime.cliVersion !== expected.cliVersion ||
    missingTools.length > 0
  ) {
    throw new Error("target current-location facts do not match the profile");
  }
  return binding;
}

export function attestExecutionLocationTarget(input = {}, deps = {}) {
  const profile = normalizeExecutionLocationProfile(input.profile);
  validateProfileHandoff(profile, input.handoff);
  const raw = runTargetCommand(
    profile,
    ["session", "location", "current", "--json"],
    deps,
  );
  const current = parseTargetProjection(raw, "target current-location probe");
  const binding = validateCurrentProjection(profile, current);
  return createExecutionLocationTargetAttestation({
    profileDigest: profile.profileDigest,
    sourceSessionId: input.handoff.session.sessionId,
    sourceHeadHash: input.handoff.session.headHash,
    sourceEventCount: input.handoff.session.eventCount,
    targetEvidenceId: input.handoff.target.evidenceId,
    baseCommit: input.handoff.transfer.git.baseCommit,
    binding,
  });
}

function verifyTargetSessionStore(
  profile,
  handoff,
  transfer,
  attestation,
  deps,
) {
  if (!profile.sessionStore) {
    throw new Error("target session-store authority is required for resume");
  }
  const raw = runTargetCommand(
    profile,
    [
      "session",
      "location",
      "show",
      profile.sessionStore.targetSessionId,
      "--json",
    ],
    deps,
  );
  const projection = parseTargetProjection(raw, "target session-store probe");
  const commonMatches =
    projection.schema === SESSION_LOCATION_AUTHORITY_SCHEMA &&
    projection.sessionId === profile.sessionStore.targetSessionId &&
    projection.sessionId === handoff.session.sessionId;
  const replicatedMatches =
    profile.sessionStore.mode === "replicated" &&
    projection.authority === "verified-session-location-handoff" &&
    projection.headHash === transfer.targetHeadHash &&
    projection.eventCount === transfer.targetEventCount &&
    projection.bindingEventHash === transfer.targetHeadHash &&
    projection.bindingEventCount === transfer.targetEventCount &&
    projection.locationHandoff?.handoffId === transfer.handoffId &&
    projection.locationHandoff?.source?.sessionId ===
      handoff.session.sessionId &&
    projection.locationHandoff?.source?.headHash === handoff.session.headHash &&
    projection.locationHandoff?.source?.eventCount ===
      handoff.session.eventCount &&
    projection.locationHandoff?.source?.transcriptDigest ===
      transfer.transcriptDigest &&
    projection.locationHandoff?.target?.profileDigest ===
      profile.profileDigest &&
    projection.locationHandoff?.target?.targetEvidenceId ===
      profile.evidenceId &&
    projection.locationHandoff?.target?.targetFactsDigest ===
      attestation.targetFactsDigest &&
    projection.locationHandoff?.target?.attestationDigest ===
      transfer.attestationDigest;
  const sharedMatches =
    profile.sessionStore.mode === "shared" &&
    projection.authority === "verified-session-start" &&
    projection.headHash === profile.sessionStore.headHash &&
    projection.eventCount === profile.sessionStore.eventCount &&
    projection.headHash === handoff.session.headHash &&
    projection.eventCount === handoff.session.eventCount;
  if (!commonMatches || (!replicatedMatches && !sharedMatches)) {
    throw new Error(
      "target canonical session authority does not match handoff",
    );
  }
  return Object.freeze({
    mode: profile.sessionStore.mode,
    sessionId: projection.sessionId,
    headHash: projection.headHash,
    eventCount: projection.eventCount,
    authority: projection.authority,
    handoffId: projection.locationHandoff?.handoffId ?? null,
  });
}

function transferTargetSessionStore(
  profile,
  handoff,
  attestation,
  transcriptInput,
  deps,
) {
  if (!profile.sessionStore) {
    throw new Error("target session-store authority is required for resume");
  }
  if (profile.sessionStore.mode === "shared") {
    return Object.freeze({
      mode: "shared",
      performed: false,
      installed: false,
      transcriptDigest: null,
      receiptDigest: null,
      handoffId: null,
      targetHeadHash: handoff.session.headHash,
      targetEventCount: handoff.session.eventCount,
      attestationDigest: null,
    });
  }
  const transcriptBytes = Buffer.isBuffer(transcriptInput)
    ? transcriptInput
    : Buffer.from(transcriptInput || "");
  if (transcriptBytes.length === 0) {
    throw new Error("source transcript bytes are required for replication");
  }
  if (transcriptBytes.length > MAX_REPLICA_BYTES) {
    throw new Error(
      `source transcript exceeds ${MAX_REPLICA_BYTES} replica bytes`,
    );
  }
  const transcriptDigest = `sha256:${createHash("sha256")
    .update(transcriptBytes)
    .digest("hex")}`;
  const raw = runTargetCommand(
    profile,
    [
      "session",
      "location",
      "prepare",
      profile.sessionStore.targetSessionId,
      "--expected-head-hash",
      handoff.session.headHash,
      "--expected-event-count",
      String(handoff.session.eventCount),
      "--expected-transcript-digest",
      transcriptDigest,
      "--expected-target-facts-digest",
      attestation.targetFactsDigest,
      "--profile-digest",
      profile.profileDigest,
      "--target-evidence-id",
      profile.evidenceId,
      "--attestation-digest",
      attestation.attestationDigest,
      "--json",
    ],
    deps,
    { input: transcriptBytes },
  );
  const receipt = parseTargetProjection(
    raw,
    "target session location-handoff receipt",
  );
  exactObject(
    receipt,
    [
      "schema",
      "sessionId",
      "sourceHeadHash",
      "sourceEventCount",
      "transcriptDigest",
      "handoffId",
      "targetHeadHash",
      "targetEventCount",
      "targetFactsDigest",
      "profileDigest",
      "targetEvidenceId",
      "attestationDigest",
      "replicaInstalled",
      "handoffAppended",
      "receiptDigest",
    ],
    "target session location-handoff receipt",
  );
  const receiptMaterial = {
    schema: SESSION_LOCATION_HANDOFF_INSTALL_SCHEMA,
    sessionId: handoff.session.sessionId,
    sourceHeadHash: handoff.session.headHash,
    sourceEventCount: handoff.session.eventCount,
    transcriptDigest,
    handoffId: receipt.handoffId,
    targetHeadHash: receipt.targetHeadHash,
    targetEventCount: handoff.session.eventCount + 1,
    targetFactsDigest: attestation.targetFactsDigest,
    profileDigest: profile.profileDigest,
    targetEvidenceId: profile.evidenceId,
    attestationDigest: receipt.attestationDigest,
    replicaInstalled: receipt.replicaInstalled,
    handoffAppended: receipt.handoffAppended,
  };
  const expectedReceiptDigest = digest(
    "chainlesschain.session-execution-location-handoff-install.v1\0",
    receiptMaterial,
  );
  if (
    receipt.schema !== receiptMaterial.schema ||
    receipt.sessionId !== receiptMaterial.sessionId ||
    receipt.sourceHeadHash !== receiptMaterial.sourceHeadHash ||
    receipt.sourceEventCount !== receiptMaterial.sourceEventCount ||
    receipt.transcriptDigest !== receiptMaterial.transcriptDigest ||
    !SHA256_RE.test(receipt.handoffId || "") ||
    !/^[a-f0-9]{64}$/u.test(receipt.targetHeadHash || "") ||
    receipt.targetEventCount !== receiptMaterial.targetEventCount ||
    receipt.targetFactsDigest !== receiptMaterial.targetFactsDigest ||
    receipt.profileDigest !== receiptMaterial.profileDigest ||
    receipt.targetEvidenceId !== receiptMaterial.targetEvidenceId ||
    // Target prepare records a fresh observedAt, so its attestation digest is
    // expected to differ from the earlier source-side probe. The receipt is
    // rehashed here and the next target `location show` validates that digest
    // against the canonical handoff binding before resume.
    !SHA256_RE.test(receipt.attestationDigest || "") ||
    typeof receipt.replicaInstalled !== "boolean" ||
    typeof receipt.handoffAppended !== "boolean" ||
    receipt.receiptDigest !== expectedReceiptDigest
  ) {
    throw new Error(
      "target session location-handoff receipt does not match source",
    );
  }
  return Object.freeze({
    mode: "replicated",
    performed: true,
    installed: receipt.replicaInstalled,
    handoffAppended: receipt.handoffAppended,
    transcriptDigest,
    handoffId: receipt.handoffId,
    targetHeadHash: receipt.targetHeadHash,
    targetEventCount: receipt.targetEventCount,
    attestationDigest: receipt.attestationDigest,
    receiptDigest: receipt.receiptDigest,
  });
}

function verifySourceAuthorityBeforeResume(handoff, readSourceAuthority) {
  if (typeof readSourceAuthority !== "function") {
    throw new Error("source authority revalidation is required before resume");
  }
  const current = readSourceAuthority();
  if (
    current?.sessionId !== handoff.session?.sessionId ||
    current?.headHash !== handoff.session?.headHash ||
    current?.eventCount !== handoff.session?.eventCount
  ) {
    throw new Error("source session authority changed before target resume");
  }
  return Object.freeze({
    sessionId: current.sessionId,
    headHash: current.headHash,
    eventCount: current.eventCount,
  });
}

function normalizeResultCollectionItem(entry, label) {
  const mediaType = String(entry?.mediaType || "").toLowerCase();
  const filePath = safePath(entry?.path, `${label} path`);
  if (!RESULT_MEDIA_TYPE_RE.test(mediaType)) {
    throw new TypeError(`${label} media type is invalid`);
  }
  return { mediaType, path: filePath };
}

export function createExecutionLocationTargetResultCollectionRequest(
  input = {},
) {
  const profile = normalizeExecutionLocationProfile(input.profile);
  const target = safeName(
    input.target ?? profile.target,
    "result collection target",
    32,
  );
  if (target !== profile.target) {
    throw new TypeError("result collection target does not match profile");
  }
  const requestId = safeName(
    input.requestId,
    "result collection request id",
    128,
  );
  const sessionId = safeName(input.sessionId, "result collection session id");
  const resultId = safeName(input.resultId, "result id", 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(resultId)) {
    throw new TypeError("result id is invalid");
  }
  const targetFactsDigest = String(
    input.expectedTargetFactsDigest || "",
  ).toLowerCase();
  const handoffId = String(input.expectedHandoffId || "").toLowerCase();
  if (!SHA256_RE.test(targetFactsDigest)) {
    throw new TypeError("expected target facts digest is invalid");
  }
  if (!SHA256_RE.test(handoffId)) {
    throw new TypeError("expected result handoff id is invalid");
  }
  const artifacts = (input.artifacts ?? []).map((entry, index) =>
    normalizeResultCollectionItem(entry, `result artifact ${index}`),
  );
  const evidence = (input.evidence ?? []).map((entry, index) =>
    normalizeResultCollectionItem(entry, `result evidence ${index}`),
  );
  if (artifacts.length + evidence.length > 64) {
    throw new TypeError("result collection item list is invalid");
  }
  const material = {
    schema: EXECUTION_LOCATION_TARGET_RESULT_COLLECTION_REQUEST_SCHEMA,
    requestId,
    sessionId,
    target,
    profileDigest: profile.profileDigest,
    targetFactsDigest,
    handoffId,
    resultId,
    summaryPath: safePath(input.summaryPath, "result summary path"),
    diffPath: safePath(input.diffPath, "result diff path"),
    artifacts,
    evidence,
  };
  return Object.freeze({
    ...material,
    requestDigest: digest(
      "chainlesschain.execution-location.target-result-collection-request.v1\0",
      material,
    ),
  });
}

export function collectExecutionLocationTargetResult(input = {}, deps = {}) {
  const profile = normalizeExecutionLocationProfile(input.profile);
  validateProfileHandoff(profile, input.handoff);
  const expectedTargetFactsDigest = safeString(
    input.expectedTargetFactsDigest,
    "expected target facts digest",
    80,
  ).toLowerCase();
  if (!SHA256_RE.test(expectedTargetFactsDigest)) {
    throw new Error("expected target facts digest is invalid");
  }
  const sourceBefore = verifySourceAuthorityBeforeResume(
    input.handoff,
    input.readSourceAuthority,
  );
  const attestation = attestExecutionLocationTarget(
    { profile, handoff: input.handoff },
    deps,
  );
  if (attestation.targetFactsDigest !== expectedTargetFactsDigest) {
    throw new Error("target facts digest changed before result collection");
  }
  const resultId = safeName(input.resultId, "result id", 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(resultId)) {
    throw new TypeError("result id is invalid");
  }
  const expectedHandoffId = String(input.expectedHandoffId || "");
  if (!SHA256_RE.test(expectedHandoffId)) {
    throw new TypeError("expected result handoff id is invalid");
  }
  const summaryPath = safePath(input.summaryPath, "result summary path");
  const diffPath = safePath(input.diffPath, "result diff path");
  const artifactInput = input.artifacts ?? [];
  const evidenceInput = input.evidence ?? [];
  if (!Array.isArray(artifactInput) || !Array.isArray(evidenceInput)) {
    throw new TypeError("result collection item list is invalid");
  }
  const artifacts = artifactInput.map((entry, index) =>
    normalizeResultCollectionItem(entry, `result artifact ${index}`),
  );
  const evidence = evidenceInput.map((entry, index) =>
    normalizeResultCollectionItem(entry, `result evidence ${index}`),
  );
  if (artifacts.length + evidence.length > 64) {
    throw new TypeError("result collection item list is invalid");
  }
  const request = createExecutionLocationTargetResultCollectionRequest({
    requestId: input.requestId,
    sessionId: input.handoff?.session?.sessionId,
    target: profile.target,
    profile,
    expectedTargetFactsDigest,
    expectedHandoffId,
    resultId,
    summaryPath,
    diffPath,
    artifacts,
    evidence,
  });
  const args = [
    "session",
    "location",
    "result-pack",
    input.handoff.session.sessionId,
    "--result-id",
    resultId,
    "--summary",
    summaryPath,
    "--diff",
    diffPath,
  ];
  for (const entry of artifacts) {
    args.push("--artifact", `${entry.mediaType}=${entry.path}`);
  }
  for (const entry of evidence) {
    args.push("--evidence", `${entry.mediaType}=${entry.path}`);
  }
  args.push("--json");
  const raw = runTargetCommand(profile, args, deps, {
    maxBuffer: MAX_EXECUTION_LOCATION_RESULT_BUNDLE_BYTES,
  });
  let bundleInput;
  try {
    bundleInput = JSON.parse(String(raw));
  } catch {
    throw new Error("target result bundle output is not one exact JSON object");
  }
  const bundle = normalizeExecutionLocationResultBundle(bundleInput);
  const sourceAfter = verifySourceAuthorityBeforeResume(
    input.handoff,
    input.readSourceAuthority,
  );
  const verification = verifyExecutionLocationResultBundle({
    bundle,
    sourceAuthority: sourceAfter,
    expectedHandoffId,
  });
  if (
    bundle.session.handoffId !== expectedHandoffId ||
    bundle.session.target.profileDigest !== profile.profileDigest ||
    bundle.session.target.targetEvidenceId !== profile.evidenceId ||
    bundle.session.target.targetFactsDigest !== expectedTargetFactsDigest ||
    sourceBefore.headHash !== sourceAfter.headHash ||
    sourceBefore.eventCount !== sourceAfter.eventCount
  ) {
    throw new Error(
      "target result bundle does not match the accepted handoff authority",
    );
  }
  const material = {
    schema: EXECUTION_LOCATION_TARGET_RESULT_COLLECTION_SCHEMA,
    requestId: request.requestId,
    requestDigest: request.requestDigest,
    resultId,
    target: profile.target,
    profileDigest: profile.profileDigest,
    targetFactsDigest: expectedTargetFactsDigest,
    collectionAttestationDigest: attestation.attestationDigest,
    handoffId: bundle.session.handoffId,
    sourceAuthority: sourceAfter,
    targetHeadHash: bundle.session.target.headHash,
    targetEventCount: bundle.session.target.eventCount,
    bundleDigest: bundle.bundleDigest,
    verificationDigest: verification.verificationDigest,
    applied: false,
    continuity: "single-fixed-command-response",
    gaps: [
      "returned-result-bytes-not-durable",
      "cross-host-concurrent-writer-fencing-not-durable",
      "returned-result-not-applied",
    ],
  };
  return Object.freeze({
    ...material,
    bundle,
    verification,
    collectionDigest: digest(
      "chainlesschain.execution-location.target-result-collection.v1\0",
      material,
    ),
  });
}

export function resumeExecutionLocationTarget(input = {}, deps = {}) {
  const profile = normalizeExecutionLocationProfile(input.profile);
  validateProfileHandoff(profile, input.handoff);
  const attestation = attestExecutionLocationTarget(
    { profile, handoff: input.handoff },
    deps,
  );
  const expectedTargetFactsDigest = safeString(
    input.expectedTargetFactsDigest,
    "expected target facts digest",
    80,
  ).toLowerCase();
  if (
    !SHA256_RE.test(expectedTargetFactsDigest) ||
    expectedTargetFactsDigest !== attestation.targetFactsDigest
  ) {
    throw new Error("target facts digest changed before resume");
  }
  const transfer = transferTargetSessionStore(
    profile,
    input.handoff,
    attestation,
    input.transcriptBytes,
    deps,
  );
  const sessionStore = verifyTargetSessionStore(
    profile,
    input.handoff,
    transfer,
    attestation,
    deps,
  );
  const sourceAuthority = verifySourceAuthorityBeforeResume(
    input.handoff,
    input.readSourceAuthority,
  );
  runTargetCommand(
    profile,
    ["session", "resume", sessionStore.sessionId],
    deps,
    { interactive: true },
  );
  const material = {
    schema: EXECUTION_LOCATION_TARGET_RESUME_SCHEMA,
    profileDigest: profile.profileDigest,
    attestationDigest: attestation.attestationDigest,
    target: profile.target,
    targetEvidenceId: profile.evidenceId,
    sourceAuthority,
    sessionStore: { ...sessionStore, transfer },
    command: "session-resume",
    exitStatus: 0,
    continuity: "target-process-lifetime",
    gaps: [
      "disconnect-reconnect-not-durable",
      "cross-host-concurrent-writer-fencing-not-durable",
      ...(profile.sessionStore.mode === "shared"
        ? ["shared-session-location-handoff-event-not-anchored"]
        : []),
    ],
  };
  return Object.freeze({
    ...material,
    receiptDigest: digest(
      "chainlesschain.execution-location.target-resume.v1\0",
      material,
    ),
  });
}
