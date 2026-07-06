/**
 * Dashboard CSP nonce — must be unpredictable per render. It used to be a
 * deterministic constant (same string every render), which makes the
 * script-src nonce gate decorative.
 */
import { describe, it, expect } from "vitest";

import {
  openDashboard,
  refreshDashboard,
} from "../../../vscode-extension/src/ui/dashboard.js";

function fakeVscode(captured) {
  let disposeCb = null;
  return {
    ViewColumn: { Active: -1 },
    window: {
      createWebviewPanel: () => {
        const panel = {
          webview: {
            html: "",
            postMessage: () => {},
            onDidReceiveMessage: () => {},
          },
          onDidDispose: (cb) => {
            disposeCb = cb;
          },
          reveal: () => {},
          __dispose: () => disposeCb && disposeCb(),
        };
        captured.push(panel);
        return panel;
      },
    },
    commands: { executeCommand: () => {} },
  };
}

const fakeLog = () => ({
  counts: () => ({ tool: 0 }),
  recent: () => [],
  onChange: () => () => {},
});

describe("dashboard CSP nonce", () => {
  it("is random per render and wired into both the CSP and the script tags", () => {
    const panels = [];
    const v = fakeVscode(panels);
    const getState = () => ({ port: 0, workspaceFolders: [] });

    const p1 = openDashboard(v, {}, getState, fakeLog());
    const m1 = /script-src 'nonce-([0-9a-f]{32})'/.exec(p1.webview.html);
    expect(m1, "CSP carries a 32-hex nonce").toBeTruthy();
    expect(p1.webview.html).toContain(`nonce="${m1[1]}"`);

    p1.__dispose(); // singleton reset so the next open re-renders
    const p2 = openDashboard(v, {}, getState, fakeLog());
    const m2 = /script-src 'nonce-([0-9a-f]{32})'/.exec(p2.webview.html);
    expect(m2).toBeTruthy();
    expect(m2[1]).not.toBe(m1[1]); // the old constant-nonce bug
    p2.__dispose();
  });
});
