import { describe, it, expect } from "vitest";
import {
  formatDID,
  formatDate,
  getRoleLabel,
  getRoleColor,
  parsePermissions,
  getPermissionCount,
} from "@renderer/pages/organizationMembersPageUtils";

describe("organizationMembersPageUtils", () => {
  describe("formatDID", () => {
    it("returns empty for falsy", () => {
      expect(formatDID("")).toBe("");
      expect(formatDID(undefined)).toBe("");
    });
    it("returns short DIDs unchanged, truncates long", () => {
      expect(formatDID("did:key:short")).toBe("did:key:short");
      const did = "did:key:z6Mk" + "x".repeat(40);
      expect(formatDID(did)).toBe(
        did.substring(0, 15) + "..." + did.substring(did.length - 10),
      );
    });
  });

  describe("formatDate", () => {
    it("returns empty for falsy", () => {
      expect(formatDate(0)).toBe("");
      expect(formatDate(null)).toBe("");
    });
    it("formats via toLocaleString", () => {
      const out = formatDate(1700000000000);
      expect(typeof out).toBe("string");
      expect(out.length).toBeGreaterThan(0);
    });
  });

  describe("getRoleLabel / getRoleColor", () => {
    it("maps known roles + falls back", () => {
      expect(getRoleLabel("admin")).toBe("管理员");
      expect(getRoleColor("admin")).toBe("orange");
      expect(getRoleLabel("x")).toBe("x");
      expect(getRoleColor("x")).toBe("default");
    });
  });

  describe("parsePermissions", () => {
    it("parses a JSON array", () => {
      expect(parsePermissions('["read","write"]')).toEqual(["read", "write"]);
    });
    it("returns [] for non-array JSON or bad input", () => {
      expect(parsePermissions('{"a":1}')).toEqual([]);
      expect(parsePermissions("not-json")).toEqual([]);
      expect(parsePermissions(null)).toEqual([]);
    });
  });

  describe("getPermissionCount", () => {
    it("counts parsed permissions when present", () => {
      expect(getPermissionCount({ permissions_json: '["a","b","c"]' })).toBe(3);
    });
    it("uses role default counts when no JSON", () => {
      expect(getPermissionCount({ role: "owner" })).toBe("全部");
      expect(getPermissionCount({ role: "admin" })).toBe(15);
      expect(getPermissionCount({ role: "member" })).toBe(8);
      expect(getPermissionCount({ role: "viewer" })).toBe(3);
      expect(getPermissionCount({ role: "unknown" })).toBe(0);
    });
  });
});
