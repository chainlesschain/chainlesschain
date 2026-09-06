import { createHash } from "node:crypto";

/** Detect repeated file pages independently of transcript compaction. */
export class ReadFileLoopGuard {
  constructor() {
    this.seen = new Set();
    this.progress = new Map();
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
    const fileKey = JSON.stringify([
      process.platform === "win32" ? result.path.toLowerCase() : result.path,
      result.hashed === true,
      result.notebook === true,
    ]);
    const range = result.range || {
      startLine: 1,
      endLine: result.content.split("\n").length,
      totalLines: result.content.split("\n").length,
    };
    const previous = this.progress.get(fileKey);
    const nextLine = result.nextRead?.offset ?? range.totalLines + 1;
    const nextColumn = result.nextRead?.column ?? 1;
    // Re-reading an earlier page must not move the forward cursor backwards.
    if (
      !previous ||
      previous.fileVersion !== result.fileVersion ||
      nextLine > previous.nextLine ||
      (nextLine === previous.nextLine && nextColumn >= previous.nextColumn)
    ) {
      this.progress.delete(fileKey);
      this.progress.set(fileKey, {
        fileVersion: result.fileVersion,
        nextLine,
        nextColumn,
        summary: {
          path: result.path,
          lastReadRange: range,
          ...(result.nextRead
            ? { nextRead: result.nextRead }
            : { reachedEnd: true }),
        },
      });
      if (this.progress.size > 8)
        this.progress.delete(this.progress.keys().next().value);
    }
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          process.platform === "win32"
            ? result.path.toLowerCase()
            : result.path,
          result.fileVersion,
          range,
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

  get progressHint() {
    const entries = [...this.progress.values()].map((value) => value.summary);
    while (entries.length && JSON.stringify(entries).length > 6000)
      entries.shift();
    return entries.length
      ? "[Current run file read progress — survives context compaction]\n" +
          JSON.stringify(entries) +
          "\nThese are forward reading cursors, not a claim that skipped sections were read. Continue with nextRead when scanning the file; do not restart at the beginning after compaction. If reachedEnd is true, use the findings or search_files for specific missing details. Re-read earlier sections only when needed."
      : null;
  }

  get stalled() {
    return this.repeatedBatches >= 3;
  }
}
