import fs from "node:fs";
import path from "node:path";

const cases = ["slow-init", "timeout-late-init", "stop-before-init"];
const requireThat = (condition, message) => {
  if (!condition) throw new Error(`Cold initialization evidence: ${message}`);
};
function time(value) {
  const at = Date.parse(value);
  requireThat(Number.isFinite(at), "missing or invalid timestamp");
  return at;
}

/** Independently reconcile GUI observations with the actual child NDJSON ledger. */
export function verifyColdEvidence(observations, trace) {
  requireThat(
    Array.isArray(observations) && observations.length === cases.length,
    "three native GUI cases required",
  );
  requireThat(Array.isArray(trace), "raw child ledger required");
  const ideProcesses = new Set();
  const sessions = new Set();
  const nonces = new Set();
  const results = observations.map((proof, index) => {
    requireThat(
      proof.case === cases[index],
      "missing, duplicate or out-of-order case",
    );
    requireThat(
      typeof proof.sessionId === "string" &&
        proof.sessionId.length > 0 &&
        !sessions.has(proof.sessionId),
      "unique session identity required",
    );
    sessions.add(proof.sessionId);
    requireThat(
      typeof proof.prompt === "string" && proof.prompt.length > 0,
      "prompt required",
    );
    const { waiting, released, preparing, held, ready, completed } = proof;
    requireThat(
      typeof waiting?.nonce === "string" &&
        /^[a-zA-Z0-9-]{1,80}$/u.test(waiting.nonce) &&
        !nonces.has(waiting.nonce) &&
        Number.isSafeInteger(waiting.processId) &&
        waiting.processId > 0,
      "unique nonce and actual process identity required",
    );
    nonces.add(waiting.nonce);
    requireThat(
      waiting?.command === "init-gate-waiting" &&
        released?.command === "init-gate-released" &&
        waiting.sessionId === proof.sessionId &&
        released.sessionId === proof.sessionId &&
        waiting.nonce === released.nonce &&
        waiting.processInstanceId &&
        waiting.processInstanceId === released.processInstanceId &&
        waiting.processId === released.processId,
      "gate must bind the same actual child and nonce",
    );
    requireThat(
      trace.some((r) => JSON.stringify(r) === JSON.stringify(waiting)) &&
        trace.some((r) => JSON.stringify(r) === JSON.stringify(released)),
      "gate records absent from raw ledger",
    );
    for (const state of [
      preparing,
      held,
      ready,
      completed,
      ...(proof.beforeRetry ? [proof.beforeRetry] : []),
    ]) {
      requireThat(
        state?.visible === true &&
          state.childRunning === true &&
          state.sessionId === proof.sessionId &&
          state.childProcessId === preparing.childProcessId &&
          state.childProcessIds?.includes(String(waiting.processId)),
        "GUI must observe the live child in this session",
      );
      requireThat(
        typeof state.processId === "string" && state.processId.length > 0,
        "IDE identity required",
      );
      requireThat(
        state.initializationTimeoutSeconds === 120,
        "installed runtime must retain the 120-second deadline",
      );
      ideProcesses.add(state.processId);
      time(state.observedAt);
    }
    requireThat(
      preparing.sendInFlight === true &&
        preparing.receiptReady === false &&
        held.receiptReady === false &&
        preparing.inputText === proof.prompt &&
        held.inputText === proof.prompt,
      "input must remain in preparation before init",
    );
    requireThat(
      ready.receiptReady === true &&
        completed.receiptReady === true &&
        completed.sendInFlight === false &&
        completed.inputText === "" &&
        completed.text?.includes(`probe=${proof.prompt}`),
      "explicit input must complete visibly",
    );
    const elapsedMs = time(held.observedAt) - time(waiting.at);
    const submissionElapsedMs = time(held.observedAt) - time(proof.submittedAt);
    requireThat(
      time(proof.submittedAt) <= time(waiting.at),
      "submission must precede the actual child gate",
    );
    requireThat(
      time(released.at) >= time(held.observedAt),
      "gate released before held observation",
    );
    requireThat(
      time(preparing.observedAt) <= time(held.observedAt) &&
        time(ready.observedAt) >= time(released.at) &&
        time(completed.observedAt) >= time(ready.observedAt),
      "GUI observations must follow the actual initialization lifecycle",
    );
    const child = trace.filter(
      (r) => r.processInstanceId === waiting.processInstanceId,
    );
    const init = child.filter(
      (r) =>
        r.direction === "out" &&
        r.event?.subtype === "init" &&
        r.event?.session_id === proof.sessionId,
    );
    requireThat(
      init.length === 1 && time(init[0].at) >= time(released.at),
      "one real init after release required",
    );
    requireThat(
      init[0].processId === waiting.processId &&
        time(ready.observedAt) >= time(init[0].at),
      "GUI readiness must follow init from the actual child",
    );
    const inputs = trace.filter(
      (r) =>
        r.direction === "in" &&
        r.event?.type === "user" &&
        (r.processInstanceId === waiting.processInstanceId ||
          r.sessionId === proof.sessionId ||
          r.event.text === proof.prompt),
    );
    requireThat(
      inputs.length === 1 &&
        inputs[0].event.text === proof.prompt &&
        inputs[0].sessionId === proof.sessionId &&
        inputs[0].processInstanceId === waiting.processInstanceId &&
        time(inputs[0].at) >= time(init[0].at),
      "exactly one input to the initialized child required",
    );
    if (proof.case === "slow-init") {
      requireThat(
        elapsedMs >= 30_000 &&
          held.sendInFlight === true &&
          !proof.explicitRetryAt,
        "actual 30-second initialization wait required",
      );
    } else {
      requireThat(
        held.sendInFlight === false &&
          held.editable === true &&
          proof.beforeRetry?.editable === true &&
          proof.beforeRetry.sendInFlight === false &&
          proof.beforeRetry.receiptReady === true &&
          proof.beforeRetry.inputText === proof.prompt &&
          !proof.beforeRetry.text?.includes(`probe=${proof.prompt}`),
        "expired input must remain editable without automatic resend",
      );
      requireThat(
        time(proof.beforeRetry.observedAt) >= time(ready.observedAt) &&
          time(proof.explicitRetryAt) >= time(proof.beforeRetry.observedAt) &&
          time(inputs[0].at) >= time(proof.explicitRetryAt),
        "only an explicit retry may dispatch expired input",
      );
      if (proof.case === "timeout-late-init")
        requireThat(
          submissionElapsedMs >= 120_000 &&
            held.text?.includes(
              "Agent initialization did not finish in time",
            ) &&
            !held.text?.includes("agent session is not running"),
          "production 120-second timeout and accurate live-child guidance required",
        );
      else
        requireThat(
          held.text?.includes("Input stopped before delivery"),
          "native Stop must cancel preparation",
        );
    }
    return {
      case: proof.case,
      sessionId: proof.sessionId,
      waitObservedMs: elapsedMs,
      submissionElapsedMs,
      userInputs: inputs.length,
      processInstanceId: waiting.processInstanceId,
      automaticResends: 0,
    };
  });
  requireThat(
    ideProcesses.size === 1,
    "all cases must run in the same actual IDE process",
  );
  return {
    passed: true,
    cases: results,
    providerAssessed: false,
    formalSample: false,
    publicInstallationAssessed: false,
    performanceGate: false,
  };
}

export function readColdEvidence(root) {
  return verifyColdEvidence(
    JSON.parse(fs.readFileSync(path.join(root, "cold-ui.json"), "utf8")),
    fs
      .readFileSync(path.join(root, "fake-cli-protocol.jsonl"), "utf8")
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map(JSON.parse),
  );
}

export function verifyColdBoundaries(observations, trace) {
  const expected = ["never-init-restart", "exit-before-init"];
  requireThat(
    Array.isArray(observations) && observations.length === 2,
    "two replacement boundary cases required",
  );
  requireThat(Array.isArray(trace), "raw child ledger required");
  const ideProcesses = new Set(),
    sessions = new Set();
  const results = observations.map((proof, index) => {
    const {
      waiting,
      preparing,
      held,
      stopped,
      replacementWaiting: next,
      replacementReleased: released,
      completed,
    } = proof;
    requireThat(
      proof.case === expected[index] &&
        typeof proof.prompt === "string" &&
        proof.prompt.length > 0 &&
        typeof proof.sessionId === "string" &&
        proof.sessionId &&
        !sessions.has(proof.sessionId),
      "unique ordered replacement sessions required",
    );
    sessions.add(proof.sessionId);
    for (const record of [waiting, next, released])
      requireThat(
        record?.sessionId === proof.sessionId &&
          record.processInstanceId &&
          Number.isSafeInteger(record.processId) &&
          record.processId > 0 &&
          typeof record.nonce === "string" &&
          record.nonce &&
          trace.some((r) => JSON.stringify(r) === JSON.stringify(record)),
        "actual nonce-bound child records required",
      );
    requireThat(
      waiting.command === "init-gate-waiting" &&
        next.command === "init-gate-waiting" &&
        released.command === "init-gate-released" &&
        next.nonce === released.nonce &&
        next.nonce !== waiting.nonce &&
        next.processInstanceId === released.processInstanceId &&
        next.processId === released.processId &&
        next.processInstanceId !== waiting.processInstanceId,
      "replacement must use a different initialized process instance",
    );
    for (const state of [preparing, held, stopped, completed]) {
      requireThat(
        state?.visible === true &&
          state.sessionId === proof.sessionId &&
          state.initializationTimeoutSeconds === 120,
        "real GUI session and unchanged initialization constant required",
      );
      requireThat(
        typeof state.processId === "string" && state.processId,
        "IDE process identity required",
      );
      ideProcesses.add(state.processId);
      time(state.observedAt);
    }
    requireThat(
      preparing.childRunning === true &&
        preparing.receiptReady === false &&
        preparing.sendInFlight === true &&
        preparing.childProcessIds?.includes(String(waiting.processId)) &&
        held.inputText === proof.prompt &&
        held.editable === true &&
        held.sendInFlight === false &&
        stopped.childRunning === false &&
        stopped.childProcessId === "" &&
        proof.oldNodeAliveAfterStop === false,
      "draft and actual old-child exit must precede replacement",
    );
    requireThat(
      time(proof.submittedAt) <= time(waiting.at) &&
        time(preparing.observedAt) >= time(waiting.at) &&
        time(held.observedAt) >= time(preparing.observedAt) &&
        time(stopped.observedAt) >= time(held.observedAt) &&
        time(proof.explicitRetryAt) >= time(stopped.observedAt) &&
        time(next.at) >= time(proof.explicitRetryAt) &&
        time(released.at) >= time(next.at),
      "confirmed-exit then explicit retry time order required",
    );
    const old = trace.filter(
      (r) => r.processInstanceId === waiting.processInstanceId,
    );
    requireThat(
      !old.some(
        (r) =>
          r.event?.subtype === "init" ||
          (r.direction === "in" && r.event?.type === "user"),
      ),
      "old child must never initialize or receive the saved input",
    );
    if (proof.case === "never-init-restart") {
      requireThat(
        held.childRunning === true &&
          held.childProcessId === preparing.childProcessId &&
          held.childProcessIds?.includes(String(waiting.processId)) &&
          held.receiptReady === false &&
          time(held.observedAt) - time(proof.submittedAt) >= 120_000 &&
          held.text?.includes("Agent initialization did not finish in time") &&
          !old.some((r) => r.command === "init-gate-released") &&
          time(proof.restartRequestedAt) >= time(held.observedAt) &&
          time(stopped.observedAt) >= time(proof.restartRequestedAt),
        "never-init must time out and stop without releasing its gate",
      );
    } else {
      requireThat(
        held.childRunning === false &&
          held.text?.includes("Agent exited before input acknowledgement") &&
          held.text?.includes("agent exited (86)") &&
          old.some(
            (r) => r.command === "init-gate-exit-before-init" && r.code === 86,
          ),
        "actual nonzero exit must be distinguished from initialization timeout",
      );
    }
    const init = trace.filter(
      (r) =>
        r.processInstanceId === next.processInstanceId &&
        r.direction === "out" &&
        r.event?.subtype === "init" &&
        r.event.session_id === proof.sessionId,
    );
    const inputs = trace.filter(
      (r) =>
        r.direction === "in" &&
        r.event?.type === "user" &&
        (r.processInstanceId === waiting.processInstanceId ||
          r.processInstanceId === next.processInstanceId ||
          r.sessionId === proof.sessionId ||
          r.event.text === proof.prompt),
    );
    requireThat(
      init.length === 1 &&
        init[0].processId === next.processId &&
        time(init[0].at) >= time(released.at) &&
        inputs.length === 1 &&
        inputs[0].event.text === proof.prompt &&
        inputs[0].sessionId === proof.sessionId &&
        inputs[0].processInstanceId === next.processInstanceId &&
        inputs[0].processId === next.processId &&
        time(inputs[0].at) >= time(init[0].at),
      "exactly one explicit user input to the new initialized child required",
    );
    requireThat(
      completed.childRunning === true &&
        completed.receiptReady === true &&
        completed.sendInFlight === false &&
        completed.inputText === "" &&
        completed.text?.includes(`probe=${proof.prompt}`) &&
        completed.childProcessIds?.includes(String(next.processId)) &&
        time(completed.observedAt) >= time(inputs[0].at),
      "new child completion must be visible in the actual session",
    );
    return {
      case: proof.case,
      oldProcessInstanceId: waiting.processInstanceId,
      newProcessInstanceId: next.processInstanceId,
      oldUserInputs: 0,
      newUserInputs: 1,
      automaticResends: 0,
      oldExitConfirmed: true,
    };
  });
  requireThat(
    ideProcesses.size === 1,
    "both boundaries must use one actual IDE process",
  );
  return {
    passed: true,
    cases: results,
    providerAssessed: false,
    formalSample: false,
    publicInstallationAssessed: false,
    performanceGate: false,
  };
}

export function readColdBoundaryEvidence(root) {
  return verifyColdBoundaries(
    JSON.parse(
      fs.readFileSync(path.join(root, "cold-boundaries-ui.json"), "utf8"),
    ),
    fs
      .readFileSync(path.join(root, "fake-cli-protocol.jsonl"), "utf8")
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map(JSON.parse),
  );
}
