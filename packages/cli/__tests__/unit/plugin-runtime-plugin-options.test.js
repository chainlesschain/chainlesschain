/**
 * Plugin optionsSchema resolution + sensitive project-scope gate (P1 plugin).
 * Pure resolver + injected-IO store — never touches real dirs.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { normalizeOptionsSchema } from "../../src/lib/plugin-runtime/capabilities.js";
import {
  resolvePluginOptions,
  loadPluginOptionValues,
  setPluginOptionValues,
  getResolvedPluginOptions,
  _deps,
} from "../../src/lib/plugin-runtime/plugin-options.js";

const schema = normalizeOptionsSchema({
  endpoint: { type: "string", default: "https://api.example.com" },
  retries: { type: "number", default: 3 },
  region: { type: "enum", enum: ["us", "eu"], scope: "project" },
  apiKey: { type: "string", sensitive: true },
  userOnly: { type: "string", scope: "user" },
});

describe("resolvePluginOptions (pure)", () => {
  it("returns defaults with no config", () => {
    const r = resolvePluginOptions(schema, {});
    expect(r.options).toEqual({
      endpoint: "https://api.example.com",
      retries: 3,
    });
    expect(r.sources.endpoint).toBe("default");
    expect(r.droppedFromProject).toEqual([]);
  });

  it("layers defaults < project < user", () => {
    const r = resolvePluginOptions(schema, {
      projectValues: { retries: 5, region: "eu" },
      userValues: { retries: 9 },
    });
    expect(r.options.retries).toBe(9); // user wins
    expect(r.sources.retries).toBe("user");
    expect(r.options.region).toBe("eu"); // project-only key survives
    expect(r.sources.region).toBe("project");
  });

  it("drops a SENSITIVE option supplied via project config (+ warns)", () => {
    const r = resolvePluginOptions(schema, {
      projectValues: { apiKey: "leaked-secret" },
      userValues: { apiKey: "real-secret" },
    });
    expect(r.options.apiKey).toBe("real-secret"); // user value used
    expect(r.sources.apiKey).toBe("user");
    expect(r.droppedFromProject).toContain("apiKey");
    expect(r.warnings.some((w) => /apiKey.*sensitive/.test(w))).toBe(true);
  });

  it("drops a USER-ONLY option supplied via project config", () => {
    const r = resolvePluginOptions(schema, {
      projectValues: { userOnly: "from-project" },
    });
    expect(r.options.userOnly).toBeUndefined();
    expect(r.droppedFromProject).toContain("userOnly");
  });

  it("redacts sensitive values for logging", () => {
    const r = resolvePluginOptions(schema, {
      userValues: { apiKey: "s3cr3t" },
    });
    expect(r.redacted.apiKey).toBe("***");
    expect(r.options.apiKey).toBe("s3cr3t");
  });

  it("coerces number/enum and warns on invalid + unknown", () => {
    const r = resolvePluginOptions(schema, {
      userValues: { retries: "notnum", region: "mars", bogus: 1 },
    });
    expect(r.options.retries).toBe(3); // invalid → stays default
    expect(r.warnings.some((w) => /retries.*number/.test(w))).toBe(true);
    expect(r.warnings.some((w) => /unknown option "bogus"/.test(w))).toBe(true);
  });
});

describe("plugin-options store (injected IO)", () => {
  let userMem, projMem;
  let secrets;
  beforeEach(() => {
    userMem = {};
    projMem = {};
    secrets = new Map();
    _deps.userStorePath = () => "USER";
    _deps.projectStorePath = () => "PROJ";
    _deps.existsSync = (p) => (p === "USER" ? userMem._ : projMem._) != null;
    _deps.readFileSync = (p) => (p === "USER" ? userMem._ : projMem._);
    _deps.writeFileSync = (p, c) => {
      if (p === "USER") userMem._ = c;
      else projMem._ = c;
    };
    _deps.mkdirSync = () => {};
    _deps.secretStore = () => ({
      set: (k, v) => secrets.set(k, String(v)),
      get: (k) => secrets.get(k) ?? null,
      delete: (k) => secrets.delete(k),
    });
  });

  it("round-trips values per scope + plugin", () => {
    setPluginOptionValues("p1", { retries: 7 }, "project");
    setPluginOptionValues("p1", { apiKey: "k" }, "user");
    expect(loadPluginOptionValues("p1", "project")).toEqual({ retries: 7 });
    expect(loadPluginOptionValues("p1", "user")).toEqual({ apiKey: "k" });
    // unrelated plugin isolated
    expect(loadPluginOptionValues("p2", "user")).toEqual({});
  });

  it("getResolvedPluginOptions merges both stores through the gate", () => {
    setPluginOptionValues("p1", { retries: 5, apiKey: "PROJLEAK" }, "project");
    setPluginOptionValues("p1", { apiKey: "userkey" }, "user");
    const r = getResolvedPluginOptions("p1", schema);
    expect(r.options.retries).toBe(5);
    expect(r.options.apiKey).toBe("userkey");
    expect(r.droppedFromProject).toContain("apiKey");
  });

  it("stores sensitive user options outside plugin-options.json", () => {
    setPluginOptionValues("p1", { apiKey: "secret-value" }, "user", {
      schema,
    });
    expect(userMem._).not.toContain("secret-value");
    expect(JSON.parse(userMem._).p1.apiKey).toEqual({
      __cc_secret_ref: "p1/apiKey",
    });
    expect(loadPluginOptionValues("p1", "user", { schema })).toEqual({
      apiKey: "secret-value",
    });
  });

  it("drops sensitive project values before persistence", () => {
    setPluginOptionValues("p1", { apiKey: "project-leak", retries: 2 }, "project", {
      schema,
    });
    expect(JSON.parse(projMem._).p1).toEqual({
      retries: 2,
      __cc_rejected_sensitive: ["apiKey"],
    });
    expect(secrets.size).toBe(0);
  });
});
