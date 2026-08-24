import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import pkg from "../../../../src/main/terminal/policy-aware-pty-manager.js";

const {
  PLUGIN_BIN_MODULE_REL,
  PROCESS_BROKER_MODULE_REL,
  loadDesktopPluginBinSandboxPolicyResolver,
  loadDesktopStrongPtyBroker,
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

    expect(resolver(request)).toEqual({
      requiredBoundaries: ["filesystem", "network"],
    });
    expect(Object.isFrozen(resolver(request))).toBe(true);
    expect(Object.isFrozen(resolver(request).requiredBoundaries)).toBe(true);
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
        platform: () => "win32",
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

  it("passes the synchronous main-process DB project selector into the manager", async () => {
    const resolveProjectBinding = vi.fn(() => null);
    const manager = await createPolicyAwarePtyManager({
      requireProjectBinding: true,
      resolveProjectBinding,
      policyLoaderOptions: {
        importModule: async () => ({
          collectWorkspacePluginBinSandboxPolicy: () => null,
        }),
      },
      _deps: {
        loadNodePty: vi.fn(),
        getProcessBroker: () => null,
        platform: () => "win32",
      },
    });

    expect(manager._requireProjectBinding).toBe(true);
    expect(manager._policyCwd).toBeNull();
    expect(manager._resolveProjectBinding).toBe(resolveProjectBinding);
  });

  it("preloads and binds the CLI strong PTY broker facade", async () => {
    const broker = {
      issueLinuxWorkspaceSandboxExecutionContract: vi.fn(function () {
        return this;
      }),
      spawnPty: vi.fn(function () {
        return this;
      }),
    };
    const importModule = vi.fn(async () => ({ executionBroker: broker }));

    const facade = await loadDesktopStrongPtyBroker({ importModule });

    expect(facade.issueLinuxWorkspaceSandboxExecutionContract()).toBe(broker);
    expect(facade.spawnPty()).toBe(broker);
    expect(facade.loadError).toBeNull();
    expect(fileURLToPath(importModule.mock.calls[0][0])).toBe(
      path.resolve(
        __dirname,
        "../../../../src/main/terminal",
        PROCESS_BROKER_MODULE_REL,
      ),
    );
  });

  it("turns strong broker import failure into a synchronous fail-closed facade", async () => {
    const cause = new Error("broker bundle unavailable");
    const facade = await loadDesktopStrongPtyBroker({
      importModule: async () => {
        throw cause;
      },
    });

    let error;
    try {
      facade.issueLinuxWorkspaceSandboxExecutionContract();
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: "ERR_DESKTOP_PTY_STRONG_BACKEND_UNAVAILABLE",
      sandboxReason: "desktop_strong_pty_backend_unavailable",
      sandboxFailClosed: true,
      cause,
    });
    expect(facade.loadError).toBe(error);
    expect(() => facade.spawnPty()).toThrow(error);
  });

  it("injects the preloaded strong facade only into a Linux manager", async () => {
    const issueContract = vi.fn();
    const spawnPty = vi.fn();
    const strongBroker = {
      issueLinuxWorkspaceSandboxExecutionContract: issueContract,
      spawnPty,
    };
    const importModule = vi.fn(async () => ({
      executionBroker: strongBroker,
    }));

    const manager = await createPolicyAwarePtyManager({
      resolveSandboxPolicy: () => null,
      strongPtyBrokerLoaderOptions: { importModule },
      _deps: {
        platform: () => "linux",
        loadNodePty: vi.fn(),
        getProcessBroker: () => null,
      },
    });

    expect(importModule).toHaveBeenCalledOnce();
    expect(manager._deps.issueLinuxWorkspaceSandboxExecutionContract).toEqual(
      expect.any(Function),
    );
    expect(manager._deps.spawnLinuxStrongPty).toEqual(expect.any(Function));
    manager._deps.issueLinuxWorkspaceSandboxExecutionContract();
    manager._deps.spawnLinuxStrongPty();
    expect(issueContract.mock.contexts[0]).toBe(strongBroker);
    expect(spawnPty.mock.contexts[0]).toBe(strongBroker);
  });

  it("keeps a Linux policy-bearing create fail-closed when broker preload failed", async () => {
    const loadNodePty = vi.fn();
    const getProcessBroker = vi.fn();
    const manager = await createPolicyAwarePtyManager({
      policyCwd: process.cwd(),
      resolveSandboxPolicy: () =>
        Object.freeze({
          requiredBoundaries: Object.freeze(["filesystem"]),
        }),
      strongPtyBrokerLoaderOptions: {
        importModule: async () => {
          throw new Error("strong broker missing");
        },
      },
      _deps: {
        platform: () => "linux",
        loadNodePty,
        getProcessBroker,
      },
    });

    expect(() => manager.create({ shell: "bash" })).toThrowError(
      expect.objectContaining({
        code: "ERR_DESKTOP_PTY_STRONG_BACKEND_UNAVAILABLE",
        sandboxReason: "desktop_strong_pty_backend_unavailable",
        sandboxFailClosed: true,
        requiredBoundaries: ["filesystem"],
        missingBoundaries: ["filesystem"],
      }),
    );
    expect(loadNodePty).not.toHaveBeenCalled();
    expect(getProcessBroker).not.toHaveBeenCalled();
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
    expect(path.resolve(packagedDirname, PROCESS_BROKER_MODULE_REL)).toBe(
      path.join(
        resourcesRoot,
        "packages",
        "cli",
        "src",
        "lib",
        "process-execution-broker",
        "index.js",
      ),
    );
  });
});
