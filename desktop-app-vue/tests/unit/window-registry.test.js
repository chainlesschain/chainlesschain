/**
 * Phase 1.5 window-registry MVP — unit tests.
 *
 * These cover the pure-data contract the registry exposes. Real Electron
 * BrowserWindow integration is deferred to Phase 1.5 implementation +
 * e2e (Playwright launch with multi-window scenario).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  WindowRegistry,
  VALID_ROLES,
  DEFAULT_GEOMETRY,
  getWindowRegistry,
  _resetForTest,
} from "../../src/main/window-registry.js";

function makeFakeWindow(label = "fake") {
  return { __label: label, setBounds: () => {}, focus: () => {} };
}

beforeEach(() => {
  _resetForTest();
});

describe("WindowRegistry — register/release/get", () => {
  it("starts empty", () => {
    const r = new WindowRegistry();
    expect(r.list()).toEqual([]);
    expect(r.get("main")).toBe(null);
    expect(r.has("artifact")).toBe(false);
  });

  it("registers a window under a known role and exposes it via get/has/list", () => {
    const r = new WindowRegistry();
    const w = makeFakeWindow("w1");
    r.register("main", w, "http://127.0.0.1:9999/");
    expect(r.has("main")).toBe(true);
    expect(r.get("main")).toMatchObject({
      role: "main",
      window: w,
      url: "http://127.0.0.1:9999/",
    });
    expect(r.list()).toHaveLength(1);
  });

  it("rejects an unknown role", () => {
    const r = new WindowRegistry();
    expect(() => r.register("bogus", makeFakeWindow())).toThrow(/unknown role/);
  });

  it("rejects a duplicate role registration", () => {
    const r = new WindowRegistry();
    r.register("main", makeFakeWindow("a"));
    expect(() => r.register("main", makeFakeWindow("b"))).toThrow(
      /already has a live window/,
    );
  });

  it("rejects register() with a missing window", () => {
    const r = new WindowRegistry();
    expect(() => r.register("main", null)).toThrow(/window is required/);
  });

  it("release() returns true the first time, false on idempotent re-call", () => {
    const r = new WindowRegistry();
    r.register("artifact", makeFakeWindow());
    expect(r.release("artifact")).toBe(true);
    expect(r.release("artifact")).toBe(false);
    expect(r.get("artifact")).toBe(null);
  });
});

describe("WindowRegistry — resolveUrl", () => {
  it("returns the bare httpUrl for the main role (no hash)", () => {
    const r = new WindowRegistry();
    expect(r.resolveUrl("main", "http://127.0.0.1:9999/")).toBe(
      "http://127.0.0.1:9999/",
    );
  });

  it("appends /#/<role> for non-main roles", () => {
    const r = new WindowRegistry();
    expect(r.resolveUrl("artifact", "http://127.0.0.1:9999/")).toBe(
      "http://127.0.0.1:9999/#/artifact",
    );
    expect(r.resolveUrl("project", "http://127.0.0.1:9999/")).toBe(
      "http://127.0.0.1:9999/#/project",
    );
    expect(r.resolveUrl("dashboard", "http://127.0.0.1:9999/")).toBe(
      "http://127.0.0.1:9999/#/dashboard",
    );
  });

  it("appends a query string when the caller provides one", () => {
    const r = new WindowRegistry();
    const url = r.resolveUrl("artifact", "http://127.0.0.1:9999/", {
      id: "abc-123",
      readonly: true,
    });
    expect(url).toBe(
      "http://127.0.0.1:9999/#/artifact?id=abc-123&readonly=true",
    );
  });

  it("normalises a missing trailing slash on the base URL", () => {
    const r = new WindowRegistry();
    expect(r.resolveUrl("artifact", "http://127.0.0.1:9999")).toBe(
      "http://127.0.0.1:9999/#/artifact",
    );
  });

  it("throws on unknown role or empty httpUrl", () => {
    const r = new WindowRegistry();
    expect(() => r.resolveUrl("bogus", "http://x/")).toThrow(/unknown role/);
    expect(() => r.resolveUrl("main", "")).toThrow(/httpUrl is required/);
    expect(() => r.resolveUrl("main", null)).toThrow(/httpUrl is required/);
  });
});

describe("WindowRegistry — geometry helpers", () => {
  it("provides sensible defaults for every valid role", () => {
    const r = new WindowRegistry();
    for (const role of VALID_ROLES) {
      const geo = r.defaultGeometryFor(role);
      expect(geo.width).toBeGreaterThan(0);
      expect(geo.height).toBeGreaterThan(0);
    }
  });

  it("falls back to main's default when given an unknown role", () => {
    const r = new WindowRegistry();
    expect(r.defaultGeometryFor("ghost")).toEqual(DEFAULT_GEOMETRY.main);
  });

  it("pulls per-role geometry from settings.ui.windowGeometry", () => {
    const r = new WindowRegistry();
    const settings = {
      ui: {
        windowGeometry: {
          artifact: { x: 100, y: 200, width: 800, height: 600 },
        },
      },
    };
    expect(r.getGeometryFromSettings("artifact", settings)).toEqual({
      x: 100,
      y: 200,
      width: 800,
      height: 600,
    });
  });

  it("returns null when settings are absent / malformed / missing geometry", () => {
    const r = new WindowRegistry();
    expect(r.getGeometryFromSettings("main", null)).toBe(null);
    expect(r.getGeometryFromSettings("main", "not-an-object")).toBe(null);
    expect(r.getGeometryFromSettings("main", {})).toBe(null);
    expect(r.getGeometryFromSettings("main", { ui: {} })).toBe(null);
    expect(
      r.getGeometryFromSettings("main", {
        ui: { windowGeometry: { main: "wrong-type" } },
      }),
    ).toBe(null);
    expect(
      r.getGeometryFromSettings("main", {
        ui: { windowGeometry: { main: { width: "1200" } } },
      }),
    ).toBe(null);
  });
});

describe("getWindowRegistry — singleton", () => {
  it("returns the same instance across calls", () => {
    expect(getWindowRegistry()).toBe(getWindowRegistry());
  });

  it("_resetForTest replaces the singleton with a fresh empty one", () => {
    const a = getWindowRegistry();
    a.register("main", makeFakeWindow());
    expect(a.has("main")).toBe(true);
    _resetForTest();
    const b = getWindowRegistry();
    expect(b).not.toBe(a);
    expect(b.has("main")).toBe(false);
  });
});
