"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  loadContextMemoryWriterInventory,
  discoverUnclassifiedContextMemoryWriters,
  validateContextMemoryWriterInventory,
} = require("../lib/index.js");

test("machine-readable inventory covers every product surface and discovered writer", () => {
  const inventory = loadContextMemoryWriterInventory();
  const result = validateContextMemoryWriterInventory(inventory);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
  assert.equal(result.entryCount, 7);
  assert.equal(result.surfaceCount, 7);
  assert.equal(result.unknownWriterCount, 0);
  assert.match(result.digest, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(discoverUnclassifiedContextMemoryWriters(inventory), []);
});

test("inventory gate fails for an unclassified candidate and duplicate authority", () => {
  const inventory = JSON.parse(JSON.stringify(loadContextMemoryWriterInventory()));
  inventory.entries[0].role = "legacy_writer";
  const result = validateContextMemoryWriterInventory(inventory, {
    requireFiles: false,
    discoverWriters: false,
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("exactly one canonical runtime entry is required"));
});
