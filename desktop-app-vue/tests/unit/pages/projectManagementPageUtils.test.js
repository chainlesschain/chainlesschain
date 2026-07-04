import { describe, it, expect } from "vitest";
import {
  getProjectTypeLabel,
  getProjectTypeColor,
  getStatusLabel,
  getStatusColor,
  formatFileSize,
  formatDateTime,
} from "@renderer/pages/projects/projectManagementPageUtils";

describe("projectManagementPageUtils", () => {
  it("maps project type label+color", () => {
    expect(getProjectTypeLabel("web")).toBe("网页");
    expect(getProjectTypeLabel("x")).toBe("x");
    expect(getProjectTypeColor("app")).toBe("purple");
    expect(getProjectTypeColor("x")).toBe("default");
  });

  it("maps status label+color", () => {
    expect(getStatusLabel("archived")).toBe("已归档");
    expect(getStatusLabel("x")).toBe("x");
    expect(getStatusColor("active")).toBe("success");
    expect(getStatusColor("x")).toBe("default");
  });

  describe("formatFileSize", () => {
    it("scales across units", () => {
      expect(formatFileSize(0)).toBe("0 B");
      expect(formatFileSize(1024)).toBe("1 KB");
      expect(formatFileSize(1536)).toBe("1.5 KB");
      expect(formatFileSize(1048576)).toBe("1 MB");
    });
  });

  describe("formatDateTime", () => {
    it("dashes falsy, formats otherwise", () => {
      expect(formatDateTime(0)).toBe("-");
      expect(formatDateTime(null)).toBe("-");
      expect(typeof formatDateTime(1700000000000)).toBe("string");
      expect(formatDateTime(1700000000000).length).toBeGreaterThan(0);
    });
  });
});
