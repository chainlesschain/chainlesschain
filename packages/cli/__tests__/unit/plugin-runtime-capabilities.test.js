/**
 * Plugin capability declaration + typed options schema (P1 "Plugin 能力声明和
 * 配置 Schema") — pure normalize/diff/consent/audit + options validation with
 * the sensitive-not-from-project invariant.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeCapabilities,
  diffCapabilities,
  consentRequiredForUpgrade,
  describeCapabilities,
  auditDeclaredCapabilities,
  normalizeOptionsSchema,
  optionDefaults,
  validateOptions,
  redactSensitiveOptions,
} from "../../src/lib/plugin-runtime/capabilities.js";

describe("normalizeCapabilities", () => {
  it("defaults everything to DENY", () => {
    expect(normalizeCapabilities(null)).toEqual({
      process: false,
      network: { any: false, domains: [] },
      filesystem: { roots: [] },
      mcp: false,
      monitor: false,
      credential: { names: [] },
    });
  });

  it("normalizes network true / '*' / list / object to {any,domains}", () => {
    expect(normalizeCapabilities({ network: true }).network).toEqual({
      any: true,
      domains: [],
    });
    expect(normalizeCapabilities({ network: "*" }).network).toEqual({
      any: true,
      domains: [],
    });
    expect(
      normalizeCapabilities({ network: ["a.com", "b.com"] }).network,
    ).toEqual({
      any: false,
      domains: ["a.com", "b.com"],
    });
    expect(normalizeCapabilities({ network: ["a.com", "*"] }).network).toEqual({
      any: true,
      domains: ["a.com"],
    });
  });

  it("normalizes filesystem/credential lists and coerces booleans", () => {
    const c = normalizeCapabilities({
      process: "true",
      mcp: 1,
      monitor: "yes",
      filesystem: ["/tmp", "/tmp"],
      credential: "GH_TOKEN, NPM_TOKEN",
    });
    expect(c.process).toBe(true);
    expect(c.mcp).toBe(true);
    expect(c.monitor).toBe(true);
    expect(c.filesystem.roots).toEqual(["/tmp"]); // deduped
    expect(c.credential.names).toEqual(["GH_TOKEN", "NPM_TOKEN"]);
  });
});

describe("diffCapabilities / consentRequiredForUpgrade", () => {
  it("flags a NEW capability as widening (needs re-consent)", () => {
    const prev = normalizeCapabilities({ network: ["a.com"] });
    const next = normalizeCapabilities({
      network: ["a.com", "b.com"],
      process: true,
    });
    const d = diffCapabilities(prev, next);
    expect(d.added.sort()).toEqual(["network:b.com", "process"]);
    expect(d.widened).toBe(true);
    expect(consentRequiredForUpgrade({ prevCaps: prev, nextCaps: next })).toBe(
      true,
    );
  });

  it("narrowing (dropping a capability) does NOT require re-consent", () => {
    const prev = normalizeCapabilities({ process: true, network: ["a.com"] });
    const next = normalizeCapabilities({ network: ["a.com"] });
    const d = diffCapabilities(prev, next);
    expect(d.removed).toEqual(["process"]);
    expect(d.widened).toBe(false);
    expect(consentRequiredForUpgrade({ prevCaps: prev, nextCaps: next })).toBe(
      false,
    );
  });

  it("going to network:* over specific domains is a widening", () => {
    const prev = normalizeCapabilities({ network: ["a.com"] });
    const next = normalizeCapabilities({ network: "*" });
    expect(diffCapabilities(prev, next).added).toContain("network:*");
  });

  it("first install (from empty) requires consent for whatever is declared", () => {
    const next = normalizeCapabilities({ mcp: true });
    expect(consentRequiredForUpgrade({ prevCaps: null, nextCaps: next })).toBe(
      true,
    );
  });

  it("describeCapabilities lists only granted capabilities", () => {
    const lines = describeCapabilities(
      normalizeCapabilities({ mcp: true, network: "*" }),
    );
    expect(lines.join(" ")).toMatch(/mcp/);
    expect(lines.join(" ")).toMatch(/network: ANY host/);
  });
});

describe("auditDeclaredCapabilities (declared-vs-actual)", () => {
  it("catches an MCP server shipped without the mcp/network capability", () => {
    const manifest = {
      capabilities: normalizeCapabilities({ process: true }),
      components: {
        mcp: { count: 1, inline: true },
        bin: [],
        lsp: [],
        hooks: null,
        monitors: null,
      },
    };
    const caps = auditDeclaredCapabilities(manifest).map((f) => f.capability);
    expect(caps).toContain("mcp");
    expect(caps).toContain("network");
  });

  it("catches process-spawning components (bin) without the process capability", () => {
    const manifest = {
      capabilities: normalizeCapabilities({}),
      components: {
        bin: [{ name: "x" }],
        mcp: null,
        lsp: [],
        hooks: null,
        monitors: null,
      },
    };
    expect(
      auditDeclaredCapabilities(manifest).map((f) => f.capability),
    ).toContain("process");
  });

  it("is clean when declarations cover the shipped components", () => {
    const manifest = {
      capabilities: normalizeCapabilities({
        process: true,
        mcp: true,
        network: "*",
      }),
      components: {
        mcp: { count: 1 },
        bin: [{ name: "x" }],
        lsp: [],
        hooks: null,
        monitors: null,
      },
    };
    expect(auditDeclaredCapabilities(manifest)).toEqual([]);
  });
});

describe("normalizeOptionsSchema", () => {
  it("canonicalizes descriptors with defaults", () => {
    const s = normalizeOptionsSchema({
      endpoint: {
        type: "string",
        default: "https://x",
        description: "API url",
      },
      retries: { type: "number", required: true },
      mode: { type: "enum", enum: ["a", "b"] },
      apiKey: { type: "string", sensitive: true, scope: "project" },
    });
    expect(s.endpoint).toMatchObject({
      type: "string",
      default: "https://x",
      scope: "both",
    });
    expect(s.retries).toMatchObject({ type: "number", required: true });
    expect(s.mode).toMatchObject({ type: "enum", enum: ["a", "b"] });
    // sensitive → scope narrowed to user even though it declared project
    expect(s.apiKey).toMatchObject({ sensitive: true, scope: "user" });
  });

  it("unknown type degrades to string", () => {
    expect(normalizeOptionsSchema({ x: { type: "blob" } }).x.type).toBe(
      "string",
    );
  });
});

describe("optionDefaults", () => {
  it("returns only keys with a non-null default", () => {
    const s = normalizeOptionsSchema({
      a: { default: 1 },
      b: { type: "string" },
    });
    expect(optionDefaults(s)).toEqual({ a: 1 });
  });
});

describe("validateOptions", () => {
  const schema = normalizeOptionsSchema({
    endpoint: { type: "string", default: "https://x" },
    retries: { type: "number", required: true },
    mode: { type: "enum", enum: ["fast", "slow"] },
    apiKey: { type: "string", sensitive: true },
    tags: { type: "string[]" },
  });

  it("coerces types and merges defaults", () => {
    const r = validateOptions(
      schema,
      { retries: "3", tags: "a, b" },
      { scope: "user" },
    );
    expect(r.ok).toBe(true);
    expect(r.normalized).toMatchObject({
      endpoint: "https://x",
      retries: 3,
      tags: ["a", "b"],
    });
  });

  it("flags a missing required option", () => {
    const r = validateOptions(schema, {}, { scope: "user" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/missing required option "retries"/);
  });

  it("rejects a bad enum / bad number", () => {
    const r = validateOptions(
      schema,
      { retries: "x", mode: "medium" },
      { scope: "user" },
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/retries/);
    expect(r.errors.join(" ")).toMatch(/mode/);
  });

  it("REJECTS a sensitive option supplied from project config", () => {
    const r = validateOptions(
      schema,
      { retries: 1, apiKey: "secret" },
      { scope: "project" },
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(
      /sensitive.*cannot be set from project config/,
    );
  });

  it("ALLOWS the same sensitive option from user scope", () => {
    const r = validateOptions(
      schema,
      { retries: 1, apiKey: "secret" },
      { scope: "user" },
    );
    expect(r.ok).toBe(true);
    expect(r.normalized.apiKey).toBe("secret");
  });

  it("warns (not errors) on unknown options", () => {
    const r = validateOptions(
      schema,
      { retries: 1, bogus: 1 },
      { scope: "user" },
    );
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/unknown option "bogus"/);
  });
});

describe("redactSensitiveOptions", () => {
  it("masks only schema-declared sensitive keys", () => {
    const schema = normalizeOptionsSchema({
      apiKey: { type: "string", sensitive: true },
      endpoint: { type: "string" },
    });
    expect(
      redactSensitiveOptions(schema, {
        apiKey: "secret",
        endpoint: "https://x",
      }),
    ).toEqual({
      apiKey: "***",
      endpoint: "https://x",
    });
  });
});
