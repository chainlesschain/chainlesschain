import {
  createEvalHistoryRecord,
  evalDigest,
  EVAL_EXECUTION_PROTOCOL,
} from "./evidence.js";
import { outcomeDigest } from "./outcomes.js";
import { verifyAgentTerminal } from "./stream-terminal.js";
import {
  relativeFile,
  requireValue,
  validateVerify01Review,
  validateVerify01Collection,
} from "./verify01-contracts.js";

const HOST_SCHEMA = "chainlesschain.verify01-host-capture/v1";
const RECORD_SCHEMA = "chainlesschain.ide-protocol-record/v1";
const STAGES = ["install", "configure", "authenticate", "tool", "artifact"];
const epoch = (value) => Date.parse(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0;

function artifact(descriptor, readArtifact) {
  relativeFile(descriptor?.path);
  const bytes = readArtifact(descriptor.path);
  requireValue(
    Buffer.isBuffer(bytes) &&
      bytes.length <= 16 * 1024 * 1024 &&
      evalDigest(bytes) === descriptor.digest,
    "host artifact digest mismatch or size limit exceeded",
  );
  return bytes;
}

/** One freshly started IDE session per task. Sequence gaps, interleaved user
 * turns, stale receipts and undrained exits remain unverified, never replayed.
 */
export function inspectIdeProtocol(records, { prompt, comparison } = {}) {
  requireValue(
    Array.isArray(records) && records.length >= 4,
    "IDE protocol capture is incomplete",
  );
  const generation = records[0]?.generation;
  let previousTime = -Infinity;
  for (const [index, record] of records.entries()) {
    const at = epoch(record?.at);
    requireValue(
      record?.schema === RECORD_SCHEMA &&
        typeof generation === "string" &&
        generation.length > 0 &&
        record.generation === generation &&
        record.sequence === index + 1 &&
        Number.isFinite(at) &&
        at >= previousTime &&
        ["input", "output", "exit"].includes(record.direction) &&
        record.event &&
        typeof record.event === "object",
      "IDE protocol generation, sequence or timestamp is inconsistent",
    );
    previousTime = at;
  }
  const exits = records.filter((record) => record.direction === "exit");
  requireValue(
    exits.length === 1 &&
      records.at(-1) === exits[0] &&
      exits[0].event.stdoutDrained === true &&
      Number.isInteger(exits[0].event.code),
    "IDE capture lacks a drained process exit",
  );
  const inputs = records.filter((record) => record.direction === "input");
  // Control or second-turn input makes correlation ambiguous because older
  // result envelopes do not echo client_message_id. Use a fresh session.
  requireValue(
    inputs.length === 1 &&
      inputs[0].event.type === "user" &&
      inputs[0].event.text === prompt &&
      typeof inputs[0].event.client_message_id === "string" &&
      inputs[0].event.client_message_id.length > 0,
    "IDE sample requires exactly its frozen user prompt and client identity",
  );
  requireValue(
    inputs[0].event.llm == null &&
      inputs[0].event.worklog_session_id == null &&
      (inputs[0].event.images === undefined ||
        (Array.isArray(inputs[0].event.images) &&
          inputs[0].event.images.length === 0)),
    "frozen IDE sample cannot add per-turn model overrides, historical context or attachments",
  );
  const outputs = records.filter((record) => record.direction === "output");
  const initializations = outputs.filter(
    (record) =>
      record.event.type === "system" && record.event.subtype === "init",
  );
  requireValue(
    initializations.length === 1,
    "IDE sample requires one actual initialization",
  );
  const init = initializations[0];
  requireValue(
    init.sequence < inputs[0].sequence &&
      init.event.model === comparison.model &&
      init.event.provider === comparison.provider &&
      init.event.permission_mode === comparison.permissionMode &&
      typeof init.event.session_id === "string" &&
      init.event.session_id.length > 0,
    "actual IDE initialization differs from the frozen provider/model/mode",
  );
  const sessionId = init.event.session_id;
  requireValue(
    outputs.every(
      (record) =>
        !record.event.session_id || record.event.session_id === sessionId,
    ),
    "IDE capture contains a foreign session",
  );
  const accepted = outputs.filter(
    (record) =>
      record.event.type === "system" &&
      record.event.subtype === "input_accepted",
  );
  requireValue(
    init.event.input_receipts?.version === 1 &&
      accepted.length === 1 &&
      accepted[0].sequence > inputs[0].sequence &&
      accepted[0].event.client_message_id ===
        inputs[0].event.client_message_id &&
      accepted[0].event.receipt?.duplicate === false &&
      accepted[0].event.receipt?.sessionId === sessionId &&
      accepted[0].event.receipt?.clientMessageId ===
        inputs[0].event.client_message_id &&
      /^[a-f0-9]{64}$/u.test(accepted[0].event.receipt?.eventHash || "") &&
      accepted[0].event.receipt?.inputDigest ===
        evalDigest(
          Buffer.from(
            JSON.stringify({
              text: prompt,
              images: [],
              llm: null,
              worklogSessionId: null,
            }),
          ),
        ).slice(7),
    "IDE input acceptance is missing, stale or duplicated",
  );
  const resultRecords = outputs.filter(
    (record) => record.event.type === "result",
  );
  requireValue(
    resultRecords.length === 1 &&
      resultRecords[0].sequence > accepted[0].sequence &&
      resultRecords[0].event.session_id === sessionId,
    "IDE terminal is missing or ambiguous",
  );
  const parsed = verifyAgentTerminal(
    outputs.map((record) => JSON.stringify(record.event)).join("\n"),
  );
  const terminal = resultRecords[0].event;
  // A complete explicit failure is an observation. It never becomes success.
  const knownFailure =
    outputs.at(-1) === resultRecords[0] &&
    terminal.is_error === true &&
    typeof terminal.subtype === "string" &&
    terminal.subtype.length > 0 &&
    terminal.subtype !== "success";
  const exit = exits[0].event;
  const succeeded =
    parsed.terminalVerified &&
    exit.code === 0 &&
    (exit.signal ?? null) === null;
  return {
    ...parsed,
    generation,
    sessionId,
    result:
      knownFailure && typeof terminal.error === "string"
        ? terminal.error
        : terminal.result,
    terminalFailure: knownFailure,
    startedAt: records[0].at,
    inputAt: inputs[0].at,
    terminalAt: resultRecords[0].at,
    finishedAt: exits[0].at,
    elapsedMs: epoch(exits[0].at) - epoch(records[0].at),
    executionSucceeded: succeeded,
    executionEvidence: {
      protocol: EVAL_EXECUTION_PROTOCOL,
      exitCode: exit.code,
      signal: exit.signal ?? null,
      terminalVerified: parsed.terminalVerified || knownFailure,
      observedFallback: parsed.observedFallback,
    },
  };
}

function capturedDiff(changes, allowed, declaredChangedFiles) {
  requireValue(Array.isArray(changes), "captured full diff must be an array");
  const paths = new Set();
  for (const change of changes) {
    const file = relativeFile(change?.path);
    requireValue(
      !paths.has(file) && allowed.includes(file),
      "full diff has a duplicate or unreviewed path",
    );
    paths.add(file);
    requireValue(
      change.before || change.after,
      "full diff cannot contain an empty change",
    );
    for (const side of [change.before, change.after]) {
      if (side === null) continue;
      requireValue(
        side?.type === "file" &&
          side.dependency === false &&
          count(side.mode) &&
          side.mode <= 0o777 &&
          count(side.bytes) &&
          typeof side.bytesBase64 === "string",
        "full diff is incomplete or contains a link/dependency",
      );
      const bytes = Buffer.from(side.bytesBase64, "base64");
      requireValue(
        bytes.toString("base64") === side.bytesBase64 &&
          bytes.length === side.bytes &&
          evalDigest(bytes) === side.digest,
        "captured diff body, byte length or digest differs",
      );
    }
    requireValue(
      change.before?.digest !== change.after?.digest ||
        change.before?.mode !== change.after?.mode,
      "full diff falsely declares an unchanged file",
    );
  }
  requireValue(
    paths.size === declaredChangedFiles.length &&
      declaredChangedFiles.every((file) => paths.has(file)),
    "full diff differs from the declared changed-file inventory",
  );
  return changes;
}

function validateUi(actions, protocol, sampleId, observedAt, elapsedMs) {
  const required = [
    "submit",
    "background-tab",
    "return-tab",
    "final-result",
    "reload",
    "restored-result",
  ];
  requireValue(
    Array.isArray(actions) &&
      (protocol.terminalFailure
        ? actions.length > 0 && actions.length <= required.length
        : actions.length === required.length),
    "actual IDE tab/reload journey is incomplete",
  );
  // Submission may be what starts a cold session, before its first init event.
  let previous = epoch(observedAt) - elapsedMs;
  for (const [index, action] of actions.entries()) {
    const at = epoch(action.at);
    requireValue(
      action.action === required[index] &&
        action.sampleId === sampleId &&
        action.sessionId === protocol.sessionId &&
        Number.isFinite(at) &&
        at >= previous &&
        at <= epoch(observedAt),
      "IDE UI action order, session or time differs",
    );
    previous = at;
    if (action.action === "submit")
      requireValue(
        at <= epoch(protocol.inputAt),
        "UI submission follows the protocol input",
      );
    if (["final-result", "restored-result"].includes(action.action))
      requireValue(
        at >= epoch(protocol.terminalAt) &&
          typeof protocol.result === "string" &&
          action.resultDigest === evalDigest(Buffer.from(protocol.result)),
        "IDE visible/restored result differs from the actual terminal",
      );
  }
}

/** Import existing captured artifacts into the established Eval/outcome schema.
 * Byte bindings and raw terminals are checked, but local declarations cannot
 * attest a marketplace install, machine identity, provider account or billing.
 */
export function importVerify01HostCapture(
  bundle,
  preparation,
  {
    manifest,
    expectedManifestDigest,
    readArtifact,
    sourceCommit,
    now = Date.now(),
  },
) {
  const { samples, tasks, reviewed } = validateVerify01Review(
    bundle,
    preparation,
  );
  requireValue(
    manifest?.schema === HOST_SCHEMA &&
      outcomeDigest(manifest) === expectedManifestDigest,
    "externally pinned host capture digest mismatch",
  );
  const sample = samples.get(manifest.sampleId);
  requireValue(
    sample &&
      manifest.planDigest === bundle.expectedPlanDigest &&
      manifest.reviewDigest === preparation.expectedReviewDigest &&
      manifest.projectCommit === bundle.catalog.projectCommit &&
      manifest.sourceCommit === sourceCommit,
    "host capture frozen/source/review identity differs",
  );
  const target = bundle.bindings.matrix.find((entry) =>
    sample.stratum.startsWith(`${entry.id}-`),
  );
  requireValue(
    target &&
      manifest.entry === target.entry &&
      manifest.platform === target.platform &&
      manifest.arch === target.arch &&
      manifest.node === target.node &&
      manifest.host === target.host &&
      manifest.os === target.os,
    "actual host/runtime declaration differs from frozen matrix; CLI cannot impersonate an IDE",
  );
  requireValue(
    sample.kind === "first-run" ||
      ["vscode", "jetbrains"].includes(manifest.entry),
    "ordinary CLI tasks use the frozen CLI executor",
  );
  requireValue(
    count(manifest.retries) &&
      manifest.retries <= 1 &&
      count(manifest.manualRepairs),
    "invalid retry or repair count",
  );
  const comparison = bundle.bindings.comparisons[sample.stratum];
  const task = tasks.get(sample.taskId);
  const observation = {
    sampleId: sample.id,
    runId: null,
    observedAt: manifest.observedAt,
    cost: null,
    elapsedMs: manifest.elapsedMs,
    retries: manifest.retries,
    manualRepairs: manifest.manualRepairs,
    failureCause: manifest.failureCause ?? "unknown",
  };
  const receiptDigests = [];
  if (sample.kind === "first-run") {
    requireValue(
      typeof manifest.firstRun?.cleanEnvironment === "boolean",
      "fresh profile evidence declaration is required",
    );
    observation.firstRun = {
      cleanEnvironment: manifest.firstRun.cleanEnvironment,
      stages: {},
    };
    let stopped = false;
    for (const stage of STAGES) {
      const entry = manifest.firstRun.stages?.[stage];
      requireValue(
        typeof entry?.passed === "boolean" &&
          (!stopped || entry.passed === false),
        "first-install stages cannot succeed after a failed prerequisite",
      );
      const bytes = artifact(entry.receipt, readArtifact);
      requireValue(
        bytes.length > 0,
        "first-install stage receipt cannot be empty",
      );
      observation.firstRun.stages[stage] = {
        passed: entry.passed,
        receipt: entry.receipt.digest,
      };
      receiptDigests.push(entry.receipt.digest);
      stopped ||= !entry.passed;
    }
  }
  const earlyStop =
    sample.kind === "first-run" &&
    observation.firstRun.stages.tool.passed === false;
  let run = null;
  if (earlyStop) {
    requireValue(
      !manifest.protocol &&
        !manifest.stream &&
        !manifest.check &&
        !manifest.ui &&
        !manifest.exit &&
        !manifest.diff &&
        !manifest.invocation,
      "first-install early stop cannot claim a task terminal or artifact check",
    );
    requireValue(
      manifest.cost === null ||
        (Number.isFinite(manifest.cost) && manifest.cost >= 0),
      "invalid early-stop cost declaration",
    );
    observation.cost = manifest.cost;
  } else {
    requireValue(
      typeof manifest.runId === "string" && manifest.runId.trim().length > 0,
      "completed host capture requires its actual run identity",
    );
    let protocol;
    if (manifest.entry === "cli") {
      const raw = artifact(manifest.stream, readArtifact).toString("utf8");
      const parsed = verifyAgentTerminal(raw);
      const exit = JSON.parse(
        artifact(manifest.exit, readArtifact).toString("utf8"),
      );
      requireValue(
        Number.isInteger(exit.code) &&
          (exit.signal === null || typeof exit.signal === "string"),
        "invalid CLI exit capture",
      );
      const invocation = JSON.parse(
        artifact(manifest.invocation, readArtifact).toString("utf8"),
      );
      requireValue(
        invocation.taskId === task.id &&
          invocation.prompt === task.prompt &&
          invocation.provider === comparison.provider &&
          invocation.model === comparison.model &&
          invocation.permissionMode === comparison.permissionMode &&
          invocation.projectCommit === bundle.catalog.projectCommit &&
          invocation.sourceCommit === sourceCommit &&
          Number.isFinite(epoch(invocation.startedAt)) &&
          Number.isFinite(epoch(exit.finishedAt)) &&
          epoch(exit.finishedAt) >= epoch(invocation.startedAt),
        "CLI first-run invocation differs from the frozen task or runtime identity",
      );
      // CLI first-run capture still needs the actual init identity.
      const events = raw
        .split(/\r?\n/u)
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
      const inits = events.filter(
        (event) => event.type === "system" && event.subtype === "init",
      );
      const init = inits[0];
      requireValue(
        inits.length === 1 &&
          typeof init.session_id === "string" &&
          init.session_id.length > 0 &&
          init?.provider === comparison.provider &&
          init?.model === comparison.model &&
          init?.permission_mode === comparison.permissionMode &&
          events.every(
            (event) =>
              !event.session_id || event.session_id === init.session_id,
          ),
        "CLI first-run initialized a different model, mode or session",
      );
      const terminals = events.filter((event) => event.type === "result");
      const terminal = terminals[0];
      const knownFailure =
        terminals.length === 1 &&
        events.at(-1) === terminal &&
        terminal.is_error === true &&
        typeof terminal.subtype === "string" &&
        terminal.subtype.length > 0 &&
        terminal.subtype !== "success";
      protocol = {
        ...parsed,
        executionSucceeded:
          parsed.terminalVerified && exit.code === 0 && exit.signal === null,
        executionEvidence: {
          protocol: EVAL_EXECUTION_PROTOCOL,
          exitCode: exit.code,
          signal: exit.signal,
          terminalVerified: parsed.terminalVerified || knownFailure,
          observedFallback: parsed.observedFallback,
        },
        startedAt: invocation.startedAt,
        elapsedMs: epoch(exit.finishedAt) - epoch(invocation.startedAt),
      };
    } else {
      protocol = inspectIdeProtocol(
        JSON.parse(artifact(manifest.protocol, readArtifact).toString("utf8")),
        {
          prompt: task.prompt,
          comparison,
        },
      );
      validateUi(
        JSON.parse(artifact(manifest.ui, readArtifact).toString("utf8")),
        protocol,
        sample.id,
        manifest.observedAt,
        manifest.elapsedMs,
      );
    }
    const check = JSON.parse(
      artifact(manifest.check, readArtifact).toString("utf8"),
    );
    requireValue(
      check.taskId === task.id &&
        check.reviewDigest === preparation.expectedReviewDigest &&
        typeof check.pass === "boolean" &&
        Array.isArray(check.changedFiles) &&
        Array.isArray(check.unrelatedChanges) &&
        check.unrelatedChanges.length === 0 &&
        check.changedFiles.every((file) =>
          reviewed
            .get(task.id)
            .allowedChangedPaths.includes(relativeFile(file)),
        ),
      "independent artifact check is unbound or contains unreviewed edits",
    );
    requireValue(
      !check.pass ||
        task.expectedFiles.every((file) => check.changedFiles.includes(file)),
      "independent check omits required deliverables",
    );
    requireValue(
      check.process?.sourceDigest === reviewed.get(task.id).check.digest &&
        check.process.exitCode === 0 &&
        check.process.signal === null &&
        check.process.error === null,
      "independent artifact check lacks its pinned process receipt",
    );
    const verdict = JSON.parse(check.process.stdout);
    requireValue(
      verdict.pass === check.pass && typeof verdict.detail === "string",
      "check verdict differs from raw process output",
    );
    capturedDiff(
      JSON.parse(artifact(manifest.diff, readArtifact).toString("utf8")),
      reviewed.get(task.id).allowedChangedPaths,
      check.changedFiles,
    );
    requireValue(
      manifest.elapsedMs >= protocol.elapsedMs &&
        epoch(manifest.observedAt) >=
          epoch(protocol.startedAt) + protocol.elapsedMs,
      "host observation precedes protocol completion",
    );
    const result = {
      id: task.id,
      artifactCheckPassed: check.pass,
      executionSucceeded: protocol.executionSucceeded,
      agentOk: protocol.executionSucceeded,
      pass: check.pass && protocol.executionSucceeded,
      error: protocol.executionSucceeded
        ? null
        : "captured agent execution did not succeed",
      detail: String(
        check.detail || "Captured independent artifact acceptance",
      ),
      ms: protocol.elapsedMs,
      usage: protocol.usage,
      totalCostUsd: protocol.totalCostUsd,
      executionEvidence: protocol.executionEvidence,
      changedFiles: check.changedFiles,
      unrelatedChanges: check.unrelatedChanges,
    };
    run = createEvalHistoryRecord(
      {
        results: [result],
        passed: result.pass ? 1 : 0,
        failed: result.pass ? 0 : 1,
        total: 1,
        passRate: result.pass ? 1 : 0,
        unrelatedChangeRate: 0,
      },
      {
        comparison,
        runId: manifest.runId,
        ranAt: protocol.startedAt,
        label: sourceCommit,
      },
    );
    observation.runId = run.runId;
    observation.cost = protocol.totalCostUsd;
  }
  const history = { runs: run ? [run] : [], issues: [] };
  const observations = [observation];
  const report = validateVerify01Collection(bundle, preparation, {
    sampleIds: [sample.id],
    history,
    observations,
    sourceCommit,
    now,
  });
  return {
    scope: "verify01-existing-host-evidence-import",
    productionAttested: false,
    identityVerified: false,
    installationVerified: false,
    billingVerified: false,
    captureDigest: expectedManifestDigest,
    stageReceiptDigests: receiptDigests,
    history,
    observations,
    report,
  };
}
