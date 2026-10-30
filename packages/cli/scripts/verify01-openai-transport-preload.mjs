import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const OFFICIAL_RESPONSE_URL = "https://api.openai.com/v1/responses";

/** Operator-owned routing only; the public CLI keeps its native protocol. */
export function createOpenAiBrokerFetch(options) {
  const { requireUnscoped } = options;
  requireUnscoped();
  const broker = new URL(options.brokerBaseUrl);
  assert.equal(broker.protocol, "http:");
  assert.equal(broker.hostname, "127.0.0.1");
  assert.ok(broker.port);
  assert.equal(broker.pathname, "/v1");
  assert.ok(
    !broker.username && !broker.password && !broker.search && !broker.hash,
  );
  const capability = options.capability;
  assert.ok(
    typeof capability === "string" && /^[a-f0-9]{64}$/u.test(capability),
    "Scoped broker capability required",
  );
  const fetchImpl = options.fetchImpl;
  assert.equal(typeof fetchImpl, "function");
  const target = new URL("/v1/responses", broker);
  return async (input, init) => {
    requireUnscoped();
    const request = new Request(input, init);
    assert.ok(
      request.url === OFFICIAL_RESPONSE_URL,
      "Unexpected OpenAI request target",
    );
    assert.equal(request.method, "POST");
    assert.ok(
      request.headers.get("authorization") === `Bearer ${capability}`,
      "Scoped broker authorization mismatch",
    );
    return fetchImpl(new Request(target, request));
  };
}

/** Explicit Node argv survives IDE child-environment sanitization. */
export function openAiNativeCliLauncher(cliPath, preloadPath) {
  assert.ok(path.isAbsolute(cliPath) && path.isAbsolute(preloadPath));
  const preload = pathToFileURL(preloadPath).href;
  return `const {spawn}=require('node:child_process');const args=process.argv.slice(2);const prefix=args[0]==='agent'?['--import',${JSON.stringify(preload)}]:[];const child=spawn(process.execPath,[...prefix,${JSON.stringify(cliPath)},...args],{stdio:'inherit',env:process.env,windowsHide:true});child.on('error',e=>{console.error(e.message);process.exitCode=1});child.on('exit',code=>{process.exitCode=code??1});`;
}

const entry = process.env.CC_VERIFY01_OPENAI_CLI_ENTRY;
const samePath = (left, right) => {
  const a = fs.realpathSync(left),
    b = fs.realpathSync(right);
  return process.platform === "win32"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
};
if (
  entry &&
  process.argv[1] &&
  process.argv[2] === "agent" &&
  samePath(entry, process.argv[1])
) {
  // Import the installed CLI's exact scope module, sharing its active context.
  const scopeFile = path.resolve(
    path.dirname(entry),
    "../src/lib/formal-budget-provider-scope.js",
  );
  const { requireUnscopedModelTransport } = await import(
    pathToFileURL(scopeFile).href
  );
  requireUnscopedModelTransport();
  assert.equal(process.env.CC_FORMAL_QUALITY_EVAL_HERMETIC, "1");
  assert.equal(process.env.CC_FORMAL_QUALITY_EVAL_PROVIDER, "openai");
  globalThis.fetch = createOpenAiBrokerFetch({
    requireUnscoped: requireUnscopedModelTransport,
    brokerBaseUrl: process.env.CC_VERIFY01_OPENAI_BROKER_BASE_URL,
    capability: process.env.OPENAI_API_KEY,
    fetchImpl: globalThis.fetch.bind(globalThis),
  });
}
