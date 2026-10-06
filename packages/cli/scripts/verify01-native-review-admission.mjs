/** Read-only admission for the proposed Windows review backend. It executes no
 * tests, model, setup or check, and cannot substitute native probes for a pack.
 */
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { evalDigest } from "../src/lib/eval/evidence.js";
import { outcomeDigest } from "../src/lib/eval/outcomes.js";
import { validateVerify01Bundle, readBytes } from "../src/lib/eval/verify01-contracts.js";
import { validateWindowsNativeEvaluatorCapabilitiesReport } from "../src/lib/process-execution-broker/windows-native-evaluator-capabilities.js";
import { VERIFY01_REVIEW_SPECS } from "./verify01-review-specs.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const defaultPlan = path.join(repository, "docs/research/cli/verify01-plan-2026-10-04");
const requireCondition = (condition, message) => {
  if (!condition) throw new Error(`Windows review admission: ${message}`);
};
const blocker = (code, detail) => ({ code, detail });

export function readNativeReviewBundle(planDir = defaultPlan) {
  const read = (name) => JSON.parse(readBytes(path.join(planDir, name)).toString("utf8"));
  return {
    plan: read("plan.json"),
    catalog: read("tasks.json"),
    bindings: read("comparison-bindings.json"),
    expectedPlanDigest: readBytes(path.join(planDir, "plan.sha256")).toString("utf8").trim(),
  };
}

function capabilities(bytes, expectedDigest, host) {
  if (bytes === undefined) {
    requireCondition(expectedDigest === undefined, "capability digest supplied without bytes");
    return { digest: null, status: "NOT_OBSERVED", values: {} };
  }
  requireCondition(
    Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 2 * 1024 * 1024 &&
      /^sha256:[a-f0-9]{64}$/u.test(expectedDigest || "") && evalDigest(bytes) === expectedDigest,
    "external capability byte binding differs or is missing",
  );
  let report;
  try { report = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("Windows review admission: invalid capability JSON"); }
  requireCondition(
    report.schema === "chainlesschain.windows-native-evaluator-capabilities/v1" &&
      report.formalSample === false && report.providerAssessed === false &&
      report.fullReviewPackAssessed === false,
    "capability scope or schema changed",
  );
  requireCondition(
    report.platform === host.platform && report.architecture === host.arch &&
      report.nodeVersion === host.node && report.osRelease === host.osRelease,
    "capability capture belongs to a different host/runtime",
  );
  if (report.diagnosticCompleted !== true)
    return { digest: expectedDigest, status: "INCOMPLETE", values: {} };
  const inspected = validateWindowsNativeEvaluatorCapabilitiesReport(report);
  return { digest: expectedDigest, status: "VERIFIED_DIAGNOSTIC", values: inspected.capabilities };
}

function frozenLinuxOnlyBaseline(bundle, spec, readBlob) {
  const file = "packages/cli/__tests__/unit/process-ownership-journal.test.js";
  if (!spec.baselineTests.includes(file)) return null;
  const bytes = readBlob(bundle.catalog.projectCommit, file);
  requireCondition(Buffer.isBuffer(bytes) && bytes.length <= 1024 * 1024, "invalid frozen baseline bytes");
  requireCondition(
    bytes.toString("utf8").includes('describe.skipIf(process.platform !== "linux")('),
    "Linux-only baseline guard changed; independent specification review required",
  );
  return { path: file, digest: evalDigest(bytes), supportedPlatform: "linux" };
}

/** Host is an operator input for pure inspection; the CLI uses actual runtime
 * values. Even a fully matching host/probe cannot admit an unimplemented capsule.
 */
export function inspectNativeReviewAdmission(bundle, {
  sampleIds,
  pool = "forks",
  host = { platform: process.platform, arch: process.arch, node: process.version, osRelease: os.release() },
  capabilityBytes,
  capabilityDigest,
  readFrozenBlob = (commit, file) => execFileSync("git", ["-C", repository, "show", `${commit}:${file}`], {
    windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
  }),
} = {}) {
  const validated = validateVerify01Bundle(bundle);
  requireCondition(["forks", "threads"].includes(pool), "explicit forks or threads pool required");
  requireCondition(
    host && ["platform", "arch", "node", "osRelease"].every(key => typeof host[key] === "string" && host[key].length > 0),
    "host/runtime identity incomplete",
  );
  const specs = new Map(VERIFY01_REVIEW_SPECS.map(spec => [spec.taskId, spec]));
  requireCondition(specs.size === 36 && VERIFY01_REVIEW_SPECS.length === 36, "review specification population changed");
  const ids = sampleIds ?? bundle.plan.samples.filter(sample => sample.kind === "task" && sample.stratum.startsWith("win32-")).map(sample => sample.id);
  requireCondition(
    Array.isArray(ids) && ids.length > 0 && new Set(ids).size === ids.length && ids.every(id => typeof id === "string"),
    "selected samples missing or duplicated",
  );
  const capture = capabilities(capabilityBytes, capabilityDigest, host);
  const requirements = ["scratch-environment", "esm", ...(pool === "forks" ? ["child-pipe-stdio", "child-fork-ipc"] : ["worker-threads"])];
  const tasks = ids.map(id => {
    const sample = validated.samples.get(id);
    requireCondition(sample?.kind === "task", "sample is not a frozen task; installation samples cannot substitute");
    const spec = specs.get(sample.taskId);
    requireCondition(spec, "sample has no reviewed task specification");
    const target = bundle.bindings.matrix.find(row => sample.stratum.startsWith(`${row.id}-`));
    requireCondition(target, "sample has no frozen runtime target");
    const blockers = [];
    if (host.platform !== "win32") blockers.push(blocker("BACKEND_HOST_UNSUPPORTED", "Windows AppContainer backend requires an actual Windows host."));
    if (target.platform !== "win32") blockers.push(blocker("SAMPLE_PLATFORM_MISMATCH", `Frozen sample targets ${target.platform}; the Windows backend cannot impersonate it.`));
    if (host.arch !== target.arch || host.node !== target.node ||
      (target.os === "Windows 11 24H2" && !/^10\.0\.26100(?:\.\d+)?$/u.test(host.osRelease)))
      blockers.push(blocker("FROZEN_RUNTIME_MISMATCH", `Target is ${target.os}/${target.arch}/${target.node}; observed ${host.osRelease}/${host.arch}/${host.node}.`));
    const platformBaseline = frozenLinuxOnlyBaseline(bundle, spec, readFrozenBlob);
    if (platformBaseline && platformBaseline.supportedPlatform !== host.platform)
      blockers.push(blocker("BASELINE_PLATFORM_UNSUPPORTED", "The sole journal baseline is explicitly skipped outside Linux; empty/pending tests cannot pass."));
    for (const id of requirements) {
      if (capture.values[id] !== "supported") blockers.push(blocker("NATIVE_CAPABILITY_UNAVAILABLE", `${id}: ${capture.values[id] || capture.status}.`));
    }
    // No option can turn an arbitrary cache directory or caller assertion into
    // a pinned read-only toolchain. Its native implementation is still required.
    blockers.push(blocker("TRUSTED_TOOLCHAIN_NOT_IMPLEMENTED", "A versioned lock/integrity/hash/ABI-bound toolchain capsule is required; development junctions cannot be granted access."));
    blockers.push(blocker("LOCKED_TEST_SUPPORT_NOT_IMPLEMENTED", "Frozen Vitest setup/globalSetup must execute inside the native private tree with validated support bytes."));
    return {
      sampleId: id, taskId: sample.taskId, stratum: sample.stratum,
      target: { ...target }, sourcePath: spec.sourcePath ?? null,
      baselineTests: [...spec.baselineTests], platformBaseline,
      requiredCapabilities: requirements.map(id => ({ id, observed: capture.values[id] || capture.status })),
      status: "NOT_READY", blockers,
    };
  });
  return {
    schema: "chainlesschain.verify01-native-review-admission/v1",
    backend: "windows-native", scope: "read-only-operator-preparation",
    planDigest: bundle.expectedPlanDigest, projectCommit: bundle.catalog.projectCommit,
    specsDigest: outcomeDigest(VERIFY01_REVIEW_SPECS), host: { ...host },
    requestedPool: pool, poolDiffersFromDockerPack: pool !== "forks",
    capabilityCapture: { digest: capture.digest, status: capture.status },
    plannedTasks: 36, selectedTasks: tasks.length, readyTasks: 0,
    fullReviewPackReady: false, executionStatus: "NOT_RUN", tasks,
    formalSample: false, providerAssessed: false, observationsCreated: false,
    independentHumanReview: false, productionAttested: false,
  };
}

export function assertNativeReviewReady(bundle, options) {
  const admission = inspectNativeReviewAdmission(bundle, options);
  const error = new Error("Windows native review pack is not ready; inspect per-task prerequisites. No Docker or unsandboxed fallback was selected.");
  error.code = "VERIFY01_NATIVE_REVIEW_NOT_READY";
  error.admission = admission;
  throw error;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: {
      "plan-dir": { type: "string" }, samples: { type: "string" },
      pool: { type: "string", default: "forks" },
      capabilities: { type: "string" }, "capabilities-digest": { type: "string" },
      help: { type: "boolean" },
    } });
    if (values.help) console.log("Read-only Windows native review admission; defaults to the 12 actual Windows samples. No task/check/model execution.\n--plan-dir DIR --samples verify-01,verify-02 --pool forks|threads [--capabilities FILE --capabilities-digest sha256:BYTES]");
    else {
      const report = inspectNativeReviewAdmission(readNativeReviewBundle(values["plan-dir"]), {
        sampleIds: values.samples?.split(","), pool: values.pool,
        capabilityBytes: values.capabilities ? readBytes(values.capabilities) : undefined,
        capabilityDigest: values["capabilities-digest"],
      });
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(`Native review admission rejected: ${error.message}`);
    process.exitCode = 1;
  }
}
