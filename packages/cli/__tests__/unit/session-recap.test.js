import { describe, expect, it, vi } from "vitest";
import {
  buildSessionRecap,
  recapPreview,
  renderSessionRecap,
} from "../../src/repl/session-recap.js";

describe("lightweight session recap", () => {
  it("uses metadata and bounded reverse-event lookups only", () => {
    const store = {
      resolveSessionId: vi.fn(() => "session-123"),
      getJsonlSessionMetadata: vi.fn(() => ({
        id: "session-123",
        title: "Ship recap",
        provider: "provider-neutral",
        model: "model-x",
        message_count: 41,
        created_at: "2026-08-01T01:00:00.000Z",
        updated_at: "2026-08-01T02:00:00.000Z",
      })),
      findLatestEvent: vi
        .fn()
        .mockReturnValueOnce({
          type: "compact",
          timestamp: Date.parse("2026-08-01T01:59:00.000Z"),
          data: {
            strategy: "auto",
            originalMessages: 38,
            compressedMessages: 8,
            saved: 5100,
            messages: [
              { role: "user", content: "请继续实现 recap" },
              { role: "assistant", content: "已完成轻量索引读取。" },
            ],
          },
        })
        .mockReturnValueOnce({
          type: "user_message",
          timestamp: Date.parse("2026-08-01T02:00:00.000Z"),
          data: { content: "现在运行测试" },
        }),
      readEvents: vi.fn(() => {
        throw new Error("full transcript must not be read");
      }),
    };

    const recap = buildSessionRecap("session-1", { store });

    expect(recap).toMatchObject({
      found: true,
      sessionId: "session-123",
      title: "Ship recap",
      messageCount: 41,
      source: "session-metadata+reverse-events",
      latestTurn: { role: "user", preview: "现在运行测试" },
      checkpoint: {
        strategy: "auto",
        originalMessages: 38,
        compressedMessages: 8,
        savedTokens: 5100,
      },
    });
    expect(store.findLatestEvent).toHaveBeenNthCalledWith(
      1,
      "session-123",
      "compact",
    );
    expect(store.findLatestEvent).toHaveBeenNthCalledWith(2, "session-123", [
      "user_message",
      "assistant_message",
    ]);
    expect(store.readEvents).not.toHaveBeenCalled();
  });

  it("renders plain linear output suitable for narrow/screen-reader terminals", () => {
    const output = renderSessionRecap({
      found: true,
      sessionId: "s-1",
      title: "中文会话",
      provider: "local",
      model: "m",
      messageCount: 2,
      updatedAt: "2026-08-01T00:00:00.000Z",
      checkpoint: null,
      latestTurn: { role: "assistant", preview: "已完成。" },
    });
    expect(output).toMatchInlineSnapshot(`
      "Session recap: 中文会话
      ID: s-1
      Messages: 2
      Model: local / m
      Updated: 2026-08-01T00:00:00.000Z
      Checkpoint: none yet
      Latest reply: 已完成。"
    `);
    expect(output).not.toContain(String.fromCharCode(27));
    for (const decorativeSymbol of ["✅", "❌", "⚠️"]) {
      expect(output).not.toContain(decorativeSymbol);
    }
  });

  it("bounds and sanitizes event previews", () => {
    expect(recapPreview("abc\u0000\n   中文内容", 20)).toBe("abc 中文内容");
    expect(recapPreview("x".repeat(40), 20)).toBe(`${"x".repeat(19)}…`);
  });

  it("does not throw on out-of-range event timestamps", () => {
    const recap = buildSessionRecap("s", {
      store: {
        resolveSessionId: () => "s",
        getJsonlSessionMetadata: () => ({ id: "s", message_count: 1 }),
        findLatestEvent: vi
          .fn()
          .mockReturnValueOnce({
            type: "compact",
            timestamp: Number.MAX_VALUE,
            data: {},
          })
          .mockReturnValueOnce({
            type: "assistant_message",
            timestamp: Number.MAX_VALUE,
            data: { content: "done" },
          }),
      },
    });
    expect(recap.checkpoint.timestamp).toBe("");
    expect(recap.latestTurn.timestamp).toBe("");
  });

  it("returns an explicit not-found result", () => {
    expect(
      buildSessionRecap("missing", {
        store: {
          resolveSessionId: () => null,
          getJsonlSessionMetadata: vi.fn(),
          findLatestEvent: vi.fn(),
        },
      }),
    ).toEqual({
      found: false,
      sessionId: "missing",
      reason: "session not found: missing",
    });
  });

  it("strips terminal control characters from metadata labels", () => {
    const recap = buildSessionRecap("s", {
      store: {
        resolveSessionId: () => "s",
        getJsonlSessionMetadata: () => ({
          id: "s",
          title: "unsafe\u001b[31m title",
          provider: "local\nprovider",
          model: "m\u0000x",
        }),
        findLatestEvent: () => null,
      },
    });
    expect(recap).toMatchObject({
      title: "unsafe [31m title",
      provider: "local provider",
      model: "m x",
    });
    expect(renderSessionRecap(recap)).not.toContain(String.fromCharCode(27));
  });
});
