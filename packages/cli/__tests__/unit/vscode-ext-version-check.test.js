/**
 * CLI version-sync logic — decide from `cc --version` output whether to nudge
 * the user to upgrade their `chainlesschain` CLI to match the extension. Pure;
 * runs in the CLI suite like the other vscode-ext unit tests.
 */
import { describe, it, expect } from "vitest";
import {
  MIN_CLI_VERSION,
  UPGRADE_COMMAND,
  parseCliVersion,
  compareVersions,
  checkCliVersion,
  upgradeNotice,
  runCliVersionSync,
} from "../../../vscode-extension/src/version-check.js";

describe("UPGRADE_COMMAND", () => {
  it("is the canonical global-latest npm install (shared by prompt + command)", () => {
    expect(UPGRADE_COMMAND).toBe("npm i -g chainlesschain@latest");
    expect(upgradeNotice(checkCliVersion("0.162.40")).upgradeCommand).toBe(
      UPGRADE_COMMAND,
    );
  });
});

describe("parseCliVersion", () => {
  it("extracts x.y.z from varied `cc --version` output", () => {
    expect(parseCliVersion("0.162.47")).toBe("0.162.47");
    expect(parseCliVersion("chainlesschain 0.162.50\n")).toBe("0.162.50");
    expect(parseCliVersion("cc v1.2.3-alpha.4 (build)")).toBe("1.2.3-alpha.4");
  });
  it("returns null for junk / non-string", () => {
    expect(parseCliVersion("no version here")).toBe(null);
    expect(parseCliVersion(null)).toBe(null);
    expect(parseCliVersion(123)).toBe(null);
  });
});

describe("compareVersions", () => {
  it("orders by major.minor.patch", () => {
    expect(compareVersions("0.162.47", "0.162.47")).toBe(0);
    expect(compareVersions("0.162.46", "0.162.47")).toBe(-1);
    expect(compareVersions("0.163.0", "0.162.99")).toBe(1);
    expect(compareVersions("1.0.0", "0.999.999")).toBe(1);
  });
  it("ignores prerelease suffixes", () => {
    expect(compareVersions("0.162.47-alpha.1", "0.162.47")).toBe(0);
  });
});

describe("checkCliVersion", () => {
  it("ok when installed >= minimum", () => {
    expect(checkCliVersion("0.162.47")).toMatchObject({
      status: "ok",
      installed: "0.162.47",
    });
    expect(checkCliVersion("0.162.65")).toMatchObject({ status: "ok" });
  });
  it("outdated when installed < minimum", () => {
    expect(checkCliVersion("0.162.40")).toMatchObject({
      status: "outdated",
      installed: "0.162.40",
      minimum: MIN_CLI_VERSION,
    });
  });
  it("missing when no output; unknown when unparsable", () => {
    expect(checkCliVersion(null)).toMatchObject({
      status: "missing",
      installed: null,
    });
    expect(checkCliVersion("")).toMatchObject({ status: "missing" });
    expect(checkCliVersion("command not found")).toMatchObject({
      status: "unknown",
    });
  });
  it("respects a custom minimum", () => {
    expect(checkCliVersion("0.162.50", "0.162.60")).toMatchObject({
      status: "outdated",
    });
  });
});

describe("upgradeNotice", () => {
  it("only nudges for an outdated cc; quiet otherwise", () => {
    const notice = upgradeNotice(checkCliVersion("0.162.40"));
    expect(notice.message).toContain("0.162.40");
    expect(notice.message).toContain(MIN_CLI_VERSION);
    expect(notice.upgradeCommand).toBe("npm i -g chainlesschain@latest");

    expect(upgradeNotice(checkCliVersion("0.162.47"))).toBe(null); // ok
    expect(upgradeNotice(checkCliVersion(null))).toBe(null); // missing → handled elsewhere
    expect(upgradeNotice(checkCliVersion("junk"))).toBe(null); // unknown
    expect(upgradeNotice(null)).toBe(null);
  });
});

describe("runCliVersionSync", () => {
  function deps(over = {}) {
    const dismissed = new Set(over.dismissedKeys || []);
    const calls = { upgraded: null, dismissedKey: null };
    return {
      getVersion: over.getVersion || (async () => "0.162.40"), // outdated default
      isDismissed: (k) => dismissed.has(k),
      setDismissed: (k) => {
        dismissed.add(k);
        calls.dismissedKey = k;
      },
      prompt: over.prompt || (async () => null),
      upgrade: (cmd) => {
        calls.upgraded = cmd;
      },
      _calls: calls,
    };
  }

  it("does nothing when cc is up to date", async () => {
    const d = deps({ getVersion: async () => "0.162.99" });
    expect(await runCliVersionSync(d)).toBe("none");
  });

  it("runs the upgrade command when the user accepts", async () => {
    const d = deps({ prompt: async () => "upgrade" });
    expect(await runCliVersionSync(d)).toBe("upgrade");
    expect(d._calls.upgraded).toBe("npm i -g chainlesschain@latest");
  });

  it("remembers 'don't show again' (keyed by minimum)", async () => {
    const d = deps({ prompt: async () => "dismiss" });
    expect(await runCliVersionSync(d)).toBe("dismissed");
    expect(d._calls.dismissedKey).toBe(
      "cliUpgradeDismissed:" + MIN_CLI_VERSION,
    );
  });

  it("stays quiet once dismissed for that minimum", async () => {
    const d = deps({
      prompt: async () => "upgrade",
      dismissedKeys: ["cliUpgradeDismissed:" + MIN_CLI_VERSION],
    });
    expect(await runCliVersionSync(d)).toBe("none");
    expect(d._calls.upgraded).toBe(null); // never prompted
  });

  it("stays quiet (not throws) when the version probe fails or cc is missing", async () => {
    expect(
      await runCliVersionSync(
        deps({
          getVersion: async () => {
            throw new Error("x");
          },
        }),
      ),
    ).toBe("none");
    expect(
      await runCliVersionSync(deps({ getVersion: async () => null })),
    ).toBe("none");
  });
});
