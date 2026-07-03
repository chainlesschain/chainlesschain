import { describe, it, expect } from "vitest";
import {
  getTaskStatusColor,
  getTaskStatusText,
  getProgressStatus,
  formatDuration,
} from "@renderer/pages/taskMonitorUtils";

describe("taskMonitorUtils", () => {
  it("getTaskStatusColor maps statuses, defaults otherwise", () => {
    expect(getTaskStatusColor("running")).toBe("processing");
    expect(getTaskStatusColor("paused")).toBe("warning");
    expect(getTaskStatusColor("failed")).toBe("error");
    expect(getTaskStatusColor("weird")).toBe("default");
  });

  it("getTaskStatusText maps statuses, echoes unknown", () => {
    expect(getTaskStatusText("running")).toBe("运行中");
    expect(getTaskStatusText("completed")).toBe("已完成");
    expect(getTaskStatusText("weird")).toBe("weird");
  });

  it("getProgressStatus derives antd progress state from task.status", () => {
    expect(getProgressStatus({ status: "failed" })).toBe("exception");
    expect(getProgressStatus({ status: "completed" })).toBe("success");
    expect(getProgressStatus({ status: "running" })).toBe("active");
    expect(getProgressStatus({ status: "pending" })).toBe("normal");
  });

  describe("formatDuration", () => {
    it("returns '-' for falsy/zero", () => {
      expect(formatDuration(0)).toBe("-");
      expect(formatDuration(null)).toBe("-");
    });
    it("formats h/m/s tiers", () => {
      expect(formatDuration(2 * 3600000 + 5 * 60000)).toBe("2h 5m");
      expect(formatDuration(3 * 60000 + 4000)).toBe("3m 4s");
      expect(formatDuration(42000)).toBe("42s");
    });
  });
});
