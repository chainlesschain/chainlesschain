import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { TeamMailbox } from "../../src/lib/agent-team/team-mailbox.js";
import { TaskLeaseRegistry } from "../../src/lib/agent-team/task-lease.js";
import {
  computeTeamGraphAuthorityDigest,
  computeTeamGraphRevisionDigest,
  projectTeamGraphCollaboration,
} from "../../src/lib/agent-team/team-graph-projection.js";

const protocolSchema = JSON.parse(
  readFileSync(
    new URL(
      "../../../agent-protocol/schema/cc-agent-protocol.schema.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validateMessage = ajv.compile({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $defs: protocolSchema.$defs,
  $ref: "#/$defs/Message",
});
const validateHandoff = ajv.compile({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $defs: protocolSchema.$defs,
  $ref: "#/$defs/Handoff",
});

describe("Team canonical Graph collaboration projection", () => {
  it("expands broadcasts per recipient and exposes only read/processed edges", () => {
    let now = Date.parse("2026-08-25T00:00:00.000Z");
    const mailbox = new TeamMailbox({
      now: () => now,
      recipients: ["agent-a", "agent-b", "agent-c"],
    });
    const direct = mailbox.send({
      from: "agent-a",
      to: "agent-b",
      subject: "direct",
      body: { value: 1 },
      causationId: "unsafe causation value",
      senderAttempt: {
        holder: "agent-a",
        taskKey: "task-a",
        leaseId: "lease-a",
        fencingToken: "fence-a",
      },
    });
    mailbox.receive("agent-b", { markRead: true });
    mailbox.acknowledge("agent-b", {
      messageIds: [direct.id],
      consumerKey: "consumer-b",
      status: "processed",
    });
    now += 1000;
    const broadcast = mailbox.send({
      from: "agent-a",
      to: "*",
      body: "review this",
      mode: "followup",
      senderAttempt: {
        holder: "agent-a",
        taskKey: "task-a",
        leaseId: "lease-a",
        fencingToken: "fence-a",
      },
    });
    mailbox.receive("agent-b", { markRead: true });

    const projection = projectTeamGraphCollaboration({
      runId: "team-run-1",
      mailbox,
      registry: [],
    });
    expect(projection.messageGraph.messages).toHaveLength(3);
    expect(projection.messageGraph.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `team-message:${direct.id}:agent-b`,
          toAgentId: "agent-b",
          status: "processed",
          causationId: expect.stringMatching(/^causation:[a-f0-9]{64}$/u),
        }),
        expect.objectContaining({
          id: `team-message:${broadcast.id}:agent-b`,
          toAgentId: "agent-b",
          mode: "followup",
          status: "read",
        }),
        expect.objectContaining({
          id: `team-message:${broadcast.id}:agent-c`,
          toAgentId: "agent-c",
          mode: "followup",
          status: "admitted",
        }),
      ]),
    );
    expect(projection.messageGraph.edges).toHaveLength(2);
    expect(
      projection.messageGraph.edges.map((edge) => edge.status).sort(),
    ).toEqual(["processed", "read"]);
    for (const message of projection.messageGraph.messages) {
      expect(
        validateMessage(message),
        JSON.stringify(validateMessage.errors),
      ).toBe(true);
    }
  });

  it("projects the durable custody journal as canonical Handoff records", () => {
    let now = Date.parse("2026-08-25T00:00:00.000Z");
    const registry = new TaskLeaseRegistry({ now: () => now });
    registry.addTask({ key: "task-a", title: "Task A" });
    const revisionDigest = computeTeamGraphRevisionDigest(registry);
    const authorityDigest = computeTeamGraphAuthorityDigest({
      members: ["agent-a", "agent-b"],
      policy: "workspace-write",
    });
    const source = registry.acquire("task-a", { holder: "agent-a" });
    registry.offerHandoff("task-a", {
      handoffId: "handoff-a",
      holder: "agent-a",
      leaseId: source.lease.leaseId,
      toHolder: "agent-b",
      revisionDigest,
      authorityDigest,
      artifactIds: ["artifact-a"],
      ttlMs: 60_000,
    });
    registry.acceptHandoff("handoff-a", { holder: "agent-b" });
    now += 10;
    registry.commitHandoff("handoff-a", {
      holder: "agent-a",
      leaseId: source.lease.leaseId,
    });

    const projection = projectTeamGraphCollaboration({
      runId: "team-run-1",
      mailbox: new TeamMailbox(),
      registry,
      revisionDigest,
      authorityDigest,
    });
    expect(projection.handoffs).toEqual([
      expect.objectContaining({
        id: "handoff-a",
        runId: "team-run-1",
        nodeId: "task-a",
        toAgentId: "agent-b",
        revisionDigest,
        authorityDigest,
        artifactIds: ["artifact-a"],
        status: "committed",
        expiresAt: "2026-08-25T00:01:00.000Z",
      }),
    ]);
    expect(projection.custodyEdges).toEqual([
      expect.objectContaining({
        kind: "custody_handoff",
        handoffId: "handoff-a",
        status: "committed",
      }),
    ]);
    expect(
      validateHandoff(projection.handoffs[0]),
      JSON.stringify(validateHandoff.errors),
    ).toBe(true);
  });

  it("replays byte-for-byte from restored authoritative snapshots", () => {
    const now = Date.parse("2026-08-25T00:00:00.000Z");
    const mailbox = new TeamMailbox({
      now: () => now,
      recipients: ["agent-a", "agent-b"],
    });
    mailbox.send({
      from: "agent-a",
      to: "agent-b",
      body: { stable: true },
      senderAttempt: {
        holder: "agent-a",
        taskKey: "task-a",
        leaseId: "lease-a",
        fencingToken: "fence-a",
      },
    });
    const registry = new TaskLeaseRegistry({ now: () => now });
    registry.addTask({ key: "task-a", title: "Task A" });
    const first = projectTeamGraphCollaboration({
      runId: "team-run-1",
      mailbox,
      registry,
    });

    const restoredMailbox = TeamMailbox.restore(
      JSON.parse(JSON.stringify(mailbox.snapshot())),
      { now: () => now },
    );
    const restoredRegistry = TaskLeaseRegistry.restore(
      JSON.parse(JSON.stringify(registry.snapshot())),
      { now: () => now },
    );
    const replay = projectTeamGraphCollaboration({
      runId: "team-run-1",
      mailbox: restoredMailbox,
      registry: restoredRegistry,
    });
    expect(replay).toEqual(first);
    expect(replay.projectionDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(replay.sourceDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });
});
