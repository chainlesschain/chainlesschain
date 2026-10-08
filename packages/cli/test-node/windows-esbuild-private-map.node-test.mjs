import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  capture,
  digest,
  GNU_IDENTITY,
} from "../scripts/windows-rollup-gnu-forwarder.mjs";
import { ESBUILD_DIGEST } from "../scripts/windows-esbuild-api-trace.mjs";
import {
  PRIVATE_MAP_SCHEMA,
  ENTRY_SOURCE,
  BUNDLE_DIGEST,
  NATIVE_SOURCES,
  inspectPrivateMap,
} from "../scripts/windows-esbuild-private-map.mjs";
const BUNDLE =
  'var __defProp = Object.defineProperty;\nvar __getOwnPropDesc = Object.getOwnPropertyDescriptor;\nvar __getOwnPropNames = Object.getOwnPropertyNames;\nvar __hasOwnProp = Object.prototype.hasOwnProperty;\nvar __export = (target, all) => {\n  for (var name in all)\n    __defProp(target, name, { get: all[name], enumerable: true });\n};\nvar __copyProps = (to, from, except, desc) => {\n  if (from && typeof from === "object" || typeof from === "function") {\n    for (let key of __getOwnPropNames(from))\n      if (!__hasOwnProp.call(to, key) && key !== except)\n        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });\n  }\n  return to;\n};\nvar __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);\n\n// entry.js\nvar entry_exports = {};\n__export(entry_exports, {\n  answer: () => answer\n});\nmodule.exports = __toCommonJS(entry_exports);\nvar answer = 42;\n// Annotate the CommonJS export names for ESM import in node:\n0 && (module.exports = {\n  answer\n});\n';
const directory = fileURLToPath(new URL("../scripts/", import.meta.url));

function fixture() {
  const root = "C:\\private-map-fixture",
    rootNt = "\\Device\\HarddiskVolume3\\private-map-fixture",
    rootId = "12345678:00000000:00000001";
  const native = {
    experimental: true,
    status: "NOT_ADMITTED",
    completed: true,
    stage: "completed",
    error: 0,
    setterStatus: 0,
    hostNonElevatedUnrestricted: true,
    rootPid: 101,
    childPid: 102,
    childExit: 0,
    childTokenProven: true,
    appContainerSid: "S-1-15-2-1-2-3-4-5-6-7",
    capabilityCount: 0,
    imagePinned: true,
    leafRestricted: true,
    exactHandleCount: 5,
    mapPrepared: true,
    mapInstalled: true,
    parentMapUnchanged: true,
    cleanupConfirmed: true,
    childCreated: true,
    jobAssigned: true,
    childWaitStatus: 0,
    childExitRead: true,
    childExited: true,
    jobQuerySucceeded: true,
    jobActiveProcesses: 0,
    directTerminationAttempted: false,
    directTerminationSucceeded: false,
    directTerminationError: 0,
    beforeMap: { status: "absent", characters: 0, error: 2, valueHex: "" },
    afterSetterMap: { status: "absent", characters: 0, error: 2, valueHex: "" },
    afterChildMap: { status: "absent", characters: 0, error: 2, valueHex: "" },
    profileDeleted: true,
    loopbackExemptionAbsent: true,
    guardedRootNt: rootNt,
    guardedRootFileId: rootId,
  };
  const rows = [
    ["identity-accepted", "", true, 0, 0],
    ["device-map-handle-access", "", true, 0, 3],
    ["device-map-supervisor-handle", "", true, 0, 3],
    ["device-map-root-proven", rootNt, true, 0, 0],
    ["device-map-file-id-proven", rootId, true, 0, 0],
    ["namespace-host-root-denied", "C:\\", true, 5, 0],
    [
      "namespace-workspace-write-denied",
      "X:\\workspace\\forbidden.txt",
      true,
      5,
      0,
    ],
    ["namespace-traversal-confined", rootNt, true, 0, 0],
    ["installed", "", true, 0, 0],
    ["resolve:CreateFileW", "", true, 0, 0],
    ["CreateFileW", "X:\\workspace", true, 0, 0x80000000],
    ["resolve:GetFileInformationByHandleEx", "", true, 0, 0],
    ["GetFileInformationByHandleEx", rootNt + "\\workspace", true, 0, 11],
    ["GetFileInformationByHandleEx", rootNt + "\\workspace", false, 18, 10],
    ["CreateFileW", "X:\\", true, 0, 0x80000000],
    ["GetFileInformationByHandleEx", rootNt, true, 0, 11],
    ["GetFileInformationByHandleEx", rootNt, false, 18, 10],
    ["CreateFileW", "X:\\workspace\\entry.js", true, 0, 0x80000000],
    ["CreateFileW", "X:\\scratch\\bundle.js", true, 0, 0x40000000],
    ["exit", "", true, 0, 0],
  ].map(([api, requestedPath, success, error, kind], index) => ({
    sequence: index + 1,
    pid: 102,
    api,
    requestedPath,
    success,
    error,
    kind,
    patches: index < 8 ? 0 : 2,
    overflow: 0,
  }));
  const outputs = ["supervisor.exe", "shim.dll"].map((name, index) => ({
    path: "C:\\build\\" + name,
    digest: "sha256:" + String(index + 1).repeat(64),
  }));
  const report = {
    schema: PRIVATE_MAP_SCHEMA,
    experimental: true,
    status: "NOT_ADMITTED",
    admissionEligible: false,
    formalSample: false,
    resultTranslation: false,
    runtime: { digest: GNU_IDENTITY.runtimeDigest },
    esbuild: { digest: ESBUILD_DIGEST },
    driver: capture(path.join(directory, "windows-esbuild-private-map.mjs")),
    sources: NATIVE_SOURCES.map((name) =>
      capture(path.join(directory, "diagnostics", name)),
    ),
    root,
    outputs,
    stagedInputs: [
      ["esbuild.exe", ESBUILD_DIGEST],
      ["shim.dll", outputs[1].digest],
      ["entry.js", digest(ENTRY_SOURCE)],
    ].map(([name, hash]) => ({
      path: path.win32.join(root, "workspace", name),
      digest: hash,
    })),
    execution: {
      status: 0,
      signal: null,
      error: null,
      stdout: JSON.stringify(native) + "\n",
      stderr: "",
    },
    childStdout: { text: "", digest: digest("") },
    childStderr: { text: "  ..\\scratch\\bundle.js 1.08kb\nDone in 2ms\n" },
    bundle: { text: BUNDLE, digest: BUNDLE_DIGEST },
  };
  report.childStderr.digest = digest(report.childStderr.text);
  seal(report, rows);
  return { report, native, rows };
}
function seal(report, rows) {
  report.trace = {
    text: rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
  };
  report.trace.digest = digest(report.trace.text);
}
test("independent entry proof binds real private-root enumeration and exact bundle bytes", () => {
  const { report } = fixture();
  assert.equal(digest(BUNDLE), BUNDLE_DIGEST);
  assert.equal(inspectPrivateMap(report).rows, 20);
  assert.equal(report.status, "NOT_ADMITTED");
});
for (const [label, mutate] of [
  ["formal promotion", (r) => (r.formalSample = true)],
  ["admission promotion", (r) => (r.admissionEligible = true)],
  ["result translation", (r) => (r.resultTranslation = true)],
  [
    "source replacement",
    (r) => (r.sources[0].digest = "sha256:" + "0".repeat(64)),
  ],
  [
    "frozen binary replacement",
    (r) => (r.esbuild.digest = "sha256:" + "0".repeat(64)),
  ],
  [
    "staged shim replacement",
    (r) => (r.stagedInputs[1].digest = "sha256:" + "0".repeat(64)),
  ],
  [
    "staged entry replacement",
    (r) => (r.stagedInputs[2].digest = "sha256:" + "0".repeat(64)),
  ],
  [
    "unlisted staged file",
    (r) => r.stagedInputs.push({ ...r.stagedInputs[2] }),
  ],
  ["supervisor failure", (r) => (r.execution.status = 2)],
  ["extra supervisor frame", (r) => (r.execution.stdout += "{}\n")],
  ["trace byte tamper", (r) => (r.trace.text += "\n")],
  [
    "forged resealed bundle",
    (r) => {
      r.bundle.text += "\n";
      r.bundle.digest = digest(r.bundle.text);
    },
  ],
  [
    "child error",
    (r) => {
      r.childStderr.text = "[ERROR] Access is denied";
      r.childStderr.digest = digest(r.childStderr.text);
    },
  ],
])
  test("rejects " + label, () => {
    const { report } = fixture();
    mutate(report);
    assert.throws(() => inspectPrivateMap(report));
  });
for (const [label, mutate] of [
  ["denied setter", (n) => (n.setterStatus = 0xc0000022)],
  [
    "privileged or unproven host",
    (n) => (n.hostNonElevatedUnrestricted = false),
  ],
  ["missing child token proof", (n) => (n.childTokenProven = false)],
  ["extra capability", (n) => (n.capabilityCount = 1)],
  ["non-leaf child", (n) => (n.leafRestricted = false)],
  ["wrong handle count", (n) => (n.exactHandleCount = 6)],
  ["missing image pin", (n) => (n.imagePinned = false)],
  ["map not installed", (n) => (n.mapInstalled = false)],
  ["parent map changed", (n) => (n.parentMapUnchanged = false)],
  ["live job", (n) => (n.cleanupConfirmed = false)],
  ["child was never created", (n) => (n.childCreated = false)],
  ["unassigned child", (n) => (n.jobAssigned = false)],
  ["child wait timed out", (n) => (n.childWaitStatus = 258)],
  ["child wait failed", (n) => (n.childWaitStatus = 0xffffffff)],
  ["unknown child exit", (n) => (n.childExitRead = false)],
  ["child remains live", (n) => (n.childExited = false)],
  ["unqueried job", (n) => (n.jobQuerySucceeded = false)],
  ["nonempty job", (n) => (n.jobActiveProcesses = 1)],
  ["contradictory termination", (n) => (n.directTerminationSucceeded = true)],
  [
    "unknown but equal parent map",
    (n) => {
      for (const key of ["beforeMap", "afterSetterMap", "afterChildMap"])
        n[key] = { status: "unknown", characters: 0, error: 5, valueHex: "" };
    },
  ],
  ["wrong absent error", (n) => (n.beforeMap.error = 5)],
  [
    "missing final map observation",
    (n) => (n.afterChildMap.status = "not-captured"),
  ],
  ["different map after setter", (n) => (n.afterSetterMap.valueHex = "0000")],
  ["different final map", (n) => (n.afterChildMap.valueHex = "0000")],
  ["profile retained", (n) => (n.profileDeleted = false)],
  ["loopback exempted", (n) => (n.loopbackExemptionAbsent = false)],
  ["same PID", (n) => (n.childPid = n.rootPid)],
  ["child failed", (n) => (n.childExit = 1)],
  ["different guarded root", (n) => (n.guardedRootNt += "\\elsewhere")],
])
  test("rejects native " + label, () => {
    const { report, native } = fixture();
    mutate(native);
    report.execution.stdout = JSON.stringify(native) + "\n";
    assert.throws(() => inspectPrivateMap(report));
  });
for (const [label, mutate] of [
  ["writable map", (r) => (r[1].kind = 0xf000f)],
  ["wrong mapped root", (r) => (r[3].requestedPath += "\\other")],
  ["wrong FileId", (r) => (r[4].requestedPath = "ffffffff:ffffffff:ffffffff")],
  ["host read allowed", (r) => (r[5].success = false)],
  ["wrong host denial", (r) => (r[5].error = 2)],
  ["workspace write allowed", (r) => (r[6].success = false)],
  [
    "traversal escaped",
    (r) => (r[7].requestedPath = "\\Device\\HarddiskVolume3"),
  ],
  ["uninstalled shim", (r) => (r[8].success = false)],
  ["root directory unreadable", (r) => (r[14].success = false)],
  ["root enumeration missing", (r) => (r[15].success = false)],
  ["entry unreadable", (r) => (r[17].success = false)],
  ["bundle write missing", (r) => (r[18].success = false)],
  ["wrong child PID", (r) => (r[15].pid = 999)],
  ["sequence gap", (r) => (r[15].sequence = 99)],
  ["overflow", (r) => (r[15].overflow = 1)],
  ["incomplete patches", (r) => (r[15].patches = 1)],
  ["exit missing", (r) => r.pop()],
])
  test("rejects resealed " + label, () => {
    const { report, rows } = fixture();
    mutate(rows);
    seal(report, rows);
    assert.throws(() => inspectPrivateMap(report));
  });

test("an existing parent mapping requires equal successful raw observations", () => {
  const { report, native } = fixture();
  for (const key of ["beforeMap", "afterSetterMap", "afterChildMap"])
    native[key] = {
      status: "mapped",
      characters: 3,
      error: 0,
      valueHex: "0058003a0000",
    };
  report.execution.stdout = JSON.stringify(native) + "\n";
  assert.equal(inspectPrivateMap(report).rows, 20);
  native.afterChildMap.valueHex = "0059003a0000";
  report.execution.stdout = JSON.stringify(native) + "\n";
  assert.throws(() => inspectPrivateMap(report));
});
