import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  createOpenAiBrokerFetch,
  openAiNativeCliLauncher,
} from "../scripts/verify01-openai-transport-preload.mjs";
import {
  requireUnscopedModelTransport,
  withFormalBudgetProviderScope,
} from "../src/lib/formal-budget-provider-scope.js";

const capability = "c".repeat(64);
const body = {
  model: "gpt-6.1-sol",
  input: [
    {
      type: "reasoning",
      id: "rs_offline",
      summary: [],
      encrypted_content: "offline-fixture",
    },
  ],
  stream: true,
};
const options = (fetchImpl) => ({
  brokerBaseUrl: "http://127.0.0.1:12345/v1",
  capability,
  requireUnscoped: requireUnscopedModelTransport,
  fetchImpl,
});
const request = (
  url = "https://api.openai.com/v1/responses",
  key = capability,
) =>
  new Request(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

test("native Responses forwarding preserves bytes, empty summaries and cancellation", async () => {
  let forwarded;
  const forward = createOpenAiBrokerFetch(
    options(async (value) => {
      forwarded = value;
      return new Response("offline response", { status: 200 });
    }),
  );
  const controller = new AbortController();
  const response = await forward(request(), { signal: controller.signal });
  assert.equal(await response.text(), "offline response");
  assert.equal(forwarded.url, "http://127.0.0.1:12345/v1/responses");
  assert.equal(forwarded.headers.get("authorization"), `Bearer ${capability}`);
  assert.deepEqual(await forwarded.clone().json(), body);
  controller.abort();
  assert.equal(forwarded.signal.aborted, true);
});

test("only the fixed official Responses request can reach the local broker", async () => {
  let calls = 0;
  const forward = createOpenAiBrokerFetch(
    options(async () => {
      calls++;
      return new Response();
    }),
  );
  for (const url of [
    "https://api.openai.com/v1/chat/completions",
    "https://example.com/v1/responses",
    "http://127.0.0.1:12345/v1/responses",
  ]) {
    await assert.rejects(
      forward(request(url)),
      /Unexpected OpenAI request target/u,
    );
  }
  await assert.rejects(
    forward(request(undefined, "not-the-capability")),
    /authorization mismatch/u,
  );
  assert.equal(calls, 0);
  assert.throws(
    () =>
      createOpenAiBrokerFetch({
        ...options(() => {}),
        capability: "sk-offline-not-a-real-key",
      }),
    /Scoped broker capability required/u,
  );
  assert.throws(() =>
    createOpenAiBrokerFetch({
      ...options(() => {}),
      brokerBaseUrl: "http://example.com:12345/v1",
    }),
  );
});

test("active formal scope refuses setup and forwarding before credential or request inspection", async () => {
  const forward = createOpenAiBrokerFetch(
    options(async () => {
      throw new Error("must not dispatch");
    }),
  );
  const hostile = {
    get brokerBaseUrl() {
      throw new Error("URL was inspected");
    },
    requireUnscoped: requireUnscopedModelTransport,
  };
  await withFormalBudgetProviderScope(
    {
      runId: "offline-forwarder",
      transport: {
        createFetch: () => () => {
          throw new Error("unexpected authority call");
        },
      },
    },
    async () => {
      assert.throws(
        () => createOpenAiBrokerFetch(hostile),
        /no governed transport/u,
      );
      await assert.rejects(
        forward({
          toString() {
            throw new Error("request was inspected");
          },
        }),
        /no governed transport/u,
      );
    },
  );
});

test("native CLI launcher preloads only agent commands and preserves exit status", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openai-launcher-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cli = path.join(root, "fake-cli.cjs"),
    preload = path.join(root, "preload.mjs"),
    launcher = path.join(root, "launcher.cjs");
  fs.writeFileSync(preload, "globalThis.offlineTransportLoaded=true;\n");
  fs.writeFileSync(
    cli,
    "console.log(JSON.stringify({args:process.argv.slice(2),loaded:globalThis.offlineTransportLoaded===true}));if(process.argv.includes('--fail'))process.exitCode=7;\n",
  );
  fs.writeFileSync(launcher, openAiNativeCliLauncher(cli, preload));
  const run = (...args) =>
    JSON.parse(
      execFileSync(process.execPath, [launcher, ...args], {
        encoding: "utf8",
        windowsHide: true,
      }),
    );
  assert.deepEqual(run("agent", "-p", "offline"), {
    args: ["agent", "-p", "offline"],
    loaded: true,
  });
  assert.deepEqual(run("config", "get", "llm"), {
    args: ["config", "get", "llm"],
    loaded: false,
  });
  const failure = spawnSync(process.execPath, [launcher, "agent", "--fail"], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(failure.status, 7);
});
