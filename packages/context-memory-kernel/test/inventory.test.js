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

test("production inventory has one canonical writer and no writable legacy cohort", () => {
  const inventory = loadContextMemoryWriterInventory();
  const canonical = inventory.entries.filter(
    (entry) => entry.role === "canonical_runtime",
  );
  assert.equal(canonical.length, 1);
  assert.equal(canonical[0].currentStage, "canonical_default");

  const writableLegacyStages = new Set([
    "inventory",
    "shadow",
    "internal_canary",
    "opt_in_canary",
    "canonical_default",
  ]);
  assert.deepEqual(
    inventory.entries
      .filter(
        (entry) =>
          entry.role === "legacy_writer" &&
          writableLegacyStages.has(entry.currentStage),
      )
      .map((entry) => entry.id),
    [],
  );
  assert.equal(
    inventory.entries
      .filter((entry) => entry.role === "projection_consumer")
      .every((entry) => entry.currentStage === "canonical_default"),
    true,
  );
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
