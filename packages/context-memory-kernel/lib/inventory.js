"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { canonicalDigest, cloneCanonical } = require("./canonical.js");

const INVENTORY_SCHEMA = "chainlesschain.context-memory-writer-inventory/v1";
const INVENTORY_PATH = path.resolve(__dirname, "..", "inventory", "writers.v1.json");
const ROLES = new Set(["canonical_runtime", "legacy_writer", "projection_consumer", "capability_client"]);
const DISPOSITIONS = new Set(["migrate", "compatibility_adapter", "projection_only", "capability_only", "retire"]);

function loadContextMemoryWriterInventory(inventoryPath = INVENTORY_PATH) {
  return Object.freeze(JSON.parse(fs.readFileSync(path.resolve(inventoryPath), "utf8")));
}

function walkFiles(directory, discovery, output = []) {
  if (!fs.existsSync(directory)) return output;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (discovery.excludedSegments.includes(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walkFiles(target, discovery, output);
    else if (
      discovery.extensions.includes(path.extname(entry.name)) &&
      !discovery.excludedSuffixes.some((suffix) => entry.name.endsWith(suffix))
    ) {
      output.push(target);
    }
  }
  return output;
}

function classifiedFiles(inventory) {
  return new Set(inventory.entries.flatMap((entry) => entry.files));
}

function discoverUnclassifiedContextMemoryWriters(
  inventory,
  { repositoryRoot = path.resolve(__dirname, "..", "..", "..") } = {},
) {
  const classified = classifiedFiles(inventory);
  const patterns = inventory.discovery.writerPatterns.map((pattern) => new RegExp(pattern, "iu"));
  const candidates = new Set();
  for (const root of inventory.discovery.roots) {
    for (const file of walkFiles(path.resolve(repositoryRoot, root), inventory.discovery)) {
      const source = fs.readFileSync(file, "utf8");
      if (!patterns.some((pattern) => pattern.test(source))) continue;
      candidates.add(path.relative(repositoryRoot, file).replaceAll("\\", "/"));
    }
  }
  return Object.freeze([...candidates].filter((file) => !classified.has(file)).sort());
}

function validateContextMemoryWriterInventory(
  inventory,
  {
    repositoryRoot = path.resolve(__dirname, "..", "..", ".."),
    requireFiles = true,
    discoverWriters = true,
  } = {},
) {
  const errors = [];
  if (inventory?.schema !== INVENTORY_SCHEMA) errors.push("inventory schema is unsupported");
  if (inventory?.version !== 1) errors.push("inventory version must be 1");
  const stages = new Set(inventory?.cutoverStages || []);
  const requiredSurfaces = new Set(inventory?.requiredSurfaces || []);
  const entries = Array.isArray(inventory?.entries) ? inventory.entries : [];
  const ids = new Set();
  const files = new Set();
  const surfaces = new Set();
  let canonicalRuntimeCount = 0;

  for (const entry of entries) {
    if (!entry.id || ids.has(entry.id)) errors.push("entry id is missing or duplicated");
    ids.add(entry.id);
    surfaces.add(entry.surface);
    if (!requiredSurfaces.has(entry.surface)) errors.push(`${entry.id}: surface is not declared`);
    if (!ROLES.has(entry.role)) errors.push(`${entry.id}: role is invalid`);
    if (!stages.has(entry.currentStage)) errors.push(`${entry.id}: currentStage is invalid`);
    if (!DISPOSITIONS.has(entry.disposition)) errors.push(`${entry.id}: disposition is invalid`);
    if (entry.role === "canonical_runtime") canonicalRuntimeCount += 1;
    if (entry.role === "legacy_writer" && entry.targetAuthority !== "context_memory_kernel") {
      errors.push(`${entry.id}: legacy writer must target the canonical Kernel`);
    }
    if (entry.role === "projection_consumer" && entry.disposition !== "projection_only") {
      errors.push(`${entry.id}: projection consumer must remain projection-only`);
    }
    for (const field of ["files", "mutationFunctions", "stores", "recoveryEntrypoints"]) {
      if (!Array.isArray(entry[field])) errors.push(`${entry.id}: ${field} must be an array`);
    }
    if (!entry.files?.length) errors.push(`${entry.id}: files are empty`);
    if (!entry.mutationFunctions?.length) errors.push(`${entry.id}: mutationFunctions are empty`);
    for (const file of entry.files || []) {
      if (files.has(file)) errors.push(`${entry.id}: file is classified more than once: ${file}`);
      files.add(file);
      if (requireFiles && !fs.existsSync(path.resolve(repositoryRoot, file))) {
        errors.push(`${entry.id}: classified file does not exist: ${file}`);
      }
    }
  }
  for (const surface of requiredSurfaces) {
    if (!surfaces.has(surface)) errors.push(`required surface is missing: ${surface}`);
  }
  if (canonicalRuntimeCount !== 1) errors.push("exactly one canonical runtime entry is required");
  const unknownWriters = discoverWriters
    ? discoverUnclassifiedContextMemoryWriters(inventory, { repositoryRoot })
    : [];
  for (const file of unknownWriters) errors.push(`unclassified context/memory writer: ${file}`);

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    entryCount: entries.length,
    surfaceCount: surfaces.size,
    classifiedFileCount: files.size,
    unknownWriterCount: unknownWriters.length,
    digest: canonicalDigest(inventory, "chainlesschain.context-memory-writer-inventory/v1"),
    inventory: Object.freeze(cloneCanonical(inventory)),
  });
}

module.exports = {
  INVENTORY_SCHEMA,
  INVENTORY_PATH,
  loadContextMemoryWriterInventory,
  discoverUnclassifiedContextMemoryWriters,
  validateContextMemoryWriterInventory,
};
