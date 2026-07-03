/**
 * lsp-server-registry tests — language mapping, bin resolution (project-local
 * wins over PATH), plugin server registration, and availability probing. FS
 * existence is faked via `_deps.existsSync`; no real toolchain needed.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import {
  languageIdForFile,
  resolveServer,
  resolveBin,
  probeServers,
  registerLanguageServer,
  _resetPluginServers,
  _deps,
} from "../lsp-server-registry.js";

let origExists;
beforeEach(() => {
  origExists = _deps.existsSync;
  _resetPluginServers();
});
afterEach(() => {
  _deps.existsSync = origExists;
  _resetPluginServers();
});

/** existsSync true only for the given absolute paths (normalized separators). */
function existsFor(paths) {
  const set = new Set(paths.map((p) => p.replace(/\\/g, "/")));
  _deps.existsSync = (p) => set.has(String(p).replace(/\\/g, "/"));
}

describe("languageIdForFile", () => {
  it("maps common extensions", () => {
    expect(languageIdForFile("a.ts")).toBe("typescript");
    expect(languageIdForFile("a.TSX")).toBe("typescriptreact");
    expect(languageIdForFile("a.py")).toBe("python");
    expect(languageIdForFile("a.go")).toBe("go");
    expect(languageIdForFile("a.rs")).toBe("rust");
  });
  it("returns null for unsupported extensions", () => {
    expect(languageIdForFile("a.txt")).toBeNull();
    expect(languageIdForFile("noext")).toBeNull();
  });
});

describe("resolveBin", () => {
  it("prefers project node_modules/.bin over PATH", () => {
    const isWin = process.platform === "win32";
    const binName = isWin
      ? "typescript-language-server.cmd"
      : "typescript-language-server";
    const localBin = path.join("/proj", "node_modules", ".bin", binName);
    existsFor([localBin]);
    const resolved = resolveBin("typescript-language-server", "/proj");
    expect(resolved.replace(/\\/g, "/")).toBe(localBin.replace(/\\/g, "/"));
  });

  it("returns null when nothing resolves", () => {
    existsFor([]);
    expect(resolveBin("nonexistent-server", "/proj")).toBeNull();
  });
});

describe("resolveServer", () => {
  it("resolves a TS server command with --stdio args", () => {
    const isWin = process.platform === "win32";
    const binName = isWin
      ? "typescript-language-server.cmd"
      : "typescript-language-server";
    existsFor([path.join("/proj", "node_modules", ".bin", binName)]);
    const s = resolveServer("typescript", "/proj");
    expect(s).toMatchObject({
      languageId: "typescript",
      id: "typescript-language-server",
      args: ["--stdio"],
    });
    expect(s.command).toContain("typescript-language-server");
  });

  it("returns null for a language with no installed server", () => {
    existsFor([]);
    expect(resolveServer("rust", "/proj")).toBeNull();
  });

  it("returns null for an unknown language", () => {
    existsFor([]);
    expect(resolveServer("cobol", "/proj")).toBeNull();
  });
});

describe("plugin server registration", () => {
  it("registers an extra language server and its extensions", () => {
    registerLanguageServer({
      languageId: "zig",
      extensions: [".zig"],
      command: "zls",
      args: [],
    });
    expect(languageIdForFile("a.zig")).toBe("zig");
    const isWin = process.platform === "win32";
    existsFor([
      path.join("/proj", "node_modules", ".bin", isWin ? "zls.cmd" : "zls"),
    ]);
    const s = resolveServer("zig", "/proj");
    expect(s).toMatchObject({ id: "zls" });
  });

  it("rejects an incomplete registration", () => {
    expect(() => registerLanguageServer({ languageId: "x" })).toThrow(
      /requires/,
    );
  });
});

describe("probeServers", () => {
  it("reports availability per server family", () => {
    existsFor([]); // nothing installed
    const rows = probeServers("/proj");
    expect(rows.every((r) => r.available === false)).toBe(true);
    // one row per distinct server id (TS family collapses)
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("typescript-language-server");
  });
});
