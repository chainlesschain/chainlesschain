/**
 * App-preview detection core (slice 1) — pick the dev script + recognize the
 * served URL from dev-server banners. Pure logic, no vscode; lives in the CLI
 * suite like the other vscode-ext unit tests.
 */
import { describe, it, expect } from "vitest";
import {
  pickDevScript,
  detectServerUrl,
  detectServerUrlInText,
} from "../../../vscode-extension/src/preview-detect.js";

describe("pickDevScript", () => {
  it("prefers conventional names in priority order", () => {
    expect(
      pickDevScript({
        scripts: { build: "vite build", dev: "vite", start: "node ." },
      }),
    ).toEqual({ script: "dev", command: "vite" });
    expect(
      pickDevScript({ scripts: { start: "react-scripts start" } }),
    ).toEqual({
      script: "start",
      command: "react-scripts start",
    });
    expect(
      pickDevScript({ scripts: { serve: "vue-cli-service serve" } }),
    ).toEqual({ script: "serve", command: "vue-cli-service serve" });
  });

  it("falls back to any script that runs a recognized dev tool", () => {
    expect(
      pickDevScript({ scripts: { "ui:watch": "vite --host", build: "tsc" } }),
    ).toEqual({ script: "ui:watch", command: "vite --host" });
    expect(pickDevScript({ scripts: { web: "next dev -p 4000" } })).toEqual({
      script: "web",
      command: "next dev -p 4000",
    });
  });

  it("does not pick build/test scripts and returns null when nothing fits", () => {
    expect(
      pickDevScript({ scripts: { build: "vite build", test: "vitest" } }),
    ).toBe(null);
    expect(pickDevScript({ scripts: {} })).toBe(null);
    expect(pickDevScript({})).toBe(null);
    expect(pickDevScript(null)).toBe(null);
  });
});

describe("detectServerUrl", () => {
  it("pulls the localhost URL out of common dev-server banners", () => {
    expect(detectServerUrl("  Local:   http://localhost:5173/")).toBe(
      "http://localhost:5173/",
    );
    expect(
      detectServerUrl("ready - started server on http://localhost:3000"),
    ).toBe("http://localhost:3000");
    expect(detectServerUrl("App running at http://127.0.0.1:8080/ ")).toBe(
      "http://127.0.0.1:8080/",
    );
  });

  it("strips ANSI colors and trailing punctuation", () => {
    expect(
      detectServerUrl(
        "\x1b[32m  ➜  Local:\x1b[39m \x1b[36mhttp://localhost:4321/\x1b[39m",
      ),
    ).toBe("http://localhost:4321/");
    expect(detectServerUrl("see (http://localhost:3000).")).toBe(
      "http://localhost:3000",
    );
  });

  it("rewrites 0.0.0.0 to a browsable localhost", () => {
    expect(detectServerUrl("Network: http://0.0.0.0:5000/")).toBe(
      "http://localhost:5000/",
    );
  });

  it("returns null for lines without a local URL", () => {
    expect(detectServerUrl("building for production...")).toBe(null);
    expect(detectServerUrl("see https://example.com/docs")).toBe(null); // not local
    expect(detectServerUrl(null)).toBe(null);
  });
});

describe("detectServerUrlInText", () => {
  it("finds the first URL across multiple buffered lines", () => {
    const out = [
      "VITE v5.0  ready in 312 ms",
      "",
      "  ➜  Local:   http://localhost:5173/",
      "  ➜  Network: http://192.168.1.10:5173/",
    ].join("\n");
    expect(detectServerUrlInText(out)).toBe("http://localhost:5173/");
  });

  it("returns null until a URL appears", () => {
    expect(detectServerUrlInText("compiling...\nstill compiling...")).toBe(
      null,
    );
  });
});
