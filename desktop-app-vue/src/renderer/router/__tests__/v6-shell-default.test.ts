/**
 * V6 壳默认开关 + resolveHomeRedirect 单测
 *
 * 覆盖：
 *  - 默认关闭：/ 保持在 V5 壳（不重定向）
 *  - 开启后：/ 重定向到 /v2
 *  - 开启后：子路由（/settings、/projects 等）仍然放行
 *  - 开启后：/v2/* 和 /v6-preview 自身不被再次重定向
 *  - setV6ShellDefault/isV6ShellDefault 往返一致
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveHomeRedirect,
  setV6ShellDefault,
  isV6ShellDefault,
} from "../v6-shell-default";

describe("v6-shell-default.resolveHomeRedirect", () => {
  it("默认关闭时不重定向根路径", () => {
    expect(
      resolveHomeRedirect({ path: "/" }, { useV6ShellByDefault: false }),
    ).toBeNull();
  });

  it("开启时根路径重定向到 /v2", () => {
    expect(
      resolveHomeRedirect({ path: "/" }, { useV6ShellByDefault: true }),
    ).toBe("/v2");
  });

  it("开启时 V5 子路由仍然放行", () => {
    const subroutes = [
      "/settings",
      "/settings/system",
      "/projects",
      "/projects/new",
      "/knowledge/list",
      "/ai/chat",
      "/did",
      "/community",
    ];
    for (const path of subroutes) {
      expect(
        resolveHomeRedirect({ path }, { useV6ShellByDefault: true }),
      ).toBeNull();
    }
  });

  it("开启时 /v2 和 /v6-preview 自身不会被再次重定向", () => {
    const v6paths = ["/v2", "/v2/workspace", "/v6-preview", "/v6-preview/foo"];
    for (const path of v6paths) {
      expect(
        resolveHomeRedirect({ path }, { useV6ShellByDefault: true }),
      ).toBeNull();
    }
  });

  it("开启时 /login 不会被 V6 守卫重定向", () => {
    expect(
      resolveHomeRedirect({ path: "/login" }, { useV6ShellByDefault: true }),
    ).toBeNull();
  });
});

describe("v6-shell-default.setV6ShellDefault / isV6ShellDefault", () => {
  beforeEach(() => {
    setV6ShellDefault(false);
  });

  it("默认为 false", () => {
    expect(isV6ShellDefault()).toBe(false);
  });

  it("设置 true 后返回 true", () => {
    setV6ShellDefault(true);
    expect(isV6ShellDefault()).toBe(true);
  });

  it("truthy/falsy 值会被强制转成 boolean", () => {
    setV6ShellDefault(1 as unknown as boolean);
    expect(isV6ShellDefault()).toBe(true);
    setV6ShellDefault("" as unknown as boolean);
    expect(isV6ShellDefault()).toBe(false);
    setV6ShellDefault(null as unknown as boolean);
    expect(isV6ShellDefault()).toBe(false);
  });

  it("可以切换回 false", () => {
    setV6ShellDefault(true);
    setV6ShellDefault(false);
    expect(isV6ShellDefault()).toBe(false);
  });
});
