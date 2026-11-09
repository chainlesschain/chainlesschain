// Explicit subprocess-only fault injection: publication succeeds, then the
// production maintenance hook fails. No mutation retry or forged receipt.
import fs from "node:fs";
import { SegmentedMemoryPort } from "../../src/lib/context-memory-kernel/segmented-memory-port.js";
if (
  !process.env.CC_MEMORY_CORRECTION_FAULT_RECEIPT ||
  !process.argv.includes("correct")
)
  throw new Error(
    "Correction post-publish fixture requires its isolated CLI invocation",
  );
const publish = SegmentedMemoryPort.prototype._publish;
const collect = SegmentedMemoryPort.prototype._collect;
const publishing = new WeakSet();
SegmentedMemoryPort.prototype._publish = function (...args) {
  publishing.add(this);
  try {
    return publish.apply(this, args);
  } finally {
    publishing.delete(this);
  }
};
SegmentedMemoryPort.prototype._collect = function (manifest) {
  const disk =
    publishing.has(this) && fs.existsSync(this.filePath)
      ? JSON.parse(fs.readFileSync(this.filePath, "utf8"))
      : null;
  const published =
    disk &&
    disk.digest === manifest.digest &&
    disk.storeRevision === manifest.storeRevision;
  if (!published) return collect.call(this, manifest);
  fs.appendFileSync(
    process.env.CC_MEMORY_CORRECTION_FAULT_RECEIPT,
    "published-maintenance-entered\n",
  );
  throw new Error("Injected post-publication maintenance failure");
};
