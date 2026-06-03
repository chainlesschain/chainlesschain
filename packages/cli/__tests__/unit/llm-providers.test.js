import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  BUILT_IN_PROVIDERS,
  LLMProviderRegistry,
} from "../../src/lib/llm-providers.js";
import { LLM_PROVIDERS } from "../../src/constants.js";

describe("LLM Providers", () => {
  // ─── BUILT_IN_PROVIDERS ───────────────────────────────────────

  describe("BUILT_IN_PROVIDERS", () => {
    it("should have 10 built-in providers", () => {
      expect(Object.keys(BUILT_IN_PROVIDERS)).toHaveLength(10);
    });

    it("should include expected providers", () => {
      expect(BUILT_IN_PROVIDERS.ollama).toBeDefined();
      expect(BUILT_IN_PROVIDERS.openai).toBeDefined();
      expect(BUILT_IN_PROVIDERS.anthropic).toBeDefined();
      expect(BUILT_IN_PROVIDERS.deepseek).toBeDefined();
      expect(BUILT_IN_PROVIDERS.dashscope).toBeDefined();
      expect(BUILT_IN_PROVIDERS.gemini).toBeDefined();
      expect(BUILT_IN_PROVIDERS.mistral).toBeDefined();
      expect(BUILT_IN_PROVIDERS.volcengine).toBeDefined();
      expect(BUILT_IN_PROVIDERS.kimi).toBeDefined();
      expect(BUILT_IN_PROVIDERS.minimax).toBeDefined();
    });

    it("should have correct Ollama config", () => {
      const ollama = BUILT_IN_PROVIDERS.ollama;
      expect(ollama.baseUrl).toBe("http://localhost:11434");
      expect(ollama.free).toBe(true);
      expect(ollama.apiKeyEnv).toBeNull();
      expect(ollama.models.length).toBeGreaterThan(0);
    });

    it("should have correct Anthropic config", () => {
      const anthropic = BUILT_IN_PROVIDERS.anthropic;
      expect(anthropic.apiKeyEnv).toBe("ANTHROPIC_API_KEY");
      expect(anthropic.models).toContain("claude-opus-4-6");
    });

    it("should have correct OpenAI config", () => {
      const openai = BUILT_IN_PROVIDERS.openai;
      expect(openai.apiKeyEnv).toBe("OPENAI_API_KEY");
      expect(openai.models).toContain("gpt-4o");
    });

    it("should have correct Volcengine config", () => {
      const volcengine = BUILT_IN_PROVIDERS.volcengine;
      expect(volcengine.apiKeyEnv).toBe("VOLCENGINE_API_KEY");
      expect(volcengine.baseUrl).toBe(
        "https://ark.cn-beijing.volces.com/api/v3",
      );
      expect(volcengine.models).toContain("doubao-seed-1-6-251015");
      expect(volcengine.models).toContain("doubao-seed-code");
      expect(volcengine.free).toBe(false);
    });

    it("should have correct Kimi config", () => {
      const kimi = BUILT_IN_PROVIDERS.kimi;
      expect(kimi.apiKeyEnv).toBe("MOONSHOT_API_KEY");
      expect(kimi.baseUrl).toBe("https://api.moonshot.cn/v1");
      expect(kimi.models).toContain("moonshot-v1-auto");
      expect(kimi.free).toBe(false);
    });

    it("should have correct MiniMax config", () => {
      const minimax = BUILT_IN_PROVIDERS.minimax;
      expect(minimax.apiKeyEnv).toBe("MINIMAX_API_KEY");
      expect(minimax.baseUrl).toBe("https://api.minimax.chat/v1");
      expect(minimax.models).toContain("MiniMax-Text-01");
      expect(minimax.free).toBe(false);
    });

    it("all providers should have name, displayName, baseUrl, models", () => {
      for (const [key, provider] of Object.entries(BUILT_IN_PROVIDERS)) {
        expect(provider.name).toBe(key);
        expect(provider.displayName).toBeTruthy();
        expect(provider.baseUrl).toBeTruthy();
        expect(Array.isArray(provider.models)).toBe(true);
        expect(provider.models.length).toBeGreaterThan(0);
      }
    });
  });

  // ─── LLMProviderRegistry ──────────────────────────────────────

  describe("LLMProviderRegistry", () => {
    let db;
    let registry;

    beforeEach(() => {
      db = new MockDatabase();
      registry = new LLMProviderRegistry(db);
    });

    it("should create llm_providers table", () => {
      expect(db.tables.has("llm_providers")).toBe(true);
    });

    it("should have all 10 built-in providers loaded", () => {
      const providers = registry.list();
      expect(providers.length).toBeGreaterThanOrEqual(10);
    });

    it("should get a specific provider", () => {
      const ollama = registry.get("ollama");
      expect(ollama).toBeTruthy();
      expect(ollama.name).toBe("ollama");
    });

    it("should return null for unknown provider", () => {
      expect(registry.get("nonexistent")).toBeNull();
    });

    it("should add a custom provider", () => {
      const provider = registry.addProvider("my-llm", {
        displayName: "My Custom LLM",
        baseUrl: "http://localhost:5000",
        apiKeyEnv: "MY_LLM_KEY",
        models: ["model-a", "model-b"],
      });

      expect(provider.name).toBe("my-llm");
      expect(provider.custom).toBe(true);
      expect(registry.get("my-llm")).toBeTruthy();
    });

    it("should remove a custom provider", () => {
      registry.addProvider("custom", {
        displayName: "Custom",
        baseUrl: "http://x",
      });
      const removed = registry.removeProvider("custom");
      expect(removed).toBe(true);
      expect(registry.get("custom")).toBeNull();
    });

    it("should not allow removing built-in providers", () => {
      expect(() => registry.removeProvider("ollama")).toThrow(
        "Cannot remove built-in",
      );
    });

    it("should return false when removing non-existent provider", () => {
      expect(registry.removeProvider("nonexistent")).toBe(false);
    });

    it("should default active provider to ollama", () => {
      const active = registry.getActive();
      expect(active).toBe("ollama");
    });

    it("should switch active provider", () => {
      registry.setActive("openai");
      const active = registry.getActive();
      expect(active).toBe("openai");
    });

    it("should throw when switching to unknown provider", () => {
      expect(() => registry.setActive("nonexistent")).toThrow("not found");
    });

    it("should report API key status", () => {
      const providers = registry.list();
      const ollama = providers.find((p) => p.name === "ollama");
      expect(ollama.hasApiKey).toBe(true); // Ollama has no key requirement

      const openai = providers.find((p) => p.name === "openai");
      // hasApiKey depends on env, but in test it should be false (no env set)
      expect(typeof openai.hasApiKey).toBe("boolean");
    });

    it("should return null for getApiKey of keyless provider", () => {
      expect(registry.getApiKey("ollama")).toBeNull();
    });

    it("should return null for getApiKey of unknown provider", () => {
      expect(registry.getApiKey("nonexistent")).toBeNull();
    });

    it("should list custom providers as custom=true", () => {
      registry.addProvider("my-api", {
        displayName: "My API",
        baseUrl: "http://x",
      });
      const providers = registry.list();
      const custom = providers.find((p) => p.name === "my-api");
      expect(custom.custom).toBe(true);
    });

    it("should get volcengine provider with correct config", () => {
      const volcengine = registry.get("volcengine");
      expect(volcengine).toBeTruthy();
      expect(volcengine.name).toBe("volcengine");
      expect(volcengine.displayName).toBe("Volcengine (火山引擎/豆包)");
      expect(volcengine.baseUrl).toContain("ark.cn-beijing.volces.com");
      expect(volcengine.apiKeyEnv).toBe("VOLCENGINE_API_KEY");
      expect(volcengine.models).toContain("doubao-seed-code");
      expect(volcengine.custom).toBe(false);
    });

    it("should switch active provider to volcengine", () => {
      const provider = registry.setActive("volcengine");
      expect(provider.name).toBe("volcengine");
      expect(registry.getActive()).toBe("volcengine");
    });

    it("should list volcengine in providers list", () => {
      const providers = registry.list();
      const volcengine = providers.find((p) => p.name === "volcengine");
      expect(volcengine).toBeTruthy();
      expect(volcengine.displayName).toBe("Volcengine (火山引擎/豆包)");
      expect(volcengine.free).toBe(false);
    });

    it("should return null for volcengine API key when not set", () => {
      // Temporarily clear the env var in case it is set in this environment
      const saved = process.env.VOLCENGINE_API_KEY;
      delete process.env.VOLCENGINE_API_KEY;
      try {
        expect(registry.getApiKey("volcengine")).toBeNull();
      } finally {
        if (saved !== undefined) process.env.VOLCENGINE_API_KEY = saved;
      }
    });

    it("should not allow removing volcengine (built-in)", () => {
      expect(() => registry.removeProvider("volcengine")).toThrow(
        "Cannot remove built-in",
      );
    });

    it("should get kimi provider with correct config", () => {
      const kimi = registry.get("kimi");
      expect(kimi).toBeTruthy();
      expect(kimi.name).toBe("kimi");
      expect(kimi.displayName).toBe("Kimi (月之暗面)");
      expect(kimi.baseUrl).toBe("https://api.moonshot.cn/v1");
      expect(kimi.apiKeyEnv).toBe("MOONSHOT_API_KEY");
      expect(kimi.models).toContain("moonshot-v1-auto");
      expect(kimi.custom).toBe(false);
    });

    it("should switch active provider to kimi", () => {
      const provider = registry.setActive("kimi");
      expect(provider.name).toBe("kimi");
      expect(registry.getActive()).toBe("kimi");
    });

    it("should not allow removing kimi (built-in)", () => {
      expect(() => registry.removeProvider("kimi")).toThrow(
        "Cannot remove built-in",
      );
    });

    it("should get minimax provider with correct config", () => {
      const minimax = registry.get("minimax");
      expect(minimax).toBeTruthy();
      expect(minimax.name).toBe("minimax");
      expect(minimax.displayName).toBe("MiniMax (海螺AI)");
      expect(minimax.baseUrl).toBe("https://api.minimax.chat/v1");
      expect(minimax.apiKeyEnv).toBe("MINIMAX_API_KEY");
      expect(minimax.models).toContain("MiniMax-Text-01");
      expect(minimax.custom).toBe(false);
    });

    it("should switch active provider to minimax", () => {
      const provider = registry.setActive("minimax");
      expect(provider.name).toBe("minimax");
      expect(registry.getActive()).toBe("minimax");
    });

    it("should not allow removing minimax (built-in)", () => {
      expect(() => registry.removeProvider("minimax")).toThrow(
        "Cannot remove built-in",
      );
    });
  });

  // ─── LLM_PROVIDERS (constants.js - setup wizard) ─────────────

  describe("LLM_PROVIDERS (constants.js - setup wizard)", () => {
    it("should have 14 provider entries", () => {
      expect(Object.keys(LLM_PROVIDERS)).toHaveLength(14);
    });

    it("should have volcengine as first provider", () => {
      const keys = Object.keys(LLM_PROVIDERS);
      expect(keys[0]).toBe("volcengine");
    });

    it("should have proxy entries with isProxy flag", () => {
      expect(LLM_PROVIDERS["openai-proxy"].isProxy).toBe(true);
      expect(LLM_PROVIDERS["anthropic-proxy"].isProxy).toBe(true);
      expect(LLM_PROVIDERS["gemini-proxy"].isProxy).toBe(true);
    });

    it("should have correct default config for volcengine", () => {
      expect(LLM_PROVIDERS.volcengine.defaultBaseUrl).toBe(
        "https://ark.cn-beijing.volces.com/api/v3",
      );
      expect(LLM_PROVIDERS.volcengine.defaultModel).toBe(
        "doubao-seed-1-6-251015",
      );
      expect(LLM_PROVIDERS.volcengine.requiresApiKey).toBe(true);
    });

    it("should include kimi and minimax", () => {
      expect(LLM_PROVIDERS.kimi).toBeDefined();
      expect(LLM_PROVIDERS.kimi.name).toBe("Kimi (月之暗面)");
      expect(LLM_PROVIDERS.minimax).toBeDefined();
      expect(LLM_PROVIDERS.minimax.name).toBe("MiniMax (海螺AI)");
    });

    it("proxy entries should have empty defaultBaseUrl", () => {
      expect(LLM_PROVIDERS["openai-proxy"].defaultBaseUrl).toBe("");
      expect(LLM_PROVIDERS["anthropic-proxy"].defaultBaseUrl).toBe("");
      expect(LLM_PROVIDERS["gemini-proxy"].defaultBaseUrl).toBe("");
    });

    it("custom entry should have empty defaults", () => {
      expect(LLM_PROVIDERS.custom.defaultBaseUrl).toBe("");
      expect(LLM_PROVIDERS.custom.defaultModel).toBe("");
    });

    it("should have volcengine as default in DEFAULT_CONFIG", async () => {
      const { DEFAULT_CONFIG } = await import("../../src/constants.js");
      expect(DEFAULT_CONFIG.llm.provider).toBe("volcengine");
      expect(DEFAULT_CONFIG.llm.baseUrl).toContain("ark.cn-beijing.volces.com");
    });
  });
});

import {
  PROVIDER_MATURITY_V2,
  REQUEST_LIFECYCLE_V2,
  PROVIDER_DEFAULT_MAX_ACTIVE_PER_OWNER,
  PROVIDER_DEFAULT_MAX_PENDING_REQUESTS_PER_PROFILE,
  PROVIDER_DEFAULT_PROFILE_IDLE_MS,
  PROVIDER_DEFAULT_REQUEST_STUCK_MS,
  getMaxActiveProfilesPerOwnerV2,
  setMaxActiveProfilesPerOwnerV2,
  getMaxPendingRequestsPerProfileV2,
  setMaxPendingRequestsPerProfileV2,
  getProfileIdleMsV2,
  setProfileIdleMsV2,
  getRequestStuckMsV2,
  setRequestStuckMsV2,
  registerProfileV2,
  getProfileV2,
  listProfilesV2,
  setProfileStatusV2,
  activateProfileV2,
  suspendProfileV2,
  retireProfileV2,
  touchProfileV2,
  createRequestV2,
  getRequestV2,
  listRequestsV2,
  setRequestStatusV2,
  startRequestV2,
  completeRequestV2,
  failRequestV2,
  cancelRequestV2,
  getActiveProfileCountV2,
  getPendingRequestCountV2,
  autoSuspendIdleProfilesV2,
  autoFailStuckRequestsV2,
  getLlmProvidersStatsV2,
  _resetStateLlmProvidersV2,
} from "../../src/lib/llm-providers.js";

describe("LLM Providers V2", () => {
  beforeEach(() => _resetStateLlmProvidersV2());

  describe("frozen enums + defaults", () => {
    it("freezes PROVIDER_MATURITY_V2", () => {
      expect(Object.isFrozen(PROVIDER_MATURITY_V2)).toBe(true);
      expect(Object.values(PROVIDER_MATURITY_V2).sort()).toEqual([
        "active",
        "pending",
        "retired",
        "suspended",
      ]);
    });
    it("freezes REQUEST_LIFECYCLE_V2", () => {
      expect(Object.isFrozen(REQUEST_LIFECYCLE_V2)).toBe(true);
      expect(Object.values(REQUEST_LIFECYCLE_V2).sort()).toEqual([
        "cancelled",
        "completed",
        "failed",
        "queued",
        "running",
      ]);
    });
    it("exposes defaults", () => {
      expect(PROVIDER_DEFAULT_MAX_ACTIVE_PER_OWNER).toBe(8);
      expect(PROVIDER_DEFAULT_MAX_PENDING_REQUESTS_PER_PROFILE).toBe(16);
      expect(PROVIDER_DEFAULT_PROFILE_IDLE_MS).toBe(14 * 24 * 60 * 60 * 1000);
      expect(PROVIDER_DEFAULT_REQUEST_STUCK_MS).toBe(5 * 60 * 1000);
    });
  });

  describe("config getters/setters", () => {
    it("returns defaults", () => {
      expect(getMaxActiveProfilesPerOwnerV2()).toBe(8);
      expect(getMaxPendingRequestsPerProfileV2()).toBe(16);
    });
    it("setters accept positives", () => {
      setMaxActiveProfilesPerOwnerV2(3);
      setMaxPendingRequestsPerProfileV2(2);
      setProfileIdleMsV2(10_000);
      setRequestStuckMsV2(2_000);
      expect(getMaxActiveProfilesPerOwnerV2()).toBe(3);
      expect(getMaxPendingRequestsPerProfileV2()).toBe(2);
      expect(getProfileIdleMsV2()).toBe(10_000);
      expect(getRequestStuckMsV2()).toBe(2_000);
    });
    it("floors non-integer positives", () => {
      setMaxActiveProfilesPerOwnerV2(3.7);
      expect(getMaxActiveProfilesPerOwnerV2()).toBe(3);
    });
    it("rejects zero/negative/non-finite", () => {
      expect(() => setMaxActiveProfilesPerOwnerV2(0)).toThrow();
      expect(() => setMaxPendingRequestsPerProfileV2(-1)).toThrow();
      expect(() => setProfileIdleMsV2(NaN)).toThrow();
      expect(() => setRequestStuckMsV2("x")).toThrow();
    });
  });

  describe("registerProfileV2", () => {
    it("registers PENDING with required fields", () => {
      const p = registerProfileV2("p1", {
        ownerId: "o1",
        provider: "openai",
        model: "gpt-4",
      });
      expect(p.status).toBe("pending");
      expect(p.ownerId).toBe("o1");
      expect(p.provider).toBe("openai");
      expect(p.model).toBe("gpt-4");
      expect(p.activatedAt).toBeNull();
      expect(p.retiredAt).toBeNull();
    });
    it("defaults model to 'default'", () => {
      const p = registerProfileV2("p1", {
        ownerId: "o1",
        provider: "openai",
      });
      expect(p.model).toBe("default");
    });
    it("rejects duplicate id", () => {
      registerProfileV2("p1", { ownerId: "o1", provider: "openai" });
      expect(() =>
        registerProfileV2("p1", { ownerId: "o1", provider: "openai" }),
      ).toThrow(/already exists/);
    });
    it("rejects missing required", () => {
      expect(() => registerProfileV2("p1")).toThrow(/ownerId/);
      expect(() => registerProfileV2("p1", { ownerId: "o1" })).toThrow(
        /provider/,
      );
      expect(() =>
        registerProfileV2("", { ownerId: "o1", provider: "x" }),
      ).toThrow(/profile id/);
    });
    it("metadata copied defensively", () => {
      const meta = { v: 1 };
      registerProfileV2("p1", {
        ownerId: "o1",
        provider: "openai",
        metadata: meta,
      });
      meta.v = 99;
      expect(getProfileV2("p1").metadata.v).toBe(1);
    });
  });

  describe("profile state machine", () => {
    beforeEach(() => {
      registerProfileV2("p1", { ownerId: "o1", provider: "openai" });
    });
    it("pending→active stamps activatedAt", () => {
      const p = activateProfileV2("p1");
      expect(p.status).toBe("active");
      expect(p.activatedAt).toBeGreaterThan(0);
    });
    it("active→suspended→active preserves activatedAt", () => {
      const p1 = activateProfileV2("p1");
      const ts = p1.activatedAt;
      suspendProfileV2("p1");
      const p3 = activateProfileV2("p1");
      expect(p3.activatedAt).toBe(ts);
    });
    it("retired terminal", () => {
      activateProfileV2("p1");
      retireProfileV2("p1");
      expect(() => activateProfileV2("p1")).toThrow(
        /invalid profile transition/,
      );
    });
    it("retiredAt stamped on first terminal entry", () => {
      activateProfileV2("p1");
      const p = retireProfileV2("p1");
      expect(p.retiredAt).toBeGreaterThan(0);
    });
    it("rejects pending→suspended", () => {
      expect(() => suspendProfileV2("p1")).toThrow(
        /invalid profile transition/,
      );
    });
    it("rejects unknown profile", () => {
      expect(() => activateProfileV2("nope")).toThrow(/not found/);
    });
  });

  describe("per-owner active-profile cap", () => {
    it("rejects pending→active beyond cap", () => {
      setMaxActiveProfilesPerOwnerV2(2);
      registerProfileV2("p1", { ownerId: "o1", provider: "openai" });
      registerProfileV2("p2", { ownerId: "o1", provider: "openai" });
      registerProfileV2("p3", { ownerId: "o1", provider: "openai" });
      activateProfileV2("p1");
      activateProfileV2("p2");
      expect(() => activateProfileV2("p3")).toThrow(/active-profile cap/);
    });
    it("recovery is exempt from cap", () => {
      setMaxActiveProfilesPerOwnerV2(1);
      registerProfileV2("p1", { ownerId: "o1", provider: "openai" });
      registerProfileV2("p2", { ownerId: "o1", provider: "openai" });
      activateProfileV2("p1");
      suspendProfileV2("p1");
      activateProfileV2("p2");
      const p = activateProfileV2("p1");
      expect(p.status).toBe("active");
    });
    it("scoped by owner", () => {
      setMaxActiveProfilesPerOwnerV2(1);
      registerProfileV2("p1", { ownerId: "o1", provider: "openai" });
      registerProfileV2("p2", { ownerId: "o2", provider: "openai" });
      activateProfileV2("p1");
      const p = activateProfileV2("p2");
      expect(p.status).toBe("active");
    });
  });

  describe("listProfilesV2", () => {
    it("filters by owner / status / provider", () => {
      registerProfileV2("p1", { ownerId: "o1", provider: "openai" });
      registerProfileV2("p2", { ownerId: "o1", provider: "anthropic" });
      registerProfileV2("p3", { ownerId: "o2", provider: "openai" });
      activateProfileV2("p1");
      expect(listProfilesV2({ ownerId: "o1" })).toHaveLength(2);
      expect(listProfilesV2({ provider: "openai" })).toHaveLength(2);
      expect(listProfilesV2({ status: "active" })).toHaveLength(1);
    });
  });

  describe("touchProfileV2", () => {
    it("updates lastSeenAt", async () => {
      registerProfileV2("p1", { ownerId: "o1", provider: "openai" });
      const before = getProfileV2("p1").lastSeenAt;
      await new Promise((r) => setTimeout(r, 5));
      const p = touchProfileV2("p1");
      expect(p.lastSeenAt).toBeGreaterThan(before);
    });
    it("throws on unknown id", () => {
      expect(() => touchProfileV2("nope")).toThrow(/not found/);
    });
  });

  describe("createRequestV2", () => {
    beforeEach(() => {
      registerProfileV2("p1", { ownerId: "o1", provider: "openai" });
    });
    it("creates QUEUED with required fields", () => {
      const r = createRequestV2("r1", { profileId: "p1", kind: "chat" });
      expect(r.status).toBe("queued");
      expect(r.profileId).toBe("p1");
      expect(r.kind).toBe("chat");
      expect(r.startedAt).toBeNull();
      expect(r.settledAt).toBeNull();
    });
    it("defaults kind to completion", () => {
      const r = createRequestV2("r1", { profileId: "p1" });
      expect(r.kind).toBe("completion");
    });
    it("rejects duplicate id", () => {
      createRequestV2("r1", { profileId: "p1" });
      expect(() => createRequestV2("r1", { profileId: "p1" })).toThrow(
        /already exists/,
      );
    });
    it("rejects unknown profile", () => {
      expect(() => createRequestV2("r1", { profileId: "ghost" })).toThrow(
        /not found/,
      );
    });
    it("enforces per-profile pending cap on create (counts queued+running)", () => {
      setMaxPendingRequestsPerProfileV2(2);
      createRequestV2("r1", { profileId: "p1" });
      createRequestV2("r2", { profileId: "p1" });
      expect(() => createRequestV2("r3", { profileId: "p1" })).toThrow(
        /pending-request cap/,
      );
      startRequestV2("r1");
      expect(() => createRequestV2("r3", { profileId: "p1" })).toThrow(
        /pending-request cap/,
      );
      completeRequestV2("r1");
      const r3 = createRequestV2("r3", { profileId: "p1" });
      expect(r3.status).toBe("queued");
    });
  });

  describe("request state machine", () => {
    beforeEach(() => {
      registerProfileV2("p1", { ownerId: "o1", provider: "openai" });
      createRequestV2("r1", { profileId: "p1" });
    });
    it("queued→running stamps startedAt", () => {
      const r = startRequestV2("r1");
      expect(r.status).toBe("running");
      expect(r.startedAt).toBeGreaterThan(0);
    });
    it("running→completed stamps settledAt", () => {
      startRequestV2("r1");
      const r = completeRequestV2("r1");
      expect(r.settledAt).toBeGreaterThan(0);
    });
    it("running→failed stamps settledAt", () => {
      startRequestV2("r1");
      const r = failRequestV2("r1");
      expect(r.settledAt).toBeGreaterThan(0);
    });
    it("queued and running both → cancelled", () => {
      cancelRequestV2("r1");
      expect(getRequestV2("r1").status).toBe("cancelled");
      createRequestV2("r2", { profileId: "p1" });
      startRequestV2("r2");
      cancelRequestV2("r2");
      expect(getRequestV2("r2").status).toBe("cancelled");
    });
    it("rejects invalid transitions", () => {
      expect(() => completeRequestV2("r1")).toThrow(
        /invalid request transition/,
      );
      cancelRequestV2("r1");
      expect(() => startRequestV2("r1")).toThrow(/invalid request transition/);
    });
  });

  describe("listRequestsV2", () => {
    it("filters by profile and status", () => {
      registerProfileV2("p1", { ownerId: "o1", provider: "openai" });
      registerProfileV2("p2", { ownerId: "o1", provider: "openai" });
      createRequestV2("r1", { profileId: "p1" });
      createRequestV2("r2", { profileId: "p1" });
      createRequestV2("r3", { profileId: "p2" });
      startRequestV2("r1");
      expect(listRequestsV2({ profileId: "p1" })).toHaveLength(2);
      expect(listRequestsV2({ status: "queued" })).toHaveLength(2);
    });
  });

  describe("autoSuspendIdleProfilesV2", () => {
    it("flips active profiles past idle threshold", () => {
      setProfileIdleMsV2(1000);
      registerProfileV2("p1", { ownerId: "o1", provider: "openai" });
      activateProfileV2("p1");
      const r = autoSuspendIdleProfilesV2({ now: Date.now() + 5_000 });
      expect(r.count).toBe(1);
      expect(getProfileV2("p1").status).toBe("suspended");
    });
    it("does not touch fresh profiles", () => {
      registerProfileV2("p1", { ownerId: "o1", provider: "openai" });
      activateProfileV2("p1");
      const r = autoSuspendIdleProfilesV2({ now: Date.now() });
      expect(r.count).toBe(0);
    });
  });

  describe("autoFailStuckRequestsV2", () => {
    it("flips running requests past stuck threshold", () => {
      setRequestStuckMsV2(1000);
      registerProfileV2("p1", { ownerId: "o1", provider: "openai" });
      createRequestV2("r1", { profileId: "p1" });
      startRequestV2("r1");
      const r = autoFailStuckRequestsV2({ now: Date.now() + 5_000 });
      expect(r.count).toBe(1);
      expect(getRequestV2("r1").status).toBe("failed");
    });
    it("ignores queued requests", () => {
      registerProfileV2("p1", { ownerId: "o1", provider: "openai" });
      createRequestV2("r1", { profileId: "p1" });
      const r = autoFailStuckRequestsV2({ now: Date.now() + 1e9 });
      expect(r.count).toBe(0);
    });
  });

  describe("getLlmProvidersStatsV2", () => {
    it("zero state has all keys", () => {
      const s = getLlmProvidersStatsV2();
      expect(s.profilesByStatus).toEqual({
        pending: 0,
        active: 0,
        suspended: 0,
        retired: 0,
      });
      expect(s.requestsByStatus).toEqual({
        queued: 0,
        running: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
      });
    });
    it("counts after operations", () => {
      registerProfileV2("p1", { ownerId: "o1", provider: "openai" });
      activateProfileV2("p1");
      createRequestV2("r1", { profileId: "p1" });
      startRequestV2("r1");
      const s = getLlmProvidersStatsV2();
      expect(s.profilesByStatus.active).toBe(1);
      expect(s.requestsByStatus.running).toBe(1);
    });
  });

  describe("counts", () => {
    it("getActiveProfileCountV2 scoped by owner", () => {
      registerProfileV2("p1", { ownerId: "o1", provider: "openai" });
      registerProfileV2("p2", { ownerId: "o2", provider: "openai" });
      activateProfileV2("p1");
      activateProfileV2("p2");
      expect(getActiveProfileCountV2("o1")).toBe(1);
      expect(getActiveProfileCountV2("nope")).toBe(0);
    });
    it("getPendingRequestCountV2 counts queued+running", () => {
      registerProfileV2("p1", { ownerId: "o1", provider: "openai" });
      createRequestV2("r1", { profileId: "p1" });
      createRequestV2("r2", { profileId: "p1" });
      startRequestV2("r1");
      expect(getPendingRequestCountV2("p1")).toBe(2);
      completeRequestV2("r1");
      expect(getPendingRequestCountV2("p1")).toBe(1);
    });
  });

  describe("_resetStateLlmProvidersV2", () => {
    it("clears state and restores defaults", () => {
      setMaxActiveProfilesPerOwnerV2(99);
      registerProfileV2("p1", { ownerId: "o1", provider: "openai" });
      _resetStateLlmProvidersV2();
      expect(getMaxActiveProfilesPerOwnerV2()).toBe(8);
      expect(getProfileV2("p1")).toBeNull();
    });
  });
});
