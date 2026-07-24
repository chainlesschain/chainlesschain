import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  BACKGROUND_INTERACTION_PROTOCOL_VERSION,
  attachInteractionRequestHandler,
  createBackgroundInteractionClient,
} from "../../src/lib/background-interaction-resolver.js";

function fakeIpcEndpoint() {
  const endpoint = new EventEmitter();
  endpoint.connected = true;
  endpoint.sent = [];
  endpoint.send = vi.fn((message, callback) => {
    endpoint.sent.push(message);
    callback?.();
    return true;
  });
  return endpoint;
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("background interaction child client", () => {
  it("resolves only a response with the original turn/tool binding", async () => {
    const processLike = fakeIpcEndpoint();
    processLike.env = { CC_BACKGROUND_AGENT_ID: "bg-1" };
    const client = createBackgroundInteractionClient({
      processLike,
      sessionId: "session-1",
      turnId: "turn-7",
      idFactory: () => "request-1",
    });

    const answerPromise = client.request({
      question: "Deploy?",
      options: ["yes", "no"],
      toolUseId: "tool-call-9",
      timeoutMs: 5_000,
    });
    const request = processLike.sent[0];

    processLike.emit("message", {
      type: "interaction-response",
      protocolVersion: BACKGROUND_INTERACTION_PROTOCOL_VERSION,
      requestId: request.requestId,
      binding: { ...request.binding, toolUseId: "different-tool" },
      status: "resolved",
      answer: "forged",
    });
    expect(client.pendingCount()).toBe(1);

    processLike.emit("message", {
      type: "interaction-response",
      protocolVersion: BACKGROUND_INTERACTION_PROTOCOL_VERSION,
      requestId: request.requestId,
      binding: request.binding,
      status: "resolved",
      answer: "yes",
    });

    await expect(answerPromise).resolves.toBe("yes");
    expect(client.pendingCount()).toBe(0);
    client.close();
  });

  it("times out fail-closed and cancels the worker request", async () => {
    vi.useFakeTimers();
    try {
      const processLike = fakeIpcEndpoint();
      processLike.env = { CC_BACKGROUND_AGENT_ID: "bg-1" };
      const client = createBackgroundInteractionClient({
        processLike,
        sessionId: "session-1",
        turnId: "turn-1",
        idFactory: () => "request-timeout",
      });

      const answerPromise = client.request({
        question: "Continue?",
        toolUseId: "tool-1",
        timeoutMs: 25,
      });
      const rejection = expect(answerPromise).rejects.toMatchObject({
        code: "USER_TIMEOUT",
      });
      await vi.advanceTimersByTimeAsync(25);
      await rejection;
      expect(processLike.sent.at(-1)).toMatchObject({
        type: "interaction-cancel",
        requestId: "bg-1:request-timeout",
      });
      client.close();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("background interaction worker handler", () => {
  it("returns the answer with the exact request binding", async () => {
    const child = fakeIpcEndpoint();
    const resolver = vi.fn(async (payload) => `${payload.question} yes`);
    const detach = attachInteractionRequestHandler(child, resolver, {
      backgroundAgentId: "bg-1",
      sessionId: "session-1",
    });
    const request = {
      type: "interaction-request",
      protocolVersion: BACKGROUND_INTERACTION_PROTOCOL_VERSION,
      requestId: "request-1",
      binding: {
        backgroundAgentId: "bg-1",
        sessionId: "session-1",
        turnId: "turn-1",
        toolUseId: "tool-1",
        sequence: 1,
      },
      payload: { kind: "question", question: "Deploy?" },
    };

    child.emit("message", request);
    await flush();

    expect(resolver).toHaveBeenCalledWith(
      request.payload,
      request,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(child.sent).toContainEqual({
      type: "interaction-response",
      protocolVersion: BACKGROUND_INTERACTION_PROTOCOL_VERSION,
      requestId: "request-1",
      binding: request.binding,
      status: "resolved",
      answer: "Deploy? yes",
    });
    detach();
  });

  it("rejects cross-session requests before invoking the resolver", async () => {
    const child = fakeIpcEndpoint();
    const resolver = vi.fn();
    const detach = attachInteractionRequestHandler(child, resolver, {
      backgroundAgentId: "bg-1",
      sessionId: "session-1",
    });

    child.emit("message", {
      type: "interaction-request",
      protocolVersion: BACKGROUND_INTERACTION_PROTOCOL_VERSION,
      requestId: "request-cross-session",
      binding: {
        backgroundAgentId: "bg-1",
        sessionId: "session-2",
        turnId: "turn-1",
        toolUseId: "tool-1",
        sequence: 1,
      },
      payload: { kind: "question", question: "Deploy?" },
    });
    await flush();

    expect(resolver).not.toHaveBeenCalled();
    expect(child.sent.at(-1)).toMatchObject({
      status: "rejected",
      error: { code: "INTERACTION_BINDING_MISMATCH" },
    });
    detach();
  });

  it("replays the settled response for a duplicate request at most once", async () => {
    const child = fakeIpcEndpoint();
    const resolver = vi.fn(async () => "answer");
    const detach = attachInteractionRequestHandler(child, resolver, {
      backgroundAgentId: "bg-1",
      sessionId: "session-1",
    });
    const request = {
      type: "interaction-request",
      protocolVersion: BACKGROUND_INTERACTION_PROTOCOL_VERSION,
      requestId: "request-retry",
      binding: {
        backgroundAgentId: "bg-1",
        sessionId: "session-1",
        turnId: "turn-1",
        toolUseId: "tool-1",
        sequence: 1,
      },
      payload: { kind: "question", question: "Deploy?" },
    };

    child.emit("message", request);
    await flush();
    child.emit("message", request);
    await flush();

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(
      child.sent.filter((message) => message.requestId === "request-retry"),
    ).toHaveLength(2);
    detach();
  });
});
