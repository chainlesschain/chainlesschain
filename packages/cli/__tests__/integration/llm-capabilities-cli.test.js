import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { afterEach, beforeEach, expect, it } from "vitest";

const bin = fileURLToPath(
  new URL("../../bin/chainlesschain.js", import.meta.url),
);
// Guard the actual CLI before its module graph loads. No local server, model,
// deployment factory, keychain helper or subprocess is needed by this command.
const networkGuard = `
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const deny = () => { process.stderr.write('CAPABILITIES_FORBIDDEN_IO\\n'); process.exit(91); };
globalThis.fetch = deny;
net.connect = net.createConnection = net.Socket.prototype.connect = deny;
http.request = http.get = https.request = https.get = deny;
dns.lookup = dns.resolve = deny;
dns.promises.lookup = dns.promises.resolve = deny;
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[name] = deny;
syncBuiltinESMExports();
`;
const guardUrl = `data:text/javascript,${encodeURIComponent(networkGuard)}`;
let directory;
let workspace;
let configPath;
let env;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-llm-capabilities-"));
  workspace = path.join(directory, "workspace");
  fs.mkdirSync(workspace);
  const state = path.join(directory, "state");
  fs.mkdirSync(state);
  configPath = path.join(state, "config.json");
  env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      /^(CHAINLESSCHAIN_|CC_|OTEL_|OPENAI_API_KEY$|ANTHROPIC_API_KEY$|VOLCENGINE_API_KEY$|NODE_OPTIONS$)/u.test(
        key,
      )
    )
      delete env[key];
  }
  Object.assign(env, {
    CHAINLESSCHAIN_HOME: state,
    CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: path.join(directory, "anchor"),
    CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR: path.join(
      directory,
      "must-not-load-deployment.json",
    ),
    CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT: path.join(
      directory,
      "must-not-load-trust.json",
    ),
    OPENAI_API_KEY: "fixture-env-key-must-not-be-used",
    NO_COLOR: "1",
  });
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

function writeConfig(llm) {
  fs.writeFileSync(configPath, JSON.stringify({ llm }), "utf8");
}

function snapshot(target = directory) {
  return fs
    .readdirSync(target, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => [
      entry.name,
      entry.isDirectory()
        ? snapshot(path.join(target, entry.name))
        : fs.readFileSync(path.join(target, entry.name)).toString("base64"),
    ]);
}

function run(args) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--import", guardUrl, bin, "llm", "capabilities", ...args],
      {
        cwd: workspace,
        env,
        windowsHide: true,
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) =>
        resolve({ code: error?.code ?? 0, stdout, stderr }),
    );
  });
}

function expectNoForbiddenIo(result, before) {
  expect(result.stdout + result.stderr).not.toContain(
    "CAPABILITIES_FORBIDDEN_IO",
  );
  expect(result.stdout + result.stderr).not.toContain(
    "fixture-env-key-must-not-be-used",
  );
  expect(snapshot()).toEqual(before);
}

it("real CLI emits configured static JSON without network, secret resolution, deployment or writes", async () => {
  writeConfig({
    provider: "openai",
    model: "gpt-4o-mini",
    baseUrl: "https://api.openai.com/v1",
    apiKey: { __cc_secret_ref: "fixture-missing-os-secret-must-not-resolve" },
  });
  const before = snapshot();
  const result = await run(["--json"]);
  expect(result.code, result.stderr).toBe(0);
  const profile = JSON.parse(result.stdout);
  expect(profile).toMatchObject({
    provider: "openai",
    model: "gpt-4o-mini",
    runtimeVerified: false,
    requestMaxOutputTokens: null,
  });
  expect(profile.schema).toBeTruthy();
  expect(profile.digest).toMatch(/^sha256:/u);
  expect(profile.limitations.length).toBeGreaterThan(0);
  expect(profile.limitations.join(" ")).toContain("Runtime execution");
  expect(profile.limitations.join(" ")).not.toContain(
    "Responses transport is not implemented",
  );
  expect(result.stdout + result.stderr).not.toContain(
    "fixture-missing-os-secret",
  );
  expect(result.stderr).not.toMatch(
    /OS-backed configuration secret|not be read/,
  );
  expectNoForbiddenIo(result, before);
});

it("real CLI provider overrides isolate saved model and endpoint; explicit overrides remain local diagnostics", async () => {
  writeConfig({
    provider: "volcengine",
    model: "vendor-private-model",
    baseUrl: "https://private-relay.example/v1",
    apiKey: "fixture-config-secret",
  });
  const before = snapshot();
  const result = await run(["--provider", "openai", "--json"]);
  expect(result.code, result.stderr).toBe(0);
  const profile = JSON.parse(result.stdout);
  expect(profile.provider).toBe("openai");
  expect(profile.model).not.toBe("vendor-private-model");
  expect(result.stdout + result.stderr).not.toContain("private-relay.example");
  expect(result.stdout + result.stderr).not.toContain("fixture-config-secret");
  expectNoForbiddenIo(result, before);

  const overridden = await run([
    "--provider",
    "ollama",
    "--model",
    "unknown-local-model",
    "--base-url",
    "http://fixture-user:fixture-url-secret@127.0.0.1:1?key=fixture-query-secret",
    "--context-window",
    "8192",
    "--max-output-tokens",
    "512",
    "--json",
  ]);
  expect(overridden.code, overridden.stderr).toBe(0);
  expect(JSON.parse(overridden.stdout)).toMatchObject({
    provider: "ollama",
    model: "unknown-local-model",
    contextWindowTokens: 8192,
    requestMaxOutputTokens: 512,
    runtimeVerified: false,
  });
  expectNoForbiddenIo(overridden, before);
  expect(overridden.stdout + overridden.stderr).not.toContain(
    "fixture-url-secret",
  );
  expect(overridden.stdout + overridden.stderr).not.toContain(
    "fixture-query-secret",
  );
});

it("real CLI reports unknown models as assumptions instead of readiness or connectivity success", async () => {
  writeConfig({
    provider: "ollama",
    model: "unknown-local-model",
    baseUrl: "http://127.0.0.1:1",
  });
  const before = snapshot();
  const json = await run(["--json"]);
  expect(json.code, json.stderr).toBe(0);
  expect(JSON.parse(json.stdout)).toMatchObject({
    windowAssumed: true,
    runtimeVerified: false,
    requestMaxOutputTokens: null,
  });
  expectNoForbiddenIo(json, before);
  const text = await run([]);
  expect(text.code, text.stderr).toBe(0);
  expect(text.stdout).toContain("runtime not verified");
  expect(text.stdout).toContain("Fallback values are estimates");
  expect(text.stdout).toContain(
    "planning reserve is not an enforced request cap",
  );
  expect(text.stdout).toContain("Note: Runtime execution");
  expect(text.stdout).not.toContain("Responses is not integrated");
  expect(text.stdout).not.toMatch(/\bready\b|✔|Connected/);
  expectNoForbiddenIo(text, before);
});

it.each([
  ["--context-window", "0"],
  ["--context-window", "1e6"],
  ["--max-output-tokens", "1.5"],
  ["--max-output-tokens", "fixture-invalid-value"],
  ["--base-url", "fixture-invalid-value"],
  ["--base-url", "file:///tmp/not-an-api"],
])(
  "real CLI rejects invalid %s=%s with nonzero exit and empty stdout",
  async (flag, value) => {
    writeConfig({ provider: "ollama", model: "unknown-local-model" });
    const before = snapshot();
    const result = await run([flag, value, "--json"]);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toBe("");
    if (value === "fixture-invalid-value")
      expect(result.stderr).not.toContain(value);
    expectNoForbiddenIo(result, before);
  },
);

it("real CLI rejects corrupt configuration without exposing secrets or creating a backup", async () => {
  fs.writeFileSync(
    configPath,
    '{"llm":{"apiKey":"fixture-corrupt-secret",invalid}}',
    "utf8",
  );
  const before = snapshot();
  const result = await run(["--json"]);
  expect(result.code).not.toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("Could not read LLM configuration");
  expect(result.stderr).not.toContain("fixture-corrupt-secret");
  expectNoForbiddenIo(result, before);
});

it("real CLI inspects defaults without creating a missing configuration", async () => {
  const before = snapshot();
  const result = await run(["--json"]);
  expect(result.code, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout).runtimeVerified).toBe(false);
  expect(fs.existsSync(configPath)).toBe(false);
  expectNoForbiddenIo(result, before);
});

it("real CLI stays offline even with an explicit telemetry endpoint", async () => {
  writeConfig({ provider: "ollama", model: "unknown-local-model" });
  env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://127.0.0.1:1";
  const before = snapshot();
  const result = await run(["--otlp-endpoint", "http://127.0.0.1:1", "--json"]);
  expect(result.code, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout).runtimeVerified).toBe(false);
  expectNoForbiddenIo(result, before);
});
