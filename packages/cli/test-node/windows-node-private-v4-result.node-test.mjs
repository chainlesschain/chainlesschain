import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import identity from "../scripts/diagnostics/windows-node-private-v4-identity.cjs";
import {
  inspectPrivateV4Result,
  inspectPrivateV4Settlement,
  PRIVATE_V4_EXPERIMENT,
} from "../scripts/windows-node-private-v4-result.mjs";
const immutableLockError =
  "source closure differs from immutable frozen digest";
function rejectedBeyondFixtureLock(result) {
  assert.equal(result.diagnosticVerified, false);
  assert.ok(result.errors.includes(immutableLockError));
  assert.ok(result.errors.some((error) => error !== immutableLockError));
}

// Synthetic contract data exercises consistency checks, never actual Windows
// admission evidence. Real diagnostics must use the default filesystem reader.
function fixture() {
  const files = new Map();
  function capture(path, text = path) {
    const bytes = Buffer.from(text);
    files.set(path, bytes);
    return {
      path,
      bytes: bytes.length,
      digest: "sha256:" + identity.digest(bytes),
    };
  }
  const sessionId = "67271425-103d-407f-ad04-36fa5a6c7611";
  const generation = "57271425-103d-407f-ad04-36fa5a6c7611";
  const appContainerSid = "S-1-15-2-1-2-3-4-5-6-7";
  const root = "C:\\private-v4-result";
  const rootId = "77271425-103d-407f-ad04-36fa5a6c7611";
  const workerId = "87271425-103d-407f-ad04-36fa5a6c7611";
  const sources = [
    "windows-node-private-v4-broker.cpp",
    "windows-node-private-v4-adapter.cpp",
    "windows-node-private-v4-adapter.h",
    "windows-node-private-v4-paired.h",
    "windows-node-private-v4-protocol.h",
    "windows-esbuild-private-map-supervisor.cpp",
    "windows-esbuild-private-map-shim.cpp",
    "windows-node-private-v4-identity.cjs",
    "windows-node-private-v4-preload.cjs",
  ].map((name) => capture("C:\\sources\\" + name));
  const outputs = [
    "broker.exe",
    "windows-node-private-v4.node",
    "esbuild-private-shim.dll",
  ].map((name) => capture("C:\\outputs\\" + name));
  const ledger = [
    {
      pid: 200,
      kind: "root",
      registrationId: rootId,
      parentRegistrationId: null,
      commandKind: "trusted-root-checker",
      stdioCount: 3,
    },
    {
      pid: 300,
      kind: "vitest-worker",
      registrationId: workerId,
      parentRegistrationId: rootId,
      commandKind: "frozen-vitest-forks-entry",
      stdioCount: 4,
    },
    {
      pid: 400,
      kind: "esbuild-service",
      registrationId: "97271425-103d-407f-ad04-36fa5a6c7611",
      parentRegistrationId: rootId,
      commandKind: "fixed-esbuild-service",
      stdioCount: 3,
    },
  ].map((row) => ({
    ...row,
    jobAssigned: true,
    tokenAndSameJobProven: true,
    mapInstalled: true,
    mapStatus: 0,
    wait: 0,
    exitKnown: true,
    exit: 0,
    registered: row.kind !== "esbuild-service",
    callerOriginalHandleRetained: row.kind !== "root",
    inheritedHandleCount:
      row.kind === "root" ? 9 : row.kind === "esbuild-service" ? 5 : 10,
    launchRequests: row.kind === "root" ? 1 : 0,
  }));
  const host = {
    schema: "chainlesschain.windows-private-broker/v4",
    status: "NOT_ADMITTED",
    completed: true,
    stage: "completed",
    error: 0,
    hostPid: 100,
    guardNodeLimit: 48000,
    guardNodeCount: 42,
    rootPid: 200,
    servicePid: 400,
    serviceTokenAndSameJobProven: true,
    serviceMapInstalled: true,
    serviceMapStatus: 0,
    serviceWait: 0,
    serviceExit: 0,
    serviceParent: "host-custodian",
    rootWait: 0,
    rootExit: 0,
    rootTokenAndSameJobProven: true,
    rootMapInstalled: true,
    cleanupConfirmed: true,
    jobActiveProcesses: 0,
    profileDeleted: true,
    loopbackExemptionAbsent: true,
    hostMapUnchanged: true,
    sessionId,
    generation,
    appContainerSid,
    creationLedger: ledger,
  };
  const report = {
    schema: "chainlesschain.windows-private-v4-diagnostic/v1",
    experimentKind: PRIVATE_V4_EXPERIMENT,
    mode: "original",
    status: "NOT_ADMITTED",
    experimental: true,
    admissionEligible: false,
    formalSample: false,
    fullFrozenReviewCompleted: false,
    root,
    sources,
    outputs,
    outputsAfter: structuredClone(outputs),
    driver: capture("C:\\sources\\windows-node-private-v4-diagnostic.mjs"),
    validatorSource: capture("C:\\sources\\windows-node-private-v4-result.mjs"),
    commands: [0, 1, 2].map(() => ({ status: 0 })),
    frozenInputs: {},
    stagedInputs: {},
    execution: {
      status: 0,
      signal: null,
      error: null,
      stdout: JSON.stringify(host),
    },
    manifests: [],
    receipts: [],
  };
  for (const [key, relative] of [
    ["config", "packages\\cli\\vitest.config.js"],
    ["test", "packages\\cli\\__tests__\\unit\\model-capabilities.test.js"],
  ]) {
    report.frozenInputs[key] = capture("C:\\frozen\\" + relative);
    const staged = {
      ...report.frozenInputs[key],
      path: root + "\\workspace\\tree\\" + relative,
    };
    report.stagedInputs[key] = { before: { ...staged }, after: { ...staged } };
  }
  const gitRows = [
    {
      path: "packages/cli/vitest.config.js",
      gitBlob: "d".repeat(40),
      mode: "100644",
      bytes: report.frozenInputs.config.bytes,
      digest: report.frozenInputs.config.digest,
    },
    {
      path: "packages/cli/__tests__/unit/model-capabilities.test.js",
      gitBlob: "a".repeat(40),
      mode: "100644",
      bytes: report.frozenInputs.test.bytes,
      digest: report.frozenInputs.test.digest,
    },
    {
      path: "packages/context-memory-kernel/package.json",
      gitBlob: "b".repeat(40),
      mode: "100644",
      bytes: 10,
      digest: "sha256:" + "c".repeat(64),
    },
  ];
  report.sourceClosure = capture(
    "C:\\frozen\\source-closure.json",
    JSON.stringify({
      projectCommit: "b2aa3aba082873570e85dce39b00754e5504ff37",
      files: gitRows,
    }),
  );
  report.frozenGitFiles = gitRows
    .filter((row) => row.path !== "packages/cli/vitest.config.js")
    .map((row) => ({
      ...row,
      staged:
        root +
        "\\workspace\\tree\\" +
        (row.path.startsWith("packages/context-memory-kernel/")
          ? row.path.replace(
              "packages/context-memory-kernel/",
              "node_modules/@chainlesschain/context-memory-kernel/",
            )
          : row.path
        ).replaceAll("/", "\\"),
    }));
  function pair(directory) {
    const suffix = directory ? "" : "\\control\\node.exe";
    const physical = {
      path: root + suffix,
      accessMode: "host-inherited-handle",
      ntPath: "\\Device\\HarddiskVolume3\\private-v4-result" + suffix,
      volumeSerial: "12345",
      fileId: (directory ? "1" : "2").repeat(32),
      directory,
      reparse: false,
      links: 1,
    };
    return {
      physical,
      logical: {
        ...physical,
        path: "X:\\" + suffix.replace(/^\\/u, ""),
        accessMode: "logical-dos",
      },
      handlesHeldTogether: true,
      componentsGuarded: true,
    };
  }
  for (const row of ledger.filter((row) => row.kind !== "esbuild-service")) {
    const role = row.kind === "root" ? "root" : "worker";
    const actor = {
      registrationId: row.registrationId,
      pid: row.pid,
      role,
      parentRegistrationId: row.parentRegistrationId,
    };
    const manifest = identity.createPrivateManifest({
      physicalRoot: root,
      sessionId,
      generation,
      appContainerSid,
      runtimeBytes: 123456,
      actor,
      files: Object.fromEntries(
        [
          ["identity", sources[7]],
          ["preload", sources[8]],
          ["addon", outputs[1]],
        ].map(([key, value]) => [
          key,
          { sha256: value.digest.slice(7), bytes: value.bytes },
        ]),
      ),
    });
    const manifestPath =
      role === "root"
        ? identity.MANIFEST_PATH
        : `X:\\control\\windows-node-private-v4.worker-${row.registrationId}.manifest.json`;
    const raw = JSON.stringify(manifest);
    report.manifests.push({
      path: manifestPath,
      raw,
      capture: capture(
        "C:\\outputs\\inputs\\" + row.registrationId + ".json",
        raw,
      ),
    });
    files.set(root + "\\" + manifestPath.slice(3), Buffer.from(raw));
    const native = {
      schema: identity.IDENTITY_SCHEMA,
      status: "NOT_ADMITTED",
      sessionId,
      generation,
      role,
      actor,
      brokerBinding: "exclusive-channel-original-creation-handle",
      nodeVersion: identity.NODE_VERSION,
      modulesAbi: identity.MODULES_ABI,
      token: { appContainerSid, capabilityCount: 0, inJob: true },
      root: pair(true),
      runtime: {
        ...pair(false),
        sha256: identity.RUNTIME_SHA256,
        bytes: 123456,
      },
    };
    for (const phase of ["installed", "exit"])
      report.receipts.push({
        schema: "chainlesschain.windows-node-private-preload/v4",
        status: "NOT_ADMITTED",
        trusted: false,
        admissionEligible: false,
        stage: "frozen-forks",
        role,
        phase,
        pid: row.pid,
        ppid: host.hostPid,
        parentage: "host-broker-created",
        actor,
        sessionId,
        generation,
        manifestPath,
        manifestSha256: identity.digest(raw),
        paired: identity.inspectPrivateIdentity(native, manifest),
        adapter: {
          pid: row.pid,
          appContainerSid,
          state: 2,
          patches: 6,
          installError: 0,
          capabilityCount: 0,
          inJob: true,
        },
        ...(phase === "exit" ? { exitCode: 0 } : {}),
      });
  }
  const journal = [
    { phase: "started" },
    { phase: "esbuild-completed", invalidRejected: true, servicePid: 400 },
    { phase: "config-loaded", pool: "forks", maxWorkers: 2, unhandled: [] },
    { phase: "test-results", count: 2, states: ["passed", "passed"] },
    { phase: "completed", tests: 2 },
  ].map((row, index) => ({ sequence: index + 1, pid: host.rootPid, ...row }));
  const text = journal.map((row) => JSON.stringify(row)).join("\n") + "\n";
  report["journal.jsonl"] = { text, digest: "sha256:" + identity.digest(text) };
  function evidence(name, value) {
    report[name] = { text: value, digest: "sha256:" + identity.digest(value) };
  }
  evidence(
    "service.json",
    JSON.stringify({
      invalidRejected: true,
      transform: { code: "const answer = 42;\n" },
      build: { errors: [] },
      configBundle: [{ text: 'pool: "forks", maxWorkers: 2' }],
    }),
  );
  const traceNt = pair(true).physical.ntPath;
  const trace = [
    "identity-accepted",
    "device-map-handle-access",
    "device-map-supervisor-handle",
    "device-map-root-proven",
    "device-map-file-id-proven",
    "namespace-host-root-denied",
    "namespace-workspace-write-denied",
    "namespace-traversal-confined",
    "installed",
    "exit",
  ].map((api, index) => ({
    sequence: index + 1,
    pid: 400,
    api,
    success: true,
    error: api.endsWith("-denied") ? 5 : 0,
    overflow: 0,
    patches: index >= 8 ? 2 : 0,
    requestedPath:
      api === "device-map-file-id-proven"
        ? "00003039:11111111:11111111"
        : ["device-map-root-proven", "namespace-traversal-confined"].includes(
              api,
            )
          ? traceNt
          : "",
  }));
  evidence(
    "esbuild-trace-1.jsonl",
    trace.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
  return {
    report: structuredClone(report),
    files,
    readArtifact: (name) => {
      if (!files.has(name)) throw Error("missing artifact");
      return files.get(name);
    },
  };
}
const editHost = (report, edit) => {
  const host = JSON.parse(report.execution.stdout);
  edit(host);
  report.execution.stdout = JSON.stringify(host);
};
test("otherwise complete synthetic diagnostic cannot satisfy the immutable frozen lock", () => {
  const { report, readArtifact } = fixture();
  const result = inspectPrivateV4Result(report, { readArtifact });
  assert.deepEqual(result.errors, [immutableLockError]);
  assert.equal(result.diagnosticVerified, false);
  assert.equal(result.status, "NOT_ADMITTED");
  assert.equal(result.fullFrozenReviewCompleted, false);
  assert.equal(result.admissionEligible, false);
});
for (const [name, change] of [
  [
    "failed outer execution",
    (r) => {
      r.execution.status = 2;
    },
  ],
  [
    "outer error with successful native payload",
    (r) => {
      r.error = "driver failed";
    },
  ],
  [
    "timed out process",
    (r) => {
      r.execution.error = "ETIMEDOUT";
    },
  ],
  [
    "full review escalation",
    (r) => {
      r.fullFrozenReviewCompleted = true;
    },
  ],
  [
    "helper substituted for actual fork",
    (r) =>
      editHost(r, (h) => {
        h.creationLedger[1].kind = "report-helper";
      }),
  ],
  [
    "worker was never assigned",
    (r) =>
      editHost(r, (h) => {
        h.creationLedger[1].jobAssigned = false;
      }),
  ],
  [
    "retained handle missing",
    (r) =>
      editHost(r, (h) => {
        h.creationLedger[1].callerOriginalHandleRetained = false;
      }),
  ],
  [
    "wait timeout",
    (r) =>
      editHost(r, (h) => {
        h.creationLedger[1].wait = 258;
      }),
  ],
  [
    "worker still active",
    (r) =>
      editHost(r, (h) => {
        h.creationLedger[1].exit = 259;
      }),
  ],
  [
    "unproven worker exit 143",
    (r) =>
      editHost(r, (h) => {
        h.creationLedger[1].exit = 143;
      }),
  ],
  [
    "wrong worker command",
    (r) =>
      editHost(r, (h) => {
        h.creationLedger[1].commandKind = "arbitrary-node";
      }),
  ],
  [
    "worker without IPC descriptor",
    (r) =>
      editHost(r, (h) => {
        h.creationLedger[1].stdioCount = 3;
      }),
  ],
  [
    "duplicate PID",
    (r) =>
      editHost(r, (h) => {
        h.creationLedger[1].pid = 200;
      }),
  ],
  [
    "unknown caller registration",
    (r) =>
      editHost(r, (h) => {
        h.creationLedger[1].parentRegistrationId = h.generation;
      }),
  ],
  [
    "Job still populated",
    (r) =>
      editHost(r, (h) => {
        h.jobActiveProcesses = 1;
      }),
  ],
  [
    "missing worker exit receipt",
    (r) => {
      r.receipts.pop();
    },
  ],
  [
    "worker receipt claims root",
    (r) => {
      r.receipts[2].role = "root";
    },
  ],
  [
    "manifest registration mismatch",
    (r) => {
      r.receipts[2].actor.pid++;
    },
  ],
  [
    "paired native FileID changed",
    (r) => {
      r.receipts[2].paired.native.root.logical.fileId = "4".repeat(32);
    },
  ],
  [
    "missing manifest",
    (r) => {
      r.manifests.pop();
    },
  ],
  [
    "journal forged digest",
    (r) => {
      r["journal.jsonl"].text += " ";
    },
  ],
  [
    "missing compiler result",
    (r) => {
      r.commands.pop();
    },
  ],
  [
    "source capture altered",
    (r) => {
      r.sources[0].digest = "sha256:" + "0".repeat(64);
    },
  ],
  [
    "artifact binding altered",
    (r) => {
      r.outputs[1].bytes++;
    },
  ],
])
  test("rejects " + name, () => {
    const { report, readArtifact } = fixture();
    change(report);
    const result = inspectPrivateV4Result(report, { readArtifact });
    rejectedBeyondFixtureLock(result);
  });
test("retained files are read again instead of trusting captured digests", () => {
  const { report, files, readArtifact } = fixture();
  files.set(report.sources[0].path, Buffer.from("changed"));
  rejectedBeyondFixtureLock(inspectPrivateV4Result(report, { readArtifact }));
});
test("staged post-run test digest must equal the retained frozen input", () => {
  const { report, readArtifact } = fixture();
  report.stagedInputs.test.after.digest =
    "sha256:" + identity.digest("replacement test");
  rejectedBeyondFixtureLock(inspectPrivateV4Result(report, { readArtifact }));
});
test("archived inputs remain verifiable when the protected staging tree is unreadable", () => {
  const { report, files, readArtifact } = fixture();
  for (const key of files.keys())
    if (key.startsWith(report.root + "\\")) files.delete(key);
  assert.deepEqual(inspectPrivateV4Result(report, { readArtifact }).errors, [
    immutableLockError,
  ]);
});
test("a missing before snapshot cannot be replaced by only an after hash", () => {
  const { report, readArtifact } = fixture();
  delete report.stagedInputs.test.before;
  rejectedBeyondFixtureLock(inspectPrivateV4Result(report, { readArtifact }));
});
test("malformed or absent reports are rejected without success", () => {
  for (const value of [
    undefined,
    null,
    {},
    { execution: { stdout: "{" } },
    { execution: { stdout: "null" } },
    { execution: { stdout: "[]" } },
  ])
    assert.equal(inspectPrivateV4Result(value).diagnosticVerified, false);
});
test("malformed ledger and non-text manifest payloads cannot bypass rejection", () => {
  const { report, readArtifact } = fixture();
  editHost(report, (host) => {
    host.creationLedger.unshift(null);
  });
  report.manifests[0].raw = JSON.parse(report.manifests[0].raw);
  rejectedBeyondFixtureLock(inspectPrivateV4Result(report, { readArtifact }));
});

function withHostTermination(report) {
  editHost(report, (host) =>
    Object.assign(host.creationLedger[1], {
      exit: 1,
      creationSequence: 2,
      terminationRequested: true,
      terminationExitCode: 1,
      preTerminationWait: 258,
      preTerminationExit: 259,
      terminationCallSucceeded: true,
      terminationCallError: 0,
      terminationWait: 0,
      actualExit: 1,
      terminationRequesterRegistrationId: host.creationLedger[0].registrationId,
      terminationChildSequence: 2,
      callerHandleObjectCompared: true,
    }),
  );
  report.receipts = report.receipts.filter(
    (receipt) => !(receipt.role === "worker" && receipt.phase === "exit"),
  );
}
function rewriteEvidence(report, name, edit, lines = false) {
  const value = lines
    ? report[name].text.trim().split("\n").map(JSON.parse)
    : JSON.parse(report[name].text);
  edit(value);
  const text = lines
    ? value.map((row) => JSON.stringify(row)).join("\n") + "\n"
    : JSON.stringify(value);
  report[name] = { text, digest: "sha256:" + identity.digest(text) };
}
for (const [name, mutate] of [
  [
    "missing real service",
    (r) =>
      editHost(r, (h) => {
        h.creationLedger.pop();
      }),
  ],
  [
    "different service command",
    (r) =>
      editHost(r, (h) => {
        h.creationLedger[2].commandKind = "arbitrary-service";
      }),
  ],
  [
    "invalid TypeScript accepted",
    (r) =>
      rewriteEvidence(r, "service.json", (value) => {
        value.invalidRejected = false;
      }),
  ],
  [
    "bundled configuration changed",
    (r) =>
      rewriteEvidence(r, "service.json", (value) => {
        value.configBundle[0].text = 'pool: "threads", maxWorkers: 2';
      }),
  ],
  [
    "borrowed shim PID",
    (r) =>
      rewriteEvidence(
        r,
        "esbuild-trace-1.jsonl",
        (rows) => {
          rows[0].pid++;
        },
        true,
      ),
  ],
  [
    "shim trace overflow",
    (r) =>
      rewriteEvidence(
        r,
        "esbuild-trace-1.jsonl",
        (rows) => {
          rows[0].overflow = 1;
        },
        true,
      ),
  ],
  [
    "namespace check failed",
    (r) =>
      rewriteEvidence(
        r,
        "esbuild-trace-1.jsonl",
        (rows) => {
          rows.find((row) => row.api === "namespace-host-root-denied").success =
            false;
        },
        true,
      ),
  ],
  [
    "shim root FileID differs",
    (r) =>
      rewriteEvidence(
        r,
        "esbuild-trace-1.jsonl",
        (rows) => {
          rows.find(
            (row) => row.api === "device-map-file-id-proven",
          ).requestedPath = "00000001:11111111:11111111";
        },
        true,
      ),
  ],
  [
    "missing shim exit",
    (r) =>
      rewriteEvidence(
        r,
        "esbuild-trace-1.jsonl",
        (rows) => {
          rows.pop();
        },
        true,
      ),
  ],
  [
    "missing validator snapshot",
    (r) => {
      delete r.validatorSource;
    },
  ],
  [
    "post-run binary differs",
    (r) => {
      r.outputsAfter[0].bytes++;
    },
  ],
  [
    "wrong experiment mode",
    (r) => {
      r.mode = "protocol-negative";
    },
  ],
])
  test("rejects " + name + " even after evidence text is rehashed", () => {
    const { report, readArtifact } = fixture();
    mutate(report);
    rejectedBeyondFixtureLock(inspectPrivateV4Result(report, { readArtifact }));
  });
test("config pre/post self-consistency cannot replace binding to the frozen closure", () => {
  const { report, files, readArtifact } = fixture();
  const bytes = Buffer.from("replacement config");
  files.set(report.frozenInputs.config.path, bytes);
  const replacement = {
    bytes: bytes.length,
    digest: "sha256:" + identity.digest(bytes),
  };
  Object.assign(report.frozenInputs.config, replacement);
  for (const phase of ["before", "after"])
    Object.assign(report.stagedInputs.config[phase], replacement);
  const result = inspectPrivateV4Result(report, { readArtifact });
  assert.ok(
    result.errors.includes("config input differs from frozen Git blob"),
  );
});
test("rewriting config and its closure together still cannot replace the immutable closure digest", () => {
  const { report, files, readArtifact } = fixture();
  const bytes = Buffer.from("replacement config");
  files.set(report.frozenInputs.config.path, bytes);
  const replacement = {
    bytes: bytes.length,
    digest: "sha256:" + identity.digest(bytes),
  };
  Object.assign(report.frozenInputs.config, replacement);
  for (const phase of ["before", "after"])
    Object.assign(report.stagedInputs.config[phase], replacement);
  const closure = JSON.parse(files.get(report.sourceClosure.path));
  Object.assign(
    closure.files.find((row) => row.path === "packages/cli/vitest.config.js"),
    replacement,
  );
  const closureBytes = Buffer.from(JSON.stringify(closure));
  files.set(report.sourceClosure.path, closureBytes);
  Object.assign(report.sourceClosure, {
    bytes: closureBytes.length,
    digest: "sha256:" + identity.digest(closureBytes),
  });
  const result = inspectPrivateV4Result(report, { readArtifact });
  assert.deepEqual(result.errors, [immutableLockError]);
  assert.equal(result.diagnosticVerified, false);
});
test("host original-handle termination replaces only the killed worker exit event", () => {
  const { report, readArtifact } = fixture();
  withHostTermination(report);
  assert.deepEqual(inspectPrivateV4Result(report, { readArtifact }).errors, [
    immutableLockError,
  ]);
});
for (const [name, mutate] of [
  [
    "already signaled before kill",
    (row) => {
      row.preTerminationWait = 0;
    },
  ],
  [
    "already exited before kill",
    (row) => {
      row.preTerminationExit = 1;
    },
  ],
  [
    "unobserved pre-wait",
    (row) => {
      delete row.preTerminationWait;
    },
  ],
  [
    "termination call failed",
    (row) => {
      row.terminationCallSucceeded = false;
    },
  ],
  [
    "contradictory termination error",
    (row) => {
      row.terminationCallError = 5;
    },
  ],
  [
    "missing termination error",
    (row) => {
      delete row.terminationCallError;
    },
  ],
  [
    "untyped termination error",
    (row) => {
      row.terminationCallError = "0";
    },
  ],
  [
    "post-termination timeout",
    (row) => {
      row.terminationWait = 258;
    },
  ],
  [
    "post-termination still active",
    (row) => {
      row.actualExit = 259;
    },
  ],
  [
    "unrequested kill",
    (row) => {
      row.terminationRequested = false;
    },
  ],
  [
    "unbound request sequence",
    (row) => {
      row.terminationChildSequence++;
    },
  ],
  [
    "unknown birth sequence",
    (row) => {
      delete row.creationSequence;
    },
  ],
  [
    "different caller",
    (row) => {
      row.terminationRequesterRegistrationId = row.registrationId;
    },
  ],
  [
    "handle value without object comparison",
    (row) => {
      row.callerHandleObjectCompared = false;
    },
  ],
  [
    "wrong requested exit",
    (row) => {
      row.terminationExitCode = 143;
    },
  ],
  [
    "different actual exit",
    (row) => {
      row.exit = 143;
    },
  ],
])
  test("rejects host termination " + name, () => {
    const { report, readArtifact } = fixture();
    withHostTermination(report);
    editHost(report, (host) => mutate(host.creationLedger[1]));
    rejectedBeyondFixtureLock(inspectPrivateV4Result(report, { readArtifact }));
  });
test("a host termination attestation cannot excuse root failure", () => {
  const { report, readArtifact } = fixture();
  withHostTermination(report);
  editHost(report, (host) => {
    host.rootExit = 1;
  });
  rejectedBeyondFixtureLock(inspectPrivateV4Result(report, { readArtifact }));
});
function reviewFixture(mutant = false) {
  const result = fixture();
  const { report, files } = result;
  const capture = (path, text) => {
    const bytes = Buffer.from(text);
    files.set(path, bytes);
    return {
      path,
      bytes: bytes.length,
      digest: "sha256:" + identity.digest(bytes),
    };
  };
  const closure = JSON.parse(files.get(report.sourceClosure.path));
  report.mode = mutant ? "review-mutant" : "review-baseline";
  report.experimentKind = mutant
    ? "external-locked-review-mutant"
    : "external-locked-review-baseline";
  const support = [
    [
      "globalSetup",
      "packages/cli/test/global-setup/windows-sandbox-adapter-temp-root.js",
    ],
    ["setup", "packages/cli/test/setup/windows-sandbox-adapter-cleanup.js"],
    ["setup", "packages/cli/test/setup/agent-evolution-test-boundary.js"],
  ].map(([kind, source]) => {
    const captured = capture("C:\\review\\" + source, source);
    closure.files.push({
      path: source,
      gitBlob: "e".repeat(40),
      mode: "100644",
      bytes: captured.bytes,
      digest: captured.digest,
    });
    return { kind, source, capture: captured };
  });
  const tests = ["packages/cli/__tests__/unit/model-capabilities.test.js"];
  const config = {
    test: {
      root: "X:/workspace/tree",
      include: tests,
      pool: "forks",
      maxWorkers: 1,
      globalSetup: support
        .filter((x) => x.kind === "globalSetup")
        .map((x) => "X:/workspace/tree/" + x.source),
      setupFiles: support
        .filter((x) => x.kind === "setup")
        .map((x) => "X:/workspace/tree/" + x.source),
    },
  };
  report.review = {
    tests,
    taskIds: ["verify-01"],
    support,
    config: capture(
      "C:\\review\\config.mjs",
      "export default " + JSON.stringify(config) + ";\n",
    ),
    specs: capture("C:\\review\\specs.mjs", "specs"),
    runtime: capture("C:\\review\\runtime.mjs", "runtime"),
  };
  report.sourceClosure = capture(
    report.sourceClosure.path,
    JSON.stringify(closure),
  );
  report.frozenGitFiles = closure.files.map((row) => ({
    ...row,
    staged:
      report.root + "\\workspace\\tree\\" + row.path.replaceAll("/", "\\"),
  }));
  if (mutant) {
    report.execution.status = 2;
    editHost(report, (host) => {
      host.completed = false;
      host.stage = "root-settlement";
      host.error = 1;
      host.rootExit = 1;
      host.creationLedger[0].exit = 1;
    });
    report.receipts.find(
      (row) => row.role === "root" && row.phase === "exit",
    ).exitCode = 1;
    const row = report.frozenGitFiles.find((row) =>
      row.path.startsWith("packages/context-memory-kernel/"),
    );
    const snapshot = capture("C:\\review\\mutant-source.js", "mutated source");
    report.mutation = {
      name: "controlled mutation",
      taskId: "verify-01",
      sourcePath: row.path,
      before: { path: row.staged, bytes: row.bytes, digest: row.digest },
      after: { ...snapshot, path: row.staged },
      snapshot,
    };
  }
  return result;
}
for (const mutant of [false, true])
  test(`review ${mutant ? "mutant" : "baseline"} settlement remains separate from immutable admission`, () => {
    const { report, readArtifact } = reviewFixture(mutant);
    const result = inspectPrivateV4Settlement(report, {
      readArtifact,
      expectedRootExit: mutant ? 1 : 0,
    });
    assert.deepEqual(result.errors, [immutableLockError]);
    assert.equal(result.nativeSettlementConfirmed, false);
    assert.equal(result.admissionEligible, false);
    assert.equal(result.fullFrozenReviewCompleted, false);
    assert.equal(result.diagnosticVerified, undefined);
    assert.ok(
      inspectPrivateV4Result(report, { readArtifact }).errors.includes(
        "experiment identity differs",
      ),
    );
  });
for (const [name, mutant, change] of [
  [
    "parser approval cannot waive active Job",
    false,
    (r) => {
      r.acceptedByFrozenParser = true;
      editHost(r, (h) => {
        h.jobActiveProcesses = 1;
      });
    },
  ],
  [
    "baseline unexpected root failure",
    false,
    (r) =>
      editHost(r, (h) => {
        h.rootExit = 1;
        h.creationLedger[0].exit = 1;
      }),
  ],
  [
    "mutant root timeout",
    true,
    (r) =>
      editHost(r, (h) => {
        h.rootWait = 258;
      }),
  ],
  [
    "mutant worker failure without attribution",
    true,
    (r) =>
      editHost(r, (h) => {
        h.creationLedger[1].exit = 1;
      }),
  ],
  [
    "missing actor exit receipt",
    false,
    (r) => {
      r.receipts = r.receipts.filter(
        (x) => !(x.role === "worker" && x.phase === "exit"),
      );
    },
  ],
  [
    "missing full staged source",
    false,
    (r) => {
      r.frozenGitFiles.pop();
    },
  ],
  [
    "duplicate support source",
    false,
    (r) => {
      r.review.support[1] = structuredClone(r.review.support[0]);
    },
  ],
  [
    "unretained mutation source",
    true,
    (r) => {
      delete r.mutation.snapshot;
    },
  ],
  [
    "different mutation task",
    true,
    (r) => {
      r.mutation.taskId = "verify-other";
    },
  ],
  [
    "unchanged mutation bytes",
    true,
    (r) => {
      r.mutation.after.digest = r.mutation.before.digest;
    },
  ],
])
  test(`review settlement rejects ${name}`, () => {
    const { report, readArtifact } = reviewFixture(mutant);
    change(report);
    const result = inspectPrivateV4Settlement(report, {
      readArtifact,
      expectedRootExit: mutant ? 1 : 0,
    });
    assert.equal(result.nativeSettlementConfirmed, false);
    assert.ok(result.errors.some((error) => error !== immutableLockError));
  });
test("review settlement requires explicit expected root exit", () => {
  const { report, readArtifact } = reviewFixture();
  assert.ok(
    inspectPrivateV4Settlement(report, { readArtifact }).errors.includes(
      "diagnostic mode differs from requested settlement",
    ),
  );
});
test("review settlement permits no esbuild service when no service was created", () => {
  const { report, readArtifact } = reviewFixture();
  editHost(report, (h) => {
    h.creationLedger = h.creationLedger.filter(
      (r) => r.kind !== "esbuild-service",
    );
    h.servicePid = 0;
  });
  assert.deepEqual(
    inspectPrivateV4Settlement(report, { readArtifact, expectedRootExit: 0 })
      .errors,
    [immutableLockError],
  );
});
for (const [name, edit, valid] of [
  ["explicit callback intent with exact host termination", () => {}, true],
  [
    "callback intent missing disposition",
    (r) => {
      delete r.receipts.at(-1).exitDisposition;
    },
    false,
  ],
  [
    "callback intent concealing callback failure",
    (r) => {
      r.receipts.at(-1).exitCode = 2;
    },
    false,
  ],
  [
    "callback intent without original handle comparison",
    (r) =>
      editHost(r, (h) => {
        h.creationLedger[1].callerHandleObjectCompared = false;
      }),
    false,
  ],
  [
    "duplicate callback intent",
    (r) => r.receipts.push(structuredClone(r.receipts.at(-1))),
    false,
  ],
])
  test(name, () => {
    const { report, readArtifact } = fixture();
    const receipt = structuredClone(
      report.receipts.find((x) => x.role === "worker" && x.phase === "exit"),
    );
    withHostTermination(report);
    receipt.exitDisposition = "process-exit-intent";
    report.receipts.push(receipt);
    edit(report);
    const result = inspectPrivateV4Result(report, { readArtifact });
    if (valid) assert.deepEqual(result.errors, [immutableLockError]);
    else rejectedBeyondFixtureLock(result);
  });
test("already exited worker remains ordinary zero exit with callback receipt", () => {
  const { report, readArtifact } = reviewFixture();
  editHost(report, (h) =>
    Object.assign(h.creationLedger[1], {
      preTerminationWait: 0,
      preTerminationExit: 0,
      actualExit: 0,
      terminationCallSucceeded: false,
      terminationRequested: false,
    }),
  );
  report.receipts.find(
    (r) => r.role === "worker" && r.phase === "exit",
  ).exitDisposition = "process-exit-intent";
  assert.deepEqual(
    inspectPrivateV4Settlement(report, { readArtifact, expectedRootExit: 0 })
      .errors,
    [immutableLockError],
  );
});
test("already exited worker with nonzero actual exit has no host termination exemption", () => {
  const { report, readArtifact } = reviewFixture();
  editHost(report, (h) =>
    Object.assign(h.creationLedger[1], {
      preTerminationWait: 0,
      preTerminationExit: 1,
      actualExit: 1,
      exit: 1,
      terminationCallSucceeded: false,
      terminationRequested: false,
    }),
  );
  report.receipts.find(
    (r) => r.role === "worker" && r.phase === "exit",
  ).exitDisposition = "process-exit-intent";
  const result = inspectPrivateV4Settlement(report, {
    readArtifact,
    expectedRootExit: 0,
  });
  assert.ok(result.errors.includes("creation 300 did not settle successfully"));
});
function dependencyReviewFixture(t) {
  const f = reviewFixture();
  const { report, files } = f;
  const capture = (name, bytes) => {
    const content = Buffer.from(bytes);
    files.set(name, content);
    return {
      path: name,
      bytes: content.length,
      digest: "sha256:" + identity.digest(content),
    };
  };
  const tree = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "cc-v4-dependency-review-")),
  );
  t.after(() => fs.rmSync(tree, { recursive: true, force: true }));
  const rows = [
    ["node_modules/fixture/.gitkeep", ""],
    ["packages/cli/node_modules/fixture/index.js", "export default 1;\n"],
  ].map(([relative, text]) => {
    const sourcePath = path.join(tree, relative);
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, text);
    return {
      path: relative,
      bytes: Buffer.byteLength(text),
      digest: "sha256:" + identity.digest(text),
    };
  });
  report.dependencies = capture(
    "C:\\review\\dependency-manifest.json",
    JSON.stringify({ files: rows }),
  );
  report.dependencyValidatorSource = capture(
    "C:\\sources\\windows-node-private-v4-dependencies.mjs",
    "retained helper snapshot",
  );
  report.dependencyTree = tree;
  report.dependencyFiles = rows.map((row) => {
    const { bytes, digest } = row;
    const staged = {
      path: path.win32.join(report.root, "workspace/tree", row.path),
      bytes,
      digest,
    };
    return {
      ...row,
      source: { path: path.join(tree, row.path), bytes, digest },
      before: { ...staged },
      after: { ...staged },
    };
  });
  return f;
}
test("review dependency custody accepts retained zero-byte and nested workspace files", (t) => {
  const { report, readArtifact } = dependencyReviewFixture(t);
  assert.deepEqual(
    inspectPrivateV4Settlement(report, { readArtifact, expectedRootExit: 0 })
      .errors,
    [immutableLockError],
  );
});
for (const [name, change] of [
  [
    "missing helper snapshot",
    (r) => {
      delete r.dependencyValidatorSource;
    },
  ],
  [
    "missing staged file",
    (r) => {
      r.dependencyFiles.pop();
    },
  ],
  [
    "duplicate staged path",
    (r) => {
      r.dependencyFiles[1] = structuredClone(r.dependencyFiles[0]);
    },
  ],
  [
    "wrong staged after digest",
    (r) => {
      r.dependencyFiles[0].after.digest = "sha256:" + "f".repeat(64);
    },
  ],
  [
    "extra staged bytes for empty file",
    (r) => {
      r.dependencyFiles[0].after.bytes = 1;
    },
  ],
  [
    "source path outside retained tree",
    (r) => {
      r.dependencyFiles[0].source.path = "C:\\outside\\empty";
    },
  ],
  [
    "staged target outside capsule workspace",
    (r) => {
      r.dependencyFiles[1].before.path = "C:\\outside\\index.js";
    },
  ],
  [
    "retained empty file gained bytes",
    (r) => {
      fs.writeFileSync(r.dependencyFiles[0].source.path, "unexpected");
    },
  ],
  [
    "retained manifest removed",
    (r) => {
      delete r.dependencies;
    },
  ],
])
  test(`review dependency custody rejects ${name}`, (t) => {
    const { report, readArtifact } = dependencyReviewFixture(t);
    change(report);
    const result = inspectPrivateV4Settlement(report, {
      readArtifact,
      expectedRootExit: 0,
    });
    assert.equal(result.nativeSettlementConfirmed, false);
    assert.ok(result.errors.some((error) => error !== immutableLockError));
  });
for (const [name, edit] of [
  [
    "missing native guard count",
    (h) => {
      delete h.guardNodeCount;
    },
  ],
  [
    "empty native guard count",
    (h) => {
      h.guardNodeCount = 0;
    },
  ],
  [
    "overflow native guard count",
    (h) => {
      h.guardNodeCount = 48001;
    },
  ],
  [
    "fractional native guard count",
    (h) => {
      h.guardNodeCount = 1.5;
    },
  ],
  [
    "caller-selected guard limit",
    (h) => {
      h.guardNodeLimit = 96000;
    },
  ],
])
  test(`rejects ${name}`, () => {
    const { report, readArtifact } = fixture();
    editHost(report, edit);
    const result = inspectPrivateV4Result(report, { readArtifact });
    assert.ok(
      result.errors.includes("native guard count or fixed limit differs"),
    );
  });
