/**
 * useExtensionRegistryStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: getSpaceById / getArtifactContribution / matchSlashCommands
 *    (case-insensitive startsWith) / matchMentionSources (all) /
 *    statusBarByPosition (parametric)
 *  - Actions (window.electronAPI.plugin.* mocked): refreshAll (fan-out + field
 *    extraction + loaded flag), refreshAll no-API guard (loaded true, slices
 *    empty), refreshSpaces / refreshSlashCommands (targeted refresh)
 *
 * NB: store reads window.electronAPI.plugin lazily via pluginApi(), so we stub
 * window.electronAPI per-test. safeCall extracts result[field] (per call) or
 * falls back; the plugin mock returns { success, <field> } shapes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { useExtensionRegistryStore } from "../extensionRegistry";

function fullPluginApi() {
  return {
    getRegisteredSpaces: vi.fn().mockResolvedValue({
      success: true,
      spaces: [{ id: "s1", type: "x" }],
    }),
    getRegisteredArtifacts: vi.fn().mockResolvedValue({
      success: true,
      artifacts: [{ id: "a1", type: "note" }],
    }),
    getSlashCommands: vi.fn().mockResolvedValue({
      success: true,
      commands: [{ id: "c1", trigger: "/help" }],
    }),
    getMentionSources: vi.fn().mockResolvedValue({
      success: true,
      sources: [{ id: "m1", prefix: "@" }],
    }),
    getStatusBarWidgets: vi.fn().mockResolvedValue({
      success: true,
      widgets: [{ id: "w1", position: "left" }],
    }),
    getHomeWidgets: vi.fn().mockResolvedValue({ success: true, widgets: [] }),
    getComposerSlots: vi.fn().mockResolvedValue({ success: true, slots: [] }),
    getActiveBrandTheme: vi.fn().mockResolvedValue({
      success: true,
      theme: { id: "t1" },
    }),
    getActiveBrandIdentity: vi.fn().mockResolvedValue({
      success: true,
      identity: null,
    }),
    getActiveLLMProvider: vi.fn().mockResolvedValue({
      success: true,
      provider: null,
    }),
    getActiveAuthProvider: vi.fn().mockResolvedValue({
      success: true,
      provider: null,
    }),
    getActiveDataStorage: vi.fn().mockResolvedValue({
      success: true,
      storage: null,
    }),
    getActiveDataCrypto: vi.fn().mockResolvedValue({
      success: true,
      crypto: null,
    }),
    getActiveComplianceAudit: vi.fn().mockResolvedValue({
      success: true,
      audit: null,
    }),
  };
}

describe("useExtensionRegistryStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    (window as any).electronAPI = { plugin: fullPluginApi() };
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (window as any).electronAPI;
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty and unloaded", () => {
      const store = useExtensionRegistryStore();
      expect(store.spaces).toEqual([]);
      expect(store.artifacts).toEqual([]);
      expect(store.slashCommands).toEqual([]);
      expect(store.brandTheme).toBeNull();
      expect(store.loaded).toBe(false);
      expect(store.lastRefresh).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("getSpaceById / getArtifactContribution look up by id / type", () => {
      const store = useExtensionRegistryStore();
      store.spaces = [{ id: "s1" } as any, { id: "s2" } as any];
      store.artifacts = [{ id: "a1", type: "note" } as any];
      expect(store.getSpaceById("s2")?.id).toBe("s2");
      expect(store.getSpaceById("nope")).toBeNull();
      expect(store.getArtifactContribution("note")?.id).toBe("a1");
      expect(store.getArtifactContribution("tx")).toBeNull();
    });

    it("matchSlashCommands matches case-insensitive trigger prefix", () => {
      const store = useExtensionRegistryStore();
      store.slashCommands = [
        { id: "c1", trigger: "/Help" } as any,
        { id: "c2", trigger: "/hi" } as any,
        { id: "c3", trigger: "/quit" } as any,
      ];
      expect(store.matchSlashCommands("/h").map((c) => c.id)).toEqual([
        "c1",
        "c2",
      ]);
      expect(store.matchSlashCommands("/q").map((c) => c.id)).toEqual(["c3"]);
    });

    it("matchMentionSources returns all sources; statusBarByPosition filters", () => {
      const store = useExtensionRegistryStore();
      store.mentionSources = [{ id: "m1" } as any, { id: "m2" } as any];
      store.statusBarWidgets = [
        { id: "w1", position: "left" } as any,
        { id: "w2", position: "right" } as any,
        { id: "w3", position: "left" } as any,
      ];
      expect(store.matchMentionSources("anything")).toHaveLength(2);
      expect(store.statusBarByPosition("left").map((w) => w.id)).toEqual([
        "w1",
        "w3",
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // refreshAll
  // -------------------------------------------------------------------------

  describe("refreshAll", () => {
    it("fans out and extracts each contribution field", async () => {
      const store = useExtensionRegistryStore();
      await store.refreshAll();
      expect(store.spaces.map((s) => s.id)).toEqual(["s1"]);
      expect(store.artifacts.map((a) => a.id)).toEqual(["a1"]);
      expect(store.slashCommands.map((c) => c.id)).toEqual(["c1"]);
      expect(store.mentionSources.map((m) => m.id)).toEqual(["m1"]);
      expect(store.statusBarWidgets.map((w) => w.id)).toEqual(["w1"]);
      expect(store.brandTheme?.id).toBe("t1");
      expect(store.loaded).toBe(true);
      expect(store.lastRefresh).toBeGreaterThan(0);
    });

    it("falls back to empty + loaded when the plugin API is absent", async () => {
      delete (window as any).electronAPI;
      const store = useExtensionRegistryStore();
      await store.refreshAll();
      expect(store.spaces).toEqual([]);
      expect(store.loaded).toBe(true);
    });

    it("safeCall keeps the prior value when a call lacks its field", async () => {
      const store = useExtensionRegistryStore();
      const api = fullPluginApi();
      // success but missing 'spaces' field → fallback to [] in refreshAll
      api.getRegisteredSpaces.mockResolvedValue({ success: true });
      (window as any).electronAPI = { plugin: api };
      await store.refreshAll();
      expect(store.spaces).toEqual([]);
      // others still populate
      expect(store.artifacts.map((a) => a.id)).toEqual(["a1"]);
    });
  });

  // -------------------------------------------------------------------------
  // Targeted refresh
  // -------------------------------------------------------------------------

  describe("targeted refresh", () => {
    it("refreshSpaces updates only the spaces slice", async () => {
      const store = useExtensionRegistryStore();
      await store.refreshSpaces();
      expect(store.spaces.map((s) => s.id)).toEqual(["s1"]);
      expect(store.artifacts).toEqual([]);
    });

    it("refreshSlashCommands updates only the slash-command slice", async () => {
      const store = useExtensionRegistryStore();
      await store.refreshSlashCommands();
      expect(store.slashCommands.map((c) => c.id)).toEqual(["c1"]);
      expect(store.spaces).toEqual([]);
    });

    it("targeted refresh is a no-op without the plugin API", async () => {
      delete (window as any).electronAPI;
      const store = useExtensionRegistryStore();
      store.spaces = [{ id: "keep" } as any];
      await store.refreshSpaces();
      expect(store.spaces.map((s) => s.id)).toEqual(["keep"]);
    });
  });
});
