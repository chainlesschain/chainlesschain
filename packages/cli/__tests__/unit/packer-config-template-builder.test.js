/**
 * Unit tests: src/lib/packer/config-template-builder.js
 *
 * Covers the secret scanner (findSecrets) and the buildConfigTemplate
 * happy/error paths. Secret scanning is the security-critical part of
 * `cc pack` — bundling user-supplied API keys into a redistributable
 * artifact would be a serious leak, so the tests are exhaustive about
 * which field shapes trigger an error.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildConfigTemplate,
  findSecrets,
  writeTemplate,
  SECRET_PATTERNS,
} from "../../src/lib/packer/config-template-builder.js";
import { PackError } from "../../src/lib/packer/errors.js";

describe("findSecrets", () => {
  it("returns empty array for clean object", () => {
    expect(findSecrets({})).toEqual([]);
    expect(findSecrets({ name: "demo", port: 8080, ok: true })).toEqual([]);
  });

  it("detects apiKey at top level", () => {
    const hits = findSecrets({ apiKey: "sk-abc123" });
    expect(hits.length).toBe(1);
    expect(hits[0].path).toBe("apiKey");
  });

  it("detects nested provider.apiKey", () => {
    const hits = findSecrets({
      llm: { providers: { openai: { apiKey: "sk-xyz" } } },
    });
    expect(hits.map((h) => h.path)).toEqual(["llm.providers.openai.apiKey"]);
  });

  it("detects all known secret field names", () => {
    const obj = {
      apiKey: "a",
      api_key: "b",
      privateKey: "c",
      private_key: "d",
      mnemonic: "e",
      password: "f",
      secret: "g",
      token: "h",
      access_token: "i",
      refresh_token: "j",
    };
    const hits = findSecrets(obj);
    expect(hits.length).toBe(10);
  });

  it("ignores empty strings", () => {
    expect(findSecrets({ apiKey: "", password: "" })).toEqual([]);
  });

  it("ignores numbers/booleans/null at secret paths", () => {
    expect(findSecrets({ token: 12345, password: true, apiKey: null })).toEqual(
      [],
    );
  });

  it("does not match similarly-named non-secret fields", () => {
    // "mytoken" should not match /(^|\.)token$/i
    expect(findSecrets({ mytoken: "abc" })).toEqual([]);
    expect(findSecrets({ apiKeyName: "openai" })).toEqual([]);
  });

  it("is case-insensitive", () => {
    expect(findSecrets({ APIKEY: "x" }).length).toBe(1);
    expect(findSecrets({ Password: "x" }).length).toBe(1);
  });

  it("walks arrays-of-objects without matching the array key itself", () => {
    // We do NOT recurse into arrays — design choice (avoids false hits on
    // ordered lists where positional path is meaningless). Document via test.
    const hits = findSecrets({
      providers: [{ apiKey: "sk-1" }, { apiKey: "sk-2" }],
    });
    expect(hits).toEqual([]);
  });
});

describe("SECRET_PATTERNS", () => {
  it("is frozen (cannot be mutated by tests)", () => {
    expect(Object.isFrozen(SECRET_PATTERNS)).toBe(true);
  });
});

describe("buildConfigTemplate", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-cfg-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("returns a base template with no preset", () => {
    const { template, secrets } = buildConfigTemplate({
      presetConfigPath: null,
      allowSecrets: false,
      bindHost: "127.0.0.1",
      wsPort: 18800,
      uiPort: 18810,
    });
    expect(template.schema).toBe(1);
    expect(template.server.bindHost).toBe("127.0.0.1");
    expect(template.server.wsPort).toBe(18800);
    expect(template.server.uiPort).toBe(18810);
    expect(template.server.enableTls).toBe(false);
    expect(secrets).toEqual([]);
  });

  it("merges a clean preset config", () => {
    const presetPath = path.join(tmpDir, "preset.json");
    fs.writeFileSync(
      presetPath,
      JSON.stringify({ llm: { defaultProvider: "openai" } }),
    );
    const { template, secrets } = buildConfigTemplate({
      presetConfigPath: presetPath,
      allowSecrets: false,
    });
    expect(template.llm.defaultProvider).toBe("openai");
    expect(secrets).toEqual([]);
  });

  it("rejects a preset containing apiKey when allowSecrets=false", () => {
    const presetPath = path.join(tmpDir, "preset.json");
    fs.writeFileSync(
      presetPath,
      JSON.stringify({
        llm: { providers: { openai: { apiKey: "sk-evil" } } },
      }),
    );
    expect(() =>
      buildConfigTemplate({
        presetConfigPath: presetPath,
        allowSecrets: false,
      }),
    ).toThrow(PackError);
  });

  it("allows a preset with secrets when allowSecrets=true", () => {
    const presetPath = path.join(tmpDir, "preset.json");
    fs.writeFileSync(
      presetPath,
      JSON.stringify({
        llm: { providers: { openai: { apiKey: "sk-evil" } } },
      }),
    );
    const { template, secrets } = buildConfigTemplate({
      presetConfigPath: presetPath,
      allowSecrets: true,
    });
    expect(template.llm.providers.openai.apiKey).toBe("sk-evil");
    expect(secrets.length).toBe(1);
  });

  it("throws PackError with exit code 16 for secret violation", () => {
    const presetPath = path.join(tmpDir, "preset.json");
    fs.writeFileSync(presetPath, JSON.stringify({ apiKey: "x" }));
    try {
      buildConfigTemplate({
        presetConfigPath: presetPath,
        allowSecrets: false,
      });
      throw new Error("should not reach here");
    } catch (e) {
      expect(e).toBeInstanceOf(PackError);
      expect(e.exitCode).toBe(16);
    }
  });

  it("throws on missing preset file", () => {
    expect(() =>
      buildConfigTemplate({
        presetConfigPath: path.join(tmpDir, "nope.json"),
        allowSecrets: false,
      }),
    ).toThrow(/not found/);
  });

  it("throws on invalid preset JSON", () => {
    const presetPath = path.join(tmpDir, "preset.json");
    fs.writeFileSync(presetPath, "{ this is not json");
    expect(() =>
      buildConfigTemplate({
        presetConfigPath: presetPath,
        allowSecrets: false,
      }),
    ).toThrow(/not valid JSON/);
  });
});

describe("writeTemplate", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-cfg-w-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("writes config.example.json to disk", () => {
    const file = writeTemplate({ schema: 1, foo: "bar" }, tmpDir);
    expect(fs.existsSync(file)).toBe(true);
    expect(path.basename(file)).toBe("config.example.json");
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(parsed.foo).toBe("bar");
  });

  it("creates the output directory if missing", () => {
    const nested = path.join(tmpDir, "a", "b", "c");
    const file = writeTemplate({ ok: true }, nested);
    expect(fs.existsSync(file)).toBe(true);
  });
});
