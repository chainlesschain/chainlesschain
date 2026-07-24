"use strict";

// VS Code desktop-local activity:
//   - workspaceStorage/*/workspace.json: recently opened workspaces
//   - globalStorage/state.vscdb: terminal command and directory history
//   - History/*/entries.json: Local History save metadata
//
// Absolute workspace/directory paths are reduced to a basename plus SHA-256.
// Local History content files are never opened.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  CAPTURED_BY,
  ENTITY_TYPES,
  EVENT_SUBTYPES,
  ITEM_SUBTYPES,
} = require("../../constants");
const {
  createAccountScope,
  normalizeIdentity,
} = require("../../account-scope");
const {
  defaultVscodeRoot,
  readLocalHistory,
  readTerminalHistory,
  readWorkspaces,
} = require("./vscode-reader");

const NAME = "vscode";
const VERSION = "0.2.0";
const DEFAULT_PAGE_SIZE = 5000;
const MAX_PAGE_SIZE = 50_000;
const DEFAULT_MAX_PAGES = 20;

function sha256Hex(value, length = 64) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""), "utf8")
    .digest("hex")
    .slice(0, length);
}

function parsePositiveInteger(value, optionName, adapterName) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error(
      `${adapterName}.sync: ${optionName} must be a positive integer`,
    );
  }
  return numeric;
}

function parseSince(opts, adapterName) {
  const candidate = opts.since !== undefined ? opts.since : opts.sinceWatermark;
  if (candidate == null || candidate === "") return 0;
  const numeric = Number(candidate);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(
      `${adapterName}.sync: since watermark must be unix milliseconds`,
    );
  }
  return Math.floor(numeric);
}

function parseScanLimit(opts, adapterName) {
  const pageSize =
    opts.pageSize == null
      ? DEFAULT_PAGE_SIZE
      : parsePositiveInteger(opts.pageSize, "pageSize", adapterName);
  if (pageSize > MAX_PAGE_SIZE) {
    throw new Error(
      `${adapterName}.sync: pageSize must not exceed ${MAX_PAGE_SIZE}`,
    );
  }
  const maxPages =
    opts.maxPages == null
      ? DEFAULT_MAX_PAGES
      : parsePositiveInteger(opts.maxPages, "maxPages", adapterName);
  const pageBudget =
    maxPages > Math.floor(Number.MAX_SAFE_INTEGER / pageSize)
      ? Number.MAX_SAFE_INTEGER
      : pageSize * maxPages;
  const configured = [pageBudget];
  if (opts.limit != null) {
    configured.push(parsePositiveInteger(opts.limit, "limit", adapterName));
  }
  if (opts.maxEvents != null) {
    configured.push(
      parsePositiveInteger(opts.maxEvents, "maxEvents", adapterName),
    );
  }
  return Math.min(...configured);
}

function canonicalRoot(value, fsMod = fs) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const resolved = path.resolve(value.trim());
  try {
    const realpath =
      typeof fsMod.realpathSync?.native === "function"
        ? fsMod.realpathSync.native(resolved)
        : fsMod.realpathSync(resolved);
    return path.resolve(realpath);
  } catch {
    return resolved;
  }
}

function rootFingerprint(root, adapterName, fsMod = fs) {
  const canonical = canonicalRoot(root, fsMod);
  if (!canonical) return null;
  const normalized =
    process.platform === "win32" ? canonical.toLowerCase() : canonical;
  return sha256Hex(`${adapterName}\0${normalized}`, 24);
}

function scopeForRoot(root, adapterName, scopeIdentityKey, fsMod = fs) {
  const canonical = canonicalRoot(root, fsMod);
  if (!canonical) return undefined;
  return createAccountScope(
    adapterName,
    `${scopeIdentityKey}:${normalizeIdentity(canonical)}`,
  );
}

function sanitizedReadError(error, descriptor) {
  const sourceCode =
    typeof error?.code === "string" && /^[A-Z0-9_]+$/u.test(error.code)
      ? error.code
      : "UNKNOWN";
  const wrapped = new Error(
    `${descriptor.name}.sync: unable to read the selected ${descriptor.displayName} state (${sourceCode})`,
  );
  wrapped.code = `${descriptor.errorPrefix}_STATE_READ_FAILED`;
  wrapped.sourceCode = sourceCode;
  return wrapped;
}

const VSCODE_DESCRIPTOR = Object.freeze({
  name: NAME,
  version: VERSION,
  displayName: "VS Code",
  editor: "vscode",
  rootOption: "vscodeRoot",
  scopeIdentityKey: "vscodeRoot",
  errorPrefix: "VSCODE",
  defaultRoot: defaultVscodeRoot,
  capabilities: Object.freeze([
    "sync:vscode-workspace-storage",
    "sync:vscode-globalstorage-sqlite",
    "sync:vscode-local-history-metadata",
    "sync:profile-directory",
  ]),
});

class CodeEditorActivityAdapter {
  constructor(opts = {}, descriptor = VSCODE_DESCRIPTOR) {
    this._descriptor = descriptor;
    this.name = descriptor.name;
    this.version = descriptor.version;
    this.capabilities = [...descriptor.capabilities];
    this.extractMode = "file-import";
    this.rateLimits = { perDay: 96 };
    this.watermarkStrategy = "max-captured-at";
    this.watermarkRequiresCompleteScan = true;
    this.watermarkLookbackMs = 1000;
    this.initialPageBudget = DEFAULT_MAX_PAGES;
    this.runtimeCredentialOption = descriptor.rootOption;
    this.runtimeScopeIdentityKey = descriptor.rootOption;
    this.dataDisclosure = {
      fields: [
        "workspaces:name,resourceScheme,resourceHash,lastOpenedMs",
        "terminal-commands:command,shellType,sourceIndex,snapshotTs",
        "terminal-dirs:name,pathHash,shellType,sourceIndex,snapshotTs",
        "local-history:fileName,fileExtension,resourceScheme,resourceHash,savedAtMs,hasSaveSource",
      ],
      sensitivity: "high",
      legalGate: false,
      defaultInclude: {
        workspaces: true,
        terminal: true,
        localHistory: true,
      },
    };
    this._deps = {
      fs: opts.fs || fs,
      defaultRoot:
        typeof opts.defaultRoot === "function"
          ? opts.defaultRoot
          : descriptor.defaultRoot,
    };
    this._rootOverride = canonicalRoot(
      opts[descriptor.rootOption],
      this._deps.fs,
    );
    if (this._rootOverride) {
      this.defaultScope = scopeForRoot(
        this._rootOverride,
        this.name,
        descriptor.scopeIdentityKey,
        this._deps.fs,
      );
    }
  }

  _resolveRoot(opts = {}) {
    const configuredRoot = opts[this._descriptor.rootOption];
    const candidate =
      (typeof configuredRoot === "string" && configuredRoot.trim()) ||
      (typeof opts.profilePath === "string" && opts.profilePath.trim()) ||
      this._rootOverride ||
      this._deps.defaultRoot();
    return canonicalRoot(candidate, this._deps.fs);
  }

  resolveDefaultScope(opts = {}) {
    const root = this._resolveRoot(opts);
    return root
      ? scopeForRoot(
          root,
          this.name,
          this._descriptor.scopeIdentityKey,
          this._deps.fs,
        )
      : undefined;
  }

  async authenticate(ctx = {}) {
    const root = this._resolveRoot(ctx);
    if (!root) {
      return {
        ok: false,
        reason: `${this._descriptor.errorPrefix}_ROOT_UNRESOLVED`,
        message: `No default ${this._descriptor.displayName} state directory could be resolved; select one locally`,
      };
    }
    const hasWorkspaces = this._deps.fs.existsSync(
      path.join(root, "User", "workspaceStorage"),
    );
    const hasTerminalHistory = this._deps.fs.existsSync(
      path.join(root, "User", "globalStorage", "state.vscdb"),
    );
    const hasLocalHistory = this._deps.fs.existsSync(
      path.join(root, "User", "History"),
    );
    if (!hasWorkspaces && !hasTerminalHistory && !hasLocalHistory) {
      return {
        ok: false,
        reason: `${this._descriptor.errorPrefix}_NOT_FOUND`,
        message: `No ${this._descriptor.displayName} workspace, terminal, or Local History state was found in the selected directory`,
      };
    }
    return {
      ok: true,
      mode: "file-import",
      hasWorkspaces,
      hasTerminalHistory,
      hasLocalHistory,
    };
  }

  async healthCheck(ctx = {}) {
    const result = await this.authenticate({ ...ctx, readinessOnly: true });
    return { ok: result.ok, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    const root = this._resolveRoot(opts);
    const auth = await this.authenticate({
      ...opts,
      [this._descriptor.rootOption]: root,
    });
    if (!auth.ok) {
      const error = new Error(`${this.name}.sync: ${auth.message}`);
      error.code = auth.reason;
      throw error;
    }

    const since = parseSince(opts, this.name);
    const limit = parseScanLimit(opts, this.name);
    const includeWorkspaces = opts.include?.workspaces !== false;
    const includeTerminal = opts.include?.terminal !== false;
    const includeLocalHistory = opts.include?.localHistory !== false;
    const rootId = rootFingerprint(root, this.name, this._deps.fs);
    const records = [];
    let complete = true;

    try {
      if (includeWorkspaces) {
        const result = readWorkspaces(root, {
          fs: this._deps.fs,
          since,
          limit,
        });
        complete = complete && result.complete;
        for (const workspace of result.workspaces) {
          records.push({
            kind: "workspace",
            id: workspace.workspaceId,
            capturedAt: workspace.lastOpenedMs,
            payload: workspace,
          });
        }
      }

      if (includeTerminal) {
        const history = readTerminalHistory(root, {
          fs: this._deps.fs,
          limit,
        });
        complete = complete && history.complete;
        const commandTimestamp =
          history.commandsTimestampMs || history.databaseMtimeMs || Date.now();
        const directoryTimestamp =
          history.dirsTimestampMs || history.databaseMtimeMs || Date.now();

        if (
          opts.include?.terminalCommands !== false &&
          commandTimestamp >= since
        ) {
          const occurrences = new Map();
          for (const command of history.commands) {
            const commandHash = sha256Hex(command.value, 24);
            const occurrence = occurrences.get(commandHash) || 0;
            occurrences.set(commandHash, occurrence + 1);
            records.push({
              kind: "terminal-command",
              id: `${commandHash}:${occurrence}`,
              order: command.sourceIndex,
              capturedAt: commandTimestamp,
              payload: { ...command, snapshotTs: commandTimestamp },
            });
          }
        }
        if (
          opts.include?.terminalDirs !== false &&
          directoryTimestamp >= since
        ) {
          const occurrences = new Map();
          for (const directory of history.dirs) {
            const directoryHash = directory.pathHash.slice(0, 24);
            const occurrence = occurrences.get(directoryHash) || 0;
            occurrences.set(directoryHash, occurrence + 1);
            records.push({
              kind: "terminal-dir",
              id: `${directoryHash}:${occurrence}`,
              order: directory.sourceIndex,
              capturedAt: directoryTimestamp,
              payload: { ...directory, snapshotTs: directoryTimestamp },
            });
          }
        }
      }

      if (includeLocalHistory) {
        const result = readLocalHistory(root, {
          fs: this._deps.fs,
          since,
          limit,
        });
        complete = complete && result.complete;
        for (const entry of result.entries) {
          records.push({
            kind: "local-history-save",
            id: `${entry.resourceHash.slice(0, 24)}:${entry.entryIdHash.slice(0, 24)}`,
            capturedAt: entry.savedAtMs,
            payload: entry,
          });
        }
      }
    } catch (error) {
      throw sanitizedReadError(error, this._descriptor);
    }

    records.sort(
      (a, b) =>
        a.capturedAt - b.capturedAt ||
        a.kind.localeCompare(b.kind) ||
        (a.order || 0) - (b.order || 0) ||
        a.id.localeCompare(b.id),
    );
    if (records.length > limit) {
      records.length = limit;
      complete = false;
    }

    for (const record of records) {
      yield {
        kind: record.kind,
        originalId: `${this.name}-${record.kind}:${rootId}:${record.id}`,
        capturedAt: record.capturedAt,
        payload: record.payload,
      };
    }

    if (complete && typeof opts.markWatermarkComplete === "function") {
      opts.markWatermarkComplete();
    }
  }

  normalize(raw) {
    const payload = raw.payload || {};
    const ingestedAt = Date.now();
    const source = {
      adapter: this.name,
      adapterVersion: this.version,
      capturedAt: raw.capturedAt,
      capturedBy: CAPTURED_BY.SQLITE,
      originalId: raw.originalId,
    };
    const empty = {
      events: [],
      persons: [],
      places: [],
      items: [],
      topics: [],
    };

    if (raw.kind === "workspace") {
      const workspaceId =
        typeof payload.workspaceId === "string"
          ? payload.workspaceId
          : sha256Hex(raw.originalId);
      const item = {
        id: `item-${this.name}-workspace-${workspaceId.slice(0, 32)}`,
        type: ENTITY_TYPES.ITEM,
        subtype: ITEM_SUBTYPES.LINK,
        name:
          typeof payload.name === "string" && payload.name
            ? payload.name
            : "(unnamed workspace)",
        category: "code-project",
        ingestedAt,
        source,
        extra: {
          resourceScheme: payload.resourceScheme || "unknown",
          resourceHash: payload.resourceHash || null,
          lastOpenedMs: Number.isInteger(payload.lastOpenedMs)
            ? payload.lastOpenedMs
            : null,
          editor: this._descriptor.editor,
        },
      };
      return { ...empty, items: [item] };
    }

    if (raw.kind === "terminal-command") {
      const command = typeof payload.value === "string" ? payload.value : "";
      const event = {
        id: `event-${this.name}-terminal-cmd-${sha256Hex(raw.originalId, 32)}`,
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.OTHER,
        occurredAt: Number.isInteger(payload.snapshotTs)
          ? payload.snapshotTs
          : raw.capturedAt,
        ingestedAt,
        source,
        actor: "self",
        content: {
          title: command.length > 80 ? `${command.substring(0, 80)}…` : command,
          text: command,
        },
        extra: {
          kind: "terminal-command",
          shellType: payload.shellType || null,
          sourceIndex: payload.sourceIndex,
          editor: this._descriptor.editor,
        },
      };
      return { ...empty, events: [event] };
    }

    if (raw.kind === "terminal-dir") {
      const directoryName =
        typeof payload.name === "string" && payload.name
          ? payload.name
          : "(unknown directory)";
      const event = {
        id: `event-${this.name}-terminal-dir-${sha256Hex(raw.originalId, 32)}`,
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.OTHER,
        occurredAt: Number.isInteger(payload.snapshotTs)
          ? payload.snapshotTs
          : raw.capturedAt,
        ingestedAt,
        source,
        actor: "self",
        content: {
          title: `cd ${directoryName}`,
          text: directoryName,
        },
        extra: {
          kind: "terminal-dir",
          pathHash: payload.pathHash || null,
          shellType: payload.shellType || null,
          sourceIndex: payload.sourceIndex,
          editor: this._descriptor.editor,
        },
      };
      return { ...empty, events: [event] };
    }

    if (raw.kind === "local-history-save") {
      const fileName =
        typeof payload.fileName === "string" && payload.fileName
          ? payload.fileName
          : "(unnamed file)";
      const event = {
        id: `event-${this.name}-local-history-${sha256Hex(raw.originalId, 32)}`,
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.OTHER,
        occurredAt: Number.isInteger(payload.savedAtMs)
          ? payload.savedAtMs
          : raw.capturedAt,
        ingestedAt,
        source,
        actor: "self",
        content: {
          title: `Saved ${fileName}`,
          text: fileName,
        },
        extra: {
          kind: "local-history-save",
          fileExtension: payload.fileExtension || null,
          resourceScheme: payload.resourceScheme || "unknown",
          resourceHash: payload.resourceHash || null,
          hasSaveSource: payload.hasSaveSource === true,
          editor: this._descriptor.editor,
        },
      };
      return { ...empty, events: [event] };
    }

    throw new Error(`${this.name}.normalize: unknown raw.kind=${raw.kind}`);
  }
}

class VSCodeAdapter extends CodeEditorActivityAdapter {
  constructor(opts = {}) {
    super(opts, VSCODE_DESCRIPTOR);
  }
}

module.exports = {
  CodeEditorActivityAdapter,
  VSCodeAdapter,
  VSCODE_NAME: NAME,
  VSCODE_VERSION: VERSION,
  codeEditorParseSince: parseSince,
  codeEditorScanLimit: parseScanLimit,
};
