import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  capture,
  digest,
  GNU_IDENTITY,
} from "../scripts/windows-rollup-gnu-forwarder.mjs";
import { ESBUILD_DIGEST } from "../scripts/windows-esbuild-api-trace.mjs";
import { NATIVE_SOURCES } from "../scripts/windows-esbuild-private-map.mjs";
import { inspectService } from "../scripts/windows-esbuild-private-map-service.mjs";

const scripts = fileURLToPath(new URL("../scripts/", import.meta.url));
function fixture() {
  const report = JSON.parse(
    fs.readFileSync(
      new URL(
        "./fixtures/windows-esbuild-private-map-service.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  report.driver = capture(
    path.join(scripts, "windows-esbuild-private-map-service.mjs"),
  );
  report.sources = NATIVE_SOURCES.map((name) =>
    capture(path.join(scripts, "diagnostics", name)),
  );
  report.runtime = { digest: GNU_IDENTITY.runtimeDigest };
  report.esbuild = { digest: ESBUILD_DIGEST };
  report.outputsBefore = structuredClone(report.outputs);
  report.outputsAfter = structuredClone(report.outputs);
  report.native.runWaitStatus = 0;
  report.native.runDeadlineExceeded = false;
  return report;
}
function changeTrace(report, mutate) {
  const rows = report.trace.text.trim().split("\n").map(JSON.parse);
  mutate(rows);
  report.trace.text = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  report.trace.digest = digest(report.trace.text);
}
test("frozen-client service proof preserves the host client and non-admission boundary", () => {
  const report = fixture();
  assert.equal(report.fixtureOnly, true);
  assert.equal(inspectService(report).childPid, report.native.childPid);
});

const mutations = [
  [
    "failed report wrapped as successful evidence",
    (r) => {
      r.completed = false;
      r.error = "deliberate failed report";
    },
  ],
  [
    "unfinished report",
    (r) => {
      r.completed = false;
    },
  ],
  [
    "completed report still carrying error",
    (r) => {
      r.error = "failed verification";
    },
  ],
  [
    "completed report carrying settlement error",
    (r) => {
      r.settlementError = "missing exit";
    },
  ],
  [
    "supervisor changed before launch",
    (r) => {
      r.outputsBefore[0].digest = digest("replaced supervisor");
    },
  ],
  [
    "supervisor changed after launch",
    (r) => {
      r.outputsAfter[0].digest = digest("replaced supervisor");
    },
  ],
  [
    "shim changed before launch",
    (r) => {
      r.outputsBefore[1].digest = digest("replaced shim");
    },
  ],
  [
    "shim changed after launch",
    (r) => {
      r.outputsAfter[1].digest = digest("replaced shim");
    },
  ],
  [
    "native wait deadline exceeded",
    (r) => {
      r.native.runDeadlineExceeded = true;
    },
  ],
  [
    "native wait timed out",
    (r) => {
      r.native.runWaitStatus = 258;
    },
  ],
  [
    "host client relabeled as sandboxed",
    (r) => {
      r.clientLocation = "appcontainer";
    },
  ],
  [
    "full review inferred from config bundle",
    (r) => {
      r.fullFrozenReviewCompleted = true;
    },
  ],
  [
    "formal sample inferred",
    (r) => {
      r.formalSample = true;
    },
  ],
  [
    "admitted status",
    (r) => {
      r.status = "ADMITTED";
    },
  ],
  [
    "source driver omitted",
    (r) => {
      delete r.driver;
    },
  ],
  [
    "native source omitted",
    (r) => {
      r.sources.pop();
    },
  ],
  [
    "native source resealed",
    (r) => {
      r.sources[0].digest = digest("other source");
    },
  ],
  [
    "runtime bytes changed",
    (r) => {
      r.runtime.digest = digest("other runtime");
    },
  ],
  [
    "esbuild bytes changed",
    (r) => {
      r.esbuild.digest = digest("other esbuild");
    },
  ],
  [
    "client bytes changed",
    (r) => {
      r.client.digest = digest("other client");
    },
  ],
  [
    "client changed after run",
    (r) => {
      r.clientAfter.digest = digest("other client");
    },
  ],
  [
    "staged shim changed",
    (r) => {
      r.stagedInputs[1].digest = digest("other shim");
    },
  ],
  [
    "staged config duplicate",
    (r) => {
      r.stagedInputs.push(r.stagedInputs[3]);
    },
  ],
  [
    "staged config path changed",
    (r) => {
      r.stagedInputs[3].path = "C:\\outside\\vitest.config.js";
    },
  ],
  [
    "child PID reused as parent",
    (r) => {
      r.native.childPid = r.native.rootPid;
    },
  ],
  [
    "child exit unobserved",
    (r) => {
      r.native.childExited = false;
    },
  ],
  [
    "token proof absent",
    (r) => {
      r.native.childTokenProven = false;
    },
  ],
  [
    "SID malformed",
    (r) => {
      r.native.appContainerSid = "S-1-15-2-1";
    },
  ],
  [
    "canonical root differs",
    (r) => {
      r.native.guardedRootNt += "-other";
    },
  ],
  [
    "cleanup inferred from process exit",
    (r) => {
      r.native.cleanupConfirmed = false;
    },
  ],
  [
    "Job still populated",
    (r) => {
      r.native.jobActiveProcesses = 1;
    },
  ],
  [
    "capability added",
    (r) => {
      r.native.capabilityCount = 1;
    },
  ],
  [
    "mapping observation unknown",
    (r) => {
      r.native.afterChildMap.status = "unknown";
    },
  ],
  [
    "protocol never written",
    (r) => {
      r.protocol.inputBytes = 0;
    },
  ],
  [
    "protocol never received",
    (r) => {
      r.protocol.outputBytes = 0;
    },
  ],
  [
    "two service processes",
    (r) => {
      r.protocol.spawnCount = 2;
    },
  ],
  [
    "negative request not rejected",
    (r) => {
      r.invalidTransform.rejected = false;
    },
  ],
  [
    "negative request unrelated failure",
    (r) => {
      r.invalidTransform.errors[0].text = "Access denied";
    },
  ],
  [
    "service stderr",
    (r) => {
      r.serviceStderr = "failure";
    },
  ],
  [
    "native stderr",
    (r) => {
      r.nativeStderr = "failure";
    },
  ],
  [
    "config digest changed",
    (r) => {
      r.frozenConfigAfter.digest = digest("modified config");
    },
  ],
  [
    "config output changed without digest",
    (r) => {
      r.configBundle.outputFiles[0].text += "//tamper";
    },
  ],
  [
    "config threads substitution resealed",
    (r) => {
      const file = r.configBundle.outputFiles[0];
      file.text = file.text.replace('pool: "forks"', 'pool: "threads"');
      file.digest = digest(file.text);
    },
  ],
  [
    "config maxWorkers changed resealed",
    (r) => {
      const file = r.configBundle.outputFiles[0];
      file.text = file.text.replace("maxWorkers: 2", "maxWorkers: 1");
      file.digest = digest(file.text);
    },
  ],
  [
    "trace PID substituted resealed",
    (r) =>
      changeTrace(r, (rows) => {
        rows[0].pid++;
      }),
  ],
  [
    "trace gap resealed",
    (r) =>
      changeTrace(r, (rows) => {
        rows[12].sequence++;
      }),
  ],
  [
    "trace overflow resealed",
    (r) =>
      changeTrace(r, (rows) => {
        rows.at(-1).overflow = 1;
      }),
  ],
  [
    "config filesystem read omitted resealed",
    (r) =>
      changeTrace(r, (rows) => {
        const row = rows.find(
          (row) =>
            row.api === "CreateFileW" &&
            row.requestedPath.endsWith("vitest.config.js"),
        );
        row.success = false;
      }),
  ],
  [
    "parent map negative control changed resealed",
    (r) =>
      changeTrace(r, (rows) => {
        rows.find(
          (row) => row.api === "namespace-host-root-denied",
        ).requestedPath = "D:\\";
      }),
  ],
];
for (const [label, mutate] of mutations)
  test("rejects " + label, () => {
    const report = fixture();
    mutate(report);
    assert.throws(() => inspectService(report));
  });
