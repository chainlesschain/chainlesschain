import { createHash } from "node:crypto";

/** Detect repeated file pages independently of transcript compaction. */
export class ReadFileLoopGuard {
  constructor() {
    this.seen = new Set();
    this.repeatedBatches = 0;
    this.batch = null;
  }

  startBatch(size) {
    this.batch = { size, duplicates: 0 };
  }

  record(tool, result) {
    if (
      !this.batch ||
      tool !== "read_file" ||
      result?.error ||
      !result?.path ||
      !result.fileVersion ||
      typeof result.content !== "string"
    )
      return;
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          process.platform === "win32"
            ? result.path.toLowerCase()
            : result.path,
          result.fileVersion,
          result.range || {
            startLine: 1,
            endLine: result.content.split("\n").length,
            totalLines: result.content.split("\n").length,
          },
          result.nextRead?.offset ?? null,
          result.nextRead?.column ?? null,
          result.hashed === true,
          result.notebook === true,
          result.content,
        ]),
      )
      .digest("hex");
    if (this.seen.has(fingerprint)) this.batch.duplicates++;
    this.seen.delete(fingerprint);
    this.seen.add(fingerprint);
    if (this.seen.size > 128) this.seen.delete(this.seen.values().next().value);
  }

  finishBatch() {
    if (!this.batch) return;
    this.repeatedBatches =
      this.batch.size > 0 && this.batch.duplicates === this.batch.size
        ? this.repeatedBatches + 1
        : 0;
    this.batch = null;
  }

  get recoveryHint() {
    return this.repeatedBatches >= 2
      ? "Repeated unchanged file reads detected: the last two tool batches returned only pages already read during this run. Continue the task using those findings. If more content is needed, follow nextRead or use search_files and read a different offset/limit. Do not restart the same file scan. Another batch of only repeated pages will stop this run to avoid wasting tokens."
      : null;
  }

  get stalled() {
    return this.repeatedBatches >= 3;
  }
}
