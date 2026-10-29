"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { ContextMemoryKernel } = require("../lib/index.js");
const unusedPortMethods = {
  read: () => assert.fail("recall must not read a single record"),
  commit: () => assert.fail("recall must not mutate Memory"),
};

const request = {
  query: "example",
  sink: "provider.local",
  scopeAdmissions: [{ scope: "user", scopeId: "local-user" }],
  limit: 10,
  tokenBudget: 1000,
};

test("Memory recall carries cancellation outside the serialized request contract", async () => {
  const controller = new AbortController();
  const kernel = new ContextMemoryKernel({
    memoryPort: {
      ...unusedPortMethods,
      query: async (actual, options) => {
        assert.deepEqual(actual, request);
        assert.equal(options.signal, controller.signal);
        return [];
      },
      getRevision: async (options) => {
        assert.equal(options.signal, controller.signal);
        return 7;
      },
    },
  });
  const result = await kernel.recallMemory(request, {
    signal: controller.signal,
  });
  assert.equal(result.memoryRevision, 7);
  assert.deepEqual(result.results, []);
  assert.equal(Object.hasOwn(request, "signal"), false);
});

test("a pre-aborted Memory recall does not query its port", async () => {
  const controller = new AbortController();
  controller.abort();
  const kernel = new ContextMemoryKernel({
    memoryPort: { query: () => assert.fail("must not query") },
  });
  await assert.rejects(
    kernel.recallMemory(request, { signal: controller.signal }),
    { name: "AbortError" },
  );
});

test("late Memory port success after cancellation never becomes a successful recall", async () => {
  const controller = new AbortController();
  const kernel = new ContextMemoryKernel({
    memoryPort: {
      ...unusedPortMethods,
      query: async () => {
        controller.abort();
        return [];
      },
      getRevision: () => {
        assert.equal(
          controller.signal.aborted,
          false,
          "must not read revision after Stop",
        );
        return 0;
      },
    },
  });
  await assert.rejects(
    kernel.recallMemory(request, { signal: controller.signal }),
    { name: "AbortError" },
  );
});
