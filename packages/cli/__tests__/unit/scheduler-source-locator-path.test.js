import { describe, expect, it } from "vitest";
import {
  canonicalSchedulerSourcePath,
  isCanonicalSchedulerSourcePath,
  isFullyQualifiedWindowsSchedulerPath,
  schedulerSourcePathDirname,
} from "../../src/lib/scheduler-kernel/source-locator-path.js";

describe("scheduler source locator path identity", () => {
  it("accepts only fully-qualified Windows drive and UNC paths", () => {
    expect(isFullyQualifiedWindowsSchedulerPath(String.raw`C:\repo\jobs`)).toBe(
      true,
    );
    expect(
      isFullyQualifiedWindowsSchedulerPath(String.raw`\\server\share\jobs`),
    ).toBe(true);
    expect(
      isFullyQualifiedWindowsSchedulerPath(String.raw`\\?\C:\repo\jobs`),
    ).toBe(true);
    expect(
      isFullyQualifiedWindowsSchedulerPath(
        String.raw`\\?\UNC\server\share\jobs`,
      ),
    ).toBe(true);

    expect(isFullyQualifiedWindowsSchedulerPath(String.raw`\jobs`)).toBe(false);
    expect(isFullyQualifiedWindowsSchedulerPath("/jobs")).toBe(false);
    expect(isFullyQualifiedWindowsSchedulerPath(String.raw`C:jobs`)).toBe(
      false,
    );
    expect(isFullyQualifiedWindowsSchedulerPath(String.raw`\\server`)).toBe(
      false,
    );
    expect(
      isFullyQualifiedWindowsSchedulerPath(String.raw`\\.\pipe\scheduler`),
    ).toBe(false);
  });

  it("normalizes Windows case and separators without depending on the host OS", () => {
    const options = {
      platform: "win32",
      basePath: String.raw`D:\Scheduler\Root`,
    };
    expect(
      canonicalSchedulerSourcePath(
        String.raw`C:/Users/Alice/../Data/FLOW.db`,
        options,
      ),
    ).toBe(String.raw`c:\users\data\flow.db`);
    expect(
      canonicalSchedulerSourcePath(
        String.raw`//SERVER/Share/Folder/../Jobs`,
        options,
      ),
    ).toBe(String.raw`\\server\share\jobs`);
    expect(
      canonicalSchedulerSourcePath(String.raw`workspace\Jobs`, options),
    ).toBe(String.raw`d:\scheduler\root\workspace\jobs`);
    expect(
      schedulerSourcePathDirname(
        String.raw`C:\Sessions\ABC\events.jsonl`,
        options,
      ),
    ).toBe(String.raw`c:\sessions\abc`);
  });

  it("rejects Windows root-relative, drive-relative, and device paths", () => {
    const options = {
      platform: "win32",
      basePath: String.raw`C:\Scheduler`,
    };
    for (const candidate of [
      String.raw`\root-relative`,
      "/root-relative",
      String.raw`C:drive-relative`,
      String.raw`\\server`,
      String.raw`\\.\pipe\scheduler`,
    ]) {
      expect(() => canonicalSchedulerSourcePath(candidate, options)).toThrow(
        expect.objectContaining({ code: "SCHEDULER_SOURCE_PATH_INVALID" }),
      );
    }
  });

  it("requires journal paths to already be canonical", () => {
    const options = { platform: "win32" };
    expect(
      isCanonicalSchedulerSourcePath(String.raw`c:\scheduler\jobs`, options),
    ).toBe(true);
    expect(
      isCanonicalSchedulerSourcePath(String.raw`C:\Scheduler\Jobs`, options),
    ).toBe(false);
    expect(
      isCanonicalSchedulerSourcePath(String.raw`c:/scheduler/jobs`, options),
    ).toBe(false);
    expect(
      isCanonicalSchedulerSourcePath(String.raw`\scheduler\jobs`, options),
    ).toBe(false);
  });

  it("removes trailing separators from non-roots and preserves filesystem roots", () => {
    const windows = { platform: "win32" };
    expect(canonicalSchedulerSourcePath("C:\\Scheduler\\Jobs\\", windows)).toBe(
      String.raw`c:\scheduler\jobs`,
    );
    expect(canonicalSchedulerSourcePath("C:\\", windows)).toBe("c:\\");
    expect(
      canonicalSchedulerSourcePath("\\\\Server\\Share\\Jobs\\", windows),
    ).toBe(String.raw`\\server\share\jobs`);
    expect(canonicalSchedulerSourcePath("\\\\Server\\Share\\", windows)).toBe(
      "\\\\server\\share\\",
    );
    expect(canonicalSchedulerSourcePath("\\\\?\\C:\\Jobs\\", windows)).toBe(
      String.raw`\\?\c:\jobs`,
    );
    expect(canonicalSchedulerSourcePath("\\\\?\\C:\\", windows)).toBe(
      "\\\\?\\c:\\",
    );
    expect(
      canonicalSchedulerSourcePath(
        "\\\\?\\UNC\\Server\\Share\\Jobs\\",
        windows,
      ),
    ).toBe(String.raw`\\?\unc\server\share\jobs`);
    expect(
      canonicalSchedulerSourcePath("\\\\?\\UNC\\Server\\Share\\", windows),
    ).toBe("\\\\?\\unc\\server\\share\\");

    expect(
      canonicalSchedulerSourcePath("/var/lib/scheduler///", {
        platform: "linux",
      }),
    ).toBe("/var/lib/scheduler");
    expect(canonicalSchedulerSourcePath("/", { platform: "linux" })).toBe("/");
  });

  it("rejects leading or trailing whitespace instead of collapsing identity", () => {
    for (const candidate of [
      " /var/lib/scheduler",
      "/var/lib/scheduler ",
      "\t/var/lib/scheduler",
    ]) {
      expect(() =>
        canonicalSchedulerSourcePath(candidate, { platform: "linux" }),
      ).toThrow(
        expect.objectContaining({ code: "SCHEDULER_SOURCE_PATH_INVALID" }),
      );
    }
    expect(
      isFullyQualifiedWindowsSchedulerPath(String.raw` C:\Scheduler`),
    ).toBe(false);
    expect(
      isFullyQualifiedWindowsSchedulerPath(`${String.raw`C:\Scheduler`} `),
    ).toBe(false);
  });
});
