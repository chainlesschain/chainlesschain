/**
 * AICommandHandler — Phase 6.4 commit 3 测试
 *
 * 覆盖新加 4 method (Agents):
 *   listAgents / getAgent / runAgent / stopAgent
 *
 * Agent manager 双路径方法检测 (mgr.list / mgr.listAgents 等)：
 *   - 3 个查询 method 缺 manager 时降级 (return available=false)
 *   - mutating runAgent / stopAgent 缺 manager 时 throw
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const Database = require("better-sqlite3-multiple-ciphers");
const AICommandHandler = require("../handlers/ai-handler");

describe("AICommandHandler — Phase 6.4 commit 3 (Agents 4)", () => {
  let db;
  const ctx = { did: "did:test:phone" };

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
  });

  afterEach(() => {
    db.close();
  });

  describe("listAgents", () => {
    it("delegates to aiEngine.agents.list", async () => {
      const fake = {
        agents: {
          list: vi.fn(async () => [
            { id: "a1", name: "Agent 1" },
            { id: "a2", name: "Agent 2" },
          ]),
        },
      };
      const handler = new AICommandHandler(fake, null, db, {});
      const r = await handler.handle("listAgents", {}, ctx);
      expect(r.available).toBe(true);
      expect(r.total).toBe(2);
      expect(r.agents[0].id).toBe("a1");
    });

    it("falls back to listAgents method name on agentManager", async () => {
      const fake = {
        agentManager: {
          listAgents: vi.fn(async () => ({ agents: [{ id: "x" }] })),
        },
      };
      const handler = new AICommandHandler(fake, null, db, {});
      const r = await handler.handle("listAgents", {}, ctx);
      expect(r.available).toBe(true);
      expect(r.agents[0].id).toBe("x");
    });

    it("returns available=false when no agent manager", async () => {
      const handler = new AICommandHandler({}, null, db, {});
      const r = await handler.handle("listAgents", {}, ctx);
      expect(r.available).toBe(false);
      expect(r.agents).toEqual([]);
    });

    it("returns available=false when manager has no list method", async () => {
      const fake = { agents: { someOtherMethod: () => {} } };
      const handler = new AICommandHandler(fake, null, db, {});
      const r = await handler.handle("listAgents", {}, ctx);
      expect(r.available).toBe(false);
    });
  });

  describe("getAgent", () => {
    it("delegates to mgr.get", async () => {
      const fake = {
        agents: {
          get: vi.fn(async (id) => ({ id, name: "found" })),
        },
      };
      const handler = new AICommandHandler(fake, null, db, {});
      const r = await handler.handle("getAgent", { agentId: "abc" }, ctx);
      expect(r.agent.id).toBe("abc");
      expect(r.agent.name).toBe("found");
    });

    it("throws when manager.get returns null", async () => {
      const fake = { agents: { get: async () => null } };
      const handler = new AICommandHandler(fake, null, db, {});
      await expect(
        handler.handle("getAgent", { agentId: "nope" }, ctx),
      ).rejects.toThrow("Agent not found");
    });

    it("throws on missing agentId", async () => {
      const fake = { agents: { get: async () => ({}) } };
      const handler = new AICommandHandler(fake, null, db, {});
      await expect(handler.handle("getAgent", {}, ctx)).rejects.toThrow(
        "agentId is required",
      );
    });

    it("throws when agent manager absent", async () => {
      const handler = new AICommandHandler({}, null, db, {});
      await expect(
        handler.handle("getAgent", { agentId: "x" }, ctx),
      ).rejects.toThrow("Agent manager not available");
    });
  });

  describe("runAgent", () => {
    it("delegates and returns runId + status", async () => {
      const fake = {
        agents: {
          run: vi.fn(async (id, input, _opts) => ({
            runId: "run-1",
            status: "running",
            output: `processing ${input} for ${id}`,
          })),
        },
      };
      const handler = new AICommandHandler(fake, null, db, {});
      const r = await handler.handle(
        "runAgent",
        { agentId: "a1", input: "summarize this", options: { timeout: 30000 } },
        ctx,
      );
      expect(r.runId).toBe("run-1");
      expect(r.status).toBe("running");
      expect(r.output).toContain("summarize this");
      expect(fake.agents.run.mock.calls[0][2].timeout).toBe(30000);
    });

    it("handles empty string input (input='' is valid)", async () => {
      const fake = {
        agents: { run: vi.fn(async () => ({ runId: "r" })) },
      };
      const handler = new AICommandHandler(fake, null, db, {});
      const r = await handler.handle(
        "runAgent",
        { agentId: "a1", input: "" },
        ctx,
      );
      expect(r.runId).toBe("r");
    });

    it("throws on missing agentId", async () => {
      const handler = new AICommandHandler(
        { agents: { run: vi.fn() } },
        null,
        db,
        {},
      );
      await expect(
        handler.handle("runAgent", { input: "x" }, ctx),
      ).rejects.toThrow("agentId is required");
    });

    it("throws on null input", async () => {
      const handler = new AICommandHandler(
        { agents: { run: vi.fn() } },
        null,
        db,
        {},
      );
      await expect(
        handler.handle("runAgent", { agentId: "a1", input: null }, ctx),
      ).rejects.toThrow("input is required");
    });

    it("throws when agent manager absent", async () => {
      const handler = new AICommandHandler({}, null, db, {});
      await expect(
        handler.handle("runAgent", { agentId: "a1", input: "x" }, ctx),
      ).rejects.toThrow("Agent manager not available");
    });
  });

  describe("stopAgent", () => {
    it("delegates to mgr.stop with runId", async () => {
      const fake = {
        agents: { stop: vi.fn(async () => true) },
      };
      const handler = new AICommandHandler(fake, null, db, {});
      const r = await handler.handle("stopAgent", { runId: "run-1" }, ctx);
      expect(r.stopped).toBe(true);
      expect(r.runId).toBe("run-1");
      expect(fake.agents.stop.mock.calls[0][0]).toBe("run-1");
    });

    it("accepts agentId fallback when no runId", async () => {
      const fake = { agents: { stop: vi.fn(async () => true) } };
      const handler = new AICommandHandler(fake, null, db, {});
      const r = await handler.handle("stopAgent", { agentId: "a1" }, ctx);
      expect(r.agentId).toBe("a1");
      expect(fake.agents.stop.mock.calls[0][0]).toBe("a1");
    });

    it("throws when both runId and agentId missing", async () => {
      const handler = new AICommandHandler(
        { agents: { stop: vi.fn() } },
        null,
        db,
        {},
      );
      await expect(handler.handle("stopAgent", {}, ctx)).rejects.toThrow(
        "runId or agentId is required",
      );
    });

    it("throws when agent manager absent", async () => {
      const handler = new AICommandHandler({}, null, db, {});
      await expect(
        handler.handle("stopAgent", { runId: "x" }, ctx),
      ).rejects.toThrow("Agent manager not available");
    });
  });
});
