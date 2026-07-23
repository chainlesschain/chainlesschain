/**
 * REPL `/copy` — copy the last assistant response to the system clipboard
 * (Claude-Code `/copy` parity). Pure text extraction + a thin, cross-platform
 * spawn wrapper. The pure parts are unit-tested; real clipboard I/O is
 * environment-dependent and exercised through an injected spawnSync.
 */
import { executionBroker } from "../lib/process-execution-broker/index.js";

/** Flatten a message's content (string | content-parts[]) to plain text. Pure. */
export function messageText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p.text === "string" ? p.text : ""))
      .join("");
  }
  return "";
}

/**
 * Find the last assistant message that has non-empty text. Pure.
 * @returns {string|null}
 */
export function lastAssistantText(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "assistant") continue;
    const t = messageText(m.content).trim();
    if (t) return t;
  }
  return null;
}

/**
 * Extract the body of the LAST fenced code block in markdown text. Pure.
 * @returns {string|null}
 */
export function lastCodeBlock(text) {
  if (!text) return null;
  const re = /```[^\n]*\n([\s\S]*?)```/g;
  let m;
  let last = null;
  while ((m = re.exec(text)) !== null) last = m[1];
  return last != null ? last.replace(/\n$/, "") : null;
}

/**
 * Ordered list of clipboard-write commands to try for a platform. Pure.
 * All read the payload from stdin. On Windows we force UTF-8 input decoding so
 * non-ASCII content is not mangled by the console code page (clip.exe is the
 * ASCII-safe fallback).
 * @returns {{cmd:string,args:string[]}[]}
 */
export function clipboardCommands(platform = process.platform) {
  if (platform === "win32") {
    return [
      {
        cmd: "powershell",
        args: [
          "-NoProfile",
          "-Command",
          "[Console]::InputEncoding=[Text.Encoding]::UTF8; " +
            "Set-Clipboard -Value ([Console]::In.ReadToEnd())",
        ],
      },
      { cmd: "clip", args: [] },
    ];
  }
  if (platform === "darwin") {
    return [{ cmd: "pbcopy", args: [] }];
  }
  // Linux / other Unix — Wayland first, then X selections.
  return [
    { cmd: "wl-copy", args: [] },
    { cmd: "xclip", args: ["-selection", "clipboard"] },
    { cmd: "xsel", args: ["--clipboard", "--input"] },
  ];
}

const _deps = {
  spawnSync: (...args) => executionBroker.spawnSync(...args),
};

/**
 * Write text to the system clipboard, trying each platform candidate in order
 * until one succeeds. Deps injected for tests.
 * @returns {{ok:boolean, tool?:string, error?:string}}
 */
export function copyToClipboard(text, { platform, spawnSync } = {}) {
  const spawn = spawnSync || _deps.spawnSync;
  const cmds = clipboardCommands(platform || process.platform);
  let lastErr = "no clipboard tool available";
  for (const { cmd, args } of cmds) {
    let res;
    try {
      res = spawn(cmd, args, {
        input: text,
        encoding: "utf-8",
        windowsHide: true,
        origin: "repl:clipboard-copy",
        policy: "allow",
        scope: "clipboard",
        shell: false,
      });
    } catch (e) {
      lastErr = e.message;
      continue;
    }
    if (!res) {
      lastErr = `${cmd}: no result`;
      continue;
    }
    if (res.error) {
      lastErr = res.error.message;
      continue;
    }
    if (res.status === 0) return { ok: true, tool: cmd };
    lastErr =
      (res.stderr || "").toString().trim() || `${cmd} exited ${res.status}`;
  }
  return { ok: false, error: lastErr };
}

export { _deps };
