import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  GNU_IDENTITY,
  GNU_EXPECTED,
  GNU_CHECK_SOURCE,
  digest,
  capture,
  inspectPe,
  inspectForwardingClosure,
  inspectGnuResult,
} from "../scripts/windows-rollup-gnu-forwarder.mjs";

const directory = fileURLToPath(new URL("../scripts/", import.meta.url));
const sourceNames = [
  "diagnostics/windows-rollup-gnu-forwarder.cpp",
  "diagnostics/windows-rollup-gnu-forwarder.def",
  "windows-rollup-gnu-forwarder.mjs",
];
const symbols = fs
  .readFileSync(path.join(directory, sourceNames[1]), "utf8")
  .split(/\r?\n/u)
  .filter((line) => line.includes("="))
  .map((line) => line.trim().split("=")[0]);
function closure() {
  return {
    addon: { imports: [{ dll: "libnode.dll", names: [...symbols] }] },
    runtime: {
      exports: Object.fromEntries(symbols.map((name) => [name, null])),
    },
    forwarder: {
      exports: {
        ...Object.fromEntries(
          symbols.map((name) => [name, "node.exe." + name]),
        ),
        napi_register_module_v1: null,
        node_api_module_get_api_version_v1: null,
      },
    },
  };
}
test("closure requires the 41 N-API addresses to forward to the fixed Node module", () => {
  assert.equal(
    inspectForwardingClosure(closure()).importedFunctions.length,
    41,
  );
});
for (const [label, mutate] of [
  ["missing import", (c) => c.addon.imports[0].names.pop()],
  [
    "duplicate import",
    (c) => (c.addon.imports[0].names[1] = c.addon.imports[0].names[0]),
  ],
  ["ordinal in N-API population", (c) => (c.addon.imports[0].names[0] = "#41")],
  ["second libnode import", (c) => c.addon.imports.push(c.addon.imports[0])],
  ["missing runtime export", (c) => delete c.runtime.exports[symbols[0]]],
  [
    "different forwarded module",
    (c) => (c.forwarder.exports[symbols[0]] = "untrusted." + symbols[0]),
  ],
  ["extra forwarder export", (c) => (c.forwarder.exports.unexpected = null)],
  [
    "missing bootstrap",
    (c) => delete c.forwarder.exports.napi_register_module_v1,
  ],
]) {
  test("closure rejects " + label, () => {
    const c = closure();
    mutate(c);
    assert.throws(() => inspectForwardingClosure(c));
  });
}
test("PE reader rejects truncated and non-x64 inputs before traversing tables", () => {
  for (const value of [null, Buffer.alloc(0), Buffer.alloc(256)])
    assert.throws(() => inspectPe(value));
  const bytes = Buffer.alloc(512);
  bytes.writeUInt16LE(0x5a4d);
  bytes.writeUInt32LE(128, 60);
  bytes.writeUInt32LE(0x4550, 128);
  bytes.writeUInt16LE(0x14c, 132);
  assert.throws(() => inspectPe(bytes), /x64 PE/u);
});
function seal(report, rows) {
  report.journalRaw = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  report.journalDigest = digest(report.journalRaw);
  const frame = Object.fromEntries(
    Object.entries(rows.at(-1)).filter(
      ([key]) => !["stage", "sequence", "pid"].includes(key),
    ),
  );
  report.execution.stdout = "CC_GNU_FORWARDER:" + JSON.stringify(frame) + "\n";
}
function fixture() {
  const root = "C:\\private-gnu-fixture",
    sources = sourceNames.map((name) => capture(path.join(directory, name)));
  const runtime = { digest: GNU_IDENTITY.runtimeDigest },
    addon = { bytes: 2011136, digest: GNU_IDENTITY.addonDigest };
  const forwarder = { bytes: 49664, digest: "sha256:" + "1".repeat(64) };
  const build = {
    schema: "chainlesschain.windows-rollup-gnu-build/v1",
    experimental: true,
    admissionEligible: false,
    completed: true,
    runtime,
    addon,
    output: forwarder,
    sources: sources.slice(0, 2),
  };
  const snapshots = [
    { path: "rollup-gnu.node", bytes: addon.bytes, digest: addon.digest },
    {
      path: "adapter/libnode.dll",
      bytes: forwarder.bytes,
      digest: forwarder.digest,
    },
  ];
  const manifest = {
    version: 2,
    root,
    workspace: path.win32.join(root, "workspace"),
    scratch: path.win32.join(root, "scratch"),
    runtime: {
      path: path.win32.join(root, "control/node.exe"),
      sha256: runtime.digest.slice(7),
    },
    files: [
      ["workspace/rollup-gnu.node", addon.digest],
      ["workspace/adapter/libnode.dll", forwarder.digest],
      ["control/check.cjs", digest(GNU_CHECK_SOURCE)],
    ].map(([name, hash]) => ({
      path: path.win32.join(root, name),
      sha256: hash.slice(7),
    })),
    capsuleBinding: {
      inventoryDigest: digest(JSON.stringify(snapshots)),
      lockDigest: GNU_IDENTITY.lockDigest,
      planDigest: GNU_IDENTITY.planDigest,
      projectCommit: GNU_IDENTITY.projectCommit,
      runtime: {
        platform: "win32",
        architecture: "x64",
        nodeVersion: GNU_IDENTITY.nodeVersion,
        modulesAbi: GNU_IDENTITY.modulesAbi,
        executableDigest: runtime.digest,
      },
    },
  };
  const manifestDigest = digest(JSON.stringify(manifest)),
    pid = 1234,
    sid = "S-1-15-2-1-2-3-4-5-6-7";
  const report = {
    schema: "chainlesschain.windows-rollup-gnu-diagnostic/v1",
    experimental: true,
    admissionEligible: false,
    formalSample: false,
    status: "NOT_ADMITTED",
    providerAssessed: false,
    runtime,
    addon,
    forwarder,
    sourceIdentity: sources,
    buildRaw: JSON.stringify(build),
    buildDigest: digest(JSON.stringify(build)),
    checkDigest: digest(GNU_CHECK_SOURCE),
    manifest,
    manifestDigest,
    execution: { status: 0, signal: null, error: null, stderr: "", stdout: "" },
    settlement: {
      manifestDigest: manifestDigest.slice(7),
      cleanupConfirmed: true,
      executionFailed: false,
      targetExitCode: 0,
      capabilityCount: 0,
      loopbackExemptionAbsent: true,
      targetPid: pid,
      appContainerSid: sid,
    },
  };
  const native = {
    pid,
    appContainerSid: sid,
    capabilityCount: 0,
    inJob: true,
    forwardedSymbols: 41,
    sameFunctionAddresses: true,
  };
  const detail = {
    native,
    missingDllRejected: true,
    ...GNU_EXPECTED,
    asyncDigest: GNU_EXPECTED.parseDigest,
    invalidRejected: true,
    changedInputDiffers: true,
  };
  const stages = [
    "started",
    "without-forwarder-rejected",
    "forwarder-loaded",
    "addon-loaded",
    "parsed-sync",
    "parsed-async",
    "completed",
  ];
  const rows = stages.map((stage, sequence) => ({
    sequence,
    stage,
    pid,
    ...(sequence === 2 ? { native } : {}),
    ...([4, 5].includes(sequence)
      ? { bytes: GNU_EXPECTED.parseBytes, digest: GNU_EXPECTED.parseDigest }
      : {}),
    ...(sequence === 6 ? detail : {}),
  }));
  seal(report, rows);
  return { report, rows };
}
test("result validator accepts a complete locally bound diagnostic without granting admission", () => {
  const { report } = fixture();
  assert.equal(inspectGnuResult(report).native.forwardedSymbols, 41);
  assert.equal(report.status, "NOT_ADMITTED");
});
for (const [label, mutate] of [
  ["formal sample promotion", (r) => (r.formalSample = true)],
  ["admission promotion", (r) => (r.admissionEligible = true)],
  ["provider assessment", (r) => (r.providerAssessed = true)],
  [
    "runtime substitution",
    (r) => (r.runtime.digest = "sha256:" + "2".repeat(64)),
  ],
  [
    "source substitution",
    (r) => (r.sourceIdentity[0].digest = "sha256:" + "2".repeat(64)),
  ],
  ["missing source", (r) => r.sourceIdentity.pop()],
  ["build bytes changed", (r) => (r.buildRaw += " ")],
  ["manifest changed", (r) => r.manifest.files.pop()],
  ["cleanup missing", (r) => (r.settlement.cleanupConfirmed = false)],
  ["capability added", (r) => (r.settlement.capabilityCount = 1)],
  ["loopback exemption", (r) => (r.settlement.loopbackExemptionAbsent = false)],
  ["nonzero target exit", (r) => (r.settlement.targetExitCode = 1)],
  ["stderr failure", (r) => (r.execution.stderr = "loader failure")],
  ["extra stdout frame", (r) => (r.execution.stdout += r.execution.stdout)],
  ["journal changed", (r) => (r.journalRaw += "\n")],
]) {
  test("result rejects " + label, () => {
    const { report } = fixture();
    mutate(report);
    assert.throws(() => inspectGnuResult(report));
  });
}
for (const [label, mutate] of [
  [
    "wrong SID",
    (rows) => (rows.at(-1).native.appContainerSid = "S-1-15-2-7-6-5-4-3-2-1"),
  ],
  ["wrong PID", (rows) => (rows.at(-1).native.pid = 9999)],
  [
    "different forwarding address",
    (rows) => (rows.at(-1).native.sameFunctionAddresses = false),
  ],
  [
    "missing forwarder negative",
    (rows) => (rows.at(-1).missingDllRejected = false),
  ],
  [
    "async parse mismatch",
    (rows) => (rows.at(-1).asyncDigest = "sha256:" + "2".repeat(64)),
  ],
  [
    "hash output mismatch",
    (rows) =>
      (rows.at(-1).hashes = { ...rows.at(-1).hashes, xxhashBase16: "wrong" }),
  ],
  ["invalid input accepted", (rows) => (rows.at(-1).invalidRejected = false)],
  [
    "constant parser output",
    (rows) => (rows.at(-1).changedInputDiffers = false),
  ],
  ["missing stage", (rows) => rows.splice(3, 1)],
  ["extra process row", (rows) => rows.push({ ...rows.at(-1), pid: 9999 })],
]) {
  test("result rejects resealed " + label, () => {
    const { report, rows } = fixture();
    mutate(rows);
    seal(report, rows);
    assert.throws(() => inspectGnuResult(report));
  });
}
