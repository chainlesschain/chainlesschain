import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MARKETPLACE_COMMAND_DESCRIPTOR_ERROR,
  MARKETPLACE_COMMAND_SAFE_ENVIRONMENT_KEYS,
  normalizeMarketplaceCommandDescriptor,
} from "../../src/lib/plugin-runtime/marketplace-command-descriptor.js";
import {
  createSameOriginMarketplaceHeaderFetch,
  runMarketplaceCommandSource,
  runMarketplaceHeadersHelper,
  runMarketplaceProcessDescriptor,
} from "../../src/lib/plugin-runtime/marketplace-command-source.js";

let directory;

function descriptor(extra = {}) {
  return {
    executable: process.execPath,
    args: [],
    cwd: directory,
    timeoutMs: 10_000,
    maxOutputBytes: 8 * 1024,
    ...extra,
  };
}

function fakeChild(output = "{}") {
  const child = new EventEmitter();
  child.pid = 4242;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  queueMicrotask(() => {
    child.stdout.emit("data", output);
    child.emit("close", 0, null);
  });
  return child;
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-market-command-"));
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("Marketplace command descriptors", () => {
  it("rejects shell launchers and unapproved environment entries", () => {
    expect(() =>
      normalizeMarketplaceCommandDescriptor(
        descriptor({ executable: "/bin/sh", args: ["-c", "echo unsafe"] }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: MARKETPLACE_COMMAND_DESCRIPTOR_ERROR.SHELL_REJECTED,
      }),
    );
    expect(() =>
      normalizeMarketplaceCommandDescriptor(
        descriptor({ env: { NODE_OPTIONS: "--require=unsafe" } }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: MARKETPLACE_COMMAND_DESCRIPTOR_ERROR.INVALID,
      }),
    );
  });

  it("uses direct argv, an explicit clean environment, and no shell", async () => {
    const spawn = vi.fn(() => fakeChild('{"X-Market":"enabled"}'));
    const lstatSync = vi.fn((candidate) => ({
      isSymbolicLink: () => false,
      isFile: () => candidate === process.execPath,
      isDirectory: () => candidate === directory,
      mode: 0o755,
    }));

    await expect(
      runMarketplaceProcessDescriptor(descriptor({ env: { LANG: "C" } }), {
        kind: "headers",
        spawn,
        lstatSync,
        realpathSync: (candidate) => candidate,
      }),
    ).resolves.toBe('{"X-Market":"enabled"}');

    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      [],
      expect.objectContaining({
        cwd: directory,
        env: expect.objectContaining({ LANG: "C" }),
        shell: false,
        detached: process.platform !== "win32",
        auditRedactArgIndexes: [],
      }),
    );
    expect(
      Object.keys(spawn.mock.calls[0][2].env).every((key) =>
        MARKETPLACE_COMMAND_SAFE_ENVIRONMENT_KEYS.includes(
          process.platform === "win32" ? key.toUpperCase() : key,
        ),
      ),
    ).toBe(true);
  });

  it("accepts only safe helper headers and sends them on the registry origin", async () => {
    const helper = await runMarketplaceHeadersHelper(
      descriptor({
        args: [
          "-e",
          'process.stdout.write(JSON.stringify({Authorization:"Bearer secret", "X-Market":"enabled"}))',
        ],
      }),
    );
    expect(helper).toEqual({
      Authorization: "Bearer secret",
      "X-Market": "enabled",
    });

    const fetch = vi.fn(async () => ({ ok: true }));
    const decorated = createSameOriginMarketplaceHeaderFetch(
      fetch,
      "https://registry.example.test/index.json",
      helper,
    );
    await decorated("https://registry.example.test/archive.tgz", {
      headers: { Accept: "application/gzip" },
    });
    await decorated("https://other.example.test/archive.tgz", {
      headers: { Accept: "application/gzip" },
    });

    expect(fetch.mock.calls[0][1].headers).toEqual({
      Accept: "application/gzip",
      Authorization: "Bearer secret",
      "X-Market": "enabled",
    });
    expect(fetch.mock.calls[1][1].headers).toEqual({
      Accept: "application/gzip",
    });
    await expect(
      runMarketplaceHeadersHelper(
        descriptor({
          args: ["-e", 'process.stdout.write(JSON.stringify({Host:"evil"}))'],
        }),
      ),
    ).rejects.toMatchObject({
      code: "CC_MARKETPLACE_HEADERS_HELPER_OUTPUT_INVALID",
    });
  });

  it("validates a command-produced plugin directory and rejects link mode on Windows", async () => {
    const plugin = path.join(directory, "plugin");
    fs.mkdirSync(plugin);
    fs.writeFileSync(
      path.join(plugin, "plugin.json"),
      JSON.stringify({ name: "command-source", version: "1.0.0" }),
      "utf8",
    );
    const source = await runMarketplaceCommandSource(
      descriptor({
        args: [
          "-e",
          "process.stdout.write(JSON.stringify({source:process.argv[1]}))",
          plugin,
        ],
      }),
    );
    expect(source).toMatchObject({
      source: fs.realpathSync.native(plugin),
      mode: "copy",
      fileCount: 1,
    });
    await expect(
      runMarketplaceCommandSource(descriptor({ mode: "link" }), {
        platform: "win32",
      }),
    ).rejects.toMatchObject({
      code: MARKETPLACE_COMMAND_DESCRIPTOR_ERROR.LINK_UNSUPPORTED,
    });
  });
});
