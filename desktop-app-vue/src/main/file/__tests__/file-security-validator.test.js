/**
 * Unit coverage for FileSecurityValidator (file/file-security-validator.js).
 *
 * Pure validation logic (size / extension / MIME / filename heuristics +
 * batch + risk level). Previously untested. These tests pin the existing
 * behavior and document a few heuristic edges; one genuine bug surfaced and
 * was fixed alongside (see "NaN size" test below).
 */

import { describe, it, expect } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const FileSecurityValidator = require("../file-security-validator.js");

/** Minimal valid file fixture; override fields per test. */
function file(overrides = {}) {
  return {
    display_name: "photo.png",
    file_size: 1024,
    mime_type: "image/png",
    ...overrides,
  };
}

describe("FileSecurityValidator", () => {
  const v = new FileSecurityValidator();

  describe("validate() — top-level", () => {
    it("accepts a normal image with no errors or warnings", () => {
      const r = v.validate(file());
      expect(r.valid).toBe(true);
      expect(r.errors).toEqual([]);
      expect(r.warnings).toEqual([]);
    });

    it("rejects a null file / missing display_name as incomplete", () => {
      expect(v.validate(null).valid).toBe(false);
      expect(v.validate({}).errors).toContain("文件信息不完整");
      expect(v.validate(file({ display_name: "" })).valid).toBe(false);
    });

    it("aggregates multiple errors (oversize + blocked extension)", () => {
      const r = v.validate(
        file({
          display_name: "virus.exe",
          file_size: 600 * 1024 * 1024,
          mime_type: "application/x-msdownload",
        }),
      );
      expect(r.valid).toBe(false);
      // size + extension + dangerous MIME all contribute
      expect(r.errors.length).toBeGreaterThanOrEqual(3);
    });

    it("skips MIME validation entirely when mime_type is absent", () => {
      const r = v.validate(file({ mime_type: undefined }));
      expect(r.valid).toBe(true);
    });

    it("rejects a filename longer than maxFileNameLength", () => {
      const longName = "a".repeat(256) + ".png";
      const r = v.validate(file({ display_name: longName }));
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("文件名过长"))).toBe(true);
    });
  });

  describe("checkFileSize()", () => {
    it("accepts an in-range size", () => {
      expect(v.checkFileSize(1024).valid).toBe(true);
    });

    it("rejects negative, zero, and oversize", () => {
      expect(v.checkFileSize(-1).valid).toBe(false);
      expect(v.checkFileSize(0).errors).toContain("文件大小过小，可能是空文件");
      const big = v.checkFileSize(501 * 1024 * 1024);
      expect(big.valid).toBe(false);
      expect(big.errors[0]).toContain("文件过大");
    });

    it("rejects non-number sizes (undefined / string)", () => {
      expect(v.checkFileSize(undefined).errors).toContain("文件大小无效");
      expect(v.checkFileSize("1024").errors).toContain("文件大小无效");
    });

    it("rejects NaN size (regression: NaN used to pass every check)", () => {
      // typeof NaN === 'number' and NaN < x / NaN > x are both false, so
      // before the Number.isNaN guard a NaN size validated as valid.
      const r = v.checkFileSize(NaN);
      expect(r.valid).toBe(false);
      expect(r.errors).toContain("文件大小无效");
    });

    it("still classifies Infinity as oversize (not 'invalid')", () => {
      // The NaN fix is surgical and must not reroute Infinity's message.
      const r = v.checkFileSize(Infinity);
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain("文件过大");
    });
  });

  describe("checkFileExtension()", () => {
    it("blocks executable extensions (.exe, .sh, .js, .apk)", () => {
      for (const name of ["a.exe", "b.sh", "c.js", "d.apk"]) {
        expect(v.checkFileExtension(name).valid).toBe(false);
      }
    });

    it("is case-insensitive on the extension", () => {
      expect(v.checkFileExtension("LOUD.EXE").valid).toBe(false);
    });

    it("allows a normal document extension", () => {
      const r = v.checkFileExtension("report.pdf");
      expect(r.valid).toBe(true);
      expect(r.warnings).toEqual([]);
    });

    it("catches a hidden dangerous extension even when the last ext is safe", () => {
      // path.extname('invoice.exe.pdf') === '.pdf' (not blocked), but the
      // embedded '.exe' must be detected.
      const r = v.checkFileExtension("invoice.exe.pdf");
      expect(r.valid).toBe(false);
      expect(r.errors).toContain("文件名包含隐藏的危险扩展名");
    });

    it("warns on 3+ extension segments but not on a single double-extension", () => {
      // Heuristic: warning only triggers when extParts.length > 2.
      expect(v.checkFileExtension("archive.tar.gz").warnings).toEqual([]);
      expect(
        v
          .checkFileExtension("weird.a.b.c")
          .warnings.some((w) => w.includes("多个扩展名")),
      ).toBe(true);
    });

    it("handles a file with no extension", () => {
      const r = v.checkFileExtension("README");
      expect(r.valid).toBe(true);
      expect(r.warnings).toEqual([]);
    });
  });

  describe("checkMimeType()", () => {
    it("treats absent mime as a warning, still valid", () => {
      const r = v.checkMimeType("");
      expect(r.valid).toBe(true);
      expect(r.warnings).toContain("MIME类型未指定");
    });

    it("blocks explicitly dangerous MIME types", () => {
      expect(v.checkMimeType("application/x-sh").valid).toBe(false);
    });

    it("accepts wildcard-matched patterns (text/*, image/*, vnd.ms-*)", () => {
      expect(v.checkMimeType("text/plain").valid).toBe(true);
      expect(v.checkMimeType("image/jpeg").valid).toBe(true);
      expect(v.checkMimeType("application/vnd.ms-excel").valid).toBe(true);
    });

    it("rejects an unsupported MIME type", () => {
      expect(v.checkMimeType("application/x-custom-thing").valid).toBe(false);
    });

    it("adds a warning when MIME hints at executable/script but is allowed", () => {
      // 'text/x-executable' matches 'text/*' (allowed) but the substring
      // check still raises an advisory warning.
      const r = v.checkMimeType("text/x-executable");
      expect(r.valid).toBe(true);
      expect(r.warnings.some((w) => w.includes("可执行文件"))).toBe(true);
    });
  });

  describe("checkFileName()", () => {
    it("never invalidates (warnings only)", () => {
      expect(v.checkFileName('a<b>:"|?*.txt').valid).toBe(true);
    });

    it("warns on dangerous characters and control chars", () => {
      expect(
        v
          .checkFileName("bad:name.txt")
          .warnings.some((w) => w.includes("特殊字符")),
      ).toBe(true);
      expect(
        v
          .checkFileName("ctrlname.txt")
          .warnings.some((w) => w.includes("特殊字符")),
      ).toBe(true);
    });

    it("warns on non-ASCII (Unicode) filenames", () => {
      expect(
        v.checkFileName("发票.pdf").warnings.some((w) => w.includes("非ASCII")),
      ).toBe(true);
    });

    it("warns on hidden dotfiles but not on '.' alone", () => {
      expect(
        v.checkFileName(".bashrc").warnings.some((w) => w.includes("隐藏文件")),
      ).toBe(true);
      expect(v.checkFileName(".").warnings).toEqual([]);
    });
  });

  describe("validateBatch()", () => {
    it("tallies valid / invalid / warnings across a list", () => {
      const r = v.validateBatch([
        file(), // valid, no warnings
        file({ display_name: "bad.exe" }), // invalid
        file({ display_name: "发票.png" }), // valid + warning (non-ascii)
      ]);
      expect(r.total).toBe(3);
      expect(r.valid).toBe(2);
      expect(r.invalid).toBe(1);
      expect(r.warnings).toBe(1);
      expect(r.details).toHaveLength(3);
      expect(r.details[1].fileName).toBe("bad.exe");
    });
  });

  describe("getConfig() / updateConfig()", () => {
    it("exposes counts and the underlying config", () => {
      const cfg = v.getConfig();
      expect(cfg.allowedMimePatternsCount).toBe(cfg.allowedMimePatterns.length);
      expect(cfg.blockedExtensionsCount).toBe(cfg.blockedExtensions.length);
    });

    it("merges custom constructor config and updateConfig", () => {
      const custom = new FileSecurityValidator({ maxFileSize: 10 });
      expect(custom.checkFileSize(100).valid).toBe(false); // over the tiny cap
      custom.updateConfig({ maxFileSize: 1000 });
      expect(custom.checkFileSize(100).valid).toBe(true);
    });
  });

  describe("type predicates", () => {
    it("isImage / isVideo / isDocument by mime prefix", () => {
      expect(v.isImage(file({ mime_type: "image/png" }))).toBe(true);
      expect(v.isImage(file({ mime_type: "text/plain" }))).toBe(false);
      expect(v.isVideo(file({ mime_type: "video/mp4" }))).toBe(true);
      expect(v.isDocument(file({ mime_type: "application/pdf" }))).toBe(true);
      expect(v.isDocument(file({ mime_type: "text/markdown" }))).toBe(true);
      expect(v.isDocument(file({ mime_type: "image/png" }))).toBe(false);
    });

    it("predicates are safe when mime_type is missing", () => {
      expect(v.isImage(file({ mime_type: undefined }))).toBeFalsy();
    });
  });

  describe("getRiskLevel()", () => {
    it("returns 'high' for an invalid file", () => {
      expect(v.getRiskLevel(file({ display_name: "x.exe" }))).toBe("high");
    });

    it("returns 'low' for a clean file", () => {
      expect(v.getRiskLevel(file())).toBe("low");
    });

    it("returns 'medium' only when warnings exceed 2", () => {
      // non-ascii + dotfile + dangerous-char + 3-seg-ext => 4 warnings, valid.
      const risky = file({
        display_name: ".发票:report.a.b.c",
        mime_type: "image/png",
      });
      const r = v.validate(risky);
      expect(r.valid).toBe(true);
      expect(r.warnings.length).toBeGreaterThan(2);
      expect(v.getRiskLevel(risky)).toBe("medium");
    });
  });
});
