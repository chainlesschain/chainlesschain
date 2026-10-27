import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { LLM_PROVIDERS } from "../../src/constants.js";
import { BUILT_IN_PROVIDERS } from "../../src/lib/llm-providers.js";
import { resolveModelCapabilityProfile } from "../../src/lib/model-capabilities.js";
import { MODEL_CAPABILITY_CATALOG_VERSION } from "../../src/lib/model-context-catalog.js";

const require = createRequire(import.meta.url);
const raw = readFileSync(
  new URL("../../src/lib/llm-onboarding-catalog.json", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const catalog = JSON.parse(raw);
const vendored = require("../../../vscode-extension/src/vendor/llm-onboarding-presets.json");
const {
  PROVIDER_PRESETS,
  suggestVisionModel,
} = require("../../../vscode-extension/src/llm-config.js");

describe("shared new-connection model recommendations", () => {
  it("keeps CLI and both IDEs synchronized with one normalized source digest", () => {
    expect(vendored.sourceSha256).toBe(
      createHash("sha256").update(raw).digest("hex"),
    );
    expect(catalog.capabilityCatalogVersion).toBe(
      MODEL_CAPABILITY_CATALOG_VERSION,
    );
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("../../scripts/sync-llm-onboarding.mjs", import.meta.url),
        ),
        "--check",
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 15000,
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("synchronized");
  });

  it("uses the same model, endpoint and key requirements for every official preset", () => {
    expect(PROVIDER_PRESETS).toHaveLength(10);
    for (const preset of PROVIDER_PRESETS) {
      expect(LLM_PROVIDERS[preset.id]).toMatchObject({
        defaultModel: preset.defaultModel,
        defaultBaseUrl: preset.baseUrl,
        requiresApiKey: preset.needsKey,
      });
      expect(preset.baseUrl).toBe(BUILT_IN_PROVIDERS[preset.id].baseUrl);
      expect(suggestVisionModel(preset.id)).toBe(preset.visionModel);
    }
  });

  it.each([
    ["openai", "gpt-6.1-sol", "openai-responses"],
    ["anthropic", "claude-sonnet-5-5", "anthropic-messages"],
  ])(
    "recommends the exact documented %s coding model without claiming account access",
    (provider, model, runtimeProtocol) => {
      const preset = PROVIDER_PRESETS.find((entry) => entry.id === provider);
      expect(preset.defaultModel).toBe(model);
      const profile = resolveModelCapabilityProfile({
        provider,
        model,
        baseUrl: preset.baseUrl,
      });
      expect(profile.runtimeProtocol).toBe(runtimeProtocol);
      expect(profile.runtimeVerified).toBe(false);
      expect(profile.reviewedAt).toBeTruthy();
      expect(vendored.accountVerified).toBe(false);
    },
  );

  it("keeps runtime fallbacks and gateway choices independent of new official recommendations", () => {
    expect(BUILT_IN_PROVIDERS.openai.models[0]).toBe("gpt-4o");
    expect(LLM_PROVIDERS["openai-proxy"].defaultModel).toBe("gpt-4o");
    expect(LLM_PROVIDERS.custom.defaultModel).toBe("");
    expect(
      PROVIDER_PRESETS.some((entry) => entry.isProxy || entry.id === "custom"),
    ).toBe(false);
    expect(
      resolveModelCapabilityProfile({
        provider: "openai",
        model: "team/custom",
        baseUrl: "https://relay.example/v1",
      }).runtimeProtocol,
    ).toBe("chat-completions");
  });
});
