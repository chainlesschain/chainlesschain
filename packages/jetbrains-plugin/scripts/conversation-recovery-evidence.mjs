import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

export function verifyConversationRecovery(logRoot, tracePath) {
  const read = (phase) =>
    JSON.parse(
      readFileSync(
        path.join(logRoot, `conversation-recovery-${phase}.json`),
        "utf8",
      ),
    );
  const initial = read("initial"),
    restart = read("restart");
  const records = readFileSync(tracePath, "utf8")
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map(JSON.parse);
  return assertConversationRecovery(initial, restart, records);
}

export function assertConversationRecovery(initial, restart, records) {
  assert.ok(
    [
      "cc-jetbrains-conversation-recovery/v1",
      "cc-jetbrains-conversation-recovery/v2",
      "cc-jetbrains-conversation-recovery/v3",
    ].includes(initial.schema),
  );
  assert.equal(restart.schema, initial.schema);
  for (const [phase, evidence] of [
    ["initial", initial],
    ["restart", restart],
  ]) {
    assert.equal(evidence.schema, initial.schema);
    assert.equal(evidence.phase, phase);
    assert.equal(evidence.installation.exactZipContents, true);
    assert.match(evidence.installation.archiveSha256, /^sha256:[a-f0-9]{64}$/u);
    assert.ok(Object.keys(evidence.installation.files).length > 0);
    assert.notEqual(evidence.a.id, evidence.b.id);
    assert.notEqual(evidence.a.sessionId, evidence.b.sessionId);
    const ids = new Set();
    for (const [key, letter, turns] of [
      ["a", "A", 2],
      ["b", "B", 1],
    ]) {
      const s = evidence[key];
      if (!initial.schema.endsWith("/v1"))
        assert.ok(s.historyStatus.includes("Saved messages"));
      assert.equal(s.visible, true);
      assert.equal(s.inputText, `unsent draft ${letter} 中文😀`);
      assert.equal(s.savedRows.length, turns * 2);
      assert.equal(s.tabs.filter((tab) => tab.selected).length, 1);
      assert.equal(s.tabs.find((tab) => tab.selected).id, s.id);
      assert.ok(
        !s.text.includes(`canonical answer ${letter === "A" ? "B" : "A"}`),
      );
      for (const [index, row] of s.savedRows.entries()) {
        assert.ok(row.id.startsWith(`${s.sessionId}:`));
        assert.ok(!ids.has(row.id), "saved row identities must be distinct");
        ids.add(row.id);
        assert.ok(
          row.text.includes(
            index % 2 === 0
              ? `journey:history-${letter}`
              : `canonical answer ${letter}`,
          ),
        );
        assert.ok(
          s.text.includes(row.text),
          "identity must belong to rendered transcript text",
        );
      }
    }
  }
  for (const key of ["a", "b"]) {
    assert.equal(initial[key].id, restart[key].id);
    assert.equal(initial[key].sessionId, restart[key].sessionId);
    assert.equal(initial[key].profile, restart[key].profile);
    assert.match(initial[key].processId, /^\d+$/u);
    assert.match(restart[key].processId, /^\d+$/u);
    assert.notEqual(
      initial[key].processId,
      restart[key].processId,
      "a real IDE process restart is required",
    );
    assert.deepEqual(
      initial[key].savedRows.map((row) => row.id),
      restart[key].savedRows.map((row) => row.id),
    );
  }
  assert.deepEqual(
    initial.installation,
    restart.installation,
    "same packaged plugin must be installed in both host processes",
  );
  const start = Date.parse(initial.backgroundAt),
    done = Date.parse(initial.backgroundCompletedAt),
    end = Date.parse(initial.foregroundReturnAt);
  assert.ok(
    Number.isFinite(start) &&
      Number.isFinite(done) &&
      Number.isFinite(end) &&
      start <= done &&
      done <= end,
  );
  const observations = initial.backgroundObservations;
  assert.ok(observations.length >= 2);
  assert.ok(Date.parse(observations[0].observedAt) <= done);
  assert.ok(Date.parse(observations.at(-1).observedAt) >= done);
  for (const s of observations) {
    assert.equal(s.id, initial.b.id);
    assert.equal(s.tabs.find((tab) => tab.selected)?.id, initial.b.id);
    assert.equal(s.visible, true);
  }
  assert.ok(
    records.some(
      (r) =>
        r.direction === "canonical" &&
        r.sessionId === initial.a.sessionId &&
        r.at === initial.backgroundCompletedAt,
    ),
  );
  const inputs = records
    .filter((r) => r.direction === "in" && r.event?.type === "user")
    .map((r) => r.event.text);
  assert.deepEqual(
    inputs.slice().sort(),
    [
      "journey:history-A",
      "journey:history-A",
      "journey:history-B",
      ...(initial.schema.endsWith("/v3") ? ["journey:stop-after-cancel"] : []),
    ].sort(),
    "unexpected user input or automatic draft replay",
  );
  for (const key of ["a", "b"]) {
    assert.ok(
      records.some(
        (r) =>
          r.command === "canonical-session-show" &&
          r.args?.includes(initial[key].sessionId) &&
          r.args?.includes("--history"),
      ),
      "actual CLI history subprocess missing",
    );
  }
  const stop = !initial.schema.endsWith("/v1")
    ? assertStopPreparationRecovery(initial, restart, records)
    : {};
  const continuation = initial.schema.endsWith("/v3")
    ? assertStopContinuation(initial, records)
    : {};
  return {
    backgroundCompletion: true,
    distinctSavedRows: 6,
    independentDrafts: true,
    processRestart: true,
    automaticInputReplay: false,
    providerEvidence: "deterministic fixture",
    ...stop,
    ...continuation,
  };
}

function assertStopContinuation(initial, records) {
  const { preparation, running, stopped } = initial.stopContinuation;
  const { waiting, preparing, released, ready } = preparation;
  const cancelled = preparation.stopped;
  const sessionId = ready.sessionId;
  for (const other of [initial.a, initial.b, initial.stopPreparation.ready]) {
    assert.notEqual(other.id, ready.id);
    assert.notEqual(other.sessionId, sessionId);
  }
  const times = [
    waiting.at,
    preparing.observedAt,
    cancelled.observedAt,
    released.at,
    ready.observedAt,
    running.observedAt,
    stopped.observedAt,
  ].map(Date.parse);
  assert.ok(times.every(Number.isFinite));
  assert.ok(times.every((time, i) => i === 0 || time >= times[i - 1]));
  assert.equal(waiting.command, "init-gate-waiting");
  assert.equal(released.command, "init-gate-released");
  assert.equal(waiting.nonce, released.nonce);
  assert.match(waiting.nonce, /^[a-zA-Z0-9-]{1,80}$/u);
  for (const event of [waiting, released]) {
    assert.equal(event.sessionId, sessionId);
    assert.equal(String(event.processId), ready.childProcessId);
    assert.ok(records.some((r) => JSON.stringify(r) === JSON.stringify(event)));
  }
  for (const state of [preparing, cancelled, ready, running, stopped]) {
    assert.equal(state.id, ready.id);
    assert.equal(state.sessionId, sessionId);
    assert.equal(state.profile, initial.a.profile);
    assert.equal(state.processId, initial.a.processId);
    assert.equal(state.childProcessId, ready.childProcessId);
    assert.match(state.childProcessId, /^\d+$/u);
    assert.equal(state.childRunning, true);
    assert.equal(state.visible, true);
    assert.equal(state.tabs.filter((tab) => tab.selected).length, 1);
    assert.equal(state.tabs.find((tab) => tab.selected).id, ready.id);
    assert.ok(!state.text.includes("Stopping the agent"));
  }
  for (const state of [preparing, cancelled, ready])
    assert.equal(state.inputText, "cancelled before init 中文😀");
  assert.equal(preparing.sendInFlight, true);
  assert.equal(preparing.receiptReady, false);
  assert.equal(preparing.editable, false);
  assert.equal(cancelled.receiptReady, false);
  assert.ok(cancelled.text.includes("Input stopped before delivery"));
  assert.ok(cancelled.draftStatus.includes("Draft saved"));
  for (const state of [cancelled, ready, running, stopped]) {
    assert.equal(state.sendInFlight, false);
    assert.equal(state.editable, true);
    assert.equal(state.interruptPending, false);
  }
  assert.equal(ready.receiptReady, true);
  assert.equal(running.turnActive, true);
  assert.ok(running.text.includes("fixture stop waiting"));
  assert.equal(stopped.turnActive, false);
  assert.ok(stopped.text.includes("⏹ interrupted"));
  const incoming = records.filter(
    (r) => r.direction === "in" && r.sessionId === sessionId,
  );
  assert.deepEqual(
    incoming.map((r) => r.event.type),
    ["user", "interrupt"],
  );
  assert.equal(incoming[0].event.text, "journey:stop-after-cancel");
  for (const r of incoming)
    assert.equal(String(r.processId), ready.childProcessId);
  assert.ok(Date.parse(incoming[0].at) >= Date.parse(ready.observedAt));
  assert.ok(Date.parse(incoming[1].at) >= Date.parse(running.observedAt));
  const emitted = records.filter(
    (r) =>
      r.direction === "out" && String(r.processId) === ready.childProcessId,
  );
  const inits = emitted.filter((r) => r.event?.subtype === "init");
  assert.equal(inits.length, 1);
  assert.equal(inits[0].event.session_id, sessionId);
  assert.ok(Date.parse(inits[0].at) >= Date.parse(released.at));
  const results = emitted.filter((r) => r.event?.type === "result");
  assert.equal(results.length, 1);
  assert.equal(results[0].event.subtype, "interrupted");
  assert.equal(results[0].event.interrupted, true);
  assert.ok(Date.parse(results[0].at) >= Date.parse(incoming[1].at));
  assert.ok(Date.parse(results[0].at) <= Date.parse(stopped.observedAt));
  return { stopAfterCancelledPreparation: true, firstStopPreservesChild: true };
}

function assertStopPreparationRecovery(initial, restart, records) {
  const { waiting, preparing, stopped, released, ready } =
    initial.stopPreparation;
  const restored = restart.cancelledDraft;
  assert.notEqual(ready.id, initial.a.id);
  assert.notEqual(ready.id, initial.b.id);
  assert.notEqual(ready.sessionId, initial.a.sessionId);
  assert.notEqual(ready.sessionId, initial.b.sessionId);
  const times = [
    waiting.at,
    preparing.observedAt,
    stopped.observedAt,
    released.at,
    ready.observedAt,
  ].map(Date.parse);
  assert.ok(times.every(Number.isFinite));
  assert.ok(
    times.every((time, index) => index === 0 || time >= times[index - 1]),
  );
  assert.equal(waiting.command, "init-gate-waiting");
  assert.equal(released.command, "init-gate-released");
  assert.equal(waiting.sessionId, ready.sessionId);
  assert.equal(released.sessionId, ready.sessionId);
  assert.equal(released.nonce, waiting.nonce);
  assert.match(waiting.nonce, /^[a-zA-Z0-9-]{1,80}$/u);
  assert.equal(released.processId, waiting.processId);
  for (const event of [waiting, released])
    assert.ok(
      records.some((r) => JSON.stringify(r) === JSON.stringify(event)),
      "gate observation must come from the protocol trace",
    );
  for (const s of [preparing, stopped, ready, restored]) {
    assert.equal(s.id, ready.id);
    assert.equal(s.sessionId, ready.sessionId);
    assert.equal(s.profile, ready.profile);
    assert.equal(s.inputText, "cancelled before init 中文😀");
    assert.equal(s.visible, true);
    assert.equal(s.savedRows.length, 0);
    assert.equal(s.tabs.filter((tab) => tab.selected).length, 1);
    assert.equal(s.tabs.find((tab) => tab.selected).id, s.id);
  }
  for (const s of [preparing, stopped, ready])
    assert.equal(s.processId, initial.a.processId);
  assert.equal(restored.processId, restart.a.processId);
  assert.notEqual(ready.processId, restored.processId);
  assert.equal(preparing.sendInFlight, true);
  assert.equal(preparing.editable, false);
  assert.equal(preparing.receiptReady, false);
  assert.equal(preparing.childRunning, true);
  assert.equal(stopped.receiptReady, false);
  assert.ok(stopped.draftStatus.includes("Draft saved"));
  assert.ok(stopped.text.includes("Input stopped before delivery"));
  assert.equal(ready.receiptReady, true);
  assert.equal(ready.childRunning, true);
  for (const s of [stopped, ready, restored]) {
    assert.equal(s.sendInFlight, false);
    assert.equal(s.editable, true);
  }
  assert.equal(restored.childRunning, false);
  assert.ok(restored.historyStatus.includes("No saved messages"));
  const init = records.filter(
    (r) =>
      r.direction === "out" &&
      r.event?.subtype === "init" &&
      r.event.session_id === ready.sessionId,
  );
  assert.equal(
    init.length,
    1,
    "cancelled tab must not start another agent on recovery",
  );
  assert.ok(Date.parse(init[0].at) >= Date.parse(released.at));
  assert.ok(
    !records.some(
      (r) =>
        r.direction === "in" &&
        r.sessionId === ready.sessionId &&
        r.event?.type === "user",
    ),
  );
  assert.ok(
    records.some(
      (r) =>
        r.command === "canonical-session-show" &&
        r.args?.includes(ready.sessionId) &&
        r.args?.includes("--history"),
    ),
  );
  return { stopBeforeInit: true, cancelledDraftRecovered: true };
}
