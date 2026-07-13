import { afterAll, expect } from "vitest";
import { writeSync } from "node:fs";

// TEMP leak detector: after each test file (+ a short settle so transient
// closing husks clear), report GENUINELY-pinning handles/resources beyond the
// clean baseline (std streams fd 0/1/2 + vitest IPC pipe fd 3 + one vitest
// "Timeout"). A pin is: a live listening server, an fd>=0 ref'd handle, or a
// second timer. fd=-1 / destroyed husks are skipped (proven harmless — Windows
// terminates with them present). Throws so the leaking file surfaces its dump
// even under --silent.
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 600));
  try {
    const resources = process.getActiveResourcesInfo?.() || [];
    const active = process._getActiveHandles?.() || [];
    const extra = [];
    for (const h of active) {
      const name = h?.constructor?.name || typeof h;
      let fd = h?._handle?.fd ?? h?.fd;
      if (typeof fd !== "number") fd = undefined;
      if (fd !== undefined && [0, 1, 2, 3].includes(fd)) continue;
      let ref = "?";
      try {
        ref = h?._handle?.hasRef?.() ?? h?.hasRef?.() ?? "?";
      } catch {
        /* ignore */
      }
      const isServer = h?.listening === true;
      const isChild = typeof h?.pid === "number";
      // Report ANY ref'd handle (a ref'd handle pins the loop regardless of fd —
      // POSIX libuv counts an fd=-1 ref'd socket that Windows tolerates), plus
      // servers/children.
      if (!isServer && !isChild && ref !== true) continue;
      let kind = "";
      try {
        if (isChild) kind = `:child(pid=${h.pid})`;
        else if (isServer) kind = ":SERVER";
        else if (h?.remoteAddress !== undefined || h?._sockname !== undefined)
          kind = `:socket(destroyed=${h?.destroyed})`;
      } catch {
        /* ignore */
      }
      extra.push(`${name}${kind}:fd=${fd}:ref=${ref}`);
    }
    const timerCount = resources.filter(
      (r) => r === "Timeout" || r === "Immediate",
    ).length;
    if (extra.length || timerCount > 1) {
      let file = "?";
      try {
        file = expect.getState?.().testPath || "?";
      } catch {
        /* ignore */
      }
      const msg = `[LEAK2] ${file} timers=${timerCount} resources=${JSON.stringify(resources)} extraHandles=${JSON.stringify(extra)}`;
      writeSync(2, `\n${msg}\n`);
      throw new Error(msg);
    }
  } catch (e) {
    if (e?.message?.startsWith("[LEAK2]")) throw e;
    /* detector's own errors never fail a file */
  }
});
