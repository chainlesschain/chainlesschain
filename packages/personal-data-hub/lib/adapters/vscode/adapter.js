"use strict";

// VSCodeAdapter — pulls VSCode workspace history + global terminal history
// from on-disk state. Desktop-local, zero network, no extension required.
//
// Sources (all under `%APPDATA%\Code\` on Win, equivalent on macOS/Linux):
//   - User/workspaceStorage/<hash>/workspace.json  → each opened project
//   - User/globalStorage/state.vscdb               → terminal command history
//
// Yields:
//   kind="workspace"        → Item(LINK, category="code-project")
//   kind="terminal-command" → Event(OTHER, content.title=cmd[0..80])
//   kind="terminal-dir"     → Event(OTHER, content.title=cd <dir>)
//
// Caveat: terminal history has NO per-entry timestamp in VSCode — only a
// single "snapshot updated" ts. We anchor every command/dir to that ts and
// add `sourceIndex` to extra so callers can reconstruct order. Re-syncing
// after a new command lands gives that command (and only that command) a
// fresher snapshot ts.

const path = require("node:path");

const {
  ENTITY_TYPES,
  EVENT_SUBTYPES,
  ITEM_SUBTYPES,
  CAPTURED_BY,
} = require("../../constants");

const {
  defaultVscodeRoot,
  decodeFileUri,
  readWorkspaces,
  readTerminalHistory,
} = require("./vscode-reader");

const NAME = "vscode";
const VERSION = "0.1.0";

class VSCodeAdapter {
  constructor(opts = {}) {
    this.name = NAME;
    this.version = VERSION;
    this.capabilities = [
      "sync:vscode-workspace-storage",
      "sync:vscode-globalstorage-sqlite",
    ];
    this.extractMode = "file-import";
    this.rateLimits = { perDay: 96 };
    this.dataDisclosure = {
      fields: [
        "workspaces:hash,folderUri,folderPath,lastOpenedMs",
        "terminal-commands:command,shellType,sourceIndex,snapshotTs",
        "terminal-dirs:dir,shellType,sourceIndex,snapshotTs",
      ],
      sensitivity: "high",
      legalGate: false,
      defaultInclude: { workspaces: true, terminal: true },
    };
    this._deps = {
      fs: require("node:fs"),
      defaultRoot: defaultVscodeRoot,
    };
    this._rootOverride = typeof opts.vscodeRoot === "string" ? opts.vscodeRoot : null;
  }

  _resolveRoot(opts) {
    if (typeof opts?.vscodeRoot === "string" && opts.vscodeRoot.length > 0) {
      return opts.vscodeRoot;
    }
    if (this._rootOverride) return this._rootOverride;
    return this._deps.defaultRoot();
  }

  async authenticate(ctx = {}) {
    const root = this._resolveRoot(ctx);
    if (!root) {
      return {
        ok: false,
        reason: "VSCODE_ROOT_UNRESOLVED",
        message: "no default VSCode root on this platform; pass opts.vscodeRoot",
      };
    }
    const wsRoot = path.join(root, "User", "workspaceStorage");
    const stateDb = path.join(root, "User", "globalStorage", "state.vscdb");
    const wsExists = this._deps.fs.existsSync(wsRoot);
    const stateExists = this._deps.fs.existsSync(stateDb);
    if (!wsExists && !stateExists) {
      return {
        ok: false,
        reason: "VSCODE_NOT_FOUND",
        message: `no VSCode state at ${root} — install VS Code / open it at least once, or pass opts.vscodeRoot`,
      };
    }
    return {
      ok: true,
      mode: "file-import",
      vscodeRoot: root,
      hasWorkspaces: wsExists,
      hasTerminalHistory: stateExists,
    };
  }

  async healthCheck() {
    const root = this._resolveRoot({});
    const ok =
      !!root &&
      (this._deps.fs.existsSync(path.join(root, "User", "workspaceStorage")) ||
        this._deps.fs.existsSync(path.join(root, "User", "globalStorage", "state.vscdb")));
    return { ok, lastChecked: Date.now() };
  }

  async *sync(opts = {}) {
    const root = this._resolveRoot(opts);
    if (!root) {
      throw new Error("vscode.sync: no VSCode root resolved — pass opts.vscodeRoot");
    }
    const includeWorkspaces = opts.include?.workspaces !== false;
    const includeTerminal = opts.include?.terminal !== false;
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
    const capturedAt = Date.now();
    let emitted = 0;

    if (includeWorkspaces) {
      for (const w of readWorkspaces(root, { fs: this._deps.fs, since: opts.since })) {
        if (emitted >= limit) return;
        yield {
          kind: "workspace",
          originalId: `vscode-workspace:${w.hash}`,
          capturedAt,
          payload: w,
        };
        emitted += 1;
      }
    }

    if (includeTerminal) {
      const hist = readTerminalHistory(root, { fs: this._deps.fs });
      const cmdTs = Number.isInteger(hist.commandsTimestampMs)
        ? hist.commandsTimestampMs
        : capturedAt;
      const dirTs = Number.isInteger(hist.dirsTimestampMs)
        ? hist.dirsTimestampMs
        : capturedAt;
      if (opts.include?.terminalCommands !== false) {
        for (const c of hist.commands) {
          if (emitted >= limit) return;
          if (Number.isInteger(opts.since) && cmdTs < opts.since) break;
          yield {
            kind: "terminal-command",
            // Index disambiguates entries that re-occur with identical command
            // text — keeps registry.putRawEvent's UNIQUE(source.originalId) happy.
            originalId: `vscode-terminal-cmd:${c.sourceIndex}:${hashCommand(c.value)}`,
            capturedAt,
            payload: { ...c, snapshotTs: cmdTs },
          };
          emitted += 1;
        }
      }
      if (opts.include?.terminalDirs !== false) {
        for (const d of hist.dirs) {
          if (emitted >= limit) return;
          if (Number.isInteger(opts.since) && dirTs < opts.since) break;
          yield {
            kind: "terminal-dir",
            originalId: `vscode-terminal-dir:${d.sourceIndex}:${hashCommand(d.value)}`,
            capturedAt,
            payload: { ...d, snapshotTs: dirTs },
          };
          emitted += 1;
        }
      }
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

    if (raw.kind === "workspace") {
      const p = raw.payload || {};
      const uri = p.folderUri || p.workspaceUri || `vscode-hash:${p.hash}`;
      const name =
        (p.folderPath && p.folderPath.split(/[\\/]/).filter(Boolean).pop()) ||
        decodeFileUri(uri) ||
        uri;
      const item = {
        id: `item-vscode-workspace-${p.hash}`,
        type: ENTITY_TYPES.ITEM,
        subtype: ITEM_SUBTYPES.LINK,
        name: name || "(无名工程)",
        category: "code-project",
        ingestedAt,
        source: source(`vscode-workspace:${p.hash}`),
        extra: {
          folderUri: p.folderUri || null,
          workspaceUri: p.workspaceUri || null,
          folderPath: p.folderPath || null,
          lastOpenedMs: Number.isInteger(p.lastOpenedMs) ? p.lastOpenedMs : null,
          editor: "vscode",
        },
      };
      return { events: [], persons: [], places: [], items: [item], topics: [] };
    }

    if (raw.kind === "terminal-command") {
      const p = raw.payload || {};
      const cmd = typeof p.value === "string" ? p.value : "";
      const event = {
        id: `event-vscode-terminal-cmd-${p.sourceIndex}-${shortHash(cmd)}`,
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.OTHER,
        occurredAt: Number.isInteger(p.snapshotTs) ? p.snapshotTs : raw.capturedAt,
        ingestedAt,
        source: source(raw.originalId),
        actor: "self",
        content: {
          title: cmd.length > 80 ? cmd.substring(0, 80) + "…" : cmd,
          text: cmd,
        },
        extra: {
          kind: "terminal-command",
          shellType: p.shellType || null,
          sourceIndex: p.sourceIndex,
          editor: "vscode",
        },
      };
      return { events: [event], persons: [], places: [], items: [], topics: [] };
    }

    if (raw.kind === "terminal-dir") {
      const p = raw.payload || {};
      const dir = typeof p.value === "string" ? p.value : "";
      const event = {
        id: `event-vscode-terminal-dir-${p.sourceIndex}-${shortHash(dir)}`,
        type: ENTITY_TYPES.EVENT,
        subtype: EVENT_SUBTYPES.OTHER,
        occurredAt: Number.isInteger(p.snapshotTs) ? p.snapshotTs : raw.capturedAt,
        ingestedAt,
        source: source(raw.originalId),
        actor: "self",
        content: {
          title: `cd ${dir.length > 76 ? dir.substring(0, 76) + "…" : dir}`,
          text: dir,
        },
        extra: {
          kind: "terminal-dir",
          shellType: p.shellType || null,
          sourceIndex: p.sourceIndex,
          editor: "vscode",
        },
      };
      return { events: [event], persons: [], places: [], items: [], topics: [] };
    }

    throw new Error(`vscode.normalize: unknown raw.kind=${raw.kind}`);
  }
}

// Cheap non-crypto hash for de-duping originalId + event id collisions.
// Don't need cryptographic strength here — the registry UNIQUE constraint
// gives the real guarantee.
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
  VSCodeAdapter,
  VSCODE_NAME: NAME,
  VSCODE_VERSION: VERSION,
};
