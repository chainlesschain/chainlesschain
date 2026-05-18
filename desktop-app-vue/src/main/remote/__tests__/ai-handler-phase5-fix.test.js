/**
 * AICommandHandler — Phase 6.4 Action 1 测试
 *
 * 覆盖 Phase 5 修 bug 后新加的 7 method:
 *   chatStream / getStreamChunk / cancelStream / getConversation /
 *   createConversation / deleteConversation / getMessages
 *
 * 使用 in-memory better-sqlite3 db (零依赖, 隔离) + 假 LLM Engine。
 *
 * 关联: docs/design/iOS_Phase_6_3_6_4_Knowledge_AI_Desktop_Debt.md §2.2 +
 *      docs/design/iOS_Phase_5_AI_Chat_Skill.md
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

// better-sqlite3-multiple-ciphers ships prebuilt binaries for Node 22+ (vs
// better-sqlite3 needs build-from-source on Node 23). 用 require 不用 import
// 以兼容 cjs.
const Database = require("better-sqlite3-multiple-ciphers");
const AICommandHandler = require("../handlers/ai-handler");

describe("AICommandHandler — Phase 6.4 Action 1 (7 new methods)", () => {
  let handler;
  let db;
  let mockAiEngine;
  const ctx = { did: "did:test:phone" };

  beforeEach(() => {
    db = new Database(":memory:");
    // 关闭 FK 强制（Action 1 测试用 in-memory）
    db.pragma("foreign_keys = ON");

    mockAiEngine = {
      chat: async (messages, _options) => ({
        content: "假回复: " + (messages[messages.length - 1].content || ""),
        usage: { prompt: 10, completion: 20, total: 30 },
      }),
      chatStream: async (messages, onChunk, _options) => {
        // 模拟 token-by-token 流式
        const text =
          "Streaming: " + (messages[messages.length - 1].content || "");
        for (const ch of text.split("")) {
          onChunk(ch);
          await new Promise((r) => setImmediate(r));
        }
      },
    };

    handler = new AICommandHandler(mockAiEngine, null, db, {});
  });

  afterEach(() => {
    db.close();
  });

  // ===== Schema =====

  describe("_ensureSchema", () => {
    it("creates ai_conversations + ai_messages tables", () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r) => r.name);
      expect(tables).toContain("ai_conversations");
      expect(tables).toContain("ai_messages");
    });
  });

  // ===== createConversation =====

  describe("createConversation", () => {
    it("creates conv with defaults", async () => {
      const r = await handler.handle("createConversation", {}, ctx);
      expect(r.success).toBe(true);
      expect(r.conversationId).toMatch(/^conv_/);
      expect(r.conversation.title).toBe("新对话");
      expect(r.conversation.messageCount).toBe(0);
      expect(r.conversation.archived).toBe(false);
    });

    it("accepts title and model", async () => {
      const r = await handler.handle(
        "createConversation",
        { title: "我的对话", model: "qwen2:7b", systemPrompt: "你是助手" },
        ctx,
      );
      expect(r.conversation.title).toBe("我的对话");
      expect(r.conversation.model).toBe("qwen2:7b");
    });
  });

  // ===== getConversation =====

  describe("getConversation", () => {
    it("returns null for missing id", async () => {
      const r = await handler.handle(
        "getConversation",
        { conversationId: "nope" },
        ctx,
      );
      expect(r.success).toBe(false);
      expect(r.conversation).toBeNull();
    });

    it("returns existing conversation", async () => {
      const created = await handler.handle(
        "createConversation",
        { title: "X" },
        ctx,
      );
      const r = await handler.handle(
        "getConversation",
        { conversationId: created.conversationId },
        ctx,
      );
      expect(r.success).toBe(true);
      expect(r.conversation.id).toBe(created.conversationId);
      expect(r.conversation.title).toBe("X");
    });

    it("throws when conversationId missing", async () => {
      await expect(handler.handle("getConversation", {}, ctx)).rejects.toThrow(
        /conversationId/,
      );
    });
  });

  // ===== deleteConversation =====

  describe("deleteConversation", () => {
    it("removes conv + cascade messages", async () => {
      const c = await handler.handle("createConversation", {}, ctx);
      // 写一条 message
      handler._insertMessage("m1", c.conversationId, "user", "hello", null);
      const before = db
        .prepare(
          "SELECT COUNT(*) AS n FROM ai_messages WHERE conversation_id = ?",
        )
        .get(c.conversationId).n;
      expect(before).toBe(1);

      const r = await handler.handle(
        "deleteConversation",
        { conversationId: c.conversationId },
        ctx,
      );
      expect(r.success).toBe(true);

      const after = db
        .prepare(
          "SELECT COUNT(*) AS n FROM ai_messages WHERE conversation_id = ?",
        )
        .get(c.conversationId).n;
      expect(after).toBe(0);
    });

    it("throws when conversationId missing", async () => {
      await expect(
        handler.handle("deleteConversation", {}, ctx),
      ).rejects.toThrow(/conversationId/);
    });
  });

  // ===== getMessages =====

  describe("getMessages", () => {
    it("returns messages in createdAt ASC order", async () => {
      const c = await handler.handle("createConversation", {}, ctx);
      handler._insertMessage("m1", c.conversationId, "user", "Q1", null);
      // 强制不同 createdAt (insert 内部用 Date.now())
      await new Promise((r) => setTimeout(r, 5));
      handler._insertMessage(
        "m2",
        c.conversationId,
        "assistant",
        "A1",
        "qwen2",
      );

      const r = await handler.handle(
        "getMessages",
        { conversationId: c.conversationId },
        ctx,
      );
      expect(r.success).toBe(true);
      expect(r.messages).toHaveLength(2);
      expect(r.messages[0].role).toBe("user");
      expect(r.messages[1].role).toBe("assistant");
      expect(r.messages[1].modelUsed).toBe("qwen2");
    });

    it("respects limit + offset", async () => {
      const c = await handler.handle("createConversation", {}, ctx);
      for (let i = 0; i < 5; i++) {
        handler._insertMessage(
          `m${i}`,
          c.conversationId,
          "user",
          `Q${i}`,
          null,
        );
        await new Promise((r) => setTimeout(r, 1));
      }
      const r = await handler.handle(
        "getMessages",
        { conversationId: c.conversationId, limit: 2, offset: 2 },
        ctx,
      );
      expect(r.messages).toHaveLength(2);
    });
  });

  // ===== chatStream =====

  describe("chatStream", () => {
    it("returns streamId + conversationId immediately", async () => {
      const r = await handler.handle("chatStream", { message: "Hi" }, ctx);
      expect(r.success).toBe(true);
      expect(r.streamId).toMatch(/^stream_/);
      expect(r.conversationId).toMatch(/^conv_/);
    });

    it("populates chunks as LLM streams", async () => {
      const start = await handler.handle("chatStream", { message: "Hi" }, ctx);
      // 等流式跑完
      await new Promise((r) => setTimeout(r, 200));
      const state = handler.activeStreams.get(start.streamId);
      expect(state).toBeDefined();
      expect(state.done).toBe(true);
      expect(state.chunks.length).toBeGreaterThan(0);
      expect(state.chunks.join("")).toContain("Streaming");
    });

    it("falls back to chat() when chatStream not available", async () => {
      // 重建 handler with engine lacking chatStream
      const fallbackEngine = {
        chat: async (msgs) => ({
          content: "non-streaming reply: " + msgs[0].content,
        }),
      };
      const h2 = new AICommandHandler(fallbackEngine, null, db, {});
      const r = await h2.handle("chatStream", { message: "Q" }, ctx);
      await new Promise((r) => setTimeout(r, 50));
      const state = h2.activeStreams.get(r.streamId);
      expect(state.done).toBe(true);
      expect(state.chunks.join("")).toContain("non-streaming reply");
    });

    it("requires non-empty message", async () => {
      await expect(
        handler.handle("chatStream", { message: "" }, ctx),
      ).rejects.toThrow(/message/);
    });

    it("persists user message to ai_messages", async () => {
      const r = await handler.handle(
        "chatStream",
        { message: "用户问题 X" },
        ctx,
      );
      await new Promise((res) => setTimeout(res, 100));
      const rows = db
        .prepare(
          "SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY created_at",
        )
        .all(r.conversationId);
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0].role).toBe("user");
      expect(rows[0].content).toBe("用户问题 X");
    });
  });

  // ===== getStreamChunk =====

  describe("getStreamChunk", () => {
    it("returns chunks since sinceChunk", async () => {
      const start = await handler.handle(
        "chatStream",
        { message: "Hello" },
        ctx,
      );
      // wait for some chunks but not done
      await new Promise((r) => setTimeout(r, 50));
      const r = await handler.handle(
        "getStreamChunk",
        { streamId: start.streamId, sinceChunk: 0 },
        ctx,
      );
      expect(r.success).toBe(true);
      expect(r.chunks.length).toBeGreaterThan(0);
      expect(r.nextChunkIdx).toBeGreaterThan(0);
    });

    it("isComplete=true after stream done", async () => {
      const start = await handler.handle("chatStream", { message: "Hi" }, ctx);
      await new Promise((r) => setTimeout(r, 200));
      const r = await handler.handle(
        "getStreamChunk",
        { streamId: start.streamId },
        ctx,
      );
      expect(r.isComplete).toBe(true);
    });

    it("unknown streamId returns isComplete=true (graceful)", async () => {
      const r = await handler.handle(
        "getStreamChunk",
        { streamId: "nonexistent" },
        ctx,
      );
      expect(r.isComplete).toBe(true);
      expect(r.chunks).toEqual([]);
      expect(r.error).toContain("not found");
    });

    it("requires streamId", async () => {
      await expect(handler.handle("getStreamChunk", {}, ctx)).rejects.toThrow(
        /streamId/,
      );
    });
  });

  // ===== cancelStream =====

  describe("cancelStream", () => {
    it("cancels active stream", async () => {
      const start = await handler.handle(
        "chatStream",
        { message: "Hello" },
        ctx,
      );
      // 立即 cancel
      const r = await handler.handle(
        "cancelStream",
        { streamId: start.streamId },
        ctx,
      );
      expect(r.success).toBe(true);
      expect(r.cancelled).toBe(true);
    });

    it("returns cancelled=false for unknown streamId", async () => {
      const r = await handler.handle("cancelStream", { streamId: "nope" }, ctx);
      expect(r.success).toBe(true);
      expect(r.cancelled).toBe(false);
    });

    it("subsequent getStreamChunk shows cancelled=true", async () => {
      const start = await handler.handle(
        "chatStream",
        { message: "Hello" },
        ctx,
      );
      await handler.handle("cancelStream", { streamId: start.streamId }, ctx);
      const r = await handler.handle(
        "getStreamChunk",
        { streamId: start.streamId },
        ctx,
      );
      expect(r.cancelled).toBe(true);
      expect(r.isComplete).toBe(true);
    });
  });

  // ===== Integration: full UI flow =====

  describe("full Phase 5 UI flow", () => {
    it("end-to-end: createConversation → chatStream → getStreamChunk → getMessages", async () => {
      // 1. create
      const c = await handler.handle(
        "createConversation",
        { title: "测试对话", model: "qwen2:7b" },
        ctx,
      );
      expect(c.success).toBe(true);

      // 2. chatStream (reuse existing conv id)
      const s = await handler.handle(
        "chatStream",
        { message: "你好", conversationId: c.conversationId },
        ctx,
      );
      expect(s.conversationId).toBe(c.conversationId);

      // 3. polling getStreamChunk 直到 isComplete
      let nextChunkIdx = 0;
      let allChunks = [];
      for (let i = 0; i < 20; i++) {
        const chunk = await handler.handle(
          "getStreamChunk",
          { streamId: s.streamId, sinceChunk: nextChunkIdx },
          ctx,
        );
        allChunks = allChunks.concat(chunk.chunks);
        nextChunkIdx = chunk.nextChunkIdx;
        if (chunk.isComplete) {
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(allChunks.length).toBeGreaterThan(0);

      // 4. getMessages 应该有 user + assistant
      await new Promise((r) => setTimeout(r, 50)); // flush DB
      const msgs = await handler.handle(
        "getMessages",
        { conversationId: c.conversationId },
        ctx,
      );
      expect(msgs.messages.length).toBeGreaterThanOrEqual(2);
      expect(msgs.messages[0].role).toBe("user");
      expect(msgs.messages[msgs.messages.length - 1].role).toBe("assistant");
    });
  });
});
