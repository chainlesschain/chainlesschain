import { describe, it, expect } from "vitest";
import {
  getStatusLabel,
  getStatusColor,
  getPriorityLabel,
  getPriorityColor,
  getLabelColor,
  getAvatarColor,
  getAvatarText,
  formatDateTime,
  getChangeLabel,
  getChangeColor,
} from "@renderer/components/task/taskDetailUtils";

describe("taskDetailUtils", () => {
  it("maps status label+color", () => {
    expect(getStatusLabel("in_progress")).toBe("进行中");
    expect(getStatusColor("completed")).toBe("success");
    expect(getStatusLabel("x")).toBe("x");
    expect(getStatusColor("x")).toBe("default");
  });

  it("maps priority label+color", () => {
    expect(getPriorityLabel("urgent")).toBe("紧急");
    expect(getPriorityColor("high")).toBe("orange");
    expect(getPriorityLabel("x")).toBe("x");
    expect(getPriorityColor("x")).toBe("default");
  });

  describe("getLabelColor / getAvatarColor (hash-based, deterministic)", () => {
    it("returns a color from the palette, stable per input", () => {
      const palette = ["blue", "green", "orange", "purple", "cyan", "magenta"];
      expect(palette).toContain(getLabelColor("frontend"));
      expect(getLabelColor("frontend")).toBe(getLabelColor("frontend"));
      const avatars = [
        "#1890ff",
        "#52c41a",
        "#faad14",
        "#f5222d",
        "#722ed1",
        "#13c2c2",
      ];
      expect(avatars).toContain(getAvatarColor("did:key:abc"));
      expect(getAvatarColor("did:key:abc")).toBe(getAvatarColor("did:key:abc"));
    });
  });

  it("derives 2-char uppercase avatar text", () => {
    expect(getAvatarText("did:key:zabc")).toBe("DI");
    expect(getAvatarText("ab")).toBe("AB");
  });

  it("formats datetime as a non-empty string", () => {
    expect(typeof formatDateTime(1700000000000)).toBe("string");
    expect(formatDateTime(1700000000000).length).toBeGreaterThan(0);
  });

  it("maps change label+color with fallbacks", () => {
    expect(getChangeLabel("status")).toBe("变更了状态");
    expect(getChangeLabel("mystery")).toBe("mystery");
    expect(getChangeColor("create")).toBe("green");
    expect(getChangeColor("status")).toBe("blue");
    expect(getChangeColor("other")).toBe("gray");
  });
});
