/**
 * REPL `!` bash passthrough + `#` quick-memorize lib.
 * Real spawnSync (node -e scripts via files per the dash-syntax-error lesson —
 * here we stay on simple echo-able commands) + real temp dirs.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import {
  isBangCommand,
  isMemorizeLine,
  runBangCommand,
  appendMemoryNote,
} from "../../src/lib/repl-bang-memorize.js";

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-bangmem-"));
});

afterEach(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("prefix detection", () => {
  it("recognizes ! commands and # notes, rejects bare prefixes", () => {
    expect(isBangCommand("!git status")).toBe(true);
    expect(isBangCommand("! ls")).toBe(true);
    expect(isBangCommand("!")).toBe(false);
    expect(isBangCommand("hello!")).toBe(false);
    expect(isMemorizeLine("# tests need --runInBand")).toBe(true);
    expect(isMemorizeLine("#")).toBe(false);
    expect(isMemorizeLine("no # here")).toBe(false);
  });
});

describe("runBangCommand", () => {
  it("runs a real command, captures stdout and exit code 0", () => {
    const res = runBangCommand("!echo bang-ok", { cwd: tmp });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("bang-ok");
    expect(res.error).toBeNull();
    expect(res.contextMessage.role).toBe("user");
    expect(res.contextMessage.content).toContain("<bash-input>echo bang-ok</bash-input>");
    expect(res.contextMessage.content).toContain('exit-code="0"');
  });

  it("propagates non-zero exit codes", () => {
    const res = runBangCommand("!exit 3", { cwd: tmp });
    expect(res.exitCode).toBe(3);
    expect(res.contextMessage.content).toContain('exit-code="3"');
  });

  it("uses the injected spawnSync seam", () => {
    let seen = null;
    const res = runBangCommand("! fake cmd", {
      cwd: tmp,
      platform: "linux",
      deps: {
        spawnSync: (bin, args) => {
          seen = { bin, args };
          return { status: 0, stdout: "stub-out", stderr: "" };
        },
      },
    });
    expect(seen.bin).toBe("/bin/sh");
    expect(seen.args).toEqual(["-c", "fake cmd"]);
    expect(res.stdout).toBe("stub-out");
  });

  it("wraps through cmd.exe with chcp 65001 on win32", () => {
    let seen = null;
    runBangCommand("!dir", {
      cwd: tmp,
      platform: "win32",
      deps: {
        spawnSync: (bin, args) => {
          seen = { bin, args };
          return { status: 0, stdout: "", stderr: "" };
        },
      },
    });
    expect(seen.bin).toBe("cmd.exe");
    expect(seen.args[seen.args.length - 1]).toBe("chcp 65001 >nul && dir");
  });
});

describe("appendMemoryNote", () => {
  it("creates cc.md with a Notes section at the git root", () => {
    fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "deep", "dir"), { recursive: true });
    const res = appendMemoryNote("# always run lint before commit", {
      cwd: path.join(tmp, "deep", "dir"),
      date: "2026-06-11",
    });
    expect(res.created).toBe(true);
    expect(res.target).toBe(path.join(tmp, "cc.md"));
    const text = fs.readFileSync(res.target, "utf-8");
    expect(text).toContain("## Notes");
    expect(text).toContain("- always run lint before commit _(noted 2026-06-11)_");
  });

  it("inserts under an existing Notes heading", () => {
    fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "cc.md"),
      "# Mem\n\n## Notes\n\n- older note\n",
      "utf-8",
    );
    appendMemoryNote("# newest note", { cwd: tmp, date: "2026-06-11" });
    const text = fs.readFileSync(path.join(tmp, "cc.md"), "utf-8");
    const newestIdx = text.indexOf("- newest note");
    const olderIdx = text.indexOf("- older note");
    expect(newestIdx).toBeGreaterThan(-1);
    expect(newestIdx).toBeLessThan(olderIdx); // newest on top
  });

  it("appends a Notes section to a file without one", () => {
    fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "cc.md"), "# Mem\n\n## Stack\n- node\n", "utf-8");
    const res = appendMemoryNote("# fresh", { cwd: tmp, date: "2026-06-11" });
    expect(res.created).toBe(false);
    const text = fs.readFileSync(path.join(tmp, "cc.md"), "utf-8");
    expect(text).toMatch(/## Stack[\s\S]*## Notes[\s\S]*- fresh/);
  });

  it("round-trips: the note is picked up by the project-instructions loader", async () => {
    fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });
    appendMemoryNote("# loader sees this", { cwd: tmp, date: "2026-06-11" });
    const { loadProjectInstructions } = await import(
      "../../src/lib/project-instructions.js"
    );
    const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "cc-bangmem-home-"));
    try {
      const loaded = loadProjectInstructions({ cwd: tmp, home: emptyHome });
      expect(loaded.files.map((f) => f.content).join("\n")).toContain(
        "loader sees this",
      );
    } finally {
      fs.rmSync(emptyHome, { recursive: true, force: true });
    }
  });
});
