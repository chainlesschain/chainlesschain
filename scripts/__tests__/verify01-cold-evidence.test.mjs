import assert from "node:assert/strict";
import test from "node:test";
import { verifyColdEvidence } from "../lib/verify01-cold-evidence.mjs";

function evidence() {
  const at = (ms) => new Date(Date.UTC(2026, 9, 6) + ms).toISOString();
  const trace = [];
  const observations = [
    "slow-init",
    "timeout-late-init",
    "stop-before-init",
  ].map((name, i) => {
    const offset = i * 200_000,
      heldMs = name === "timeout-late-init" ? 120_100 : 30_100;
    const sessionId = `session-${i}`,
      processId = 100 + i,
      processInstanceId = `instance-${i}`,
      prompt = name;
    const waiting = {
      command: "init-gate-waiting",
      direction: "fixture",
      nonce: `nonce-${i}`,
      sessionId,
      processId,
      processInstanceId,
      at: at(offset),
    };
    const released = {
      ...waiting,
      command: "init-gate-released",
      at: at(offset + heldMs + 1),
    };
    const state = (ms) => ({
      observedAt: at(offset + ms),
      initializationTimeoutSeconds: 120,
      processId: "123",
      sessionId,
      childProcessId: String(processId),
      childProcessIds: [String(processId)],
      visible: true,
      childRunning: true,
      inputText: prompt,
      receiptReady: false,
      sendInFlight: true,
      editable: false,
      text: "",
    });
    const proof = {
      case: name,
      submittedAt: at(offset),
      sessionId,
      prompt,
      waiting,
      released,
      preparing: state(10),
      held: state(heldMs),
      ready: { ...state(heldMs + 2), receiptReady: true },
      completed: {
        ...state(heldMs + 100),
        receiptReady: true,
        sendInFlight: false,
        inputText: "",
        text: `probe=${prompt}`,
      },
    };
    if (name !== "slow-init") {
      Object.assign(proof.held, {
        sendInFlight: false,
        editable: true,
        text:
          name === "timeout-late-init"
            ? "Agent initialization did not finish in time"
            : "Input stopped before delivery",
      });
      proof.beforeRetry = {
        ...proof.ready,
        sendInFlight: false,
        editable: true,
        observedAt: at(offset + heldMs + 3),
      };
      proof.explicitRetryAt = at(offset + heldMs + 4);
    }
    trace.push(
      waiting,
      released,
      {
        direction: "out",
        processInstanceId,
        processId,
        at: at(offset + heldMs + 1),
        event: { subtype: "init", session_id: sessionId },
      },
      {
        direction: "in",
        processInstanceId,
        processId,
        sessionId,
        at: at(offset + heldMs + 5),
        event: { type: "user", text: prompt },
      },
    );
    return proof;
  });
  return { observations, trace };
}

test("reconciles all actual-child cases and retains the provider/performance boundary", () => {
  const e = evidence(),
    result = verifyColdEvidence(e.observations, e.trace);
  assert.equal(result.passed, true);
  assert.deepEqual(
    result.cases.map((c) => c.userInputs),
    [1, 1, 1],
  );
  assert.equal(result.formalSample, false);
  assert.equal(result.performanceGate, false);
});

test("duplicate input or wrong-session dispatch cannot appear as zero automatic resends", () => {
  const e = evidence();
  e.trace.push({
    ...e.trace[7],
    event: { type: "user", text: "different input" },
    sessionId: "wrong-session",
  });
  assert.throws(
    () => verifyColdEvidence(e.observations, e.trace),
    /exactly one input/u,
  );
});

test("late init dispatch before the explicit retry is rejected", () => {
  const e = evidence();
  e.trace[7].at = e.observations[1].released.at;
  assert.throws(
    () => verifyColdEvidence(e.observations, e.trace),
    /explicit retry/u,
  );
});

test("shortening the production timeout cannot pass the evidence gate", () => {
  const e = evidence();
  e.observations[1].held.observedAt = new Date(
    Date.parse(e.observations[1].waiting.at) + 119_999,
  ).toISOString();
  assert.throws(
    () => verifyColdEvidence(e.observations, e.trace),
    /120-second timeout/u,
  );
});

test("a dead child and a replaced process instance are rejected", () => {
  let e = evidence();
  e.observations[0].held.childRunning = false;
  assert.throws(
    () => verifyColdEvidence(e.observations, e.trace),
    /live child/u,
  );
  e = evidence();
  e.observations[2].released.processInstanceId = "replacement";
  assert.throws(
    () => verifyColdEvidence(e.observations, e.trace),
    /same actual child/u,
  );
});

test("missing cases and manufactured gate records are rejected", () => {
  let e = evidence();
  e.observations.pop();
  assert.throws(
    () => verifyColdEvidence(e.observations, e.trace),
    /three native GUI cases/u,
  );
  e = evidence();
  e.trace.shift();
  assert.throws(
    () => verifyColdEvidence(e.observations, e.trace),
    /absent from raw ledger/u,
  );
});

test("a stale retry observation cannot legitimize an automatic dispatch after init", () => {
  const e = evidence();
  e.observations[1].beforeRetry.observedAt = e.observations[1].waiting.at;
  e.observations[1].explicitRetryAt = e.observations[1].waiting.at;
  assert.throws(
    () => verifyColdEvidence(e.observations, e.trace),
    /explicit retry/u,
  );
});

test("runtime constant changes and init from another child are rejected", () => {
  let e = evidence();
  e.observations[0].preparing.initializationTimeoutSeconds = 15;
  assert.throws(
    () => verifyColdEvidence(e.observations, e.trace),
    /installed runtime/u,
  );
  e = evidence();
  e.trace[2].processId += 1;
  assert.throws(
    () => verifyColdEvidence(e.observations, e.trace),
    /actual child/u,
  );
});
