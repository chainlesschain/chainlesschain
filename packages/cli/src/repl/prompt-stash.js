/**
 * Durable prompt stash used by `/stash`.
 *
 * Prompts may contain private source code or credentials, so the state lives in
 * the owner-only ChainlessChain state directory and is replaced atomically.
 * Mutations share the normal cross-process file lock used by CLI state stores.
 */
import {
  existsSync,
  lstatSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { getStatePath } from "../lib/paths.js";
import {
  ensurePrivateDirectory,
  ensurePrivateFile,
  PRIVATE_FILE_MODE,
} from "../lib/secure-fs.js";
import { withFileLock } from "../lib/with-file-lock.js";

export const PROMPT_STASH_SCHEMA = 1;
export const MAX_STASH_ENTRIES = 50;
export const MAX_STASH_PROMPT_CHARS = 100_000;
export const MAX_STASH_FILE_BYTES = 32 * 1024 * 1024;

export function getPromptStashPath() {
  return join(getStatePath(), "prompt-stash-v1.json");
}

function emptyDocument() {
  return { schema: PROMPT_STASH_SCHEMA, entries: [] };
}

function normalizePrompt(value) {
  const text = String(value ?? "").replace(/\0/g, "");
  if (!text.trim()) throw new Error("prompt stash requires non-empty text");
  if (text.length > MAX_STASH_PROMPT_CHARS) {
    throw new Error(
      `prompt exceeds stash limit (${MAX_STASH_PROMPT_CHARS} characters)`,
    );
  }
  return text;
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (typeof entry.id !== "string" || typeof entry.text !== "string") {
    return null;
  }
  if (!entry.text.trim() || entry.text.length > MAX_STASH_PROMPT_CHARS) {
    return null;
  }
  return {
    id: entry.id.slice(0, 100),
    text: entry.text.replace(/\0/g, ""),
    createdAt: Number.isFinite(Number(entry.createdAt))
      ? Number(entry.createdAt)
      : 0,
  };
}

export class PromptStash {
  constructor(options = {}) {
    this.filePath = options.filePath || getPromptStashPath();
    this.maxEntries = Math.max(
      1,
      Math.floor(Number(options.maxEntries) || MAX_STASH_ENTRIES),
    );
    this.now = options.now || Date.now;
    this.uuid = options.uuid || randomUUID;
    this.deps = {
      existsSync,
      lstatSync,
      readFileSync,
      renameSync,
      rmSync,
      writeFileSync,
      ensurePrivateDirectory,
      ensurePrivateFile,
      withFileLock,
      ...(options.deps || {}),
    };
  }

  _assertReadablePath() {
    if (!this.deps.existsSync(this.filePath)) return;
    const stat = this.deps.lstatSync(this.filePath);
    if (stat.isSymbolicLink()) {
      const error = new Error("refusing prompt stash through a symbolic link");
      error.code = "PROMPT_STASH_SYMLINK";
      throw error;
    }
    if (Number(stat.size) > MAX_STASH_FILE_BYTES) {
      const error = new Error(
        `prompt stash exceeds ${MAX_STASH_FILE_BYTES} bytes`,
      );
      error.code = "PROMPT_STASH_TOO_LARGE";
      throw error;
    }
    this.deps.ensurePrivateFile(this.filePath, {
      applyWindowsAcl: true,
      failIfUnavailable: true,
    });
  }

  _read() {
    this._assertReadablePath();
    if (!this.deps.existsSync(this.filePath)) return emptyDocument();
    let parsed;
    try {
      parsed = JSON.parse(this.deps.readFileSync(this.filePath, "utf8"));
    } catch (cause) {
      const error = new Error(`prompt stash is malformed: ${cause.message}`);
      error.code = "PROMPT_STASH_CORRUPT";
      error.cause = cause;
      throw error;
    }
    if (
      parsed?.schema !== PROMPT_STASH_SCHEMA ||
      !Array.isArray(parsed.entries)
    ) {
      const error = new Error("prompt stash has an unsupported schema");
      error.code = "PROMPT_STASH_SCHEMA";
      throw error;
    }
    return {
      schema: PROMPT_STASH_SCHEMA,
      entries: parsed.entries
        .map(normalizeEntry)
        .filter(Boolean)
        .slice(-this.maxEntries),
    };
  }

  _write(document) {
    const directory = dirname(this.filePath);
    this.deps.ensurePrivateDirectory(directory, {
      applyWindowsAcl: true,
      failIfUnavailable: true,
    });
    const tempPath = `${this.filePath}.${process.pid}.${this.uuid().slice(0, 8)}.tmp`;
    try {
      this.deps.writeFileSync(
        tempPath,
        `${JSON.stringify(document, null, 2)}\n`,
        { encoding: "utf8", mode: PRIVATE_FILE_MODE },
      );
      this.deps.ensurePrivateFile(tempPath, {
        applyWindowsAcl: true,
        failIfUnavailable: true,
      });
      this._renameWithRetry(tempPath);
      this.deps.ensurePrivateFile(this.filePath, {
        applyWindowsAcl: true,
        failIfUnavailable: true,
      });
    } finally {
      if (this.deps.existsSync(tempPath)) {
        this.deps.rmSync(tempPath, { force: true });
      }
    }
  }

  _renameWithRetry(tempPath) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        this.deps.renameSync(tempPath, this.filePath);
        return;
      } catch (error) {
        const transient = ["EACCES", "EBUSY", "EEXIST", "EPERM"].includes(
          error?.code,
        );
        if (!transient || attempt >= 7) throw error;
        try {
          Atomics.wait(
            new Int32Array(new SharedArrayBuffer(4)),
            0,
            0,
            10 * (attempt + 1),
          );
        } catch {
          // A runtime without Atomics.wait simply retries immediately.
        }
      }
    }
  }

  _mutate(fn) {
    this.deps.ensurePrivateDirectory(dirname(this.filePath), {
      applyWindowsAcl: true,
      failIfUnavailable: true,
    });
    return this.deps.withFileLock(
      this.filePath,
      () => {
        const document = this._read();
        const result = fn(document);
        this._write(document);
        return result;
      },
      { failIfUnavailable: true, timeoutMs: 5_000 },
    );
  }

  stash(prompt) {
    const text = normalizePrompt(prompt);
    return this._mutate((document) => {
      const createdAt = this.now();
      const entry = {
        id: `stash-${createdAt}-${this.uuid().slice(0, 8)}`,
        text,
        createdAt,
      };
      document.entries.push(entry);
      if (document.entries.length > this.maxEntries) {
        document.entries.splice(0, document.entries.length - this.maxEntries);
      }
      return entry;
    });
  }

  list() {
    return this._read().entries.slice().reverse();
  }

  pop() {
    return this._mutate((document) => document.entries.pop() || null);
  }

  clear() {
    return this._mutate((document) => {
      const count = document.entries.length;
      document.entries = [];
      return count;
    });
  }
}

export function promptStashPreview(text, maxChars = 72) {
  const flat = String(text || "")
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const limit = Math.max(20, Number(maxChars) || 72);
  return flat.length > limit
    ? `${flat.slice(0, Math.max(1, limit - 1))}…`
    : flat;
}

export function renderPromptStash(entries, options = {}) {
  const rows = Array.isArray(entries) ? entries : [];
  if (!rows.length) return "Prompt stash is empty.";
  const lines = ["Stashed prompts (newest first):"];
  rows.forEach((entry, index) => {
    let when = "unknown time";
    if (entry.createdAt) {
      const date = new Date(entry.createdAt);
      if (!Number.isNaN(date.getTime())) {
        when = date.toISOString().replace("T", " ").slice(0, 19);
      }
    }
    lines.push(
      `  ${index + 1}. ${promptStashPreview(entry.text, options.previewChars)} (${when})`,
    );
  });
  return lines.join("\n");
}

/** Parse the text after `/stash`. */
export function parsePromptStashCommand(args, currentPrompt = "") {
  const raw = String(args || "");
  const trimmed = raw.trim();
  if (!trimmed) {
    return String(currentPrompt || "").trim()
      ? { action: "stash", prompt: String(currentPrompt) }
      : { action: "help" };
  }
  const command = trimmed.split(/\s+/, 1)[0].toLowerCase();
  if (command === "list" || command === "ls") return { action: "list" };
  if (command === "pop") return { action: "pop" };
  if (command === "clear") return { action: "clear" };
  if (command === "add" || command === "push") {
    const prompt = trimmed.slice(command.length).trim();
    return prompt ? { action: "stash", prompt } : { action: "help" };
  }
  return { action: "stash", prompt: trimmed };
}

/**
 * Execute a `/stash` operation. A popped prompt is returned, never submitted;
 * the REPL wiring should place it back in the editable input buffer.
 */
export function runPromptStashCommand(args, options = {}) {
  const stash = options.stash || new PromptStash(options);
  const parsed = parsePromptStashCommand(args, options.currentPrompt);
  switch (parsed.action) {
    case "stash": {
      const entry = stash.stash(parsed.prompt);
      return {
        ok: true,
        action: "stash",
        entry,
        message: `Prompt stashed (${promptStashPreview(entry.text)}).`,
      };
    }
    case "list": {
      const entries = stash.list();
      return {
        ok: true,
        action: "list",
        entries,
        message: renderPromptStash(entries),
      };
    }
    case "pop": {
      const entry = stash.pop();
      return entry
        ? {
            ok: true,
            action: "pop",
            entry,
            prompt: entry.text,
            message: "Restored the newest stashed prompt for editing.",
          }
        : {
            ok: false,
            action: "pop",
            prompt: null,
            message: "Prompt stash is empty.",
          };
    }
    case "clear": {
      const count = stash.clear();
      return {
        ok: true,
        action: "clear",
        count,
        message: `Cleared ${count} stashed prompt${count === 1 ? "" : "s"}.`,
      };
    }
    default:
      return {
        ok: false,
        action: "help",
        message:
          "Usage: /stash <prompt> | /stash list | /stash pop | /stash clear",
      };
  }
}
