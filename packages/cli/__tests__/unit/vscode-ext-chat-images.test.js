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
  it("writes a whitelisted data URL to a temp file with the exact bytes", () => {
    const provider = makeProvider();
    const files = provider._writeImageTemps([{ data: PNG_URL }]);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/cc-chat-img-.*\.png$/);
    try {
      expect(fs.readFileSync(files[0]).toString("base64")).toBe(PNG_BASE64);
    } finally {
      fs.rmSync(files[0], { force: true });
    }
  });

  it("maps jpeg → .jpg and keeps gif/webp extensions", () => {
    const provider = makeProvider();
    const files = provider._writeImageTemps([
      { data: "data:image/jpeg;base64," + PNG_BASE64 },
      { data: "data:image/webp;base64," + PNG_BASE64 },
    ]);
    try {
      expect(files[0]).toMatch(/\.jpg$/);
      expect(files[1]).toMatch(/\.webp$/);
    } finally {
      for (const f of files) fs.rmSync(f, { force: true });
    }
  });

  it("skips junk: non-image mime, malformed base64, missing data", () => {
    const provider = makeProvider();
    const files = provider._writeImageTemps([
      { data: "data:text/html;base64," + PNG_BASE64 }, // not an image
      { data: "data:image/png;base64,!!!not-base64$$" }, // bad charset
      { data: "C:\\windows\\system32\\evil.png" }, // not a data URL
      {},
      null,
    ]);
    expect(files).toEqual([]);
  });

  it("caps at 4 attachments per message", () => {
    const provider = makeProvider();
    const files = provider._writeImageTemps(
      Array.from({ length: 7 }, () => ({ data: PNG_URL })),
    );
    try {
      expect(files).toHaveLength(4);
    } finally {
      for (const f of files) fs.rmSync(f, { force: true });
    }
  });
});

describe("chat HTML ships the paste/attach UI (parse gate)", () => {
  it("has the attach strip and paste handler, and all scripts parse", () => {
    const html = buildChatHtml({ nonce: "n".repeat(32), cspSource: "vsc:" });
    expect(html).toContain('id="attach"');
    expect(html).toContain('addEventListener("paste"');
    const scripts = [...html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g)];
    for (const [, body] of scripts) {
      new Function(body); // throws on syntax error — dead-panel gate
    }
  });
});
