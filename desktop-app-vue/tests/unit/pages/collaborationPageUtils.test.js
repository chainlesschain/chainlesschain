import { describe, it, expect } from "vitest";
import {
  getRoleColor,
  getRoleName,
  getAvatarColor,
} from "@renderer/pages/projects/collaborationPageUtils";

describe("collaborationPageUtils", () => {
  it("getRoleColor maps known roles, defaults otherwise", () => {
    expect(getRoleColor("owner")).toBe("gold");
    expect(getRoleColor("admin")).toBe("red");
    expect(getRoleColor("editor")).toBe("blue");
    expect(getRoleColor("viewer")).toBe("green");
    expect(getRoleColor("guest")).toBe("default");
  });

  it("getRoleName maps known roles, echoes unknown", () => {
    expect(getRoleName("owner")).toBe("所有者");
    expect(getRoleName("viewer")).toBe("查看者");
    expect(getRoleName("mystery")).toBe("mystery");
  });

  describe("getAvatarColor", () => {
    it("is deterministic and returns a palette hex", () => {
      expect(getAvatarColor("did:x:1")).toBe(getAvatarColor("did:x:1"));
      expect(getAvatarColor("did:x:2")).toMatch(/^#[0-9a-f]{6}$/i);
    });
    it("falls back to the first palette color for empty DID", () => {
      expect(getAvatarColor(null)).toBe("#f56a00");
      expect(getAvatarColor("")).toBe("#f56a00");
    });
  });
});
