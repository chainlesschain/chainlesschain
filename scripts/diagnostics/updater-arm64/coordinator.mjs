import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { delay, writeJson } from "./shared.mjs";

export function startCoordinator(output) {
  const observers = new Map();
  const scan = () => {
    for (const name of fs
      .readdirSync(output)
      .filter((entry) => entry.endsWith(".config.json"))) {
      if (observers.has(name)) continue;
      const id = name.replace(".config.json", "");
      const log = fs.openSync(
        path.join(output, `${id}.observer.stderr.log`),
        "w",
      );
      const child = spawn(
        process.execPath,
        [
          fileURLToPath(new URL("./observer.mjs", import.meta.url)),
          path.join(output, name),
        ],
        {
          stdio: ["ignore", "ignore", log],
          windowsHide: true,
          env: { ...process.env, NODE_OPTIONS: "" },
        },
      );
      fs.closeSync(log);
      const record = {
        child,
        closed: false,
        status: null,
        signal: null,
        error: null,
      };
      observers.set(name, record);
      child.once("error", (error) => {
        record.error = error.code;
      });
      child.once("close", (status, signal) => {
        Object.assign(record, { closed: true, status, signal });
        writeJson(path.join(output, `${id}.observer-exit.json`), {
          at: Date.now(),
          pid: child.pid,
          status,
          signal,
          error: record.error,
        });
      });
    }
  };
  const timer = setInterval(scan, 25);
  return {
    complete() {
      scan();
      return (
        observers.size > 0 &&
        [...observers].every(
          ([name, record]) =>
            record.closed &&
            record.status === 0 &&
            !record.error &&
            fs.existsSync(
              path.join(output, name.replace(".config.json", ".observer-done")),
            ),
        )
      );
    },
    async stop() {
      clearInterval(timer);
      for (const record of observers.values())
        if (!record.closed) record.child.kill();
      const deadline = Date.now() + 5000;
      while (
        [...observers.values()].some((record) => !record.closed) &&
        Date.now() < deadline
      )
        await delay(25);
    },
  };
}
