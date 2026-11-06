"use strict";

// Bounded diagnostics for synthetic journeys. Keep only related IPC error
// headers; never publish the environment-bearing application log.
function observeGoalJourneyErrors(child, { secrets = [] } = {}) {
  const errors = [];
  const attach = (stream) => {
    let pending = "";
    stream?.on("data", (bytes) => {
      const lines = (pending + bytes.toString("utf8")).split(/\r?\n/u);
      pending = lines.pop().slice(-4096);
      for (const line of lines) {
        const match =
          /^Error occurred in handler for '((?:project:(?:goal|risk)[a-z0-9:-]*|task:controlled[a-z0-9:-]*))': (.+)$/u.exec(
            line,
          );
        if (!match || errors.length >= 30) continue;
        let message = match[2].slice(0, 1500);
        for (const secret of secrets)
          if (secret)
            message = message.replaceAll(secret, "[fixture-secret-redacted]");
        errors.push({
          channel: match[1],
          message,
          at: new Date().toISOString(),
        });
      }
    });
  };
  attach(child.stdout);
  attach(child.stderr);
  return errors;
}
module.exports = { observeGoalJourneyErrors };
