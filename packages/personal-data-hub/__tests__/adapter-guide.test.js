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
    expect(
      g.methods.some((m) =>
        /3\.x|PyWxDump|手动/.test(m.label + m.steps.join(" ")),
      ),
    ).toBe(true);
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
      expect(primary.label + primary.steps.join(" ")).toMatch(
        /一键|ADB|USB|root/i,
      );
    }
  });

  it("WhatsApp guide documents direct crypt14/crypt15 collection with a user key", () => {
    const g = getAdapterGuide("messaging-whatsapp", "device");
    expect(g.methods[0].recommended).toBe(true);
    expect(g.methods[0].label).toMatch(/crypt15/i);
    expect(g.methods[0].steps.join(" ")).toMatch(/ADB|USB|自动拉取/i);
    expect(g.methods.flatMap((method) => method.steps).join(" ")).toMatch(
      /crypt14.*crypt15|crypt15.*crypt14/i,
    );
    expect(g.summary).toMatch(/本机/);
    expect(g.summary).toMatch(/密钥/);
  });

  it("documents transient cookie collection for every shopping adapter without promising a mobile entry", () => {
    for (const name of [
      "shopping-taobao",
      "shopping-jd",
      "shopping-meituan",
      "shopping-eleme",
      "shopping-pinduoduo",
      "shopping-dianping",
      "shopping-xianyu",
      "shopping-vipshop",
    ]) {
      const guide = getAdapterGuide(name, "shopping");
      const text = [
        guide.summary,
        ...guide.methods.flatMap((method) => [
          method.label,
          ...method.steps,
          method.note || "",
        ]),
      ].join(" ");

      expect(guide.methods[0].recommended).toBe(true);
      expect(text).toContain("schemaVersion 1");
      expect(text).toMatch(/若手机.*已提供.*采集入口/u);
      expect(text).toContain(`sync-adapter ${name}`);
      expect(text).toContain("--cookie-file");
      expect(text).toContain("--account-id");
      expect(text).toMatch(/不持久化|不会写入账号库/u);
      expect(text).toMatch(/非 JSON.*保留旧水位/u);
    }
  });

  it("documents stable snapshot and transient official API paths for 12306", () => {
    const guide = getAdapterGuide("travel-12306", "travel");
    const text = [
      guide.summary,
      ...guide.methods.flatMap((method) => [
        method.label,
        ...method.steps,
        method.note || "",
      ]),
    ].join(" ");

    expect(guide.methods[0].recommended).toBe(true);
    expect(text).toContain("schemaVersion 1");
    expect(text).toContain("kyfw.12306.cn");
    expect(text).toContain("sync-adapter travel-12306");
    expect(text).toContain("--cookie-file");
    expect(text).toContain("--account-id");
    expect(text).toMatch(/表单 POST/u);
    expect(text).toMatch(/不持久化|不写入账号库/u);
    expect(text).toMatch(/保留旧水位/u);
  });

  it("documents snapshot-first and transient cookie collection for Zhihu", () => {
    const guide = getAdapterGuide("social-zhihu", "social");
    const text = [
      guide.summary,
      ...guide.methods.flatMap((method) => [
        method.label,
        ...method.steps,
        method.note || "",
      ]),
    ].join(" ");

    expect(guide.methods[0].recommended).toBe(true);
    expect(text).toContain("schemaVersion 1");
    expect(text).toContain("url_token");
    expect(text).toContain("sync-adapter social-zhihu");
    expect(text).toContain("--cookie-file");
    expect(text).toContain("--account-id");
    expect(text).toContain("x-zse-96");
    expect(text).toMatch(/不持久化|不会写入账号库/u);
    expect(text).toMatch(/保留旧水位/u);
  });

  it("unknown adapter falls back to a category guide without throwing", () => {
    const g = getAdapterGuide("totally-unknown", "snapshot");
    expect(g.category).toBe("snapshot");
    expect(Array.isArray(g.methods)).toBe(true);
    expect(g.methods.length).toBeGreaterThan(0);
  });
});
