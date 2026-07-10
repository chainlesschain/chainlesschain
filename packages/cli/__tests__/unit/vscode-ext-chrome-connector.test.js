import { describe, expect, it } from "vitest";

import {
  buildChromeLaunchArgs,
  buildChromeStateArgs,
  buildChromeStatusArgs,
  parseChromeJson,
  stateToMarkdown,
} from "../../../vscode-extension/src/chrome-connector.js";

const STATE = {
  ok: true,
  port: 9222,
  tab: 0,
  url: "http://localhost:5173/",
  title: "My App",
  tabs: [
    { index: 0, url: "http://localhost:5173/" },
    { index: 1, url: "https://example.com" },
  ],
  console: [{ type: "error", text: "Uncaught TypeError: x is not a function" }],
  network: [
    { kind: "http-error", url: "http://localhost:5173/api", status: 500 },
  ],
  html: "<html>…</html>",
  htmlTruncated: true,
  screenshotPath: "C:/tmp/shot.png",
};

describe("chrome connector argv", () => {
  it("wraps cc browse chrome status/launch/state", () => {
    expect(buildChromeStatusArgs()).toEqual([
      "browse",
      "chrome",
      "status",
      "--port",
      "9222",
      "--json",
    ]);
    expect(
      buildChromeLaunchArgs({
        port: 9300,
        url: "http://x",
        defaultProfile: true,
      }),
    ).toEqual([
      "browse",
      "chrome",
      "launch",
      "--port",
      "9300",
      "--url",
      "http://x",
      "--default-profile",
      "--json",
    ]);
    expect(
      buildChromeStateArgs({ reload: true, screenshotPath: "C:/s.png" }),
    ).toEqual([
      "browse",
      "chrome",
      "state",
      "--port",
      "9222",
      "--tab",
      "0",
      "--watch-ms",
      "3000",
      "--reload",
      "--screenshot",
      "C:/s.png",
      "--json",
    ]);
  });

  it("parses tolerantly", () => {
    expect(parseChromeJson("nope")).toBeNull();
    expect(parseChromeJson(JSON.stringify({ ok: false, port: 9222 }))).toEqual({
      ok: false,
      port: 9222,
    });
  });
});

describe("stateToMarkdown", () => {
  it("renders console/network/tabs/screenshot sections", () => {
    const md = stateToMarkdown(STATE);
    expect(md).toContain("# Chrome page state");
    expect(md).toContain("My App");
    expect(md).toContain("`http://localhost:5173/`");
    expect(md).toContain("DOM 14+ (truncated) chars");
    expect(md).toContain("Screenshot: `C:/tmp/shot.png`");
    expect(md).toContain("`error` Uncaught TypeError");
    expect(md).toContain("→ 500");
    expect(md).toContain("[1] https://example.com");
    expect(md).toContain("cc browse chrome state");
  });

  it("explains empty console captures and rejects failed states", () => {
    const empty = stateToMarkdown({ ...STATE, console: [], network: [] });
    expect(empty).toContain("observed from attach time");
    expect(empty).toContain("No failed or 4xx/5xx");
    expect(stateToMarkdown({ ok: false, error: "x" })).toBeNull();
    expect(stateToMarkdown(null)).toBeNull();
  });
});
