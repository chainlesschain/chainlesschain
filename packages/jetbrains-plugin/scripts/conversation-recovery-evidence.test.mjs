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
