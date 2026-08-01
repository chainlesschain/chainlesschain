/**
 * Plugin optionsSchema resolution + sensitive project-scope gate (P1 plugin).
 * Pure resolver + injected-IO store — never touches real dirs.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { normalizeOptionsSchema } from "../../src/lib/plugin-runtime/capabilities.js";
import {
  resolvePluginOptions,
  loadPluginOptionValues,
  setPluginOptionValues,
  patchPluginOptionValues,
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
const originalDeps = { ..._deps };

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
    const temporary = new Map();
    _deps.writeFileSync = (p, c) => {
      temporary.set(p, c);
    };
    _deps.renameSync = (from, to) => {
      const value = temporary.get(from);
      if (to === "USER") userMem._ = value;
      else projMem._ = value;
      temporary.delete(from);
    };
    _deps.unlinkSync = (p) => temporary.delete(p);
    _deps.mkdirSync = () => {};
    _deps.withFileLock = vi.fn((_target, body) => body({ locked: true }));
    _deps.secretStore = () => ({
      set: (k, v) => secrets.set(k, String(v)),
      get: (k) => secrets.get(k) ?? null,
      delete: (k) => secrets.delete(k),
    });
  });
  afterEach(() => {
    Object.assign(_deps, originalDeps);
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
    expect(JSON.parse(userMem._).p1.apiKey.__cc_secret_ref).toMatch(
      /^plugin-options\/[a-f0-9]{24}\/[a-f0-9]{64}\/[0-9a-f-]{36}$/,
    );
    expect(loadPluginOptionValues("p1", "user", { schema })).toEqual({
      apiKey: "secret-value",
    });
  });

  it("uses a fresh immutable reference and removes the replaced secret after commit", () => {
    setPluginOptionValues("p1", { apiKey: "first" }, "user", { schema });
    const firstRef = JSON.parse(userMem._).p1.apiKey.__cc_secret_ref;

    setPluginOptionValues("p1", { apiKey: "second" }, "user", { schema });
    const secondRef = JSON.parse(userMem._).p1.apiKey.__cc_secret_ref;

    expect(secondRef).not.toBe(firstRef);
    expect(secrets.has(firstRef)).toBe(false);
    expect(secrets.get(secondRef)).toBe("second");
  });

  it("rolls back a newly staged secret when the JSON commit fails", () => {
    setPluginOptionValues("p1", { apiKey: "first" }, "user", { schema });
    const committedJson = userMem._;
    const firstRef = JSON.parse(committedJson).p1.apiKey.__cc_secret_ref;
    _deps.renameSync = () => {
      throw new Error("simulated atomic rename failure");
    };

    expect(() =>
      setPluginOptionValues("p1", { apiKey: "second" }, "user", { schema }),
    ).toThrow(/atomic rename failure/i);
    expect(userMem._).toBe(committedJson);
    expect([...secrets.entries()]).toEqual([[firstRef, "first"]]);
  });

  it("separates plugin/key tuples that shared the legacy slash reference", () => {
    const leftSchema = normalizeOptionsSchema({
      c: { type: "string", sensitive: true },
    });
    const rightSchema = normalizeOptionsSchema({
      "b/c": { type: "string", sensitive: true },
    });

    setPluginOptionValues("a/b", { c: "left" }, "user", {
      schema: leftSchema,
    });
    setPluginOptionValues("a", { "b/c": "right" }, "user", {
      schema: rightSchema,
    });
    const document = JSON.parse(userMem._);
    const leftRef = document["a/b"].c.__cc_secret_ref;
    const rightRef = document.a["b/c"].__cc_secret_ref;

    expect(leftRef).not.toBe(rightRef);
    expect(leftRef).not.toBe("a/b/c");
    expect(rightRef).not.toBe("a/b/c");
    expect(secrets.get(leftRef)).toBe("left");
    expect(secrets.get(rightRef)).toBe("right");
  });

  it("does not delete a shared legacy reference still used by another plugin", () => {
    const leftSchema = normalizeOptionsSchema({
      c: { type: "string", sensitive: true },
    });
    userMem._ = JSON.stringify({
      "a/b": { c: { __cc_secret_ref: "a/b/c" } },
      a: { "b/c": { __cc_secret_ref: "a/b/c" } },
    });
    secrets.set("a/b/c", "legacy-shared");

    setPluginOptionValues("a/b", { c: "replacement" }, "user", {
      schema: leftSchema,
    });

    expect(secrets.get("a/b/c")).toBe("legacy-shared");
    expect(JSON.parse(userMem._).a["b/c"]).toEqual({
      __cc_secret_ref: "a/b/c",
    });
  });

  it("drops sensitive project values before persistence", () => {
    setPluginOptionValues(
      "p1",
      { apiKey: "project-leak", retries: 2 },
      "project",
      {
        schema,
      },
    );
    expect(JSON.parse(projMem._).p1).toEqual({
      retries: 2,
      __cc_rejected_sensitive: ["apiKey"],
    });
    expect(secrets.size).toBe(0);
  });

  it("fails closed without overwriting corrupt credential metadata", () => {
    userMem._ = "{broken";
    expect(() =>
      setPluginOptionValues("p1", { apiKey: "new-secret" }, "user", { schema }),
    ).toThrow(/option store/i);
    expect(userMem._).toBe("{broken");
    expect(secrets.size).toBe(0);
  });

  it("holds a fail-closed lock around secret and metadata updates", () => {
    setPluginOptionValues("p1", { apiKey: "secret" }, "user", { schema });
    expect(_deps.withFileLock).toHaveBeenCalledWith(
      "USER",
      expect.any(Function),
      expect.objectContaining({ failIfUnavailable: true }),
    );
  });

  it("reads and patches only after acquiring the lock, preserving a concurrent update", () => {
    userMem._ = JSON.stringify({ p1: { retries: 1 } });
    let lockHeld = false;
    const readFileSync = _deps.readFileSync;
    _deps.readFileSync = (p) => {
      expect(lockHeld).toBe(true);
      return readFileSync(p);
    };
    _deps.withFileLock = vi.fn((_target, body) => {
      // Model another writer committing while this caller was waiting for the
      // lock. A lock-internal read must observe and preserve both of its keys.
      userMem._ = JSON.stringify({
        p1: { retries: 9, userOnly: "concurrent" },
      });
      lockHeld = true;
      try {
        return body({ locked: true });
      } finally {
        lockHeld = false;
      }
    });

    patchPluginOptionValues(
      "p1",
      { endpoint: "https://patched.example" },
      "user",
      {
        schema,
      },
    );

    expect(JSON.parse(userMem._).p1).toEqual({
      retries: 9,
      userOnly: "concurrent",
      endpoint: "https://patched.example",
    });
  });

  it("patches a non-secret key without rotating an untouched secret reference", () => {
    setPluginOptionValues("p1", { apiKey: "secret", retries: 1 }, "user", {
      schema,
    });
    const ref = JSON.parse(userMem._).p1.apiKey.__cc_secret_ref;

    patchPluginOptionValues("p1", { retries: 2 }, "user", { schema });

    expect(JSON.parse(userMem._).p1.apiKey.__cc_secret_ref).toBe(ref);
    expect(JSON.parse(userMem._).p1.retries).toBe(2);
    expect(secrets.get(ref)).toBe("secret");
    expect(secrets.size).toBe(1);
  });
});
