import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerPluginCommand } from "../../src/commands/plugin.js";
import {
  listInstalled,
  _deps as installDeps,
} from "../../src/lib/plugin-runtime/install.js";
import { _deps as scopeDeps } from "../../src/lib/plugin-runtime/scopes.js";
import { _deps as remoteDeps } from "../../src/lib/plugin-runtime/remote-source.js";
import { _resetPluginManagedPolicyCache } from "../../src/lib/plugin-security.js";

let cwd;
let sourceRoot;
let logSpy;
let originalRemoteDeps;
let originalSpawnSync;
const savedManagedSettings = process.env.CC_MANAGED_SETTINGS;

function makeSource(version) {
  const dir = path.join(sourceRoot, version);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plugin.json"),
    JSON.stringify({ name: "multi-source", version }),
    "utf8",
  );
  return dir;
}

function entry(version, source, extra = {}) {
  return {
    name: "multi-source",
    version,
    source,
    license: "Apache-2.0",
    permissions: {},
    dependencies: {},
    ...extra,
  };
}

function makeProgram() {
  const program = new Command();
  program.exitOverride();
  registerPluginCommand(program);
  return program;
}

async function run(...argv) {
  logSpy.mockClear();
  process.exitCode = 0;
  await makeProgram().parseAsync(["node", "cc", "plugin", ...argv]);
  const output = logSpy.mock.calls
    .map((call) => call.map((value) => String(value ?? "")).join(" "))
    .join("\n");
  const exitCode = process.exitCode || 0;
  process.exitCode = 0;
  return { exitCode, output };
}

beforeEach(() => {
  _resetPluginManagedPolicyCache();
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-market-select-cwd-"));
  sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-market-select-src-"));
  const fixtureSources = new Map([
    ["https://git.example/multi-source-v1.git", makeSource("1.0.0")],
    ["https://git.example/multi-source-v2.git", makeSource("2.0.0")],
  ]);
  const one = entry("1.0.0", "https://git.example/multi-source-v1.git");
  const two = entry("2.0.0", "https://git.example/multi-source-v2.git");
  const registries = new Map([
    ["https://one.example/index.json", { plugins: [one] }],
    ["https://two.example/index.json", { plugins: [two] }],
  ]);
  originalRemoteDeps = { ...remoteDeps };
  originalSpawnSync = installDeps.spawnSync;
  installDeps.spawnSync = (_executable, args) => {
    const source = args.find((argument) => fixtureSources.has(argument));
    const fixture = fixtureSources.get(source);
    if (!fixture) throw new Error("unexpected Git fixture source");
    fs.cpSync(fixture, args.at(-1), { recursive: true });
    return { status: 0, stdout: "", stderr: "" };
  };
  remoteDeps.fetch = vi.fn(async (url) => {
    if (String(url).includes("down.example")) {
      throw new Error("registry unavailable");
    }
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify(registries.get(String(url))),
    };
  });
  remoteDeps.existsSync = () => false;
  remoteDeps.mkdirSync = () => {};
  remoteDeps.writeFileSync = () => {};
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
});

afterEach(() => {
  _resetPluginManagedPolicyCache();
  Object.assign(remoteDeps, originalRemoteDeps);
  installDeps.spawnSync = originalSpawnSync;
  if (savedManagedSettings === undefined) {
    delete process.env.CC_MANAGED_SETTINGS;
  } else {
    process.env.CC_MANAGED_SETTINGS = savedManagedSettings;
  }
  vi.restoreAllMocks();
  process.exitCode = 0;
  for (const dir of [cwd, sourceRoot]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("cc plugin multi-registry selection", () => {
  it("pins the reviewed selection before install and persists its authority", async () => {
    const registryArgs = [
      "--registry",
      "https://one.example/index.json",
      "--registry",
      "https://two.example/index.json",
    ];
    const reviewRun = await run(
      "select",
      "multi-source",
      ...registryArgs,
      "--json",
    );
    expect(reviewRun.exitCode).toBe(0);
    const review = JSON.parse(reviewRun.output);
    expect(review).toMatchObject({
      status: "allowed",
      sourceCount: 2,
      selected: { version: "2.0.0", registry: { priority: 1 } },
    });

    const staleRun = await run(
      "add",
      "multi-source",
      ...registryArgs,
      "--expected-selection-digest",
      "0".repeat(64),
      "--scope",
      "project",
      "--json",
    );
    expect(staleRun.exitCode).toBe(1);
    expect(listInstalled({ cwd, scopes: ["project"] })).toEqual([]);

    const installRun = await run(
      "add",
      "multi-source",
      ...registryArgs,
      "--expected-selection-digest",
      review.selectionDigest,
      "--scope",
      "project",
      "--json",
    );
    expect(installRun.exitCode).toBe(0);
    expect(JSON.parse(installRun.output).version).toBe("2.0.0");
    const [installed] = listInstalled({ cwd, scopes: ["project"] });
    expect(installed.source.catalogAuthority).toMatchObject({
      selectionDigest: review.selectionDigest,
      selectionSourceCount: 2,
      registryDocumentSha256: crypto
        .createHash("sha256")
        .update(
          JSON.stringify({
            plugins: [
              entry("2.0.0", "https://git.example/multi-source-v2.git"),
            ],
          }),
        )
        .digest("hex"),
    });
  });

  it("does not ignore an unavailable registry in the requested source set", async () => {
    const result = await run(
      "select",
      "multi-source",
      "--registry",
      "https://one.example/index.json",
      "--registry",
      "https://down.example/index.json",
      "--json",
    );
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.output).blockers).toContainEqual(
      expect.objectContaining({ code: "REGISTRY_SET_INCOMPLETE" }),
    );
  });

  it("keeps explicit offline selection off the network on a cache miss", async () => {
    remoteDeps.fetch.mockClear();
    const result = await run(
      "select",
      "multi-source",
      "--registry",
      "https://one.example/index.json",
      "--offline",
      "--json",
    );
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.output).blockers).toContainEqual(
      expect.objectContaining({ code: "REGISTRY_SET_INCOMPLETE" }),
    );
    expect(remoteDeps.fetch).not.toHaveBeenCalled();
  });

  it("rejects an invalid registry document pin before network access", async () => {
    remoteDeps.fetch.mockClear();
    const result = await run(
      "select",
      "multi-source",
      "--registry",
      "https://one.example/index.json",
      "--registry-digest",
      "https://one.example/index.json=NOT-A-DIGEST",
      "--json",
    );
    expect(result.exitCode).toBe(1);
    expect(remoteDeps.fetch).not.toHaveBeenCalled();
  });

  it("blocks a selected source from an allowed multi-registry set before git spawn", async () => {
    const one = "https://one.example/index.json";
    const two = "https://two.example/index.json";
    const blockedSource = "https://github.com/acme/blocked-plugin.git#release";
    remoteDeps.fetch = vi.fn(async (url) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        JSON.stringify({
          plugins: [
            entry(
              String(url) === two ? "2.0.0" : "1.0.0",
              "https://github.com/acme/blocked-plugin.git",
              {
                ref: "release",
                sbom: {
                  format: "cyclonedx-json",
                  url: `${String(url).replace("/index.json", "")}/must-not-fetch.cdx.json`,
                  documentSha256: "a".repeat(64),
                },
              },
            ),
          ],
        }),
    }));
    let spawned = 0;
    installDeps.spawnSync = () => {
      spawned += 1;
      throw new Error("git must remain unreachable");
    };
    const managedSettingsFile = path.join(cwd, "managed-settings.json");
    fs.writeFileSync(
      managedSettingsFile,
      JSON.stringify({
        allowedMarketplaces: [
          { source: "url", url: one },
          { source: "url", url: two },
        ],
        blockedPluginSources: [blockedSource],
      }),
    );
    process.env.CC_MANAGED_SETTINGS = managedSettingsFile;
    _resetPluginManagedPolicyCache();

    let installedTreeReads = 0;
    const originalScopeExistsSync = scopeDeps.existsSync;
    scopeDeps.existsSync = (...args) => {
      installedTreeReads += 1;
      return originalScopeExistsSync(...args);
    };
    let result;
    try {
      result = await run(
        "add",
        "multi-source",
        "--registry",
        one,
        "--registry",
        two,
        "--scope",
        "project",
        "--json",
      );
    } finally {
      scopeDeps.existsSync = originalScopeExistsSync;
    }
    expect(result.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringMatching(/blocked by managed settings/u),
    );
    expect(spawned).toBe(0);
    expect(installedTreeReads).toBe(0);
    expect(
      remoteDeps.fetch.mock.calls.some(([url]) =>
        String(url).includes("must-not-fetch"),
      ),
    ).toBe(false);
    expect(listInstalled({ cwd, scopes: ["project"] })).toEqual([]);
  });
});
