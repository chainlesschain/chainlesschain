/** /reload-skills — process grant revocation + cache drop + live re-scan. */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CLISkillLoader } from "../../src/lib/skill-loader.js";
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

  it("revokes active Skill execution leases before re-scanning", () => {
    const loader = new CLISkillLoader({ contextLedger: null });
    const lease = loader.acquireSkillExecution({ id: "active-before-reload" });
    try {
      reloadSkills();
      expect(lease.signal.aborted).toBe(true);
      expect(lease.signal.reason).toMatchObject({
        name: "AbortError",
        code: "CC_SKILL_EXECUTION_REVOKED",
        message: "Skill execution authorization was revoked by /reload-skills",
      });
      expect(() => lease.assertActive()).toThrow(
        expect.objectContaining({ code: "CC_SKILL_EXECUTION_REVOKED" }),
      );
    } finally {
      lease.release();
    }
  });

  it("closes the parent abort race while registering an execution lease", () => {
    const reason = Object.assign(new Error("parent stopped at registration"), {
      name: "AbortError",
    });
    const signal = {
      aborted: false,
      reason: undefined,
      addEventListener: vi.fn(function () {
        this.aborted = true;
        this.reason = reason;
      }),
      removeEventListener: vi.fn(),
    };
    const loader = new CLISkillLoader({ contextLedger: null });

    let caught;
    try {
      loader.acquireSkillExecution({ id: "registration-race" }, { signal });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(reason);
    expect(signal.removeEventListener).toHaveBeenCalledOnce();
    expect(loader.revokeExecutionAuthorizations().interruptedLeases).toBe(0);
  });
});
