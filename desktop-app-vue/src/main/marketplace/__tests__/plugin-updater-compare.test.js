/**
 * compareVersions unit tests — src/main/marketplace/plugin-updater.js
 *
 * 回归点：旧实现 `split('.').map(Number)` 把 "1.0.0-beta" 的 patch 段解析成 NaN，
 * 而 NaN 比较恒为 false → 预发布版被当成与正式版相等，导致装了 1.0.0-beta 的插件
 * 永远收不到 1.0.0 正式版更新（checkUpdates 用 comparison>0 判断）。现按 semver
 * §11：同核心下正式版 > 预发布版。
 */

import { describe, it, expect } from "vitest";

const { compareVersions } = require("../plugin-updater.js");

describe("compareVersions", () => {
  it("compares numeric cores", () => {
    expect(compareVersions("1.0.1", "1.0.0")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });

  it("strips a leading 'v' and treats missing parts as 0", () => {
    expect(compareVersions("v1.2.0", "1.2.0")).toBe(0);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.3", "1.2.9")).toBe(1);
  });

  it("ranks a release above the same-core prerelease (semver §11)", () => {
    // 旧实现两者都返回 0（NaN 比较）→ 漏报更新
    expect(compareVersions("1.0.0", "1.0.0-beta")).toBe(1);
    expect(compareVersions("1.0.0-beta", "1.0.0")).toBe(-1);
  });

  it("orders two prerelease tags, and lets the numeric core dominate", () => {
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.1")).toBe(1);
    expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
    expect(compareVersions("2.0.0-alpha", "1.0.0")).toBe(1); // core 2>1 wins
  });
});
