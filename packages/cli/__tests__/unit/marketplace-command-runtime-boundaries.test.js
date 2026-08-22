import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MARKETPLACE_COMMAND_DESCRIPTOR_ERROR,
  MARKETPLACE_COMMAND_SAFE_ENVIRONMENT_KEYS,
  normalizeMarketplaceCommandDescriptor,
} from "../../src/lib/plugin-runtime/marketplace-command-descriptor.js";
import {
  createSameOriginMarketplaceHeaderFetch,
  MARKETPLACE_HEADERS_HELPER_ERROR,
  runMarketplaceCommandSource,
  runMarketplaceHeadersHelper,
  runMarketplaceProcessDescriptor,
} from "../../src/lib/plugin-runtime/marketplace-command-source.js";
import {
  _deps as remoteSourceDependencies,
  fetchRegistry,
  resolveRemoteSource,
} from "../../src/lib/plugin-runtime/remote-source.js";
import { normalizeMarketplacePackageSource } from "../../src/lib/plugin-runtime/marketplace-source-adapter.js";

let root;
let executable;
let originalFetch;

function descriptor(overrides = {}) {
  return {
    executable,
    args: ["--literal", "not-a-shell-command"],
    cwd: root,
    env: { LANG: "C" },
    timeoutMs: 1_000,
    maxOutputBytes: 8 * 1024,
    ...overrides,
  };
}

function fakeChild({ stdout = "{}", stderr = "", close = true } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  queueMicrotask(() => {
    if (stdout) child.stdout.emit("data", stdout);
    if (stderr) child.stderr.emit("data", stderr);
    if (close) child.emit("close", 0, null);
  });
  return child;
}

function processFilesystem() {
  return {
    lstatSync(candidate) {
      if (candidate === executable) {
        return {
          isSymbolicLink: () => false,
          isFile: () => true,
          isDirectory: () => false,
          mode: 0o755,
        };
      }
      if (candidate === root) {
        return {
          isSymbolicLink: () => false,
          isFile: () => false,
          isDirectory: () => true,
          mode: 0o755,
        };
      }
      return fs.lstatSync(candidate);
    },
    realpathSync(candidate) {
      if (candidate === executable || candidate === root) return candidate;
      return fs.realpathSync.native(candidate);
    },
  };
}

function expectCode(call, code) {
  let thrown = null;
  try {
    call();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toMatchObject({ code });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-market-command-boundary-"));
  executable = fs.realpathSync.native(process.execPath);
  originalFetch = remoteSourceDependencies.fetch;
});

afterEach(() => {
  remoteSourceDependencies.fetch = originalFetch;
  fs.rmSync(root, { recursive: true, force: true });
  vi.useRealTimers();
});

describe("Marketplace command runtime boundaries", () => {
  it("fails closed on shell strings and keeps a safe descriptor projection secret-free", () => {
    const shellPath = path.join(path.parse(executable).root, "sh");
    expectCode(
      () => normalizeMarketplaceCommandDescriptor(descriptor({ executable: shellPath })),
      MARKETPLACE_COMMAND_DESCRIPTOR_ERROR.SHELL_REJECTED,
    );
    expectCode(
      () =>
        normalizeMarketplaceCommandDescriptor(
          descriptor({ shell: "echo unsafe" }),
        ),
      MARKETPLACE_COMMAND_DESCRIPTOR_ERROR.INVALID,
    );
    expectCode(
      () =>
        normalizeMarketplaceCommandDescriptor(
          descriptor({ env: { NODE_OPTIONS: "--require=unsafe" } }),
        ),
      MARKETPLACE_COMMAND_DESCRIPTOR_ERROR.INVALID,
    );

    const source = normalizeMarketplacePackageSource({
      source: { ...descriptor({ env: { LANG: "private-token" } }), type: "command" },
    });
    expect(source).toMatchObject({ type: "command", mode: "copy" });
    expect(JSON.stringify(source)).not.toContain("private-token");
    expect(JSON.stringify(source)).not.toContain(executable);
  });

  it("uses exact argv/cwd/env, bounds output, and times out a mock child", async () => {
    const spawn = vi.fn(() => fakeChild({ stdout: '{"X-Market":"yes"}' }));
    const filesystem = processFilesystem();
    await expect(
      runMarketplaceHeadersHelper(descriptor(), {
        spawn,
        ...filesystem,
      }),
    ).resolves.toEqual({ "X-Market": "yes" });
    expect(spawn).toHaveBeenCalledWith(
      executable,
      ["--literal", "not-a-shell-command"],
      expect.any(Object),
    );
    const spawnOptions = spawn.mock.calls[0][2];
    expect(spawnOptions).toMatchObject({
      cwd: root,
      shell: false,
      auditRedactArgIndexes: [0, 1],
    });
    expect(spawnOptions.env.LANG).toBe("C");
    expect(spawnOptions.env.NODE_OPTIONS).toBeUndefined();
    expect(
      Object.keys(spawnOptions.env).every((key) =>
        MARKETPLACE_COMMAND_SAFE_ENVIRONMENT_KEYS.includes(
          process.platform === "win32" ? key.toUpperCase() : key,
        ),
      ),
    ).toBe(true);

    await expect(
      runMarketplaceProcessDescriptor(
        descriptor({ maxOutputBytes: 1024 }),
        {
          kind: "headers",
          spawn: () => fakeChild({ stdout: "x".repeat(1025) }),
          ...filesystem,
        },
      ),
    ).rejects.toMatchObject({
      code: MARKETPLACE_HEADERS_HELPER_ERROR.PROCESS_OUTPUT_LIMIT,
    });

    vi.useFakeTimers();
    const pending = fakeChild({ close: false });
    const timeout = runMarketplaceProcessDescriptor(
      descriptor({ timeoutMs: 100 }),
      {
        kind: "headers",
        spawn: () => pending,
        ...filesystem,
      },
    );
    const timeoutAssertion = expect(timeout).rejects.toMatchObject({
      code: MARKETPLACE_HEADERS_HELPER_ERROR.PROCESS_TIMEOUT,
    });
    await vi.advanceTimersByTimeAsync(100);
    await timeoutAssertion;
    expect(pending.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("gates helper headers to the selected origin and never lets them replace transport auth", async () => {
    const fetch = vi.fn(async () => ({ ok: true }));
    const decorated = createSameOriginMarketplaceHeaderFetch(
      fetch,
      "https://registry.example.test/index.json",
      { Authorization: "Bearer helper-secret", "X-Market": "enabled" },
    );
    await decorated("https://registry.example.test/archive.tgz", {
      headers: { Authorization: "Bearer explicit", Accept: "application/gzip" },
    });
    await decorated("https://other.example.test/archive.tgz", {
      headers: { Accept: "application/gzip" },
    });

    expect(fetch.mock.calls[0][1].headers).toEqual({
      Authorization: "Bearer explicit",
      Accept: "application/gzip",
      "X-Market": "enabled",
    });
    expect(fetch.mock.calls[1][1].headers).toEqual({
      Accept: "application/gzip",
    });
  });

  it("runs a descriptor-produced plugin source and rejects link mode on Windows", async () => {
    const plugin = path.join(root, "plugin");
    fs.mkdirSync(plugin);
    fs.writeFileSync(
      path.join(plugin, "plugin.json"),
      JSON.stringify({ name: "command-source", version: "1.0.0" }),
      "utf8",
    );
    const filesystem = processFilesystem();
    const result = await runMarketplaceCommandSource(descriptor(), {
      spawn: () => fakeChild({ stdout: JSON.stringify({ source: plugin }) }),
      ...filesystem,
    });
    expect(result).toMatchObject({
      source: fs.realpathSync.native(plugin),
      mode: "copy",
      fileCount: 1,
    });

    await expect(
      runMarketplaceCommandSource(descriptor({ mode: "link" }), {
        platform: "win32",
        ...filesystem,
      }),
    ).rejects.toMatchObject({
      code: MARKETPLACE_COMMAND_DESCRIPTOR_ERROR.LINK_UNSUPPORTED,
    });
  });

  it("materializes a registry command descriptor only through its issued authority", async () => {
    const plugin = path.join(root, "registry-plugin");
    fs.mkdirSync(plugin);
    fs.writeFileSync(
      path.join(plugin, "plugin.json"),
      JSON.stringify({ name: "registry-command-source", version: "1.0.0" }),
      "utf8",
    );
    remoteSourceDependencies.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          plugins: [
            {
              name: "registry-command-source",
              source: { ...descriptor(), type: "command" },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const resolved = await resolveRemoteSource(
      "https://registry.example.test/index.json",
      {
        name: "registry-command-source",
        allowCache: false,
        commandSpawn: () => fakeChild({ stdout: JSON.stringify({ source: plugin }) }),
      },
    );
    expect(resolved).toMatchObject({
      source: fs.realpathSync.native(plugin),
      sourceType: "command",
      sourceIdentity: expect.stringMatching(/^command:[a-f0-9]{32}$/u),
      commandAuthority: {
        status: "descriptor-executed-and-verified",
        mode: "copy",
      },
    });
    expect(JSON.stringify(resolved)).not.toContain("not-a-shell-command");
  });

  it("keeps helper output in an opaque authority while consuming it for catalog fetches", async () => {
    remoteSourceDependencies.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          plugins: [
            {
              name: "headers-catalog-plugin",
              source: "https://github.com/acme/headers-catalog-plugin.git",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const fetched = await fetchRegistry("https://registry.example.test/index.json", {
      allowCache: false,
      headersHelper: descriptor(),
      headersHelperSpawn: () =>
        fakeChild({ stdout: '{"X-Registry-Session":"helper-secret"}' }),
    });
    expect(remoteSourceDependencies.fetch).toHaveBeenCalledWith(
      "https://registry.example.test/index.json",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Registry-Session": "helper-secret",
        }),
      }),
    );
    expect(JSON.stringify(fetched)).not.toContain("helper-secret");
  });
});
