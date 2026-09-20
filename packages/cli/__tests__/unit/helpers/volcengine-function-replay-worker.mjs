import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  captureVolcengineFunctionReplayStore,
  createVolcengineFunctionReplayStore,
} from "../../../src/lib/evolution/volcengine-function-replay-store.js";

const [rootDir, descriptorPath, reservationPath, readyDir, gatePath, nowValue] =
  process.argv.slice(2);
const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8"));
const reservation = JSON.parse(readFileSync(reservationPath, "utf8"));
const store = createVolcengineFunctionReplayStore({
  rootDir,
  descriptor,
  now: () => Number(nowValue),
});
const port = captureVolcengineFunctionReplayStore(store);
writeFileSync(join(readyDir, `${process.pid}.ready`), "ready", {
  encoding: "utf8",
  flag: "wx",
});
while (!existsSync(gatePath)) await delay(5);

try {
  const acknowledgement = port.reserve(reservation);
  process.stdout.write(JSON.stringify({ status: "reserved", acknowledgement }));
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      status: "rejected",
      code: error?.code ?? null,
      message: error?.message ?? "unknown",
    }),
  );
}
