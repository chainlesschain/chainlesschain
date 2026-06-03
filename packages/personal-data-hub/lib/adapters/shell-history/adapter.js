"use strict";

// ShellHistoryAdapter — surfaces PowerShell + bash + zsh command history
// as a self-actor event stream. Same shape as VSCode's terminal-command
// kind, just rooted in shell history files instead of an editor's state DB.

const {
  ENTITY_TYPES,
  EVENT_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");

const {
  defaultHistorySources,
  readAllHistory,
} = require("./shell-reader");

const NAME = "shell-history";
const VERSION = "0.1.0";

class ShellHistoryAdapter {
  constructor(opts = {}) {
    this.name = NAME;
    this.version = VERSION;
    this.capabilities = ["sync:shell-history-files"];
    this.extractMode = "file-import";
    this.rateLimits = { perDay: 96 };
    this.dataDisclosure = {
      fields: ["commands:shell,value,sourceIndex,snapshotTs"],
      sensitivity: "high",
      legalGate: false,
      defaultInclude: { commands: true },
    };
    this._deps = {
      defaultSources: defaultHistorySources,
      readHistory: readAllHistory,
    };
    this._sourcesOverride = Array.isArray(opts.sources) ? opts.sources : null;
  }

  _resolveSources(opts) {
    if (Array.isArray(opts?.sources) && opts.sources.length > 0) return opts.sources;
    if (this._sourcesOverride) return this._sourcesOverride;
    return this._deps.defaultSources();
  }

  async authenticate(ctx = {}) {
    const sources = this._resolveSources(ctx);
    if (!sources || sources.length === 0) {
      return {
        ok: false,
        reason: "NO_HISTORY_SOURCES",
        message: "no default shell history files on this platform; pass opts.sources",
      };
    }
    return { ok: true, mode: "file-import", sources: sources.map((s) => s.shell) };
  }

  async healthCheck() {
    return { ok: true, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    const sources = this._resolveSources(opts);
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const capturedAt = Date.now();
    let emitted = 0;
    for (const row of this._deps.readHistory(sources, { since: opts.since })) {
      if (emitted >= limit) return;
      yield {
        kind: "shell-command",
        // shell + sourceIndex + hash(value) keeps the same command at the
        // same position in the same history file dedupable across re-syncs.
        originalId: `shell-cmd:${row.shell}:${row.sourceIndex}:${hashCommand(row.value)}`,
        capturedAt,
        payload: row,
      };
      emitted += 1;
    }
  }

  normalize(raw) {
    const ingestedAt = Date.now();
    const source = (originalId) => ({
      adapter: NAME,
      adapterVersion: VERSION,
      capturedAt: raw.capturedAt,
      capturedBy: CAPTURED_BY.SQLITE,
      originalId,
    });

    if (raw.kind === "shell-command") {
      const p = raw.payload || {};
      const cmd = typeof p.value === "string" ? p.value : "";
      const titleText = `[${p.shell || "?"}] ${cmd}`;
      const event = {
        id: `event-shell-cmd-${p.shell || "?"}-${p.sourceIndex}-${shortHash(cmd)}`,
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.OTHER,
        occurredAt: Number.isInteger(p.snapshotTs) ? p.snapshotTs : raw.capturedAt,
        ingestedAt,
        source: source(raw.originalId),
        actor: "self",
        content: {
          title: titleText.length > 100 ? titleText.substring(0, 100) + "…" : titleText,
          text: cmd,
        },
        extra: {
          kind: "shell-command",
          shell: p.shell || null,
          file: p.file || null,
          sourceIndex: Number.isInteger(p.sourceIndex) ? p.sourceIndex : null,
        },
      };
      return { events: [event], persons: [], places: [], items: [], topics: [] };
    }

    throw new Error(`shell-history.normalize: unknown raw.kind=${raw.kind}`);
  }
}

function hashCommand(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}
function shortHash(s) {
  return hashCommand(s).substring(0, 8);
}

module.exports = {
  ShellHistoryAdapter,
  SHELL_HISTORY_NAME: NAME,
  SHELL_HISTORY_VERSION: VERSION,
};
