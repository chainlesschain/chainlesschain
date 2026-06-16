/**
 * useKeyboardShortcuts 测试 — src/renderer/composables/useKeyboardShortcuts.ts
 *
 * register/unregister + the global keydown matcher (modifier checks, input-
 * field guard, cmd↔ctrl normalization). The listener attaches on mount, so a
 * host component is mounted to wire it up.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";

vi.mock("ant-design-vue", () => ({ message: { info: vi.fn() }, Modal: {} }));

import {
  useKeyboardShortcuts,
  registerShortcut,
  unregisterShortcut,
} from "@/composables/useKeyboardShortcuts";

const Host = defineComponent({
  setup() {
    useKeyboardShortcuts();
    return () => h("div");
  },
});

let wrapper: any;
const registered: string[] = [];
function reg(key: string, handler: any, opts?: any) {
  registerShortcut(key, handler, opts);
  registered.push(key);
}

beforeEach(() => {
  wrapper = mount(Host);
});
afterEach(() => {
  registered.splice(0).forEach((k) => unregisterShortcut(k));
  wrapper?.unmount();
});

function press(opts: KeyboardEventInit, target: EventTarget = document.body) {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, ...opts }),
  );
}

describe("useKeyboardShortcuts", () => {
  it("fires the handler on a matching combo and preventDefaults", () => {
    const handler = vi.fn();
    reg("ctrl+k", handler);
    const ev = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(ev);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("does not fire when a required modifier is missing", () => {
    const handler = vi.fn();
    reg("ctrl+j", handler);
    press({ key: "j" }); // no ctrl
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not fire after unregister", () => {
    const handler = vi.fn();
    reg("ctrl+u", handler);
    unregisterShortcut("ctrl+u");
    registered.length = 0;
    press({ key: "u", ctrlKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores non-global shortcuts fired from an input, but honours global ones", () => {
    const nonGlobal = vi.fn();
    const global = vi.fn();
    reg("ctrl+e", nonGlobal);
    reg("ctrl+g", global, { global: true });
    const input = document.createElement("input");
    document.body.appendChild(input);
    press({ key: "e", ctrlKey: true }, input);
    press({ key: "g", ctrlKey: true }, input);
    expect(nonGlobal).not.toHaveBeenCalled();
    expect(global).toHaveBeenCalledTimes(1);
    input.remove();
  });

  it("normalizes cmd→ctrl on non-mac (a ctrl event matches a cmd shortcut)", () => {
    const handler = vi.fn();
    reg("cmd+s", handler);
    press({ key: "s", ctrlKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
