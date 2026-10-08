import test from "node:test";
import assert from "node:assert/strict";
import { evalDigest } from "../src/lib/eval/evidence.js";
import { inspectPipeRuntimeResult } from "../scripts/windows-node-pipe-diagnostic.mjs";

const schema = "chainlesschain/windows-node-pipe-adapter@1";
const digest = "sha256:" + "a".repeat(64);
function sample() {
  const native = (pid, active = false) => ({
    schema,
    experimental: true,
    admissionEligible: false,
    pid,
    appContainerSid: "S-1-15-2-1-2-3-4-5-6-7",
    capabilityCount: 0,
    inJob: true,
    state: 2,
    patches: 2,
    installError: 0,
    serverCalls: active ? 22 : 0,
    clientCalls: active ? 10 : 0,
    serverMapped: active ? 22 : 0,
    clientMapped: active ? 10 : 0,
  });
  const observations = ["sync", "async", "fork"].map((mode, index) => ({
    marker: "cc-adapted-child",
    mode,
    pid: 200 + index,
    ppid: 100,
    inputDigest: "b".repeat(64),
    bytes: 97,
  }));
  const frame = { schema, pid: 100, observations, native: native(100, true) };
  const journal = [
    "started",
    "installed",
    "sync-started",
    "sync-completed",
    "async-started",
    "async-completed",
    "fork-started",
    "fork-completed",
    "completed",
  ].map((stage, seq) => ({
    stage,
    seq,
    pid: 100,
    ...(seq === 1 ? { native: native(100) } : {}),
    ...([3, 5, 7].includes(seq) ? { childPid: 200 + (seq - 3) / 2 } : {}),
    ...(seq === 8 ? { observations, native: frame.native } : {}),
  }));
  const r = {
    schema: "chainlesschain.windows-node-pipe-runtime-diagnostic/v1",
    experimental: true,
    admissionEligible: false,
    formalSample: false,
    providerAssessed: false,
    capabilities: {},
    nodeVersion: "v22.22.2",
    manifestDigest: digest,
    runtimeDigest: digest,
    addonDigest: digest,
    preloadDigest: digest,
    adapterManifestDigest: digest,
    inputDigest: "b".repeat(64),
    manifest: { runtime: { path: "C:\\private\\control\\node.exe" } },
    execution: {
      status: 0,
      signal: null,
      error: null,
      stdout: "CC_PIPE_RUNTIME:" + JSON.stringify(frame) + "\n",
      stderr: "",
    },
    settlement: {
      cleanupConfirmed: true,
      executionFailed: false,
      targetExitCode: 0,
      targetPid: 100,
      capabilityCount: 0,
      loopbackExemptionAbsent: true,
      manifestDigest: digest.slice(7),
      appContainerSid: frame.native.appContainerSid,
    },
    adapterReceipts: [100, 200, 201, 202].flatMap((pid) =>
      ["installed", "exit"].map((phase) => ({
        schema,
        experimental: true,
        admissionEligible: false,
        pid,
        ppid: pid === 100 ? 90 : 100,
        phase,
        execPath: "C:\\private\\control\\node.exe",
        nodeVersion: "22.22.2",
        manifestSha256: digest.slice(7),
        runtimeSha256: digest.slice(7),
        addonSha256: digest.slice(7),
        preloadSha256: digest.slice(7),
        native: native(pid, pid === 100 && phase === "exit"),
        ...(phase === "exit" ? { exitCode: 0 } : {}),
      })),
    ),
  };
  setJournal(r, journal);
  return r;
}
function setJournal(r, rows) {
  r.journal = rows.map((row) => JSON.stringify(row) + "\n").join("");
  r.journalDigest = evalDigest(Buffer.from(r.journal));
}
function editFrame(r, edit) {
  const frame = JSON.parse(r.execution.stdout.slice("CC_PIPE_RUNTIME:".length));
  edit(frame);
  r.execution.stdout = "CC_PIPE_RUNTIME:" + JSON.stringify(frame) + "\n";
}
function editJournal(r, edit) {
  const rows = r.journal
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  edit(rows);
  setJournal(r, rows);
}
test("binds sync, async and fork observations to all eight process receipts and journal", () => {
  assert.equal(inspectPipeRuntimeResult(sample()).observations.length, 3);
});
for (const [name, edit] of [
  [
    "formal sample promotion",
    (r) => {
      r.formalSample = true;
    },
  ],
  [
    "admission promotion",
    (r) => {
      r.admissionEligible = true;
    },
  ],
  [
    "provider claim",
    (r) => {
      r.providerAssessed = true;
    },
  ],
  [
    "capability promotion",
    (r) => {
      r.capabilities.pipe = true;
    },
  ],
  [
    "bad digest",
    (r) => {
      r.addonDigest = "missing";
    },
  ],
  [
    "missing cleanup",
    (r) => {
      r.settlement.cleanupConfirmed = false;
    },
  ],
  [
    "target failure",
    (r) => {
      r.execution.status = 1;
    },
  ],
  [
    "unexpected stderr",
    (r) => {
      r.execution.stderr = "failure";
    },
  ],
  [
    "network capability",
    (r) => {
      r.settlement.capabilityCount = 1;
    },
  ],
  [
    "loopback exemption",
    (r) => {
      r.settlement.loopbackExemptionAbsent = false;
    },
  ],
  [
    "duplicated completion",
    (r) => {
      r.execution.stdout += r.execution.stdout;
    },
  ],
  [
    "target substitution",
    (r) =>
      editFrame(r, (f) => {
        f.pid++;
      }),
  ],
  [
    "unused server hook",
    (r) =>
      editFrame(r, (f) => {
        f.native.serverMapped = 0;
      }),
  ],
  [
    "unused client hook",
    (r) =>
      editFrame(r, (f) => {
        f.native.clientMapped = 0;
      }),
  ],
  [
    "nonisolated native token",
    (r) =>
      editFrame(r, (f) => {
        f.native.inJob = false;
      }),
  ],
  [
    "wrong child content",
    (r) =>
      editFrame(r, (f) => {
        f.observations[0].inputDigest = "c".repeat(64);
      }),
  ],
  [
    "missing child",
    (r) =>
      editFrame(r, (f) => {
        f.observations.pop();
      }),
  ],
  [
    "duplicate child PID",
    (r) =>
      editFrame(r, (f) => {
        f.observations[1].pid = f.observations[0].pid;
      }),
  ],
  [
    "child parent substitution",
    (r) =>
      editFrame(r, (f) => {
        f.observations[2].ppid++;
      }),
  ],
  [
    "missing child preload",
    (r) => {
      r.adapterReceipts.splice(2, 1);
    },
  ],
  [
    "missing child exit",
    (r) => {
      r.adapterReceipts.pop();
    },
  ],
  [
    "duplicate receipts",
    (r) => {
      r.adapterReceipts.push(r.adapterReceipts[0]);
    },
  ],
  [
    "wrong child SID",
    (r) => {
      r.adapterReceipts[2].native.appContainerSid += "-8";
    },
  ],
  [
    "wrong runtime",
    (r) => {
      r.adapterReceipts[2].runtimeSha256 = "b".repeat(64);
    },
  ],
  [
    "wrong preload",
    (r) => {
      r.adapterReceipts[2].preloadSha256 = "b".repeat(64);
    },
  ],
  [
    "wrong manifest",
    (r) => {
      r.adapterReceipts[2].manifestSha256 = "b".repeat(64);
    },
  ],
  [
    "host executable",
    (r) => {
      r.adapterReceipts[2].execPath = "C:\\host\\node.exe";
    },
  ],
  [
    "child install error",
    (r) => {
      r.adapterReceipts[2].native.installError = 5;
    },
  ],
  [
    "child exit failure",
    (r) => {
      r.adapterReceipts[3].exitCode = 1;
    },
  ],
  [
    "negative counter",
    (r) => {
      r.adapterReceipts[2].native.serverCalls = -1;
    },
  ],
  [
    "regressed counter",
    (r) => {
      r.adapterReceipts[2].native.serverCalls = 2;
    },
  ],
  [
    "missing journal",
    (r) => {
      delete r.journal;
    },
  ],
  [
    "journal substitution",
    (r) => {
      r.journal += "{}\n";
    },
  ],
  [
    "journal failure stage",
    (r) =>
      editJournal(r, (rows) => {
        rows[4].stage = "failed";
      }),
  ],
  [
    "missing journal stage",
    (r) =>
      editJournal(r, (rows) => {
        rows.splice(2, 1);
      }),
  ],
  [
    "journal reorder",
    (r) =>
      editJournal(r, (rows) => {
        [rows[2], rows[3]] = [rows[3], rows[2]];
      }),
  ],
  [
    "journal PID substitution",
    (r) =>
      editJournal(r, (rows) => {
        rows[4].pid++;
      }),
  ],
  [
    "journal child substitution",
    (r) =>
      editJournal(r, (rows) => {
        rows[5].childPid++;
      }),
  ],
  [
    "journal/frame data mismatch",
    (r) =>
      editJournal(r, (rows) => {
        rows.at(-1).observations[0].bytes++;
      }),
  ],
  [
    "journal installation mismatch",
    (r) =>
      editJournal(r, (rows) => {
        rows[1].native.installError = 5;
      }),
  ],
])
  test(`rejects ${name}`, () => {
    const r = sample();
    edit(r);
    assert.throws(
      () => inspectPipeRuntimeResult(r),
      /Experimental pipe diagnostic/,
    );
  });
