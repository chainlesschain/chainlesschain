import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

const { BrowserEngine } = require("../../src/main/browser/browser-engine");

function onceWithTimeout(emitter, event, timeout = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeout);
    const handler = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
    emitter.once(event, handler);
  });
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe("BrowserEngine real Chromium download boundary", () => {
  let engine = null;
  let server = null;

  afterEach(async () => {
    if (engine?.isRunning) await engine.stop().catch(() => {});
    if (server) await closeServer(server).catch(() => {});
    engine = null;
    server = null;
  });

  it("cancels native downloads and closes page-initiated popups", async () => {
    const payload = Buffer.from("download-boundary-sentinel", "utf8");
    let downloadRequests = 0;
    server = createServer((request, response) => {
      if (request.url === "/file") {
        downloadRequests += 1;
        response.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-disposition": 'attachment; filename="sentinel.bin"',
          "content-length": payload.byteLength,
        });
        response.end(payload);
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
          <a id="download" href="/file" download>download</a>
          <a id="popup" href="/popup" target="_blank">popup</a>`);
    });
    const origin = await listen(server);

    engine = new BrowserEngine({ headless: true, cdpPort: 0 });
    await engine.start({ headless: true, channel: "chromium" });
    await engine.createContext("download-e2e", { acceptDownloads: true });
    const opened = await engine.openTab("download-e2e", `${origin}/page`, {
      allowedRedirectOrigins: [origin],
    });
    const page = engine.getPage(opened.targetId);

    const downloadBlocked = onceWithTimeout(engine, "tab:download-blocked");
    const nativeDownload = page.waitForEvent("download");
    await page.click("#download");
    const download = await nativeDownload;
    await expect(downloadBlocked).resolves.toEqual({
      profileName: "download-e2e",
    });
    await expect
      .poll(() => download.failure(), { timeout: 5000 })
      .toMatch(/cancel|acceptDownloads/u);
    await expect(download.path()).rejects.toThrow();
    expect(downloadRequests).toBe(1);
    expect(engine.pages.size).toBe(1);

    const popupBlocked = onceWithTimeout(engine, "tab:popup-blocked");
    await page.click("#popup");
    await expect(popupBlocked).resolves.toMatchObject({
      profileName: "download-e2e",
      reason: "unattributed-page-navigation",
    });
    await expect
      .poll(() => page.context().pages().length, { timeout: 5000 })
      .toBe(1);
    expect(engine.pages.size).toBe(1);
  }, 30_000);
});
