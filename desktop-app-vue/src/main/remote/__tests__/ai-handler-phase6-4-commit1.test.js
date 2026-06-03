/**
 * AICommandHandler — Phase 6.4 commit 1 测试
 *
 * 覆盖新加 13 method:
 *   Conversations 高级 5: updateConversation / archiveConversation /
 *     unarchiveConversation / searchConversations / exportConversation
 *   Prompt templates 3: getPromptTemplates / savePromptTemplate / deletePromptTemplate
 *   RAG 5: ragSearchAdvanced / ragIndex / ragDelete / ragListDocuments / ragStats
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const Database = require("better-sqlite3-multiple-ciphers");
const AICommandHandler = require("../handlers/ai-handler");

describe("AICommandHandler — Phase 6.4 commit 1 (13 new methods)", () => {
  let handler;
  let db;
  let mockRagManager;
  const ctx = { did: "did:test:phone" };

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");

    mockRagManager = {
      searchAdvanced: async ({ query, topK, scoreThreshold }) =>
        [
          {
            id: "d1",
            text: `match for ${query}`,
            score: 0.9,
            metadata: { tag: "A" },
          },
          { id: "d2", text: "low score", score: 0.3, metadata: { tag: "B" } },
        ]
          .filter((r) => (scoreThreshold ? r.score >= scoreThreshold : true))
          .slice(0, topK),
      indexDocument: async ({ id }) => ({ id, ok: true }),
      deleteDocument: async (_id) => true,
      listDocuments: async () => [
        { id: "d1", text: "doc 1" },
        { id: "d2", text: "doc 2" },
      ],
      stats: async () => ({ totalDocs: 42, totalVectors: 168, dim: 384 }),
    };

    handler = new AICommandHandler(null, mockRagManager, db, {});
  });

  afterEach(() => {
    db.close();
  });

  function makeConv(id, title = "T", model = "m1") {
    db.prepare(
      `INSERT INTO ai_conversations
        (id, title, model, created_at, last_message_at, message_count, archived)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
    ).run(id, title, model, Date.now(), Date.now(), 0);
  }

  function addMessage(convId, role, content) {
    const id = `msg_${Date.now()}_${Math.random()}`;
    db.prepare(
      `INSERT INTO ai_messages (id, conversation_id, role, content, created_at, is_streaming)
       VALUES (?, ?, ?, ?, ?, 0)`,
    ).run(id, convId, role, content, Date.now());
    db.prepare(
      `UPDATE ai_conversations SET message_count = message_count + 1 WHERE id = ?`,
    ).run(convId);
  }

  // ===== Schema =====

  describe("_ensureSchema — Phase 6.4 commit 1", () => {
    it("creates ai_prompt_templates table", () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r) => r.name);
      expect(tables).toContain("ai_prompt_templates");
    });
  });

  // ===== Conversations 高级 =====

  describe("updateConversation", () => {
    it("updates title only", async () => {
      makeConv("c1");
      const r = await handler.handle(
        "updateConversation",
        { conversationId: "c1", title: "New title" },
        ctx,
      );
      expect(r.conversationId).toBe("c1");
      const row = db
        .prepare("SELECT title, model FROM ai_conversations WHERE id = ?")
        .get("c1");
      expect(row.title).toBe("New title");
      expect(row.model).toBe("m1"); // unchanged
    });

    it("updates model + systemPrompt together", async () => {
      makeConv("c1");
      await handler.handle(
        "updateConversation",
        { conversationId: "c1", model: "m2", systemPrompt: "You are helpful" },
        ctx,
      );
      const row = db
        .prepare(
          "SELECT model, system_prompt FROM ai_conversations WHERE id = ?",
        )
        .get("c1");
      expect(row.model).toBe("m2");
      expect(row.system_prompt).toBe("You are helpful");
    });

    it("throws when no field provided", async () => {
      makeConv("c1");
      await expect(
        handler.handle("updateConversation", { conversationId: "c1" }, ctx),
      ).rejects.toThrow("At least one of title/model/systemPrompt required");
    });

    it("throws on missing conversationId", async () => {
      await expect(
        handler.handle("updateConversation", { title: "x" }, ctx),
      ).rejects.toThrow("conversationId is required");
    });

    it("throws on non-existent conversation", async () => {
      await expect(
        handler.handle(
          "updateConversation",
          { conversationId: "nope", title: "x" },
          ctx,
        ),
      ).rejects.toThrow("Conversation not found");
    });
  });

  describe("archiveConversation / unarchiveConversation", () => {
    it("archive sets archived=1", async () => {
      makeConv("c1");
      const r = await handler.handle(
        "archiveConversation",
        { conversationId: "c1" },
        ctx,
      );
      expect(r.archived).toBe(true);
      const row = db
        .prepare("SELECT archived FROM ai_conversations WHERE id = ?")
        .get("c1");
      expect(row.archived).toBe(1);
    });

    it("unarchive sets archived=0", async () => {
      makeConv("c1");
      await handler.handle(
        "archiveConversation",
        { conversationId: "c1" },
        ctx,
      );
      const r = await handler.handle(
        "unarchiveConversation",
        { conversationId: "c1" },
        ctx,
      );
      expect(r.archived).toBe(false);
      const row = db
        .prepare("SELECT archived FROM ai_conversations WHERE id = ?")
        .get("c1");
      expect(row.archived).toBe(0);
    });

    it("archive throws on non-existent conversation", async () => {
      await expect(
        handler.handle("archiveConversation", { conversationId: "nope" }, ctx),
      ).rejects.toThrow("Conversation not found");
    });
  });

  describe("searchConversations", () => {
    it("matches by title (default excludes archived)", async () => {
      makeConv("c1", "Hello world");
      makeConv("c2", "Other talk");
      makeConv("c3", "Hello again");
      const r = await handler.handle(
        "searchConversations",
        { query: "Hello" },
        ctx,
      );
      expect(r.total).toBe(2);
      const ids = r.conversations.map((c) => c.id).sort();
      expect(ids).toEqual(["c1", "c3"]);
    });

    it("matches by message content", async () => {
      makeConv("c1", "Generic");
      addMessage("c1", "user", "What is quantum mechanics?");
      const r = await handler.handle(
        "searchConversations",
        { query: "quantum" },
        ctx,
      );
      expect(r.total).toBe(1);
      expect(r.conversations[0].id).toBe("c1");
    });

    it("excludes archived unless archived=true", async () => {
      makeConv("c1", "Hello");
      makeConv("c2", "Hello archived");
      await handler.handle(
        "archiveConversation",
        { conversationId: "c2" },
        ctx,
      );
      const r1 = await handler.handle(
        "searchConversations",
        { query: "Hello" },
        ctx,
      );
      expect(r1.conversations.map((c) => c.id)).toEqual(["c1"]);
      const r2 = await handler.handle(
        "searchConversations",
        { query: "Hello", archived: true },
        ctx,
      );
      expect(r2.conversations.map((c) => c.id)).toEqual(["c2"]);
    });

    it("throws on missing query", async () => {
      await expect(
        handler.handle("searchConversations", {}, ctx),
      ).rejects.toThrow("query is required");
    });
  });

  describe("exportConversation", () => {
    it("markdown format renders headers + messages", async () => {
      makeConv("c1", "My Chat", "gpt-4");
      addMessage("c1", "user", "Hi");
      addMessage("c1", "assistant", "Hello!");
      const r = await handler.handle(
        "exportConversation",
        { conversationId: "c1", format: "markdown" },
        ctx,
      );
      expect(r.mime).toBe("text/markdown");
      expect(r.content).toContain("# My Chat");
      expect(r.content).toContain("Model: gpt-4");
      expect(r.content).toContain("## user");
      expect(r.content).toContain("Hi");
      expect(r.content).toContain("## assistant");
      expect(r.content).toContain("Hello!");
      expect(r.messageCount).toBe(2);
    });

    it("json format parses to object", async () => {
      makeConv("c1");
      addMessage("c1", "user", "Test");
      const r = await handler.handle(
        "exportConversation",
        { conversationId: "c1", format: "json" },
        ctx,
      );
      expect(r.mime).toBe("application/json");
      const parsed = JSON.parse(r.content);
      expect(parsed.conversation.id).toBe("c1");
      expect(parsed.messages.length).toBe(1);
      expect(parsed.messages[0].content).toBe("Test");
    });

    it("throws on non-existent conversation", async () => {
      await expect(
        handler.handle("exportConversation", { conversationId: "nope" }, ctx),
      ).rejects.toThrow("Conversation not found");
    });
  });

  // ===== Prompt templates =====

  describe("savePromptTemplate / getPromptTemplates / deletePromptTemplate", () => {
    it("save creates new with auto id", async () => {
      const r = await handler.handle(
        "savePromptTemplate",
        {
          name: "Summarize",
          template: "Summarize {{topic}} in {{words}} words",
          variables: ["topic", "words"],
          category: "writing",
        },
        ctx,
      );
      expect(r.templateId).toMatch(/^tpl_/);
      expect(r.message).toBe("Template created");
      const row = db
        .prepare("SELECT * FROM ai_prompt_templates WHERE id = ?")
        .get(r.templateId);
      expect(row.name).toBe("Summarize");
      expect(JSON.parse(row.variables)).toEqual(["topic", "words"]);
    });

    it("save with id upserts", async () => {
      const r1 = await handler.handle(
        "savePromptTemplate",
        { id: "fixed-1", name: "Old name", template: "X" },
        ctx,
      );
      expect(r1.message).toBe("Template updated");
      const r2 = await handler.handle(
        "savePromptTemplate",
        { id: "fixed-1", name: "New name", template: "Y" },
        ctx,
      );
      expect(r2.templateId).toBe("fixed-1");
      const row = db
        .prepare("SELECT name, template FROM ai_prompt_templates WHERE id = ?")
        .get("fixed-1");
      expect(row.name).toBe("New name");
      expect(row.template).toBe("Y");
    });

    it("get lists with category filter", async () => {
      await handler.handle(
        "savePromptTemplate",
        { name: "Code", template: "C", category: "coding" },
        ctx,
      );
      await handler.handle(
        "savePromptTemplate",
        { name: "Story", template: "S", category: "writing" },
        ctx,
      );
      const all = await handler.handle("getPromptTemplates", {}, ctx);
      expect(all.total).toBe(2);
      const writing = await handler.handle(
        "getPromptTemplates",
        { category: "writing" },
        ctx,
      );
      expect(writing.total).toBe(1);
      expect(writing.templates[0].name).toBe("Story");
    });

    it("get parses variables JSON to array", async () => {
      await handler.handle(
        "savePromptTemplate",
        {
          name: "T",
          template: "x",
          variables: ["a", "b"],
        },
        ctx,
      );
      const r = await handler.handle("getPromptTemplates", {}, ctx);
      expect(r.templates[0].variables).toEqual(["a", "b"]);
    });

    it("delete removes by id", async () => {
      const s = await handler.handle(
        "savePromptTemplate",
        { name: "T", template: "x" },
        ctx,
      );
      const d = await handler.handle(
        "deletePromptTemplate",
        { templateId: s.templateId },
        ctx,
      );
      expect(d.deleted).toBe(true);
      const left = await handler.handle("getPromptTemplates", {}, ctx);
      expect(left.total).toBe(0);
    });

    it("save throws on missing name", async () => {
      await expect(
        handler.handle("savePromptTemplate", { template: "x" }, ctx),
      ).rejects.toThrow("name is required");
    });

    it("save throws on missing template", async () => {
      await expect(
        handler.handle("savePromptTemplate", { name: "T" }, ctx),
      ).rejects.toThrow("template is required");
    });

    it("delete throws on non-existent id", async () => {
      await expect(
        handler.handle("deletePromptTemplate", { templateId: "nope" }, ctx),
      ).rejects.toThrow("Template not found");
    });
  });

  // ===== RAG =====

  describe("ragSearchAdvanced", () => {
    it("delegates to ragManager.searchAdvanced", async () => {
      const r = await handler.handle(
        "ragSearchAdvanced",
        { query: "hello", topK: 10 },
        ctx,
      );
      expect(r.success).toBe(true);
      expect(r.results.length).toBe(2); // mock returns 2 docs
      expect(r.results[0].id).toBe("d1");
    });

    it("scoreThreshold filters out low-score results in mock", async () => {
      const r = await handler.handle(
        "ragSearchAdvanced",
        { query: "hello", topK: 10, scoreThreshold: 0.5 },
        ctx,
      );
      expect(r.results.length).toBe(1);
      expect(r.results[0].id).toBe("d1");
    });

    it("falls back to plain search if no searchAdvanced", async () => {
      const fallback = new AICommandHandler(
        null,
        {
          search: async (_q, _opts) => [
            { id: "x", score: 0.8, metadata: { tag: "Z" } },
            { id: "y", score: 0.2, metadata: { tag: "Y" } },
          ],
        },
        db,
        {},
      );
      const r = await fallback.handle(
        "ragSearchAdvanced",
        { query: "q", topK: 10, scoreThreshold: 0.5 },
        ctx,
      );
      expect(r.results.length).toBe(1);
      expect(r.results[0].id).toBe("x");
    });

    it("throws when ragManager absent", async () => {
      const noRag = new AICommandHandler(null, null, db, {});
      await expect(
        noRag.handle("ragSearchAdvanced", { query: "x" }, ctx),
      ).rejects.toThrow("RAG manager not available");
    });

    it("throws on missing query", async () => {
      await expect(
        handler.handle("ragSearchAdvanced", {}, ctx),
      ).rejects.toThrow("query is required");
    });
  });

  describe("ragIndex / ragDelete", () => {
    it("index calls indexDocument with auto id", async () => {
      let captured;
      const rm = {
        indexDocument: async (doc) => {
          captured = doc;
        },
      };
      const h = new AICommandHandler(null, rm, db, {});
      const r = await h.handle("ragIndex", { text: "hello world" }, ctx);
      expect(r.indexed).toBe(true);
      expect(r.docId).toMatch(/^doc_/);
      expect(captured.text).toBe("hello world");
    });

    it("index respects explicit docId", async () => {
      let captured;
      const rm = {
        indexDocument: async (doc) => {
          captured = doc;
        },
      };
      const h = new AICommandHandler(null, rm, db, {});
      const r = await h.handle(
        "ragIndex",
        { text: "x", docId: "my-id", metadata: { a: 1 } },
        ctx,
      );
      expect(r.docId).toBe("my-id");
      expect(captured.metadata).toEqual({ a: 1 });
    });

    it("index throws on missing text", async () => {
      await expect(
        handler.handle("ragIndex", { docId: "x" }, ctx),
      ).rejects.toThrow("text is required");
    });

    it("delete calls deleteDocument", async () => {
      let deleted;
      const rm = {
        deleteDocument: async (id) => {
          deleted = id;
        },
      };
      const h = new AICommandHandler(null, rm, db, {});
      const r = await h.handle("ragDelete", { docId: "abc" }, ctx);
      expect(r.deleted).toBe(true);
      expect(deleted).toBe("abc");
    });

    it("delete throws on missing docId", async () => {
      await expect(handler.handle("ragDelete", {}, ctx)).rejects.toThrow(
        "docId is required",
      );
    });
  });

  describe("ragListDocuments / ragStats", () => {
    it("list returns documents from ragManager", async () => {
      const r = await handler.handle("ragListDocuments", {}, ctx);
      expect(r.total).toBe(2);
      expect(r.documents[0].id).toBe("d1");
    });

    it("list returns empty when no ragManager", async () => {
      const noRag = new AICommandHandler(null, null, db, {});
      const r = await noRag.handle("ragListDocuments", {}, ctx);
      expect(r.total).toBe(0);
      expect(r.documents).toEqual([]);
    });

    it("stats returns ragManager.stats result", async () => {
      const r = await handler.handle("ragStats", {}, ctx);
      expect(r.available).toBe(true);
      expect(r.totalDocs).toBe(42);
      expect(r.totalVectors).toBe(168);
    });

    it("stats returns available=false when ragManager absent", async () => {
      const noRag = new AICommandHandler(null, null, db, {});
      const r = await noRag.handle("ragStats", {}, ctx);
      expect(r.available).toBe(false);
      expect(r.totalDocs).toBe(0);
    });
  });
});
