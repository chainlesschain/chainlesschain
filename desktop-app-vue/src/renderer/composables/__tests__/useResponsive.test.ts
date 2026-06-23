/**
 * useResponsive — getBreakpoint 纯函数单测
 *
 * 回归：旧 breakpoint 实现整体偏移一档（与同文件 deviceType 语义矛盾，
 * 例如 800px 时 deviceType="tablet" 却得 breakpoint="lg"）。
 */
import { describe, it, expect } from "vitest";
import { getBreakpoint, BREAKPOINTS } from "../useResponsive";

describe("getBreakpoint — min-width 语义", () => {
  it("低于 sm 阈值的宽度都是 xs", () => {
    expect(getBreakpoint(0)).toBe("xs");
    expect(getBreakpoint(320)).toBe("xs");
    expect(getBreakpoint(BREAKPOINTS.sm - 1)).toBe("xs"); // 575
  });

  it("每档从其阈值开始（边界值归入该档）", () => {
    expect(getBreakpoint(BREAKPOINTS.sm)).toBe("sm"); // 576
    expect(getBreakpoint(BREAKPOINTS.md)).toBe("md"); // 768
    expect(getBreakpoint(BREAKPOINTS.lg)).toBe("lg"); // 992
    expect(getBreakpoint(BREAKPOINTS.xl)).toBe("xl"); // 1200
    expect(getBreakpoint(BREAKPOINTS.xxl)).toBe("xxl"); // 1600
  });

  it("档位上限前一像素仍属当前档", () => {
    expect(getBreakpoint(BREAKPOINTS.md - 1)).toBe("sm"); // 767
    expect(getBreakpoint(BREAKPOINTS.lg - 1)).toBe("md"); // 991
    expect(getBreakpoint(BREAKPOINTS.xl - 1)).toBe("lg"); // 1199
    expect(getBreakpoint(BREAKPOINTS.xxl - 1)).toBe("xl"); // 1599
  });

  it("平板宽度区间 [md, lg) 应为 md（与 deviceType=tablet 一致，回归点）", () => {
    expect(getBreakpoint(768)).toBe("md");
    expect(getBreakpoint(800)).toBe("md"); // 旧实现错误返回 "lg"
    expect(getBreakpoint(991)).toBe("md");
  });

  it("超大宽度为 xxl", () => {
    expect(getBreakpoint(1600)).toBe("xxl");
    expect(getBreakpoint(3840)).toBe("xxl");
  });
});
