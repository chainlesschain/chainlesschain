/**
 * validateOperation — project-directory boundary (sibling-prefix traversal).
 *
 * Bug: boundary check was `!absolutePath.startsWith(normalizedProjectPath)`.
 * Without a trailing separator, a sibling directory whose name *extends* the
 * project name passes: projectPath ".../myproj" admits ".../myproj-evil/x.js"
 * (startsWith is true). Since validateOperation gates AI-proposed file writes,
 * this lets a CREATE/UPDATE escape the project sandbox into a prefix-sibling.
 * Fix requires the match to be the dir itself or dir+separator.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const path = require("path");
const { validateOperation } = require("../response-parser.js");

describe("validateOperation project-directory boundary", () => {
  const projectPath = path.resolve("/tmp/myproj");

  it("allows a legitimate in-project path", () => {
    const r = validateOperation(
      { type: "CREATE", path: "src/app.js", content: "x" },
      projectPath,
    );
    expect(r.valid).toBe(true);
  });

  it("blocks a sibling dir whose name extends the project name", () => {
    // ../myproj-evil/x.js resolves to a sibling of the project root
    const sibling = ".." + path.sep + "myproj-evil" + path.sep + "x.js";
    const r = validateOperation(
      { type: "CREATE", path: sibling, content: "x" },
      projectPath,
    );
    // 旧实现 startsWith 放过兄弟目录 → valid:true（沙箱逃逸）
    expect(r.valid).toBe(false);
  });

  it("still blocks a parent-directory escape (regression)", () => {
    const escape =
      ".." + path.sep + ".." + path.sep + "etc" + path.sep + "passwd";
    const r = validateOperation(
      { type: "CREATE", path: escape, content: "x" },
      projectPath,
    );
    expect(r.valid).toBe(false);
  });
});
