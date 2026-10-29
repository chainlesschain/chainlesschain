"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { ContextMemoryKernel, InMemoryMemoryPort } = require("../lib/index.js");
const { AT, CLOCK, proposal } = require("./helpers.js");

const request = {
  query: "deterministic tests",
  sink: "provider.local",
  scopeAdmissions: [{ scope: "user", scopeId: "user-1" }],
  limit: 10,
  tokenBudget: 1000,
  now: AT,
};

async function fixture() {
  const port = new InMemoryMemoryPort();
  const kernel = new ContextMemoryKernel({ memoryPort: port, clock: CLOCK });
  const { record } = await kernel.proposeMemory(proposal());
  return { port, kernel, record };
}

test("recall binds unchanged records to their store revision", async () => {
  const { kernel, record } = await fixture();
  const result = await kernel.recallMemory(request);
  assert.equal(result.memoryRevision, 1);
  assert.deepEqual(
    result.results.map((entry) => entry.record),
    [record],
  );
});

for (const type of ["reinforce", "delete"]) {
  test(`recall rejects ${type} committed after its records were captured`, async () => {
    const { port, kernel, record } = await fixture();
    const original = port.query.bind(port);
    let captured;
    port.query = async (...args) => {
      captured = await original(...args);
      await kernel.decideMemory({
        memoryId: record.memoryId,
        type,
        expectedRevision: record.revision,
        authority: "user-1",
        at: AT,
        ...(type === "reinforce"
          ? { summary: "Updated deterministic tests" }
          : { deletionFence: "recall-delete" }),
      });
      return captured;
    };
    await assert.rejects(kernel.recallMemory(request), {
      code: "revision_conflict",
      details: { expectedRevision: 1, currentRevision: 2 },
    });
    assert.equal(captured[0].revision, 1);
    assert.equal((await port.read(record.memoryId)).revision, 2);
    port.query = original;
    const fresh = await kernel.recallMemory(request);
    assert.equal(fresh.memoryRevision, 2);
    if (type === "delete") assert.deepEqual(fresh.results, []);
    else
      assert.equal(
        fresh.results[0].record.summary,
        "Updated deterministic tests",
      );
  });
}

test("an empty recall also rejects a generation change", async () => {
  const { port, kernel } = await fixture();
  port.query = async () => {
    await kernel.proposeMemory(proposal({ memoryId: "memory-2" }));
    return [];
  };
  await assert.rejects(kernel.recallMemory(request), {
    code: "revision_conflict",
  });
});

test("Stop after the initial revision prevents querying records", async () => {
  const controller = new AbortController();
  const port = {
    read() {},
    commit() {},
    async getRevision() {
      controller.abort();
      return 0;
    },
    query: () => assert.fail("must not query records after Stop"),
  };
  const kernel = new ContextMemoryKernel({ memoryPort: port });
  await assert.rejects(
    kernel.recallMemory(request, { signal: controller.signal }),
    { name: "AbortError" },
  );
});
