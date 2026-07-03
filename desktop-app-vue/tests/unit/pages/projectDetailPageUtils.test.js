import { describe, it, expect } from "vitest";
import {
  getProjectTypeColor,
  getProjectTypeText,
  getStatusColor,
  getStatusText,
  formatDate,
} from "@renderer/pages/projects/projectDetailPageUtils";

describe("projectDetailPageUtils", () => {
  it("getProjectTypeColor maps known types, defaults otherwise", () => {
    expect(getProjectTypeColor("web")).toBe("blue");
    expect(getProjectTypeColor("data")).toBe("purple");
    expect(getProjectTypeColor("nope")).toBe("default");
  });

  it("getProjectTypeText maps known types, echoes unknown", () => {
    expect(getProjectTypeText("web")).toBe("Web应用");
    expect(getProjectTypeText("app")).toBe("应用程序");
    expect(getProjectTypeText("custom")).toBe("custom");
  });

  it("getStatusColor maps known statuses, defaults otherwise", () => {
    expect(getStatusColor("draft")).toBe("default");
    expect(getStatusColor("active")).toBe("success");
    expect(getStatusColor("completed")).toBe("blue");
    expect(getStatusColor("archived")).toBe("warning");
    expect(getStatusColor("weird")).toBe("default");
  });

  it("getStatusText maps known statuses, echoes unknown", () => {
    expect(getStatusText("draft")).toBe("草稿");
    expect(getStatusText("active")).toBe("进行中");
    expect(getStatusText("x")).toBe("x");
  });

  describe("formatDate", () => {
    it("returns '-' for falsy input", () => {
      expect(formatDate(0)).toBe("-");
      expect(formatDate(null)).toBe("-");
      expect(formatDate(undefined)).toBe("-");
    });
    it("returns a non-placeholder localized string for a valid timestamp", () => {
      const out = formatDate(Date.UTC(2026, 0, 2, 3, 4));
      expect(typeof out).toBe("string");
      expect(out).not.toBe("-");
      expect(out.length).toBeGreaterThan(0);
    });
  });
});
