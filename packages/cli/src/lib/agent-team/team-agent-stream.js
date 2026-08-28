/**
 * Incremental parser for a real teammate's `cc agent --output-format
 * stream-json` stdout.
 *
 * The parser deliberately retains only billing metadata. Prompt, assistant and
 * terminal result bodies are parsed only as part of the current NDJSON line and
 * are never copied into parser state or returned to callers.
 */

import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

export const DEFAULT_TEAM_AGENT_MAX_LINE_BYTES = 1024 * 1024;
export const DEFAULT_TEAM_AGENT_MAX_TOTAL_BYTES = 32 * 1024 * 1024;

const USAGE_KEYS = Object.freeze([
  "input_tokens",
  "output_tokens",
  "cache_read_input_tokens",
  "cache_creation_input_tokens",
]);

function emptyUsage() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
}

function cloneUsage(usage) {
  return usage ? { ...usage } : null;
}

function cloneUsageRecords(records) {
  return Array.isArray(records)
    ? records.map((record) => ({
        provider: record.provider,
        model: record.model,
        usage: cloneUsage(record.usage),
      }))
    : [];
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function asBuffer(chunk) {
  if (typeof chunk === "string") return Buffer.from(chunk, "utf8");
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  throw new TypeError(
    "TeamAgentStreamParser.push expects a string or Uint8Array",
  );
}

export class TeamAgentStreamError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "TeamAgentStreamError";
    this.code = code;
    for (const [key, value] of Object.entries(details)) {
      if (value != null) this[key] = value;
    }
  }
}

/**
 * @typedef {object} TeamAgentStreamSummary
 * @property {string|null} provider
 * @property {string|null} model
 * @property {object|null} usage
 * @property {Array<object>} usageRecords
 * @property {boolean} terminalResult
 */

export class TeamAgentStreamParser {
  #maxLineBytes;
  #maxTotalBytes;
  #totalBytes = 0;
  #lineBytes = 0;
  #lineChunks = [];
  #lineNumber = 0;
  #provider = null;
  #model = null;
  #usage = emptyUsage();
  #lastResultUsage = null;
  #lastResultProvider = null;
  #lastResultModel = null;
  #tokenUsageEvents = 0;
  #usageByIdentity = new Map();
  #sawTerminalResult = false;
  #terminalResultDigest = null;
  #finished = false;
  #failed = null;
  #finalSummary = null;

  constructor({
    maxLineBytes = DEFAULT_TEAM_AGENT_MAX_LINE_BYTES,
    maxTotalBytes = DEFAULT_TEAM_AGENT_MAX_TOTAL_BYTES,
  } = {}) {
    this.#maxLineBytes = positiveInteger(maxLineBytes, "maxLineBytes");
    this.#maxTotalBytes = positiveInteger(maxTotalBytes, "maxTotalBytes");
  }

  /**
   * Consume one stdout chunk. Chunks may end anywhere, including in the middle
   * of an NDJSON line or a multi-byte UTF-8 character.
   *
   * @returns {this}
   */
  push(chunk) {
    this.#assertWritable();
    const bytes = asBuffer(chunk);
    if (bytes.length === 0) return this;

    const nextTotal = this.#totalBytes + bytes.length;
    if (!Number.isSafeInteger(nextTotal) || nextTotal > this.#maxTotalBytes) {
      this.#fail(
        new TeamAgentStreamError(
          "TEAM_AGENT_STREAM_TOTAL_LIMIT",
          `Teammate stream exceeded the ${this.#maxTotalBytes}-byte total limit`,
          {
            limit: this.#maxTotalBytes,
            actual: nextTotal,
          },
        ),
      );
    }
    this.#totalBytes = nextTotal;

    let start = 0;
    for (let i = 0; i < bytes.length; i += 1) {
      if (bytes[i] !== 0x0a) continue;
      this.#appendLineBytes(bytes.subarray(start, i));
      this.#consumePendingLine();
      start = i + 1;
    }
    this.#appendLineBytes(bytes.subarray(start));
    return this;
  }

  /**
   * Finish the stream, consuming a final line even when it has no trailing LF.
   * Repeated calls are idempotent.
   *
   * `token_usage` events win over the terminal result aggregate to prevent
   * double counting. The last `result.usage` is used only when no token-usage
   * event was observed.
   *
   * @returns {TeamAgentStreamSummary}
   */
  finish(chunk) {
    if (chunk !== undefined) this.push(chunk);
    if (this.#failed) throw this.#failed;
    if (this.#finished) return this.#copySummary();

    if (this.#lineBytes > 0) this.#consumePendingLine();
    this.#finished = true;
    this.#finalSummary = Object.freeze({
      provider: this.#provider,
      model: this.#model,
      usage: Object.freeze(
        cloneUsage(
          this.#tokenUsageEvents > 0 ? this.#usage : this.#lastResultUsage,
        ),
      ),
      usageRecords: Object.freeze(
        this.#usageRecords().map((record) =>
          Object.freeze({
            ...record,
            usage: Object.freeze(record.usage),
          }),
        ),
      ),
      terminalResult: this.#sawTerminalResult,
    });
    return this.#copySummary();
  }

  /**
   * Return the billing metadata observed so far without finishing the stream.
   * This is intentionally limited to provider/model/usage so callers can
   * enforce a live per-agent token ceiling without retaining assistant text.
   */
  status() {
    if (this.#failed) throw this.#failed;
    if (this.#finished) return this.#copySummary();
    return this.#copyLiveSummary();
  }

  /**
   * Return already-observed billing data even after a later malformed line
   * poisoned the protocol parser. This never exposes prompt/result content and
   * lets callers bill work consumed before a stream failure.
   */
  partialStatus() {
    if (this.#finished) return this.#copySummary();
    return this.#copyLiveSummary();
  }

  /**
   * Return an immutable digest of the exact terminal result record without
   * retaining or exposing its prompt/result body.
   */
  terminalEvidence() {
    return this.#terminalResultDigest
      ? Object.freeze({ outputDigest: this.#terminalResultDigest })
      : null;
  }

  #copyLiveSummary() {
    return {
      provider: this.#provider,
      model: this.#model,
      usage:
        this.#tokenUsageEvents > 0
          ? cloneUsage(this.#usage)
          : cloneUsage(this.#lastResultUsage),
      usageRecords: this.#usageRecords(),
      terminalResult: this.#sawTerminalResult,
    };
  }

  #assertWritable() {
    if (this.#failed) throw this.#failed;
    if (this.#finished) {
      throw new TeamAgentStreamError(
        "TEAM_AGENT_STREAM_FINISHED",
        "Cannot push data after the teammate stream has finished",
      );
    }
  }

  #appendLineBytes(bytes) {
    if (bytes.length === 0) return;
    const nextLineBytes = this.#lineBytes + bytes.length;
    if (
      !Number.isSafeInteger(nextLineBytes) ||
      nextLineBytes > this.#maxLineBytes
    ) {
      this.#fail(
        new TeamAgentStreamError(
          "TEAM_AGENT_STREAM_LINE_LIMIT",
          `Teammate stream line exceeded the ${this.#maxLineBytes}-byte limit`,
          {
            line: this.#lineNumber + 1,
            limit: this.#maxLineBytes,
            actual: nextLineBytes,
          },
        ),
      );
    }

    // Copy partial input: stdout buffers are caller-owned and may be reused.
    this.#lineChunks.push(Buffer.from(bytes));
    this.#lineBytes = nextLineBytes;

    // Bound array/object overhead as well as payload bytes when a producer
    // supplies a very large number of tiny chunks for one line.
    if (this.#lineChunks.length >= 64) {
      this.#lineChunks = [Buffer.concat(this.#lineChunks, this.#lineBytes)];
    }
  }

  #consumePendingLine() {
    this.#lineNumber += 1;
    let raw =
      this.#lineChunks.length === 0
        ? Buffer.alloc(0)
        : Buffer.concat(this.#lineChunks, this.#lineBytes);
    this.#lineChunks = [];
    this.#lineBytes = 0;

    if (raw.length > 0 && raw[raw.length - 1] === 0x0d) {
      raw = raw.subarray(0, raw.length - 1);
    }
    if (raw.length === 0) return;

    let line;
    try {
      line = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    } catch {
      this.#fail(
        new TeamAgentStreamError(
          "TEAM_AGENT_STREAM_INVALID_UTF8",
          `Invalid UTF-8 in teammate stream at line ${this.#lineNumber}`,
          { line: this.#lineNumber },
        ),
      );
    }
    raw = null;

    if (this.#lineNumber === 1 && line.charCodeAt(0) === 0xfeff) {
      line = line.slice(1);
    }
    if (line.trim() === "") return;

    const lineDigest = `sha256:${createHash("sha256")
      .update(line, "utf8")
      .digest("hex")}`;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      // Never include JSON.parse's engine-specific message: recent runtimes
      // may quote the source text, which can contain a prompt or result body.
      this.#fail(
        new TeamAgentStreamError(
          "TEAM_AGENT_STREAM_INVALID_JSON",
          `Invalid JSON in teammate stream at line ${this.#lineNumber}`,
          { line: this.#lineNumber },
        ),
      );
    } finally {
      line = null;
    }

    if (!event || typeof event !== "object" || Array.isArray(event)) return;

    if (event.type === "system" && event.subtype === "init") {
      if (this.#provider == null && typeof event.provider === "string") {
        this.#provider = event.provider;
      }
      if (this.#model == null && typeof event.model === "string") {
        this.#model = event.model;
      }
      return;
    }

    if (event.type === "token_usage") {
      const usage = this.#normalizeUsage(event.usage);
      const provider =
        typeof event.provider === "string" ? event.provider : this.#provider;
      const model = typeof event.model === "string" ? event.model : this.#model;
      for (const key of USAGE_KEYS) {
        const next = this.#usage[key] + usage[key];
        if (!Number.isSafeInteger(next)) {
          this.#fail(
            new TeamAgentStreamError(
              "TEAM_AGENT_STREAM_INVALID_USAGE",
              `Unsafe ${key} total in teammate stream at line ${this.#lineNumber}`,
              { line: this.#lineNumber, field: key },
            ),
          );
        }
        this.#usage[key] = next;
      }
      this.#recordUsage(provider, model, usage);
      this.#tokenUsageEvents += 1;
      return;
    }

    if (event.type === "result") {
      this.#sawTerminalResult = true;
      this.#terminalResultDigest = lineDigest;
      this.#lastResultProvider =
        typeof event.provider === "string" ? event.provider : this.#provider;
      this.#lastResultModel =
        typeof event.model === "string" ? event.model : this.#model;
      this.#lastResultUsage =
        event.usage == null ? null : this.#normalizeUsage(event.usage);
    }
  }

  #recordUsage(provider, model, usage) {
    const normalizedProvider =
      typeof provider === "string" && provider ? provider : null;
    const normalizedModel = typeof model === "string" && model ? model : null;
    const identity = `${normalizedProvider || ""}\0${normalizedModel || ""}`;
    let record = this.#usageByIdentity.get(identity);
    if (!record) {
      if (this.#usageByIdentity.size >= 64) {
        this.#fail(
          new TeamAgentStreamError(
            "TEAM_AGENT_STREAM_USAGE_IDENTITY_LIMIT",
            "Teammate stream exceeded the 64-model billing identity limit",
            { limit: 64 },
          ),
        );
      }
      record = {
        provider: normalizedProvider,
        model: normalizedModel,
        usage: emptyUsage(),
      };
      this.#usageByIdentity.set(identity, record);
    }
    for (const key of USAGE_KEYS) {
      const next = record.usage[key] + usage[key];
      if (!Number.isSafeInteger(next)) {
        this.#fail(
          new TeamAgentStreamError(
            "TEAM_AGENT_STREAM_INVALID_USAGE",
            `Unsafe ${key} identity total in teammate stream`,
            { field: key },
          ),
        );
      }
      record.usage[key] = next;
    }
  }

  #usageRecords() {
    if (this.#tokenUsageEvents > 0) {
      return [...this.#usageByIdentity.values()].map((record) => ({
        provider: record.provider,
        model: record.model,
        usage: cloneUsage(record.usage),
      }));
    }
    if (!this.#lastResultUsage) return [];
    return [
      {
        provider: this.#lastResultProvider ?? this.#provider,
        model: this.#lastResultModel ?? this.#model,
        usage: cloneUsage(this.#lastResultUsage),
      },
    ];
  }

  #normalizeUsage(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      this.#fail(
        new TeamAgentStreamError(
          "TEAM_AGENT_STREAM_INVALID_USAGE",
          `Invalid usage object in teammate stream at line ${this.#lineNumber}`,
          { line: this.#lineNumber },
        ),
      );
    }

    const usage = emptyUsage();
    for (const key of USAGE_KEYS) {
      const rawValue = raw[key];
      if (rawValue == null) continue;
      if (
        (typeof rawValue !== "number" && typeof rawValue !== "string") ||
        rawValue === ""
      ) {
        this.#invalidUsageField(key);
      }
      const value = Number(rawValue);
      if (!Number.isSafeInteger(value) || value < 0) {
        this.#invalidUsageField(key);
      }
      usage[key] = value;
    }
    return usage;
  }

  #invalidUsageField(field) {
    this.#fail(
      new TeamAgentStreamError(
        "TEAM_AGENT_STREAM_INVALID_USAGE",
        `Invalid ${field} in teammate stream at line ${this.#lineNumber}`,
        { line: this.#lineNumber, field },
      ),
    );
  }

  #copySummary() {
    return {
      provider: this.#finalSummary.provider,
      model: this.#finalSummary.model,
      usage: cloneUsage(this.#finalSummary.usage),
      usageRecords: cloneUsageRecords(this.#finalSummary.usageRecords),
      terminalResult: this.#finalSummary.terminalResult,
    };
  }

  #fail(error) {
    this.#lineChunks = [];
    this.#lineBytes = 0;
    this.#failed = error;
    throw error;
  }
}

/**
 * Parse a complete string/buffer or a synchronous iterable of chunks.
 *
 * @returns {TeamAgentStreamSummary}
 */
export function parseTeamAgentStream(input, options = {}) {
  const parser = new TeamAgentStreamParser(options);
  if (
    typeof input === "string" ||
    Buffer.isBuffer(input) ||
    input instanceof Uint8Array
  ) {
    parser.push(input);
  } else if (input != null) {
    for (const chunk of input) parser.push(chunk);
  }
  return parser.finish();
}
