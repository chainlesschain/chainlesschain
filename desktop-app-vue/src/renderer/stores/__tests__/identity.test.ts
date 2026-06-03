/**
 * useIdentityStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: currentIdentity / organizationIdentities /
 *    isOrganizationContext / currentOrgId
 *  - switchContext: unknown-context throw / same-context no-op / success switch
 *  - loadUserOrganizations: builds org_<id> identity contexts from orgs
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { useIdentityStore } from "../identity";

describe("useIdentityStore", () => {
  const mockInvoke = vi.fn();

  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset().mockResolvedValue({ success: true });
    (window as any).ipc = { invoke: mockInvoke };
    // switchContext calls window.location.reload() (unimplemented in jsdom) —
    // replace location with a stub so the success path stays quiet.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: vi.fn() },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("defaults to the personal context", () => {
      const store = useIdentityStore();
      expect(store.primaryDID).toBeNull();
      expect(store.currentContext).toBe("personal");
      expect(store.contexts.personal).toMatchObject({
        type: "personal",
        displayName: "Personal",
      });
      expect(store.organizations).toEqual([]);
      expect(store.loading).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    function seedOrgContext(store: ReturnType<typeof useIdentityStore>) {
      store.contexts = {
        personal: {
          type: "personal",
          displayName: "Personal",
          avatar: "",
          localDB: "data/personal.db",
        },
        org_1: {
          type: "organization",
          displayName: "Me@Org1",
          avatar: "",
          localDB: "data/1.db",
          orgId: "1",
          orgName: "Org1",
        },
      } as any;
    }

    it("currentIdentity returns the active context, falling back to personal", () => {
      const store = useIdentityStore();
      seedOrgContext(store);
      expect(store.currentIdentity.type).toBe("personal"); // default context
      store.currentContext = "org_1";
      expect(store.currentIdentity.orgId).toBe("1");
      // unknown context → personal fallback
      store.currentContext = "missing";
      expect(store.currentIdentity.type).toBe("personal");
    });

    it("organizationIdentities lists only organization contexts", () => {
      const store = useIdentityStore();
      seedOrgContext(store);
      const orgs = store.organizationIdentities;
      expect(orgs).toHaveLength(1);
      expect(orgs[0].orgId).toBe("1");
    });

    it("isOrganizationContext + currentOrgId reflect the active context", () => {
      const store = useIdentityStore();
      seedOrgContext(store);
      expect(store.isOrganizationContext).toBe(false);
      expect(store.currentOrgId).toBeNull();
      store.currentContext = "org_1";
      expect(store.isOrganizationContext).toBe(true);
      expect(store.currentOrgId).toBe("1");
    });
  });

  // -------------------------------------------------------------------------
  // switchContext
  // -------------------------------------------------------------------------

  describe("switchContext", () => {
    function seed(store: ReturnType<typeof useIdentityStore>) {
      store.contexts = {
        personal: {
          type: "personal",
          displayName: "Personal",
          avatar: "",
          localDB: "data/personal.db",
        },
        org_1: {
          type: "organization",
          displayName: "Org1",
          avatar: "",
          localDB: "data/1.db",
          orgId: "1",
        },
      } as any;
    }

    it("throws when the target context does not exist", async () => {
      const store = useIdentityStore();
      seed(store);
      await expect(store.switchContext("nope")).rejects.toThrow(
        /does not exist/,
      );
    });

    it("is a no-op when already in the target context", async () => {
      const store = useIdentityStore();
      seed(store);
      expect(store.currentContext).toBe("personal");
      await store.switchContext("personal");
      expect(mockInvoke).not.toHaveBeenCalled();
      expect(store.currentContext).toBe("personal");
    });

    it("switches currentContext on success", async () => {
      const store = useIdentityStore();
      seed(store);
      await store.switchContext("org_1");
      expect(store.currentContext).toBe("org_1");
    });
  });

  // -------------------------------------------------------------------------
  // loadUserOrganizations
  // -------------------------------------------------------------------------

  describe("loadUserOrganizations", () => {
    it("does nothing without a primary DID", async () => {
      const store = useIdentityStore();
      await store.loadUserOrganizations();
      expect(mockInvoke).not.toHaveBeenCalled();
      expect(store.organizations).toEqual([]);
    });

    it("builds an org_<id> context for each organization", async () => {
      const store = useIdentityStore();
      store.primaryDID = "did:test:user";
      mockInvoke.mockResolvedValueOnce([
        { orgId: "o1", name: "Acme", role: "admin", avatar: "" },
        { orgId: "o2", name: "Globex", role: "member", avatar: "" },
      ]);
      await store.loadUserOrganizations();
      expect(mockInvoke).toHaveBeenCalledWith(
        "org:get-user-organizations",
        "did:test:user",
      );
      expect(store.organizations).toHaveLength(2);
      expect(store.contexts.org_o1).toMatchObject({
        type: "organization",
        orgId: "o1",
        orgName: "Acme",
        role: "admin",
      });
      expect(store.contexts.org_o2?.orgName).toBe("Globex");
      // getter now sees both org contexts
      expect(store.organizationIdentities.map((c) => c.orgId).sort()).toEqual([
        "o1",
        "o2",
      ]);
    });
  });
});
