/**
 * shell-preview/widgets/FederationGovernanceWidget — unit tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import FederationGovernanceWidget from "../FederationGovernanceWidget.vue";

const STUBS = {
  "a-button": {
    props: ["type", "block"],
    template: "<button @click=\"$emit('click')\"><slot /></button>",
  },
  "a-empty": {
    props: ["description"],
    template: '<div class="a-empty-stub"><slot />{{ description }}</div>',
  },
  TeamOutlined: { template: "<span />" },
};

describe("FederationGovernanceWidget", () => {
  let originalElectronAPI: unknown;

  beforeEach(() => {
    originalElectronAPI = (globalThis as unknown as { electronAPI?: unknown })
      .electronAPI;
  });

  afterEach(() => {
    (globalThis as unknown as { electronAPI?: unknown }).electronAPI =
      originalElectronAPI;
    vi.restoreAllMocks();
  });

  it("renders empty-state when no federations available", async () => {
    delete (globalThis as unknown as { electronAPI?: unknown }).electronAPI;
    const wrapper = mount(FederationGovernanceWidget, {
      global: { stubs: STUBS },
    });
    await flushPromises();

    const html = wrapper.html();
    expect(html).toContain("联邦治理");
    expect(html).toContain("尚无联邦");
  });

  it("renders federation list from electronAPI", async () => {
    (globalThis as unknown as { electronAPI?: unknown }).electronAPI = {
      mtc: {
        getFederationGovernance: vi.fn().mockResolvedValue({
          federations: [
            {
              fed_id: "fed-test",
              events_count: 5,
              state: {
                federation_id: "fed-test",
                status: "steady",
                threshold: 2,
                members: [
                  { member_id: "alice", status: "active", weight: 1 },
                  { member_id: "bob", status: "active", weight: 1 },
                  { member_id: "carol", status: "candidate", weight: 0.5 },
                ],
                pending_invites: [],
                pending_revokes: [],
                archived_keys: [],
                compromised_keys: [],
              },
            },
          ],
        }),
      },
    };
    const wrapper = mount(FederationGovernanceWidget, {
      global: { stubs: STUBS },
    });
    await flushPromises();

    const html = wrapper.html();
    expect(html).toContain("fed-test");
    expect(html).toContain("steady");
    expect(html).toContain("2 活跃 + 1 候选");
  });

  it("renders dispute badge with danger class", async () => {
    (globalThis as unknown as { electronAPI?: unknown }).electronAPI = {
      mtc: {
        getFederationGovernance: vi.fn().mockResolvedValue({
          federations: [
            {
              fed_id: "fed-d",
              events_count: 1,
              state: {
                federation_id: "fed-d",
                status: "dispute",
                threshold: 1,
                members: [],
              },
            },
          ],
        }),
      },
    };
    const wrapper = mount(FederationGovernanceWidget, {
      global: { stubs: STUBS },
    });
    await flushPromises();
    expect(wrapper.html()).toContain("dispute");
    expect(wrapper.html()).toContain("cc-preview-widget__badge--danger");
  });

  it("shows pending threshold transition arrow", async () => {
    (globalThis as unknown as { electronAPI?: unknown }).electronAPI = {
      mtc: {
        getFederationGovernance: vi.fn().mockResolvedValue({
          federations: [
            {
              fed_id: "f",
              events_count: 2,
              state: {
                federation_id: "f",
                status: "steady",
                threshold: 1,
                pending_threshold: { target: 3 },
                members: [{ member_id: "alice", status: "active", weight: 1 }],
              },
            },
          ],
        }),
      },
    };
    const wrapper = mount(FederationGovernanceWidget, {
      global: { stubs: STUBS },
    });
    await flushPromises();
    expect(wrapper.html()).toMatch(/→\s*3/);
  });

  it("shows compromised key counter when keys leaked", async () => {
    (globalThis as unknown as { electronAPI?: unknown }).electronAPI = {
      mtc: {
        getFederationGovernance: vi.fn().mockResolvedValue({
          federations: [
            {
              fed_id: "f",
              events_count: 3,
              state: {
                federation_id: "f",
                status: "steady",
                threshold: 1,
                members: [{ member_id: "alice", status: "active", weight: 1 }],
                compromised_keys: ["sha256:bad1", "sha256:bad2"],
              },
            },
          ],
        }),
      },
    };
    const wrapper = mount(FederationGovernanceWidget, {
      global: { stubs: STUBS },
    });
    await flushPromises();
    expect(wrapper.html()).toContain("泄漏密钥");
    expect(wrapper.html()).toContain("2");
  });

  it("survives IPC throw", async () => {
    (globalThis as unknown as { electronAPI?: unknown }).electronAPI = {
      mtc: {
        getFederationGovernance: vi
          .fn()
          .mockRejectedValue(new Error("ipc down")),
      },
    };
    const wrapper = mount(FederationGovernanceWidget, {
      global: { stubs: STUBS },
    });
    await flushPromises();
    expect(wrapper.html()).toContain("尚无联邦");
    expect(wrapper.exists()).toBe(true);
  });

  it("opens governance design doc URL", async () => {
    delete (globalThis as unknown as { electronAPI?: unknown }).electronAPI;
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const wrapper = mount(FederationGovernanceWidget, {
      global: { stubs: STUBS },
    });
    await flushPromises();
    const buttons = wrapper.findAll("button");
    await buttons[1].trigger("click");
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining("design.chainlesschain.com"),
      "_blank",
      "noopener",
    );
  });
});
