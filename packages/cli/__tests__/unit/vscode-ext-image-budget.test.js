import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import { Window } from "happy-dom";
import {
  checkImageEnvelope,
  imageDimensions,
  writeImageBatch,
  MAX_IMAGE_BYTES,
} from "../../../vscode-extension/src/chat/image-attachments.js";
import { buildChatHtml } from "../../../vscode-extension/src/chat/chat-html.js";
import { ChatViewProvider } from "../../../vscode-extension/src/chat/chat-view.js";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const image = { data: `data:image/png;base64,${png}` };

describe("bounded image intake", () => {
  it("rejects byte and aggregate limits before allocating buffers", () => {
    const large = {
      data:
        "data:image/png;base64," +
        "A".repeat(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4),
    };
    expect(() => checkImageEnvelope([large])).toThrow("20 MiB");
    const half = {
      data: "data:image/png;base64," + "A".repeat(15 * 1024 * 1024),
    };
    expect(() => checkImageEnvelope([half, half])).toThrow("total");
  });

  it("rejects a pixel bomb without writing files", async () => {
    const bytes = Buffer.from(png, "base64");
    bytes.writeUInt32BE(100000, 16);
    bytes.writeUInt32BE(100000, 20);
    const open = vi.fn();
    await expect(
      writeImageBatch(
        [{ data: `data:image/png;base64,${bytes.toString("base64")}` }],
        { io: { open } },
      ),
    ).rejects.toThrow("40 megapixels");
    expect(open).not.toHaveBeenCalled();
  });

  it("recognizes JPEG, GIF and WebP headers without decoding pixels", () => {
    expect(
      imageDimensions(Buffer.from("47494638396102000300", "hex")),
    ).toMatchObject({ format: "gif", width: 2, height: 3 });
    expect(
      imageDimensions(Buffer.from("ffd8ffc00008080003000200", "hex")),
    ).toMatchObject({ format: "jpeg", width: 2, height: 3 });
    const webp = Buffer.alloc(30);
    webp.write("RIFF", 0);
    webp.write("WEBPVP8X", 8);
    webp[24] = 1;
    webp[27] = 2;
    expect(imageDimensions(webp)).toMatchObject({
      format: "webp",
      width: 2,
      height: 3,
    });
  });

  it("cleans already-owned files on write failure and reports the failing image", async () => {
    const unlink = vi.fn(async () => {});
    const open = vi.fn(async () => ({
      writeFile: async () => {
        throw Object.assign(new Error("full"), { code: "ENOSPC" });
      },
      close: vi.fn(),
    }));
    await expect(
      writeImageBatch([image], { io: { open, unlink } }),
    ).rejects.toThrow("Image 1");
    expect(unlink).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0].slice(1)).toEqual(["wx", 0o600]);
  });

  it("keeps async image sends bound to their source tab and discards reset results", async () => {
    const sent = [];
    const messages = [];
    const provider = new ChatViewProvider(
      {
        workspace: {
          workspaceFolders: [],
          getConfiguration: () => ({ get: () => undefined }),
        },
        window: {},
      },
      {
        deps: {
          resolveChatLlm: () => ({}),
          createSession: (cfg) => ({
            running: true,
            sendEvent: (msg) => {
              sent.push({ cfg, msg });
              return true;
            },
            stop() {},
          }),
        },
      },
    );
    provider.view = {
      webview: {
        postMessage(msg) {
          messages.push(msg);
          return Promise.resolve();
        },
      },
    };
    const postFrom = provider._postFrom.bind(provider);
    provider._postFrom = (...args) => {
      messages.push(args[1]);
      return postFrom(...args);
    };
    let finish;
    provider._writeImageTemps = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const a = provider._activeConv();
    const pending = provider._handleMessage({
      type: "send",
      text: "A only",
      images: [image],
    });
    const b = provider._convs.create({});
    const files = await writeImageBatch([image]);
    finish(files);
    await pending;
    expect(sent, JSON.stringify(messages)).toHaveLength(1);
    expect(a.session).toBeTruthy();
    expect(b.session).toBeNull();
    provider._convs.switchTo(a.id);
    const pendingReset = provider._handleMessage({
      type: "send",
      text: "old generation",
      images: [image],
    });
    provider._clearSessionState(a);
    const staleFiles = await writeImageBatch([image]);
    finish(staleFiles);
    await pendingReset;
    expect(sent).toHaveLength(1);
    await expect(fs.stat(staleFiles[0])).rejects.toThrow();
    provider.dispose();
  });

  it("reserves read slots before rapid drops and keeps drafts in their own tab", async () => {
    const window = new Window({
      settings: {
        enableJavaScriptEvaluation: true,
        suppressInsecureJavaScriptEnvironmentWarning: true,
      },
    });
    const posted = [];
    const readers = [];
    window.FileReader = class {
      readAsDataURL() {
        readers.push(this);
      }
    };
    window.acquireVsCodeApi = () => ({
      postMessage: (event) => posted.push(event),
      getState: () => ({}),
      setState() {},
    });
    window.document.write(
      buildChatHtml({ nonce: "n", cspSource: "vscode-resource:" }),
    );
    const input = window.document.getElementById("input");
    const tabs = (id) =>
      window.dispatchEvent(
        new window.MessageEvent("message", {
          data: {
            kind: "tabs",
            activeId: id,
            tabs: [
              { id: "a", title: "A" },
              { id: "b", title: "B" },
            ],
          },
        }),
      );
    tabs("a");
    input.value = "draft A";
    input.dispatchEvent(new window.Event("input"));
    const drop = new window.Event("drop");
    Object.defineProperty(drop, "dataTransfer", {
      value: {
        items: [{ kind: "file", type: "image/png" }],
        files: Array.from({ length: 6 }, () => ({
          type: "image/png",
          size: 1024,
        })),
      },
    });
    input.dispatchEvent(drop);
    expect(readers).toHaveLength(4);
    window.document.getElementById("send").click();
    expect(posted.filter((e) => e.type === "send")).toHaveLength(0);
    tabs("b");
    for (const reader of readers) {
      reader.result = image.data;
      reader.onload();
    }
    expect(window.document.getElementById("attach").textContent).toBe("");
    expect(input.value).toBe("");
    tabs("a");
    expect(input.value).toBe("draft A");
    expect(
      window.document.getElementById("attach").querySelectorAll(".chip"),
    ).toHaveLength(4);
    await window.happyDOM.abort();
  });
});
