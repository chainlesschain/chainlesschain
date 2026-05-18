/**
 * Web-shell E2E — Stage 3 of release prep (2026-04-30).
 *
 * Boots Electron with `--web-shell` so main/index.js takes the embedded
 * HTTP+WS path (web-panel SPA at `http://127.0.0.1:NNNN/`) instead of
 * the V5/V6 renderer. Asserts:
 *   1. The first BrowserWindow loads a `http://127.0.0.1:*` URL (proves
 *      WebShell HTTP server bound + main/index.js routed correctly).
 *   2. `window.__CC_CONFIG__` is injected with a numeric `wsPort`.
 *   3. The SPA renders `<div id="app">` with at least one direct child
 *      (proves Vue mount happened against the vendored web-panel/dist).
 *   4. Custom topic `ukey.status` round-trips over the WS dialed by the
 *      SPA's `__CC_CONFIG__` (proves end-to-end auth-less wire).
 *
 * Running locally:
 *     cd desktop-app-vue
 *     npm run build:main           # ensure dist/main/index.js is fresh
 *     npm run build:renderer       # not strictly required for web-shell
 *     npx playwright test tests/e2e/web-shell/web-shell.e2e.test.ts
 *
 * Long timeouts because Electron full bootstrap (DB, P2P, MCP, …) takes
 * ~30-60 s on cold disk. CI may need the 180 s test timeout from
 * playwright.config.ts.
 */

import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import path from "path";
import os from "os";

const MAIN_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "dist",
  "main",
  "index.js",
);

/** Build a unique userData path so parallel test runs don't share state. */
function uniqueUserDataDir(): string {
  return path.join(
    os.tmpdir(),
    `cc-webshell-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
}

async function launchWithWebShell(): Promise<{
  app: ElectronApplication;
  window: Page;
}> {
  const electronPath = require("electron") as unknown as string;
  const userDataPath = uniqueUserDataDir();

  const app = await electron.launch({
    executablePath: electronPath,
    args: [MAIN_PATH, "--web-shell", `--user-data-dir=${userDataPath}`],
    env: {
      ...process.env,
      NODE_ENV: "test",
      CHAINLESSCHAIN_WEB_SHELL: "1",
      CHAINLESSCHAIN_DISABLE_NATIVE_DB: "1",
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      SKIP_SLOW_INIT: "true",
      MOCK_HARDWARE: "true",
      MOCK_LLM: "true",
    },
    timeout: 180000,
  });

  const window = await app.firstWindow({ timeout: 120000 });
  await window.waitForLoadState("domcontentloaded", { timeout: 60000 });

  return { app, window };
}

test.describe("Web-shell E2E", () => {
  let app: ElectronApplication;
  let window: Page;

  test.beforeAll(async () => {
    const ctx = await launchWithWebShell();
    app = ctx.app;
    window = ctx.window;
  });

  test.afterAll(async () => {
    if (app) {
      await app.close().catch(() => {
        /* swallow shutdown races */
      });
    }
  });

  test("first window loads a 127.0.0.1 HTTP URL (not file:// renderer)", async () => {
    const url = window.url();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
  });

  test("__CC_CONFIG__ is injected with a numeric wsPort", async () => {
    const cfg = await window.evaluate(
      () => (window as any).__CC_CONFIG__ ?? null,
    );
    expect(cfg).toBeTruthy();
    expect(typeof cfg.wsPort).toBe("number");
    expect(cfg.wsPort).toBeGreaterThan(0);
    expect(cfg.wsHost).toBe("127.0.0.1");
  });

  test("the SPA mounts <div id='app'> with rendered children", async () => {
    // Wait for Vue to populate #app (web-panel uses createApp().mount('#app')).
    await window.waitForFunction(
      () => {
        const app = document.getElementById("app");
        return app && app.children.length > 0;
      },
      { timeout: 30000 },
    );
    const appHtmlLen = await window.evaluate(
      () => document.getElementById("app")?.innerHTML.length ?? 0,
    );
    expect(appHtmlLen).toBeGreaterThan(100);
  });

  test("ukey.status WS topic round-trips end-to-end", async () => {
    // Open a fresh WS from the renderer context using __CC_CONFIG__.wsPort
    // (mimics what web-panel's stores/ws.js does at boot).
    const result = await window.evaluate(async () => {
      const cfg: any = (window as any).__CC_CONFIG__;
      const ws = new WebSocket(`ws://${cfg.wsHost}:${cfg.wsPort}`);
      await new Promise<void>((resolve, reject) => {
        ws.addEventListener("open", () => resolve(), { once: true });
        ws.addEventListener(
          "error",
          () => reject(new Error("ws_open_failed")),
          {
            once: true,
          },
        );
      });
      const reply = await new Promise<any>((resolve, reject) => {
        ws.addEventListener(
          "message",
          (ev) => {
            try {
              resolve(JSON.parse((ev as MessageEvent).data as string));
            } catch (err) {
              reject(err as Error);
            }
          },
          { once: true },
        );
        ws.send(JSON.stringify({ id: "e2e-1", type: "ukey.status" }));
      });
      ws.close();
      return reply;
    });

    expect(result).toMatchObject({
      type: "ukey.status.result",
      id: "e2e-1",
      ok: true,
    });
    expect(typeof result.result).toBe("object");
    expect(typeof result.result.platform).toBe("string");
  });
});
