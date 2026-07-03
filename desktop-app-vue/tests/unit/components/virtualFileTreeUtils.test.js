import { describe, it, expect } from "vitest";
import {
  getIconColor,
  getGitStatusColor,
} from "@renderer/components/projects/virtualFileTreeUtils";

describe("virtualFileTreeUtils", () => {
  describe("getIconColor", () => {
    it("returns folder-icon for non-leaf nodes", () => {
      expect(getIconColor({ isLeaf: false, title: "src" })).toBe("folder-icon");
    });
    it("maps known extensions to color classes", () => {
      expect(getIconColor({ isLeaf: true, title: "App.vue" })).toBe(
        "text-green-500",
      );
      expect(getIconColor({ isLeaf: true, title: "index.ts" })).toBe(
        "text-blue-600",
      );
      expect(getIconColor({ isLeaf: true, title: "main.js" })).toBe(
        "text-yellow-500",
      );
    });
    it("falls back to file-icon for unknown extensions", () => {
      expect(getIconColor({ isLeaf: true, title: "data.bin" })).toBe(
        "file-icon",
      );
      expect(getIconColor({ isLeaf: true, title: "README" })).toBe("file-icon");
    });
  });

  describe("getGitStatusColor", () => {
    it("maps known git statuses", () => {
      expect(getGitStatusColor("modified")).toBe("orange");
      expect(getGitStatusColor("added")).toBe("green");
      expect(getGitStatusColor("deleted")).toBe("red");
      expect(getGitStatusColor("untracked")).toBe("blue");
    });
    it("falls back to default", () => {
      expect(getGitStatusColor("clean")).toBe("default");
      expect(getGitStatusColor(undefined)).toBe("default");
    });
  });
});
