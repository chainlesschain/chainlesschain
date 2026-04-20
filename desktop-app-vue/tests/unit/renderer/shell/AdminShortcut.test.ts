/**
 * Unit test — shell/widgets/AdminShortcut.vue
 *
 * 确认点击按钮会 dispatch 对应 slash handler id。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import AdminShortcut from "@/shell/widgets/AdminShortcut.vue";
import {
  registerSlashHandler,
  listRegisteredHandlers,
} from "@/shell/slash-dispatch";

describe("AdminShortcut.vue", () => {
  beforeEach(() => {
    for (const id of listRegisteredHandlers()) {
      registerSlashHandler(id, () => {})();
    }
  });

  it("点击时触发 builtin:openAdminConsole handler", async () => {
    const handler = vi.fn();
    registerSlashHandler("builtin:openAdminConsole", handler);

    const wrapper = mount(AdminShortcut, {
      global: { stubs: { "a-tooltip": { template: "<div><slot /></div>" } } },
    });

    await wrapper.find(".admin-shortcut").trigger("click");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ trigger: "admin", args: "" });
  });

  it("Enter 键同样触发 handler", async () => {
    const handler = vi.fn();
    registerSlashHandler("builtin:openAdminConsole", handler);

    const wrapper = mount(AdminShortcut, {
      global: { stubs: { "a-tooltip": { template: "<div><slot /></div>" } } },
    });

    await wrapper.find(".admin-shortcut").trigger("keydown.enter");
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
