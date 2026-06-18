/**
 * Panel `/cost` + `/context` (Claude Code REPL parity). They defer to the CLI
 * (`cc cost <id>` / `cc context <id>`) for THIS panel's session rather than
 * re-implementing pricing / context math in the webview.
 *
 * Layers: the pure args builder, the never-rejecting CLI runner (injected
 * execFile), the provider flow (no session → hint; with session → spawn + post
 * a `pre` block), and the generated-HTML gate (the slash commands + `pre`
 * render case must ship and every script must still parse).
 */
import { describe, it, expect, vi } from "vitest";

import {
  buildIntrospectArgs,
  runCliText,
} from "../../../vscode-extension/src/chat/introspect-commands.js";
import { ChatViewProvider } from "../../../vscode-extension/src/chat/chat-view.js";
import { buildChatHtml } from "../../../vscode-extension/src/chat/chat-html.js";

describe("buildIntrospectArgs", () => {
  it("cost → [cost, id] (id trimmed)", () => {
    expect(buildIntrospectArgs("cost", "  abc ")).toEqual(["cost", "abc"]);
  });
  it("context → [context, id] with optional model/provider", () => {
    expect(buildIntrospectArgs("context", "abc")).toEqual(["context", "abc"]);
    expect(
      buildIntrospectArgs("context", "abc", {
        model: "qwen2.5:7b",
        provider: "ollama",
      }),
    ).toEqual([
      "context",
      "abc",
      "--model",
      "qwen2.5:7b",
      "--provider",
      "ollama",
    ]);
  });
  it("ignores blank model/provider", () => {
    expect(
      buildIntrospectArgs("context", "abc", { model: "  ", provider: "" }),
    ).toEqual(["context", "abc"]);
  });
});

describe("runCliText (never rejects)", () => {
  const opts = (execFile) => ({
    command: "cc",
    args: ["cost", "x"],
    deps: { execFile },
  });

  it("resolves trimmed stdout", async () => {
    const execFile = vi.fn((cmd, args, o, cb) =>
      cb(null, "  total: $0.01\n", ""),
    );
    await expect(runCliText(opts(execFile))).resolves.toBe("total: $0.01");
    expect(execFile).toHaveBeenCalledWith(
      "cc",
      ["cost", "x"],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("falls back to stderr when stdout is empty", async () => {
    const execFile = vi.fn((cmd, args, o, cb) =>
      cb(new Error("boom"), "", "no such session"),
    );
    await expect(runCliText(opts(execFile))).resolves.toBe("no such session");
  });

  it("resolves '' on a hard failure with no output", async () => {
    const execFile = vi.fn((cmd, args, o, cb) => cb(new Error("boom"), "", ""));
    await expect(runCliText(opts(execFile))).resolves.toBe("");
  });
});

describe("ChatViewProvider._runIntrospect", () => {
  function makeProvider({ sessionId, runCliText: runText } = {}) {
    const posts = [];
    const vscode = {
      commands: { executeCommand: vi.fn() },
      workspace: {
        workspaceFolders: [{ uri: { fsPath: "/ws" } }],
        getConfiguration: () => ({ get: () => "" }),
      },
    };
    const state = { get: () => sessionId || null, update: () => {} };
    const provider = new ChatViewProvider(vscode, {
      state,
      getBridgeEnv: () => ({}),
      deps: runText ? { runCliText: runText } : undefined,
    });
    provider._post = (m) => posts.push(m);
    return { provider, posts };
  }

  it("hints to send a message first when there is no session", async () => {
    const { provider, posts } = makeProvider({ sessionId: null });
    await provider._runIntrospect("cost");
    expect(posts).toEqual([
      { kind: "info", text: "/cost: send a message first — no session yet." },
    ]);
  });

  it("runs the CLI for the stored session and posts a pre block", async () => {
    const runText = vi
      .fn()
      .mockResolvedValue("Session cost (estimated):\n  total: $0.02");
    const { provider, posts } = makeProvider({
      sessionId: "sess-1",
      runCliText: runText,
    });
    await provider._runIntrospect("context");
    // [kind, id] is always passed for the stored session; the effective
    // model/provider tail is resolved from panel config → cc config (env-
    // dependent), so assert only the stable prefix here. LLM-arg shaping is
    // covered deterministically by the buildIntrospectArgs unit tests above.
    expect(runText.mock.calls[0][0].args.slice(0, 2)).toEqual([
      "context",
      "sess-1",
    ]);
    expect(posts).toEqual([
      { kind: "pre", text: "Session cost (estimated):\n  total: $0.02" },
    ]);
  });

  it("posts a fallback when the CLI returns nothing", async () => {
    const runText = vi.fn().mockResolvedValue("");
    const { provider, posts } = makeProvider({
      sessionId: "sess-1",
      runCliText: runText,
    });
    await provider._runIntrospect("cost");
    expect(posts).toEqual([{ kind: "pre", text: "/cost: (no output)" }]);
  });
});

describe("chat HTML ships /cost, /context + the pre case (parse gate)", () => {
  it("registers the slash commands, the pre render case, and stays parseable", () => {
    const html = buildChatHtml({ nonce: "n".repeat(32), cspSource: "vsc:" });
    expect(html).toContain('"/cost"');
    expect(html).toContain('"/context"');
    expect(html).toContain('type: "cost"');
    expect(html).toContain('type: "context"');
    expect(html).toContain('case "pre"');
    const scripts = [
      ...html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g),
    ];
    for (const [, body] of scripts) new Function(body); // syntax-error gate
  });
});
