"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { mapAgentEvent, createTurnState } = require("../src/chat/chat-events");
const { appendTranscript } = require("../src/chat/transcript-cache");

for (const approve of [true, false]) {
  test(`host permission fixture preserves the ${approve ? "approved" : "denied"} marker after final reconciliation`, () => {
    const fixture = path.resolve(
      __dirname,
      "../../../tests/fixtures/ide-roadmap/fake-stream-json-agent.mjs",
    );
    const run = spawnSync(process.execPath, [fixture, "agent"], {
      encoding: "utf8",
      timeout: 15000,
      env: {
        ...process.env,
        CC_UI_FIXTURE_STATE: "",
        CC_UI_FIXTURE_TRACE: "",
        CC_UI_CANONICAL_ROOT: "",
      },
      input:
        [
          { type: "user", text: "journey:permission" },
          { type: "approval", id: "fixture-approval-1", approve },
        ]
          .map((event) => JSON.stringify(event))
          .join("\n") + "\n",
    });
    assert.equal(run.error, undefined);
    assert.equal(run.status, 0, run.stderr);
    const events = run.stdout.trim().split("\n").map(JSON.parse);
    const resolved = events.find((event) => event.type === "approval_resolved");
    assert.equal(resolved.approved, approve);
    const result = events.find((event) => event.type === "result");
    const marker = `fixture permission ${approve ? "approved" : "denied"} #1`;
    assert.equal(result.result, marker);
    assert.equal(
      events
        .filter((event) => event.event?.delta?.type === "text_delta")
        .map((event) => event.event.delta.text)
        .join(""),
      result.result,
    );
    const conv = {};
    const state = createTurnState();
    for (const event of events) {
      const message = mapAgentEvent(event, state);
      appendTranscript(
        conv,
        event.type === "result"
          ? { ...message, finalText: event.result }
          : message,
      );
    }
    assert.equal(conv.transcript.at(-1).text, marker);
    assert.equal(conv.transcript.at(-1).streaming, false);
  });
}
