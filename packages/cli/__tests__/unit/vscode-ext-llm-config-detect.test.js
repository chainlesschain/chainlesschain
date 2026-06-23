/**
 * VS Code extension LLM detection must read ~/.chainlesschain/config.json
 * DIRECTLY, not depend on the `cc` binary being runnable.
 *
 * Regression for the recurring "更新npm后又要重新配置LLM" bug: after
 * `npm i -g chainlesschain`, `cc` is often transiently broken (native module
 * rebuild / EBUSY / PATH shim) so `cc config get` exits non-zero. The old code
 * treated that as "LLM unconfigured" and forced a full re-setup even though
 * config.json was intact. Detection is now file-first (the config file is the
 * source of truth `cc config set` writes), with `cc config get` only as a
 * fallback when the file itself is unreadable.
 */
import { describe, it, expect } from "vitest";
import {
  readLlmConfigFromFile,
  getConfiguredProvider,
  getConfiguredModel,
  getConfiguredBaseUrl,
  getConfiguredVisionModel,
  hasConfiguredApiKey,
} from "../../../vscode-extension/src/llm-config.js";

// Inject a fake home + config.json contents; a `cc` that ALWAYS fails (mimics
// the broken-binary window right after an npm global update).
function deps({ config, ccFails = true } = {}) {
  return {
    homedir: () => "/fake/home",
    readFileSync: (file) => {
      if (String(file).replace(/\\/g, "/").endsWith("/.chainlesschain/config.json")) {
        if (config === undefined) {
          const e = new Error("ENOENT");
          e.code = "ENOENT";
          throw e;
        }
        return typeof config === "string" ? config : JSON.stringify(config);
      }
      throw new Error("unexpected read: " + file);
    },
    execFile: (_cmd, args, _opts, cb) => {
      if (ccFails) return cb(new Error("cc crashed (native module rebuild)"), "", "");
      // A working cc returns "llm.<field> = <value>".
      const field = String(args[args.length - 1]).split(".").pop();
      const map = { provider: "fallbackprov", model: "fbmodel", baseUrl: "http://fb", apiKey: "fbkey", visionModel: "fbvision" };
      cb(null, `llm.${field} = ${map[field] || ""}`, "");
    },
  };
}

const CONFIG = {
  llm: { provider: "volcengine", model: "doubao-x", baseUrl: "https://ark.example/v3", apiKey: "sk-secret", visionModel: "doubao-vision" },
};

describe("VS Code ext LLM detection — file-first, robust to broken cc", () => {
  it("reads provider from config.json even when cc is completely broken", async () => {
    expect(await getConfiguredProvider({ deps: deps({ config: CONFIG, ccFails: true }) })).toBe("volcengine");
  });

  it("reads model / baseUrl / visionModel / apiKey presence from the file", async () => {
    const d = deps({ config: CONFIG, ccFails: true });
    expect(await getConfiguredModel({ deps: d })).toBe("doubao-x");
    expect(await getConfiguredBaseUrl({ deps: d })).toBe("https://ark.example/v3");
    expect(await getConfiguredVisionModel({ deps: d })).toBe("doubao-vision");
    expect(await hasConfiguredApiKey({ deps: d })).toBe(true);
  });

  it("baseUrl containing '=' is read intact from the file (not split on '=')", async () => {
    const cfg = { llm: { provider: "openai", baseUrl: "https://x.example/v1?a=b&c=d" } };
    expect(await getConfiguredBaseUrl({ deps: deps({ config: cfg }) })).toBe("https://x.example/v1?a=b&c=d");
  });

  it("genuinely-unset field → null (file present, key absent) WITHOUT consulting cc", async () => {
    const cfg = { llm: { provider: "ollama" } }; // no model/key
    const d = deps({ config: cfg, ccFails: false }); // cc would return fbmodel/fbkey if consulted
    expect(await getConfiguredModel({ deps: d })).toBeNull(); // file authoritative → null, not 'fbmodel'
    expect(await hasConfiguredApiKey({ deps: d })).toBe(false);
    expect(await getConfiguredProvider({ deps: d })).toBe("ollama");
  });

  it("file missing → falls back to `cc config get`", async () => {
    const d = deps({ config: undefined, ccFails: false }); // no file, working cc
    expect(await getConfiguredProvider({ deps: d })).toBe("fallbackprov");
    expect(await hasConfiguredApiKey({ deps: d })).toBe(true); // fbkey
  });

  it("file missing AND cc broken → null/false (genuinely unknown, no crash)", async () => {
    const d = deps({ config: undefined, ccFails: true });
    expect(await getConfiguredProvider({ deps: d })).toBeNull();
    expect(await hasConfiguredApiKey({ deps: d })).toBe(false);
  });

  it("readLlmConfigFromFile returns the llm block or null on corrupt JSON", async () => {
    expect(readLlmConfigFromFile(deps({ config: CONFIG })).provider).toBe("volcengine");
    expect(readLlmConfigFromFile(deps({ config: "{ not json" }))).toBeNull();
    expect(readLlmConfigFromFile(deps({ config: undefined }))).toBeNull();
    expect(readLlmConfigFromFile(deps({ config: { other: 1 } }))).toBeNull(); // no llm block
  });
});
