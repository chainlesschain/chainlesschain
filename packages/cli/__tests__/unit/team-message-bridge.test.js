import { afterEach, describe, expect, it } from "vitest";
import { TeamMailbox } from "../../src/lib/agent-team/team-mailbox.js";
import {
  callTeamMessageBridge,
  TeamMessageBridge,
  TEAM_MESSAGE_BRIDGE_PROTOCOL,
} from "../../src/lib/agent-team/team-message-bridge.js";
import { resolveTeamMessageToolBundle } from "../../src/lib/agent-team/team-message-tools.js";
const bridges = [];

afterEach(async () => {
  for (const bridge of bridges.splice(0)) await bridge.close();
});

async function bridgeFor(mailbox, holder, options = {}) {
  const bridge = new TeamMessageBridge({
    mailbox,
    holder,
    assertAuthority: () => ({
      holder,
      taskKey: `task-${holder}`,
      leaseId: `lease-${holder}`,
      fencingToken: `fence-${holder}`,
    }),
    durable: true,
    ...options,
  });
  bridges.push(bridge);
  await bridge.start();
  return bridge;
}

function call(bridge, op, args, extra = {}) {
  return callTeamMessageBridge({
    endpoint: bridge.endpoint,
    token: bridge.token,
    op,
    args,
    ...extra,
  });
}

describe("TeamMessageBridge", () => {
  it("binds real-time send/receive/ACK/followup to the live attempt", async () => {
    const mailbox = new TeamMailbox({
      recipients: ["teammate-1", "teammate-2"],
    });
    const mutations = [];
    const first = await bridgeFor(mailbox, "teammate-1", {
      recipientState: () => ({ state: "running" }),
      onMutation: (event) => mutations.push(event),
    });
    const second = await bridgeFor(mailbox, "teammate-2", {
      onMutation: (event) => mutations.push(event),
    });

    const admitted = await call(first, "send", {
      to: "teammate-2",
      subject: "review",
      body: { file: "src/a.js" },
      message_id: "review-a-v1",
      causation_id: "task-teammate-1",
    });
    expect(admitted).toMatchObject({
      status: "admitted",
      delivery: "at_least_once",
      message: {
        from: "teammate-1",
        to: "teammate-2",
        senderAttempt: {
          taskKey: "task-teammate-1",
          leaseId: "lease-teammate-1",
        },
      },
    });

    const received = await call(second, "receive", {
      wait_ms: 10,
      mark_read: true,
    });
    expect(received).toMatchObject({
      status: "read",
      messages: [
        {
          id: admitted.message.id,
          delivery: { status: "read", deliveryCount: 1 },
        },
      ],
    });
    const acknowledged = await call(second, "ack", {
      message_ids: [admitted.message.id],
      consumer_key: "reviewer-v1",
      disposition: "processed",
    });
    expect(acknowledged).toMatchObject({
      status: "processed",
      receipts: [
        {
          consumerKey: "reviewer-v1",
          recipientAttempt: { taskKey: "task-teammate-2" },
        },
      ],
    });
    expect((await call(second, "receive", {})).messages).toEqual([]);

    const followup = await call(first, "followup", {
      to: "teammate-2",
      body: "please confirm",
      message_id: "followup-a-v1",
    });
    expect(followup).toMatchObject({
      status: "admitted",
      wake: "target_active",
      message: { mode: "followup" },
    });
    expect(mutations.map((event) => event.type)).toEqual([
      "send",
      "receive",
      "ack",
      "followup",
    ]);
  });

  it("returns a real idle-turn wake scheduled by the parent runner", async () => {
    const mailbox = new TeamMailbox({
      recipients: ["teammate-1", "teammate-2"],
    });
    const wakeRequests = [];
    const mutations = [];
    const bridge = await bridgeFor(mailbox, "teammate-1", {
      recipientState: () => ({ state: "idle" }),
      requestFollowupWake: (request) => {
        wakeRequests.push(request);
        return {
          wake: "turn_scheduled",
          recipients: [
            {
              recipient: request.to,
              wake: "turn_scheduled",
              taskKey: "team_followup:1:teammate-2:1",
              wakeAttempt: 1,
            },
          ],
        };
      },
      onMutation: (event) => mutations.push(event),
    });

    const result = await call(bridge, "followup", {
      to: "teammate-2",
      body: "wake and review",
      message_id: "wake-review-v1",
    });

    expect(result).toMatchObject({
      status: "admitted",
      wake: "turn_scheduled",
      wakeRecipients: [
        {
          recipient: "teammate-2",
          taskKey: "team_followup:1:teammate-2:1",
          wakeAttempt: 1,
        },
      ],
    });
    expect(wakeRequests).toHaveLength(1);
    expect(wakeRequests[0]).toMatchObject({
      to: "teammate-2",
      message: { mode: "followup" },
      senderAttempt: { taskKey: "task-teammate-1" },
    });
    expect(mutations.map((event) => event.type)).toEqual([
      "followup",
      "followup-wake",
    ]);
  });

  it("fails closed for a wrong token or stale attempt and hides the token from prompts", async () => {
    const mailbox = new TeamMailbox({
      recipients: ["teammate-1", "teammate-2"],
    });
    let active = true;
    const bridge = await bridgeFor(mailbox, "teammate-1", {
      assertAuthority: () =>
        active ? { holder: "teammate-1", taskKey: "task-a" } : null,
    });

    await expect(
      callTeamMessageBridge({
        endpoint: bridge.endpoint,
        token: "wrong",
        op: "receive",
      }),
    ).rejects.toMatchObject({ code: "TEAM_MESSAGE_BRIDGE_UNAUTHORIZED" });
    active = false;
    await expect(call(bridge, "receive", {})).rejects.toMatchObject({
      code: "TEAM_MESSAGE_BRIDGE_STALE_ATTEMPT",
    });

    const prompt = bridge.decoratePrompt("original task");
    expect(prompt).toContain("team_receive");
    expect(prompt).toContain("Delivery is at-least-once");
    expect(prompt).not.toContain(bridge.token);
    expect(bridge.childEnvironment()).toEqual({
      CC_TEAM_MESSAGE_BRIDGE_ENDPOINT: bridge.endpoint,
      CC_TEAM_MESSAGE_BRIDGE_TOKEN: bridge.token,
      CC_TEAM_MESSAGE_BRIDGE_PROTOCOL: String(TEAM_MESSAGE_BRIDGE_PROTOCOL),
    });
  });

  it("exposes the five host tools through the real child tool bundle", async () => {
    const mailbox = new TeamMailbox({
      recipients: ["teammate-1", "teammate-2"],
    });
    const bridge = await bridgeFor(mailbox, "teammate-1");
    const bundle = resolveTeamMessageToolBundle({
      env: bridge.childEnvironment(),
    });
    expect(
      bundle.extraToolDefinitions.map((tool) => tool.function.name),
    ).toEqual([
      "team_send",
      "team_receive",
      "team_ack",
      "team_followup",
      "team_handoff",
    ]);
    expect(bundle.externalToolDescriptors.team_send).toMatchObject({
      kind: "team-message",
      inheritable: false,
      effectContract: { declaredEffect: "write", sourceTrusted: true },
    });
    expect(bundle.externalToolDescriptors.team_receive).toMatchObject({
      isReadOnly: false,
      effectContract: { declaredEffect: "write" },
    });

    const sent = await bundle.externalToolExecutors.team_send.execute({
      to: "teammate-2",
      body: "from real child tool",
      message_id: "real-child-send-1",
    });
    expect(sent).toMatchObject({
      status: "admitted",
      message: { from: "teammate-1", body: "from real child tool" },
    });
    expect(mailbox.peek("teammate-2")).toHaveLength(1);
  });

  it("forwards handoff actions with parent-bound authority", async () => {
    const mailbox = new TeamMailbox({
      recipients: ["teammate-1", "teammate-2"],
    });
    const requests = [];
    const bridge = await bridgeFor(mailbox, "teammate-1", {
      requestHandoff: (request) => {
        requests.push(request);
        return {
          ok: true,
          key: request.authority.taskKey,
          handoff: { id: request.handoffId, status: "offered" },
        };
      },
    });

    const result = await call(bridge, "handoff", {
      action: "offer",
      handoff_id: "handoff-1",
      to: "teammate-2",
      artifact_ids: ["artifact-1"],
      preconditions: { tests: "green" },
      summary: { next: "review" },
      ttl_ms: 5000,
    });
    expect(result).toMatchObject({
      ok: true,
      key: "task-teammate-1",
      handoff: { id: "handoff-1", status: "offered" },
    });
    expect(requests).toEqual([
      expect.objectContaining({
        action: "offer",
        handoffId: "handoff-1",
        to: "teammate-2",
        artifactIds: ["artifact-1"],
        authority: {
          holder: "teammate-1",
          taskKey: "task-teammate-1",
          leaseId: "lease-teammate-1",
          fencingToken: "fence-teammate-1",
        },
      }),
    ]);
  });

  it("requires retry-safe message ids and returns bounded multi-message batches", async () => {
    const mailbox = new TeamMailbox({
      recipients: ["teammate-1", "teammate-2"],
    });
    const bridge = await bridgeFor(mailbox, "teammate-1");
    await expect(
      call(bridge, "send", { to: "teammate-2", body: "missing id" }),
    ).rejects.toMatchObject({
      code: "TEAM_MESSAGE_BRIDGE_INVALID_ARGUMENT",
    });

    for (let index = 0; index < 5; index += 1) {
      mailbox.send({
        from: "teammate-2",
        to: "teammate-1",
        body: `${index}:${"x".repeat(60_000)}`,
      });
    }
    const received = await call(bridge, "receive", { limit: 5 });
    expect(received.messages).toHaveLength(5);
    expect(received.messages[4].body).toHaveLength(60_002);
  });
});
