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
    let declarativeDownloadRequests = 0;
    let nativeDownloadRequests = 0;
    server = createServer((request, response) => {
      if (request.url === "/declarative-file") {
        declarativeDownloadRequests += 1;
      } else if (request.url === "/native-file") {
        nativeDownloadRequests += 1;
      } else if (request.url === "/barrier") {
        response.writeHead(204);
        response.end();
        return;
      } else {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html>
          <a id="declarative-download" href="/declarative-file" download>download</a>
          <a id="native-download" href="/native-file">attachment</a>
          <a id="popup" href="/popup" target="_blank">popup</a>`);
        return;
      }
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-disposition": 'attachment; filename="sentinel.bin"',
        "content-length": payload.byteLength,
      });
      response.end(payload);
    });
    const origin = await listen(server);

    engine = new BrowserEngine({ headless: true, cdpPort: 0 });
    await engine.start({ headless: true, channel: "chromium" });
    await engine.createContext("download-e2e", { acceptDownloads: true });
    const opened = await engine.openTab("download-e2e", `${origin}/page`, {
      allowedRedirectOrigins: [origin],
    });
    const page = engine.getPage(opened.targetId);

    await page.evaluate(async () => {
      globalThis.document.querySelector("#declarative-download").click();
      await fetch("/barrier");
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(declarativeDownloadRequests).toBe(0);

    const downloadBlocked = onceWithTimeout(engine, "tab:download-blocked");
    const nativeDownload = page.waitForEvent("download");
    await page.click("#native-download");
    const download = await nativeDownload;
    await expect(downloadBlocked).resolves.toEqual({
      profileName: "download-e2e",
    });
    await expect
      .poll(() => download.failure(), { timeout: 5000 })
      .toMatch(/cancel|acceptDownloads/u);
    await expect(download.path()).rejects.toThrow();
    expect(nativeDownloadRequests).toBe(1);
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
