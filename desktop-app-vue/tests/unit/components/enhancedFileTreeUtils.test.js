import { describe, it, expect } from "vitest";
import {
  getDirectoryName,
  getStatusColor,
  getStatusLabel,
} from "@renderer/components/projects/enhancedFileTreeUtils";

describe("enhancedFileTreeUtils", () => {
  describe("getDirectoryName", () => {
    it("returns the parent dir of a POSIX path", () => {
      expect(getDirectoryName("src/main/index.js")).toBe("src/main");
    });
    it("normalizes Windows backslashes", () => {
      expect(getDirectoryName("src\\main\\index.js")).toBe("src/main");
    });
    it("returns '' for a root-level file or empty input", () => {
      expect(getDirectoryName("index.js")).toBe("");
      expect(getDirectoryName("")).toBe("");
      expect(getDirectoryName(null)).toBe("");
      expect(getDirectoryName(undefined)).toBe("");
    });
  });

  describe("getStatusColor", () => {
    it("maps each git status to its color", () => {
      expect(getStatusColor("modified")).toBe("orange");
      expect(getStatusColor("added")).toBe("green");
      expect(getStatusColor("deleted")).toBe("red");
      expect(getStatusColor("untracked")).toBe("blue");
      expect(getStatusColor("renamed")).toBe("purple");
    });
    it("falls back to 'default' for unknown status", () => {
      expect(getStatusColor("bogus")).toBe("default");
    });
  });

  describe("getStatusLabel", () => {
    it("maps each git status to its single-letter label", () => {
      expect(getStatusLabel("modified")).toBe("M");
      expect(getStatusLabel("added")).toBe("A");
      expect(getStatusLabel("deleted")).toBe("D");
      expect(getStatusLabel("untracked")).toBe("U");
      expect(getStatusLabel("renamed")).toBe("R");
    });
    it("falls back to '?' for unknown status", () => {
      expect(getStatusLabel("bogus")).toBe("?");
    });
  });
});
