/** External-editor prompt editing for the agent REPL. */
import {
  mkdtempSync,
  lstatSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executionBroker } from "../lib/process-execution-broker/index.js";
import {
  ensurePrivateDirectory,
  ensurePrivateFile,
  PRIVATE_FILE_MODE,
} from "../lib/secure-fs.js";

export const MAX_EDITED_PROMPT_BYTES = 1024 * 1024;

/** Parse a conventional EDITOR command without invoking a shell. */
export function parsePromptEditorCommand(value) {
  const input = String(value || "").trim();
  if (!input) return [];
  const tokens = [];
  let token = "";
  let quote = null;
  let started = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === quote) {
        quote = null;
        started = true;
      } else if (char === "\\" && input[index + 1] === quote) {
        token += quote;
        index += 1;
      } else {
        token += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started || token) tokens.push(token);
      token = "";
      started = false;
      continue;
    }
    if (
      char === "\\" &&
      (input[index + 1] === '"' || input[index + 1] === "'")
    ) {
      token += input[index + 1];
      index += 1;
      started = true;
      continue;
    }
    token += char;
    started = true;
  }
  if (quote) throw new Error("EDITOR contains an unterminated quote");
  if (started || token) tokens.push(token);
  return tokens;
}

export function resolvePromptEditor(
  env = process.env,
  platform = process.platform,
) {
  if (String(env.EDITOR || "").trim()) {
    return { command: String(env.EDITOR), source: "EDITOR" };
  }
  if (String(env.VISUAL || "").trim()) {
    return { command: String(env.VISUAL), source: "VISUAL" };
  }
  return {
    command: platform === "win32" ? "notepad" : "vi",
    source: "platform-default",
  };
}

function normalizeEditedPrompt(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n$/, "");
}

const defaultDeps = {
  mkdtempSync,
  lstatSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  ensurePrivateDirectory,
  ensurePrivateFile,
  spawnSync: (...args) => executionBroker.spawnSync(...args),
  tmpdir,
};

/**
 * Open the current prompt in $EDITOR and return the edited text. The editor is
 * always executed as argv (`shell:false`); prompt contents never enter argv or
 * the environment. Temporary files are owner-only and removed in `finally`.
 */
export function editPromptInExternalEditor(prompt, options = {}) {
  const deps = { ...defaultDeps, ...(options.deps || {}) };
  const resolved = Object.prototype.hasOwnProperty.call(options, "editor")
    ? { command: options.editor, source: "explicit" }
    : resolvePromptEditor(
        options.env || process.env,
        options.platform || process.platform,
      );
  const [executable, ...editorArgs] = parsePromptEditorCommand(
    resolved.command,
  );
  if (!executable) {
    return {
      ok: false,
      capability: "unavailable",
      reason: "No external editor command is configured.",
    };
  }

  let tempDirectory = null;
  try {
    tempDirectory = deps.mkdtempSync(join(deps.tmpdir(), "cc-prompt-"));
    deps.ensurePrivateDirectory(tempDirectory, {
      applyWindowsAcl: true,
      failIfUnavailable: true,
    });
    const filePath = join(tempDirectory, "prompt.md");
    deps.writeFileSync(filePath, String(prompt || ""), {
      encoding: "utf8",
      mode: PRIVATE_FILE_MODE,
    });
    deps.ensurePrivateFile(filePath, {
      applyWindowsAcl: true,
      failIfUnavailable: true,
    });

    let result;
    try {
      result = deps.spawnSync(executable, [...editorArgs, filePath], {
        stdio: "inherit",
        windowsHide: false,
        origin: "repl:prompt-editor",
        policy: "allow",
        scope: "editor",
        shell: false,
      });
    } catch (error) {
      return {
        ok: false,
        capability: "unavailable",
        editor: executable,
        reason: `Could not launch ${executable}: ${error.message}`,
      };
    }
    if (!result || result.error || result.signal || result.status !== 0) {
      return {
        ok: false,
        capability: !result || result?.error ? "unavailable" : "failed",
        editor: executable,
        reason:
          result?.error?.message ||
          (result?.signal
            ? `${executable} was terminated by ${result.signal}`
            : null) ||
          `${executable} exited with status ${result?.status}`,
      };
    }

    const editedStat = deps.lstatSync(filePath);
    if (editedStat.isSymbolicLink()) {
      return {
        ok: false,
        capability: "failed",
        editor: executable,
        reason: "Editor replaced the prompt file with a symbolic link.",
      };
    }
    deps.ensurePrivateFile(filePath, {
      applyWindowsAcl: true,
      failIfUnavailable: true,
    });

    const byteLength = Number(deps.statSync(filePath).size) || 0;
    const maxBytes = Math.max(
      1,
      Number(options.maxBytes) || MAX_EDITED_PROMPT_BYTES,
    );
    if (byteLength > maxBytes) {
      return {
        ok: false,
        capability: "failed",
        editor: executable,
        reason: `Edited prompt exceeds ${maxBytes} bytes.`,
      };
    }
    const content = normalizeEditedPrompt(deps.readFileSync(filePath, "utf8"));
    return {
      ok: true,
      capability: "available",
      editor: executable,
      source: resolved.source,
      content,
      changed: content !== normalizeEditedPrompt(prompt),
    };
  } catch (error) {
    return {
      ok: false,
      capability: "unavailable",
      editor: executable,
      reason: `External prompt editor unavailable: ${error.message}`,
    };
  } finally {
    if (tempDirectory) {
      try {
        deps.rmSync(tempDirectory, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup. The directory and file are owner-only.
      }
    }
  }
}
