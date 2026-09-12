import { describe, expect, it } from "vitest";
import { canonicalDigest } from "@chainlesschain/context-memory-kernel";
import {
  resolveAgentOutputBudget,
  resolveModelCapabilityProfile,
} from "../../src/lib/model-capabilities.js";
import {
  CONTEXT_WINDOWS as CATALOG_WINDOWS,
  DOCUMENTED_OPENAI_MODELS,
  LEGACY_MODEL_PROVIDERS,
} from "../../src/lib/model-context-catalog.js";
import {
  CONTEXT_WINDOWS,
  getContextWindow,
} from "../../src/lib/model-context-window.js";

describe("versioned model capability profiles", () => {
  it("reports the documented official model window without claiming live verification", () => {
    const profile = resolveModelCapabilityProfile({
      provider: "openai",
      model: "gpt-4o",
    });
    expect(profile).toMatchObject({
      schema: "chainlesschain.model-capability-profile/v1",
      catalogVersion: "2026-09-13",
      provider: "openai",
      model: "gpt-4o",
      contextWindowTokens: 128000,
      windowSource: "official-model-docs",
      windowAssumed: false,
      runtimeProtocol: "chat-completions",
      runtimeVerified: false,
      requestMaxOutputTokens: null,
      plannedOutputReserveTokens: 4096,
      outputReserveSource: "planning-fallback",
      advertisedMaxOutputTokens: 16384,
      sources: ["https://developers.openai.com/api/docs/models/gpt-4o"],
    });
    expect(profile.limitations.join(" ")).toMatch(/not an output cap/);
  });

  it("selects native Responses for the documented official tool target", () => {
    const profile = resolveModelCapabilityProfile({
      provider: "openai",
      model: "gpt-6-astra",
      baseUrl: "https://api.openai.com/v1",
    });
    expect(profile.contextWindowTokens).toBe(1050000);
    expect(profile.advertisedMaxOutputTokens).toBe(128000);
    expect(profile.runtimeProtocol).toBe("openai-responses");
    expect(profile.runtimeVerified).toBe(false);
    expect(profile.limitations.join(" ")).toMatch(/has not been verified/);
    expect(profile.limitations.join(" ")).not.toMatch(/not implemented/);
    expect(profile.sources).toContain(
      "https://developers.openai.com/api/docs/guides/migrate-to-responses",
    );
    expect(CONTEXT_WINDOWS).not.toHaveProperty("gpt-6-astra");
  });

  it.each([
    "https://gateway.example/v1",
    "http://api.openai.com/v1",
    "https://api.openai.com:444/v1",
    "https://api.openai.com/v1/",
    "https://api.openai.com/v1/other",
    "https://api.openai.com/v1?token=secret-marker",
    "https://api.openai.com/v1#secret-marker",
    "https://api.openai.com/v1#",
    "https://api.openai.com/v1 ",
    "https://user:secret-marker@api.openai.com/v1",
    "https://api.openai.com.example/v1",
    "not-a-url",
  ])("does not apply new official limits to custom endpoint %s", (baseUrl) => {
    const profile = resolveModelCapabilityProfile({
      provider: "openai",
      model: "gpt-6-astra",
      baseUrl,
    });
    expect(profile.contextWindowTokens).toBe(128000);
    expect(profile.windowSource).toBe("provider-default");
    expect(profile.windowAssumed).toBe(true);
    expect(profile.advertisedMaxOutputTokens).toBeNull();
    expect(profile.sources).toEqual([]);
    expect(JSON.stringify(profile)).not.toContain(baseUrl);
    expect(JSON.stringify(profile)).not.toContain("secret-marker");
  });

  it("retains a custom gateway's old catalog value as assumed, not official", () => {
    const profile = resolveModelCapabilityProfile({
      provider: "openai",
      model: "gpt-4o",
      baseUrl: "https://gateway.example/v1",
    });
    expect(profile.contextWindowTokens).toBe(128000);
    expect(profile.windowSource).toBe("legacy-catalog");
    expect(profile.windowAssumed).toBe(true);
    expect(profile.advertisedMaxOutputTokens).toBeNull();
  });

  it("does not infer arbitrary aliases or future snapshots from a prefix", () => {
    const profile = resolveModelCapabilityProfile({
      provider: "openai",
      model: "gpt-6-astra-custom",
    });
    expect(profile.windowSource).toBe("provider-default");
    expect(profile.contextWindowTokens).toBe(128000);
    expect(profile.sources).toEqual([]);
  });

  it("keeps provider and model identities exact rather than rewriting request ids", () => {
    for (const model of [" gpt-6-astra", "gpt-6-astra ", "GPT-6-ASTRA"]) {
      expect(
        resolveModelCapabilityProfile({ provider: "openai", model })
          .windowSource,
      ).toBe("provider-default");
    }
    expect(
      resolveModelCapabilityProfile({
        provider: " openai",
        model: "gpt-6-astra",
      }).windowSource,
    ).toBe("generic-default");
  });

  it("isolates model catalog windows by explicit provider", () => {
    const profile = resolveModelCapabilityProfile({
      provider: "ollama",
      model: "gpt-4o",
    });
    expect(profile.contextWindowTokens).toBe(32768);
    expect(profile.windowSource).toBe("provider-default");
    expect(profile.windowAssumed).toBe(true);
    expect(profile.runtimeProtocol).toBe("ollama-chat");
    expect(profile.limitations.join(" ")).toMatch(/another provider/);
    expect(getContextWindow("gpt-4o", "ollama")).toBe(32768);
  });

  it("keeps the no-provider legacy lookup explicitly unscoped", () => {
    expect(resolveModelCapabilityProfile({ model: "gpt-4o" })).toMatchObject({
      provider: "unknown",
      contextWindowTokens: 128000,
      windowSource: "legacy-catalog-unscoped",
      windowAssumed: true,
      runtimeProtocol: "unsupported",
      runtimeVerified: false,
    });
    expect(getContextWindow("gpt-4o")).toBe(128000);
  });

  it("does not choose a default model for an incomplete diagnostic target", () => {
    expect(resolveModelCapabilityProfile()).toMatchObject({
      provider: "unknown",
      model: null,
      contextWindowTokens: 32768,
      windowSource: "generic-default",
      windowAssumed: true,
    });
    expect(resolveModelCapabilityProfile({ provider: "openai" })).toMatchObject(
      {
        model: null,
        contextWindowTokens: 128000,
        windowSource: "provider-default",
      },
    );
  });

  it("never treats prototype property names as catalog records", () => {
    for (const model of [
      "__proto__",
      "constructor",
      "toString",
      "_provider_defaults",
    ]) {
      expect(
        resolveModelCapabilityProfile({ model, provider: "openai" })
          .windowSource,
      ).toBe("provider-default");
    }
    expect(
      resolveModelCapabilityProfile({ provider: "toString", model: "gpt-4o" })
        .contextWindowTokens,
    ).toBe(32768);
  });

  it("validates and identifies operator overrides without certifying them", () => {
    const profile = resolveModelCapabilityProfile({
      provider: "openai",
      model: "gpt-6-astra",
      contextMemoryModelWindowTokens: " 8192 ",
    });
    expect(profile).toMatchObject({
      contextWindowTokens: 8192,
      windowSource: "explicit-override",
      windowAssumed: true,
    });
    expect(profile.limitations.join(" ")).toMatch(
      /operator-declared and unverified/,
    );
    expect(
      resolveModelCapabilityProfile({ contextMemoryModelWindowTokens: 1024 })
        .contextWindowTokens,
    ).toBe(1024);
    expect(
      resolveModelCapabilityProfile({
        contextMemoryModelWindowTokens: 16777216,
      }).contextWindowTokens,
    ).toBe(16777216);
  });

  it.each([
    0,
    -1,
    1023,
    16777217,
    NaN,
    Infinity,
    1024.5,
    true,
    false,
    "",
    "1e5",
    "1024.0",
    "secret-marker",
  ])(
    "rejects an invalid window override instead of silently using a fallback: %s",
    (value) => {
      expect(() =>
        resolveModelCapabilityProfile({
          contextMemoryModelWindowTokens: value,
        }),
      ).toThrow(/contextMemoryModelWindowTokens must be an integer/);
      try {
        resolveModelCapabilityProfile({
          contextMemoryModelWindowTokens: value,
        });
      } catch (error) {
        expect(error.message).not.toContain("secret-marker");
      }
    },
  );

  it("binds stable resolved values and provenance into a content digest", () => {
    const input = { provider: "openai", model: "gpt-6-astra" };
    const first = resolveModelCapabilityProfile(input);
    const second = resolveModelCapabilityProfile({ ...input });
    expect(second).toEqual(first);
    const { digest, ...payload } = first;
    expect(digest).toBe(canonicalDigest(payload, payload.schema));
    expect(first.profileId.length).toBeLessThan(128);
    expect(
      resolveModelCapabilityProfile({
        ...input,
        contextMemoryModelWindowTokens: 8192,
      }).digest,
    ).not.toBe(digest);
    expect(
      resolveModelCapabilityProfile({ ...input, maxOutputTokens: 8192 }).digest,
    ).not.toBe(digest);
    expect(
      resolveModelCapabilityProfile({
        ...input,
        baseUrl: "https://gateway.example/v1",
      }).digest,
    ).not.toBe(digest);
    expect(
      resolveModelCapabilityProfile({ ...input, provider: "ollama" }).profileId,
    ).not.toBe(first.profileId);
  });

  it("does not include endpoint credentials or transient host state in a digest", () => {
    const first = resolveModelCapabilityProfile({
      provider: "openai",
      model: "gpt-6-astra",
      baseUrl: "https://user:one@gateway.example/v1",
    });
    const second = resolveModelCapabilityProfile({
      provider: "openai",
      model: "gpt-6-astra",
      baseUrl: "https://user:two@other.example/v1",
    });
    expect(second.digest).toBe(first.digest);
    expect(JSON.stringify(first)).not.toMatch(
      /gateway\.example|user:one|baseUrl|apiKey|resolvedAt/,
    );
  });

  it("freezes and copies metadata so a caller cannot contaminate another profile", () => {
    const profile = resolveModelCapabilityProfile({
      provider: "openai",
      model: "gpt-6-astra",
    });
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.sources)).toBe(true);
    expect(Object.isFrozen(profile.limitations)).toBe(true);
    expect(profile.sources).not.toBe(
      DOCUMENTED_OPENAI_MODELS["gpt-6-astra"].sources,
    );
    expect(() => profile.sources.push("changed")).toThrow(TypeError);
    expect(() => {
      profile.contextWindowTokens = 1;
    }).toThrow(TypeError);
    expect(
      resolveModelCapabilityProfile({
        provider: "openai",
        model: "gpt-6-astra",
      }),
    ).toEqual(profile);
  });
});

describe("agent output budget matches existing transport behavior", () => {
  it.each([
    [undefined, 8192],
    ["claude-sonnet-4-6", 8192],
    ["claude-opus-4-6", 16384],
    ["claude-haiku-4-5", 4096],
  ])("uses the existing Anthropic default for %s", (model, cap) => {
    expect(resolveAgentOutputBudget({ provider: "anthropic", model })).toEqual({
      requestMaxOutputTokens: cap,
      plannedOutputReserveTokens: cap,
      outputReserveSource: "anthropic-request-default",
    });
  });

  it("retains the Anthropic explicit-cap clamp and exposes it to the planner", () => {
    expect(
      resolveAgentOutputBudget({
        provider: "anthropic",
        model: "claude-opus-4-6",
        maxOutputTokens: 30000,
      }),
    ).toEqual({
      requestMaxOutputTokens: 16384,
      plannedOutputReserveTokens: 16384,
      outputReserveSource: "anthropic-request-clamp",
    });
    expect(
      resolveAgentOutputBudget({
        provider: "anthropic",
        maxOutputTokens: "512",
      }),
    ).toEqual({
      requestMaxOutputTokens: 512,
      plannedOutputReserveTokens: 512,
      outputReserveSource: "explicit-request-cap",
    });
  });

  it.each(["openai", "ollama", "deepseek", "custom", undefined])(
    "does not synthesize a request cap for %s",
    (provider) => {
      expect(resolveAgentOutputBudget({ provider })).toEqual({
        requestMaxOutputTokens: null,
        plannedOutputReserveTokens: 4096,
        outputReserveSource: "planning-fallback",
      });
    },
  );

  it("does not clip a requested cap or impose the planner's minimum reserve", () => {
    expect(
      resolveAgentOutputBudget({ provider: "openai", maxOutputTokens: 1 }),
    ).toMatchObject({
      requestMaxOutputTokens: 1,
      plannedOutputReserveTokens: 1,
    });
    const profile = resolveModelCapabilityProfile({
      provider: "openai",
      model: "gpt-4o",
      maxOutputTokens: 20000,
      contextMemoryModelWindowTokens: 1024,
    });
    expect(profile.requestMaxOutputTokens).toBe(20000);
    expect(profile.plannedOutputReserveTokens).toBe(20000);
    expect(profile.limitations.join(" ")).toMatch(
      /exceeds the documented model maximum/,
    );
  });

  it.each([null, undefined])(
    "treats only nullish caps as absent: %s",
    (maxOutputTokens) => {
      expect(
        resolveAgentOutputBudget({ maxOutputTokens }).requestMaxOutputTokens,
      ).toBeNull();
    },
  );

  it.each([
    0,
    -1,
    NaN,
    Infinity,
    1.5,
    true,
    false,
    "",
    "1e3",
    "1.5",
    "secret-marker",
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects an invalid explicit output cap: %s", (maxOutputTokens) => {
    expect(() => resolveAgentOutputBudget({ maxOutputTokens })).toThrow(
      /maxOutputTokens must be an integer/,
    );
  });
});

describe("legacy context window interface", () => {
  it("reexports the unchanged frozen catalog object", () => {
    expect(CONTEXT_WINDOWS).toBe(CATALOG_WINDOWS);
    expect(Object.isFrozen(CONTEXT_WINDOWS)).toBe(true);
    expect(Object.isFrozen(CONTEXT_WINDOWS._provider_defaults)).toBe(true);
    expect(Object.keys(CONTEXT_WINDOWS)).toHaveLength(31);
    for (const [model, provider] of Object.entries(LEGACY_MODEL_PROVIDERS)) {
      expect(getContextWindow(model, provider)).toBe(CONTEXT_WINDOWS[model]);
      expect(getContextWindow(model)).toBe(CONTEXT_WINDOWS[model]);
    }
  });

  it("retains provider and generic fallback numeric behavior", () => {
    expect(getContextWindow("unknown-model", "anthropic")).toBe(200000);
    expect(getContextWindow(null, "openai")).toBe(128000);
    expect(getContextWindow(undefined, "deepseek")).toBe(64000);
    expect(getContextWindow("", "anthropic")).toBe(200000);
    expect(getContextWindow("x", "y")).toBe(32768);
    expect(getContextWindow()).toBe(32768);
  });
});
