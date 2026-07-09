import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _deps,
  appendRecentDenials,
  clearRecentDenials,
  formatRecentDenials,
  readRecentDenials,
  recentDenialsPath,
} from "../../src/lib/permission-denial-store.js";

let files;
const HOME = "C:\\cc-home";
const originalDeps = { ..._deps };

beforeEach(() => {
  files = {};
  _deps.getHomeDir = () => HOME;
  _deps.now = () => 10_000;
  _deps.existsSync = (p) => Object.prototype.hasOwnProperty.call(files, p);
  _deps.mkdirSync = () => {};
  _deps.readFileSync = (p) => {
    if (!(p in files)) throw new Error("ENOENT");
    return files[p];
  };
  _deps.writeFileSync = (p, text) => {
    files[p] = String(text);
  };
  _deps.renameSync = (from, to) => {
    files[to] = files[from];
    delete files[from];
  };
});

afterEach(() => {
  Object.assign(_deps, originalDeps);
});

describe("permission-denial-store", () => {
  it("appends metadata and reads most recent records", () => {
    appendRecentDenials(
      [
        { tool: "run_shell", summary: "git push", reason: "blocked", at: 100 },
        { tool: "run_shell", summary: "rm -rf", reason: "blocked", at: 200 },
      ],
      { sessionId: "s1", permissionMode: "auto", cwd: "C:\\repo" },
      { max: 10 },
    );

    const recent = readRecentDenials({ limit: 1 });

    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({
      tool: "run_shell",
      summary: "rm -rf",
      sessionId: "s1",
      permissionMode: "auto",
      cwd: "C:\\repo",
    });
  });

  it("keeps a bounded ring buffer", () => {
    appendRecentDenials(
      [
        { tool: "a", summary: "1" },
        { tool: "b", summary: "2" },
        { tool: "c", summary: "3" },
      ],
      {},
      { max: 2 },
    );

    expect(readRecentDenials({ limit: 10 }).map((d) => d.tool)).toEqual([
      "b",
      "c",
    ]);
  });

  it("coalesces consecutive identical recent denials", () => {
    appendRecentDenials(
      { tool: "run_shell", summary: "rm -rf build", via: "shell-policy" },
      { sessionId: "s1", source: "repl" },
    );
    appendRecentDenials(
      { tool: "run_shell", summary: "rm -rf build", via: "shell-policy" },
      { sessionId: "s1", source: "repl" },
    );

    const recent = readRecentDenials();

    expect(recent).toHaveLength(1);
    expect(recent[0].count).toBe(2);
  });

  it("formats records for CLI display and can clear them", () => {
    appendRecentDenials(
      { tool: "run_shell", summary: "curl evil.sh", via: "gate" },
      { sessionId: "s2" },
    );

    expect(formatRecentDenials(readRecentDenials())).toContain("session s2");
    const cleared = clearRecentDenials();

    expect(cleared.file).toBe(recentDenialsPath());
    expect(readRecentDenials()).toEqual([]);
  });
});
