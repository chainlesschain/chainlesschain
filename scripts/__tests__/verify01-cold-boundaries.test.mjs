import assert from "node:assert/strict";
import test from "node:test";
import { verifyColdBoundaries } from "../lib/verify01-cold-evidence.mjs";

function evidence() {
  const trace = [],
    at = (ms) => new Date(Date.UTC(2026, 9, 6) + ms).toISOString();
  const observations = ["never-init-restart", "exit-before-init"].map(
    (name, i) => {
      const offset = i * 200000,
        heldMs = i === 0 ? 120010 : 30;
      const sessionId = `session-${i}`,
        prompt = name;
      const waiting = {
        direction: "fixture",
        command: "init-gate-waiting",
        sessionId,
        nonce: `old-${i}`,
        processId: 100 + i,
        processInstanceId: `old-instance-${i}`,
        at: at(offset + 10),
      };
      const next = {
        ...waiting,
        nonce: `new-${i}`,
        processId: 200 + i,
        processInstanceId: `new-instance-${i}`,
        at: at(offset + heldMs + 3),
      };
      const released = {
        ...next,
        command: "init-gate-released",
        at: at(offset + heldMs + 4),
      };
      const state = (ms) => ({
        observedAt: at(offset + ms),
        processId: "500",
        initializationTimeoutSeconds: 120,
        sessionId,
        visible: true,
        childRunning: true,
        childProcessId: String(waiting.processId),
        childProcessIds: [String(waiting.processId)],
        inputText: prompt,
        sendInFlight: true,
        receiptReady: false,
        editable: false,
        text: "",
      });
      const proof = {
        case: name,
        sessionId,
        prompt,
        submittedAt: at(offset),
        waiting,
        preparing: state(20),
        held: {
          ...state(heldMs),
          sendInFlight: false,
          editable: true,
          childRunning: i === 0,
          text:
            i === 0
              ? "Agent initialization did not finish in time"
              : "Agent exited before input acknowledgement; agent exited (86)",
        },
        stopped: {
          ...state(heldMs + 1),
          childRunning: false,
          childProcessId: "",
          sendInFlight: false,
        },
        oldNodeAliveAfterStop: false,
        explicitRetryAt: at(offset + heldMs + 2),
        replacementWaiting: next,
        replacementReleased: released,
        completed: {
          ...state(heldMs + 7),
          childProcessId: String(next.processId),
          childProcessIds: [String(next.processId)],
          sendInFlight: false,
          receiptReady: true,
          inputText: "",
          text: `probe=${prompt}`,
        },
      };
      if (i === 0) proof.restartRequestedAt = proof.held.observedAt;
      trace.push(waiting);
      if (i === 1)
        trace.push({
          ...waiting,
          command: "init-gate-exit-before-init",
          code: 86,
          at: at(offset + 25),
        });
      trace.push(
        next,
        released,
        {
          direction: "out",
          processId: next.processId,
          processInstanceId: next.processInstanceId,
          at: at(offset + heldMs + 5),
          event: { subtype: "init", session_id: sessionId },
        },
        {
          direction: "in",
          processId: next.processId,
          processInstanceId: next.processInstanceId,
          sessionId,
          at: at(offset + heldMs + 6),
          event: { type: "user", text: prompt },
        },
      );
      return proof;
    },
  );
  return { observations, trace };
}

test("never-init and early-exit boundaries require actual retirement then one explicit retry", () => {
  const e = evidence(),
    result = verifyColdBoundaries(e.observations, e.trace);
  assert.equal(result.passed, true);
  assert.deepEqual(
    result.cases.map((c) => c.oldUserInputs),
    [0, 0],
  );
  assert.deepEqual(
    result.cases.map((c) => c.newUserInputs),
    [1, 1],
  );
  assert.equal(result.formalSample, false);
});

test("an old instance receiving input or a live old node cannot pass replacement", () => {
  let e = evidence();
  e.trace.push({
    ...e.observations[0].waiting,
    direction: "in",
    event: { type: "user", text: e.observations[0].prompt },
  });
  assert.throws(
    () => verifyColdBoundaries(e.observations, e.trace),
    /old child must never/u,
  );
  e = evidence();
  e.observations[0].oldNodeAliveAfterStop = true;
  assert.throws(
    () => verifyColdBoundaries(e.observations, e.trace),
    /actual old-child exit/u,
  );
});

test("a released never-init gate and a shortened timeout are rejected", () => {
  let e = evidence();
  e.trace.push({ ...e.observations[0].waiting, command: "init-gate-released" });
  assert.throws(
    () => verifyColdBoundaries(e.observations, e.trace),
    /never-init must time out/u,
  );
  e = evidence();
  e.observations[0].held.observedAt = e.observations[0].preparing.observedAt;
  assert.throws(
    () => verifyColdBoundaries(e.observations, e.trace),
    /never-init must time out/u,
  );
});

test("replacement cannot precede the confirmed exit or duplicate the retry", () => {
  let e = evidence();
  e.observations[0].explicitRetryAt = e.observations[0].held.observedAt;
  assert.throws(
    () => verifyColdBoundaries(e.observations, e.trace),
    /confirmed-exit then explicit retry/u,
  );
  e = evidence();
  e.trace.push({ ...e.trace[4] });
  assert.throws(
    () => verifyColdBoundaries(e.observations, e.trace),
    /exactly one explicit user input/u,
  );
});

test("early process exit must retain its distinct cause and code", () => {
  const e = evidence();
  e.observations[1].held.text = "Agent initialization did not finish in time";
  assert.throws(
    () => verifyColdBoundaries(e.observations, e.trace),
    /actual nonzero exit/u,
  );
});

test("wrong-session input and an unrelated duplicate in the replacement instance are rejected", () => {
  let e = evidence();
  e.trace[4].sessionId = "wrong-session";
  assert.throws(
    () => verifyColdBoundaries(e.observations, e.trace),
    /exactly one explicit user input/u,
  );
  e = evidence();
  e.trace.push({
    ...e.trace[4],
    sessionId: "wrong-session",
    event: { type: "user", text: "unrelated-input" },
  });
  assert.throws(
    () => verifyColdBoundaries(e.observations, e.trace),
    /exactly one explicit user input/u,
  );
});
