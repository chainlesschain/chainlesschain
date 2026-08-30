import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const {
  fixedRendererIpcChannels,
  deniedUnregisteredRendererIpcChannels,
  isFixedRendererIpcChannel,
  assertFixedRendererIpcChannel,
} = require("../legacy-ipc-policy.js");

describe("legacy generic IPC policy", () => {
  it("keeps the sandboxed preload free of relative module imports", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/preload/index.js"),
      "utf8",
    );
    const requiredModules = Array.from(
      source.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g),
      (match) => match[1],
    );

    expect(requiredModules).toEqual(["electron"]);
  });

  it("permits only generated exact channels and has no environment bypass", () => {
    expect(fixedRendererIpcChannels.size).toBeGreaterThan(0);
    expect(isFixedRendererIpcChannel("audit:query-logs")).toBe(true);
    expect(() =>
      assertFixedRendererIpcChannel("audit:query-logs"),
    ).not.toThrow();
    expect(() =>
      assertFixedRendererIpcChannel("attacker:arbitrary-channel"),
    ).toThrowError(
      expect.objectContaining({ code: "RENDERER_IPC_CAPABILITY_DENIED" }),
    );
    for (const channel of deniedUnregisteredRendererIpcChannels) {
      expect(fixedRendererIpcChannels.has(channel)).toBe(false);
      expect(() => assertFixedRendererIpcChannel(channel)).toThrowError(
        expect.objectContaining({ code: "RENDERER_IPC_CAPABILITY_DENIED" }),
      );
    }

    process.env.CC_ENABLE_LEGACY_GENERIC_IPC = "1";
    try {
      expect(() =>
        assertFixedRendererIpcChannel("attacker:arbitrary-channel"),
      ).toThrowError(
        expect.objectContaining({ code: "RENDERER_IPC_CAPABILITY_DENIED" }),
      );
    } finally {
      delete process.env.CC_ENABLE_LEGACY_GENERIC_IPC;
    }
  });

  it("keeps the generated preload block synchronized with the manifest", () => {
    const preloadSource = readFileSync(
      resolve(process.cwd(), "src/preload/index.js"),
      "utf8",
    );
    const start = preloadSource.indexOf(
      "  // BEGIN GENERATED FIXED RENDERER IPC CHANNELS",
    );
    const end = preloadSource.indexOf(
      "  // END GENERATED FIXED RENDERER IPC CHANNELS",
    );
    const generated = preloadSource
      .slice(start, end)
      .split("\n")
      .slice(1)
      .filter(Boolean)
      .map((line) => JSON.parse(line.trim().replace(/,$/, "")));

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(generated).toEqual([...fixedRendererIpcChannels]);
    expect(preloadSource).not.toContain("CC_ENABLE_LEGACY_GENERIC_IPC");
    expect(preloadSource).not.toContain("legacyInvoke");
  });

  it("exposes collaboration through a scoped allowlist, not generic renderer IPC", () => {
    const preloadSource = readFileSync(
      resolve(process.cwd(), "src/preload/index.js"),
      "utf8",
    );
    const storeSource = readFileSync(
      resolve(process.cwd(), "src/renderer/stores/collab.ts"),
      "utf8",
    );
    const providerSource = readFileSync(
      resolve(process.cwd(), "src/renderer/utils/yjs-ipc-provider.ts"),
      "utf8",
    );

    expect(preloadSource).toContain("const COLLAB_INVOKE_CHANNELS = new Set([");
    expect(preloadSource).toContain("collab: {\n    invoke: invokeCollab,");
    expect(storeSource).toContain("electronAPI.collab.invoke");
    expect(storeSource).not.toMatch(/electronAPI\??\.invoke/);
    expect(providerSource).toContain("electronAPI?.collab.invoke");
    expect(providerSource).not.toMatch(
      /electronAPI\??\.(?:invoke|on|removeListener)/,
    );
  });
});
