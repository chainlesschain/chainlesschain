/**
 * Phase 0 spike — verifies the CLI's web-ui-server boots inside this Node
 * process via dynamic ESM import and serves the web-panel SPA dist.
 *
 * Validates risk #1 from `memory/desktop_web_shell_strategy.md`:
 * "web-ui-server 在 Electron main 进程能否同进程跑".
 *
 * The loader under test (`../web-ui-loader.js`) is CommonJS — Vitest's
 * transformer handles the CJS → ESM interop so the import below resolves to
 * the named exports defined via `module.exports`.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startWebUIServer } from "../web-ui-loader.js";

describe("web-ui-loader (Phase 0 spike)", () => {
  let handle;
  let fixtureRoot;

  beforeAll(async () => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-web-ui-loader-"));
    const staticDir = path.join(fixtureRoot, "dist");
    fs.mkdirSync(path.join(staticDir, "assets"), { recursive: true });
    fs.writeFileSync(
      path.join(staticDir, "index.html"),
      `<!doctype html><html><head><script>window.__CC_CONFIG__ = __CC_CONFIG_PLACEHOLDER__;</script></head><body><div id="app"></div><script type="module" src="/assets/app.js"></script></body></html>`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(staticDir, "assets", "app.js"),
      "export const ready = true;\n",
      "utf8",
    );
    handle = await startWebUIServer({
      port: 0,
      host: "127.0.0.1",
      wsPort: 19999,
      wsHost: "127.0.0.1",
      mode: "global",
      uiMode: "full",
      staticDir,
    });
  }, 20000);

  afterAll(async () => {
    if (handle) {
      await handle.close();
    }
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it("listens on a real OS-assigned port", () => {
    expect(handle.port).toBeGreaterThan(0);
    expect(handle.host).toBe("127.0.0.1");
    expect(handle.url).toBe(`http://127.0.0.1:${handle.port}/`);
  });

  it("serves the SPA index.html with __CC_CONFIG__ injected", async () => {
    const res = await fetch(handle.url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("window.__CC_CONFIG__");
    expect(html).toContain('"wsPort":19999');
    expect(html).toContain('"mode":"global"');
    // Placeholder must be replaced.
    expect(html).not.toContain("__CC_CONFIG_PLACEHOLDER__");
  });

  it("serves /dashboard via SPA fallback (vue-router hash mode)", async () => {
    // Hash routes never round-trip to the server, but a hard nav to /dashboard
    // exercises the SPA fallback and must yield the same index.html shell.
    const res = await fetch(`${handle.url}dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="app"');
    expect(html).toContain("window.__CC_CONFIG__");
  });

  it("serves JS assets with the right MIME and immutable cache", async () => {
    const indexHtml = await (await fetch(handle.url)).text();
    const match = indexHtml.match(/\/assets\/[A-Za-z0-9_.-]+\.js/);
    expect(
      match,
      "expected a built JS asset reference in dist/index.html",
    ).not.toBeNull();
    const assetUrl = `${handle.url.replace(/\/$/, "")}${match[0]}`;
    const res = await fetch(assetUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/javascript");
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  it("rejects POST with 405 (read-only static surface)", async () => {
    const res = await fetch(handle.url, { method: "POST" });
    expect(res.status).toBe(405);
  });
});
