/**
 * Security regression: env-file-manager's resolveEnvPath took a skill-supplied
 * path and returned absolute paths as-is / path.join'd relatives with no `..`
 * guard, so the agent could read/write a .env over an arbitrary file. It must now
 * confine all targets to the project root.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";

const handler = require("../../../../src/main/ai-engine/cowork/skills/builtin/env-file-manager/handler.js");

const ROOT = path.resolve(path.join("C:", "fake", "project"));

describe("env-file-manager resolveEnvPath (path traversal guard)", () => {
  it("allows in-project relative paths", () => {
    expect(handler.resolveEnvPath(".env", ROOT)).toBe(path.join(ROOT, ".env"));
    expect(handler.resolveEnvPath("config/.env.prod", ROOT)).toBe(
      path.join(ROOT, "config", ".env.prod"),
    );
  });

  it("rejects ../ escape and absolute paths", () => {
    expect(() => handler.resolveEnvPath("../../etc/passwd", ROOT)).toThrow(
      /escapes project root/,
    );
    expect(() =>
      handler.resolveEnvPath(path.join("C:", "windows", "x"), ROOT),
    ).toThrow(/escapes project root/);
    expect(() => handler.resolveEnvPath("../sibling/.env", ROOT)).toThrow(
      /escapes project root/,
    );
  });

  it("does not treat a sibling dir with a shared prefix as in-root", () => {
    // ROOT="/fake/project" must not accept "/fake/project-evil/.env"
    expect(() => handler.resolveEnvPath("../project-evil/.env", ROOT)).toThrow(
      /escapes project root/,
    );
  });
});
