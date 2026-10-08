"use strict";

// Node can drain the final Worker message and emit exit in the same callback.
// Register the entire lifecycle synchronously and resolve only after exit;
// awaiting a message before registering exit can leave a promise pending after
// the process has no remaining handles and silently lose the probe report.
function observeSettingsWriterWorker(worker) {
  return new Promise((resolve, reject) => {
    let messages = 0;
    let result;
    let failure;
    const onMessage = (value) => {
      messages += 1;
      if (messages === 1) result = value;
    };
    const onError = (error) => {
      failure ??= error;
    };
    const onExit = (code) => {
      worker.removeListener("message", onMessage);
      worker.removeListener("messageerror", onError);
      worker.removeListener("error", onError);
      worker.removeListener("exit", onExit);
      if (failure) reject(failure);
      else if (code !== 0)
        reject(new Error(`Settings writer Worker exited with code ${code}`));
      else if (messages !== 1)
        reject(
          new Error(`Settings writer Worker returned ${messages} results`),
        );
      else resolve(result);
    };
    worker.on("message", onMessage);
    worker.on("messageerror", onError);
    worker.on("error", onError);
    worker.once("exit", onExit);
  });
}

module.exports = { observeSettingsWriterWorker };
