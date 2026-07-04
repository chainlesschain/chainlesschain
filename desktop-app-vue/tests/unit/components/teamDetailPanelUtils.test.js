import { describe, it, expect } from "vitest";
import {
  getStatusColor,
  getStatusText,
  getRoleText,
  getTaskStatusColor,
  getTaskStatusText,
  formatDateTime,
} from "@renderer/components/cowork/teamDetailPanelUtils";

describe("cowork/teamDetailPanelUtils", () => {
  describe("getStatusColor / getStatusText", () => {
    it("maps team statuses with fallback", () => {
      expect(getStatusColor("active")).toBe("green");
      expect(getStatusColor("paused")).toBe("orange");
      expect(getStatusColor("x")).toBe("default");
      expect(getStatusText("active")).toBe("活跃");
      expect(getStatusText("destroyed")).toBe("已销毁");
      expect(getStatusText("x")).toBe("x");
    });
  });

  describe("getRoleText", () => {
    it("maps roles with fallback", () => {
      expect(getRoleText("leader")).toBe("领导者");
      expect(getRoleText("member")).toBe("成员");
      expect(getRoleText("x")).toBe("x");
    });
  });

  describe("getTaskStatusColor / getTaskStatusText", () => {
    it("maps task statuses with fallback", () => {
      expect(getTaskStatusColor("running")).toBe("processing");
      expect(getTaskStatusColor("completed")).toBe("success");
      expect(getTaskStatusColor("x")).toBe("default");
      expect(getTaskStatusText("pending")).toBe("待处理");
      expect(getTaskStatusText("cancelled")).toBe("已取消");
      expect(getTaskStatusText("x")).toBe("x");
    });
  });

  describe("formatDateTime", () => {
    it("returns dash for empty", () => {
      expect(formatDateTime(null)).toBe("-");
    });
    it("returns dash for invalid input", () => {
      expect(formatDateTime("not-a-date")).toBe("-");
    });
    it("formats a valid timestamp", () => {
      const out = formatDateTime(new Date(2026, 0, 2, 3, 4, 5).getTime());
      expect(out).toBe("2026-01-02 03:04:05");
    });
  });
});
