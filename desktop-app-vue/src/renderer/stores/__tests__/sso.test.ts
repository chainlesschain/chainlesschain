/**
 * useSSOStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: enabledProviders / providerCount / activeSessionCount
 *    (expires_at > now) / linkedIdentityCount / hasVerifiedIdentity /
 *    providersByType
 *  - Pure actions: setCurrentProvider / clearLoginUrl / reset
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { useSSOStore } from "../sso";
import type { SSOProvider, SSOSession, IdentityMapping } from "../sso";

function provider(
  id: string,
  overrides: Partial<SSOProvider> = {},
): SSOProvider {
  return {
    id,
    provider_type: "oauth",
    provider_name: `Provider ${id}`,
    enabled: true,
    config: "{}",
    created_at: 1700000000000,
    ...overrides,
  };
}

function session(id: string, expires_at: number): SSOSession {
  return {
    id,
    user_did: "did:me",
    provider_id: "p1",
    expires_at,
    created_at: 1700000000000,
  };
}

function mapping(id: string, verified: boolean): IdentityMapping {
  return {
    id,
    did: "did:me",
    provider_id: "p1",
    sso_subject: "sub",
    verified,
    created_at: 1700000000000,
  };
}

describe("useSSOStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty", () => {
      const store = useSSOStore();
      expect(store.providers).toEqual([]);
      expect(store.sessions).toEqual([]);
      expect(store.linkedIdentities).toEqual([]);
      expect(store.currentProvider).toBeNull();
      expect(store.loginUrl).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("enabledProviders + providerCount", () => {
      const store = useSSOStore();
      store.providers = [
        provider("a", { enabled: true }),
        provider("b", { enabled: false }),
        provider("c", { enabled: true }),
      ];
      expect(store.enabledProviders.map((p) => p.id)).toEqual(["a", "c"]);
      expect(store.providerCount).toBe(3);
    });

    it("activeSessionCount counts sessions with expires_at in the future", () => {
      const store = useSSOStore();
      const now = Date.now();
      store.sessions = [
        session("s1", now + 100_000), // active
        session("s2", now - 100_000), // expired
        session("s3", now + 5_000), // active
      ];
      expect(store.activeSessionCount).toBe(2);
    });

    it("linkedIdentityCount + hasVerifiedIdentity", () => {
      const store = useSSOStore();
      expect(store.hasVerifiedIdentity).toBe(false);
      store.linkedIdentities = [mapping("i1", false), mapping("i2", false)];
      expect(store.linkedIdentityCount).toBe(2);
      expect(store.hasVerifiedIdentity).toBe(false);
      store.linkedIdentities = [...store.linkedIdentities, mapping("i3", true)];
      expect(store.hasVerifiedIdentity).toBe(true);
    });

    it("providersByType groups by provider_type", () => {
      const store = useSSOStore();
      store.providers = [
        provider("a", { provider_type: "oauth" }),
        provider("b", { provider_type: "saml" }),
        provider("c", { provider_type: "oauth" }),
        provider("d", { provider_type: "oidc" }),
      ];
      const g = store.providersByType;
      expect(g.oauth.map((p) => p.id)).toEqual(["a", "c"]);
      expect(g.saml.map((p) => p.id)).toEqual(["b"]);
      expect(g.oidc.map((p) => p.id)).toEqual(["d"]);
    });
  });

  // -------------------------------------------------------------------------
  // Pure actions
  // -------------------------------------------------------------------------

  describe("pure actions", () => {
    it("setCurrentProvider sets / clears the current provider", () => {
      const store = useSSOStore();
      const p = provider("x");
      store.setCurrentProvider(p);
      expect(store.currentProvider?.id).toBe("x");
      store.setCurrentProvider(null);
      expect(store.currentProvider).toBeNull();
    });

    it("clearLoginUrl nulls the login url", () => {
      const store = useSSOStore();
      store.loginUrl = "https://idp/login";
      store.clearLoginUrl();
      expect(store.loginUrl).toBeNull();
    });

    it("reset restores initial state", () => {
      const store = useSSOStore();
      store.providers = [provider("a")];
      store.loginUrl = "x";
      store.reset();
      expect(store.providers).toEqual([]);
      expect(store.loginUrl).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // verifyLink (IPC) — regression for the success-path method-name typo
  // -------------------------------------------------------------------------

  describe("verifyLink", () => {
    afterEach(() => {
      delete (window as any).electronAPI;
    });

    it("on success refreshes linked identities without throwing", async () => {
      // Regression: the success branch called this.getLinkedIdentities() which
      // does not exist (the method is fetchLinkedIdentities). That threw a
      // TypeError caught by the catch block, so a SUCCESSFUL verify was
      // surfaced to the UI as a failure and the list never refreshed.
      const invoke = vi.fn(async (channel: string) => {
        if (channel === "sso:verify-link") return { success: true };
        if (channel === "sso:get-linked-identities")
          return { success: true, identities: [mapping("m1", true)] };
        return { success: false };
      });
      (window as any).electronAPI = { invoke };

      const store = useSSOStore();
      const result = await store.verifyLink("link-1");

      expect(result.success).toBe(true);
      expect(store.error).toBeNull();
      // success path must refresh via fetchLinkedIdentities()
      expect(invoke).toHaveBeenCalledWith("sso:get-linked-identities", {
        did: "",
      });
      expect(store.linkedIdentities).toHaveLength(1);
    });
  });
});
