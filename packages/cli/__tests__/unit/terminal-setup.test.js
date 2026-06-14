/** terminal-setup — pure detection + keybindings.json shaping (no real fs). */
import { describe, it, expect } from "vitest";
import {
  detectTerminal,
  vscodeKeybinding,
  vscodeKeybindingsPath,
  stripJsonc,
  parseKeybindings,
  hasKeybinding,
  appendKeybindingText,
  instructionsFor,
  SHIFT_ENTER_SEQUENCE,
} from "../../src/lib/terminal-setup.js";
import { runTerminalSetup } from "../../src/commands/terminal-setup.js";

describe("detectTerminal", () => {
  it("identifies common terminals from env", () => {
    expect(detectTerminal({ TERM_PROGRAM: "vscode" }).id).toBe("vscode");
    expect(detectTerminal({ VSCODE_PID: "1" }).id).toBe("vscode");
    expect(detectTerminal({ TERM_PROGRAM: "iTerm.app" }).id).toBe("iterm2");
    expect(detectTerminal({ TERM_PROGRAM: "Apple_Terminal" }).id).toBe(
      "apple-terminal",
    );
    expect(detectTerminal({ WT_SESSION: "x" }).id).toBe("windows-terminal");
    expect(detectTerminal({}).id).toBe("unknown");
  });
});

describe("vscodeKeybinding + path", () => {
  it("sends the space-backslash-CR sequence on shift+enter in the terminal", () => {
    const b = vscodeKeybinding();
    expect(b).toMatchObject({
      key: "shift+enter",
      command: "workbench.action.terminal.sendSequence",
      when: "terminalFocus",
    });
    expect(b.args.text).toBe(SHIFT_ENTER_SEQUENCE);
    expect(SHIFT_ENTER_SEQUENCE).toBe(" \\\r");
  });
  it("resolves per-OS keybindings paths", () => {
    expect(vscodeKeybindingsPath("win32", { APPDATA: "C:\\AppData" })).toBe(
      "C:\\AppData\\Code\\User\\keybindings.json",
    );
    expect(vscodeKeybindingsPath("darwin", {})).toMatch(
      /Application Support[\\/]Code[\\/]User/,
    );
    expect(vscodeKeybindingsPath("linux", {})).toMatch(
      /\.config[\\/]Code[\\/]User/,
    );
  });
});

describe("JSONC parsing", () => {
  it("strips line/block comments and trailing commas", () => {
    const txt = `[
      // a comment
      { "key": "ctrl+a", "command": "x" }, /* trailing */
    ]`;
    const arr = parseKeybindings(txt);
    expect(arr).toHaveLength(1);
    expect(arr[0].command).toBe("x");
  });
  it("keeps // inside strings intact", () => {
    expect(stripJsonc('{ "u": "http://x" }')).toContain("http://x");
  });
  it("returns [] for empty and null for non-arrays", () => {
    expect(parseKeybindings("")).toEqual([]);
    expect(parseKeybindings("{ not: array }")).toBeNull();
  });
});

describe("hasKeybinding + appendKeybindingText", () => {
  const binding = vscodeKeybinding();
  it("detects an equivalent existing binding", () => {
    expect(hasKeybinding([binding], binding)).toBe(true);
    expect(hasKeybinding([{ ...binding, key: "ctrl+z" }], binding)).toBe(false);
    expect(hasKeybinding([], binding)).toBe(false);
  });
  it("creates a fresh array when the file is empty/[]", () => {
    const out = appendKeybindingText("", binding);
    expect(parseKeybindings(out)).toHaveLength(1);
    expect(appendKeybindingText("[]", binding)).toContain("shift+enter");
  });
  it("appends before the closing bracket, preserving prior entries + comments", () => {
    const existing = `[
  // keep me
  { "key": "ctrl+a", "command": "x" }
]`;
    const out = appendKeybindingText(existing, binding);
    expect(out).toContain("// keep me");
    const arr = parseKeybindings(out);
    expect(arr).toHaveLength(2);
    expect(hasKeybinding(arr, binding)).toBe(true);
  });
  it("returns null when the text is not an array", () => {
    expect(appendKeybindingText("{ }", binding)).toBeNull();
  });
});

describe("instructionsFor", () => {
  it("gives terminal-specific steps and a generic fallback", () => {
    expect(instructionsFor("iterm2").join(" ")).toMatch(/iTerm2/);
    expect(instructionsFor("windows-terminal").join(" ")).toMatch(/sendInput/);
    expect(instructionsFor("unknown").join(" ")).toMatch(/trailing/);
  });
});

describe("runTerminalSetup (injected fs)", () => {
  const vscodeEnv = { TERM_PROGRAM: "vscode", APPDATA: "C:\\AppData" };

  it("previews (no write) by default for VS Code", () => {
    let wrote = false;
    const _fs = {
      readFileSync: () => "[]",
      writeFileSync: () => {
        wrote = true;
      },
      mkdirSync: () => {},
    };
    const res = runTerminalSetup({
      apply: false,
      env: vscodeEnv,
      platform: "win32",
      _fs,
    });
    expect(res.changed).toBe(false);
    expect(wrote).toBe(false);
    expect(res.lines.join("\n")).toMatch(/cc terminal-setup --apply/);
  });

  it("writes the binding (+ backup) on --apply", () => {
    const files = {};
    const _fs = {
      readFileSync: (p) => {
        if (p in files) return files[p];
        throw new Error("ENOENT");
      },
      writeFileSync: (p, c) => {
        files[p] = c;
      },
      mkdirSync: () => {},
    };
    const res = runTerminalSetup({
      apply: true,
      env: vscodeEnv,
      platform: "win32",
      _fs,
    });
    expect(res.changed).toBe(true);
    const written = files["C:\\AppData\\Code\\User\\keybindings.json"];
    expect(hasKeybinding(parseKeybindings(written), vscodeKeybinding())).toBe(
      true,
    );
  });

  it("is idempotent — already-configured is a no-op", () => {
    const path = "C:\\AppData\\Code\\User\\keybindings.json";
    let writes = 0;
    const _fs = {
      readFileSync: () => JSON.stringify([vscodeKeybinding()]),
      writeFileSync: () => {
        writes += 1;
      },
      mkdirSync: () => {},
    };
    const res = runTerminalSetup({
      apply: true,
      env: vscodeEnv,
      platform: "win32",
      _fs,
    });
    expect(res.changed).toBe(false);
    expect(writes).toBe(0);
    expect(res.lines.join("\n")).toMatch(/Already configured/);
  });

  it("prints manual instructions for non-VS-Code terminals", () => {
    const res = runTerminalSetup({
      apply: true,
      env: { WT_SESSION: "x" },
      platform: "win32",
    });
    expect(res.terminal).toBe("windows-terminal");
    expect(res.changed).toBe(false);
    expect(res.lines.join("\n")).toMatch(/sendInput/);
  });
});
