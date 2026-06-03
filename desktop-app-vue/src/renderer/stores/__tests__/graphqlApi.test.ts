/**
 * useGraphQLApiStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: activeKeys (status === 'active') / recentQueries (slice 20)
 *  - IPC actions (electronAPI.invoke mocked): executeQuery (set queryResult /
 *    throws), loadSchema (set schema), createAPIKey (chains loadAPIKeys + returns
 *    data / throws), revokeAPIKey (chains loadAPIKeys), loadAPIKeys (populate),
 *    loadStats (set stats), clearError
 *
 * NB: store captures `electronAPI` at MODULE LOAD
 * (`const electronAPI = window.electronAPI || window.electron?.ipcRenderer`),
 * so window.electronAPI must exist BEFORE import — set in vi.hoisted, and never
 * delete it here (only reset the mock fn between tests).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const { mockInvoke } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  (globalThis as any).window = (globalThis as any).window || {};
  (globalThis as any).window.electronAPI = { invoke: mockInvoke };
  return { mockInvoke };
});

import { useGraphQLApiStore } from "../graphqlApi";
import type { APIKey, QueryLogEntry } from "../graphqlApi";

function apiKey(id: string, status: string): APIKey {
  return {
    id,
    name: `Key ${id}`,
    permissions: ["query"],
    rateLimit: 1000,
    requestsToday: 0,
    status,
    createdAt: "2026-01-01",
  };
}

function logEntry(id: string): QueryLogEntry {
  return {
    id,
    operationType: "query",
    durationMs: 12,
    status: "ok",
    createdAt: "2026-01-01",
  };
}

describe("useGraphQLApiStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset().mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty", () => {
      const store = useGraphQLApiStore();
      expect(store.schema).toBe("");
      expect(store.apiKeys).toEqual([]);
      expect(store.queryLog).toEqual([]);
      expect(store.queryResult).toBeNull();
      expect(store.stats).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("activeKeys filters status === 'active'", () => {
      const store = useGraphQLApiStore();
      store.apiKeys = [
        apiKey("a", "active"),
        apiKey("b", "revoked"),
        apiKey("c", "active"),
      ];
      expect(store.activeKeys.map((k) => k.id)).toEqual(["a", "c"]);
    });

    it("recentQueries returns at most the first 20 log entries", () => {
      const store = useGraphQLApiStore();
      store.queryLog = Array.from({ length: 25 }, (_, i) => logEntry(`q${i}`));
      expect(store.recentQueries).toHaveLength(20);
      expect(store.recentQueries[0].id).toBe("q0");
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("executeQuery stores + returns the data on success", async () => {
      const store = useGraphQLApiStore();
      mockInvoke.mockResolvedValue({ success: true, data: { me: { id: 1 } } });
      const data = await store.executeQuery("{ me { id } }", { x: 1 });
      expect(mockInvoke).toHaveBeenCalledWith("graphql:execute-query", {
        query: "{ me { id } }",
        variables: { x: 1 },
        context: {},
      });
      expect(data).toEqual({ me: { id: 1 } });
      expect(store.queryResult).toEqual({ me: { id: 1 } });
      expect(store.loading).toBe(false);
    });

    it("executeQuery throws and records the error on failure", async () => {
      const store = useGraphQLApiStore();
      mockInvoke.mockResolvedValue({ success: false, error: "syntax" });
      await expect(store.executeQuery("{ bad }")).rejects.toThrow("syntax");
      expect(store.error).toBe("syntax");
    });

    it("loadSchema stores the schema on success", async () => {
      const store = useGraphQLApiStore();
      mockInvoke.mockResolvedValue({ success: true, data: "type Query {}" });
      await store.loadSchema();
      expect(mockInvoke).toHaveBeenCalledWith("graphql:get-schema", {});
      expect(store.schema).toBe("type Query {}");
    });

    it("createAPIKey chains loadAPIKeys and returns the new key", async () => {
      const store = useGraphQLApiStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, data: apiKey("n", "active") }) // create
        .mockResolvedValueOnce({
          success: true,
          data: [apiKey("n", "active")],
        }); // list
      const data = await store.createAPIKey("n", ["query", "mutation"]);
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "graphql:create-api-key", {
        name: "n",
        options: { permissions: ["query", "mutation"] },
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(
        2,
        "graphql:list-api-keys",
        {},
      );
      expect((data as APIKey).id).toBe("n");
      expect(store.apiKeys.map((k) => k.id)).toEqual(["n"]);
    });

    it("revokeAPIKey chains loadAPIKeys on success", async () => {
      const store = useGraphQLApiStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // revoke
        .mockResolvedValueOnce({ success: true, data: [] }); // list
      await store.revokeAPIKey("k1");
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "graphql:revoke-api-key", {
        keyId: "k1",
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(
        2,
        "graphql:list-api-keys",
        {},
      );
    });

    it("loadAPIKeys + loadStats populate their slices", async () => {
      const store = useGraphQLApiStore();
      mockInvoke.mockResolvedValueOnce({
        success: true,
        data: [apiKey("a", "active")],
      });
      await store.loadAPIKeys();
      expect(store.apiKeys.map((k) => k.id)).toEqual(["a"]);

      mockInvoke.mockResolvedValueOnce({
        success: true,
        data: { totalQueries: 42 },
      });
      await store.loadStats();
      expect(store.stats?.totalQueries).toBe(42);
    });
  });

  // -------------------------------------------------------------------------
  // clearError
  // -------------------------------------------------------------------------

  describe("clearError", () => {
    it("resets the error", () => {
      const store = useGraphQLApiStore();
      store.error = "x";
      store.clearError();
      expect(store.error).toBeNull();
    });
  });
});
