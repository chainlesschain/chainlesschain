/** Finite controlled-set diagnostic only. This never admits a sandbox run. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const NATIVE_SCHEMA = "chainlesschain.windows-custodian-crash-native/v1";
export const REPORT_SCHEMA =
  "chainlesschain.windows-custodian-crash-diagnostic/v1";
export const SOURCE_NAMES = [
  "windows-job-custodian-crash-probe.cs",
  "windows-job-custodian-crash-probe.mjs",
  "windows-job-custodian-crash-evidence.mjs",
  "windows-job-custodian-crash-evidence.node-test.mjs",
];
const uuid = (v) =>
  typeof v === "string" &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
const pid = (v) => Number.isSafeInteger(v) && v > 0;
const closed = (v) => v === "eof" || v === "reset";
const roles = ["member-a", "member-b", "member-c"];
export function describeBytes(file) {
  const bytes = fs.readFileSync(file);
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  };
}
const same = (a, b) =>
  /^[a-f0-9]{64}$/.test(a?.sha256) &&
  Number.isSafeInteger(a?.bytes) &&
  a.bytes >= 0 &&
  a.sha256 === b?.sha256 &&
  a.bytes === b?.bytes;

export function inspectCustodianCrash(value, mode, nonce) {
  const errors = [];
  const need = (condition, message) => {
    if (!condition) errors.push(message);
  };
  const positive = mode === "kill-on-close";
  need(positive || mode === "no-kill-control", "unsupported mode");
  need(
    value?.schema === NATIVE_SCHEMA &&
      value?.mode === mode &&
      uuid(nonce) &&
      value?.nonce === nonce,
    "native identity mismatch",
  );
  need(
    value?.status === "NOT_ADMITTED" && value?.trusted === false,
    "admission boundary changed",
  );
  for (const field of [
    "durableRecoveryProven",
    "protectedServiceProven",
    "wfpProven",
    "wholeJobEmptyProven",
    "jobQueriedAfterCrash",
  ])
    need(value?.[field] === false, `unsupported ${field} claim`);
  need(
    value?.elevated === false &&
      value?.process64Bit === true &&
      typeof value?.osVersion === "string" &&
      typeof value?.clrVersion === "string",
    "non-admin x64 runtime missing",
  );
  need(
    pid(value?.witnessPid) && value?.witnessTargetJobHandles === 0,
    "external witness or zero Job handles missing",
  );
  need(
    value?.cleanupConfirmed === true &&
      value?.completed === positive &&
      value?.expectedRejection === !positive &&
      value?.fallbackCleanupUsed === !positive,
    "completion or fallback boundary differs",
  );
  need(
    value?.stage === (positive ? "completed" : "negative-control-survived"),
    "native stage incomplete",
  );
  need(
    !value?.error && !value?.custodianCleanupError,
    "native failure retained",
  );
  need(
    Number.isSafeInteger(value?.crashElapsedMs) &&
      value.crashElapsedMs >= 0 &&
      value.crashElapsedMs <= 5000,
    "crash deadline unproven",
  );
  const setup = value?.setup;
  need(
    setup?.flags === (positive ? 0x2008 : 8) &&
      setup?.activeLimit === 3 &&
      setup?.activeMembers === 3,
    "readback flags or complete finite membership differ",
  );
  need(
    setup?.jobHandleCount === 1 && setup?.inheritedHandleCount === 7,
    "sole Job handle or inheritance whitelist differs",
  );
  for (const field of [
    "unnamed",
    "jobNonInheritable",
    "custodianOutside",
    "witnessOutside",
    "noBreakaway",
  ])
    need(setup?.[field] === true, `Job boundary missing: ${field}`);
  const originalHandle = (item) =>
    pid(item?.pid) &&
    item?.rights === 0x101001 &&
    item?.nonInheritable === true &&
    item?.sameCreationObject === true &&
    item?.preWait === 258 &&
    item?.liveChallengeBefore === true;
  const guard = value?.safetyGuard;
  need(
    guard?.flags === 0x2008 &&
      guard?.activeLimit === 4 &&
      guard?.unnamed === true &&
      guard?.nonInheritable === true &&
      guard?.witnessOutside === true &&
      guard?.handleCount === 1 &&
      guard?.handleCountBeforeCrash === 1,
    "independent safety Job policy or ownership missing",
  );
  need(
    guard?.atomicRootAssignments === 3 &&
      guard?.atomicCustodianAssignment === true &&
      guard?.custodianMemberBeforeResume === true &&
      guard?.activeBeforeCrash === 4,
    "creation-time safety Job membership missing",
  );
  need(
    guard?.heldOpenThroughObservation === true &&
      guard?.activeAfterExplicitCleanup === 0 &&
      guard?.closeAfterOriginalHandleCleanup === true &&
      !guard?.cleanupError &&
      !Object.hasOwn(guard || {}, "closeError"),
    "safety Job closed early or fallback cleanup unconfirmed",
  );
  const owner = value?.custodian;
  need(
    originalHandle(owner) &&
      owner?.terminateSucceeded === true &&
      owner?.wait === 0 &&
      owner?.exit === 188 &&
      closed(owner?.socketTerminal),
    "external crash via original custodian object unproven",
  );
  const members = Array.isArray(value?.members) ? value.members : [];
  const bindings = Array.isArray(setup?.members) ? setup.members : [];
  need(
    members.length === 3 && bindings.length === 3,
    "exact three controlled roots required",
  );
  const pids = [
    value?.witnessPid,
    owner?.pid,
    ...members.map((item) => item?.pid),
  ];
  need(
    pids.every(pid) && new Set(pids).size === 5,
    "distinct live process objects missing",
  );
  need(
    Array.isArray(guard?.processIdsBeforeCrash) &&
      guard.processIdsBeforeCrash.length === 4 &&
      new Set(guard.processIdsBeforeCrash).size === 4 &&
      guard.processIdsBeforeCrash.every(
        (id) => pid(id) && pids.slice(1).includes(id),
      ),
    "safety Job process list differs from four retained creation objects",
  );
  for (const role of roles) {
    const matches = members.filter((item) => item?.role === role);
    const assigns = bindings.filter((item) => item?.role === role);
    const member = matches[0],
      binding = assigns[0];
    need(
      matches.length === 1 && assigns.length === 1 && originalHandle(member),
      `${role}: retained creation object or live barrier missing`,
    );
    need(
      binding?.pid === member?.pid &&
        pid(binding?.pid) &&
        binding?.assignedBeforeResume === true &&
        binding?.memberBeforeResume === true,
      `${role}: suspended assignment and membership unproven`,
    );
    need(
      member?.exitKnown === true &&
        member?.finalWait === 0 &&
        member?.safetyMemberBeforeResume === true &&
        !member?.cleanupError,
      `${role}: final original HANDLE cleanup missing`,
    );
    if (positive) {
      need(
        member?.afterWait === 0 &&
          Number.isInteger(member?.actualExit) &&
          member.actualExit >= 0 &&
          member.actualExit <= 0xffffffff &&
          member.actualExit !== 259 &&
          closed(member?.socketTerminal),
        `${role}: automatic signaled HANDLE plus EOF/reset missing`,
      );
      need(
        !Object.hasOwn(member || {}, "cleanupSocketTerminal") &&
          !Object.hasOwn(member || {}, "liveChallengeAfter"),
        `${role}: positive uses fallback evidence`,
      );
    } else {
      need(
        member?.afterWait === 258 &&
          member?.actualExit === 259 &&
          member?.liveChallengeAfter === true &&
          closed(member?.cleanupSocketTerminal) &&
          !Object.hasOwn(member || {}, "socketTerminal"),
        `${role}: live no-kill control or later fallback cleanup missing`,
      );
    }
  }
  return {
    diagnosticCompleted: errors.length === 0 && positive,
    expectedControlRejected: errors.length === 0 && !positive,
    status: "NOT_ADMITTED",
    trusted: false,
    scope: "three-fixed-controlled-root-processes",
    errors,
  };
}

/** Re-read raw bytes; descriptors alone are not proof. Originals may be omitted
 * only for explicit archive inspection, reported separately in the result. */
export function inspectCustodianCrashArtifact(
  report,
  directory,
  { verifyOriginals = true } = {},
) {
  const errors = [];
  const need = (condition, message) => {
    if (!condition) errors.push(message);
  };
  const read = (name) => fs.readFileSync(path.join(directory, name));
  const verifyFile = (file, descriptor, label) => {
    try {
      need(same(descriptor, describeBytes(file)), `${label}: bytes changed`);
    } catch (error) {
      errors.push(`${label}: ${error.message}`);
    }
  };
  need(
    report?.schema === REPORT_SCHEMA &&
      report?.status === "NOT_ADMITTED" &&
      report?.trusted === false,
    "report schema or admission boundary differs",
  );
  need(
    report?.preparedOnly === false && !report?.failure,
    "report incomplete or failed",
  );
  need(
    report?.host?.platform === "win32" && report?.host?.arch === "x64",
    "Windows x64 host missing",
  );
  need(
    report?.scope === "three-fixed-controlled-root-processes",
    "finite scope differs",
  );
  const sources = Array.isArray(report?.sources) ? report.sources : [];
  need(sources.length === SOURCE_NAMES.length, "source capture incomplete");
  for (const name of SOURCE_NAMES) {
    const matches = sources.filter((item) => item?.name === name),
      source = matches[0];
    need(
      matches.length === 1 && same(source?.before, source?.after),
      `${name}: source changed or absent`,
    );
    verifyFile(path.join(directory, name), source?.before, name);
    if (verifyOriginals && typeof source?.original === "string")
      verifyFile(source.original, source?.before, `original ${name}`);
    else if (verifyOriginals) errors.push(`original ${name}: path missing`);
  }
  for (const key of ["compiler", "executable", "runtime"]) {
    const item = report?.[key];
    need(same(item?.before, item?.after), `${key}: changed or absent`);
    if (key === "executable")
      verifyFile(
        path.join(directory, "windows-job-custodian-crash-probe.exe"),
        item?.before,
        key,
      );
    else if (verifyOriginals && typeof item?.path === "string")
      verifyFile(item.path, item?.before, key);
    else if (verifyOriginals) errors.push(`${key}: path missing`);
  }
  const files = [
    "build.stdout.txt",
    "build.stderr.txt",
    "build.json",
    "positive.stdout.json",
    "positive.stderr.txt",
    "positive.json",
    "control.stdout.json",
    "control.stderr.txt",
    "control.json",
  ];
  const captures = Array.isArray(report?.evidence) ? report.evidence : [];
  need(captures.length === files.length, "raw capture set incomplete");
  for (const name of files) {
    const matches = captures.filter((item) => item?.name === name);
    need(matches.length === 1, `${name}: capture absent or duplicate`);
    verifyFile(path.join(directory, name), matches[0], name);
  }
  try {
    const build = JSON.parse(read("build.json"));
    const executablePath = path.join(
      report.output,
      "windows-job-custodian-crash-probe.exe",
    );
    need(
      report.executable.path === executablePath,
      "executed image differs from captured build output",
    );
    const buildArgs = [
      "/nologo",
      "/optimize+",
      "/target:exe",
      "/platform:x64",
      "/reference:System.Web.Extensions.dll",
      `/out:${executablePath}`,
      path.join(report.output, SOURCE_NAMES[0]),
    ];
    need(
      build.status === 0 &&
        build.signal === null &&
        !build.error &&
        build.command === report.compiler.path &&
        JSON.stringify(build.args) === JSON.stringify(buildArgs),
      "captured build binding incomplete",
    );
    need(
      uuid(report?.positiveNonce) &&
        uuid(report?.controlNonce) &&
        report.positiveNonce !== report.controlNonce,
      "separate run nonces missing",
    );
    for (const [name, mode, nonce, exit] of [
      ["positive", "kill-on-close", report?.positiveNonce, 0],
      ["control", "no-kill-control", report?.controlNonce, 2],
    ]) {
      const execution = JSON.parse(read(`${name}.json`));
      need(
        execution.status === exit &&
          execution.signal === null &&
          !execution.error &&
          execution.command === report.executable.path &&
          JSON.stringify(execution.args) === JSON.stringify([mode, nonce]),
        `${name}: native invocation or exit differs`,
      );
      need(read(`${name}.stderr.txt`).length === 0, `${name}: stderr nonempty`);
      const native = JSON.parse(read(`${name}.stdout.json`));
      need(
        pid(execution.pid) && execution.pid === native?.witnessPid,
        `${name}: actual launched witness PID differs`,
      );
      const result = inspectCustodianCrash(native, mode, nonce);
      errors.push(...result.errors.map((message) => `${name}: ${message}`));
    }
  } catch (error) {
    errors.push(`raw evidence parse: ${error.message}`);
  }
  return {
    diagnosticCompleted: errors.length === 0,
    status: "NOT_ADMITTED",
    trusted: false,
    originalsRechecked: verifyOriginals,
    scope: "three-fixed-controlled-root-processes",
    errors,
  };
}
