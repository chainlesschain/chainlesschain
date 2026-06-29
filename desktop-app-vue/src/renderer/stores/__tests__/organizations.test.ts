import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useOrganizationsStore } from "../organizations";

const invoke = vi.fn();

beforeEach(() => {
  setActivePinia(createPinia());
  invoke.mockReset();
  (
    window as unknown as { electronAPI: { invoke: typeof invoke } }
  ).electronAPI = { invoke };
});

function sampleOrg(over: Record<string, unknown> = {}) {
  return {
    org_id: "org-1",
    name: "Acme",
    description: "desc",
    type: "company",
    role: "owner",
    member_count: 3,
    joined_at: 1700000000000,
    ...over,
  };
}

describe("useOrganizationsStore", () => {
  it("initial state", () => {
    const store = useOrganizationsStore();
    expect(store.organizations).toEqual([]);
    expect(store.loading).toBe(false);
    expect(store.creating).toBe(false);
    expect(store.error).toBeNull();
    expect(store.hasLoaded).toBe(false);
  });

  it("loadOrganizations success populates list", async () => {
    invoke.mockResolvedValueOnce({
      success: true,
      organizations: [sampleOrg(), sampleOrg({ org_id: "org-2" })],
    });
    const store = useOrganizationsStore();
    await store.loadOrganizations();
    expect(invoke).toHaveBeenCalledWith("org:get-user-organizations");
    expect(store.organizations).toHaveLength(2);
    expect(store.hasLoaded).toBe(true);
    expect(store.loading).toBe(false);
  });

  it("loadOrganizations failure sets error", async () => {
    invoke.mockResolvedValueOnce({ success: false, error: "nope" });
    const store = useOrganizationsStore();
    await store.loadOrganizations();
    expect(store.error).toBe("nope");
    expect(store.organizations).toEqual([]);
  });

  it("loadOrganizations non-array organizations coerces to []", async () => {
    invoke.mockResolvedValueOnce({ success: true, organizations: null });
    const store = useOrganizationsStore();
    await store.loadOrganizations();
    expect(store.organizations).toEqual([]);
  });

  it("loadOrganizations throw sets error message", async () => {
    invoke.mockRejectedValueOnce(new Error("boom"));
    const store = useOrganizationsStore();
    await store.loadOrganizations();
    expect(store.error).toBe("boom");
    expect(store.loading).toBe(false);
  });

  it("loadAll delegates to loadOrganizations", async () => {
    invoke.mockResolvedValueOnce({
      success: true,
      organizations: [sampleOrg()],
    });
    const store = useOrganizationsStore();
    await store.loadAll();
    expect(invoke).toHaveBeenCalledWith("org:get-user-organizations");
    expect(store.organizations).toHaveLength(1);
  });

  it("createOrganization success returns org + reloads list", async () => {
    invoke
      .mockResolvedValueOnce({ success: true, organization: sampleOrg() })
      .mockResolvedValueOnce({ success: true, organizations: [sampleOrg()] });
    const store = useOrganizationsStore();
    const org = await store.createOrganization({
      name: "Acme",
      type: "company",
      description: "d",
    });
    expect(invoke).toHaveBeenNthCalledWith(1, "org:create-organization", {
      name: "Acme",
      type: "company",
      description: "d",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "org:get-user-organizations");
    expect(org?.org_id).toBe("org-1");
    expect(store.organizations).toHaveLength(1);
    expect(store.creating).toBe(false);
  });

  it("createOrganization failure returns null + sets error", async () => {
    invoke.mockResolvedValueOnce({ success: false, error: "dup" });
    const store = useOrganizationsStore();
    const org = await store.createOrganization({ name: "x", type: "company" });
    expect(org).toBeNull();
    expect(store.error).toBe("dup");
    // no reload on failure
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("createOrganization throw returns null + sets error", async () => {
    invoke.mockRejectedValueOnce(new Error("netfail"));
    const store = useOrganizationsStore();
    const org = await store.createOrganization({ name: "x", type: "company" });
    expect(org).toBeNull();
    expect(store.error).toBe("netfail");
    expect(store.creating).toBe(false);
  });

  it("clearError resets error", async () => {
    invoke.mockResolvedValueOnce({ success: false, error: "e" });
    const store = useOrganizationsStore();
    await store.loadOrganizations();
    expect(store.error).toBe("e");
    store.clearError();
    expect(store.error).toBeNull();
  });
});
