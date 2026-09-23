/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, process, Buffer */
"use strict";

const fs = require("node:fs");
const {
  createAtomicFileCommitter,
} = require("../../secure-config-atomic-file");

const target = process.argv[2];

if (!target || typeof process.send !== "function") {
  process.exitCode = 2;
} else {
  const delayedPromises = {
    ...fs.promises,
    async open(...args) {
      const handle = await fs.promises.open(...args);
      if (args[0] !== `${target}.tmp`) {
        return handle;
      }
      return {
        close: () => handle.close(),
        writeFile: (data) => handle.writeFile(data),
        async sync() {
          process.send({ type: "locked" });
          await new Promise((resolve) => {
            process.once("message", (message) => {
              if (message?.type === "release") {
                resolve();
              }
            });
          });
          await handle.sync();
        },
      };
    },
  };

  createAtomicFileCommitter({ fs, fsPromises: delayedPromises })
    .writeFile(target, Buffer.from("child"))
    .then(() => process.exit(0))
    .catch((error) => {
      process.send({ type: "error", message: error.message });
      process.exit(1);
    });
}
