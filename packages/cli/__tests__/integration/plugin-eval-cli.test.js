import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { PLUGIN_EVAL_SUITE_SCHEMA } from "../../src/lib/eval/plugin-suite.js";

const bin = fileURLToPath(
  new URL("../../bin/chainlesschain.js", import.meta.url),
);
const networkGuard = `
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
const deny = () => { process.stderr.write('PLUGIN_EVAL_FORBIDDEN_NETWORK\\n'); process.exit(91); };
globalThis.fetch = deny;
net.connect = net.createConnection = net.Socket.prototype.connect = deny;
http.request = http.get = https.request = https.get = deny;
dns.lookup = dns.resolve = deny;
dns.promises.lookup = dns.promises.resolve = deny;
`;
const guardUrl = `data:text/javascript,${encodeURIComponent(networkGuard)}`;

let directory;
let workspace;
let pluginRoot;
let env;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-plugin-eval-cli-"));
  workspace = path.join(directory, "workspace");
  pluginRoot = path.join(directory, "plugin");
  fs.mkdirSync(workspace);
  fs.mkdirSync(path.join(pluginRoot, "evals"), { recursive: true });
  fs.writeFileSync(
    path.join(pluginRoot, "plugin.json"),
    JSON.stringify({ name: "cli-eval-plugin", version: "1.0.0" }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(pluginRoot, "evals", "suite.json"),
    JSON.stringify({
      schema: PLUGIN_EVAL_SUITE_SCHEMA,
      plugin: { name: "cli-eval-plugin", version: "1.0.0" },
      tasks: [
        {
          id: "dry-contract",
          prompt: "Create result.txt.",
          expectation: "optional",
          assertions: [{ type: "file_exists", path: "result.txt" }],
        },
      ],
    }),
    "utf8",
  );
  env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(CHAINLESSCHAIN_|CC_|OTEL_|NODE_OPTIONS$)/u.test(key))
      delete env[key];
  }
  Object.assign(env, {
    CHAINLESSCHAIN_HOME: path.join(directory, "state"),
    CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: path.join(directory, "anchor"),
    NO_COLOR: "1",
  });
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

function run(args) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--import", guardUrl, bin, "plugin", "eval", pluginRoot, ...args],
      {
        cwd: workspace,
        env,
        windowsHide: true,
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout, stderr) =>
        resolve({ code: error?.code ?? 0, stdout, stderr }),
    );
  });
}

it("real CLI validates and runs both dry arms without network or a false PASS", async () => {
  const result = await run(["--dry-run", "--json"]);
  expect(result.code, result.stderr).toBe(1);
  expect(result.stdout + result.stderr).not.toContain(
    "PLUGIN_EVAL_FORBIDDEN_NETWORK",
  );
  const report = JSON.parse(result.stdout);
  expect(report).toMatchObject({
    schema: "chainlesschain.plugin-eval-report/v1",
    status: "INSUFFICIENT_EVIDENCE",
    passed: false,
    reasons: expect.arrayContaining(["dry_run"]),
    plugin: { name: "cli-eval-plugin", version: "1.0.0" },
    suite: { tasks: 1 },
    arms: {
      control: { total: 1 },
      candidate: { total: 1 },
    },
  });
  expect(report.plugin.payloadDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  expect(report.suite.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
});

it("requires an explicit provider/model pair before any real execution", async () => {
  const result = await run(["--json"]);
  expect(result.code).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("explicit --provider and --model");
  expect(result.stdout + result.stderr).not.toContain(
    "PLUGIN_EVAL_FORBIDDEN_NETWORK",
  );
});
