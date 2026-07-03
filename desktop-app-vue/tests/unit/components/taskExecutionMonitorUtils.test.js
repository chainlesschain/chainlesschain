import { describe, it, expect } from "vitest";
import {
  getFileHint,
  formatDuration,
  formatTime,
  getStatusColor,
  getStatusText,
  getProgressStatus,
  getBadgeStatus,
  getToolLabel,
} from "@renderer/components/projects/taskExecutionMonitorUtils";

describe("taskExecutionMonitorUtils", () => {
  it("getFileHint maps by extension, '' for unknown", () => {
    expect(getFileHint("deck.pptx")).toBe("可编辑PPT制作指南(修改版1)");
    expect(getFileHint("a.docx")).toBe("可编辑文档");
    expect(getFileHint("a.zip")).toBe("");
  });

  describe("formatDuration", () => {
    it("formats hours/minutes/seconds tiers", () => {
      expect(formatDuration(3 * 3600 * 1000 + 5 * 60 * 1000)).toBe(
        "3小时5分钟",
      );
      expect(formatDuration(2 * 60 * 1000 + 3000)).toBe("2分钟3秒");
      expect(formatDuration(45 * 1000)).toBe("45秒");
    });
  });

  it("formatTime returns a HH:MM:SS-shaped string", () => {
    expect(formatTime(Date.now())).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });

  it("getStatusColor / getStatusText map statuses", () => {
    expect(getStatusColor("in_progress")).toBe("processing");
    expect(getStatusColor("failed")).toBe("error");
    expect(getStatusColor("weird")).toBe("default");
    expect(getStatusText("completed")).toBe("已完成");
    expect(getStatusText("weird")).toBe("weird");
  });

  it("getProgressStatus maps to antd progress states", () => {
    expect(getProgressStatus("completed")).toBe("success");
    expect(getProgressStatus("failed")).toBe("exception");
    expect(getProgressStatus("in_progress")).toBe("active");
    expect(getProgressStatus("pending")).toBe("normal");
  });

  it("getBadgeStatus maps, defaults to 'default'", () => {
    expect(getBadgeStatus("completed")).toBe("success");
    expect(getBadgeStatus("cancelled")).toBe("default");
  });

  it("getToolLabel maps engine ids, echoes unknown", () => {
    expect(getToolLabel("web-engine")).toBe("网页");
    expect(getToolLabel("ppt-engine")).toBe("PPT");
    expect(getToolLabel("mystery-engine")).toBe("mystery-engine");
  });
});
