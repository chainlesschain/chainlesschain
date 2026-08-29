import { CliCanonicalMemoryService } from "../../src/lib/context-memory-kernel/memory-service.js";

const AT = "2026-08-29T00:00:00.000Z";
const memoryFilePath = process.argv[2];
if (!memoryFilePath) throw new Error("memory file path is required");

const legacy = {
  id: "legacy-crash-row-1",
  content: "Delete this value across a process crash",
  category: "privacy",
  importance: 5,
  source: "user",
  created_at: AT,
  updated_at: AT,
};
const service = new CliCanonicalMemoryService({
  env: { CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default" },
  memoryFilePath,
  clock: () => Date.parse(AT),
});
await service.migrateLegacyEntries([legacy]);
const [record] = await service.list();
const deletion = await service.delete(record.id);
if (deletion?.status !== "partial") {
  throw new Error(`expected partial deletion before crash, got ${deletion?.status}`);
}
process.stdout.write(`${JSON.stringify({
  ready: true,
  operationId: deletion.requestId,
  memoryId: deletion.memoryId,
})}\n`);

setInterval(() => {}, 1_000);
