import { appendEvent } from "../../src/harness/jsonl-session-store.js";

const [sessionId, writerId, countText] = process.argv.slice(2);
const count = Number.parseInt(countText, 10);

if (!sessionId || !writerId || !Number.isSafeInteger(count) || count < 1) {
  throw new Error(
    "usage: session-concurrency-writer <session> <writer> <count>",
  );
}

for (let sequence = 0; sequence < count; sequence += 1) {
  appendEvent(sessionId, "concurrency_probe", { writerId, sequence });
}
