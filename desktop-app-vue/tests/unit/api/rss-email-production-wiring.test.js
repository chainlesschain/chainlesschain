import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("RSS and Email production wiring", () => {
  it("constructs and tears down both bounded main-process handlers", () => {
    const source = read("src/main/index.js");

    expect(source).toContain("this.initializeContentIntegrationIPC()");
    expect(source).toContain("new RSSIPCHandler(this.database)");
    expect(source).toContain("new EmailIPCHandler(this.database");
    expect(source).toContain('["rssIPCHandler", "emailIPCHandler"]');
    expect(source).toContain("handler.cleanup()");
  });

  it("exposes fixed preload capabilities and leaves no generic page calls", () => {
    const preload = read("src/preload/index.js");
    expect(preload).toContain("rss: {");
    expect(preload).toContain("email: {");
    expect(preload).toContain(
      'ipcRenderer.invoke("email:download-attachment", attachmentId)',
    );

    for (const relativePath of [
      "src/renderer/pages/rss/FeedList.vue",
      "src/renderer/pages/rss/ArticleReader.vue",
      "src/renderer/pages/email/AccountManager.vue",
      "src/renderer/pages/email/EmailReader.vue",
      "src/renderer/pages/email/EmailComposer.vue",
    ]) {
      const source = read(relativePath);
      expect(source).not.toContain("window.electron.ipcRenderer");
    }
  });

  it("does not accept renderer paths for incoming or outgoing attachments", () => {
    const composer = read("src/renderer/pages/email/EmailComposer.vue");
    const reader = read("src/renderer/pages/email/EmailReader.vue");
    const handler = read("src/main/api/email-ipc.js");

    expect(composer).not.toMatch(/\bpath:\s*file\./);
    expect(reader).not.toContain("dialog.showSaveDialog");
    expect(handler).not.toContain("downloadAttachment(attachmentId, savePath)");
  });
});
