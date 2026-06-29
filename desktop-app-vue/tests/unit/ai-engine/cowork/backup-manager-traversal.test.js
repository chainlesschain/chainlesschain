/**
 * Security regression: backup-manager builds an output path from flags.name and
 * resolves restore/info/delete targets from flags.file — both skill inputs. Without
 * confinement, "../../x" or an absolute path let the agent write/read/delete files
 * outside the backups dir (path traversal).
 */
import { describe, it, expect } from "vitest";
import path from "node:path";

const handler = require("../../../../src/main/ai-engine/cowork/skills/builtin/backup-manager/handler.js");

describe("backup-manager path-traversal guards", () => {
  it("safeBackupName strips directory parts and unsafe chars", () => {
    expect(handler.safeBackupName("../../evil")).toBe("evil");
    expect(handler.safeBackupName("a/b/c")).toBe("c");
    expect(handler.safeBackupName("x;rm")).toBe("x_rm");
    expect(handler.safeBackupName("ok_name.1")).toBe("ok_name.1");
    expect(handler.safeBackupName("")).toBe(null);
    expect(handler.safeBackupName(null)).toBe(null);
  });

  it("resolveZip confines targets to the backups dir", () => {
    const root = path.join("C:", "fake", "root");
    const traversal = handler.resolveZip("../../etc/passwd", root);
    expect(path.basename(traversal)).toBe("passwd");
    expect(traversal).not.toContain("etc");
    expect(traversal.endsWith(path.join("backups", "passwd"))).toBe(true);

    const absolute = handler.resolveZip(
      path.join("C:", "windows", "system32", "evil.zip"),
      root,
    );
    expect(path.basename(absolute)).toBe("evil.zip");
    expect(absolute.endsWith(path.join("backups", "evil.zip"))).toBe(true);
    expect(absolute).not.toContain("system32");
  });
});
