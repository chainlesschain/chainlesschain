/**
 * v5.0.3.96 — covers classifyUpdateError.
 *
 * Background: when release.yml workflow is still running for a freshly
 * pushed tag, the GitHub release object exists but `latest*.yml` is not
 * yet uploaded → electron-updater throws "Cannot find latest.yml ...
 * HttpError: 404". Pre-v5.0.3.96 we dumped the whole stacktrace into a
 * red "检查更新失败" dialog. Now we classify that as "release-in-progress"
 * and surface a calm info-dialog ("新版本正在发布中, 稍后再试") for manual
 * checks, and stay completely silent for background self-checks.
 *
 * Only the pure classifier is unit-tested here. The dispatch logic in
 * auto-updater.js's error event handler is a 4-branch switch on
 * `classified.kind × _manualCheckPending`; it is manually verified
 * because the singleton at module load hits the real electron-updater
 * (vitest does not alias it, same constraint that punted the existing
 * enhanced-tray-manager tests on triggerCheckForUpdates).
 */

import { describe, it, expect } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { classifyUpdateError } = require("../update-error-classifier.js");

describe("classifyUpdateError", () => {
  it("classifies missing latest.yml 404 as release-in-progress (real symptom)", () => {
    // Verbatim message shape from the v5.0.3.95 user report (2026-05-27)
    const err = new Error(
      "Cannot find latest.yml in the latest release artifacts " +
        "(https://github.com/chainlesschain/chainlesschain/releases/download/v5.0.3.95/latest.yml), " +
        'HttpError: 404\n"method: GET url: https://github.com/..."',
    );
    const c = classifyUpdateError(err);
    expect(c.kind).toBe("release-in-progress");
    expect(c.title).toBe("新版本正在发布中");
    expect(c.message).toContain("打包上传");
    expect(c.detail).toContain("稍后");
    // friendly text must NOT echo the raw stacktrace
    expect(c.detail).not.toContain("HttpError");
    expect(c.detail).not.toContain('"method":');
  });

  it("classifies 404 on latest-mac.yml as release-in-progress", () => {
    const err = new Error(
      "HttpError: 404 fetching https://example.com/releases/download/v1.2.3/latest-mac.yml",
    );
    expect(classifyUpdateError(err).kind).toBe("release-in-progress");
  });

  it("classifies 404 on latest-linux.yml as release-in-progress", () => {
    const err = new Error(
      "HttpError: 404 fetching https://example.com/releases/download/v1.2.3/latest-linux.yml",
    );
    expect(classifyUpdateError(err).kind).toBe("release-in-progress");
  });

  it("'Cannot find latest' alone (no 404) still flagged release-in-progress", () => {
    // electron-updater sometimes wraps the underlying 404 — message body
    // is enough.
    const err = new Error(
      "Cannot find latest-linux.yml in the latest release artifacts",
    );
    expect(classifyUpdateError(err).kind).toBe("release-in-progress");
  });

  it("classifies generic network errors as generic", () => {
    const err = new Error("net::ERR_CONNECTION_REFUSED");
    const c = classifyUpdateError(err);
    expect(c.kind).toBe("generic");
    expect(c.title).toBe("检查更新失败");
    expect(c.detail).toContain("ERR_CONNECTION_REFUSED");
  });

  it("classifies 404 on a non-yml asset as generic (not release-in-progress)", () => {
    // 404 alone is not sufficient — must also reference latest*.yml.
    // A 404 on the .exe / .dmg / .blockmap means the asset really is
    // missing or corrupted, not "still uploading".
    const err = new Error("HttpError: 404 fetching foo.exe");
    expect(classifyUpdateError(err).kind).toBe("generic");
  });

  it("handles null/undefined/non-Error inputs without throwing", () => {
    expect(classifyUpdateError(null).kind).toBe("generic");
    expect(classifyUpdateError(undefined).kind).toBe("generic");
    expect(classifyUpdateError("plain string error").kind).toBe("generic");
    expect(classifyUpdateError({}).kind).toBe("generic");
  });

  it("generic detail falls back to '未知错误' when error has no message", () => {
    expect(classifyUpdateError({}).detail).toBe("未知错误");
    expect(classifyUpdateError(null).detail).toBe("未知错误");
  });
});
