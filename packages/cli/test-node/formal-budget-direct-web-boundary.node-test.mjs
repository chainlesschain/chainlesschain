import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import { test } from "node:test";
import { fetchPage, takeScreenshot } from "../src/lib/browser-automation.js";
import { withFormalBudgetProviderScope } from "../src/lib/formal-budget-provider-scope.js";
import { webFetch } from "../src/lib/web-fetch.js";

const scoped = (operation) =>
  withFormalBudgetProviderScope(
    {
      runId: "offline-direct-web",
      transport: {
        createFetch: () => () => {
          throw new Error("Unexpected model transport call");
        },
      },
    },
    operation,
  );

function unreadable() {
  return new Proxy(
    {},
    {
      get() {
        throw new Error("Caller payload inspected before budget refusal");
      },
      ownKeys() {
        throw new Error("Caller payload enumerated before budget refusal");
      },
    },
  );
}

test("direct webFetch rejects before URL, options, HTTP or HTTPS", async () => {
  const oldHttp = http.request;
  const oldHttps = https.request;
  let requests = 0;
  http.request = https.request = () => {
    requests++;
    throw new Error("Unexpected network request");
  };
  try {
    await scoped(async () => {
      await assert.rejects(webFetch(unreadable(), unreadable()), {
        code: "CC_BUDGET_EXTERNAL_TOOL_NOT_COVERED",
        noReplay: true,
      });
    });
    assert.equal(requests, 0);
  } finally {
    http.request = oldHttp;
    https.request = oldHttps;
  }
});

test("direct browser fetch rejects before URL, options, timer or fetch", async () => {
  const oldFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = () => {
    requests++;
    throw new Error("Unexpected browser fetch");
  };
  try {
    await scoped(async () => {
      await assert.rejects(fetchPage(unreadable(), unreadable()), {
        code: "CC_BUDGET_EXTERNAL_TOOL_NOT_COVERED",
        noReplay: true,
      });
    });
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("direct screenshot rejects before Playwright import and caller options", async () => {
  await scoped(async () => {
    await assert.rejects(
      takeScreenshot(unreadable(), unreadable(), unreadable()),
      { code: "CC_BUDGET_EXTERNAL_TOOL_NOT_COVERED", noReplay: true },
    );
  });
});

test("closed scope rejects detached direct web calls", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let deferred;
  await scoped(async () => {
    deferred = gate.then(() =>
      Promise.allSettled([
        webFetch(unreadable(), unreadable()),
        fetchPage(unreadable(), unreadable()),
        takeScreenshot(unreadable(), unreadable(), unreadable()),
      ]),
    );
  });
  release();
  const outcomes = await deferred;
  assert.equal(outcomes.length, 3);
  for (const outcome of outcomes) {
    assert.equal(outcome.status, "rejected");
    assert.equal(outcome.reason.code, "CC_BUDGET_SCOPE_CLOSED");
    assert.equal(outcome.reason.noReplay, true);
  }
});

test("unscoped browser and web-fetch callers keep their ordinary contracts", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("<title>offline</title>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  try {
    const page = await fetchPage("https://fixture.invalid/");
    assert.equal(page.status, 200);
    assert.equal(page.html, "<title>offline</title>");
  } finally {
    globalThis.fetch = oldFetch;
  }
  const blocked = await webFetch("http://127.0.0.1/");
  assert.equal(blocked.code, "ERR_FETCH_BLOCKED");
});
