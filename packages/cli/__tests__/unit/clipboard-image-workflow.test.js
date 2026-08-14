import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflow = fs.readFileSync(
  path.resolve(
    import.meta.dirname,
    "../../../../.github/workflows/cli-clipboard-image.yml",
  ),
  "utf8",
);

describe("CLI clipboard image host workflow", () => {
  it("binds every host to one exact checkout and uploads per-platform evidence", () => {
    expect(workflow).toContain("CC_CLIPBOARD_IMAGE_EXPECTED_SHA");
    expect(workflow).toContain("Checkout exact clipboard image commit");
    expect(workflow).toContain(
      'test "${actual_sha}" = "${CC_CLIPBOARD_IMAGE_EXPECTED_SHA}"',
    );
    expect(workflow).toContain(
      "os: [ubuntu-latest, windows-latest, macos-latest]",
    );
    expect(workflow).toContain("clipboard-image-host-smoke.mjs");
    expect(workflow).toContain("if-no-files-found: error");
  });

  it("creates a fail-closed three-platform aggregate", () => {
    expect(workflow).toContain('test "${MATRIX_RESULT}" = "success"');
    expect(workflow).toContain("expected three clipboard image evidence files");
    expect(workflow).toContain('["darwin", "linux", "win32"]');
    expect(workflow).toContain('entry.status !== "passed"');
    expect(workflow).toContain("entry.releaseCommit !== expectedSha");
    expect(workflow).toContain(
      "entry.execution?.workflowSha !== expectedWorkflowSha",
    );
    expect(workflow).toContain("entry.dimensions?.width !== 3");
    expect(workflow).toContain(
      "entry.pixelSha256 !== entry.fixturePixelSha256",
    );
    expect(workflow).toContain("fixtures differ across the host matrix");
    expect(workflow).toContain(
      'entry.macosTiffFallback?.reader !== "osascript+jxa-tiff"',
    );
    expect(workflow).toContain('entry.reader !== "osascript"');
    expect(workflow).toContain('entry.writerLifecycle?.mode !== "foreground"');
    expect(workflow).toContain(
      "entry.writerLifecycle?.cleanupConfirmed !== true",
    );
    expect(workflow).toContain("cli-clipboard-image-aggregate-");
  });

  it("uses a real X11 clipboard host on Linux and native hosts elsewhere", () => {
    expect(workflow).toContain("sudo apt-get install -y x11-utils xclip xvfb");
    expect(workflow).toContain("Xvfb :99");
    expect(workflow).toContain("-nolisten tcp");
    expect(workflow).toContain("unset WAYLAND_DISPLAY");
    expect(workflow).toContain('wait "${xvfb_pid}"');
    expect(workflow).toContain("shell: pwsh");
    expect(workflow).toContain("Run macOS clipboard image write/read smoke");
    expect(workflow).toContain("macosTiffFallback");
  });
});
