/**
 * useHistoryStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state + localStorage load on init
 *  - statistics getter (total / skills / tools / creates / updates / deletes)
 *  - actions: addRecord (prepend + id/timestamp + MAX_HISTORY cap + persist),
 *    deleteRecord, clearHistory, getRecentRecords, getRecordsByEntityType,
 *    getRecordsByActionType
 *  - formatters: formatRecord (action/entity/name/count), getActionIcon /
 *    getActionColor (known + fallback)
 *
 * NB: store is pure localStorage-backed (no IPC); jsdom provides localStorage.
 * We clear it before each test, and re-create the pinia+store to exercise the
 * load-on-init path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { useHistoryStore, ACTION_TYPES, ENTITY_TYPES } from "../history";
import type { CreateRecordData } from "../history";

const STORAGE_KEY = "skill-tool-history";

function rec(overrides: Partial<CreateRecordData> = {}): CreateRecordData {
  return {
    actionType: ACTION_TYPES.CREATE,
    entityType: ENTITY_TYPES.SKILL,
    entityName: "X",
    ...overrides,
  };
}

describe("useHistoryStore", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  // -------------------------------------------------------------------------
  // Initial state + load
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty with no saved history", () => {
      const store = useHistoryStore();
      expect(store.records).toEqual([]);
    });

    it("loads previously persisted records on init", () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([
          { id: 1, timestamp: "t", actionType: "create", entityType: "skill" },
        ]),
      );
      // fresh pinia so the store re-initializes and runs loadFromLocalStorage
      setActivePinia(createPinia());
      const store = useHistoryStore();
      expect(store.records).toHaveLength(1);
      expect(store.records[0].id).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // addRecord
  // -------------------------------------------------------------------------

  describe("addRecord", () => {
    it("prepends a record with an id + timestamp and persists it", () => {
      const store = useHistoryStore();
      store.addRecord(rec({ entityName: "first" }));
      store.addRecord(rec({ entityName: "second" }));
      expect(store.records.map((r) => r.entityName)).toEqual([
        "second",
        "first",
      ]);
      expect(store.records[0].id).toBeTypeOf("number");
      expect(store.records[0].timestamp).toMatch(/^\d{4}-/);
      // persisted
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      expect(saved).toHaveLength(2);
    });

    it("caps the history at 100 entries", () => {
      const store = useHistoryStore();
      for (let i = 0; i < 105; i++) {
        store.addRecord(rec({ entityName: `e${i}` }));
      }
      expect(store.records).toHaveLength(100);
      // newest stays at the front
      expect(store.records[0].entityName).toBe("e104");
    });
  });

  // -------------------------------------------------------------------------
  // delete / clear / queries
  // -------------------------------------------------------------------------

  describe("delete / clear / queries", () => {
    it("deleteRecord removes a single record by id", () => {
      const store = useHistoryStore();
      store.addRecord(rec({ entityName: "keep" }));
      store.addRecord(rec({ entityName: "drop" }));
      const dropId = store.records[0].id;
      store.deleteRecord(dropId);
      expect(store.records.map((r) => r.entityName)).toEqual(["keep"]);
    });

    it("clearHistory empties the list and persists the empty state", () => {
      const store = useHistoryStore();
      store.addRecord(rec());
      store.clearHistory();
      expect(store.records).toEqual([]);
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) || "x")).toEqual([]);
    });

    it("getRecentRecords returns the first N", () => {
      const store = useHistoryStore();
      for (let i = 0; i < 5; i++) store.addRecord(rec({ entityName: `e${i}` }));
      expect(store.getRecentRecords(2).map((r) => r.entityName)).toEqual([
        "e4",
        "e3",
      ]);
    });

    it("getRecordsByEntityType / getRecordsByActionType filter", () => {
      const store = useHistoryStore();
      store.addRecord(
        rec({
          entityType: ENTITY_TYPES.SKILL,
          actionType: ACTION_TYPES.CREATE,
        }),
      );
      store.addRecord(
        rec({ entityType: ENTITY_TYPES.TOOL, actionType: ACTION_TYPES.UPDATE }),
      );
      store.addRecord(
        rec({
          entityType: ENTITY_TYPES.SKILL,
          actionType: ACTION_TYPES.DELETE,
        }),
      );
      expect(store.getRecordsByEntityType(ENTITY_TYPES.SKILL)).toHaveLength(2);
      expect(store.getRecordsByEntityType(ENTITY_TYPES.TOOL)).toHaveLength(1);
      expect(store.getRecordsByActionType(ACTION_TYPES.UPDATE)).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // statistics getter
  // -------------------------------------------------------------------------

  describe("statistics", () => {
    it("counts by entity + action type", () => {
      const store = useHistoryStore();
      store.addRecord(
        rec({
          entityType: ENTITY_TYPES.SKILL,
          actionType: ACTION_TYPES.CREATE,
        }),
      );
      store.addRecord(
        rec({
          entityType: ENTITY_TYPES.SKILL,
          actionType: ACTION_TYPES.UPDATE,
        }),
      );
      store.addRecord(
        rec({ entityType: ENTITY_TYPES.TOOL, actionType: ACTION_TYPES.DELETE }),
      );
      expect(store.statistics).toEqual({
        total: 3,
        skills: 2,
        tools: 1,
        creates: 1,
        updates: 1,
        deletes: 1,
      });
    });
  });

  // -------------------------------------------------------------------------
  // formatters
  // -------------------------------------------------------------------------

  describe("formatters", () => {
    it("formatRecord builds an i18n description with name + count", () => {
      const store = useHistoryStore();
      expect(
        store.formatRecord({
          id: 1,
          timestamp: "t",
          actionType: ACTION_TYPES.CREATE,
          entityType: ENTITY_TYPES.SKILL,
          entityName: "MySkill",
        }),
      ).toBe("创建 技能: MySkill");
      expect(
        store.formatRecord({
          id: 2,
          timestamp: "t",
          actionType: ACTION_TYPES.BATCH_DELETE,
          entityType: ENTITY_TYPES.TOOL,
          count: 3,
        }),
      ).toBe("批量删除 工具 (3项)");
    });

    it("getActionIcon / getActionColor map known types and fall back", () => {
      const store = useHistoryStore();
      expect(store.getActionIcon(ACTION_TYPES.CREATE)).toBe(
        "PlusCircleOutlined",
      );
      expect(store.getActionColor(ACTION_TYPES.DELETE)).toBe("#ff4d4f");
      // unknown type → fallbacks
      expect(store.getActionIcon("mystery" as any)).toBe("InfoCircleOutlined");
      expect(store.getActionColor("mystery" as any)).toBe("#8c8c8c");
    });
  });
});
