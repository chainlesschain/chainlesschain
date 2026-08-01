import { describe, expect, it, vi } from "vitest";
import { WebSocketInteractionAdapter } from "../../src/lib/interaction-adapter.js";

describe("WebSocket pending approval persistence hook", () => {
  it("records before send, settles on answer, and keeps the wire frame compatible", async () => {
    const order = [];
    const changes = [];
    const ws = {
      OPEN: 1,
      readyState: 1,
      send: vi.fn((serialized) => {
        order.push("send");
        ws.last = JSON.parse(serialized);
      }),
    };
    const adapter = new WebSocketInteractionAdapter(ws, "sess-approval", {
      onPendingApprovalChange: (change) => {
        order.push("persist");
        changes.push(change);
      },
    });

    const answer = adapter.askConfirm("Approve command?", {
      default: false,
      binding: "binding-digest",
      approval: {
        tool: "run_command",
        command: "secret-bearing command must not be persisted",
        risk: "high",
        rule: "confirm",
      },
    });

    expect(order.slice(0, 2)).toEqual(["persist", "send"]);
    expect(changes[0]).toEqual({
      type: "approval.requested",
      payload: expect.objectContaining({
        requestId: ws.last.requestId,
        status: "pending",
        binding: "binding-digest",
        tool: "run_command",
        risk: "high",
        rule: "confirm",
      }),
    });
    expect(changes[0].payload).not.toHaveProperty("command");
    expect(ws.last).toMatchObject({
      type: "question",
      questionType: "confirm",
      question: "Approve command?",
      sessionId: "sess-approval",
      requestId: expect.any(String),
      binding: "binding-digest",
      approval: {
        tool: "run_command",
        command: "secret-bearing command must not be persisted",
        risk: "high",
        rule: "confirm",
      },
    });

    adapter.resolveAnswer(ws.last.requestId, true, "binding-digest");
    await expect(answer).resolves.toBe(true);
    expect(changes.at(-1)).toEqual({
      type: "approval.settled",
      payload: {
        requestId: ws.last.requestId,
        reason: "approved",
      },
    });
  });

  it("settles a pending approval when an interrupt rejects all questions", async () => {
    const changes = [];
    const ws = {
      OPEN: 1,
      readyState: 1,
      send: vi.fn(),
    };
    const adapter = new WebSocketInteractionAdapter(ws, "sess-interrupt", {
      onPendingApprovalChange: (change) => changes.push(change),
    });
    const answer = adapter.askConfirm("Approve?", {
      default: false,
      binding: "binding-digest",
      approval: { tool: "write_file", risk: "high" },
    });

    adapter.rejectAllPending(new Error("stopped"));

    await expect(answer).rejects.toThrow("stopped");
    expect(changes.map((change) => change.type)).toEqual([
      "approval.requested",
      "approval.settled",
    ]);
    expect(changes.at(-1).payload.reason).toBe("interrupted");
  });
});
