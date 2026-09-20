import { readFileSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

import {
  captureVolcengineFunctionReplayStore,
  createVolcengineFunctionReplayStore,
} from "../../../src/lib/evolution/volcengine-function-replay-store.js";

const [rootDir, descriptorPath, readyPath, nowValue] = process.argv.slice(2);
const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8"));
const port = captureVolcengineFunctionReplayStore(
  createVolcengineFunctionReplayStore({
    rootDir,
    descriptor,
    now: () => Number(nowValue),
  }),
);
writeFileSync(readyPath, "ready", { encoding: "utf8", flag: "wx" });

let outcome;
for (let attempt = 0; attempt < 500; attempt += 1) {
  try {
    const revocation = port.readRevocation();
    if (revocation) {
      outcome = { status: "revoked", revocation };
      break;
    }
  } catch (error) {
    outcome = {
      status: "unavailable",
      code: error?.code ?? null,
      message: error?.message ?? "unknown",
    };
    break;
  }
  await delay(10);
}

process.stdout.write(JSON.stringify(outcome ?? { status: "timeout" }));
