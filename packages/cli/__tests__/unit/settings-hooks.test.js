/**
 * settings-hooks — load + match .claude/settings.json `hooks` blocks.
 *
 * Covers hierarchy concatenation (no dedup, order preserved), command-only
 * filtering, matcher against both the CC umbrella (Bash) and raw tool
 * (run_shell), pipe/wildcard/regex matchers, and fail-open on bad JSON. The
 * `_deps.fs` seam is replaced with an in-memory map.
 */
import { describe, it, expect, beforeEach } from "vitest";
import sh from "../../src/lib/settings-hooks.cjs";

const { loadHooks, collectHooks, _deps } = sh;
const isWin = process.platform === "win32";
const HOME = isWin ? "C:\\home\\u" : "/home/u";
const CWD = isWin ? "C:\\proj" : "/proj";
const sep = isWin ? "\\" : "/";
const j = (...p) => p.join(sep);

const userFile = j(HOME, ".claude", "settings.json");
const projFile = j(CWD, ".claude", "settings.json");
const localFile = j(CWD, ".claude", "settings.local.json");

let files;
const setFile = (p, obj) => (files[p] = JSON.stringify(obj));

beforeEach(() => {
  files = {};
  _deps.homedir = () => HOME;
  _deps.fs = {
    existsSync: (p) => Object.prototype.hasOwnProperty.call(files, p),
    readFileSync: (p) => {
      if (!(p in files)) throw new Error("ENOENT");
      return files[p];
    },
  };
});

const cmdGroup = (matcher, command) => ({
  matcher,
  hooks: [{ type: "command", command }],
});

describe("loadHooks — hierarchy concatenation", () => {
  it("concatenates hook groups across user/project/local in order", () => {
    setFile(userFile, { hooks: { PreToolUse: [cmdGroup("Bash", "u.sh")] } });
    setFile(projFile, { hooks: { PreToolUse: [cmdGroup("Edit", "p.sh")] } });
    setFile(localFile, { hooks: { PreToolUse: [cmdGroup("*", "l.sh")] } });
    const { hooks, files: contributed } = loadHooks({ cwd: CWD });
    expect(hooks.PreToolUse.map((g) => g.hooks[0].command)).toEqual([
      "u.sh",
      "p.sh",
      "l.sh",
    ]);
    expect(contributed).toEqual([userFile, projFile, localFile]);
  });

  it("filters out non-command hook entries", () => {
    setFile(projFile, {
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "notify", command: "x" }] },
          cmdGroup("Bash", "ok.sh"),
        ],
      },
    });
    const { hooks } = loadHooks({ cwd: CWD });
    expect(hooks.PreToolUse).toHaveLength(1);
    expect(hooks.PreToolUse[0].hooks[0].command).toBe("ok.sh");
  });

  it("fails open (skips) a malformed settings file", () => {
    files[projFile] = "{ not json";
    let warned = "";
    const { hooks } = loadHooks({ cwd: CWD, onWarn: (m) => (warned = m) });
    expect(hooks).toEqual({});
    expect(warned).toMatch(/malformed/);
  });

  it("returns empty when no settings files exist", () => {
    expect(loadHooks({ cwd: CWD })).toEqual({ hooks: {}, files: [] });
  });
});

describe("collectHooks — matcher resolution", () => {
  const block = {
    PreToolUse: [
      cmdGroup("Bash", "bash.sh"),
      cmdGroup("Edit|Write", "edit.sh"),
      cmdGroup("*", "all.sh"),
    ],
  };

  it("matches the CC umbrella name (Bash → run_shell)", () => {
    expect(collectHooks(block, "PreToolUse", "run_shell").map((h) => h.command)).toEqual([
      "bash.sh",
      "all.sh",
    ]);
  });

  it("matches the raw tool name too", () => {
    const b = { PreToolUse: [cmdGroup("run_shell", "raw.sh")] };
    expect(collectHooks(b, "PreToolUse", "run_shell")[0].command).toBe("raw.sh");
  });

  it("pipe matcher matches either alternative (Edit|Write)", () => {
    expect(collectHooks(block, "PreToolUse", "write_file").map((h) => h.command)).toEqual([
      "edit.sh",
      "all.sh",
    ]);
  });

  it("`*` matches every tool; unmatched tool gets only `*`", () => {
    expect(collectHooks(block, "PreToolUse", "read_file").map((h) => h.command)).toEqual([
      "all.sh",
    ]);
  });

  it("regex matcher (/^Bash$/) works", () => {
    const b = { PreToolUse: [cmdGroup("/^Bash$/", "re.sh")] };
    expect(collectHooks(b, "PreToolUse", "run_shell")[0].command).toBe("re.sh");
    expect(collectHooks(b, "PreToolUse", "read_file")).toEqual([]);
  });

  it("returns [] for an event with no groups", () => {
    expect(collectHooks(block, "PostToolUse", "run_shell")).toEqual([]);
  });
});
