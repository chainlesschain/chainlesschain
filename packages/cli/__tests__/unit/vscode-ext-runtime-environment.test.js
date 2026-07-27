import { describe, expect, it } from "vitest";

import {
  formatRuntimeEnvironment,
  inspectOfflineCaches,
  parseJavaVersion,
  parseNodeVersion,
  probeRuntimeEnvironment,
} from "../../../vscode-extension/src/runtime-environment.js";

describe("runtime environment parsing", () => {
  it("parses Node and common Java version formats", () => {
    expect(parseNodeVersion("v22.12.0")).toBe("22.12.0");
    expect(parseNodeVersion("not node")).toBeNull();
    expect(parseJavaVersion('openjdk version "21.0.3" 2024-04-16 LTS')).toBe(
      "21.0.3",
    );
    expect(parseJavaVersion("java 17.0.11 2024-04-16")).toBe("17.0.11");
  });

  it("classifies Node against the real CLI floor", async () => {
    const ready = await probeRuntimeEnvironment({
      runVersion: async (command) =>
        command === "node" ? "v22.12.0" : 'openjdk version "21.0.3"',
      fsImpl: {
        existsSync: () => false,
        readdirSync: () => [],
      },
    });
    expect(ready.node).toMatchObject({
      status: "ready",
      version: "22.12.0",
    });
    expect(ready.java).toMatchObject({
      status: "ready",
      version: "21.0.3",
    });

    const old = await probeRuntimeEnvironment({
      runVersion: async (command) => (command === "node" ? "v18.0.0" : null),
      fsImpl: {
        existsSync: () => false,
        readdirSync: () => [],
      },
    });
    expect(old.node.status).toBe("outdated");
    expect(old.java.status).toBe("missing");
  });
});

describe("offline cache diagnosis", () => {
  it("reports managed CLI readiness and registry cache entries", () => {
    const fsImpl = {
      existsSync: (file) =>
        file.endsWith("current.json") ||
        file.replaceAll("\\", "/").endsWith("/0.200.0/package"),
      readFileSync: () =>
        JSON.stringify({
          version: "0.200.0",
          previousVersion: "0.199.0",
        }),
      readdirSync: () => [
        { isFile: () => true },
        { isFile: () => true },
        { isFile: () => false },
      ],
    };
    const caches = inspectOfflineCaches({
      managedCliRoot: "/managed",
      pluginRegistryCacheDir: "/registry",
      fsImpl,
    });
    expect(caches).toEqual({
      managedCli: {
        status: "ready",
        version: "0.200.0",
        rollbackVersion: "0.199.0",
      },
      pluginRegistry: { status: "ready", entries: 2 },
    });
    expect(formatRuntimeEnvironment({ caches })).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Managed CLI offline copy: ready"),
        expect.stringContaining("2 entries"),
      ]),
    );
  });

  it("distinguishes missing, corrupt, and incomplete managed state", () => {
    const missing = inspectOfflineCaches({
      managedCliRoot: "/managed",
      pluginRegistryCacheDir: "/registry",
      fsImpl: {
        existsSync: () => false,
        readdirSync: () => {
          throw new Error("absent");
        },
      },
    });
    expect(missing.managedCli.status).toBe("missing");
    expect(missing.pluginRegistry.status).toBe("missing");

    const corrupt = inspectOfflineCaches({
      managedCliRoot: "/managed",
      fsImpl: {
        existsSync: (file) => file.endsWith("current.json"),
        readFileSync: () => "{",
        readdirSync: () => [],
      },
    });
    expect(corrupt.managedCli.status).toBe("corrupt");
  });
});
