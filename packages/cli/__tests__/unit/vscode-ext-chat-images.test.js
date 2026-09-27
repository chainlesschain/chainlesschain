/**
 * Chat panel image paste — webview data URLs → host temp files → stream-json
 * {"type":"user","images":[paths]} (the CLI side is covered by
 * headless-stream-images.test.js). Host-side hardening: only whitelisted
 * image data URLs become files, capped per message; the generated HTML keeps
 * parsing (dead-panel gate).
 */
import { describe, it, expect } from "vitest";
import fs from "fs";

import { ChatViewProvider } from "../../../vscode-extension/src/chat/chat-view.js";
import { buildChatHtml } from "../../../vscode-extension/src/chat/chat-html.js";

// 1×1 transparent PNG.
const PNG_BASE64 =
  "iVBORw0KGgoAAAABAAAAAQAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==".replace(
    "AAAABAAAAAQAAAAE",
    "AAAANSUhEUgAAAAE",
  );
const PNG_URL = "data:image/png;base64," + PNG_BASE64;

function makeProvider() {
  return new ChatViewProvider(
    { workspace: { getConfiguration: () => ({ get: () => undefined }) } },
    {},
  );
}

describe("ChatViewProvider._writeImageTemps", () => {
  it("writes a whitelisted data URL to a temp file with the exact bytes", async () => {
    const provider = makeProvider();
    const files = await provider._writeImageTemps([{ data: PNG_URL }]);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/cc-chat-img-.*\.png$/);
    try {
      expect(fs.readFileSync(files[0]).toString("base64")).toBe(PNG_BASE64);
    } finally {
      fs.rmSync(files[0], { force: true });
    }
  });

  it("rejects MIME spoofing without sending a partial attachment set", async () => {
    const provider = makeProvider();
    await expect(
      provider._writeImageTemps([
        { data: "data:image/jpeg;base64," + PNG_BASE64 },
        { data: "data:image/webp;base64," + PNG_BASE64 },
      ]),
    ).rejects.toThrow("MIME");
  });

  it("reports junk: non-image mime, malformed base64, missing data", async () => {
    const provider = makeProvider();
    for (const image of [
      { data: "data:text/html;base64," + PNG_BASE64 }, // not an image
      { data: "data:image/png;base64,!!!not-base64$$" }, // bad charset
      { data: "C:\\windows\\system32\\evil.png" }, // not a data URL
      {},
      null,
    ])
      await expect(provider._writeImageTemps([image])).rejects.toThrow();
  });

  it("rejects more than 4 attachments per message visibly", async () => {
    const provider = makeProvider();
    await expect(
      provider._writeImageTemps(
        Array.from({ length: 7 }, () => ({ data: PNG_URL })),
      ),
    ).rejects.toThrow("at most 4");
  });
});

describe("chat HTML ships the paste/attach UI (parse gate)", () => {
  it("has the attach strip and paste handler, and all scripts parse", () => {
    const html = buildChatHtml({ nonce: "n".repeat(32), cspSource: "vsc:" });
    expect(html).toContain('id="attach"');
    expect(html).toContain('addEventListener("paste"');
    const scripts = [
      ...html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g),
    ];
    for (const [, body] of scripts) {
      new Function(body); // throws on syntax error — dead-panel gate
    }
  });
});

describe("image temp-file cleanup (no tmpdir pile-up)", () => {
  function makeSendableProvider() {
    const spawns = [];
    const provider = new ChatViewProvider(
      {
        commands: { executeCommand: () => Promise.resolve() },
        window: {},
        workspace: {
          workspaceFolders: [{ uri: { fsPath: "/ws" } }],
          getConfiguration: () => ({ get: () => undefined }),
        },
      },
      {
        deps: {
          createSession: (cfg) => {
            const s = {
              cfg,
              running: true,
              send: () => true,
              sendEvent: () => true,
              stop() {
                this.running = false;
              },
            };
            spawns.push(s);
            return s;
          },
          resolveChatLlm: () => ({
            provider: "",
            model: "",
            baseUrl: "",
            apiKey: "",
          }),
        },
      },
    );
    provider.view = { webview: { postMessage: () => Promise.resolve() } };
    return { provider, spawns };
  }

  it("deletes a conversation's temp images once its turn results", async () => {
    const { provider } = makeSendableProvider();
    await provider._handleMessage({
      type: "send",
      text: "look",
      images: [{ data: PNG_URL }],
    });
    const convId = provider._convs.activeId();
    const tracked = provider._imgTemps.get(convId);
    expect(tracked).toHaveLength(1);
    expect(fs.existsSync(tracked[0])).toBe(true);

    // The turn finishing is the cleanup point (CLI consumed the file at turn start).
    provider._makeOnEvent(convId)({ type: "result", result: "done" });
    expect(fs.existsSync(tracked[0])).toBe(false);
    expect(provider._imgTemps.has(convId)).toBe(false);
  });

  it("dispose() sweeps every conversation's leftovers", async () => {
    const { provider } = makeSendableProvider();
    await provider._handleMessage({
      type: "send",
      text: "look",
      images: [{ data: PNG_URL }],
    });
    const files = [...provider._imgTemps.values()].flat();
    expect(files.length).toBeGreaterThan(0);
    provider.dispose();
    for (const f of files) expect(fs.existsSync(f)).toBe(false);
  });

  it("keeps a queued screenshot until its own turn finishes", async () => {
    const { provider } = makeSendableProvider();
    provider._handleMessage({ type: "send", text: "investigate" });
    await provider._handleMessage({
      type: "send",
      text: "evidence",
      images: [{ data: PNG_URL }],
    });
    const id = provider._convs.activeId();
    const [file] = provider._imgTemps.get(id);
    try {
      provider._makeOnEvent(id)({ type: "result", result: "first turn" });
      expect(fs.existsSync(file)).toBe(true);
      provider._makeOnEvent(id)({ type: "result", result: "image turn" });
      expect(fs.existsSync(file)).toBe(false);
    } finally {
      provider.dispose();
    }
  });

  it("a failed send does not delete earlier queued attachments", async () => {
    const { provider, spawns } = makeSendableProvider();
    await provider._handleMessage({
      type: "send",
      text: "first",
      images: [{ data: PNG_URL }],
    });
    const id = provider._convs.activeId();
    const [file] = provider._imgTemps.get(id);
    try {
      spawns[0].sendEvent = () => false;
      await provider._handleMessage({
        type: "send",
        text: "second",
        images: [{ data: PNG_URL }],
      });
      expect(provider._imgTemps.get(id)).toEqual([file]);
      expect(fs.existsSync(file)).toBe(true);
    } finally {
      provider.dispose();
    }
  });
});

describe("API key stays in the CLI secure store", () => {
  it("never copies a configured key into child env or argv", () => {
    const spawns = [];
    const provider = new ChatViewProvider(
      {
        commands: { executeCommand: () => Promise.resolve() },
        window: {},
        workspace: {
          workspaceFolders: [{ uri: { fsPath: "/ws" } }],
          getConfiguration: () => ({ get: () => undefined }),
        },
      },
      {
        deps: {
          createSession: (cfg) => {
            const s = {
              cfg,
              running: true,
              send: () => true,
              sendEvent: () => true,
              stop() {},
            };
            spawns.push(s);
            return s;
          },
          resolveChatLlm: () => ({
            provider: "volcengine",
            model: "doubao",
            baseUrl: "https://ark.example",
            apiKey: "sk-secret",
          }),
        },
      },
    );
    provider.view = { webview: { postMessage: () => Promise.resolve() } };
    provider._handleMessage({ type: "send", text: "hi" });
    expect(spawns).toHaveLength(1);
    expect(spawns[0].cfg.env.CC_API_KEY).not.toBe("sk-secret");
    expect(spawns[0].cfg.args).not.toContain("--api-key");
    expect(spawns[0].cfg.args).not.toContain("sk-secret");
  });

  it("does not synthesize CC_API_KEY when no key is configured", () => {
    const spawns = [];
    const provider = new ChatViewProvider(
      {
        commands: { executeCommand: () => Promise.resolve() },
        window: {},
        workspace: {
          workspaceFolders: [{ uri: { fsPath: "/ws" } }],
          getConfiguration: () => ({ get: () => undefined }),
        },
      },
      {
        deps: {
          createSession: (cfg) => (
            spawns.push({ cfg }),
            { cfg, running: true, send: () => true }
          ),
          resolveChatLlm: () => ({
            provider: "",
            model: "",
            baseUrl: "",
            apiKey: "",
          }),
        },
      },
    );
    provider.view = { webview: { postMessage: () => Promise.resolve() } };
    provider._handleMessage({ type: "send", text: "hi" });
    expect(spawns[0].cfg.env.CC_API_KEY).toBe(process.env.CC_API_KEY);
  });
});
