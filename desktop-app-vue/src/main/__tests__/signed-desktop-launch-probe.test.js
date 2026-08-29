import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  maybeRunSignedDesktopLaunchProbe,
  receiptDigest,
} = require("../signed-desktop-launch-probe.js");

const roots = [];
const COMMIT = "a".repeat(40);
const ARTIFACT = `sha256:${"b".repeat(64)}`;
const CHALLENGE = `sha256:${"c".repeat(64)}`;

function fixture({ packaged = true, buildCommit = COMMIT } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-signed-launch-"));
  roots.push(root);
  const appAsar = path.join(root, "app.asar");
  const buildInfo = path.join(root, "build-info.json");
  const output = path.join(root, "receipt.json");
  fs.writeFileSync(appAsar, "signed packaged bytes", "utf8");
  fs.writeFileSync(
    buildInfo,
    JSON.stringify({ commitSha: buildCommit }),
    "utf8",
  );
  const app = {
    isPackaged: packaged,
    getAppPath: () => appAsar,
    getVersion: () => "5.0.3-test",
    quit: vi.fn(),
  };
  const argv = [
    "electron",
    "app",
    "--cc-signed-skill-launch-output",
    output,
    "--cc-signed-skill-launch-commit",
    COMMIT,
    "--cc-signed-skill-artifact-sha256",
    ARTIFACT,
    "--cc-signed-skill-launch-challenge",
    CHALLENGE,
  ];
  return { app, appAsar, buildInfo, output, argv };
}

afterEach(() => {
  while (roots.length > 0) {
    fs.rmSync(roots.pop(), { recursive: true, force: true });
  }
});

describe("signed Desktop launch probe", () => {
  it("writes a digest-bound packaged ASAR receipt and exits", async () => {
    const value = fixture();
    await expect(
      maybeRunSignedDesktopLaunchProbe({
        app: value.app,
        argv: value.argv,
        buildInfoPath: value.buildInfo,
        electronVersion: "39.2.7",
        platform: "windows",
      }),
    ).resolves.toBe(true);
    const receipt = JSON.parse(fs.readFileSync(value.output, "utf8"));
    expect(receipt).toMatchObject({
      status: "passed",
      commitSha: COMMIT,
      artifactSha256: ARTIFACT,
      challengeDigest: CHALLENGE,
      platform: "windows",
      started: true,
      isPackaged: true,
      asar: true,
    });
    expect(receipt.appAsarSha256).toBe(
      `sha256:${crypto
        .createHash("sha256")
        .update(fs.readFileSync(value.appAsar))
        .digest("hex")}`,
    );
    expect(receipt.receiptDigest).toBe(receiptDigest(receipt));
    expect(value.app.quit).toHaveBeenCalledOnce();
  });

  it("does nothing without the explicit launch probe argument", async () => {
    const value = fixture();
    await expect(
      maybeRunSignedDesktopLaunchProbe({
        app: value.app,
        argv: ["electron", "app"],
        buildInfoPath: value.buildInfo,
      }),
    ).resolves.toBe(false);
    expect(value.app.quit).not.toHaveBeenCalled();
  });

  it.each([
    ["source checkout", { packaged: false }],
    ["different build commit", { buildCommit: "d".repeat(40) }],
  ])("fails closed for %s", async (_label, options) => {
    const value = fixture(options);
    await expect(
      maybeRunSignedDesktopLaunchProbe({
        app: value.app,
        argv: value.argv,
        buildInfoPath: value.buildInfo,
      }),
    ).rejects.toThrow();
    expect(fs.existsSync(value.output)).toBe(false);
    expect(value.app.quit).not.toHaveBeenCalled();
  });
});
