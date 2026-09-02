// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import GraphRunDebugger from "../GraphRunDebugger.vue";

const REVISION = `sha256:${"a".repeat(64)}`;
const OPERATION = `sha256:${"b".repeat(64)}`;
const POLICY = `sha256:${"c".repeat(64)}`;

function graph() {
  return {
    runId: "run-human-review",
    status: "waiting_human",
    taskGraph: {
      nodes: [
        {
          id: "review",
          title: "Release review",
          status: "waiting_human",
          dependsOn: [],
        },
      ],
      edges: [],
    },
    attempts: [],
    effects: [],
    timeline: [],
  };
}

function humanTask() {
  return {
    id: "human-task-1",
    runId: "run-human-review",
    nodeId: "review",
    status: "open",
    revisionDigest: REVISION,
    operationDigest: OPERATION,
    nonce: "nonce-1",
    operation: { prompt: "Publish exact SHA 0123456789" },
    quorum: 2,
    separationOfDuties: true,
    decisions: [
      {
        actorId: "did:chainless:reviewer-1",
        decision: { kind: "acceptOnce" },
      },
    ],
    expiresAt: "2026-08-30T00:00:00.000Z",
  };
}

function approval() {
  return {
    id: "approval-1",
    binding: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      operationDigest: OPERATION,
      policyDigest: POLICY,
      nonce: "approval-nonce-1",
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
    operation: { tool: "write_file", path: "README.md" },
    risk: "medium",
    reason: "Write the reviewed file",
    requestedPermissions: [
      { capability: "workspace.write", scope: "README.md" },
    ],
  };
}

describe("GraphRunDebugger HumanTask review", () => {
  afterEach(() => {
    delete (window as any).electronAPI;
  });

  it("reviews the exact operation and submits no renderer-controlled actor", async () => {
    let notify = (_task: unknown) => {};
    let notifySettled = (_settlement: unknown) => {};
    const decide = vi.fn().mockResolvedValue({
      success: true,
      result: {
        accepted: true,
        humanTaskId: "human-task-1",
        actorId: "did:chainless:reviewer-2",
      },
    });
    (window as any).electronAPI = {
      codingAgent: {
        appServerHumanTaskList: vi
          .fn()
          .mockResolvedValue({ success: true, result: [humanTask()] }),
        appServerHumanTaskDecide: decide,
        onAppServerHumanTask: vi.fn((callback) => {
          notify = callback;
          return vi.fn();
        }),
        onAppServerHumanTaskSettled: vi.fn((callback) => {
          notifySettled = callback;
          return vi.fn();
        }),
      },
    };
    const wrapper = mount(GraphRunDebugger, {
      props: { graph: graph(), events: [] },
    });
    await flushPromises();

    expect(
      wrapper.get('[data-testid="graph-human-task-review"]').text(),
    ).toContain("1/2 approvals");
    expect(wrapper.text()).toContain("Publish exact SHA 0123456789");
    const approve = wrapper
      .findAll("button")
      .find((button) => button.text() === "Approve exact operation");
    await approve!.trigger("click");
    await flushPromises();

    expect(decide).toHaveBeenCalledWith({
      humanTaskId: "human-task-1",
      runId: "run-human-review",
      revisionDigest: REVISION,
      operationDigest: OPERATION,
      nonce: "nonce-1",
      decision: { kind: "acceptOnce" },
    });
    expect(decide.mock.calls[0][0]).not.toHaveProperty("actorId");
    expect(
      wrapper.find('[data-testid="graph-human-task-review"]').exists(),
    ).toBe(false);

    notify({
      ...humanTask(),
      decisions: [
        ...humanTask().decisions,
        {
          actorId: "did:chainless:reviewer-2",
          decision: { kind: "acceptOnce" },
        },
      ],
    });
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("2/2 approvals");
    notifySettled({ humanTaskId: "human-task-1" });
    await wrapper.vm.$nextTick();
    expect(
      wrapper.find('[data-testid="graph-human-task-review"]').exists(),
    ).toBe(false);
  });

  it("keeps the card actionable when main rejects a repeated reviewer", async () => {
    (window as any).electronAPI = {
      codingAgent: {
        appServerHumanTaskList: vi
          .fn()
          .mockResolvedValue({ success: true, result: [humanTask()] }),
        appServerHumanTaskDecide: vi.fn().mockResolvedValue({
          success: false,
          error: "This HumanTask requires a different authenticated reviewer",
        }),
        onAppServerHumanTask: vi.fn(() => vi.fn()),
        onAppServerHumanTaskSettled: vi.fn(() => vi.fn()),
      },
    };
    const wrapper = mount(GraphRunDebugger, {
      props: { graph: graph(), events: [] },
    });
    await flushPromises();
    const approve = wrapper
      .findAll("button")
      .find((button) => button.text() === "Approve exact operation");
    await approve!.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("different authenticated reviewer");
    expect(
      wrapper.find('[data-testid="graph-human-task-review"]').exists(),
    ).toBe(true);
  });

  it("reviews an App Server tool approval with the exact canonical binding", async () => {
    let notifySettled = (_settlement: unknown) => {};
    const decide = vi.fn().mockResolvedValue({
      success: true,
      result: {
        accepted: true,
        requestId: "approval-1",
        actorId: "did:chainless:reviewer-2",
      },
    });
    (window as any).electronAPI = {
      codingAgent: {
        appServerApprovalList: vi
          .fn()
          .mockResolvedValue({ success: true, result: [approval()] }),
        appServerApprovalDecide: decide,
        onAppServerApproval: vi.fn(() => vi.fn()),
        onAppServerApprovalSettled: vi.fn((callback) => {
          notifySettled = callback;
          return vi.fn();
        }),
      },
    };
    const wrapper = mount(GraphRunDebugger, {
      props: { graph: graph(), events: [] },
    });
    await flushPromises();

    const panel = wrapper.get('[data-testid="app-server-approval-review"]');
    expect(panel.text()).toContain("Write the reviewed file");
    expect(panel.text()).toContain("README.md");
    const approveForTurn = wrapper
      .findAll("button")
      .find((button) => button.text() === "Approve for turn");
    await approveForTurn!.trigger("click");
    await flushPromises();

    expect(decide).toHaveBeenCalledWith({
      requestId: "approval-1",
      binding: approval().binding,
      decision: {
        kind: "acceptForTurn",
        permissions: approval().requestedPermissions,
      },
    });
    expect(decide.mock.calls[0][0]).not.toHaveProperty("actorId");
    expect(
      wrapper.find('[data-testid="app-server-approval-review"]').exists(),
    ).toBe(false);

    notifySettled({ requestId: "approval-1" });
    await wrapper.vm.$nextTick();
    expect(
      wrapper.find('[data-testid="app-server-approval-review"]').exists(),
    ).toBe(false);
  });
});
