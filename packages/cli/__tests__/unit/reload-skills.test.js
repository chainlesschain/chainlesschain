/** /reload-skills (CC 2.1.152 parity) — cache drop + live re-scan. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { reloadSkills } from "../../src/runtime/agent-core.js";

describe("reloadSkills", () => {
  it("picks up a skill added after the first scan (cache dropped)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-reload-"));
    const prev = process.cwd();
    try {
      fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });
      fs.mkdirSync(path.join(tmp, ".chainlesschain"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, ".chainlesschain", "config.json"),
        "{}",
        "utf-8",
      );
      process.chdir(tmp);

      const before = reloadSkills(); // baseline scan in this cwd

      const dir = path.join(tmp, ".claude", "skills", "hot-added");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "SKILL.md"),
        "---\nname: hot-added\ndescription: added mid-session\n---\nbody",
        "utf-8",
      );

      const after = reloadSkills();
      expect(after).toBe(before + 1); // new skill visible without restart
    } finally {
      process.chdir(prev);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
