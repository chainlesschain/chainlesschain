import { describe, it, expect } from "vitest";
import {
  formatTime,
  getTypeName,
  getTypeColor,
  getScopeName,
  getScopeColor,
} from "@renderer/pages/organizationKnowledgePageUtils";

describe("organizationKnowledgePageUtils", () => {
  describe("formatTime", () => {
    it("returns '-' for falsy input", () => {
      expect(formatTime(null)).toBe("-");
      expect(formatTime(0)).toBe("-");
    });
    it("returns '刚刚' within a minute", () => {
      expect(formatTime(Date.now() - 5000)).toBe("刚刚");
    });
    it("returns 'N分钟前' within an hour", () => {
      expect(formatTime(Date.now() - 10 * 60000)).toBe("10分钟前");
    });
  });

  it("getTypeName maps known types, echoes unknown", () => {
    expect(getTypeName("note")).toBe("笔记");
    expect(getTypeName("web_clip")).toBe("网页剪藏");
    expect(getTypeName("weird")).toBe("weird");
  });

  it("getTypeColor maps known types, defaults otherwise", () => {
    expect(getTypeColor("note")).toBe("blue");
    expect(getTypeColor("conversation")).toBe("orange");
    expect(getTypeColor("weird")).toBe("default");
  });

  it("getScopeName maps known scopes, echoes unknown", () => {
    expect(getScopeName("private")).toBe("私有");
    expect(getScopeName("org")).toBe("组织");
    expect(getScopeName("weird")).toBe("weird");
  });

  it("getScopeColor maps known scopes, defaults otherwise", () => {
    expect(getScopeColor("private")).toBe("default");
    expect(getScopeColor("team")).toBe("blue");
    expect(getScopeColor("weird")).toBe("default");
  });
});
