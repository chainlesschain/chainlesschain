import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PdhOAuthCollectorDrawer from "../../src/components/PdhOAuthCollectorDrawer.vue";

const inputStub = {
  inheritAttrs: false,
  props: ["value", "placeholder"],
  emits: ["update:value"],
  template:
    '<input :data-field="$attrs[\'data-field\']" :value="value" :placeholder="placeholder" @input="$emit(\'update:value\', $event.target.value)" />',
};

const stubs = {
  "a-drawer": {
    props: ["open", "title"],
    emits: ["close"],
    template:
      '<div v-if="open" class="drawer"><h2>{{ title }}</h2><slot /><div class="footer"><slot name="footer" /></div></div>',
  },
  "a-alert": {
    props: ["message", "description"],
    template:
      '<div class="alert"><span>{{ message }}</span><span>{{ description }}</span></div>',
  },
  "a-form": { template: "<form><slot /></form>" },
  "a-form-item": {
    props: ["label"],
    template: "<label>{{ label }}<slot /></label>",
  },
  "a-input": inputStub,
  "a-input-password": inputStub,
  "a-checkbox": {
    props: ["checked"],
    emits: ["update:checked"],
    template:
      '<label><input type="checkbox" :checked="checked" @change="$emit(\'update:checked\', $event.target.checked)" /><slot /></label>',
  },
  "a-empty": {
    props: ["description"],
    template: '<div class="empty">{{ description }}</div>',
  },
  "a-space": { template: "<div><slot /></div>" },
  "a-button": {
    props: ["disabled"],
    emits: ["click"],
    template:
      '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
  },
};

function source(name) {
  return {
    name,
    capabilities: ["sync:snapshot", "sync:oauth-api"],
  };
}

function render(name) {
  return mount(PdhOAuthCollectorDrawer, {
    props: { open: true, source: source(name) },
    global: { stubs },
  });
}

function field(wrapper, key) {
  return wrapper.find(`input[data-field="${key}"]`);
}

function submitButton(wrapper) {
  return wrapper
    .findAll("button")
    .find((button) => button.text().includes("开始采集"));
}

describe("PdhOAuthCollectorDrawer", () => {
  it("collects Baidu Netdisk with transient, validated OAuth inputs", async () => {
    const wrapper = render("doc-baidu-netdisk");
    expect(wrapper.text()).toContain("凭据仅用于本次官方 API 采集");
    expect(submitButton(wrapper).element.disabled).toBe(true);

    await field(wrapper, "accessToken").setValue("runtime-token");
    await field(wrapper, "accountId").setValue("account-a");
    await field(wrapper, "dir").setValue("/apps/chainlesschain");
    expect(submitButton(wrapper).element.disabled).toBe(false);

    await submitButton(wrapper).trigger("click");

    expect(wrapper.emitted("collect")).toEqual([
      [
        {
          name: "doc-baidu-netdisk",
          options: {
            accessToken: "runtime-token",
            accountId: "account-a",
            dir: "/apps/chainlesschain",
            recursive: true,
          },
        },
      ],
    ]);
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
    expect(field(wrapper, "accessToken").element.value).toBe("");
    expect(field(wrapper, "accountId").element.value).toBe("");
    expect(field(wrapper, "dir").element.value).toBe("");
  });

  it("requires WPS drive identity and a complete optional KSO-1 pair", async () => {
    const wrapper = render("doc-wps");
    await field(wrapper, "accessToken").setValue("wps-token");
    await field(wrapper, "accountId").setValue("account-a");
    await field(wrapper, "driveId").setValue("drive-1");
    expect(submitButton(wrapper).element.disabled).toBe(false);

    await field(wrapper, "appId").setValue("app-1");
    expect(submitButton(wrapper).element.disabled).toBe(true);
    await field(wrapper, "appKey").setValue("app-secret");
    expect(submitButton(wrapper).element.disabled).toBe(false);

    await submitButton(wrapper).trigger("click");
    expect(wrapper.emitted("collect")[0][0]).toEqual({
      name: "doc-wps",
      options: {
        accessToken: "wps-token",
        accountId: "account-a",
        driveId: "drive-1",
        parentId: "0",
        recursive: true,
        appId: "app-1",
        appKey: "app-secret",
      },
    });
  });

  it("does not render a credential form for an unrecognized OAuth adapter", () => {
    const wrapper = render("unknown-oauth-source");
    expect(wrapper.find(".empty").exists()).toBe(true);
    expect(submitButton(wrapper).element.disabled).toBe(true);
    expect(wrapper.emitted("collect")).toBeUndefined();
  });
});
