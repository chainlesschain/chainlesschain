"use strict";

import { describe, it, expect } from "vitest";

const {
  WeChatKeyProvider,
  WeChatMD5KeyProvider,
} = require("../../lib/adapters/wechat");

describe("WeChatKeyProvider — base contract", () => {
  it("getKey throws on bare base instance (subclass must override)", async () => {
    const base = new WeChatKeyProvider();
    await expect(base.getKey()).rejects.toThrow(/must be overridden/);
  });

  it("name defaults to key-provider-base", () => {
    const base = new WeChatKeyProvider();
    expect(base.name).toBe("key-provider-base");
  });
});

describe("WeChatMD5KeyProvider — construction validation", () => {
  it("throws if opts missing", () => {
    expect(() => new WeChatMD5KeyProvider()).toThrow(/wechatDataPath/);
  });

  it("throws if wechatDataPath missing", () => {
    expect(() => new WeChatMD5KeyProvider({ uin: "1" })).toThrow(/wechatDataPath/);
  });

  it("name returns md5", () => {
    const p = new WeChatMD5KeyProvider({ wechatDataPath: "/tmp/wx" });
    expect(p.name).toBe("md5");
  });
});

describe("WeChatMD5KeyProvider — extractor DI happy path", () => {
  it("getKey returns hex when extractor yields key", async () => {
    const extractor = (opts) => {
      expect(opts.wechatDataPath).toBe("/tmp/wx");
      return {
        uin: "100200300",
        imei: "350123456789012",
        key: "abcdef1",
        source: "test",
        warnings: [],
      };
    };
    const p = new WeChatMD5KeyProvider({
      wechatDataPath: "/tmp/wx",
      extractor,
    });
    const key = await p.getKey();
    expect(key).toBe("abcdef1");
    expect(p.getLastResult().uin).toBe("100200300");
    expect(p.getLastResult().imei).toBe("350123456789012");
  });

  it("getKey passes uin/imei overrides through to extractor", async () => {
    let passedOpts = null;
    const extractor = (opts) => {
      passedOpts = opts;
      return { key: "0000000", uin: opts.uin, imei: opts.imei, warnings: [] };
    };
    const p = new WeChatMD5KeyProvider({
      wechatDataPath: "/tmp/wx",
      uin: "999",
      imei: "deadbeef",
      extractor,
    });
    await p.getKey();
    expect(passedOpts.uin).toBe("999");
    expect(passedOpts.imei).toBe("deadbeef");
  });
});

describe("WeChatMD5KeyProvider — extractor failure surfaces as throw", () => {
  it("throws with warnings when extractor returns no key", async () => {
    const extractor = () => ({
      uin: null,
      imei: null,
      key: null,
      source: "missing",
      warnings: ["UIN not found in shared_prefs", "IMEI not found in CompatibleInfo.cfg"],
    });
    const p = new WeChatMD5KeyProvider({
      wechatDataPath: "/tmp/empty",
      extractor,
    });
    await expect(p.getKey()).rejects.toThrow(/UIN not found/);
  });

  it("throws with generic reason when warnings empty", async () => {
    const extractor = () => ({ key: null, warnings: [] });
    const p = new WeChatMD5KeyProvider({
      wechatDataPath: "/tmp/empty",
      extractor,
    });
    await expect(p.getKey()).rejects.toThrow(/extraction returned empty/);
  });
});
