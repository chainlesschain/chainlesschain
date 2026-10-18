import { beforeEach, describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import Panel from "../ProjectGoalExternalDraftsPanel.vue";
const goal = {
  id: "g1",
  storeId: "s1",
  revision: 1,
  controlGeneration: 0,
  status: "active",
};
const grant = {
  id: "grant-1",
  epoch: 1,
  enabled: true,
  savedCount: 1,
  plugin: { name: "drafter", scope: "project", version: "1.0" },
};
const draft = {
  id: "draft-1",
  proposal: { title: "Follow-up", description: "<script>inert</script>" },
};
let api: any;
beforeEach(() => {
  api = {
    listGoalExternalDraftGrants: vi.fn(async () => ({
      entries: [grant],
      nextCursor: null,
    })),
    listGoalExternalDrafts: vi.fn(async () => ({
      entries: [draft],
      nextCursor: null,
      unavailableCount: 0,
    })),
    readGoalExternalDraft: vi.fn(async () => draft),
    prepareGoalExternalDraft: vi.fn(async () => ({ intent: { id: "i1" } })),
    revokeGoalExternalDraftGrant: vi.fn(async () => ({
      ...grant,
      epoch: 2,
      enabled: false,
    })),
  };
  (window as any).electronAPI = { project: api };
});
const create = () =>
  mount(Panel, { props: { goal, identityKey: "actor-1", sourceKey: "r1" } });
async function open(wrapper: any) {
  await flushPromises();
  await wrapper.get('[data-testid="read-external-grant"]').trigger("click");
  await flushPromises();
  await wrapper.get('[data-testid="read-external-draft"]').trigger("click");
  await flushPromises();
}
describe("native online grant and draft management", () => {
  it("reads saved text inertly and prepares only native saved identifiers", async () => {
    const w = create();
    await open(w);
    expect(w.find("script").exists()).toBe(false);
    expect(w.text()).toContain(draft.proposal.description);
    await w.get('[data-testid="prepare-external-draft"]').trigger("click");
    await flushPromises();
    expect(api.prepareGoalExternalDraft).toHaveBeenCalledWith({
      goalRef: { id: "g1", storeId: "s1", revision: 1, controlGeneration: 0 },
      id: "grant-1",
      draftId: "draft-1",
    });
    expect(w.emitted("intent-prepared")).toHaveLength(1);
    w.unmount();
  });
  it("invalidates before an unknown revoke response and clears selected content", async () => {
    const w = create();
    await open(w);
    let reject: any;
    api.revokeGoalExternalDraftGrant.mockImplementation(
      () =>
        new Promise((_, r) => {
          reject = r;
        }),
    );
    await w.get('[data-testid="revoke-external-grant"]').trigger("click");
    expect(w.emitted("extension-invalidated")).toHaveLength(1);
    expect(w.find('[data-testid="external-draft-body"]').exists()).toBe(false);
    reject(new Error("response lost"));
    await flushPromises();
    expect(w.find('[role="alert"]').exists()).toBe(true);
    expect(api.revokeGoalExternalDraftGrant).toHaveBeenCalledWith({
      goalRef: { id: "g1", storeId: "s1", revision: 1, controlGeneration: 0 },
      id: "grant-1",
      expectedEpoch: 1,
    });
    w.unmount();
  });
  it("discards late private reads after identity changes", async () => {
    const w = create();
    await flushPromises();
    await w.get('[data-testid="read-external-grant"]').trigger("click");
    await flushPromises();
    let finish: any;
    api.readGoalExternalDraft.mockImplementation(
      () => new Promise((r) => (finish = r)),
    );
    await w.get('[data-testid="read-external-draft"]').trigger("click");
    await w.setProps({ identityKey: "actor-2" });
    await flushPromises();
    finish(draft);
    await flushPromises();
    expect(w.text()).not.toContain(draft.proposal.description);
    w.unmount();
  });
  it("clears displayed bodies when risk source changes", async () => {
    const w = create();
    await open(w);
    await w.setProps({ sourceKey: "r2" });
    await flushPromises();
    expect(w.find('[data-testid="external-draft-body"]').exists()).toBe(false);
    w.unmount();
  });
  it("invalidates parent preview before failed preparation", async () => {
    const w = create();
    await open(w);
    api.prepareGoalExternalDraft.mockRejectedValue(new Error("source changed"));
    await w.get('[data-testid="prepare-external-draft"]').trigger("click");
    await flushPromises();
    expect(w.emitted("extension-invalidated")?.length).toBeGreaterThan(0);
    expect(w.emitted("intent-prepared")).toBeUndefined();
    expect(w.find('[data-testid="external-draft-body"]').exists()).toBe(false);
    w.unmount();
  });
  it("retains disabled grant history without enabling continuation", async () => {
    api.listGoalExternalDraftGrants.mockResolvedValue({
      entries: [{ ...grant, enabled: false }],
      nextCursor: null,
    });
    const w = create();
    await flushPromises();
    expect(w.text()).toContain("已撤权");
    expect(
      w.get('[data-testid="read-external-grant"]').attributes("disabled"),
    ).toBeDefined();
    w.unmount();
  });
});
