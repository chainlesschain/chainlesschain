"use strict";

import { describe, expect, it } from "vitest";

const {
  ACCOUNT_SCOPE_DIGEST_LENGTH,
  createAccountScope,
  createAccountScopeFromAccount,
  createAccountScopeFromSnapshot,
  normalizeIdentity,
} = require("../lib/account-scope");
const { AdapterRegistry } = require("../lib/registry");

describe("account-backed adapter scopes", () => {
  it("is stable across harmless identity formatting differences", () => {
    const first = createAccountScope("email-imap", " User@Example.COM ");
    const second = createAccountScope("EMAIL-IMAP", "user@example.com");

    expect(first).toBe(second);
    expect(first).toMatch(
      new RegExp(
        `^account:email-imap:[a-f0-9]{${ACCOUNT_SCOPE_DIGEST_LENGTH}}$`,
      ),
    );
  });

  it("isolates identities without exposing the raw account identifier", () => {
    const alice = createAccountScope("email-imap", "alice@example.com");
    const bob = createAccountScope("email-imap", "bob@example.com");

    expect(alice).not.toBe(bob);
    expect(alice).not.toContain("alice");
    expect(alice).not.toContain("example.com");
  });

  it("separates the same identity across adapter namespaces", () => {
    expect(createAccountScope("email-imap", "42")).not.toBe(
      createAccountScope("wechat", "42"),
    );
  });

  it("rejects missing namespace or identity", () => {
    expect(() => createAccountScope("", "user")).toThrow(/namespace/u);
    expect(() => createAccountScope("email-imap", " ")).toThrow(/identity/u);
    expect(normalizeIdentity(" ＵＳＥＲ@Example.com ")).toBe(
      "user@example.com",
    );
  });

  it("derives a scope from the first available stable account field", () => {
    const scope = createAccountScopeFromAccount(
      "shopping-jd",
      { pin: "jd-user", cookies: "sensitive-cookie" },
      ["userId", "pin"],
    );

    expect(scope).toMatch(/^account:shopping-jd:[a-f0-9]{32}$/u);
    expect(scope).not.toContain("jd-user");
    expect(
      createAccountScopeFromAccount(
        "shopping-jd",
        { cookies: "sensitive-cookie" },
        ["userId", "pin"],
      ),
    ).toBeUndefined();
  });

  it("derives privacy-preserving scopes from embedded snapshot accounts", () => {
    const first = createAccountScopeFromSnapshot("shopping-taobao", {
      account: { userId: "Taobao-42", nickname: "Alice" },
    });
    const second = createAccountScopeFromSnapshot("shopping-taobao", {
      account: { userId: " taobao-42 " },
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^account:shopping-taobao:[a-f0-9]{32}$/u);
    expect(first).not.toContain("taobao-42");
  });

  it("supports adapter-specific top-level snapshot identities", () => {
    const fromSnapshot = createAccountScopeFromSnapshot(
      "email-imap",
      { user: "User@Example.com" },
      { topLevelFields: ["user"], includeField: false },
    );

    expect(fromSnapshot).toBe(
      createAccountScope("email-imap", "user@example.com"),
    );
  });

  it("isolates ephemeral cookie sync watermarks without exposing the runtime account id", () => {
    const registry = new AdapterRegistry({ vault: {} });
    const adapter = {
      name: "shopping-jd",
      runtimeScopeIdentityKey: "pin",
      defaultScope: "",
    };
    const first = registry._resolveScope(adapter, {
      cookie: "sid=secret",
      accountId: "JD-User",
    });
    const equivalent = registry._resolveScope(adapter, {
      cookie: "different-secret",
      pin: " jd-user ",
      accountId: "ignored",
    });
    const other = registry._resolveScope(adapter, {
      cookie: "sid=secret",
      accountId: "other-user",
    });

    expect(first).toBe(equivalent);
    expect(first).not.toBe(other);
    expect(first).toMatch(/^account:shopping-jd:[a-f0-9]{32}$/u);
    expect(first).not.toContain("jd-user");
    expect(first).not.toContain("secret");
  });
});
