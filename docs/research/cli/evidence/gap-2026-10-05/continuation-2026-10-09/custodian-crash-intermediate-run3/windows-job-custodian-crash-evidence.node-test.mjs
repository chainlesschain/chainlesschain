import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  NATIVE_SCHEMA,
  REPORT_SCHEMA,
  SOURCE_NAMES,
  describeBytes,
  inspectCustodianCrash,
  inspectCustodianCrashArtifact,
} from "../scripts/lib/windows-job-custodian-crash-evidence.mjs";

// Synthetic records exercise rejection predicates only, never native evidence.
const nonce = "b0f19c71-404a-42cf-a0ae-91192655b761";
function fixture(positive = true, runNonce = nonce) {
  const handle = (pid) => ({
    pid,
    rights: 0x101001,
    nonInheritable: true,
    sameCreationObject: true,
    preWait: 258,
    liveChallengeBefore: true,
  });
  const roles = ["member-a", "member-b", "member-c"];
  return {
    schema: NATIVE_SCHEMA,
    mode: positive ? "kill-on-close" : "no-kill-control",
    nonce: runNonce,
    status: "NOT_ADMITTED",
    trusted: false,
    elevated: false,
    witnessPid: 100,
    process64Bit: true,
    osVersion: "10.0.19045",
    clrVersion: "4.0.30319.42000",
    durableRecoveryProven: false,
    protectedServiceProven: false,
    wfpProven: false,
    wholeJobEmptyProven: false,
    jobQueriedAfterCrash: false,
    witnessTargetJobHandles: 0,
    completed: positive,
    expectedRejection: !positive,
    fallbackCleanupUsed: !positive,
    cleanupConfirmed: true,
    stage: positive ? "completed" : "negative-control-survived",
    crashElapsedMs: 10,
    safetyGuard: {
      flags: 0x2008,
      activeLimit: 4,
      unnamed: true,
      nonInheritable: true,
      witnessOutside: true,
      handleCount: 1,
      handleCountBeforeCrash: 1,
      atomicRootAssignments: 3,
      atomicCustodianAssignment: true,
      custodianMemberBeforeResume: true,
      activeBeforeCrash: 4,
      heldOpenThroughObservation: true,
      activeAfterExplicitCleanup: 0,
      closeAfterOriginalHandleCleanup: true,
    },
    setup: {
      flags: positive ? 0x2008 : 8,
      activeLimit: 3,
      activeMembers: 3,
      jobHandleCount: 1,
      inheritedHandleCount: 7,
      unnamed: true,
      jobNonInheritable: true,
      custodianOutside: true,
      witnessOutside: true,
      noBreakaway: true,
      members: roles.map((role, i) => ({
        role,
        pid: i + 101,
        assignedBeforeResume: true,
        memberBeforeResume: true,
      })),
    },
    custodian: {
      ...handle(104),
      terminateSucceeded: true,
      wait: 0,
      exit: 188,
      socketTerminal: "reset",
    },
    members: roles.map((role, i) => ({
      ...handle(i + 101),
      safetyMemberBeforeResume: true,
      role,
      afterWait: positive ? 0 : 258,
      exitKnown: true,
      actualExit: positive ? 0 : 259,
      finalWait: 0,
      ...(positive
        ? { socketTerminal: "eof" }
        : { liveChallengeAfter: true, cleanupSocketTerminal: "reset" }),
    })),
  };
}
test("positive finite-set contract remains NOT_ADMITTED", () => {
  assert.deepEqual(inspectCustodianCrash(fixture(), "kill-on-close", nonce), {
    diagnosticCompleted: true,
    expectedControlRejected: false,
    status: "NOT_ADMITTED",
    trusted: false,
    scope: "three-fixed-controlled-root-processes",
    errors: [],
  });
});
test("missing-policy control remains failure with confirmed fallback", () => {
  const result = inspectCustodianCrash(
    fixture(false),
    "no-kill-control",
    nonce,
  );
  assert.equal(result.diagnosticCompleted, false);
  assert.equal(result.expectedControlRejected, true);
  assert.deepEqual(result.errors, []);
});
const mutations = [
  ["schema", (v) => (v.schema = "old")],
  ["run identity", (v) => (v.nonce = randomUUID())],
  ["admitted", (v) => (v.status = "ADMITTED")],
  ["trusted", (v) => (v.trusted = true)],
  ["elevated", (v) => (v.elevated = true)],
  ["x86", (v) => (v.process64Bit = false)],
  ["durable recovery", (v) => (v.durableRecoveryProven = true)],
  ["service", (v) => (v.protectedServiceProven = true)],
  ["WFP", (v) => (v.wfpProven = true)],
  ["whole Job empty", (v) => (v.wholeJobEmptyProven = true)],
  ["post-crash Job query", (v) => (v.jobQueriedAfterCrash = true)],
  ["witness Job copy", (v) => (v.witnessTargetJobHandles = 1)],
  ["missing kill flag", (v) => (v.setup.flags = 8)],
  ["breakaway", (v) => (v.setup.flags |= 0x800)],
  ["silent breakaway", (v) => (v.setup.flags |= 0x1000)],
  ["extra Job copy", (v) => (v.setup.jobHandleCount = 2)],
  ["unnamed absent", (v) => delete v.setup.unnamed],
  ["inheritable Job", (v) => (v.setup.jobNonInheritable = false)],
  ["custodian in Job", (v) => (v.setup.custodianOutside = false)],
  ["witness in Job", (v) => (v.setup.witnessOutside = false)],
  ["wrong inheritance", (v) => (v.setup.inheritedHandleCount = 8)],
  ["unknown active member", (v) => (v.setup.activeMembers = 4)],
  ["missing active limit", (v) => (v.setup.activeLimit = 0)],
  ["membership PID mismatch", (v) => (v.setup.members[0].pid = 201)],
  ["duplicate membership", (v) => (v.setup.members[1] = v.setup.members[0])],
  [
    "assigned after resume",
    (v) => (v.setup.members[0].assignedBeforeResume = false),
  ],
  ["member check absent", (v) => delete v.setup.members[0].memberBeforeResume],
  ["missing member", (v) => v.members.pop()],
  [
    "extra member",
    (v) => v.members.push({ ...v.members[0], role: "other", pid: 999 }),
  ],
  ["duplicate member role", (v) => (v.members[1].role = "member-a")],
  ["reused live PID", (v) => (v.members[0].pid = v.witnessPid)],
  ["only PID disappearance", (v) => delete v.members[0].sameCreationObject],
  ["member DUP_HANDLE", (v) => (v.members[0].rights |= 0x40)],
  ["custodian DUP_HANDLE", (v) => (v.custodian.rights |= 0x40)],
  ["inheritable member handle", (v) => (v.members[0].nonInheritable = false)],
  ["member already dead", (v) => (v.members[0].preWait = 0)],
  [
    "missing live member challenge",
    (v) => (v.members[0].liveChallengeBefore = false),
  ],
  [
    "missing custodian challenge",
    (v) => delete v.custodian.liveChallengeBefore,
  ],
  ["custodian already dead", (v) => (v.custodian.preWait = 0)],
  ["crash call failed", (v) => (v.custodian.terminateSucceeded = false)],
  ["custodian exit differs", (v) => (v.custodian.exit = 197)],
  ["custodian exit unknown", (v) => (v.custodian.exit = 259)],
  ["custodian unsignaled", (v) => (v.custodian.wait = 258)],
  ["custodian socket timeout", (v) => (v.custodian.socketTerminal = "timeout")],
  ["member unsignaled", (v) => (v.members[0].afterWait = 258)],
  ["member exit unknown", (v) => (v.members[0].actualExit = 259)],
  ["exit not queried", (v) => (v.members[0].exitKnown = false)],
  ["negative exit number", (v) => (v.members[0].actualExit = -1)],
  ["EOF absent", (v) => delete v.members[0].socketTerminal],
  ["socket timeout as close", (v) => (v.members[0].socketTerminal = "timeout")],
  ["fallback success", (v) => (v.fallbackCleanupUsed = true)],
  [
    "fallback socket evidence",
    (v) => (v.members[0].cleanupSocketTerminal = "eof"),
  ],
  ["post-crash live member", (v) => (v.members[0].liveChallengeAfter = true)],
  ["final handle unsignaled", (v) => (v.members[0].finalWait = 258)],
  ["deadline exceeded", (v) => (v.crashElapsedMs = 5001)],
  ["deadline missing", (v) => delete v.crashElapsedMs],
  ["native error", (v) => (v.error = "failure")],
  ["custodian cleanup error", (v) => (v.custodianCleanupError = "failure")],
  ["member cleanup error", (v) => (v.members[0].cleanupError = "failure")],
  ["cleanup missing", (v) => (v.cleanupConfirmed = false)],
  ["completion missing", (v) => (v.completed = false)],
  ["stage incomplete", (v) => (v.stage = "setup")],
  ["safety Job absent", (v) => delete v.safetyGuard],
  ["safety kill flag absent", (v) => (v.safetyGuard.flags = 8)],
  ["safety breakaway", (v) => (v.safetyGuard.flags |= 0x800)],
  ["safety limit missing", (v) => (v.safetyGuard.activeLimit = 3)],
  ["inherited safety Job", (v) => (v.safetyGuard.nonInheritable = false)],
  ["extra safety handle", (v) => (v.safetyGuard.handleCountBeforeCrash = 2)],
  ["witness inside safety Job", (v) => (v.safetyGuard.witnessOutside = false)],
  [
    "roots not atomically guarded",
    (v) => (v.safetyGuard.atomicRootAssignments = 2),
  ],
  [
    "custodian not atomically guarded",
    (v) => (v.safetyGuard.atomicCustodianAssignment = false),
  ],
  [
    "custodian guard check missing",
    (v) => (v.safetyGuard.custodianMemberBeforeResume = false),
  ],
  [
    "root guard check missing",
    (v) => (v.members[0].safetyMemberBeforeResume = false),
  ],
  [
    "safety Job incomplete live set",
    (v) => (v.safetyGuard.activeBeforeCrash = 3),
  ],
  [
    "safety Job closed for observation",
    (v) => (v.safetyGuard.heldOpenThroughObservation = false),
  ],
  [
    "safety Job used as evidence cleanup",
    (v) => (v.safetyGuard.closeAfterOriginalHandleCleanup = false),
  ],
  [
    "safety Job member left over",
    (v) => (v.safetyGuard.activeAfterExplicitCleanup = 1),
  ],
  ["safety Job cleanup error", (v) => (v.safetyGuard.cleanupError = "failure")],
  ["safety Job close failed", (v) => (v.safetyGuard.closeError = 5)],
];
for (const [name, mutate] of mutations)
  test(`reject ${name}`, () => {
    const value = fixture();
    mutate(value);
    const result = inspectCustodianCrash(value, "kill-on-close", nonce);
    assert.equal(result.diagnosticCompleted, false);
    assert.ok(result.errors.length > 0);
  });
for (const [name, mutate] of [
  ["control retains kill flag", (v) => (v.setup.flags = 0x2008)],
  [
    "control missing live response",
    (v) => delete v.members[0].liveChallengeAfter,
  ],
  ["control prematurely signaled", (v) => (v.members[0].afterWait = 0)],
  ["control not STILL_ACTIVE", (v) => (v.members[0].actualExit = 0)],
  ["control fallback hidden", (v) => (v.fallbackCleanupUsed = false)],
  [
    "control fallback socket timeout",
    (v) => (v.members[0].cleanupSocketTerminal = "timeout"),
  ],
  [
    "control claims automatic EOF",
    (v) => (v.members[0].socketTerminal = "eof"),
  ],
  ["control claims completion", (v) => (v.completed = true)],
])
  test(`reject ${name}`, () => {
    const value = fixture(false);
    mutate(value);
    assert.equal(
      inspectCustodianCrash(value, "no-kill-control", nonce)
        .expectedControlRejected,
      false,
    );
  });
test("null and malformed values return rejection", () => {
  for (const value of [
    null,
    {},
    [],
    1,
    "",
    { setup: { members: [null] }, members: [null] },
  ])
    assert.equal(
      inspectCustodianCrash(value, "kill-on-close", nonce).diagnosticCompleted,
      false,
    );
});

function artifact(directory) {
  const write = (name, value) =>
    fs.writeFileSync(
      path.join(directory, name),
      typeof value === "string" ? value : JSON.stringify(value),
    );
  const report = {
    schema: REPORT_SCHEMA,
    status: "NOT_ADMITTED",
    trusted: false,
    scope: "three-fixed-controlled-root-processes",
    output: directory,
    preparedOnly: false,
    host: { platform: "win32", arch: "x64" },
    positiveNonce: nonce,
    controlNonce: randomUUID(),
    sources: [],
    evidence: [],
  };
  for (const name of SOURCE_NAMES) {
    write(name, `synthetic contract source ${name}`);
    const original = path.join(directory, name),
      before = describeBytes(original);
    report.sources.push({ name, original, before, after: { ...before } });
  }
  for (const [key, name] of [
    ["compiler", "compiler.fixture"],
    ["runtime", "runtime.fixture"],
    ["executable", "windows-job-custodian-crash-probe.exe"],
  ]) {
    write(name, `synthetic ${key}, never executable`);
    const file = path.join(directory, name),
      before = describeBytes(file);
    report[key] = { path: file, before, after: { ...before } };
  }
  write("build.json", {
    status: 0,
    signal: null,
    error: null,
    command: report.compiler.path,
    args: [
      "/nologo",
      "/optimize+",
      "/target:exe",
      "/platform:x64",
      "/reference:System.Web.Extensions.dll",
      `/out:${report.executable.path}`,
      path.join(directory, SOURCE_NAMES[0]),
    ],
  });
  write("build.stdout.txt", "");
  write("build.stderr.txt", "");
  for (const [name, positive, runNonce] of [
    ["positive", true, report.positiveNonce],
    ["control", false, report.controlNonce],
  ]) {
    write(`${name}.stdout.json`, fixture(positive, runNonce));
    write(`${name}.stderr.txt`, "");
    write(`${name}.json`, {
      command: report.executable.path,
      pid: 100,
      args: [positive ? "kill-on-close" : "no-kill-control", runNonce],
      status: positive ? 0 : 2,
      signal: null,
      error: null,
    });
  }
  report.evidence = [
    "build.stdout.txt",
    "build.stderr.txt",
    "build.json",
    "positive.stdout.json",
    "positive.stderr.txt",
    "positive.json",
    "control.stdout.json",
    "control.stderr.txt",
    "control.json",
  ].map((name) => ({ name, ...describeBytes(path.join(directory, name)) }));
  return report;
}
const artifactCases = [
  ["intact byte envelope", () => {}, true],
  [
    "captured source byte tamper",
    (r, d) => fs.appendFileSync(path.join(d, SOURCE_NAMES[0]), "tamper"),
  ],
  [
    "compiled executable tamper",
    (r, d) =>
      fs.appendFileSync(
        path.join(d, "windows-job-custodian-crash-probe.exe"),
        "tamper",
      ),
  ],
  ["compiler tamper", (r) => fs.appendFileSync(r.compiler.path, "tamper")],
  ["runtime tamper", (r) => fs.appendFileSync(r.runtime.path, "tamper")],
  [
    "raw stdout tamper",
    (r, d) => fs.appendFileSync(path.join(d, "positive.stdout.json"), " "),
  ],
  ["missing capture", (r) => r.evidence.pop()],
  ["missing source", (r) => r.sources.pop()],
  ["changed after hash", (r) => (r.sources[0].after.sha256 = "0".repeat(64))],
  ["changed executable after size", (r) => r.executable.after.bytes++],
  ["prepared only", (r) => (r.preparedOnly = true)],
  ["stored failure", (r) => (r.failure = "actual failure")],
  ["reused run nonce", (r) => (r.controlNonce = r.positiveNonce)],
  ["report asserts admission", (r) => (r.status = "ADMITTED")],
  ["report changes scope", (r) => (r.scope = "durable-service")],
  [
    "forged derived success ignored",
    (r) => {
      r.diagnosticCompleted = true;
      r.validation = { diagnosticCompleted: true, errors: [] };
      r.positiveNonce = randomUUID();
    },
  ],
  ["original source disappeared", (r) => (r.sources[0].original += ".missing")],
];
function rewriteCapture(report, directory, name, mutate) {
  const file = path.join(directory, name);
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  mutate(value);
  fs.writeFileSync(file, JSON.stringify(value));
  Object.assign(
    report.evidence.find((entry) => entry.name === name),
    describeBytes(file),
  );
}
for (const [name, capture, mutate] of [
  ["wrong positive status", "positive.json", (v) => (v.status = 2)],
  ["wrong negative status", "control.json", (v) => (v.status = 0)],
  ["actual witness PID mismatch", "positive.json", (v) => (v.pid = 999)],
  ["spawn error", "positive.json", (v) => (v.error = "EPERM")],
  ["process timed out", "positive.json", (v) => (v.signal = "SIGTERM")],
  [
    "invocation nonce differs",
    "positive.json",
    (v) => (v.args[1] = randomUUID()),
  ],
  ["executed other image", "positive.json", (v) => (v.command += ".other")],
  [
    "injected build argument",
    "build.json",
    (v) => v.args.splice(1, 0, "/unsafe+"),
  ],
  ["failed compile", "build.json", (v) => (v.status = 1)],
  [
    "malformed native schema",
    "positive.stdout.json",
    (v) => (v.schema = "forged"),
  ],
])
  artifactCases.push([name, (r, d) => rewriteCapture(r, d, capture, mutate)]);
for (const [name, mutate, accepted = false] of artifactCases)
  test(`artifact ${name}`, () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "custodian-contract-"),
    );
    try {
      const report = artifact(directory);
      mutate(report, directory);
      assert.equal(
        inspectCustodianCrashArtifact(report, directory).diagnosticCompleted,
        accepted,
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
