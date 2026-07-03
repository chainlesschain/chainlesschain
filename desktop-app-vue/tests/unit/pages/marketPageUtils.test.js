import { describe, it, expect } from "vitest";
import {
  getCategoryColor,
  getCategoryName,
  getAvatarColor,
  getDefaultMarketProjects,
} from "@renderer/pages/projects/marketPageUtils";

describe("marketPageUtils", () => {
  describe("getCategoryColor", () => {
    it("maps known categories to their tag color", () => {
      expect(getCategoryColor("web")).toBe("blue");
      expect(getCategoryColor("document")).toBe("green");
      expect(getCategoryColor("data")).toBe("orange");
      expect(getCategoryColor("app")).toBe("purple");
      expect(getCategoryColor("other")).toBe("default");
    });
    it("falls back to 'default' for unknown/empty categories", () => {
      expect(getCategoryColor("nope")).toBe("default");
      expect(getCategoryColor(undefined)).toBe("default");
    });
  });

  describe("getCategoryName", () => {
    it("maps known categories to a localized name", () => {
      expect(getCategoryName("web")).toBe("Web开发");
      expect(getCategoryName("document")).toBe("文档模板");
      expect(getCategoryName("data")).toBe("数据分析");
      expect(getCategoryName("app")).toBe("应用开发");
      expect(getCategoryName("other")).toBe("其他");
    });
    it("echoes an unknown category back unchanged", () => {
      expect(getCategoryName("custom")).toBe("custom");
    });
  });

  describe("getAvatarColor", () => {
    it("is deterministic for the same DID", () => {
      expect(getAvatarColor("did:chainless:user1")).toBe(
        getAvatarColor("did:chainless:user1"),
      );
    });
    it("returns a hex color from the palette", () => {
      expect(getAvatarColor("did:chainless:user2")).toMatch(/^#[0-9a-f]{6}$/i);
    });
    it("handles null/empty DID via the first palette entry", () => {
      expect(getAvatarColor(null)).toBe("#f56a00");
      expect(getAvatarColor("")).toBe("#f56a00");
    });
  });

  describe("getDefaultMarketProjects", () => {
    it("returns the 4-item seed catalogue with the expected shape", () => {
      const projects = getDefaultMarketProjects();
      expect(projects).toHaveLength(4);
      for (const p of projects) {
        expect(p).toHaveProperty("id");
        expect(p).toHaveProperty("category");
        expect(typeof p.price).toBe("number");
        expect(p.seller).toHaveProperty("did");
      }
      expect(projects.map((p) => p.category)).toEqual([
        "web",
        "web",
        "data",
        "document",
      ]);
    });
    it("returns a fresh array each call (no shared mutable state)", () => {
      const a = getDefaultMarketProjects();
      const b = getDefaultMarketProjects();
      expect(a).not.toBe(b);
      a[0].price = 999;
      expect(b[0].price).toBe(299);
    });
  });
});
