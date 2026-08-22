import { describe, expect, it, vi } from "vitest";
import {
  DiagnosticsSnapshotScheduler,
  formatDiagnosticsSnapshotForContext,
} from "../../../vscode-extension/src/diagnostics-scheduler.js";
import { createVscodeEditorFacade } from "../../../vscode-extension/src/vscode-facade.js";

function update(uri, version, diagnostics) {
  return {
    uri,
    file: uri.replace("file://", ""),
    documentVersion: version,
    read: async () => diagnostics,
  };
}

function diagnostic(message, severity = "error", line = 0) {
  return { message, severity, line, character: 0, source: "fixture" };
}

describe("VS Code diagnostics snapshot scheduler", () => {
  it("debounces generations and publishes only the newest URI/version", async () => {
    const scheduler = new DiagnosticsSnapshotScheduler({ debounceMs: 10 });
    scheduler.schedule([
      update("file:///workspace/a.js", 1, [diagnostic("old")]),
    ]);
    scheduler.schedule([
      update("file:///workspace/a.js", 2, [diagnostic("new")]),
    ]);

    const snapshot = await scheduler.flushNow();
    expect(snapshot).toMatchObject({ stable: true, summary: { total: 1 } });
    expect(snapshot.diagnostics[0]).toMatchObject({
      documentUri: "file:///workspace/a.js",
      documentVersion: 2,
      message: "new",
    });
    expect(scheduler.getStats()).toMatchObject({
      canceledGenerationCount: 1,
      publishedDuplicateCount: 0,
      publishedStaleVersionCount: 0,
    });

    scheduler.schedule([
      update("file:///workspace/a.js", 1, [diagnostic("stale")]),
    ]);
    await scheduler.flushNow();
    expect(scheduler.getSnapshot().diagnostics[0].message).toBe("new");
    expect(scheduler.getStats().staleRequestSuppressedCount).toBe(1);
    scheduler.dispose();
  });

  it("deduplicates records, summarizes severity, and reports bounded truncation", async () => {
    const scheduler = new DiagnosticsSnapshotScheduler({
      debounceMs: 0,
      maxDiagnostics: 2,
      maxMessageChars: 8,
    });
    scheduler.schedule([
      update("file:///workspace/a.js", 7, [
        diagnostic("duplicate-long-message", "error", 1),
        diagnostic("duplicate-long-message", "error", 1),
        diagnostic("warning", "warning", 2),
        diagnostic("hint", "hint", 3),
      ]),
    ]);
    const snapshot = await scheduler.flushNow();
    expect(snapshot.summary).toEqual({
      total: 2,
      error: 1,
      warning: 1,
      information: 0,
      hint: 0,
      unknown: 0,
      uriCount: 1,
      truncatedCount: 1,
    });
    expect(snapshot.diagnostics[0].message).toBe("duplicat");
    expect(scheduler.getStats().duplicateDiagnosticSuppressedCount).toBe(1);
    expect(formatDiagnosticsSnapshotForContext(snapshot, 180)).toContain(
      "stable diagnostics snapshot",
    );
    scheduler.dispose();
  });

  it("cancels an in-flight generation without dropping untouched URI state", async () => {
    let releaseRead;
    let announceRead;
    const readStarted = new Promise((resolve) => {
      announceRead = resolve;
    });
    const readGate = new Promise((resolve) => {
      releaseRead = resolve;
    });
    const scheduler = new DiagnosticsSnapshotScheduler({ debounceMs: 0 });
    scheduler.schedule(
      [
        {
          ...update("file:///workspace/a.js", 1, []),
          read: async () => {
            announceRead();
            await readGate;
            return [diagnostic("a-old")];
          },
        },
        update("file:///workspace/b.js", 1, [diagnostic("b-stable")]),
      ],
      { replaceAll: true },
    );
    const flushing = scheduler.flushNow();
    await readStarted;
    scheduler.schedule([
      update("file:///workspace/a.js", 2, [diagnostic("a-new")]),
    ]);
    releaseRead();
    const snapshot = await flushing;
    expect(snapshot.diagnostics.map((value) => value.message).sort()).toEqual([
      "a-new",
      "b-stable",
    ]);
    expect(snapshot.summary.uriCount).toBe(2);
    scheduler.dispose();
  });

  it("does not restore old URIs over a newer replace-all generation", async () => {
    let releaseRead;
    let announceRead;
    const readStarted = new Promise((resolve) => {
      announceRead = resolve;
    });
    const readGate = new Promise((resolve) => {
      releaseRead = resolve;
    });
    const scheduler = new DiagnosticsSnapshotScheduler({ debounceMs: 0 });
    scheduler.schedule(
      [
        {
          ...update("file:///workspace/a.js", 1, []),
          read: async () => {
            announceRead();
            await readGate;
            return [diagnostic("a-old")];
          },
        },
        update("file:///workspace/b.js", 1, [diagnostic("b-old")]),
      ],
      { replaceAll: true },
    );
    const flushing = scheduler.flushNow();
    await readStarted;
    scheduler.schedule(
      [update("file:///workspace/a.js", 2, [diagnostic("a-new")])],
      { replaceAll: true },
    );
    releaseRead();
    const snapshot = await flushing;
    expect(snapshot.diagnostics.map((value) => value.message)).toEqual([
      "a-new",
    ]);
    expect(snapshot.summary.uriCount).toBe(1);
    scheduler.dispose();
  });

  it("wires onDidChangeDiagnostics into the real facade and disposes it", async () => {
    const uri = {
      fsPath: "/workspace/a.js",
      toString: () => "file:///workspace/a.js",
    };
    const document = { uri, version: 1, isDirty: false };
    let current = [
      {
        severity: 0,
        message: "first",
        range: { start: { line: 0, character: 0 } },
      },
    ];
    let listener;
    const disposable = { dispose: vi.fn() };
    const vscode = {
      commands: { executeCommand: vi.fn() },
      languages: {
        getDiagnostics: (requested) => (requested ? current : [[uri, current]]),
        onDidChangeDiagnostics: (callback) => {
          listener = callback;
          return disposable;
        },
      },
      window: { visibleTextEditors: [] },
      workspace: {
        textDocuments: [document],
        workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
      },
    };
    const facade = createVscodeEditorFacade(vscode, {
      diagnosticsScheduler: { debounceMs: 0 },
    });
    expect((await facade.getDiagnostics())[0]).toMatchObject({
      documentVersion: 1,
      message: "first",
    });

    document.version = 2;
    current = [
      {
        severity: 1,
        message: "second",
        range: { start: { line: 3, character: 2 } },
      },
    ];
    listener({ uris: [uri] });
    expect(await facade.getDiagnostics()).toEqual([
      expect.objectContaining({
        documentVersion: 2,
        severity: "warning",
        message: "second",
      }),
    ]);
    const candidates = await facade.getContextCandidates();
    expect(
      candidates.find((candidate) => candidate.kind === "diagnostics"),
    ).toMatchObject({
      source: "vscode.languages.onDidChangeDiagnostics",
      freshness: { state: "stable-snapshot" },
    });
    facade.disposeTerminalCapture();
    expect(disposable.dispose).toHaveBeenCalledOnce();
  });
});
