/**
 * useIdentityStore (identityContext) — Pinia store unit tests
 *
 * NB: distinct from identity.ts (store id 'identity'); this is identityStore.ts
 * (store id 'identityContext'), the context-switching store consumed by
 * workspace/task stores.
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: isPersonalContext / isOrganizationContext / currentContextId /
 *    currentOrgId / personalContext / organizationContexts / contextCount /
 *    hasOrganizations
 *  - reset
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { useIdentityStore } from "../identityStore";
import type { IdentityContext } from "../identityStore";

function ctx(
  id: string,
  type: IdentityContext["context_type"],
  overrides: Partial<IdentityContext> = {},
): IdentityContext {
  return {
    context_id: id,
    context_type: type,
    user_did: "did:me",
    display_name: `Ctx ${id}`,
    is_active: 0,
    created_at: 1700000000000,
    ...overrides,
  };
}

describe("useIdentityStore (identityContext)", () => {
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
    it("starts with no active context", () => {
      const store = useIdentityStore();
      expect(store.activeContext).toBeNull();
      expect(store.contexts).toEqual([]);
      expect(store.currentUserDID).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.switching).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Active-context getters
  // -------------------------------------------------------------------------

  describe("active-context getters", () => {
    it("isPersonalContext / isOrganizationContext follow activeContext type", () => {
      const store = useIdentityStore();
      expect(store.isPersonalContext).toBe(false);
      expect(store.isOrganizationContext).toBe(false);
      store.activeContext = ctx("p", "personal");
      expect(store.isPersonalContext).toBe(true);
      expect(store.isOrganizationContext).toBe(false);
      store.activeContext = ctx("o", "organization", { org_id: "org1" });
      expect(store.isPersonalContext).toBe(false);
      expect(store.isOrganizationContext).toBe(true);
    });

    it("currentContextId / currentOrgId read the active context", () => {
      const store = useIdentityStore();
      expect(store.currentContextId).toBeUndefined();
      expect(store.currentOrgId).toBeUndefined();
      store.activeContext = ctx("o", "organization", { org_id: "org1" });
      expect(store.currentContextId).toBe("o");
      expect(store.currentOrgId).toBe("org1");
    });
  });

  // -------------------------------------------------------------------------
  // Collection getters
  // -------------------------------------------------------------------------

  describe("collection getters", () => {
    function seed(store: ReturnType<typeof useIdentityStore>) {
      store.contexts = [
        ctx("p", "personal"),
        ctx("o1", "organization", { org_id: "org1" }),
        ctx("o2", "organization", { org_id: "org2" }),
      ];
    }

    it("personalContext finds the personal context", () => {
      const store = useIdentityStore();
      seed(store);
      expect(store.personalContext?.context_id).toBe("p");
    });

    it("organizationContexts filters organization contexts", () => {
      const store = useIdentityStore();
      seed(store);
      expect(store.organizationContexts.map((c) => c.context_id)).toEqual([
        "o1",
        "o2",
      ]);
    });

    it("contextCount + hasOrganizations", () => {
      const store = useIdentityStore();
      expect(store.contextCount).toBe(0);
      expect(store.hasOrganizations).toBe(false);
      seed(store);
      expect(store.contextCount).toBe(3);
      expect(store.hasOrganizations).toBe(true);
    });

    it("hasOrganizations is false with only a personal context", () => {
      const store = useIdentityStore();
      store.contexts = [ctx("p", "personal")];
      expect(store.hasOrganizations).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // reset
  // -------------------------------------------------------------------------

  describe("reset", () => {
    it("clears active context, contexts and user DID", () => {
      const store = useIdentityStore();
      store.activeContext = ctx("p", "personal");
      store.contexts = [ctx("p", "personal")];
      store.currentUserDID = "did:me";
      store.loading = true;
      store.reset();
      expect(store.activeContext).toBeNull();
      expect(store.contexts).toEqual([]);
      expect(store.currentUserDID).toBeNull();
      expect(store.loading).toBe(false);
    });
  });
});
