/**
 * Phase 6a — ElectronWebSignBridge + XhsSignBridge unit cover.
 *
 * We don't spawn a real Electron WebContentsView (would need an
 * integration-test harness — recommended for Phase 6c真机 verification).
 * Instead we inject a mocked `electron` module via `opts.electron` and
 * verify the bridge's lifecycle + JS build + header parsing.
 */

import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const { ElectronWebSignBridge, _internals } = require_(
  "../electron-web-sign-bridge.js",
);
const { XhsSignBridge, _internals: xhsInternals } = require_(
  "../xhs-sign-bridge.js",
);
const { ToutiaoSignBridge, _internals: toutiaoInternals } = require_(
  "../toutiao-sign-bridge.js",
);

// ─── parseCookieHeader ──────────────────────────────────────────────────

describe("parseCookieHeader", () => {
  it("parses canonical Cookie header", () => {
    const r = _internals.parseCookieHeader("a=1; b=2; c=value with spaces");
    expect(r).toEqual([
      { name: "a", value: "1" },
      { name: "b", value: "2" },
      { name: "c", value: "value with spaces" },
    ]);
  });

  it("tolerates extra whitespace", () => {
    const r = _internals.parseCookieHeader("  a=1  ;   b=2  ");
    expect(r).toEqual([
      { name: "a", value: "1" },
      { name: "b", value: "2" },
    ]);
  });

  it("skips malformed entries", () => {
    const r = _internals.parseCookieHeader("a=1; nokey; b=2");
    expect(r).toEqual([
      { name: "a", value: "1" },
      { name: "b", value: "2" },
    ]);
  });

  it("handles empty / non-string", () => {
    expect(_internals.parseCookieHeader("")).toEqual([]);
    expect(_internals.parseCookieHeader(null)).toEqual([]);
    expect(_internals.parseCookieHeader(undefined)).toEqual([]);
  });

  it("preserves = in cookie values", () => {
    const r = _internals.parseCookieHeader("a1=base64==; b=value=with=equals");
    expect(r).toEqual([
      { name: "a1", value: "base64==" },
      { name: "b", value: "value=with=equals" },
    ]);
  });
});

// ─── withTimeout ────────────────────────────────────────────────────────

describe("withTimeout", () => {
  it("resolves when promise resolves before timeout", async () => {
    const result = await _internals.withTimeout(
      Promise.resolve("ok"),
      1000,
      "test",
    );
    expect(result).toBe("ok");
  });

  it("rejects with tag on timeout", async () => {
    const slow = new Promise((r) => setTimeout(() => r("late"), 200));
    await expect(_internals.withTimeout(slow, 50, "test")).rejects.toThrow(
      /test timeout after 50ms/,
    );
  });
});

// ─── ElectronWebSignBridge abstract ─────────────────────────────────────

describe("ElectronWebSignBridge — abstract enforcement", () => {
  it("throws when subclass doesn't override homepageUrl", () => {
    const b = new ElectronWebSignBridge({ electron: {} });
    expect(() => b.homepageUrl).toThrow(/subclass must override homepageUrl/);
  });

  it("throws when subclass doesn't override cookieDomain", () => {
    const b = new ElectronWebSignBridge({ electron: {} });
    expect(() => b.cookieDomain).toThrow(/subclass must override cookieDomain/);
  });

  it("throws when subclass doesn't override buildSignScript", () => {
    const b = new ElectronWebSignBridge({ electron: {} });
    expect(() => b.buildSignScript("u", "p")).toThrow(
      /subclass must override buildSignScript/,
    );
  });

  it("base signUrl / signedHeaders default to null / {}", async () => {
    const b = new ElectronWebSignBridge({ electron: {} });
    expect(await b.signUrl("u", "p")).toBe(null);
    expect(await b.signedHeaders("u", "p")).toEqual({});
  });

  it("warmUp without electron throws clear error", async () => {
    const b = new ElectronWebSignBridge({ electron: null });
    await expect(b.warmUp("c=1")).rejects.toThrow(
      /electron module not available/,
    );
  });

  it("warmUp without WebContentsView throws clear error", async () => {
    const b = new ElectronWebSignBridge({ electron: {} });
    await expect(b.warmUp("c=1")).rejects.toThrow(/Electron 32\+/);
  });

  it("shutdown is idempotent (safe to call when never warmed)", async () => {
    const b = new ElectronWebSignBridge({ electron: {} });
    await expect(b.shutdown()).resolves.toBeUndefined();
    await expect(b.shutdown()).resolves.toBeUndefined(); // second call OK
  });
});

// ─── ElectronWebSignBridge lifecycle (mocked electron) ──────────────────

function makeMockElectron({ loadDelay = 0, jsResult = null } = {}) {
  const cookieSets = [];
  const navigationCalls = [];
  const evalCalls = [];

  const fakeWebContents = {
    once: vi.fn((event, handler) => {
      if (event === "did-finish-load") {
        setTimeout(() => handler(), loadDelay);
      }
      // ignore did-fail-load for happy-path mock
    }),
    off: vi.fn(),
    loadURL: vi.fn(async (url) => {
      navigationCalls.push(url);
    }),
    executeJavaScript: vi.fn(async (script, _userGesture) => {
      evalCalls.push(script);
      return jsResult;
    }),
    destroy: vi.fn(),
  };

  const FakeWebContentsView = vi.fn(function () {
    return { webContents: fakeWebContents };
  });

  return {
    electron: {
      WebContentsView: FakeWebContentsView,
      session: {
        defaultSession: {
          cookies: {
            set: vi.fn(async (cookie) => {
              cookieSets.push(cookie);
            }),
          },
        },
      },
    },
    cookieSets,
    navigationCalls,
    evalCalls,
    fakeWebContents,
  };
}

class FakeBridge extends ElectronWebSignBridge {
  get homepageUrl() {
    return "https://example.com";
  }
  get cookieDomain() {
    return ".example.com";
  }
  get postLoadDelayMs() {
    return 0; // skip grace period in tests
  }
  buildSignScript(rawUrl, purpose) {
    return `__test_script(${JSON.stringify(rawUrl)},${JSON.stringify(purpose)})`;
  }
}

describe("ElectronWebSignBridge — lifecycle (mocked electron)", () => {
  it("warmUp injects cookies + navigates + sets warm flag", async () => {
    const mock = makeMockElectron();
    const b = new FakeBridge({ electron: mock.electron });
    await b.warmUp("a=1; b=2");
    expect(mock.cookieSets).toHaveLength(2);
    expect(mock.cookieSets[0]).toMatchObject({
      name: "a",
      value: "1",
      domain: ".example.com",
    });
    expect(mock.navigationCalls).toEqual(["https://example.com"]);
    expect(b._warm).toBe(true);
  });

  it("warmUp twice is a no-op (idempotent)", async () => {
    const mock = makeMockElectron();
    const b = new FakeBridge({ electron: mock.electron });
    await b.warmUp("a=1");
    await b.warmUp("a=1");
    expect(mock.navigationCalls).toHaveLength(1); // only one nav
  });

  it("eval returns JS result string", async () => {
    const mock = makeMockElectron({ jsResult: "signed_url_value" });
    const b = new FakeBridge({ electron: mock.electron });
    await b.warmUp("a=1");
    const r = await b._eval("https://x", "purpose");
    expect(r).toBe("signed_url_value");
    expect(mock.evalCalls).toHaveLength(1);
    expect(mock.evalCalls[0]).toContain("__test_script");
  });

  it("eval before warmUp returns null + warns", async () => {
    const mock = makeMockElectron();
    const warnings = [];
    const b = new FakeBridge({
      electron: mock.electron,
      onWarn: (m) => warnings.push(m),
    });
    const r = await b._eval("https://x", "purpose");
    expect(r).toBe(null);
    expect(warnings[0]).toMatch(/eval before warmUp/);
  });

  it("shutdown destroys webContents + resets warm flag", async () => {
    const mock = makeMockElectron();
    const b = new FakeBridge({ electron: mock.electron });
    await b.warmUp("a=1");
    expect(b._warm).toBe(true);
    await b.shutdown();
    expect(mock.fakeWebContents.destroy).toHaveBeenCalledOnce();
    expect(b._warm).toBe(false);
    expect(b._view).toBe(null);
  });

  it("eval mutex serializes concurrent calls", async () => {
    const mock = makeMockElectron({ jsResult: "r" });
    // Make executeJavaScript take a measurable time so we can observe
    // serialization.
    const fakeWc = mock.fakeWebContents;
    let evalCount = 0;
    let evalConcurrent = 0;
    let maxConcurrent = 0;
    fakeWc.executeJavaScript = vi.fn(async () => {
      evalConcurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, evalConcurrent);
      await new Promise((r) => setTimeout(r, 20));
      evalConcurrent -= 1;
      evalCount += 1;
      return "r";
    });
    const b = new FakeBridge({ electron: mock.electron });
    await b.warmUp("a=1");
    await Promise.all([
      b._eval("u1", "p1"),
      b._eval("u2", "p2"),
      b._eval("u3", "p3"),
    ]);
    expect(evalCount).toBe(3);
    expect(maxConcurrent).toBe(1); // mutex held
  });
});

// ─── XhsSignBridge ──────────────────────────────────────────────────────

describe("XhsSignBridge", () => {
  it("homepageUrl + cookieDomain + postLoadDelayMs are correct", () => {
    const b = new XhsSignBridge({ electron: {} });
    expect(b.homepageUrl).toBe("https://www.xiaohongshu.com/explore");
    expect(b.cookieDomain).toBe(".xiaohongshu.com");
    expect(b.postLoadDelayMs).toBe(2500);
  });

  it("buildSignScript probes 4 candidate signing globals", () => {
    const b = new XhsSignBridge({ electron: {} });
    const script = b.buildSignScript("ignored", "/api/x|");
    expect(script).toContain("window._webmsxyw");
    expect(script).toContain("window.webmsxyw");
    expect(script).toContain("window.xhs.sign");
    expect(script).toContain("window._b8");
    // Encodes purpose's path + body via JSON.stringify
    expect(script).toContain('"/api/x"');
  });

  it("buildSignScript splits purpose on pipe", () => {
    const b = new XhsSignBridge({ electron: {} });
    const script = b.buildSignScript(
      "ignored",
      `/api/sns/web/v1/x|{"foo":"bar"}`,
    );
    expect(script).toContain('"/api/sns/web/v1/x"');
    expect(script).toContain('"{\\"foo\\":\\"bar\\"}"');
  });

  it("signUrl returns null (Xhs uses headers only)", async () => {
    const b = new XhsSignBridge({ electron: {} });
    expect(await b.signUrl("u", "p")).toBe(null);
  });

  it("signedHeaders returns {} when bridge not warm", async () => {
    const b = new XhsSignBridge({ electron: {} });
    expect(await b.signedHeaders("u", "p")).toEqual({});
  });

  it("signedHeaders parses xhs.js JSON-stringified headers", async () => {
    const mock = makeMockElectron({
      jsResult: JSON.stringify({
        "X-s": "XYW_abc123",
        "X-t": 1716383021000,
        "X-s-common": "common_value",
      }),
    });
    const b = new XhsSignBridge({ electron: mock.electron });
    await b.warmUp("a1=fp; web_session=s");
    const headers = await b.signedHeaders("https://x", "/api/x|");
    expect(headers).toEqual({
      "X-s": "XYW_abc123",
      "X-t": "1716383021000",
      "X-s-common": "common_value",
    });
  });

  it("signedHeaders normalizes header case (X-S → X-s)", () => {
    expect(xhsInternals.normalizeXhsHeader("X-S")).toBe("X-s");
    expect(xhsInternals.normalizeXhsHeader("x-t")).toBe("X-t");
    expect(xhsInternals.normalizeXhsHeader("X-S-COMMON")).toBe("X-s-common");
  });

  it("signedHeaders returns {} when xhs returns null (all candidates missed)", async () => {
    const mock = makeMockElectron({ jsResult: null });
    const b = new XhsSignBridge({ electron: mock.electron });
    await b.warmUp("a1=fp; web_session=s");
    expect(await b.signedHeaders("https://x", "/api/x|")).toEqual({});
  });

  it("signedHeaders returns {} when xhs returns non-object string (legacy build)", async () => {
    const mock = makeMockElectron({ jsResult: "raw_string_no_headers" });
    const b = new XhsSignBridge({ electron: mock.electron });
    await b.warmUp("a1=fp; web_session=s");
    expect(await b.signedHeaders("https://x", "/api/x|")).toEqual({});
  });
});

// ─── ToutiaoSignBridge ──────────────────────────────────────────────────

describe("ToutiaoSignBridge", () => {
  it("homepageUrl + cookieDomain + postLoadDelayMs are correct", () => {
    const b = new ToutiaoSignBridge({ electron: {} });
    expect(b.homepageUrl).toBe("https://www.toutiao.com/");
    expect(b.cookieDomain).toBe(".toutiao.com");
    expect(b.postLoadDelayMs).toBe(2500);
  });

  it("AID_TOUTIAO_WEB is 24", () => {
    expect(toutiaoInternals.AID_TOUTIAO_WEB).toBe("24");
  });

  it("buildSignScript probes 3 candidate signing globals in order", () => {
    const b = new ToutiaoSignBridge({ electron: {} });
    const script = b.buildSignScript(
      "https://www.toutiao.com/api/news/feed/v90/?category=__all__",
      "feed",
    );
    // 3 candidates in priority order
    expect(script).toContain("window.byted_acrawler");
    expect(script).toContain("window._0x32d839");
    expect(script).toContain("window.acrawler");
    // byted_acrawler comes BEFORE _0x32d839 in source
    const bytedIdx = script.indexOf("window.byted_acrawler");
    const obfsIdx = script.indexOf("window._0x32d839");
    const acrawlerIdx = script.indexOf("window.acrawler.sign");
    expect(bytedIdx).toBeGreaterThan(-1);
    expect(bytedIdx).toBeLessThan(obfsIdx);
    expect(obfsIdx).toBeLessThan(acrawlerIdx);
  });

  it("buildSignScript passes URL + aid + platform as args object", () => {
    const b = new ToutiaoSignBridge({ electron: {} });
    const url = "https://www.toutiao.com/api/news/feed/v90/?category=__all__";
    const script = b.buildSignScript(url, "feed");
    expect(script).toContain('"url":');
    expect(script).toContain('"aid":"24"');
    expect(script).toContain('"platform":"PC"');
  });

  it("signedHeaders returns {} (Toutiao mutates URL, not headers)", async () => {
    const b = new ToutiaoSignBridge({ electron: {} });
    expect(await b.signedHeaders("u", "p")).toEqual({});
  });

  it("signUrl returns null when bridge cold", async () => {
    const b = new ToutiaoSignBridge({ electron: {} });
    expect(await b.signUrl("https://www.toutiao.com/api/x", "feed")).toBe(null);
  });

  it("signUrl appends _signature query param for bare-string JS result", async () => {
    const mock = makeMockElectron({ jsResult: "_02BxxxBASE64SIG" });
    const b = new ToutiaoSignBridge({ electron: mock.electron });
    await b.warmUp("passport_uid=1; multi_sids=1:abc");
    const signed = await b.signUrl(
      "https://www.toutiao.com/api/news/feed/v90/?category=__all__&aid=24",
      "feed",
    );
    expect(signed).toBeInstanceOf(URL);
    expect(signed.searchParams.get("_signature")).toBe("_02BxxxBASE64SIG");
    // Existing query params preserved
    expect(signed.searchParams.get("category")).toBe("__all__");
    expect(signed.searchParams.get("aid")).toBe("24");
  });

  it("signUrl unpacks _signature field from object JS result", async () => {
    const mock = makeMockElectron({
      jsResult: JSON.stringify({ _signature: "_02BobjectSIG" }),
    });
    const b = new ToutiaoSignBridge({ electron: mock.electron });
    await b.warmUp("passport_uid=1");
    const signed = await b.signUrl(
      "https://www.toutiao.com/api/news/feed/v90/",
      "feed",
    );
    expect(signed.searchParams.get("_signature")).toBe("_02BobjectSIG");
  });

  it("signUrl falls back to raw string when JSON.parse fails", async () => {
    // Looks like JSON (starts with {) but isn't valid → fallback uses
    // the whole trimmed string as the signature value.
    const mock = makeMockElectron({ jsResult: "{malformed" });
    const b = new ToutiaoSignBridge({ electron: mock.electron });
    await b.warmUp("passport_uid=1");
    const signed = await b.signUrl("https://www.toutiao.com/api/x", "feed");
    expect(signed.searchParams.get("_signature")).toBe("{malformed");
  });

  it("signUrl returns null when JS returns null", async () => {
    const mock = makeMockElectron({ jsResult: null });
    const b = new ToutiaoSignBridge({ electron: mock.electron });
    await b.warmUp("passport_uid=1");
    expect(await b.signUrl("https://www.toutiao.com/api/x", "feed")).toBe(null);
  });

  it("signUrl returns null for 'null' / 'undefined' / empty JS sentinel", async () => {
    for (const sentinel of ["null", "undefined", ""]) {
      const mock = makeMockElectron({ jsResult: sentinel });
      const b = new ToutiaoSignBridge({ electron: mock.electron });
      await b.warmUp("passport_uid=1");
      expect(await b.signUrl("https://www.toutiao.com/api/x", "feed")).toBe(
        null,
      );
    }
  });

  it("signUrl replaces existing _signature param (not append twice)", async () => {
    const mock = makeMockElectron({ jsResult: "NEW_SIG" });
    const b = new ToutiaoSignBridge({ electron: mock.electron });
    await b.warmUp("passport_uid=1");
    const signed = await b.signUrl(
      "https://www.toutiao.com/api/x?_signature=OLD_SIG&aid=24",
      "feed",
    );
    expect(signed.searchParams.get("_signature")).toBe("NEW_SIG");
    expect(signed.searchParams.getAll("_signature")).toHaveLength(1);
    expect(signed.searchParams.get("aid")).toBe("24");
  });

  it("signUrl ignores object without _signature field", async () => {
    // Object returned but no _signature key → falls back to raw JSON
    // string as the sig value (defensive).
    const mock = makeMockElectron({
      jsResult: JSON.stringify({ other: "value" }),
    });
    const b = new ToutiaoSignBridge({ electron: mock.electron });
    await b.warmUp("passport_uid=1");
    const signed = await b.signUrl("https://www.toutiao.com/api/x", "feed");
    expect(signed).not.toBeNull();
    // Whole JSON string used as sig — server will reject but at least
    // we don't crash.
    expect(signed.searchParams.get("_signature")).toBe(
      JSON.stringify({ other: "value" }),
    );
  });

  it("signUrl + warmUp + shutdown lifecycle (mocked electron)", async () => {
    const mock = makeMockElectron({ jsResult: "SIG_XYZ" });
    const b = new ToutiaoSignBridge({ electron: mock.electron });
    await b.warmUp("passport_uid=1; multi_sids=1:abc");
    expect(b._warm).toBe(true);
    expect(mock.cookieSets).toHaveLength(2);
    expect(mock.cookieSets[0]).toMatchObject({
      name: "passport_uid",
      domain: ".toutiao.com",
    });
    expect(mock.navigationCalls).toEqual(["https://www.toutiao.com/"]);
    const signed = await b.signUrl(
      "https://www.toutiao.com/api/news/feed/v90/",
      "feed",
    );
    expect(signed.searchParams.get("_signature")).toBe("SIG_XYZ");
    await b.shutdown();
    expect(mock.fakeWebContents.destroy).toHaveBeenCalledOnce();
    expect(b._warm).toBe(false);
  });
});
