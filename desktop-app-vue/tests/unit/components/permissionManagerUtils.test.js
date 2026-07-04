import { describe, it, expect } from "vitest";
import {
  getRoleColor,
  formatDate,
} from "@renderer/components/organization/permissionManagerUtils";

describe("organization/permissionManagerUtils", () => {
  describe("getRoleColor", () => {
    it("maps known roles case-insensitively", () => {
      expect(getRoleColor("owner")).toBe("red");
      expect(getRoleColor("Admin")).toBe("orange");
      expect(getRoleColor("EDITOR")).toBe("blue");
      expect(getRoleColor("member")).toBe("green");
      expect(getRoleColor("viewer")).toBe("default");
    });
    it("falls back to default", () => {
      expect(getRoleColor("guest")).toBe("default");
    });
  });

  describe("formatDate", () => {
    it("returns Unknown for empty", () => {
      expect(formatDate(null)).toBe("Unknown");
      expect(formatDate(0)).toBe("Unknown");
    });
    it("returns a non-empty string for a timestamp", () => {
      const out = formatDate(new Date(2026, 0, 2).getTime());
      expect(typeof out).toBe("string");
      expect(out.length).toBeGreaterThan(0);
    });
  });
});
