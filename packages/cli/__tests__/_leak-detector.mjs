import { afterAll, expect } from "vitest";
import { writeSync } from "node:fs";

// TEMP leak detector: after each test file, report any ChildProcess or
// non-std socket handle still pinning the worker's event loop. Used to hunt
// the forks-pool worker-death flake (a sibling file leaking a spawned child).
afterAll(() => {
  try {
    const active = process._getActiveHandles?.() || [];
    const children = [];
    const socks = [];
    for (const h of active) {
      const name = h?.constructor?.name || "";
      if (typeof h?.pid === "number" || name === "ChildProcess") {
        children.push(`child(pid=${h.pid},killed=${h.killed})`);
      } else if (
        (h?.remoteAddress !== undefined || h?._sockname !== undefined) &&
        ![0, 1, 2].includes(h?._handle?.fd)
      ) {
        socks.push(`sock(fd=${h?._handle?.fd},destroyed=${h?.destroyed})`);
      }
    }
    if (children.length || socks.length) {
      let file = "?";
      try {
        file = expect.getState?.().testPath || "?";
      } catch {
        /* ignore */
      }
      const msg = `[LEAK] ${file} children=${JSON.stringify(children)} socks=${JSON.stringify(socks)}`;
      writeSync(2, `\n${msg}\n`);
      // Throw so the leaking file FAILS and vitest surfaces this message even
      // under --silent=passed-only (a passed file's captured output is dropped).
      // The earliest-throwing file in a reused worker is the actual leaker.
      throw new Error(msg);
    }
  } catch {
    /* ignore */
  }
});
