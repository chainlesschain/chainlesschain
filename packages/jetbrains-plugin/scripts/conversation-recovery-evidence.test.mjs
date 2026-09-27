import assert from "node:assert/strict";
import test from "node:test";
import { assertConversationRecovery } from "./conversation-recovery-evidence.mjs";

function valid() {
  const snapshot = (letter, turns) => {
    const id = `draft-${letter}`,
      sessionId = `session-${letter}`;
    const savedRows = Array.from({ length: turns * 2 }, (_, index) => ({
      id: `${sessionId}:${String(index).repeat(64)}:0`,
      text: `\nMessage ${index + 1}\n${index % 2 ? "canonical answer " : "journey:history-"}${letter}\n`,
    }));
    return {
      id,
      sessionId,
      profile: "isolated-profile",
      processId: "100",
      visible: true,
      savedRows,
      inputText: `unsent draft ${letter} 中文😀`,
      text: savedRows.map((r) => r.text).join(""),
      tabs: [{ id, selected: true }],
    };
  };
  const initial = {
    schema: "cc-jetbrains-conversation-recovery/v1",
    phase: "initial",
    a: snapshot("A", 2),
    b: snapshot("B", 1),
    backgroundAt: "2026-09-27T00:00:01.000Z",
    backgroundCompletedAt: "2026-09-27T00:00:02.000Z",
    foregroundReturnAt: "2026-09-27T00:00:03.000Z",
  };
  initial.backgroundObservations = [
    initial.backgroundAt,
    initial.foregroundReturnAt,
  ].map((observedAt) => ({ ...initial.b, observedAt }));
  initial.installation = {
    pluginPath: "sandbox/plugin",
    archiveSha256: `sha256:${"a".repeat(64)}`,
    exactZipContents: true,
    files: { "lib/plugin.jar": `sha256:${"b".repeat(64)}` },
  };
  const restart = structuredClone(initial);
  restart.phase = "restart";
  restart.a.processId = restart.b.processId = "200";
  const records = [
    {
      direction: "canonical",
      sessionId: initial.a.sessionId,
      at: initial.backgroundCompletedAt,
    },
    ...["A", "B", "A"].map((letter) => ({
      direction: "in",
      event: { type: "user", text: `journey:history-${letter}` },
    })),
    ...["A", "B"].map((letter) => ({
      direction: "command",
      command: "canonical-session-show",
      args: ["session", "show", `session-${letter}`, "--history"],
    })),
  ];
  return { initial, restart, records };
}
function verify({ initial, restart, records }) {
  return assertConversationRecovery(initial, restart, records);
}

function withStop() {
  const value = valid(),
    { initial, restart, records } = value;
  initial.schema = restart.schema = "cc-jetbrains-conversation-recovery/v2";
  for (const phase of [initial, restart])
    for (const key of ["a", "b"]) phase[key].historyStatus = "Saved messages";
  const c = {
    id: "draft-C",
    sessionId: "session-C",
    processId: "100",
    profile: "isolated-profile",
    inputText: "cancelled before init 中文😀",
    visible: true,
    savedRows: [],
    tabs: [{ id: "draft-C", selected: true }],
    childRunning: true,
    sendInFlight: true,
    editable: false,
    receiptReady: false,
  };
  const waiting = {
    at: "2026-09-27T00:00:00.100Z",
    direction: "fixture",
    command: "init-gate-waiting",
    sessionId: c.sessionId,
    nonce: "held-init",
    processId: 300,
  };
  const released = {
    ...waiting,
    at: "2026-09-27T00:00:00.400Z",
    command: "init-gate-released",
  };
  const preparing = { ...c, observedAt: "2026-09-27T00:00:00.200Z" };
  const stopped = {
    ...c,
    observedAt: "2026-09-27T00:00:00.300Z",
    sendInFlight: false,
    editable: true,
    text: "Input stopped before delivery",
    draftStatus: "Draft saved",
  };
  const ready = {
    ...stopped,
    observedAt: "2026-09-27T00:00:00.500Z",
    receiptReady: true,
  };
  initial.stopPreparation = { waiting, preparing, stopped, released, ready };
  restart.cancelledDraft = {
    ...ready,
    processId: "200",
    childRunning: false,
    receiptReady: false,
    historyStatus: "No saved messages",
  };
  records.push(
    structuredClone(waiting),
    structuredClone(released),
    {
      at: "2026-09-27T00:00:00.450Z",
      direction: "out",
      event: { type: "system", subtype: "init", session_id: c.sessionId },
    },
    {
      direction: "command",
      command: "canonical-session-show",
      args: ["session", "show", "--history", c.sessionId],
    },
  );
  return value;
}

test("v2 proves Stop before init, late capability completion and cancelled draft recovery", () => {
  assert.equal(verify(withStop()).stopBeforeInit, true);
  assert.equal(verify(withStop()).cancelledDraftRecovered, true);
  assert.equal(verify(valid()).stopBeforeInit, undefined);
});

function withContinuation() {
  const value = withStop(),
    { initial, restart, records } = value;
  initial.schema = restart.schema = "cc-jetbrains-conversation-recovery/v3";
  const preparation = JSON.parse(
    JSON.stringify(initial.stopPreparation)
      .replaceAll("draft-C", "draft-D")
      .replaceAll("session-C", "session-D")
      .replaceAll("held-init", "held-next-init"),
  );
  for (const [index, key] of [
    "waiting",
    "preparing",
    "stopped",
    "released",
    "ready",
  ].entries()) {
    const event = preparation[key];
    const at = `2026-09-27T00:00:00.${600 + index * 50}Z`;
    if (event.command) {
      event.at = at;
      event.processId = 400;
      records.push(structuredClone(event));
    } else {
      event.observedAt = at;
      event.childProcessId = "400";
      event.interruptPending = false;
      event.text ??= "";
    }
  }
  const running = {
    ...preparation.ready,
    inputText: "",
    turnActive: true,
    observedAt: "2026-09-27T00:00:00.900Z",
    text: "fixture stop waiting",
  };
  const stopped = {
    ...running,
    turnActive: false,
    observedAt: "2026-09-27T00:00:00.990Z",
    text: "fixture stop waiting\n⏹ interrupted",
  };
  const idleStopped = {
    ...preparation.ready,
    turnActive: false,
    observedAt: "2026-09-27T00:00:00.825Z",
    text: "no active turn",
  };
  initial.stopContinuation = { preparation, idleStopped, running, stopped };
  records.push(
    {
      direction: "out",
      processId: 400,
      at: "2026-09-27T00:00:00.775Z",
      event: { type: "system", subtype: "init", session_id: "session-D" },
    },
    {
      direction: "in",
      processId: 400,
      sessionId: "session-D",
      at: "2026-09-27T00:00:00.850Z",
      event: { type: "user", text: "journey:stop-after-cancel" },
    },
    {
      direction: "in",
      processId: 400,
      sessionId: "session-D",
      at: "2026-09-27T00:00:00.950Z",
      event: { type: "interrupt" },
    },
    {
      direction: "out",
      processId: 400,
      at: "2026-09-27T00:00:00.975Z",
      event: { type: "result", subtype: "interrupted", interrupted: true },
    },
  );
  return value;
}

test("v3 proves an explicit next send receives a soft first Stop on the same child", () => {
  assert.equal(verify(withContinuation()).stopAfterCancelledPreparation, true);
  assert.equal(verify(withContinuation()).firstStopPreservesChild, true);
  assert.equal(verify(withStop()).firstStopPreservesChild, undefined);
});

for (const [name, change] of [
  [
    "missing continuation",
    (v) => {
      delete v.initial.stopContinuation;
    },
  ],
  [
    "stale interrupt marker",
    (v) => {
      v.initial.stopContinuation.running.interruptPending = true;
    },
  ],
  [
    "force-stopped next turn",
    (v) => {
      v.initial.stopContinuation.stopped.text += "Stopping the agent";
    },
  ],
  [
    "replacement child",
    (v) => {
      v.initial.stopContinuation.stopped.childProcessId = "401";
    },
  ],
  [
    "dead child",
    (v) => {
      v.initial.stopContinuation.stopped.childRunning = false;
    },
  ],
  [
    "still active after Stop",
    (v) => {
      v.initial.stopContinuation.stopped.turnActive = true;
    },
  ],
  [
    "missing soft interrupt",
    (v) => {
      v.records = v.records.filter((r) => r.event?.type !== "interrupt");
    },
  ],
  [
    "early interrupt during preparation",
    (v) => {
      v.records.unshift({
        direction: "in",
        processId: 400,
        sessionId: "session-D",
        at: "2026-09-27T00:00:00.660Z",
        event: { type: "interrupt" },
      });
    },
  ],
  [
    "missing terminal result",
    (v) => {
      v.records = v.records.filter((r) => r.event?.type !== "result");
    },
  ],
  [
    "another child result",
    (v) => {
      v.records.find((r) => r.event?.type === "result").processId = 401;
    },
  ],
  [
    "unexpected restart replay",
    (v) => {
      v.records.push(
        structuredClone(
          v.records.find((r) => r.event?.text === "journey:stop-after-cancel"),
        ),
      );
    },
  ],
])
  test(`v3 rejects ${name}`, () => {
    const value = withContinuation();
    change(value);
    assert.throws(() => verify(value));
  });

for (const [name, change] of [
  [
    "missing Stop proof",
    (v) => {
      delete v.initial.stopPreparation;
    },
  ],
  [
    "Stop after init",
    (v) => {
      v.initial.stopPreparation.preparing.receiptReady = true;
    },
  ],
  [
    "no pending send",
    (v) => {
      v.initial.stopPreparation.preparing.sendInFlight = false;
    },
  ],
  [
    "still sending after Stop",
    (v) => {
      v.initial.stopPreparation.stopped.sendInFlight = true;
    },
  ],
  [
    "lost cancelled composer",
    (v) => {
      v.restart.cancelledDraft.inputText = "";
    },
  ],
  [
    "unexpected saved message",
    (v) => {
      v.restart.cancelledDraft.savedRows = [{ id: "new" }];
    },
  ],
  [
    "cancelled session auto-started",
    (v) => {
      v.restart.cancelledDraft.childRunning = true;
    },
  ],
  [
    "history still loading",
    (v) => {
      v.restart.a.historyStatus = "Loading saved conversation";
    },
  ],
  [
    "lost init completion",
    (v) => {
      v.initial.stopPreparation.ready.receiptReady = false;
    },
  ],
  [
    "wrong gate nonce",
    (v) => {
      v.initial.stopPreparation.released.nonce = "wrong";
    },
  ],
  [
    "unobserved release",
    (v) => {
      v.records = v.records.filter((r) => r.command !== "init-gate-released");
    },
  ],
  [
    "early init",
    (v) => {
      v.records.find((r) => r.event?.subtype === "init").at =
        "2026-09-27T00:00:00.050Z";
    },
  ],
  [
    "automatic cancelled input",
    (v) => {
      v.records.push({
        direction: "in",
        sessionId: "session-C",
        event: { type: "user", text: "cancelled before init 中文😀" },
      });
    },
  ],
])
  test(`rejects ${name}`, () => {
    const value = withStop();
    change(value);
    assert.throws(() => verify(value));
  });
test("accepts native recovery with same saved identities, new process and no replay", () => {
  assert.equal(verify(valid()).processRestart, true);
});
for (const [name, mutate] of [
  [
    "non-package installation",
    (v) => {
      v.initial.installation.exactZipContents = false;
    },
  ],
  [
    "changed installed artifact",
    (v) => {
      v.restart.installation.files["lib/extra.jar"] =
        `sha256:${"c".repeat(64)}`;
    },
  ],
  [
    "same process",
    (v) => {
      v.restart.a.processId = v.initial.a.processId;
    },
  ],
  [
    "different profile",
    (v) => {
      v.restart.b.profile = "different";
    },
  ],
  [
    "duplicate rows",
    (v) => {
      v.initial.a.savedRows[1].id = v.initial.a.savedRows[0].id;
    },
  ],
  [
    "changed saved identity",
    (v) => {
      v.restart.a.savedRows[0].id += "changed";
    },
  ],
  [
    "hidden transcript",
    (v) => {
      v.restart.a.visible = false;
    },
  ],
  [
    "unrendered row",
    (v) => {
      v.initial.a.text = "other text";
    },
  ],
  [
    "draft loss",
    (v) => {
      v.restart.b.inputText = "";
    },
  ],
  [
    "draft replay",
    (v) => {
      v.records.push({
        direction: "in",
        event: { type: "user", text: v.initial.a.inputText },
      });
    },
  ],
  [
    "foreground completion",
    (v) => {
      v.initial.foregroundReturnAt = v.initial.backgroundAt;
    },
  ],
  [
    "wrong foreground tab",
    (v) => {
      v.initial.backgroundObservations[0].id = v.initial.a.id;
    },
  ],
  [
    "missing durable completion",
    (v) => {
      v.records.shift();
    },
  ],
  [
    "missing actual history command",
    (v) => {
      v.records.pop();
    },
  ],
])
  test(`rejects ${name}`, () => {
    const v = valid();
    mutate(v);
    assert.throws(() => verify(v));
  });
