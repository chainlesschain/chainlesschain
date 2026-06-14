/**
 * terminal-setup — make Shift+Enter insert a newline in the agent REPL
 * (Claude-Code `/terminal-setup` parity).
 *
 * cc's REPL is readline-based, so a bare Enter always submits. Multiline input
 * is reached by ending a line with a continuation backslash (see
 * repl-multiline.js). This module configures the terminal so that pressing
 * Shift+Enter emits the byte sequence `<space>\<CR>` — which cc's
 * backslash-continuation turns into a soft newline — giving the familiar
 * "Shift+Enter = newline, Enter = send" editing without any REPL raw-mode hacks.
 *
 * Everything here is pure (detection + keybindings JSON shaping); the command
 * (commands/terminal-setup.js) does the file I/O.
 */

import path from "node:path";
import os from "node:os";

/**
 * The bytes Shift+Enter should send: space + backslash + carriage return. The
 * leading space makes the trailing backslash satisfy repl-multiline's
 * whitespace-gated continuation rule (so it is never mistaken for a Windows
 * path), and the backslash is stripped back out when the line is joined.
 */
export const SHIFT_ENTER_SEQUENCE = " \\\r";

/** Identify the host terminal from environment variables. */
export function detectTerminal(env = process.env) {
  const tp = String(env.TERM_PROGRAM || "").toLowerCase();
  if (tp === "vscode" || env.VSCODE_PID || env.VSCODE_INJECTION) {
    return { id: "vscode", name: "VS Code integrated terminal" };
  }
  if (tp === "iterm.app") return { id: "iterm2", name: "iTerm2" };
  if (tp === "apple_terminal")
    return { id: "apple-terminal", name: "Apple Terminal" };
  if (tp === "wezterm") return { id: "wezterm", name: "WezTerm" };
  if (env.WT_SESSION)
    return { id: "windows-terminal", name: "Windows Terminal" };
  return {
    id: "unknown",
    name: env.TERM_PROGRAM || env.TERM || "your terminal",
  };
}

/** The VS Code keybinding that sends the Shift+Enter sequence in the terminal. */
export function vscodeKeybinding() {
  return {
    key: "shift+enter",
    command: "workbench.action.terminal.sendSequence",
    when: "terminalFocus",
    args: { text: SHIFT_ENTER_SEQUENCE },
  };
}

/** Per-OS path to VS Code's user keybindings.json. */
export function vscodeKeybindingsPath(
  platform = process.platform,
  env = process.env,
) {
  const home = os.homedir();
  if (platform === "win32") {
    const appData = env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, "Code", "User", "keybindings.json");
  }
  if (platform === "darwin") {
    return path.join(
      home,
      "Library",
      "Application Support",
      "Code",
      "User",
      "keybindings.json",
    );
  }
  return path.join(home, ".config", "Code", "User", "keybindings.json");
}

/**
 * Strip JSONC (line + block comments, trailing commas) so a keybindings.json
 * with comments can be parsed. Best-effort and string-aware enough for the
 * common case; callers must tolerate a null parse.
 */
export function stripJsonc(text) {
  let out = "";
  const s = String(text || "");
  let inStr = false;
  let strCh = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const n = s[i + 1];
    if (inStr) {
      out += c;
      if (c === "\\") {
        out += n ?? "";
        i += 2;
        continue;
      }
      if (c === strCh) inStr = false;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      strCh = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === "/" && n === "/") {
      while (i < s.length && s[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  // Drop trailing commas before } or ].
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/** Parse a JSONC keybindings array → array, or null when it cannot be parsed. */
export function parseKeybindings(text) {
  const src = String(text || "").trim();
  if (!src) return [];
  try {
    const v = JSON.parse(stripJsonc(src));
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** True when an equivalent keybinding (key+command+when) already exists. */
export function hasKeybinding(arr, binding) {
  return (Array.isArray(arr) ? arr : []).some(
    (b) =>
      b &&
      b.key === binding.key &&
      b.command === binding.command &&
      (b.when || "") === (binding.when || ""),
  );
}

/**
 * Textually append a keybinding before the closing `]`, preserving the file's
 * existing comments/formatting. Returns the new file text, or null when `text`
 * is non-empty but not a JSON array (caller should not overwrite blindly).
 */
export function appendKeybindingText(text, binding) {
  const bindingJson = JSON.stringify(binding, null, 2)
    .split("\n")
    .map((l) => "  " + l)
    .join("\n")
    .trimStart();
  const src = String(text || "").trim();
  if (!src || src === "[]") {
    return `[\n  ${bindingJson}\n]\n`;
  }
  const close = src.lastIndexOf("]");
  if (close === -1) return null; // not an array
  const before = src.slice(0, close).replace(/\s*$/, "");
  const sep = before.endsWith("[") ? "" : ",";
  return `${before}${sep}\n  ${bindingJson}\n]\n`;
}

/** Manual instructions for terminals cc cannot auto-configure. */
export function instructionsFor(id) {
  const seq = "a space, then a backslash, then Enter";
  const common = `Bind Shift+Enter to send ${seq} (cc turns a trailing "\\" into a newline).`;
  switch (id) {
    case "iterm2":
      return [
        common,
        "iTerm2 → Settings → Profiles → Keys → Key Mappings → + :",
        '  Shortcut: Shift+Return   Action: "Send Text"   Text:  \\  (then a literal Return)',
      ];
    case "apple-terminal":
      return [
        common,
        "Terminal → Settings → Profiles → Keyboard → + :",
        '  Key: Shift+Return   Action: send string  " \\015" (space, backslash, CR)',
      ];
    case "windows-terminal":
      return [
        common,
        "Windows Terminal → Settings → Actions (settings.json) → add:",
        '  { "command": { "action": "sendInput", "input": " \\\\\\r" }, "keys": "shift+enter" }',
      ];
    case "wezterm":
      return [
        common,
        "WezTerm (~/.wezterm.lua) keys:",
        '  { key="Enter", mods="SHIFT", action=wezterm.action.SendString(" \\\\\\r") }',
      ];
    default:
      return [
        common,
        "Most terminals let you remap a key to send custom text/bytes — point",
        "Shift+Enter at the 3 bytes: space (0x20), backslash (0x5C), CR (0x0D).",
        "Or just type a trailing \\ yourself to continue onto the next line.",
      ];
  }
}
