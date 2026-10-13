#!/usr/bin/env node
// Observe the existing session-message soak. Local snapshots never become
// VERIFY01 task observations, public-host acceptance, or release evidence.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout } from "node:timers/promises";
import { parseArgs } from "node:util";
import { atomicWriteJson } from "./diagnostics/bounded-atomic-json.mjs";

const atomicHelperPath = fileURLToPath(
  new URL("./diagnostics/bounded-atomic-json.mjs", import.meta.url),
);
const atomicHelperDigest = () =>
  `sha256:${crypto.createHash("sha256").update(fs.readFileSync(atomicHelperPath)).digest("hex")}`;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}
export function digest(value) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex")}`;
}
function requireFact(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}
export function validateSnapshot(
  report,
  binding,
  { now = Date.now(), validateCompleted } = {},
) {
  requireFact(
    report?.schema === "chainlesschain.session-message-reliability-soak/v1",
    "SCHEMA_INVALID",
  );
  const subject = structuredClone(report);
  delete subject.evidenceDigest;
  requireFact(
    report.evidenceDigest === digest(subject),
    "EVIDENCE_DIGEST_INVALID",
  );
  requireFact(["running", "passed"].includes(report.status), "WORKLOAD_FAILED");
  requireFact(
    report.releaseCommit === binding.sourceCommit &&
      report.headSha === binding.sourceCommit &&
      report.expectedSha === binding.sourceCommit &&
      report.exactShaVerified === true,
    "SOURCE_IDENTITY_INVALID",
  );
  requireFact(
    report.source?.clean === true && report.source.changeCount === 0,
    "SOURCE_NOT_CLEAN",
  );
  requireFact(
    report.runner?.platform === binding.platform &&
      report.runner.architecture === binding.architecture &&
      report.runner.nodeVersion === binding.nodeVersion &&
      report.runner.operatingSystem ===
        (binding.platform === "win32" ? "windows" : "linux"),
    "RUNTIME_IDENTITY_INVALID",
  );
  requireFact(
    report.qualifyingEvidence === false &&
      report.execution?.provider === "local",
    "LOCAL_SCOPE_REQUIRED",
  );
  requireFact(
    report.profile?.mode === "formal" &&
      report.profile.durationSeconds === 86_400,
    "PROFILE_INVALID",
  );
  requireFact(
    report.startedAt === binding.reportStartedAt,
    "START_IDENTITY_INVALID",
  );
  const started = Date.parse(report.startedAt);
  const checkpoint = Date.parse(
    report.status === "passed" ? report.completedAt : report.checkpointedAt,
  );
  requireFact(
    Number.isFinite(started) &&
      Number.isFinite(checkpoint) &&
      started <= checkpoint &&
      checkpoint <= now + 1_000,
    "CHECKPOINT_TIME_INVALID",
  );
  requireFact(now - checkpoint <= 90_000, "STALE_CHECKPOINT");
  requireFact(
    Number.isFinite(report.continuousDurationSeconds) &&
      report.continuousDurationSeconds >= 0 &&
      report.continuousDurationSeconds <= (checkpoint - started) / 1_000 + 5,
    "DURATION_INVALID",
  );
  requireFact(
    Array.isArray(report.violations) && report.violations.length === 0,
    "WORKLOAD_VIOLATIONS",
  );
  const cycles = report.totals?.cycles;
  requireFact(
    Number.isSafeInteger(cycles) &&
      cycles >= 0 &&
      report.totals.lostMessages === 0 &&
      report.totals.duplicateEffects === 0 &&
      report.totals.custodyDuplicateEffects === 0 &&
      report.totals.invariantViolations === 0,
    "WORKLOAD_TOTALS_INVALID",
  );
  if (report.status === "passed") {
    requireFact(
      report.continuousDurationSeconds >= 86_400 &&
        report.completedAt &&
        report.source.finalClean === true &&
        report.source.finalChangeCount === 0,
      "COMPLETION_INCOMPLETE",
    );
    requireFact(
      typeof validateCompleted === "function",
      "FINAL_VALIDATOR_REQUIRED",
    );
    validateCompleted(report, {
      releaseCommit: binding.sourceCommit,
      requireQualifying: false,
    });
  }
  return {
    checkpoint,
    started,
    cycles,
    evidenceDigest: report.evidenceDigest,
    bindingDigest: digest(binding),
    originalLaunchProofComplete: binding.originalLaunchProofComplete === true,
  };
}

export function validateProcessProof(binding, proof) {
  requireFact(
    proof &&
      proof.processId === binding.processId &&
      proof.startIdentity === binding.startIdentity &&
      proof.executable === binding.executable &&
      proof.commandDigest === binding.commandDigest &&
      proof.bootIdentity === binding.bootIdentity,
    "PROCESS_IDENTITY_INVALID",
  );
}

export function advanceObservation(
  previous,
  report,
  checked,
  { now = Date.now() } = {},
) {
  if (previous) {
    requireFact(
      previous.schema === "chainlesschain.local-soak-watcher-state/v2" &&
        ["MONITORING", "WORKLOAD_REPORT_VALIDATED_NONQUALIFYING"].includes(
          previous.status,
        ),
      "PREVIOUS_OBSERVATION_REJECTED",
    );
    requireFact(
      previous.bindingDigest === checked.bindingDigest,
      "BINDING_CHANGED",
    );
    requireFact(
      now >= Date.parse(previous.observedAt) &&
        checked.checkpoint >= previous.lastCheckpoint &&
        report.continuousDurationSeconds >=
          previous.continuousDurationSeconds &&
        checked.cycles >= previous.cycles,
      "OBSERVATION_REGRESSION",
    );
    requireFact(
      checked.checkpoint !== previous.lastCheckpoint ||
        checked.evidenceDigest === previous.lastEvidenceDigest,
      "CHECKPOINT_REWRITTEN",
    );
    requireFact(
      previous.status !== "WORKLOAD_REPORT_VALIDATED_NONQUALIFYING" ||
        (report.status === "passed" &&
          checked.evidenceDigest === previous.lastEvidenceDigest),
      "COMPLETED_REPORT_CHANGED",
    );
  }
  const gaps = [...(previous?.gaps || [])];
  if (
    previous &&
    Math.max(
      now - Date.parse(previous.observedAt),
      checked.checkpoint - previous.lastCheckpoint,
    ) > 120_000
  ) {
    gaps.push({
      from: previous.observedAt,
      to: new Date(now).toISOString(),
      reason: "observer or workload checkpoint gap",
    });
  }
  const prefix =
    previous?.unmonitoredPrefixSeconds ??
    Math.max(0, (now - checked.started) / 1_000);
  return {
    schema: "chainlesschain.local-soak-watcher-state/v2",
    status:
      report.status === "passed"
        ? "WORKLOAD_REPORT_VALIDATED_NONQUALIFYING"
        : "MONITORING",
    scope: "supplementary local engineering observation",
    formalHostAcceptance: false,
    observationsCreated: false,
    processExitVerified: false,
    observerStartedAt:
      previous?.observerStartedAt || new Date(now).toISOString(),
    observedAt: new Date(now).toISOString(),
    bindingDigest: checked.bindingDigest,
    lastCheckpoint: checked.checkpoint,
    lastEvidenceDigest: checked.evidenceDigest,
    continuousDurationSeconds: report.continuousDurationSeconds,
    cycles: checked.cycles,
    unmonitoredPrefixSeconds: prefix,
    gaps,
    monitoringCompleteFromLaunch:
      checked.originalLaunchProofComplete && prefix === 0 && gaps.length === 0,
    milestonesRecorded: previous?.milestonesRecorded || [],
  };
}

export function runJson(
  executable,
  args,
  { kind = "process-query", execute = spawnSync, clock = Date.now } = {},
) {
  const started = clock();
  const result = execute(executable, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 256 * 1024,
  });
  function reject(failureKind, error = result.error) {
    const finished = clock();
    const byteDigest = (value) =>
      `sha256:${crypto
        .createHash("sha256")
        .update(value || "")
        .digest("hex")}`;
    throw Object.assign(new Error("PROCESS_PROOF_UNAVAILABLE"), {
      code: "PROCESS_PROOF_UNAVAILABLE",
      processProofFailure: {
        commandKind: kind,
        executable,
        failureKind,
        startedAt: new Date(started).toISOString(),
        finishedAt: new Date(finished).toISOString(),
        elapsedMs: finished - started,
        timeoutMs: 15_000,
        exitCode: result.status ?? null,
        signal: result.signal ?? null,
        errorCode: error?.code || null,
        errorMessage: error?.message?.slice(0, 500) || null,
        stdoutByteDigest: byteDigest(result.stdout),
        stderrByteDigest: byteDigest(result.stderr),
        stderrExcerpt: String(result.stderr || "").slice(0, 4096),
        stderrTruncated: String(result.stderr || "").length > 4096,
      },
    });
  }
  if (result.error || result.signal || result.status !== 0)
    reject("SUBPROCESS_FAILED");
  try {
    return JSON.parse(result.stdout.replace(/^\uFEFF/u, ""));
  } catch (error) {
    reject("INVALID_JSON", error);
  }
}
export function readWindowsNativeProcessProof(
  binding,
  { executable, executableDigest, sourceDigest },
  { query = runJson } = {},
) {
  requireFact(
    binding.platform === "win32" &&
      Number.isSafeInteger(binding.processId) &&
      binding.processId > 0 &&
      path.isAbsolute(executable || "") &&
      /^sha256:[a-f0-9]{64}$/u.test(executableDigest || "") &&
      /^sha256:[a-f0-9]{64}$/u.test(sourceDigest || ""),
    "NATIVE_PROOF_PIN_REQUIRED",
  );
  const verifyBytes = () => {
    const stat = fs.lstatSync(executable);
    requireFact(
      stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.nlink === 1 &&
        stat.size > 0 &&
        stat.size <= 2 * 1024 * 1024,
      "NATIVE_PROOF_FILE_INVALID",
    );
    requireFact(
      `sha256:${crypto.createHash("sha256").update(fs.readFileSync(executable)).digest("hex")}` ===
        executableDigest,
      "NATIVE_PROOF_BINARY_CHANGED",
    );
  };
  verifyBytes();
  const result = query(executable, [String(binding.processId)], {
    kind: "windows-native-single-handle",
  });
  verifyBytes();
  requireFact(
    result?.schema === "chainlesschain.windows-process-proof/v1" &&
      result.sourceDigest === sourceDigest &&
      result.aliveBefore === true &&
      result.aliveAfter === true &&
      result.processId === binding.processId &&
      typeof result.commandLine === "string" &&
      result.commandLine.length > 0 &&
      result.commandLine.length <= 65536 &&
      /^\d+$/u.test(result.startIdentity || "") &&
      typeof result.executable === "string" &&
      path.isAbsolute(result.executable) &&
      result.bootIdentity === "windows-process-start",
    "NATIVE_PROOF_REPORT_INVALID",
  );
  return {
    processId: result.processId,
    startIdentity: result.startIdentity,
    executable: result.executable,
    commandDigest: digest(result.commandLine),
    bootIdentity: result.bootIdentity,
  };
}
export function readProcessProof(binding, { windowsNativeProof } = {}) {
  requireFact(
    Number.isSafeInteger(binding.processId) && binding.processId > 0,
    "PROCESS_ID_INVALID",
  );
  if (binding.platform === "win32") {
    if (windowsNativeProof)
      return readWindowsNativeProcessProof(binding, windowsNativeProof);
    const command = `$p=Get-Process -Id ${binding.processId} -ErrorAction Stop; $c=Get-CimInstance Win32_Process -Filter 'ProcessId=${binding.processId}' -ErrorAction Stop; [ordered]@{processId=$p.Id;startIdentity=$p.StartTime.ToUniversalTime().Ticks.ToString();executable=$p.Path;commandLine=$c.CommandLine;bootIdentity='windows-process-start'} | ConvertTo-Json -Compress`;
    const result = runJson(
      path.join(
        process.env.SystemRoot || "C:\\Windows",
        "System32/WindowsPowerShell/v1.0/powershell.exe",
      ),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
      { kind: "windows-process-and-cim" },
    );
    result.commandDigest = digest(result.commandLine);
    delete result.commandLine;
    return result;
  }
  requireFact(binding.platform === "linux", "PLATFORM_UNSUPPORTED");
  const code = `import pathlib,json,hashlib; p=pathlib.Path('/proc/${binding.processId}'); s=(p/'stat').read_text().rsplit(')',1)[1].split(); print(json.dumps({'processId':${binding.processId},'startIdentity':s[19],'executable':str((p/'exe').resolve()),'commandDigest':'sha256:'+hashlib.sha256((p/'cmdline').read_bytes()).hexdigest(),'bootIdentity':pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip()}))`;
  return runJson(
    path.join(process.env.SystemRoot || "C:\\Windows", "System32/wsl.exe"),
    ["-d", binding.distribution, "--exec", "/usr/bin/python3", "-c", code],
    { kind: "linux-proc-via-wsl" },
  );
}
function atomicWrite(file, value) {
  return atomicWriteJson(file, value);
}
function archiveHistory(
  sourceRoot,
  destinationRoot,
  origin,
  budget = { files: 0, bytes: 0 },
) {
  for (const entry of origin.artifacts) {
    if (entry.missing) continue;
    requireFact(
      /^previous-epoch\/[a-z0-9.-]+$/u.test(entry.archivedPath || ""),
      "PRIOR_ARCHIVE_PATH_INVALID",
    );
    const source = path.join(sourceRoot, entry.archivedPath);
    const stat = fs.lstatSync(source);
    requireFact(
      !fs.lstatSync(path.dirname(source)).isSymbolicLink() &&
        stat.isFile() &&
        stat.nlink === 1,
      "PRIOR_ARCHIVE_FILE_INVALID",
    );
    requireFact(
      budget.files < 300 &&
        stat.size === entry.bytes &&
        budget.bytes + stat.size <= 16 * 1024 * 1024,
      "PRIOR_ARCHIVE_BYTES_INVALID",
    );
    const bytes = fs.readFileSync(source);
    budget.files++;
    budget.bytes += bytes.length;
    requireFact(
      budget.files <= 300 &&
        budget.bytes <= 16 * 1024 * 1024 &&
        bytes.length === entry.bytes &&
        `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}` ===
          entry.byteDigest,
      "PRIOR_ARCHIVE_BYTES_INVALID",
    );
    const destination = path.join(destinationRoot, entry.archivedPath);
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.writeFileSync(destination, bytes, { flag: "wx", mode: 0o600 });
    if (entry.source === "epoch-origin.json")
      archiveHistory(
        path.dirname(source),
        path.dirname(destination),
        JSON.parse(bytes.toString("utf8")),
        budget,
      );
  }
}
function archiveRejectedEpoch(root, outputRoot, previousRoot = root) {
  const archive = path.join(outputRoot, "previous-epoch");
  fs.mkdirSync(archive, { mode: 0o700 });
  const artifacts = [];
  let previous;
  for (const [name, required] of [
    ["watch-v2-state.json", true],
    ["binding-v2.json", true],
    ["observer-v2.mjs", previousRoot === root],
    ["watch-v2-launch.json", false],
    ["watch-v2.stderr.log", false],
    ["watch-v2.stdout.log", false],
    ...(fs.existsSync(
      path.join(previousRoot, "diagnostics/bounded-atomic-json.mjs"),
    )
      ? [["diagnostics/bounded-atomic-json.mjs", true]]
      : []),
    ...(fs.existsSync(path.join(previousRoot, "proof-reader.json"))
      ? [["proof-reader.json", true]]
      : []),
  ]) {
    const source = path.join(
      name === "binding-v2.json" ? root : previousRoot,
      name,
    );
    if (!required && !fs.existsSync(source)) {
      artifacts.push({ source: name, missing: true });
      continue;
    }
    requireFact(fs.lstatSync(source).isFile(), "EPOCH_ARCHIVE_FILE_INVALID");
    const bytes = fs.readFileSync(source);
    const archiveName =
      name === "diagnostics/bounded-atomic-json.mjs"
        ? "atomic-helper.mjs"
        : name;
    fs.writeFileSync(path.join(archive, archiveName), bytes, {
      flag: "wx",
      mode: 0o600,
    });
    artifacts.push({
      source: name,
      archivedPath: `previous-epoch/${archiveName}`,
      byteDigest: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
      bytes: bytes.length,
    });
    if (name === "watch-v2-state.json")
      previous = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/u, ""));
  }
  requireFact(
    previous?.schema === "chainlesschain.local-soak-watcher-state/v2" &&
      previous.status === "OBSERVATION_REJECTED" &&
      Number.isFinite(Date.parse(previous.rejectedAt)),
    "REJECTED_PRIOR_EPOCH_REQUIRED",
  );
  let previousObservation = previous;
  const originPath = path.join(previousRoot, "epoch-origin.json");
  if (previousRoot !== root || fs.existsSync(originPath)) {
    const bytes = fs.readFileSync(originPath);
    const priorOrigin = JSON.parse(bytes.toString("utf8"));
    requireFact(
      priorOrigin.schema === "chainlesschain.local-soak-observer-epoch/v1" &&
        previous.epoch?.originDigest === digest(priorOrigin) &&
        previous.epoch.id === priorOrigin.epochId &&
        priorOrigin.previousState.bindingDigest === previous.bindingDigest,
      "PRIOR_EPOCH_ORIGIN_INVALID",
    );
    fs.writeFileSync(path.join(archive, "epoch-origin.json"), bytes, {
      flag: "wx",
      mode: 0o600,
    });
    artifacts.push({
      source: "epoch-origin.json",
      archivedPath: "previous-epoch/epoch-origin.json",
      byteDigest: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
      bytes: bytes.length,
    });
    archiveHistory(previousRoot, archive, priorOrigin);
    if (!Number.isFinite(Date.parse(previous.observedAt)))
      previousObservation =
        priorOrigin.previousObservation || priorOrigin.previousState;
  }
  requireFact(
    Number.isFinite(Date.parse(previousObservation.observedAt)),
    "PRIOR_OBSERVATION_REQUIRED",
  );
  const origin = {
    schema: "chainlesschain.local-soak-observer-epoch/v1",
    epochId: crypto.randomUUID(),
    sourceRoot: root,
    previousStateRoot: previousRoot,
    stateRoot: outputRoot,
    previousState: previous,
    previousObservation,
    artifacts,
    observerByteDigest: `sha256:${crypto
      .createHash("sha256")
      .update(fs.readFileSync(fileURLToPath(import.meta.url)))
      .digest("hex")}`,
    atomicHelperByteDigest: atomicHelperDigest(),
    rule: "New observer epoch only. Previous rejection remains final; no gap is backfilled or joined into continuous acceptance.",
    formalHostAcceptance: false,
    observationsCreated: false,
  };
  fs.writeFileSync(
    path.join(outputRoot, "epoch-origin.json"),
    `${JSON.stringify(origin, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  return { ...origin, originDigest: digest(origin) };
}

// Dependencies are injectable only through this programmatic test API, never
// through CLI/environment settings. The CLI always reads actual process proof.
export async function main(
  args = process.argv.slice(2),
  { readProof = readProcessProof, clock = Date.now } = {},
) {
  const { values } = parseArgs({
    args,
    options: {
      root: { type: "string" },
      "state-root": { type: "string" },
      "resume-epoch-root": { type: "string" },
      "previous-epoch-root": { type: "string" },
      "windows-proof-helper": { type: "string" },
      "windows-proof-helper-digest": { type: "string" },
      "windows-proof-source-digest": { type: "string" },
      once: { type: "boolean" },
    },
  });
  requireFact(values.root, "ROOT_REQUIRED");
  requireFact(
    !values["resume-epoch-root"] ||
      (!values["state-root"] && !values["previous-epoch-root"]),
    "EPOCH_OPTIONS_CONFLICT",
  );
  requireFact(
    !values["previous-epoch-root"] || values["state-root"],
    "NEW_EPOCH_REQUIRED",
  );
  const proofOptions = [
    "windows-proof-helper",
    "windows-proof-helper-digest",
    "windows-proof-source-digest",
  ];
  requireFact(
    proofOptions.every((name) => !values[name]) ||
      proofOptions.every((name) => values[name]),
    "NATIVE_PROOF_PIN_REQUIRED",
  );
  const windowsNativeProof = values["windows-proof-helper"]
    ? {
        executable: path.resolve(values["windows-proof-helper"]),
        executableDigest: values["windows-proof-helper-digest"],
        sourceDigest: values["windows-proof-source-digest"],
      }
    : undefined;
  const root = fs.realpathSync(values.root);
  const previousRoot = values["previous-epoch-root"]
    ? fs.realpathSync(values["previous-epoch-root"])
    : root;
  let outputRoot = root;
  if (values["state-root"]) {
    const requested = path.resolve(values["state-root"]);
    outputRoot = path.join(
      fs.realpathSync(path.dirname(requested)),
      path.basename(requested),
    );
    const relative = path.relative(root, outputRoot);
    requireFact(
      relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative),
      "EPOCH_OUTPUT_MUST_BE_OUTSIDE_INPUT",
    );
    const previousRelative = path.relative(previousRoot, outputRoot);
    requireFact(
      previousRelative === ".." ||
        previousRelative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(previousRelative),
      "EPOCH_OUTPUT_MUST_BE_OUTSIDE_INPUT",
    );
    // No reuse/reset of an existing epoch, including a failed one. Resolve the
    // real parent first so a junction cannot alias the original observation.
    fs.mkdirSync(outputRoot, { mode: 0o700 });
  }
  if (values["resume-epoch-root"]) {
    outputRoot = fs.realpathSync(values["resume-epoch-root"]);
    const relative = path.relative(root, outputRoot);
    requireFact(
      relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative),
      "EPOCH_OUTPUT_MUST_BE_OUTSIDE_INPUT",
    );
  }
  const stateFile = path.join(outputRoot, "watch-v2-state.json");
  let state = null;
  let epoch = null;
  try {
    if (values["state-root"])
      epoch = archiveRejectedEpoch(root, outputRoot, previousRoot);
    // Load history before any new input can fail, so rejection cannot erase the
    // previously observed prefix, gaps, or milestones.
    if (fs.existsSync(stateFile)) {
      state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      requireFact(
        state.schema === "chainlesschain.local-soak-watcher-state/v2",
        "STATE_SCHEMA_INVALID",
      );
      requireFact(
        state.status !== "OBSERVATION_REJECTED",
        "PREVIOUS_OBSERVATION_REJECTED",
      );
      requireFact(
        ["MONITORING", "WORKLOAD_REPORT_VALIDATED_NONQUALIFYING"].includes(
          state.status,
        ) &&
          Number.isFinite(Date.parse(state.observedAt)) &&
          Number.isFinite(state.lastCheckpoint) &&
          Number.isFinite(state.unmonitoredPrefixSeconds) &&
          state.unmonitoredPrefixSeconds >= 0 &&
          Array.isArray(state.gaps) &&
          Array.isArray(state.milestonesRecorded),
        "STATE_INVALID",
      );
    }
    if (values["resume-epoch-root"] || state?.epoch) {
      requireFact(state?.epoch, "EPOCH_STATE_REQUIRED");
      const origin = JSON.parse(
        fs.readFileSync(path.join(outputRoot, "epoch-origin.json"), "utf8"),
      );
      requireFact(
        origin.schema === "chainlesschain.local-soak-observer-epoch/v1" &&
          state.epoch.originDigest === digest(origin) &&
          state.epoch.id === origin.epochId &&
          origin.previousState.bindingDigest === state.bindingDigest &&
          origin.observerByteDigest ===
            `sha256:${crypto
              .createHash("sha256")
              .update(fs.readFileSync(fileURLToPath(import.meta.url)))
              .digest("hex")}`,
        "PRIOR_EPOCH_ORIGIN_INVALID",
      );
      requireFact(
        origin.atomicHelperByteDigest === atomicHelperDigest(),
        "EPOCH_DEPENDENCY_CHANGED",
      );
      const reader = JSON.parse(
        fs.readFileSync(path.join(outputRoot, "proof-reader.json"), "utf8"),
      );
      requireFact(
        digest(reader.windowsNativeProof) ===
          digest(windowsNativeProof || null),
        "EPOCH_PROOF_READER_CHANGED",
      );
      epoch = { ...origin, originDigest: digest(origin) };
    }
    const binding = JSON.parse(
      fs
        .readFileSync(path.join(root, "binding-v2.json"), "utf8")
        .replace(/^\uFEFF/u, ""),
    );
    requireFact(
      binding.schema === "chainlesschain.local-soak-process-binding/v2",
      "BINDING_SCHEMA_INVALID",
    );
    requireFact(
      !windowsNativeProof || binding.platform === "win32",
      "NATIVE_PROOF_PLATFORM_INVALID",
    );
    if (epoch) {
      requireFact(
        digest(binding) === epoch.previousState.bindingDigest,
        "EPOCH_BINDING_CHANGED",
      );
      const archivedBinding = fs.readFileSync(
        path.join(outputRoot, "previous-epoch/binding-v2.json"),
      );
      requireFact(
        digest(binding) ===
          digest(
            JSON.parse(
              archivedBinding.toString("utf8").replace(/^\uFEFF/u, ""),
            ),
          ),
        "EPOCH_BINDING_CHANGED",
      );
    }
    if (epoch && values["state-root"]) {
      fs.writeFileSync(
        path.join(outputRoot, "observer-v2.mjs"),
        fs.readFileSync(fileURLToPath(import.meta.url)),
        { flag: "wx" },
      );
      fs.mkdirSync(path.join(outputRoot, "diagnostics"), { mode: 0o700 });
      fs.writeFileSync(
        path.join(outputRoot, "diagnostics/bounded-atomic-json.mjs"),
        fs.readFileSync(atomicHelperPath),
        { flag: "wx" },
      );
      fs.writeFileSync(
        path.join(outputRoot, "proof-reader.json"),
        `${JSON.stringify(
          {
            kind: windowsNativeProof
              ? "windows-native-single-handle"
              : "legacy-platform-query",
            windowsNativeProof: windowsNativeProof || null,
            formalHostAcceptance: false,
          },
          null,
          2,
        )}\n`,
        { flag: "wx" },
      );
    }
    const producer = path.join(
      binding.sourceRoot,
      "packages/cli/scripts/session-message-reliability-soak.mjs",
    );
    requireFact(
      `sha256:${crypto.createHash("sha256").update(fs.readFileSync(producer)).digest("hex")}` ===
        binding.producerDigest,
      "PRODUCER_CHANGED",
    );
    const { validateSessionMessageReliabilityEvidence } = await import(
      pathToFileURL(producer).href
    );
    for (;;) {
      const bytes = fs.readFileSync(path.join(root, "live-report.json"));
      const report = JSON.parse(bytes.toString("utf8"));
      const validation = {
        validateCompleted: validateSessionMessageReliabilityEvidence,
      };
      validateSnapshot(report, binding, { ...validation, now: clock() });
      if (epoch && !state)
        requireFact(
          report.status === "running",
          "EPOCH_REQUIRES_RUNNING_WORKLOAD",
        );
      if (report.status === "running")
        validateProcessProof(
          binding,
          readProof(binding, { windowsNativeProof }),
        );
      // First observation starts after its identity proof. A slow proof cannot
      // admit a checkpoint that became stale while the query was running.
      const now = clock();
      const checked = validateSnapshot(report, binding, { ...validation, now });
      if (epoch && !state) {
        requireFact(
          Date.parse(epoch.previousObservation.observedAt) <=
            Date.parse(epoch.previousState.rejectedAt) &&
            Date.parse(epoch.previousState.rejectedAt) <= now &&
            checked.checkpoint >= epoch.previousObservation.lastCheckpoint &&
            report.continuousDurationSeconds >=
              epoch.previousObservation.continuousDurationSeconds &&
            checked.cycles >= epoch.previousObservation.cycles,
          "EPOCH_OBSERVATION_REGRESSION",
        );
      }
      const firstObservedAt =
        state?.epoch?.firstObservedAt || new Date(now).toISOString();
      state = advanceObservation(state, report, checked, { now });
      if (epoch) {
        state.epoch = {
          id: epoch.epochId,
          originDigest: epoch.originDigest,
          firstObservedAt,
          previousRejectedAt: epoch.previousState.rejectedAt,
          previousObservationGap: {
            from: epoch.previousObservation.observedAt,
            to: firstObservedAt,
            reason:
              "previous observer epoch rejected; interval is not retroactively monitored",
          },
        };
        state.monitoringCompleteFromLaunch = false;
      }
      for (const hours of [8, 24]) {
        if (
          checked.cycles > 0 &&
          report.continuousDurationSeconds >= hours * 3_600 &&
          !state.milestonesRecorded.includes(hours)
        ) {
          const name = `raw-checkpoint-v2-${hours}h.json`;
          fs.writeFileSync(path.join(outputRoot, name), bytes, { flag: "wx" });
          atomicWrite(
            path.join(outputRoot, `raw-checkpoint-v2-${hours}h.metadata.json`),
            {
              ...state,
              rawFile: name,
              rawByteDigest: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
            },
          );
          state.milestonesRecorded.push(hours);
        }
      }
      atomicWrite(stateFile, state);
      if (values.once || report.status === "passed") break;
      await setTimeout(60_000);
    }
  } catch (error) {
    const rejectedAt = new Date(clock()).toISOString();
    const rejection = {
      ...(state || {}),
      schema: "chainlesschain.local-soak-watcher-state/v2",
      status: "OBSERVATION_REJECTED",
      rejectedAt: state?.rejectedAt || rejectedAt,
      lastRejectedAt: rejectedAt,
      rejectionEvents: [
        ...(state?.rejectionEvents || []),
        {
          rejectedAt,
          reason: error.code || "READ_OR_VALIDATION_ERROR",
          ...(error.processProofFailure
            ? { processProofFailure: error.processProofFailure }
            : {}),
        },
      ],
      reason: error.code || "READ_OR_VALIDATION_ERROR",
      formalHostAcceptance: false,
      observationsCreated: false,
      detail: String(error.message).slice(0, 500),
      ...(epoch
        ? {
            epochOriginDigest: epoch.originDigest,
            previousEpochRejected: true,
            bindingDigest:
              state?.bindingDigest || epoch.previousState.bindingDigest,
            epoch: state?.epoch || {
              id: epoch.epochId,
              originDigest: epoch.originDigest,
              firstObservedAt: null,
            },
          }
        : {}),
      ...(error.processProofFailure
        ? { processProofFailure: error.processProofFailure }
        : {}),
    };
    try {
      atomicWrite(stateFile, rejection);
    } catch (publicationError) {
      error.failedReportPublication = {
        code: publicationError.code || "PUBLICATION_FAILED",
        message: String(publicationError.message).slice(0, 500),
        publicationFailure: publicationError.publicationFailure || null,
      };
    }
    throw error;
  }
  return state;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    if (error.publicationFailure || error.failedReportPublication)
      process.stderr.write(
        `${JSON.stringify({
          publicationFailure: error.publicationFailure || null,
          failedReportPublication: error.failedReportPublication || null,
        })}\n`,
      );
    process.exitCode = 1;
  });
}
