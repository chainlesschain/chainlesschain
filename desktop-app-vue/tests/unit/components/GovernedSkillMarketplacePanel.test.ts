import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import Panel from "../../../src/renderer/components/skills/GovernedSkillMarketplacePanel.vue";

const D = (letter: string) => `sha256:${letter.repeat(64)}`;
const target = {
  model: "test-target",
  os: "win32-x64",
  runtime: "electron-39",
  tool: "desktop",
};
const candidate = {
  skillName: "safe-refactor",
  version: "2.0.0",
  manifestDigest: D("a"),
  stage: "candidate",
  stateDigest: D("b"),
  revoked: false,
  candidateBinding: { candidateId: D("c") },
};
const inspection = {
  skillName: "safe-refactor",
  version: "2.0.0",
  manifestDigest: D("a"),
  evalBadgeDigest: D("d"),
  qualityScore: 0.9,
  sampleCount: 100,
  state: null,
};
const Button = defineComponent({
  props: ["disabled"],
  emits: ["click"],
  template:
    '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});
const Input = defineComponent({
  props: ["value", "disabled"],
  emits: ["update:value"],
  template:
    '<input :value="value" :disabled="disabled" @input="$emit(\'update:value\', $event.target.value)" />',
});
const Alert = defineComponent({
  props: ["message"],
  template: "<p>{{ message }}</p>",
});
const Box = defineComponent({ template: "<div><slot /></div>" });
let wrapper: VueWrapper;
let invoke: ReturnType<typeof vi.fn>;
let previousAPI: unknown;

async function start() {
  (window as any).electronAPI = { invoke };
  wrapper = mount(Panel, {
    global: {
      stubs: {
        "a-card": Box,
        "a-alert": Alert,
        "a-space": Box,
        "a-input": Input,
        "a-button": Button,
        "a-tag": Box,
        "a-divider": true,
        "a-table": true,
      },
    },
  });
  await flushPromises();
  return wrapper;
}
async function inspect() {
  await wrapper.get('[data-testid="skill-id"]').setValue("safe-refactor");
  await wrapper.get('[data-testid="inspect"]').trigger("click");
  await flushPromises();
}

beforeEach(() => {
  previousAPI = (window as any).electronAPI;
  invoke = vi.fn(async (channel: string) => {
    if (channel === "skill-market:capabilities")
      return { available: true, target };
    if (channel === "skill-market:get-installed") return [];
    if (channel === "skill-market:inspect") return inspection;
    if (channel === "skill-market:install")
      return {
        status: "candidate-staged",
        materialized: true,
        activated: false,
        state: candidate,
      };
    throw new Error(`unexpected channel ${channel}`);
  });
});
afterEach(() => {
  wrapper?.unmount();
  (window as any).electronAPI = previousAPI;
});

describe("governed marketplace panel", () => {
  it("keeps installation unavailable without a signed Desktop host", async () => {
    invoke.mockResolvedValue({ available: false });
    await start();
    expect(wrapper.text()).toContain("尚未配置受信任");
    expect(wrapper.find('[data-testid="stage"]').exists()).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("pins the inspected manifest and reports a candidate, not an active install", async () => {
    await start();
    await inspect();
    await wrapper.get('[data-testid="stage"]').trigger("click");
    await flushPromises();
    expect(invoke).toHaveBeenCalledWith("skill-market:install", {
      skillId: "safe-refactor",
      skillData: {
        version: "2.0.0",
        manifestDigest: D("a"),
        expectedStateDigest: null,
      },
    });
    expect(wrapper.get('[data-testid="notice"]').text()).toContain("尚未启用");
    expect(wrapper.get('[data-testid="current-state"]').text()).toContain(
      "候选已落盘（未启用）",
    );
    expect(
      wrapper.get('[data-testid="rollout"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("allows a new manifest after the previous version was revoked", async () => {
    const normal = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (...args) =>
      args[0] === "skill-market:inspect"
        ? {
            ...inspection,
            state: {
              ...candidate,
              version: "1.0.0",
              manifestDigest: D("f"),
              stage: "rolled-back",
              revoked: true,
            },
          }
        : normal(...args),
    );
    await start();
    await inspect();
    expect(
      wrapper.get('[data-testid="stage"]').attributes("disabled"),
    ).toBeUndefined();
    await wrapper.get('[data-testid="stage"]').trigger("click");
    await flushPromises();
    expect(invoke).toHaveBeenCalledWith("skill-market:install", {
      skillId: "safe-refactor",
      skillData: {
        version: "2.0.0",
        manifestDigest: D("a"),
        expectedStateDigest: D("b"),
      },
    });
    expect(wrapper.get('[data-testid="notice"]').text()).toContain("尚未启用");
  });

  it("refuses legacy database-only success responses", async () => {
    const normal = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (...args) =>
      args[0] === "skill-market:install"
        ? { status: "installed", materialized: false }
        : normal(...args),
    );
    await start();
    await inspect();
    await wrapper.get('[data-testid="stage"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="error"]').text()).toContain(
      "未确认候选文件",
    );
    expect(wrapper.find('[data-testid="notice"]').exists()).toBe(false);
  });

  it("requires a receipt and preserves the exact state digest when advancing", async () => {
    const normal = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (...args) => {
      if (args[0] === "skill-market:inspect")
        return { ...inspection, state: candidate };
      if (args[0] === "skill-market:rollout")
        return { ...candidate, stage: "shadow", stateDigest: D("e") };
      return normal(...args);
    });
    await start();
    await inspect();
    expect(
      wrapper.get('[data-testid="rollout"]').attributes("disabled"),
    ).toBeDefined();
    await wrapper.get('[data-testid="receipt"]').setValue("receipt:pilot");
    await wrapper.get('[data-testid="rollout"]').trigger("click");
    await flushPromises();
    expect(invoke).toHaveBeenCalledWith("skill-market:rollout", {
      skillId: "safe-refactor",
      expectedStateDigest: D("b"),
      receiptRef: "receipt:pilot",
    });
    expect(wrapper.get('[data-testid="current-state"]').text()).toContain(
      "影子验证（未启用）",
    );
    expect(
      (wrapper.get('[data-testid="receipt"]').element as HTMLInputElement)
        .value,
    ).toBe("");
  });

  it("keeps emergency revocation available when candidate listing fails", async () => {
    const normal = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (...args) => {
      if (args[0] === "skill-market:get-installed")
        throw new Error("candidate is corrupt");
      if (args[0] === "skill-market:revoke")
        return {
          ...candidate,
          stage: "rolled-back",
          revoked: true,
          stateDigest: D("e"),
        };
      return normal(...args);
    });
    await start();
    expect(wrapper.get('[data-testid="error"]').text()).toContain("corrupt");
    await wrapper.get('[data-testid="skill-id"]').setValue("safe-refactor");
    await wrapper.get('[data-testid="expected-state"]').setValue(D("b"));
    await wrapper.get('[data-testid="receipt"]').setValue("receipt:revocation");
    await wrapper.get('[data-testid="revoke"]').trigger("click");
    await flushPromises();
    expect(invoke).toHaveBeenCalledWith("skill-market:revoke", {
      skillId: "safe-refactor",
      expectedStateDigest: D("b"),
      receiptRef: "receipt:revocation",
    });
    expect(wrapper.get('[data-testid="notice"]').text()).toContain(
      "撤销已确认",
    );
  });

  it("discards an inspect response after the selected Skill changes", async () => {
    let finish!: (value: unknown) => void;
    const normal = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (...args) =>
      args[0] === "skill-market:inspect"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : normal(...args),
    );
    await start();
    await wrapper.get('[data-testid="skill-id"]').setValue("safe-refactor");
    await wrapper.get('[data-testid="inspect"]').trigger("click");
    // Busy inputs reject DOM edits; simulate a programmatic selection change.
    wrapper
      .findAllComponents(Input)[0]
      .vm.$emit("update:value", "different-skill");
    await nextTick();
    finish(inspection);
    await flushPromises();
    expect(wrapper.find('[data-testid="stage"]').exists()).toBe(false);
    expect(
      invoke.mock.calls.filter(
        ([channel]) => channel === "skill-market:install",
      ),
    ).toHaveLength(0);
  });
});
