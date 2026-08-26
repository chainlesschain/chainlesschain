"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  normalizeTeamGraphProjection,
  parseTeamState,
} = require("../src/team-monitor.js");

const digest = (character) => `sha256:${character.repeat(64)}`;

function collaborationProjection() {
  return {
    schema: "chainlesschain.team-graph-projection/v1",
    runId: "team-run-1",
    revisionDigest: digest("a"),
    authorityDigest: digest("b"),
    sourceDigest: digest("c"),
    projectionDigest: digest("d"),
    messageGraph: {
      messages: [
        {
          mode: "followup",
          status: "read",
          payload: { secret: "message-body-must-not-reach-webview" },
          payloadDigest: digest("e"),
          fromAttemptId: "private-attempt",
          toAgentId: "private-agent",
        },
        { mode: "send", status: "processed" },
      ],
      edges: [],
    },
    handoffs: [
      {
        status: "accepted",
        artifactIds: ["private-artifact"],
        toAgentId: "private-agent",
      },
      { status: "committed" },
    ],
    custodyEdges: [
      { kind: "custody_handoff", status: "accepted" },
      { kind: "custody_handoff", status: "committed" },
    ],
  };
}

test("Team Monitor projects CLI 0.166.3 collaboration without private data", () => {
  const projected = normalizeTeamGraphProjection(collaborationProjection());
  assert.deepEqual(projected, {
    available: true,
    version: 1,
    messages: 2,
    followups: 1,
    messageStatuses: {
      admitted: 0,
      delivered: 0,
      read: 1,
      processed: 1,
      dead_letter: 0,
    },
    handoffs: 2,
    activeHandoffs: 1,
    handoffStatuses: {
      offered: 0,
      accepted: 1,
      rejected: 0,
      committed: 1,
      revoked: 0,
      expired: 0,
    },
    custodyEdges: 2,
  });
  const serialized = JSON.stringify(projected);
  for (const privateValue of [
    "message-body-must-not-reach-webview",
    "private-attempt",
    "private-agent",
    "private-artifact",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(privateValue, "u"));
  }
});

test("Team Monitor fails an invalid collaboration projection closed", () => {
  const state = parseTeamState({
    version: 6,
    stateId: "state-6",
    registry: {
      registry: { byKey: [] },
      tasks: {
        tasks: [
          {
            id: "task-1",
            title: "Task 1",
            status: "pending",
            metadata: { key: "task-1", dependsOn: [] },
          },
        ],
      },
    },
    graphProjection: {
      ...collaborationProjection(),
      messageGraph: {
        messages: [{ mode: "send", status: "unknown", payload: "secret" }],
        edges: [],
      },
    },
  });

  assert.equal(state.ok, true);
  assert.equal(state.tasks.length, 1);
  assert.deepEqual(state.collaboration, {
    available: false,
    error: "invalid canonical message metadata",
  });
  assert.doesNotMatch(JSON.stringify(state.collaboration), /secret/u);
});
