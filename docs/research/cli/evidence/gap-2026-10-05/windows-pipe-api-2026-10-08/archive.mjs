/** Reproducible archive of local diagnostic evidence, never an admission input.
 * Run from repository root before modifying the captured diagnostic sources.
 * Original .work reports remain private and are identified by their byte hash.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { inspectAllFileExecution } from "../../../../../../packages/cli/scripts/windows-all-file-stdio-diagnostic.mjs";
import { inspectNativePipeDiagnosticExecution } from "../../../../../../packages/cli/scripts/windows-appcontainer-pipe-diagnostic.mjs";

const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const destination = path.dirname(fileURLToPath(import.meta.url));
const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const ensure = (condition, message) => {
  if (!condition) throw new Error(message);
};
const artifacts = [];
function write(relative, bytes, source = null) {
  const target = path.join(destination, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { flag: "wx" });
  artifacts.push({
    path: relative,
    bytes: Buffer.byteLength(bytes),
    digest: digest(bytes),
    ...(source ? { source } : {}),
  });
}
function json(relative, value, source) {
  write(relative, JSON.stringify(value, null, 2) + "\n", source);
}
function read(relative) {
  return fs.readFileSync(path.join(root, relative));
}
function copy(source, target, expected) {
  const bytes = read(source);
  ensure(
    !expected || digest(bytes) === expected,
    `Source digest changed: ${source}`,
  );
  write(target, bytes, { path: source, digest: digest(bytes) });
}
function redact(report) {
  // Includes JSON embedded inside stdout and a child record embedded in that.
  let text = JSON.stringify(report);
  const prefix = process.env.USERPROFILE;
  if (prefix) {
    const candidates = [prefix];
    for (let depth = 0; depth < 6; depth++)
      candidates.push(JSON.stringify(candidates.at(-1)).slice(1, -1));
    for (const candidate of candidates.reverse())
      text = text.split(candidate).join("<USER_PROFILE>");
  }
  text = text.replace(/S-1-15-2-(?:[0-9]+-)*[0-9]+/gu, "<APPCONTAINER_SID>");
  const result = JSON.parse(text);
  if (result.settlement?.supervisorUserSidSha256)
    result.settlement.supervisorUserSidSha256 = "<REDACTED_SID_DIGEST>";
  return result;
}
const oldPath = ".work/windows-pipe-api-2026-10-07-final/report.json";
const oldBytes = read(oldPath),
  old = JSON.parse(oldBytes);
const readbackBytes = read(".work/windows-pipe-api-2026-10-07-readback.json");
const oldReadback = JSON.parse(readbackBytes);
ensure(
  digest(oldBytes) === oldReadback.report.sha256,
  "Historical report digest differs",
);
inspectNativePipeDiagnosticExecution(
  old.execution,
  old.settlement,
  old.manifestDigest,
);
for (const capture of [old.host, old.execution])
  for (const stream of ["stdout", "stderr"])
    ensure(
      digest(capture[stream]) === capture[`${stream}Sha256`],
      "Historical output digest differs",
    );

const diagnostics = [
  ["pipe-api-2026-10-07", oldPath, oldBytes],
  [
    "all-file-stdio-native-2026-10-08",
    ".work/windows-all-file-stdio-2026-10-08-native/report.json",
    read(".work/windows-all-file-stdio-2026-10-08-native/report.json"),
  ],
  [
    "all-file-stdio-restricted-failure-2026-10-08",
    ".work/windows-all-file-stdio-2026-10-08-astra/report.json",
    read(".work/windows-all-file-stdio-2026-10-08-astra/report.json"),
  ],
];
for (const [name, sourcePath, bytes] of diagnostics) {
  const report = JSON.parse(bytes);
  if (name.includes("stdio-native")) inspectAllFileExecution(report);
  json(`${name}.redacted.json`, {
    schema: "chainlesschain.redacted-diagnostic-archive/v1",
    admissionEligible: false,
    formalSample: false,
    capabilities: {},
    original: { path: sourcePath, bytes: bytes.length, digest: digest(bytes) },
    redactions: [
      "user profile prefixes, including embedded JSON",
      "AppContainer SID",
      "supervisor SID digest",
    ],
    digestSemantics:
      "Nested manifest/stdout digests identify original bytes; redacted bytes are not valid original admission evidence.",
    report: redact(report),
  });
  if (report.execution)
    for (const stream of ["stdout", "stderr"]) {
      const value = report.execution[stream];
      ensure(
        digest(value) === report.execution[`${stream}Sha256`],
        "Output digest differs",
      );
      write(
        `${name}.${stream}.redacted.txt`,
        redact(report).execution[stream],
        {
          report: sourcePath,
          field: `execution.${stream}`,
          originalDigest: digest(value),
          admissionEligible: false,
        },
      );
    }
}
copy(
  ".work/windows-pipe-api-2026-10-07-readback.json",
  "historical-readback.json",
);
copy(
  ".work/node-pinned-libuv-pipe.c",
  "upstream/pipe.c",
  old.upstreamReference.sources[0].sha256,
);
copy(
  ".work/node-pinned-libuv-process-stdio.c",
  "upstream/process-stdio.c",
  old.upstreamReference.sources[1].sha256,
);
copy(
  ".work/node-v22.22.2-SHASUMS256.txt",
  "upstream/SHASUMS256.txt",
  oldReadback.officialRuntimeChecksum.responseSha256,
);
for (const entry of oldReadback.sourceFiles)
  copy(entry.path, `snapshot/${path.basename(entry.path)}`, entry.sha256);
const native = JSON.parse(diagnostics[1][2]);
copy(
  "packages/cli/scripts/windows-all-file-stdio-diagnostic.mjs",
  "snapshot/windows-all-file-stdio-diagnostic.mjs",
  native.diagnosticRunnerSha256,
);
copy(
  "packages/cli/test-node/windows-all-file-stdio-diagnostic.node-test.mjs",
  "snapshot/windows-all-file-stdio-diagnostic.node-test.mjs",
);
const tests = spawnSync(
  process.execPath,
  [
    "--test",
    "packages/cli/test-node/windows-all-file-stdio-diagnostic.node-test.mjs",
    "packages/cli/test-node/windows-appcontainer-pipe-diagnostic.node-test.mjs",
  ],
  { cwd: root, encoding: "utf8", timeout: 15000, windowsHide: true },
);
ensure(!tests.error && tests.status === 0, "Diagnostic contract tests failed");
write("node-tests.tap", tests.stdout);
json("readback.json", {
  schema: "chainlesschain.windows-pipe-diagnostic-archive/v1",
  archivedAt: new Date().toISOString(),
  admissionEligible: false,
  formalSample: false,
  providerAssessed: false,
  fullReviewPackAssessed: false,
  capabilities: {},
  helperProvenance:
    "All-file native run used the existing v1 helper. Concurrent v2 development is outside this evidence; no final v2 source/helper verification is claimed.",
  helperPostRunReadback: {
    observedBeforeV2Rebuild: true,
    executionTimeAttestation: false,
    dllDigest:
      "sha256:9fc4bc15dec2ad0888c00b42205a64c66767c3ea0f1193e08ea249785a3d8259",
    exeDigest:
      "sha256:842ee6d72c67a63ee07186aa254659d9f9a037598382410e318fdf8c76918416",
  },
  conclusions: {
    ordinaryLibuvPipeNames: "ERROR_ACCESS_DENIED observed three times",
    localNames:
      "CreateNamedPipe succeeded; connection and IPC semantics not assessed",
    ignoreStdin: "NUL denied with Win32 5 / Node EPERM",
    exactAllFileStdio:
      "97 binary stdin bytes verified by digest; stdout/stderr, child identity and 3 closed descriptors verified",
    nativeSettlement:
      "10-second Job, zero capabilities, absent loopback exemption, cleanup confirmed",
    frozenHostMismatch:
      "Observed Windows 10 build 19045; frozen Windows 11 24H2 remains unverified",
  },
  tests: {
    status: tests.status,
    tests: 32,
    passed: 32,
    skipped: 0,
    stderr: tests.stderr,
  },
  artifacts,
});
console.log(
  JSON.stringify({
    archived: artifacts.length,
    nativeAllFileCompleted: native.diagnosticCompleted,
    capabilities: {},
  }),
);
