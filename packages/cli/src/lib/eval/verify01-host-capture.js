import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { evalDigest } from "./evidence.js";
import { outcomeDigest } from "./outcomes.js";
import {
  requireValue,
  relativeFile,
  readBytes,
  validateVerify01Review,
} from "./verify01-contracts.js";
import {
  materializeVerify01Checkout,
  snapshotVerify01Workspace,
  diffVerify01Workspace,
  runVerify01ReviewedProcess,
} from "./verify01-execution.js";
import { importVerify01HostCapture } from "./verify01-host-evidence.js";

const STATE_SCHEMA = "chainlesschain.verify01-host-preparation/v1";
const save = (root, file, value) => {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n");
  fs.writeFileSync(path.join(root, file), bytes, { flag: "wx", mode: 0o600 });
  return { path: file, digest: evalDigest(bytes) };
};

export function captureArtifactReader(directory) {
  const root = fs.realpathSync(directory);
  return (relative) => {
    relativeFile(relative);
    let file = root;
    for (const segment of relative.split("/")) {
      file = path.join(file, segment);
      requireValue(
        !fs.lstatSync(file).isSymbolicLink(),
        "capture path traverses a link",
      );
    }
    return readBytes(file);
  };
}

function outside(workspace, directory) {
  const suffix = path.relative(workspace, directory);
  requireValue(
    suffix && (suffix.startsWith(`..${path.sep}`) || path.isAbsolute(suffix)),
    "host control directories must be outside task workspace",
  );
}

function budget(deadline) {
  return {
    remainingMs(stage) {
      const remaining = deadline - Date.now();
      requireValue(
        remaining > 0,
        `host task deadline exhausted during ${stage}`,
      );
      return remaining;
    },
  };
}

function select(bundle, preparation, sampleId) {
  const artifacts = new Map();
  const validated = validateVerify01Review(bundle, {
    ...preparation,
    readReviewedFile(file) {
      const bytes = Buffer.from(preparation.readReviewedFile(file));
      artifacts.set(file, bytes);
      return bytes;
    },
  });
  const sample = validated.samples.get(sampleId);
  requireValue(sample, "sample outside frozen population");
  const target = bundle.bindings.matrix.find((row) =>
    sample.stratum.startsWith(`${row.platform}-${row.entry}-`),
  );
  requireValue(
    target && ["vscode", "jetbrains"].includes(target.entry),
    "host capture requires an actual IDE entry",
  );
  const comparison = bundle.bindings.comparisons[sample.stratum];
  requireValue(
    process.platform === target.platform &&
      process.arch === target.arch &&
      process.version === target.node,
    "actual capture runtime differs from frozen platform/arch/Node",
  );
  return {
    sample,
    target,
    comparison,
    artifacts,
    task: validated.tasks.get(sample.taskId),
    reviewed: validated.reviewed.get(sample.taskId),
  };
}

/** Stores before bodies outside the candidate checkout. Each blob remains
 * byte-bound; dependency files retain only their existing streamed identity.
 */
function storeBaseline(root, snapshot) {
  const blobDirectory = path.join(root, "baseline-blobs");
  fs.mkdirSync(blobDirectory, { mode: 0o700 });
  const indexes = [];
  let page = [],
    pageBytes = 0;
  const flush = () => {
    if (!page.length) return;
    indexes.push(save(root, `baseline-index-${indexes.length}.json`, page));
    page = [];
    pageBytes = 0;
  };
  for (const [file, value] of snapshot) {
    let blob = null;
    if (value.bytes !== null) {
      blob = `baseline-blobs/${value.digest.slice(7)}.blob`;
      const location = path.join(root, blob);
      if (!fs.existsSync(location))
        fs.writeFileSync(location, value.bytes, { flag: "wx", mode: 0o600 });
    }
    const entry = { path: file, ...value, bytes: undefined, blob };
    const size = Buffer.byteLength(JSON.stringify(entry)) + 64;
    if (pageBytes + size > 4 * 1024 * 1024) flush();
    page.push(entry);
    pageBytes += size;
  }
  flush();
  return {
    indexes,
    files: snapshot.size,
    dependencyBoundary: snapshot.dependencyBoundary,
  };
}

function loadBaseline(root, baseline) {
  const read = captureArtifactReader(root);
  const entries = new Map();
  let total = 0;
  requireValue(
    Number.isSafeInteger(baseline.files) &&
      baseline.files <= 1100000 &&
      Array.isArray(baseline.indexes),
    "baseline file count exceeds scan bounds",
  );
  for (const index of baseline.indexes) {
    const indexBytes = read(index.path);
    requireValue(
      evalDigest(indexBytes) === index.digest,
      "baseline index byte binding differs",
    );
    for (const file of JSON.parse(indexBytes)) {
      relativeFile(file.path);
      requireValue(!entries.has(file.path), "duplicate baseline path");
      const bytes = file.blob === null ? null : read(file.blob);
      if (bytes !== null) {
        total += bytes.length;
        requireValue(
          total <= 512 * 1024 * 1024 &&
            bytes.length === file.size &&
            evalDigest(bytes) === file.digest,
          "before body differs from pinned baseline",
        );
      } else
        requireValue(
          file.dependency === true,
          "nondependency baseline lacks its before body",
        );
      entries.set(file.path, { ...file, bytes });
      requireValue(
        entries.size <= baseline.files,
        "baseline index has extra paths",
      );
    }
  }
  requireValue(entries.size === baseline.files, "baseline index is incomplete");
  entries.dependencyBoundary = baseline.dependencyBoundary;
  return entries;
}

export async function prepareVerify01HostTask(bundle, preparation, options) {
  const { sample, target, comparison, artifacts, task, reviewed } = select(
    bundle,
    preparation,
    options.sampleId,
  );
  requireValue(
    options.os === target.os,
    "operator OS declaration differs from frozen target",
  );
  requireValue(
    /^[a-f0-9]{40}$/u.test(options.sourceCommit || ""),
    "tested CLI source SHA required",
  );
  const workspace = path.resolve(options.workspace),
    root = path.resolve(options.captureRoot);
  const reviewRoot = fs.realpathSync(options.reviewRoot);
  outside(workspace, root);
  outside(workspace, reviewRoot);
  requireValue(
    !fs.existsSync(workspace) && !fs.existsSync(root),
    "workspace and capture directory must be new; retry cannot overwrite an attempt",
  );
  const startedAt = new Date().toISOString(),
    deadline = Date.now() + sample.timeBudgetMs;
  fs.mkdirSync(workspace, { recursive: true, mode: 0o700 });
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const stageBudget = budget(deadline);
  try {
    const checkout = await materializeVerify01Checkout(
      options.projectRoot,
      bundle.catalog.projectCommit,
      workspace,
      stageBudget,
    );
    const setupBytes = artifacts.get(reviewed.setup.path);
    const setup = runVerify01ReviewedProcess(
      setupBytes,
      workspace,
      reviewRoot,
      "setup",
      stageBudget.remainingMs("setup"),
    );
    save(root, "setup.json", setup);
    requireValue(
      setup.exitCode === 0 && setup.signal === null && setup.error === null,
      "reviewed host setup failed; preserve this first attempt",
    );
    const baseline = storeBaseline(
      root,
      snapshotVerify01Workspace(workspace, stageBudget, "baseline"),
    );
    const state = {
      schema: STATE_SCHEMA,
      sampleId: sample.id,
      taskId: task.id,
      planDigest: bundle.expectedPlanDigest,
      reviewDigest: preparation.expectedReviewDigest,
      projectCommit: bundle.catalog.projectCommit,
      sourceCommit: options.sourceCommit,
      entry: target.entry,
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      os: options.os,
      host: target.host,
      workspace,
      captureRoot: root,
      startedAt,
      deadline,
      runId: `verify01-host-${randomUUID()}`,
      checkout,
      baseline,
      provider: comparison.provider,
      model: comparison.model,
      permissionMode: comparison.permissionMode,
      observationsCreated: false,
      productionAttested: false,
    };
    save(root, "host-state.json", state);
    fs.writeFileSync(path.join(root, "prompt.txt"), task.prompt, {
      flag: "wx",
      mode: 0o600,
    });
    return {
      stateFile: path.join(root, "host-state.json"),
      stateDigest: outcomeDigest(state),
      state,
    };
  } catch (error) {
    save(root, "prepare-failure.json", {
      startedAt,
      finishedAt: new Date().toISOString(),
      sampleId: sample.id,
      error: error.message,
      observationsCreated: false,
    });
    throw error;
  }
}

/** Execute the externally pinned acceptance bytes and assemble only actual
 * driver files. Import into Eval/outcome is validated before writing output.
 * First-run stage receipts are operator evidence, never inferred from setup.
 */
export function finishVerify01HostTask(bundle, preparation, options) {
  requireValue(
    Number.isSafeInteger(options.retries ?? 0) &&
      (options.retries ?? 0) >= 0 &&
      (options.retries ?? 0) <= 1 &&
      Number.isSafeInteger(options.manualRepairs ?? 0) &&
      (options.manualRepairs ?? 0) >= 0,
    "host attempt and manual repair counts must retain the frozen bounds",
  );
  const state = options.state;
  requireValue(
    state?.schema === STATE_SCHEMA &&
      outcomeDigest(state) === options.expectedStateDigest,
    "host preparation state byte binding differs",
  );
  requireValue(
    state.planDigest === bundle.expectedPlanDigest &&
      state.reviewDigest === preparation.expectedReviewDigest &&
      state.projectCommit === bundle.catalog.projectCommit &&
      state.sourceCommit === options.sourceCommit,
    "host preparation frozen identity differs",
  );
  const { sample, target, task, reviewed, artifacts } = select(
    bundle,
    preparation,
    state.sampleId,
  );
  requireValue(
    state.entry === target.entry &&
      state.os === target.os &&
      state.host === target.host &&
      state.platform === target.platform &&
      state.arch === target.arch &&
      state.node === target.node,
    "prepared host identity changed",
  );
  requireValue(
    Number.isSafeInteger(state.deadline) &&
      Number.isFinite(Date.parse(state.startedAt)) &&
      state.deadline > Date.parse(state.startedAt) &&
      state.deadline - Date.parse(state.startedAt) <= sample.timeBudgetMs + 1,
    "host task deadline differs from frozen budget",
  );
  const stageBudget = budget(state.deadline),
    root = fs.realpathSync(state.captureRoot),
    workspace = fs.realpathSync(state.workspace);
  outside(workspace, root);
  outside(workspace, fs.realpathSync(options.reviewRoot));
  const read = captureArtifactReader(root);
  // Require raw host evidence before spending the remaining acceptance budget.
  const protocol = read("protocol.json"),
    ui = read("ui.json");
  const before = loadBaseline(root, state.baseline);
  const after = snapshotVerify01Workspace(workspace, stageBudget, "after-host");
  const changes = diffVerify01Workspace(before, after);
  const unrelatedChanges = changes
    .filter(
      (change) =>
        !reviewed.allowedChangedPaths.includes(change.path) ||
        change.before?.dependency ||
        change.after?.dependency ||
        change.after?.type === "link",
    )
    .map((change) => change.path);
  save(root, "diff.json", changes);
  save(root, "dependency-boundary.json", {
    before: before.dependencyBoundary,
    after: after.dependencyBoundary,
  });
  requireValue(
    unrelatedChanges.length === 0,
    "host task changed unreviewed/dependency paths; full diff preserved",
  );
  const processReceipt = runVerify01ReviewedProcess(
    artifacts.get(reviewed.check.path),
    workspace,
    options.reviewRoot,
    "check",
    stageBudget.remainingMs("check"),
  );
  save(root, "check-process.json", processReceipt);
  requireValue(
    processReceipt.exitCode === 0 &&
      processReceipt.signal === null &&
      processReceipt.error === null,
    "reviewed host check failed to complete; process receipt preserved",
  );
  const verdict = JSON.parse(processReceipt.stdout);
  requireValue(
    typeof verdict.pass === "boolean" && typeof verdict.detail === "string",
    "reviewed host check did not emit a verdict",
  );
  const check = {
    taskId: task.id,
    reviewDigest: state.reviewDigest,
    pass: verdict.pass,
    detail: verdict.detail,
    changedFiles: changes.map((change) => change.path),
    unrelatedChanges,
    process: processReceipt,
  };
  save(root, "check.json", check);
  const observedAt = new Date().toISOString();
  const manifest = {
    schema: "chainlesschain.verify01-host-capture/v1",
    sampleId: state.sampleId,
    planDigest: state.planDigest,
    reviewDigest: state.reviewDigest,
    projectCommit: state.projectCommit,
    sourceCommit: state.sourceCommit,
    entry: state.entry,
    platform: state.platform,
    os: state.os,
    arch: state.arch,
    node: state.node,
    host: state.host,
    runId: state.runId,
    observedAt,
    elapsedMs: Date.parse(observedAt) - Date.parse(state.startedAt),
    retries: options.retries ?? 0,
    manualRepairs: options.manualRepairs ?? 0,
    failureCause: options.failureCause ?? "unknown",
    protocol: { path: "protocol.json", digest: evalDigest(protocol) },
    ui: { path: "ui.json", digest: evalDigest(ui) },
    check: { path: "check.json", digest: evalDigest(read("check.json")) },
    diff: { path: "diff.json", digest: evalDigest(read("diff.json")) },
    ...(sample.kind === "first-run" ? { firstRun: options.firstRun } : {}),
  };
  const captureDigest = outcomeDigest(manifest);
  const imported = importVerify01HostCapture(bundle, preparation, {
    manifest,
    expectedManifestDigest: captureDigest,
    readArtifact: read,
    sourceCommit: state.sourceCommit,
  });
  save(root, "capture.json", manifest);
  save(root, "host-import.json", imported);
  return {
    manifestFile: path.join(root, "capture.json"),
    captureDigest,
    imported,
    observationsSavedToFormalPlan: false,
  };
}
