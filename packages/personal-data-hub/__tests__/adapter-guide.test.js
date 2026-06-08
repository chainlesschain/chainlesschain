"use strict";

import { describe, it, expect } from "vitest";

const { getAdapterGuide, ADAPTER_OVERRIDES } = require("../lib/adapter-guide");

describe("adapter-guide", () => {
  it("wechat-pc guide reflects the 4.0 one-click reality (no manual PyWxDump as primary)", () => {
    const g = getAdapterGuide("wechat-pc", "device");
    // primary method is the automatic one-click, not manual decryption
    const primary = g.methods[0];
    expect(primary.recommended).toBe(true);
    expect(primary.label).toMatch(/一键|自动/);
    expect(primary.steps.join(" ")).toMatch(/一键采集|自动/);
    // summary mentions the full coverage we now capture
    expect(g.summary).toMatch(/公众号/);
    expect(g.summary).toMatch(/朋友圈/);
    expect(g.summary).toMatch(/收藏/);
    // manual 3.x path is still offered as a fallback
    expect(g.methods.some((m) => /3\.x|PyWxDump|手动/.test(m.label + m.steps.join(" ")))).toBe(true);
  });

  it("the 6 social platforms all have a tailored one-click ADB guide", () => {
    for (const name of [
      "social-bilibili",
      "social-weibo",
      "social-douyin",
      "social-xiaohongshu",
      "social-toutiao",
      "social-kuaishou",
    ]) {
      expect(ADAPTER_OVERRIDES[name]).toBeTruthy();
      const g = getAdapterGuide(name, "device");
      const primary = g.methods[0];
      expect(primary.recommended).toBe(true);
      // recommended path is root-phone + one-click, not "go log in on the web"
      expect(primary.label + primary.steps.join(" ")).toMatch(/一键|ADB|USB|root/i);
    }
  });

  it("unknown adapter falls back to a category guide without throwing", () => {
    const g = getAdapterGuide("totally-unknown", "snapshot");
    expect(g.category).toBe("snapshot");
    expect(Array.isArray(g.methods)).toBe(true);
    expect(g.methods.length).toBeGreaterThan(0);
  });
});
