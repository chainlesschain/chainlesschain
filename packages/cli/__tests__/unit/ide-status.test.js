/**
 * `/ide` REPL command renderer (Claude-Code parity) — connected status, the
 * editor/port/workspace, the in-session IDE tools, or (when absent) the
 * discovery diagnosis + how to connect.
 */
import { describe, it, expect } from "vitest";
import { ideToolNames, renderIdeStatus } from "../../src/repl/ide-status.js";

function mcpWithIde() {
  return {
    externalToolExecutors: {
      mcp__ide__getSelection: { kind: "mcp", serverName: "ide" },
      mcp__ide__getDiagnostics: { kind: "mcp", serverName: "ide" },
      mcp__ide__openDiff: { kind: "mcp", serverName: "ide" },
      // a non-IDE tool from another server must be ignored
      mcp__other__doThing: { kind: "mcp", serverName: "other" },
    },
  };
}

const DIAG_CONNECTED = {
  inIdeTerminal: true,
  lockDir: "/home/u/.chainlesschain/ide",
  locks: [{ ide: "vscode", port: 53690, transport: "http", matchScore: 2 }],
  chosen: {
    ide: "vscode",
    port: 53690,
    transport: "http",
    workspaceFolders: ["/proj"],
  },
  reason: "matched CHAINLESSCHAIN_IDE_PORT (env fast-path)",
};

describe("ideToolNames", () => {
  it("returns sorted bare IDE tool names, ignoring non-IDE servers", () => {
    expect(ideToolNames(mcpWithIde())).toEqual([
      "getDiagnostics",
      "getSelection",
      "openDiff",
    ]);
  });

  it("is empty for a bundle with no IDE tools / null", () => {
    expect(ideToolNames({ externalToolExecutors: {} })).toEqual([]);
    expect(ideToolNames(null)).toEqual([]);
  });

  it("ignores executors that aren't kind:mcp", () => {
    expect(
      ideToolNames({
        externalToolExecutors: { mcp__ide__getSelection: { kind: "local" } },
      }),
    ).toEqual([]);
  });
});

describe("renderIdeStatus — connected", () => {
  it("shows editor, workspace, and tools when connected", () => {
    const out = renderIdeStatus(mcpWithIde(), DIAG_CONNECTED);
    expect(out).toContain(
      "● IDE bridge connected — vscode on 127.0.0.1:53690 (http)",
    );
    expect(out).toContain("workspace: /proj");
    expect(out).toContain("mcp__ide__getSelection");
    expect(out).toContain("@selection / @diagnostics");
  });

  it("still reports connected via in-session tools when diag is missing", () => {
    const out = renderIdeStatus(mcpWithIde(), null);
    expect(out).toContain("● IDE bridge connected — an editor extension");
    expect(out).toContain("mcp__ide__openDiff");
  });
});

describe("renderIdeStatus — not connected", () => {
  it("explains why and how to connect when locks exist but don't match", () => {
    const diag = {
      inIdeTerminal: false,
      lockDir: "/home/u/.chainlesschain/ide",
      locks: [{ ide: "vscode", port: 1111, transport: "http", matchScore: -1 }],
      chosen: null,
      reason: "lockfiles present but none match cwd's workspace",
    };
    const out = renderIdeStatus({ externalToolExecutors: {} }, diag);
    expect(out).toContain("○ IDE bridge not connected");
    expect(out).toContain("none match cwd's workspace");
    expect(out).toContain("1 lockfile(s)");
    expect(out).toContain("vscode :1111 http");
    expect(out).toContain("--ide to force-connect");
  });

  it("hints to restart when inside an IDE terminal", () => {
    const diag = {
      inIdeTerminal: true,
      lockDir: "/x",
      locks: [],
      chosen: null,
      reason: "no live IDE lockfiles",
    };
    const out = renderIdeStatus(null, diag);
    expect(out).toContain("restart the agent so it re-discovers");
  });

  it("falls back to install hint when no diagnosis is available", () => {
    const out = renderIdeStatus(null, null);
    expect(out).toContain("○ IDE bridge not connected");
    expect(out).toContain("install the ChainlessChain IDE extension");
  });
});
