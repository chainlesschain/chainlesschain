import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadEmailAccounts,
  loadAlipayAccounts,
  loadWechatAccounts,
  _atomicWriteJson600,
  sameAccountIdentity,
  accountRowsNewestFirst,
  activatePersistedAdapter,
} from "../../src/lib/personal-data-hub-wiring.js";

// The PDH account stores hold login credentials (cookies/tokens). The loaders
// MUST fail closed to [] (never throw) so a corrupt/partial file can't crash hub
// boot, and a round-trip through the atomic writer must preserve the data.
describe("personal-data-hub-wiring account stores", () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cc-pdhw-acct-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const loaders = [
    ["email", loadEmailAccounts],
    ["alipay", loadAlipayAccounts],
    ["wechat", loadWechatAccounts],
  ];

  for (const [name, load] of loaders) {
    describe(`${name} loader`, () => {
      it("returns [] when the file does not exist", () => {
        expect(load(join(dir, `${name}-missing.json`))).toEqual([]);
      });

      it("returns [] (does not throw) on corrupt JSON", () => {
        const file = join(dir, `${name}-corrupt.json`);
        writeFileSync(file, "{ this is not json", "utf-8");
        expect(() => load(file)).not.toThrow();
        expect(load(file)).toEqual([]);
      });

      it("returns [] when the parsed JSON is not an array", () => {
        const file = join(dir, `${name}-object.json`);
        writeFileSync(file, JSON.stringify({ account: "x" }), "utf-8");
        expect(load(file)).toEqual([]);
      });

      it("round-trips an array written via the atomic writer", () => {
        const file = join(dir, `${name}-accounts.json`);
        const accounts = [
          { account: { id: `${name}-1` }, token: "secret" },
          { account: { id: `${name}-2` } },
        ];
        _atomicWriteJson600(file, accounts);
        expect(load(file)).toEqual(accounts);
        // atomic writer leaves no .tmp sibling behind
        expect(readdirSync(dir).some((n) => n.endsWith(".tmp"))).toBe(false);
        // on-disk content is the canonical JSON we asked for
        expect(JSON.parse(readFileSync(file, "utf-8"))).toEqual(accounts);
      });
    });
  }

  it("compares account identifiers canonically", () => {
    expect(sameAccountIdentity(" User@Example.COM ", "user@example.com")).toBe(
      true,
    );
    expect(sameAccountIdentity("123456", "１２３４５６")).toBe(true);
    expect(sameAccountIdentity("alice@example.com", "bob@example.com")).toBe(
      false,
    );
    expect(sameAccountIdentity(null, null)).toBe(false);
  });

  it("orders persisted accounts by registration time with array order as a tie-breaker", () => {
    const oldest = { account: { id: "oldest" }, registeredAt: 100 };
    const newerFirst = { account: { id: "newer-first" }, registeredAt: 200 };
    const newerLast = { account: { id: "newer-last" }, registeredAt: 200 };
    const missingTimestamp = { account: { id: "missing" } };

    expect(
      accountRowsNewestFirst([
        oldest,
        newerFirst,
        missingTimestamp,
        newerLast,
      ]).map((row) => row.account.id),
    ).toEqual(["newer-last", "newer-first", "oldest", "missing"]);
  });

  it("activates the requested persisted account without rewriting its row", () => {
    const current = { name: "email-imap", account: { email: "old@test.com" } };
    const slots = new Map([[current.name, current]]);
    const registry = {
      has: (name) => slots.has(name),
      unregister: (name) => slots.delete(name),
      register: (adapter) => slots.set(adapter.name, adapter),
    };
    const accounts = [
      {
        account: { email: "first@test.com", authCode: "secret-1" },
        opts: { folders: ["INBOX"] },
        registeredAt: 100,
      },
      {
        account: { email: "Second@Test.com", authCode: "secret-2" },
        registeredAt: 200,
      },
    ];
    const before = structuredClone(accounts);

    const result = activatePersistedAdapter({
      registry,
      accounts,
      identity: " second@test.com ",
      identityOf: (row) => row.account.email,
      createAdapter: (row) => ({
        name: "email-imap",
        account: row.account,
      }),
    });

    expect(result.config).toBe(accounts[1]);
    expect(slots.get("email-imap").account.email).toBe("Second@Test.com");
    expect(accounts).toEqual(before);
  });

  it("keeps the active adapter when the requested persisted row is invalid", () => {
    const current = { name: "email-imap", account: { email: "old@test.com" } };
    const slots = new Map([[current.name, current]]);
    const registry = {
      has: (name) => slots.has(name),
      unregister: (name) => slots.delete(name),
      register: (adapter) => slots.set(adapter.name, adapter),
    };

    expect(() =>
      activatePersistedAdapter({
        registry,
        accounts: [{ account: { email: "broken@test.com" } }],
        identity: "broken@test.com",
        identityOf: (row) => row.account.email,
        createAdapter: () => {
          throw new Error("invalid persisted config");
        },
      }),
    ).toThrow(/invalid persisted config/);
    expect(slots.get("email-imap")).toBe(current);
  });
});
