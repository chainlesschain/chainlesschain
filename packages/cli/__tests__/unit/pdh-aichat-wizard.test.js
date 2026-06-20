import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ACCOUNTS_FILE,
  createAccountsStore,
  createVendorAdapterBridge,
  _jarToArray,
  getAIChatWizard,
  _resetForTests,
} from "../../src/lib/personal-data-hub-aichat-wizard.js";

describe("pdh-aichat-wizard — ACCOUNTS_FILE", () => {
  it("is the shared on-disk filename", () => {
    expect(ACCOUNTS_FILE).toBe("aichat-accounts.json");
  });
});

describe("pdh-aichat-wizard — createAccountsStore", () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cc-aichat-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("requires a string hubDir", () => {
    expect(() => createAccountsStore({})).toThrow(/hubDir required/);
    expect(() => createAccountsStore({ hubDir: 123 })).toThrow(
      /hubDir required/,
    );
  });

  it("exposes the resolved file path", () => {
    const s = createAccountsStore({ hubDir: dir });
    expect(s._filePath).toBe(join(dir, ACCOUNTS_FILE));
  });

  it("get returns null before anything is stored", async () => {
    const s = createAccountsStore({ hubDir: dir });
    expect(await s.get("openai")).toBeNull();
  });

  it("put then get round-trips and creates the file", async () => {
    const s = createAccountsStore({ hubDir: dir });
    await s.put("openai", { cookie: "c", ts: 1 });
    expect(existsSync(s._filePath)).toBe(true);
    expect(await s.get("openai")).toEqual({ cookie: "c", ts: 1 });
  });

  it("put/delete write atomically (no .tmp leftover, round-trips)", async () => {
    const s = createAccountsStore({ hubDir: dir });
    await s.put("a", { n: 1 });
    await s.put("b", { n: 2 });
    await s.delete("a");
    // Round-trip intact + no temp siblings left behind in the hub dir.
    expect(await s.get("b")).toEqual({ n: 2 });
    expect(readdirSync(dir).some((n) => n.endsWith(".tmp"))).toBe(false);
  });

  it("creates a missing hubDir on first put", async () => {
    const nested = join(dir, "deep", "hub");
    const s = createAccountsStore({ hubDir: nested });
    await s.put("v", { a: 1 });
    expect(existsSync(join(nested, ACCOUNTS_FILE))).toBe(true);
  });

  it("list returns the stored entries", async () => {
    const s = createAccountsStore({ hubDir: dir });
    await s.put("a", { n: 1 });
    await s.put("b", { n: 2 });
    expect(await s.list()).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("delete removes one vendor but keeps the file when others remain", async () => {
    const s = createAccountsStore({ hubDir: dir });
    await s.put("a", { n: 1 });
    await s.put("b", { n: 2 });
    await s.delete("a");
    expect(await s.get("a")).toBeNull();
    expect(await s.get("b")).toEqual({ n: 2 });
    expect(existsSync(s._filePath)).toBe(true);
  });

  it("delete of the last vendor unlinks the file", async () => {
    const s = createAccountsStore({ hubDir: dir });
    await s.put("only", { n: 1 });
    await s.delete("only");
    expect(existsSync(s._filePath)).toBe(false);
  });

  it("delete of an unknown vendor is a no-op", async () => {
    const s = createAccountsStore({ hubDir: dir });
    await expect(s.delete("ghost")).resolves.toBeUndefined();
  });

  it("tolerates a corrupt JSON file (treats it as empty)", async () => {
    const s = createAccountsStore({ hubDir: dir });
    writeFileSync(s._filePath, "{not json", "utf-8");
    expect(await s.get("x")).toBeNull();
    expect(await s.list()).toEqual([]);
  });
});

describe("pdh-aichat-wizard — _jarToArray", () => {
  it("filters an array to well-formed name/value pairs", () => {
    expect(
      _jarToArray([
        { name: "a", value: "1" },
        { name: "b" }, // no value
        { value: "2" }, // no name
        null,
      ]),
    ).toEqual([{ name: "a", value: "1" }]);
  });

  it("parses a cookie header string", () => {
    expect(_jarToArray("sid=abc; token=xyz")).toEqual([
      { name: "sid", value: "abc" },
      { name: "token", value: "xyz" },
    ]);
  });

  it("keeps '=' inside the value and skips malformed pairs", () => {
    expect(_jarToArray("a=b=c; =lead; novalue")).toEqual([
      { name: "a", value: "b=c" },
    ]);
  });

  it("maps an object of string values", () => {
    expect(_jarToArray({ sid: "abc", empty: "", num: 5 })).toEqual([
      { name: "sid", value: "abc" },
    ]);
  });

  it("returns [] for unsupported inputs", () => {
    expect(_jarToArray(42)).toEqual([]);
    expect(_jarToArray(null)).toEqual([]);
    expect(_jarToArray(undefined)).toEqual([]);
  });
});

describe("pdh-aichat-wizard — createVendorAdapterBridge (error branches)", () => {
  it("throws when no specs are available", () => {
    expect(() => createVendorAdapterBridge({ specs: [] })).toThrow(
      /specs required/,
    );
  });

  it("registerVendor reports UNKNOWN_VENDOR", async () => {
    const bridge = createVendorAdapterBridge({
      specs: [{ name: "known", validateCookie: async () => ({ ok: true }) }],
    });
    expect(await bridge.registerVendor("other", {})).toEqual({
      ok: false,
      reason: "UNKNOWN_VENDOR",
    });
  });

  it("registerVendor reports SPEC_MISSING_VALIDATE_COOKIE", async () => {
    const bridge = createVendorAdapterBridge({ specs: [{ name: "v" }] });
    expect(await bridge.registerVendor("v", {})).toEqual({
      ok: false,
      reason: "SPEC_MISSING_VALIDATE_COOKIE",
    });
  });

  it("registerVendor reports HTTP_CLIENT_INIT_FAILED when the client factory throws", async () => {
    const bridge = createVendorAdapterBridge({
      specs: [{ name: "v", validateCookie: async () => ({ ok: true }) }],
      _httpClientFactory: () => {
        throw new Error("boom");
      },
    });
    expect(await bridge.registerVendor("v", "sid=1")).toEqual({
      ok: false,
      reason: "HTTP_CLIENT_INIT_FAILED",
      error: "boom",
    });
  });
});

describe("pdh-aichat-wizard — getAIChatWizard guard", () => {
  afterEach(() => _resetForTests());

  it("requires a hubDir", () => {
    expect(() => getAIChatWizard({})).toThrow(/hubDir required/);
  });

  it("_resetForTests clears the singleton cache without throwing", () => {
    expect(() => _resetForTests()).not.toThrow();
  });
});
