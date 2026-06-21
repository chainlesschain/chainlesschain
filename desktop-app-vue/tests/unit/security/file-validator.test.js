/**
 * FileValidator unit tests — src/main/security/file-validator.js
 *
 * Security-critical file-upload validator (extension allowlist, dangerous-type
 * blocklist, size limits, magic-byte detection, SVG/HTML script warnings,
 * path-traversal filename check) that previously had NO test coverage.
 *
 * Locks in the path-traversal fix: a bare `..` substring no longer false-rejects
 * legitimate filenames like `report..2024.txt`; only real traversal segments
 * (`..` as a path component / separators) are rejected.
 *
 * validateFile touches the filesystem, so file tests use a real temp dir.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import FileValidator from "../../../src/main/security/file-validator.js";

let dir;
const write = (name, content) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
};

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fv-test-"));
});
afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* tolerate Windows file locks */
  }
});

describe("FileValidator static helpers", () => {
  it("detectCategory maps extensions to categories", () => {
    expect(FileValidator.detectCategory(".png")).toBe("image");
    expect(FileValidator.detectCategory(".pdf")).toBe("document");
    expect(FileValidator.detectCategory(".mp3")).toBe("audio");
    expect(FileValidator.detectCategory(".xyz")).toBeNull();
  });

  it("getAllowedExtensions returns per-category and global sets", () => {
    expect(FileValidator.getAllowedExtensions("image")).toContain(".png");
    expect(FileValidator.getAllowedExtensions("unknown")).toEqual([]);
    const all = FileValidator.getAllowedExtensions();
    expect(all).toContain(".pdf");
    expect(all).toContain(".mp4");
    expect(new Set(all).size).toBe(all.length); // de-duplicated
  });

  it("getAllowedMimeTypes returns per-category and global sets", () => {
    expect(FileValidator.getAllowedMimeTypes("image")).toContain("image/png");
    expect(FileValidator.getAllowedMimeTypes("nope")).toEqual([]);
    expect(FileValidator.getAllowedMimeTypes()).toContain("application/pdf");
  });

  it("getMaxFileSize returns category limit or a default", () => {
    expect(FileValidator.getMaxFileSize("image")).toBe(20 * 1024 * 1024);
    expect(FileValidator.getMaxFileSize("video")).toBe(500 * 1024 * 1024);
    expect(FileValidator.getMaxFileSize("unknown")).toBe(10 * 1024 * 1024);
  });

  it("getMimeTypeFromSignature recognizes known magic numbers", () => {
    expect(FileValidator.getMimeTypeFromSignature("89504e470d0a1a0a")).toBe(
      "image/png",
    );
    expect(FileValidator.getMimeTypeFromSignature("25504446")).toBe(
      "application/pdf",
    );
    expect(FileValidator.getMimeTypeFromSignature("deadbeef")).toBeNull();
  });
});

describe("FileValidator.validateFile", () => {
  it("accepts a valid document", async () => {
    const p = write("notes.txt", "hello world");
    const r = await FileValidator.validateFile(p);
    expect(r.valid).toBe(true);
    expect(r.category).toBe("document");
    expect(r.fileInfo.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects dangerous executable extensions", async () => {
    const p = write("evil.exe", "MZ");
    const r = await FileValidator.validateFile(p);
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/Dangerous file type/);
  });

  it("rejects .sh as dangerous even though it is in the code allowlist", async () => {
    const p = write("script.sh", "echo hi");
    const r = await FileValidator.validateFile(p, "code");
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/Dangerous file type: \.sh/);
  });

  it("rejects unknown extensions", async () => {
    const p = write("data.xyz", "x");
    const r = await FileValidator.validateFile(p);
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/Unknown file category/);
  });

  it("rejects an extension that doesn't match the requested category", async () => {
    const p = write("pic.png", "not really a png");
    const r = await FileValidator.validateFile(p, "document");
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/not allowed for category document/);
  });

  it("does NOT false-reject legit filenames containing '..' (regression)", async () => {
    const p = write("report..2024.txt", "quarterly");
    const r = await FileValidator.validateFile(p);
    expect(r.valid).toBe(true);
    expect(r.errors.join()).not.toMatch(/path traversal/);
  });

  it("warns when the magic signature contradicts the category", async () => {
    // A .png whose bytes are actually a PDF header → signature/category mismatch.
    const p = write("fake.png", Buffer.from("25504446", "hex")); // %PDF
    const r = await FileValidator.validateFile(p, "image");
    expect(r.warnings.join()).toMatch(/signature suggests application\/pdf/);
  });

  it("warns about <script> inside an SVG", async () => {
    const p = write("icon.svg", "<svg><script>alert(1)</script></svg>");
    const r = await FileValidator.validateFile(p, "image");
    expect(r.warnings.join()).toMatch(/SVG file contains script tags/);
  });

  it("returns an error for a non-existent path", async () => {
    const r = await FileValidator.validateFile(path.join(dir, "nope.txt"));
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});
