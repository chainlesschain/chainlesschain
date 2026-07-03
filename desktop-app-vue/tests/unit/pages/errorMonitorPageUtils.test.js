import { describe, it, expect } from "vitest";
import {
  getSeverityColor,
  getClassificationColor,
  getStatusColor,
  formatTime,
} from "@renderer/pages/errorMonitorPageUtils";

describe("errorMonitorPageUtils", () => {
  it("getSeverityColor maps severities, defaults otherwise", () => {
    expect(getSeverityColor("critical")).toBe("red");
    expect(getSeverityColor("high")).toBe("orange");
    expect(getSeverityColor("low")).toBe("green");
    expect(getSeverityColor("weird")).toBe("default");
  });

  it("getClassificationColor maps known classes, defaults otherwise", () => {
    expect(getClassificationColor("DATABASE")).toBe("blue");
    expect(getClassificationColor("DATABASE_CORRUPT")).toBe("red");
    expect(getClassificationColor("NETWORK")).toBe("purple");
    expect(getClassificationColor("TYPE_ERROR")).toBe("magenta");
    expect(getClassificationColor("UNMAPPED")).toBe("default");
  });

  it("getStatusColor maps error-lifecycle statuses", () => {
    expect(getStatusColor("new")).toBe("default");
    expect(getStatusColor("analyzing")).toBe("processing");
    expect(getStatusColor("fixed")).toBe("success");
    expect(getStatusColor("weird")).toBe("default");
  });

  it("formatTime returns 'N/A' for falsy, else a string", () => {
    expect(formatTime(null)).toBe("N/A");
    expect(typeof formatTime(Date.UTC(2026, 0, 2))).toBe("string");
    expect(formatTime(Date.UTC(2026, 0, 2))).not.toBe("N/A");
  });
});
