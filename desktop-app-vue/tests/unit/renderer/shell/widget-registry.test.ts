/**
 * Unit tests — shell/widget-registry.ts
 *
 * 覆盖：组件注册 / 解析 / 覆盖 / 未命中空值。
 */

import { describe, it, expect } from "vitest";
import {
  registerWidgetComponent,
  resolveWidgetComponent,
  listRegisteredWidgets,
} from "@/shell/widget-registry";

describe("shell/widget-registry", () => {
  it("注册后 resolveWidgetComponent 返回同一个组件引用", () => {
    const comp = { name: "W1" };
    registerWidgetComponent("t:w1", comp);
    expect(resolveWidgetComponent("t:w1")).toBe(comp);
  });

  it("未命中返回 null", () => {
    expect(resolveWidgetComponent("t:never-registered")).toBeNull();
  });

  it("id 为空时返回 null，不抛错", () => {
    expect(resolveWidgetComponent(null)).toBeNull();
    expect(resolveWidgetComponent(undefined)).toBeNull();
    expect(resolveWidgetComponent("")).toBeNull();
  });

  it("重复注册覆盖旧组件", () => {
    const a = { name: "A" };
    const b = { name: "B" };
    registerWidgetComponent("t:over", a);
    registerWidgetComponent("t:over", b);
    expect(resolveWidgetComponent("t:over")).toBe(b);
  });

  it("listRegisteredWidgets 包含已注册 id", () => {
    registerWidgetComponent("t:listed", { name: "L" });
    expect(listRegisteredWidgets()).toContain("t:listed");
  });
});
