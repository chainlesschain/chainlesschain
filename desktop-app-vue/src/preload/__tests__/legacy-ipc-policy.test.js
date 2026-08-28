import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const {
  legacyGenericIpcEnabled,
  assertLegacyGenericIpcEnabled,
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

  it("is disabled by default", () => {
    expect(legacyGenericIpcEnabled({})).toBe(false);
    expect(() => assertLegacyGenericIpcEnabled({})).toThrowError(
      expect.objectContaining({ code: "LEGACY_GENERIC_IPC_DISABLED" }),
    );
  });

  it("requires the explicit compatibility switch", () => {
    const env = { CC_ENABLE_LEGACY_GENERIC_IPC: "1" };
    expect(legacyGenericIpcEnabled(env)).toBe(true);
    expect(() => assertLegacyGenericIpcEnabled(env)).not.toThrow();
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
