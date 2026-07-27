import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import pkg from "../../../../src/main/terminal/policy-aware-pty-manager.js";

const {
  PLUGIN_BIN_MODULE_REL,
  loadDesktopPluginBinSandboxPolicyResolver,
  createPolicyAwarePtyManager,
} = pkg;

describe("Desktop policy-aware PtyManager bootstrap", () => {
  it("preloads the canonical CLI collector and exposes a synchronous resolver", async () => {
    const policy = Object.freeze({
      requiredBoundaries: Object.freeze(["filesystem"]),
    });
    const collector = vi.fn(() => policy);
    const importModule = vi.fn(async () => ({
      collectWorkspacePluginBinSandboxPolicy: collector,
    }));

    const resolver = await loadDesktopPluginBinSandboxPolicyResolver({
      importModule,
    });
    const request = {
      workspaceCwd: path.resolve("trusted-root"),
      executionCwd: path.resolve("caller-root"),
    };

    expect(resolver(request)).toBe(policy);
    expect(collector).toHaveBeenCalledWith(request);
    expect(resolver(request)).not.toBeInstanceOf(Promise);
    expect(fileURLToPath(importModule.mock.calls[0][0])).toBe(
      path.resolve(
        __dirname,
        "../../../../src/main/terminal",
        PLUGIN_BIN_MODULE_REL,
      ),
    );
  });

  it("turns import failure into a synchronous fail-closed resolver", async () => {
    const cause = new Error("vendored module unavailable");
    const resolver = await loadDesktopPluginBinSandboxPolicyResolver({
      importModule: async () => {
        throw cause;
      },
    });

    let error;
    try {
      resolver({
        workspaceCwd: path.resolve("trusted-root"),
        executionCwd: path.resolve("caller-root"),
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: "ERR_DESKTOP_PTY_SANDBOX_POLICY_UNAVAILABLE",
      pluginBinFailClosed: true,
      cause,
    });
    expect(resolver.loadError).toBe(error);
  });

  it("does not construct the manager until the ESM collector has loaded", async () => {
    let finishImport;
    const importModule = vi.fn(
      () =>
        new Promise((resolve) => {
          finishImport = resolve;
        }),
    );
    const managerPromise = createPolicyAwarePtyManager({
      policyCwd: "trusted-root",
      policyLoaderOptions: { importModule },
      _deps: {
        loadNodePty: vi.fn(),
        getProcessBroker: () => null,
      },
    });
    let settled = false;
    void managerPromise.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(importModule).toHaveBeenCalledOnce();
    expect(settled).toBe(false);

    finishImport({
      collectWorkspacePluginBinSandboxPolicy: () => null,
    });
    const manager = await managerPromise;

    expect(manager._policyCwd).toBe(path.resolve("trusted-root"));
    expect(typeof manager._resolveSandboxPolicy).toBe("function");
  });

  it("resolves the packaged dist/main/terminal location to Resources/packages", () => {
    const resourcesRoot = path.join(
      path.parse(process.cwd()).root,
      "ChainlessChain-fixture",
      "resources",
    );
    const packagedDirname = path.join(
      resourcesRoot,
      "app.asar",
      "dist",
      "main",
      "terminal",
    );

    expect(path.resolve(packagedDirname, PLUGIN_BIN_MODULE_REL)).toBe(
      path.join(
        resourcesRoot,
        "packages",
        "cli",
        "src",
        "lib",
        "plugin-runtime",
        "bin.js",
      ),
    );
  });
});
