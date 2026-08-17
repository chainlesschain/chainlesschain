import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerPluginCommand } from "../../src/commands/plugin.js";
import { listInstalled } from "../../src/lib/plugin-runtime/install.js";
import { _deps as remoteDeps } from "../../src/lib/plugin-runtime/remote-source.js";

let cwd;
let sourceRoot;
let logSpy;
let originalRemoteDeps;

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

function entry(version, source) {
  return {
    name: "multi-source",
    version,
    source,
    license: "Apache-2.0",
    permissions: {},
    dependencies: {},
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
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-market-select-cwd-"));
  sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-market-select-src-"));
  const one = entry("1.0.0", makeSource("1.0.0"));
  const two = entry("2.0.0", makeSource("2.0.0"));
  const registries = new Map([
    ["https://one.example/index.json", { plugins: [one] }],
    ["https://two.example/index.json", { plugins: [two] }],
  ]);
  originalRemoteDeps = { ...remoteDeps };
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
  Object.assign(remoteDeps, originalRemoteDeps);
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
            plugins: [entry("2.0.0", path.join(sourceRoot, "2.0.0"))],
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
});
