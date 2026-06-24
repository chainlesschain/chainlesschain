/**
 * FileValidator — SVG inline event-handler XSS detection.
 *
 * Gap: performSecurityChecks flagged inline event handlers (/on\w+\s*=/) for
 * HTML files but not for SVG — yet an SVG like `<svg onload="alert(1)">` runs
 * script with no <script> tag, and SVG renders inline (a prime XSS vector).
 * Fix adds the same event-handler check to the SVG branch.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import FileValidator from "../../../src/main/security/file-validator.js";

describe("FileValidator SVG inline event-handler XSS detection", () => {
  let dir;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fv-svg-"));
  });
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeSvg(name, content) {
    const p = path.join(dir, name);
    fs.writeFileSync(p, content);
    return p;
  }

  it("warns on an SVG with an inline event handler (onload)", async () => {
    const p = writeSvg(
      "evil.svg",
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect/></svg>',
    );
    const result = { warnings: [], errors: [], fileInfo: {} };
    await FileValidator.performSecurityChecks(p, result);
    expect(result.warnings.some((w) => /inline event handlers/i.test(w))).toBe(
      true,
    );
  });

  it("does not warn (event handler) on a clean SVG", async () => {
    const p = writeSvg(
      "clean.svg",
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
    );
    const result = { warnings: [], errors: [], fileInfo: {} };
    await FileValidator.performSecurityChecks(p, result);
    expect(result.warnings.some((w) => /inline event handlers/i.test(w))).toBe(
      false,
    );
  });
});
