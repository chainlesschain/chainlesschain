import { describe, it, expect } from "vitest";
import {
  getTaskStatusColor,
  getTaskStatusText,
  getProgressStatus,
  getStepsStatus,
  formatDateTime,
  formatDuration,
  formatResult,
} from "@renderer/components/cowork/taskDetailPanelUtils";

describe("taskDetailPanelUtils", () => {
  it("maps task status color+text", () => {
    expect(getTaskStatusColor("paused")).toBe("warning");
    expect(getTaskStatusColor("x")).toBe("default");
    expect(getTaskStatusText("running")).toBe("运行中");
    expect(getTaskStatusText("x")).toBe("x");
  });

  it("maps progress + steps status", () => {
    expect(getProgressStatus({ status: "failed" })).toBe("exception");
    expect(getProgressStatus({ status: "running" })).toBe("active");
    expect(getProgressStatus({ status: "pending" })).toBe("normal");
    expect(getStepsStatus({ status: "completed" })).toBe("finish");
    expect(getStepsStatus({ status: "pending" })).toBe("process");
  });

  describe("formatDateTime", () => {
    it("dashes falsy + invalid, formats valid", () => {
      expect(formatDateTime(0)).toBe("-");
      expect(formatDateTime("not-a-date")).toBe("-");
      expect(formatDateTime(1700000000000)).toMatch(
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
      );
    });
  });

  describe("formatDuration", () => {
    it("dashes zero, scales s/m/h", () => {
      expect(formatDuration(0)).toBe("-");
      expect(formatDuration(45000)).toBe("45 秒");
      expect(formatDuration(125000)).toBe("2 分钟 5 秒");
      expect(formatDuration(3720000)).toBe("1 小时 2 分钟");
    });
  });

  describe("formatResult", () => {
    it("passes strings, stringifies objects", () => {
      expect(formatResult("done")).toBe("done");
      expect(formatResult({ a: 1 })).toBe('{\n  "a": 1\n}');
    });
  });
});
