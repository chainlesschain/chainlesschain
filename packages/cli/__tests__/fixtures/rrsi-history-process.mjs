import fs from "node:fs";
import { openRrsiHistoryStore } from "./rrsi-history-store.js";

const [root, mode, inputFile] = process.argv.slice(2);
try {
  const input = inputFile
    ? JSON.parse(fs.readFileSync(inputFile, "utf8"))
    : null;
  const fixture = openRrsiHistoryStore(root, {
    crashHook:
      mode === "crash-reserve"
        ? (phase) => {
            if (phase === "after-head") process.exit(71);
          }
        : null,
  });
  const work = () => {
    if (mode === "inspect") return fixture.adapter.inspect();
    if (["reserve", "crash-reserve", "race-reserve"].includes(mode))
      return fixture.adapter.reserve(input ?? fixture.request());
    throw new Error("unsupported test mode");
  };
  if (mode === "race-reserve") {
    process.send({ ready: true });
    process.once("message", () => {
      try {
        process.send({ ok: true, result: work() });
      } catch (error) {
        process.send({ ok: false, code: error.code });
      }
      process.disconnect();
    });
  } else process.stdout.write(`${JSON.stringify(work())}\n`);
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({ ok: false, code: error.code ?? "TEST_HISTORY_FAILED" })}\n`,
  );
  process.exitCode = 1;
}
