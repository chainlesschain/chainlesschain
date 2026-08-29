#!/usr/bin/env node

import kernel from "../index.mjs";

const inventory = kernel.loadContextMemoryWriterInventory();
const result = kernel.validateContextMemoryWriterInventory(inventory);
if (!result.valid) {
  for (const error of result.errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log(
    `Context/Memory inventory valid: ${result.entryCount} entries, ${result.classifiedFileCount} files, digest ${result.digest}`,
  );
}
