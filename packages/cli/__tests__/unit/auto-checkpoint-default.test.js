/** Auto-checkpoint default resolution (Claude-Code parity: on in git repos). */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import {
  isInsideGitRepo,
  resolveAutoCheckpoint,
} from "../../src/lib/auto-checkpoint-default.js";

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-autockpt-"));
});

afterEach(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("isInsideGitRepo", () => {
  it("detects .git walking up; false outside", () => {
    fs.mkdirSync(path.join(tmp, "repo", ".git"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "repo", "deep", "dir"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "plain"), { recursive: true });
    expect(isInsideGitRepo(path.join(tmp, "repo", "deep", "dir"))).toBe(true);
    expect(isInsideGitRepo(path.join(tmp, "plain"))).toBe(false);
  });
});

describe("resolveAutoCheckpoint", () => {
  it("explicit --checkpoint / --no-checkpoint always wins", () => {
    fs.mkdirSync(path.join(tmp, "plain"), { recursive: true });
    expect(
      resolveAutoCheckpoint({
        flagValue: true,
        flagSource: "cli",
        cwd: path.join(tmp, "plain"), // non-git, still forced on
      }),
    ).toBe(true);
    fs.mkdirSync(path.join(tmp, "repo", ".git"), { recursive: true });
    expect(
      resolveAutoCheckpoint({
        flagValue: false,
        flagSource: "cli",
        cwd: path.join(tmp, "repo"), // git, still forced off
      }),
    ).toBe(false);
  });

  it("default: on inside a git repo, off elsewhere", () => {
    fs.mkdirSync(path.join(tmp, "repo", ".git"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "plain"), { recursive: true });
    expect(
      resolveAutoCheckpoint({
        flagValue: true, // commander default from the --no- pair
        flagSource: "default",
        cwd: path.join(tmp, "repo"),
      }),
    ).toBe(true);
    expect(
      resolveAutoCheckpoint({
        flagValue: true,
        flagSource: "default",
        cwd: path.join(tmp, "plain"),
      }),
    ).toBe(false);
  });
});
