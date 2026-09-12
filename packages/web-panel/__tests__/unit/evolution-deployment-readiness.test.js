import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import {
  deploymentReadinessRows,
  replaceDeploymentStatus,
} from "../../src/utils/evolution-deployment-readiness.js";

const { sendRaw } = vi.hoisted(() => ({ sendRaw: vi.fn() }));
vi.mock("../../src/stores/ws.js", () => ({
  useWsStore: () => ({ waitConnected: async () => {}, sendRaw }),
}));
vi.mock("ant-design-vue", () => ({
  message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock("@ant-design/icons-vue", () => ({
  ReloadOutlined: { template: "<span />" },
}));
import EvolutionSettings from "../../src/views/EvolutionSettings.vue";

function projection(command, state = "admitted") {
  return {
    scope: "deployment-admission",
    state,
    ready: state === "admitted",
    requiredCommands: [command],
    runtimeVerification: "not_checked",
    taskReady: state === "admitted" ? null : false,
    detail: "<script>plain diagnostic</script>",
    remediation: "copy-only instruction",
  };
}

describe("deployment admission display", () => {
  it("does not infer admission from signature, unsupported projections or runtime claims", () => {
    for (const status of [
      { verified: true, commands: ["ask", "agent"] },
      { readiness: { ask: { ...projection("ask"), taskReady: true } } },
      { readiness: { ask: projection("agent") } },
    ]) {
      expect(deploymentReadinessRows(status)[0].state).toBe("unknown");
    }
    for (const state of [
      "not_configured",
      "disabled",
      "invalid",
      "command_not_allowed",
    ]) {
      expect(
        deploymentReadinessRows({
          readiness: { ask: projection("ask", state) },
        })[0],
      ).toMatchObject({ state, summary: "部署准入被阻断" });
    }
  });

  it("replaces stale command diagnostics when the next response is from an older CLI", () => {
    const status = {
      error: "old error",
      readiness: { ask: projection("ask") },
      descriptorPath: "old.json",
    };
    replaceDeploymentStatus(status, { verified: true });
    expect(deploymentReadinessRows(status)[0].state).toBe("unknown");
    expect(status.error).toBeUndefined();
    expect(status.descriptorPath).toBeUndefined();
  });

  it("renders literal diagnostic text, preserves HOLD and clears admitted state after refresh", async () => {
    sendRaw.mockReset();
    sendRaw
      .mockResolvedValueOnce({
        result: {
          readiness: {
            ask: projection("ask"),
            agent: projection("agent", "command_not_allowed"),
          },
        },
      })
      .mockResolvedValueOnce({ result: { verified: true } });
    const tags = [
      "a-button",
      "a-alert",
      "a-row",
      "a-col",
      "a-card",
      "a-form",
      "a-form-item",
      "a-input",
      "a-space",
      "a-descriptions",
      "a-descriptions-item",
      "a-tag",
    ];
    const wrapper = mount(EvolutionSettings, {
      shallow: true,
      global: {
        renderStubDefaultSlot: true,
        stubs: Object.fromEntries(tags.map((tag) => [tag, true])),
      },
    });
    try {
      await flushPromises();
      expect(wrapper.get('[data-admission-command="ask"]').text()).toContain(
        "部署准入通过",
      );
      expect(wrapper.get('[data-admission-command="agent"]').text()).toContain(
        "部署准入被阻断",
      );
      expect(wrapper.text()).toContain("实际任务运行尚未验证");
      expect(wrapper.text()).toContain("HOLD");
      expect(wrapper.text()).toContain("<script>plain diagnostic</script>");
      expect(wrapper.find("script").exists()).toBe(false);
      await wrapper.find("a-button-stub").trigger("click");
      await flushPromises();
      expect(wrapper.get('[data-admission-command="ask"]').text()).toContain(
        "未提供准入诊断",
      );
      expect(wrapper.text()).not.toContain("copy-only instruction");
      expect(sendRaw.mock.calls.map(([frame]) => frame.type)).toEqual([
        "evolution.deployment.status",
        "evolution.deployment.status",
      ]);
    } finally {
      wrapper.unmount();
    }
  });
});
