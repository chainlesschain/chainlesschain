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
  for (const [phase, evidence] of [
    ["initial", initial],
    ["restart", restart],
  ]) {
    assert.equal(evidence.schema, "cc-jetbrains-conversation-recovery/v1");
    assert.equal(evidence.phase, phase);
    assert.notEqual(evidence.a.id, evidence.b.id);
    assert.notEqual(evidence.a.sessionId, evidence.b.sessionId);
    const ids = new Set();
    for (const [key, letter, turns] of [
      ["a", "A", 2],
      ["b", "B", 1],
    ]) {
      const s = evidence[key];
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
    ["journey:history-A", "journey:history-A", "journey:history-B"].sort(),
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
  return {
    backgroundCompletion: true,
    distinctSavedRows: 6,
    independentDrafts: true,
    processRestart: true,
    automaticInputReplay: false,
    providerEvidence: "deterministic fixture",
  };
}
