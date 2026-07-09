/**
 * Fake `vscode` module — wired in via a Module._resolveFilename hook (see
 * vscode-ext-activate-wiring.test.js) so the extension entry point's
 * top-level native require("vscode") resolves headless. Covers exactly the
 * API surface activate()/startBridge() touch at wiring time; everything is
 * inert (no host, no UI) and the registered commands are captured so tests
 * can invoke each callback and assert it doesn't blow up (the ReferenceError
 * class of bug — a callback referencing an out-of-scope variable — passes
 * declaration-only tests and detonates on first keypress).
 *
 * State is module-global (like the real `vscode` singleton); call __reset()
 * in beforeEach.
 */

class EventEmitter {
  constructor() {
    this._listeners = [];
    this.event = (fn) => {
      this._listeners.push(fn);
      return { dispose: () => {} };
    };
  }
  fire(e) {
    for (const fn of this._listeners) fn(e);
  }
  dispose() {}
}

class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class ThemeIcon {
  constructor(id) {
    this.id = id;
  }
}

class ThemeColor {
  constructor(id) {
    this.id = id;
  }
}

class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}

class WorkspaceEdit {
  constructor() {
    this.edits = [];
  }
  replace(uri, range, text) {
    this.edits.push({ uri, range, text });
  }
}

class Selection {
  constructor(start, end) {
    this.start = start;
    this.end = end;
    this.anchor = start;
    this.active = end;
  }
}

class CodeLens {
  constructor(range, command) {
    this.range = range;
    this.command = command;
  }
}

class InlineCompletionItem {
  constructor(insertText, range) {
    this.insertText = insertText;
    this.range = range;
  }
}

const commands = {}; // command id → callback (captured by registerCommand)
const executed = []; // executeCommand log
const messages = { info: [], warn: [], error: [] };
let configValues = {}; // "<section>.<key>" → value

function getConfiguration(section) {
  return {
    get: (key, dflt) => {
      const full = section ? `${section}.${key}` : key;
      return full in configValues ? configValues[full] : dflt;
    },
  };
}

const vscode = {
  EventEmitter,
  TreeItem,
  ThemeIcon,
  ThemeColor,
  Range,
  Selection,
  CodeLens,
  InlineCompletionItem,
  InlineCompletionTriggerKind: { Invoke: 0, Automatic: 1 },
  WorkspaceEdit,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ProgressLocation: { Notification: 15 },
  ViewColumn: { Active: -1, One: 1, Two: 2 },
  CodeActionKind: { QuickFix: { value: "quickfix" } },
  Uri: {
    file: (p) => ({ fsPath: p, path: p, toString: () => "file://" + p }),
    parse: (s) => ({ toString: () => s }),
  },
  window: {
    createOutputChannel: () => ({ appendLine: () => {}, dispose: () => {} }),
    createStatusBarItem: () => ({
      show: () => {},
      hide: () => {},
      dispose: () => {},
      text: "",
      tooltip: "",
      command: undefined,
      backgroundColor: undefined,
    }),
    registerTreeDataProvider: () => ({ dispose: () => {} }),
    registerWebviewViewProvider: () => ({ dispose: () => {} }),
    registerUriHandler: () => ({ dispose: () => {} }),
    showInformationMessage: (msg) => {
      messages.info.push(msg);
      return Promise.resolve(undefined);
    },
    showWarningMessage: (msg) => {
      messages.warn.push(msg);
      return Promise.resolve(undefined);
    },
    showErrorMessage: (msg) => {
      messages.error.push(msg);
      return Promise.resolve(undefined);
    },
    showQuickPick: () => Promise.resolve(undefined),
    showInputBox: () => Promise.resolve(undefined),
    showOpenDialog: () => Promise.resolve(undefined),
    showTextDocument: () => Promise.resolve({ selection: undefined }),
    setStatusBarMessage: () => ({ dispose: () => {} }),
    withProgress: (_opts, task) => Promise.resolve(task()),
    createTerminal: () => ({
      sendText: () => {},
      show: () => {},
      dispose: () => {},
      name: "fake-terminal",
    }),
    terminals: [],
    createWebviewPanel: () => ({
      webview: {
        html: "",
        cspSource: "vscode-resource:",
        postMessage: () => Promise.resolve(true),
        onDidReceiveMessage: () => ({ dispose: () => {} }),
      },
      onDidDispose: () => ({ dispose: () => {} }),
      reveal: () => {},
      dispose: () => {},
    }),
    activeTextEditor: undefined,
    tabGroups: undefined, // simplest host shape — optional chained everywhere
  },
  workspace: {
    getConfiguration,
    workspaceFolders: [],
    asRelativePath: (uri) => String(uri?.fsPath || uri || ""),
    openTextDocument: async () => {
      throw new Error("fake-vscode: openTextDocument not stubbed");
    },
    applyEdit: async () => true,
    onDidChangeConfiguration: () => ({ dispose: () => {} }),
  },
  commands: {
    registerCommand: (id, fn) => {
      commands[id] = fn;
      return { dispose: () => delete commands[id] };
    },
    executeCommand: (id, ...args) => {
      executed.push({ id, args });
      return Promise.resolve(undefined);
    },
  },
  languages: {
    registerCodeActionsProvider: () => ({ dispose: () => {} }),
    registerCodeLensProvider: () => ({ dispose: () => {} }),
    registerInlineCompletionItemProvider: () => ({ dispose: () => {} }),
    getDiagnostics: () => [],
  },
  // vscode.l10n.t — returns the base (English) message with {0}/{1} positional
  // args substituted, matching the real API's format so assertions on the
  // rendered text hold. (The host loads the zh-cn bundle at runtime; tests run
  // against the source-language base.)
  l10n: {
    t: (message, ...args) => {
      const s =
        typeof message === "string"
          ? message
          : (message && message.message) || "";
      return s.replace(/\{(\d+)\}/g, (m, i) =>
        args[Number(i)] != null ? String(args[Number(i)]) : m,
      );
    },
  },

  // ── test seams (not part of the real API) ────────────────────────────────
  __commands: commands,
  __executed: executed,
  __messages: messages,
  __setConfig(values) {
    configValues = { ...values };
  },
  __reset() {
    for (const k of Object.keys(commands)) delete commands[k];
    executed.length = 0;
    messages.info.length = 0;
    messages.warn.length = 0;
    messages.error.length = 0;
    configValues = {};
    vscode.window.activeTextEditor = undefined;
    vscode.workspace.workspaceFolders = [];
  },
};

module.exports = vscode;
