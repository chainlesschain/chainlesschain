/**
 * file-utils 测试 — src/renderer/utils/file-utils.ts
 *
 * Pure helpers: path-traversal-safe join, size limits/formatting, size
 * validation, file-type detection, throttle/debounce. logger is mocked; the
 * file-metadata cache is real (pure) so type tests use distinct paths.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  sanitizePath,
  getFileSizeLimit,
  formatFileSize,
  validateFileSize,
  getFileTypeInfo,
  throttle,
  debounce,
  FILE_SIZE_LIMITS,
} from "@/utils/file-utils";

describe("file-utils — sanitizePath", () => {
  it("joins a safe relative path under the base", () => {
    expect(sanitizePath("/proj", "src/a.ts")).toBe("/proj/src/a.ts");
    expect(sanitizePath("/proj", "/src/a.ts")).toBe("/proj/src/a.ts"); // leading slash stripped
  });

  it("rejects traversal and empty inputs", () => {
    expect(() => sanitizePath("/proj", "../etc/passwd")).toThrow(/\.\./);
    expect(() => sanitizePath("", "a")).toThrow();
    expect(() => sanitizePath("/proj", "")).toThrow();
  });
});

describe("file-utils — size limits + formatting", () => {
  it("maps extensions to size buckets (case-insensitive, default fallback)", () => {
    expect(getFileSizeLimit("ts")).toBe(FILE_SIZE_LIMITS.TEXT);
    expect(getFileSizeLimit("PNG")).toBe(FILE_SIZE_LIMITS.IMAGE);
    expect(getFileSizeLimit("mp4")).toBe(FILE_SIZE_LIMITS.VIDEO);
    expect(getFileSizeLimit("pdf")).toBe(FILE_SIZE_LIMITS.DOCUMENT);
    expect(getFileSizeLimit("xyz")).toBe(FILE_SIZE_LIMITS.DEFAULT);
    expect(getFileSizeLimit(undefined)).toBe(FILE_SIZE_LIMITS.DEFAULT);
  });

  it("formats byte counts, with 0 and unknown handling", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(null)).toBe("Unknown");
    expect(formatFileSize(undefined)).toBe("Unknown");
    expect(formatFileSize(1024)).toBe("1.00 KB");
    expect(formatFileSize(1536)).toBe("1.50 KB");
    expect(formatFileSize(1048576)).toBe("1.00 MB");
  });

  it("validateFileSize flags over-limit files", () => {
    expect(validateFileSize(5 * 1024 * 1024, "ts").isValid).toBe(true);
    const over = validateFileSize(20 * 1024 * 1024, "ts");
    expect(over.isValid).toBe(false);
    expect(over.limit).toBe(FILE_SIZE_LIMITS.TEXT);
    expect(over.message).toMatch(/超过限制/);
  });
});

describe("file-utils — getFileTypeInfo", () => {
  it("detects editable code / image / markdown by extension", () => {
    const ts = getFileTypeInfo("/p/one.ts", "one.ts");
    expect(ts).toMatchObject({
      extension: "ts",
      isEditable: true,
      isCode: true,
      isMarkdown: false,
    });
    const png = getFileTypeInfo("/p/two.png", "two.png");
    expect(png).toMatchObject({ isImage: true, isEditable: false });
    const md = getFileTypeInfo("/p/three.md", "three.md");
    expect(md).toMatchObject({ isMarkdown: true, isEditable: true });
  });

  it("treats no-extension files and dotfiles as having no extension", () => {
    // README / Makefile have no dot → extension "", not "readme"/"makefile".
    expect(getFileTypeInfo("/p/README", "README").extension).toBe("");
    expect(getFileTypeInfo("/p/Makefile", "Makefile").extension).toBe("");
    // A dotfile's leading-dot name is not an extension.
    expect(getFileTypeInfo("/p/.gitignore", ".gitignore").extension).toBe("");
    // But a dotfile WITH a real extension still resolves it.
    expect(
      getFileTypeInfo("/p/.eslintrc.json", ".eslintrc.json"),
    ).toMatchObject({ extension: "json", isEditable: true });
    // Multi-dot names resolve to the last segment.
    expect(
      getFileTypeInfo("/p/archive.tar.gz", "archive.tar.gz").extension,
    ).toBe("gz");
  });
});

describe("file-utils — throttle + debounce", () => {
  it("debounce fires once after the wait window", () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const d = debounce(fn, 100);
      d();
      d();
      d();
      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throttle invokes on the leading edge", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000); // non-zero clock → leading call runs immediately
    try {
      const fn = vi.fn();
      const t = throttle(fn, 100);
      t();
      expect(fn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
