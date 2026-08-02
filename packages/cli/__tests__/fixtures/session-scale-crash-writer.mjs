import { closeSync, fsyncSync, openSync, writeSync } from "node:fs";

const [home, sessionId, encodedRecord, cutText] = process.argv.slice(2);
const cut = Number.parseInt(cutText, 10);
if (!home || !sessionId || !encodedRecord || !Number.isSafeInteger(cut)) {
  throw new Error(
    "usage: session-scale-crash-writer <home> <session> <base64-record> <cut>",
  );
}

process.env.CHAINLESSCHAIN_HOME = home;
const { sessionPath } =
  await import("../../src/harness/jsonl-session-store.js");
const record = Buffer.from(encodedRecord, "base64");
if (cut < 1 || cut > record.length) {
  throw new Error("cut must be within the non-empty record boundary");
}

const fd = openSync(sessionPath(sessionId), "a");
try {
  const written = writeSync(fd, record, 0, cut);
  if (written !== cut) throw new Error(`short write: ${written}/${cut}`);
  fsyncSync(fd);
  process.stdout.write(`${JSON.stringify({ ready: true, written })}\n`);
  // The parent sends SIGKILL while this descriptor and process remain live.
  // No finally handler or graceful close can turn the partial bytes into a
  // complete record.
  setInterval(() => {}, 60_000);
} catch (error) {
  closeSync(fd);
  throw error;
}
