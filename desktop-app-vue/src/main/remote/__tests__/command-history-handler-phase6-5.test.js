/**
 * CommandHistoryHandler — Phase 6.5 桌面 debt 修复测试
 *
 * 覆盖 4 个新加的 mobile-aligned method:
 *   getCommand / clearHistory / replay / getFrequent
 *
 * Android `HistoryCommands.kt` exposes 7 method but only 3 overlapped
 * with desktop case names — these 4 wrappers close the gap with
 * Android-shape response decoders (`CommandDetailResponse`,
 * `ClearHistoryResponse`, `ReplayResponse`, `FrequentCommandsResponse`).
 *
 * 这些 wrapper 包既有 case (`getById` / `clear`) 不破坏现有 SPA 调用 —
 * 旧 case 路由全保留，只新增 4 个 mobile-friendly entry。
 *
 * Reference:
 *   docs/design/Desktop_Mobile_Bridge_Namespace_Coverage.md §4.2 #10
 *   android-app/.../remote/commands/HistoryCommands.kt
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const CommandHistoryHandler = require("../handlers/command-history-handler");

function makeMockDb({ rowsById = {}, all = [], runChanges = 0 } = {}) {
  return {
    exec: vi.fn(),
    run: vi.fn().mockResolvedValue({ lastID: 1, changes: runChanges }),
    get: vi.fn(async (sql, args) => {
      // Mock matches WHERE id = ? OR request_id = ?
      const id = args && args[0];
      return rowsById[id] || null;
    }),
    all: vi.fn().mockResolvedValue(all),
  };
}

describe("CommandHistoryHandler — Phase 6.5 4 Android-shape methods", () => {
  let handler;

  // ─── getCommand ────────────────────────────────────────────────────

  describe("getCommand (Android-shape getById wrapper)", () => {
    it("returns CommandDetailResponse shape with camelCase fields", async () => {
      const db = makeMockDb({
        rowsById: {
          42: {
            id: 42,
            request_id: "req-42",
            method: "ai.chat",
            params: JSON.stringify({ message: "hi" }),
            result: JSON.stringify({ reply: "hello" }),
            error: null,
            duration: 250,
            status: "success",
            created_at: 1700000000000,
            device_did: "did:test:phone",
          },
        },
      });
      handler = new CommandHistoryHandler(db, { enableAutoCleanup: false });

      const r = await handler.getCommand({ commandId: "42" }, {});

      expect(r.success).toBe(true);
      expect(r.command).toMatchObject({
        id: "42",
        method: "ai.chat",
        params: { message: "hi" },
        result: { reply: "hello" },
        success: true,
        duration: 250,
        timestamp: 1700000000000,
        deviceDid: "did:test:phone",
        deviceName: null,
        error: null,
      });
    });

    it("looks up by request_id as well as numeric id", async () => {
      const db = makeMockDb({
        rowsById: {
          "req-abc": {
            id: 99,
            request_id: "req-abc",
            method: "foo",
            params: null,
            result: null,
            error: null,
            duration: 0,
            status: "failed",
            created_at: 0,
            device_did: null,
          },
        },
      });
      handler = new CommandHistoryHandler(db, { enableAutoCleanup: false });

      const r = await handler.getCommand({ commandId: "req-abc" }, {});
      expect(r.success).toBe(true);
      expect(r.command.id).toBe("99");
      // status="failed" → success: false in detail
      expect(r.command.success).toBe(false);
    });

    it("decodes the JSON error envelope to its .message field", async () => {
      const db = makeMockDb({
        rowsById: {
          1: {
            id: 1,
            request_id: "r1",
            method: "x",
            params: null,
            result: null,
            error: JSON.stringify({ code: -32001, message: "File not found" }),
            duration: 10,
            status: "failed",
            created_at: 1,
            device_did: null,
          },
        },
      });
      handler = new CommandHistoryHandler(db, { enableAutoCleanup: false });
      const r = await handler.getCommand({ commandId: "1" }, {});
      expect(r.command.error).toBe("File not found");
    });

    it("returns NOT_FOUND for unknown id (no throw)", async () => {
      const db = makeMockDb();
      handler = new CommandHistoryHandler(db, { enableAutoCleanup: false });
      const r = await handler.getCommand({ commandId: "ghost" }, {});
      expect(r).toEqual({ success: false, error: "NOT_FOUND" });
    });

    it("rejects missing commandId", async () => {
      const db = makeMockDb();
      handler = new CommandHistoryHandler(db, { enableAutoCleanup: false });
      const r = await handler.getCommand({}, {});
      expect(r).toEqual({ success: false, error: "commandId required" });
    });
  });

  // ─── clearHistory (Android-shape clear wrapper) ────────────────────

  describe("clearHistory (Android-shape)", () => {
    it("returns ClearHistoryResponse{success, deletedCount, message}", async () => {
      const db = makeMockDb({ runChanges: 12 });
      handler = new CommandHistoryHandler(db, { enableAutoCleanup: false });

      const r = await handler.clearHistoryMobile({}, {});
      expect(r).toEqual({
        success: true,
        deletedCount: 12,
        message: "Deleted 12 command history records",
      });
      // Verify query is the bare DELETE (no extra WHERE clauses).
      const [sql, args] = db.run.mock.calls[0];
      expect(sql).toContain("DELETE FROM command_history WHERE 1=1");
      expect(args).toEqual([]);
    });

    it("honors `before` filter (created_at < before)", async () => {
      const db = makeMockDb({ runChanges: 5 });
      handler = new CommandHistoryHandler(db, { enableAutoCleanup: false });

      await handler.clearHistoryMobile({ before: 1700000000000 }, {});
      const [sql, args] = db.run.mock.calls[0];
      expect(sql).toContain("created_at < ?");
      expect(args).toEqual([1700000000000]);
    });

    it("honors `method` filter (method = ?)", async () => {
      const db = makeMockDb({ runChanges: 3 });
      handler = new CommandHistoryHandler(db, { enableAutoCleanup: false });

      await handler.clearHistoryMobile({ method: "ai.chat" }, {});
      const [sql, args] = db.run.mock.calls[0];
      expect(sql).toContain("method = ?");
      expect(args).toEqual(["ai.chat"]);
    });

    it("combines before + method filters", async () => {
      const db = makeMockDb({ runChanges: 2 });
      handler = new CommandHistoryHandler(db, { enableAutoCleanup: false });

      await handler.clearHistoryMobile(
        { before: 1700000000000, method: "file.read" },
        {},
      );
      const [sql, args] = db.run.mock.calls[0];
      expect(sql).toContain("created_at < ?");
      expect(sql).toContain("method = ?");
      expect(args).toEqual([1700000000000, "file.read"]);
    });

    it("returns success:true even when nothing was deleted", async () => {
      const db = makeMockDb({ runChanges: 0 });
      handler = new CommandHistoryHandler(db, { enableAutoCleanup: false });
      const r = await handler.clearHistoryMobile({}, {});
      expect(r.success).toBe(true);
      expect(r.deletedCount).toBe(0);
    });
  });

  // ─── replay ────────────────────────────────────────────────────────

  describe("replay (returns recorded result, no re-execution)", () => {
    it("returns ReplayResponse{success, commandId, result?} on a success row", async () => {
      const db = makeMockDb({
        rowsById: {
          5: {
            id: 5,
            status: "success",
            result: JSON.stringify({ answer: "42" }),
            error: null,
          },
        },
      });
      handler = new CommandHistoryHandler(db, { enableAutoCleanup: false });
      const r = await handler.replayCommand({ commandId: "5" }, {});
      expect(r).toEqual({
        success: true,
        commandId: "5",
        result: { answer: "42" },
      });
    });

    it("returns success:false with error message for an originally-failed command", async () => {
      const db = makeMockDb({
        rowsById: {
          7: {
            id: 7,
            status: "failed",
            result: null,
            error: JSON.stringify({ message: "Out of bounds" }),
          },
        },
      });
      handler = new CommandHistoryHandler(db, { enableAutoCleanup: false });
      const r = await handler.replayCommand({ commandId: "7" }, {});
      expect(r.success).toBe(false);
      expect(r.commandId).toBe("7");
      expect(r.error).toBe("Out of bounds");
    });

    it("returns ORIGINAL_FAILED when the failed row had no error field", async () => {
      const db = makeMockDb({
        rowsById: {
          8: { id: 8, status: "failed", result: null, error: null },
        },
      });
      handler = new CommandHistoryHandler(db, { enableAutoCleanup: false });
      const r = await handler.replayCommand({ commandId: "8" }, {});
      expect(r.success).toBe(false);
      expect(r.error).toBe("ORIGINAL_FAILED");
    });

    it("returns NOT_FOUND for unknown id", async () => {
      const db = makeMockDb();
      handler = new CommandHistoryHandler(db, { enableAutoCleanup: false });
      const r = await handler.replayCommand({ commandId: "ghost" }, {});
      expect(r).toEqual({
        success: false,
        commandId: "ghost",
        error: "NOT_FOUND",
      });
    });

    it("rejects missing commandId", async () => {
      const db = makeMockDb();
      handler = new CommandHistoryHandler(db, { enableAutoCleanup: false });
      const r = await handler.replayCommand({}, {});
      expect(r).toEqual({
        success: false,
        commandId: "",
        error: "commandId required",
      });
    });
  });

  // ─── getFrequent ───────────────────────────────────────────────────

  describe("getFrequent (aggregate by method)", () => {
    it("returns FrequentCommandsResponse{success, commands: [...]}", async () => {
      const db = makeMockDb({
        all: [
          {
            method: "ai.chat",
            count: 30,
            last_used: 1700000000000,
            avg_duration: 250.5,
          },
          {
            method: "file.read",
            count: 15,
            last_used: 1690000000000,
            avg_duration: 12,
          },
        ],
      });
      handler = new CommandHistoryHandler(db, { enableAutoCleanup: false });

      const r = await handler.getFrequent({ limit: 5 }, {});
      expect(r.success).toBe(true);
      expect(r.commands).toEqual([
        {
          method: "ai.chat",
          count: 30,
          lastUsed: 1700000000000,
          avgDuration: 250.5,
        },
        {
          method: "file.read",
          count: 15,
          lastUsed: 1690000000000,
          avgDuration: 12,
        },
      ]);

      // SQL uses GROUP BY method ORDER BY count DESC
      const [sql, args] = db.all.mock.calls[0];
      expect(sql).toContain("GROUP BY method");
      expect(sql).toContain("ORDER BY count DESC");
      expect(args).toEqual([5]);
    });

    it("defaults limit to 10 and clamps to 100", async () => {
      const db = makeMockDb({ all: [] });
      handler = new CommandHistoryHandler(db, { enableAutoCleanup: false });

      await handler.getFrequent({}, {});
      expect(db.all.mock.calls[0][1]).toEqual([10]);

      // Reset call count tracker
      db.all.mockClear();
      await handler.getFrequent({ limit: 9999 }, {});
      expect(db.all.mock.calls[0][1]).toEqual([100]);

      db.all.mockClear();
      await handler.getFrequent({ limit: 0 }, {});
      // 0 clamps to min 1 (default-fallback kicks in when value is falsy → 10
      // then min-clamp; design choice — verify we end up with a sensible
      // positive integer).
      const arg = db.all.mock.calls[0][1][0];
      expect(arg).toBeGreaterThanOrEqual(1);
      expect(arg).toBeLessThanOrEqual(100);
    });

    it("returns empty commands array when table has no rows", async () => {
      const db = makeMockDb({ all: [] });
      handler = new CommandHistoryHandler(db, { enableAutoCleanup: false });
      const r = await handler.getFrequent({}, {});
      expect(r).toEqual({ success: true, commands: [] });
    });

    it("maps NULL avg_duration to 0", async () => {
      const db = makeMockDb({
        all: [{ method: "x", count: 1, last_used: 1, avg_duration: null }],
      });
      handler = new CommandHistoryHandler(db, { enableAutoCleanup: false });
      const r = await handler.getFrequent({}, {});
      expect(r.commands[0].avgDuration).toBe(0);
    });
  });

  // ─── handle() routing ──────────────────────────────────────────────

  describe("handle() routes all 4 new actions + still dispatches existing ones", () => {
    it("dispatches getCommand / clearHistory / replay / getFrequent + existing getById / clear", async () => {
      const db = makeMockDb({
        rowsById: {
          1: {
            id: 1,
            request_id: "r1",
            method: "x",
            params: null,
            result: null,
            error: null,
            duration: 0,
            status: "success",
            created_at: 0,
            device_did: null,
          },
        },
        all: [],
        runChanges: 0,
      });
      handler = new CommandHistoryHandler(db, { enableAutoCleanup: false });

      // New (Android-shape)
      expect(
        (await handler.handle("getCommand", { commandId: "1" }, {})).success,
      ).toBe(true);
      expect((await handler.handle("clearHistory", {}, {})).success).toBe(true);
      expect(
        (await handler.handle("replay", { commandId: "1" }, {})).success,
      ).toBe(true);
      expect((await handler.handle("getFrequent", {}, {})).success).toBe(true);

      // Existing (desktop-internal) — preserved
      expect(await handler.handle("getById", { id: "1" }, {})).toBeDefined();
    });

    it("still throws Unknown action for unrecognized methods", async () => {
      const db = makeMockDb();
      handler = new CommandHistoryHandler(db, { enableAutoCleanup: false });
      await expect(handler.handle("ghost", {}, {})).rejects.toThrow(
        /Unknown action/,
      );
    });
  });
});
