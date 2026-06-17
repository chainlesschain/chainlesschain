/**
 * resource-hints 测试 — src/renderer/utils/resource-hints.ts
 *
 * Pure DOM helpers that append <link rel=...> hints to document.head. Asserts
 * via getAttribute (jsdom resolves .href to absolute). head links cleared per
 * test; logger mocked.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  dnsPrefetch,
  preconnect,
  prefetch,
  preload,
  batchAddHints,
  removeHint,
  clearHintsByType,
} from "@/utils/resource-hints";

const links = (sel: string) =>
  Array.from(document.head.querySelectorAll<HTMLLinkElement>(sel));

beforeEach(() => {
  document.head.querySelectorAll("link").forEach((l) => l.remove());
});

describe("resource-hints — single hints", () => {
  it("dnsPrefetch appends a dns-prefetch link; empty domain is a no-op", () => {
    dnsPrefetch("https://cdn.example.com");
    const l = links('link[rel="dns-prefetch"]');
    expect(l).toHaveLength(1);
    expect(l[0].getAttribute("href")).toBe("https://cdn.example.com");
    dnsPrefetch("");
    expect(links('link[rel="dns-prefetch"]')).toHaveLength(1); // unchanged
  });

  it("preconnect sets crossOrigin when requested", () => {
    preconnect("https://api.example.com", true);
    const l = links('link[rel="preconnect"]')[0];
    expect(l.getAttribute("href")).toBe("https://api.example.com");
    expect(l.getAttribute("crossorigin")).toBe("anonymous");
  });

  it("prefetch records the as attribute", () => {
    prefetch("/chunk.js", "script");
    const l = links('link[rel="prefetch"]')[0];
    expect(l.getAttribute("href")).toBe("/chunk.js");
    expect(l.as).toBe("script"); // jsdom keeps `as` as a property, not an attr
  });

  it("preload requires url + as; sets options", () => {
    preload("", "script"); // missing url → no link
    expect(links('link[rel="preload"]')).toHaveLength(0);
    preload("/font.woff2", "font", { crossOrigin: true, type: "font/woff2" });
    const l = links('link[rel="preload"]')[0];
    expect(l.as).toBe("font");
    expect(l.getAttribute("type")).toBe("font/woff2");
    expect(l.getAttribute("crossorigin")).toBe("anonymous");
  });
});

describe("resource-hints — batch + removal", () => {
  it("batchAddHints creates one link per config", () => {
    batchAddHints([
      { type: "dns-prefetch", url: "https://a.com" },
      { type: "preconnect", url: "https://b.com" },
      { type: "prefetch", url: "/c.js", as: "script" },
    ]);
    expect(links('link[rel="dns-prefetch"]')).toHaveLength(1);
    expect(links('link[rel="preconnect"]')).toHaveLength(1);
    expect(links('link[rel="prefetch"]')).toHaveLength(1);
  });

  it("removeHint removes a specific rel+href; clearHintsByType clears a whole rel", () => {
    prefetch("/x.js", "script");
    prefetch("/y.js", "script");
    preconnect("https://keep.com");
    removeHint("prefetch", "/x.js");
    expect(links('link[rel="prefetch"]')).toHaveLength(1); // only /y.js left
    clearHintsByType("prefetch");
    expect(links('link[rel="prefetch"]')).toHaveLength(0);
    expect(links('link[rel="preconnect"]')).toHaveLength(1); // untouched
  });
});
