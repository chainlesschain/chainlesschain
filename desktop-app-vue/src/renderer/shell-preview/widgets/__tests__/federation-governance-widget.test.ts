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

  it("renders ALL pending_thresholds[] when multiple concurrent proposals exist (v0.10)", async () => {
    (globalThis as unknown as { electronAPI?: unknown }).electronAPI = {
      mtc: {
        getFederationGovernance: vi.fn().mockResolvedValue({
          federations: [
            {
              fed_id: "fed-multi",
              events_count: 4,
              state: {
                federation_id: "fed-multi",
                status: "steady",
                threshold: 2,
                // v0.10 shape: list of all open propose-threshold events
                pending_thresholds: [
                  {
                    target: 3,
                    event_id: "ev-prop-a",
                    proposer: "alice",
                    proposed_at: "2026-05-02T00:00:00Z",
                  },
                  {
                    target: 4,
                    event_id: "ev-prop-b",
                    proposer: "bob",
                    proposed_at: "2026-05-02T00:01:00Z",
                  },
                ],
                // back-compat field still present (most-recent slot)
                pending_threshold: {
                  target: 4,
                  event_id: "ev-prop-b",
                  proposer: "bob",
                },
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
    const html = wrapper.html();
    // Both proposed targets render as separate arrows
    expect(html).toMatch(/→\s*3/);
    expect(html).toMatch(/→\s*4/);
  });

  it("falls back to pending_threshold (single) when pending_thresholds[] is absent (pre-v0.10 back-compat)", async () => {
    (globalThis as unknown as { electronAPI?: unknown }).electronAPI = {
      mtc: {
        getFederationGovernance: vi.fn().mockResolvedValue({
          federations: [
            {
              fed_id: "fed-old",
              events_count: 2,
              state: {
                federation_id: "fed-old",
                status: "steady",
                threshold: 1,
                pending_threshold: { target: 5 }, // old shape: no event_id
                // pending_thresholds intentionally omitted
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
    expect(wrapper.html()).toMatch(/→\s*5/);
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

  it("renders live sync stats sub-panel when getFederationSyncStats provides data (v0.10)", async () => {
    (globalThis as unknown as { electronAPI?: unknown }).electronAPI = {
      mtc: {
        getFederationGovernance: vi.fn().mockResolvedValue({
          federations: [
            {
              fed_id: "fed-live",
              events_count: 4,
              state: {
                federation_id: "fed-live",
                status: "steady",
                threshold: 2,
                members: [{ member_id: "alice", status: "active", weight: 1 }],
              },
            },
          ],
        }),
        getFederationSyncStats: vi.fn().mockResolvedValue({
          federations: [
            {
              fed_id: "fed-live",
              available: true,
              mode: "filesystem",
              last_tick_at: new Date(Date.now() - 30_000).toISOString(),
              publish: { last_published: 2, total_published: 17 },
              pull: {
                last_appended: 1,
                total_appended: 5,
                last_invalid: 0,
                last_unknown: 0,
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
    expect(html).toContain("Sync");
    expect(html).toContain("filesystem");
    expect(html).toContain("Publish");
    expect(html).toContain("17"); // total_published
    expect(html).toContain("Pull");
    expect(html).toContain("5"); // total_appended
    expect(html).toMatch(/s 前|min 前/); // relative age
  });

  it("renders libp2p wire counters when daemon mode = libp2p (v0.10)", async () => {
    (globalThis as unknown as { electronAPI?: unknown }).electronAPI = {
      mtc: {
        getFederationGovernance: vi.fn().mockResolvedValue({
          federations: [
            {
              fed_id: "fed-libp2p",
              events_count: 1,
              state: {
                federation_id: "fed-libp2p",
                status: "steady",
                threshold: 1,
                members: [{ member_id: "alice", status: "active", weight: 1 }],
              },
            },
          ],
        }),
        getFederationSyncStats: vi.fn().mockResolvedValue({
          federations: [
            {
              fed_id: "fed-libp2p",
              available: true,
              mode: "libp2p",
              last_tick_at: new Date().toISOString(),
              publish: { last_published: 0, total_published: 3 },
              libp2p: { wire_received: 4, wire_appended: 2 },
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
    expect(html).toContain("libp2p");
    expect(html).toContain("recv");
    expect(html).toContain("4"); // wire_received
  });

  it("hides sync sub-panel when getFederationSyncStats missing or returns no entries", async () => {
    (globalThis as unknown as { electronAPI?: unknown }).electronAPI = {
      mtc: {
        getFederationGovernance: vi.fn().mockResolvedValue({
          federations: [
            {
              fed_id: "fed-nostats",
              events_count: 1,
              state: {
                federation_id: "fed-nostats",
                status: "steady",
                threshold: 1,
                members: [{ member_id: "alice", status: "active", weight: 1 }],
              },
            },
          ],
        }),
        // getFederationSyncStats deliberately omitted
      },
    };
    const wrapper = mount(FederationGovernanceWidget, {
      global: { stubs: STUBS },
    });
    await flushPromises();
    const html = wrapper.html();
    expect(html).toContain("fed-nostats");
    expect(html).not.toContain("Sync ·"); // sub-panel header signature
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
