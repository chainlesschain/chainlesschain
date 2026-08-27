import { describe, expect, it, vi } from "vitest";

const AICommandHandler = require("../../../../src/main/remote/handlers/ai-handler");

const context = { did: "did:test:bounded-stream" };
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("AICommandHandler bounded polling stream integration", () => {
  it("holds provider admission until physical settlement", async () => {
    const providerResolvers = [];
    const handler = new AICommandHandler(
      {
        chatStream: vi.fn(
          () =>
            new Promise((resolve) => {
              providerResolvers.push(resolve);
            }),
        ),
      },
      null,
      null,
      {
        streamLimits: {
          maxActiveStreams: 1,
          maxRetainedStreams: 2,
          retentionMs: 60_000,
        },
      },
    );

    await handler.chatStream({ message: "first" }, context);
    await expect(
      handler.chatStream({ message: "second" }, context),
    ).rejects.toMatchObject({
      code: "OVERLOADED",
      scope: "active_streams",
      retryAfterMs: 1000,
    });
    expect(handler.activeStreamCount).toBe(1);

    providerResolvers.shift()();
    await flush();
    expect(handler.activeStreamCount).toBe(0);
  });

  it("returns structured UTF-8 overflow state to polling clients", async () => {
    const handler = new AICommandHandler(
      {
        chatStream: async (_messages, onChunk) => {
          onChunk("测试");
        },
      },
      null,
      null,
      {
        streamLimits: {
          maxBytesPerStream: 5,
          retentionMs: 60_000,
        },
      },
    );

    const started = await handler.chatStream({ message: "bytes" }, context);
    await flush();
    const result = await handler.getStreamChunk(
      { streamId: started.streamId },
      context,
    );

    expect(result).toMatchObject({
      chunks: [],
      isComplete: true,
      errorCode: "STREAM_BUFFER_LIMIT_EXCEEDED",
      bufferedBytes: 0,
      limit: {
        maxChunks: 2048,
        maxBytes: 5,
        maxTotalBytes: 16 * 1024 * 1024,
      },
      received: { chunks: 1, bytes: 6, totalBytes: 6 },
    });
    expect(handler.activeStreamCount).toBe(0);
  });

  it("does not persist partial assistant output after provider failure", async () => {
    const handler = new AICommandHandler(
      {
        chatStream: async (_messages, onChunk) => {
          onChunk("partial");
          throw new Error("provider failed");
        },
      },
      null,
      null,
      { streamLimits: { retentionMs: 60_000 } },
    );
    handler._insertMessage = vi.fn();

    const started = await handler.chatStream({ message: "question" }, context);
    await flush();

    const roles = handler._insertMessage.mock.calls.map((call) => call[2]);
    expect(roles).toEqual(["user"]);
    expect(handler.activeStreams.get(started.streamId)).toMatchObject({
      done: true,
      error: "provider failed",
      errorCode: "STREAM_PROVIDER_ERROR",
    });
  });

  it("applies the same byte boundary to agent streams", async () => {
    const handler = new AICommandHandler(
      {
        agents: {
          runStream: async (_agentId, _input, _options, onChunk) => {
            onChunk("ab");
            onChunk({ content: "cd" });
          },
        },
      },
      null,
      null,
      {
        streamLimits: {
          maxBytesPerStream: 3,
          retentionMs: 60_000,
        },
      },
    );

    const started = await handler.runAgentStream(
      { agentId: "agent-1", input: "work" },
      context,
    );
    await flush();
    const result = await handler.getStreamChunk(
      { streamId: started.streamId },
      context,
    );

    expect(result.chunks).toEqual(["ab"]);
    expect(result.errorCode).toBe("STREAM_BUFFER_LIMIT_EXCEEDED");
    expect(result.bufferedBytes).toBe(2);
  });
});
