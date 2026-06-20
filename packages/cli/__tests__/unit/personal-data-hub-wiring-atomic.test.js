import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _atomicWriteJson600 } from "../../src/lib/personal-data-hub-wiring.js";

describe("personal-data-hub-wiring _atomicWriteJson600", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "cc-pdhw-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("writes JSON atomically at mode 0600 with no .tmp leftover", () => {
    const file = join(dir, "accounts.json");
    _atomicWriteJson600(file, [{ id: "a", token: "secret" }]);
    expect(JSON.parse(readFileSync(file, "utf-8"))).toEqual([{ id: "a", token: "secret" }]);
    expect(readdirSync(dir).some((n) => n.endsWith(".tmp"))).toBe(false);
    if (process.platform !== "win32") {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
  });
});
