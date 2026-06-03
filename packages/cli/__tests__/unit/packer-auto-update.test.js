/**
 * Unit tests: cc pack auto-update orchestration (Phase 3g)
 *
 * The runAutoUpdate function chains checkPackUpdate → downloadAndVerify →
 * scheduleReplace with a confirm-prompt between check and apply. All four
 * dependencies are injected so we exercise the flow without touching disk
 * or the network.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { runAutoUpdate } from "../../src/commands/pack.js";

// Silence chalk during tests — runAutoUpdate also calls logger.log with chalk
// strings, but a noop logger keeps captured calls comparable across runs.
function makeLogger() {
  return {
    log: vi.fn(),
    error: vi.fn(),
  };
}

const FAKE_ARTIFACT = {
  target: "node20-linux-x64",
  url: "https://example.test/cc-0.158.0-linux-x64",
  sha256: "a".repeat(64),
};

function makeUpdateResult({
  updateAvailable = true,
  withArtifact = true,
} = {}) {
  return {
    updateAvailable,
    currentVersion: "0.157.0",
    latestVersion: updateAvailable ? "0.158.0" : "0.157.0",
    artifact: withArtifact ? FAKE_ARTIFACT : null,
    releaseNotes: "https://example.test/notes",
    channel: "stable",
    publishedAt: "2026-05-20T00:00:00Z",
  };
}

describe("runAutoUpdate", () => {
  let log;
  let exit;
  let checkImpl;
  let downloadImpl;
  let applyImpl;
  let confirmImpl;

  beforeEach(() => {
    log = makeLogger();
    exit = vi.fn();
    checkImpl = vi.fn(async () => makeUpdateResult());
    downloadImpl = vi.fn(async ({ outputPath }) => ({
      outputPath,
      bytes: 90_000_000,
      sha256: FAKE_ARTIFACT.sha256,
    }));
    applyImpl = vi.fn(async () => ({
      platform: "posix",
      action: "replace-in-place",
      targetExePath: "/usr/local/bin/cc",
      newExePath: "/usr/local/bin/cc.new",
      sidecarPath: null,
      restartRequested: true,
    }));
    confirmImpl = vi.fn(async () => true);
  });

  function call(opts, overrides = {}) {
    return runAutoUpdate({
      opts: {
        manifestUrl: "https://example.test/manifest.json",
        target: "node20-linux-x64",
        current: "0.157.0",
        ...opts,
      },
      checkImpl,
      downloadImpl,
      applyImpl,
      confirmImpl,
      logger: log,
      exit,
      ...overrides,
    });
  }

  // ── stage 1: check ────────────────────────────────────────────────────────
  it("exits 2 when no manifest URL is resolvable", async () => {
    delete process.env.CC_PACK_UPDATE_MANIFEST;
    const r = await call({ manifestUrl: undefined });
    expect(exit).toHaveBeenCalledWith(2);
    expect(checkImpl).not.toHaveBeenCalled();
    expect(r.action).toBe("check");
  });

  it("up-to-date short-circuits before download/apply", async () => {
    checkImpl = vi.fn(async () =>
      makeUpdateResult({ updateAvailable: false, withArtifact: false }),
    );
    const r = await call({}, { checkImpl });
    expect(r.action).toBe("up-to-date");
    expect(downloadImpl).not.toHaveBeenCalled();
    expect(applyImpl).not.toHaveBeenCalled();
    expect(confirmImpl).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it("exits 3 when check throws a PackUpdateError", async () => {
    const { PackUpdateError } =
      await import("../../src/lib/packer/pack-update-checker.js");
    checkImpl = vi.fn(async () => {
      throw new PackUpdateError("nope", "FETCH_FAILED");
    });
    await call({}, { checkImpl });
    expect(exit).toHaveBeenCalledWith(3);
    expect(downloadImpl).not.toHaveBeenCalled();
  });

  it("exits 3 when manifest has update but no artifact for target", async () => {
    checkImpl = vi.fn(async () =>
      makeUpdateResult({ updateAvailable: true, withArtifact: false }),
    );
    await call({}, { checkImpl });
    expect(exit).toHaveBeenCalledWith(3);
    expect(downloadImpl).not.toHaveBeenCalled();
  });

  // ── stage 2: dry-run ──────────────────────────────────────────────────────
  it("--dry-run stops after check, doesn't download or apply or prompt", async () => {
    const r = await call({ dryRun: true });
    expect(r.action).toBe("check");
    expect(downloadImpl).not.toHaveBeenCalled();
    expect(applyImpl).not.toHaveBeenCalled();
    expect(confirmImpl).not.toHaveBeenCalled();
  });

  // ── stage 3: confirm ──────────────────────────────────────────────────────
  it("prompts confirm by default and proceeds when user says yes", async () => {
    const r = await call({});
    expect(confirmImpl).toHaveBeenCalledTimes(1);
    expect(confirmImpl.mock.calls[0][0]).toMatch(/0\.157\.0.*0\.158\.0/);
    expect(downloadImpl).toHaveBeenCalledTimes(1);
    expect(applyImpl).toHaveBeenCalledTimes(1);
    expect(r.action).toBe("applied");
  });

  it("declined confirm aborts before download", async () => {
    confirmImpl = vi.fn(async () => false);
    const r = await call({}, { confirmImpl });
    expect(r.action).toBe("declined");
    expect(downloadImpl).not.toHaveBeenCalled();
    expect(applyImpl).not.toHaveBeenCalled();
  });

  it("--yes skips the confirm prompt", async () => {
    await call({ yes: true });
    expect(confirmImpl).not.toHaveBeenCalled();
    expect(downloadImpl).toHaveBeenCalledTimes(1);
    expect(applyImpl).toHaveBeenCalledTimes(1);
  });

  it("--json implies skip-confirm (can't prompt in JSON mode)", async () => {
    await call({ json: true });
    expect(confirmImpl).not.toHaveBeenCalled();
    expect(downloadImpl).toHaveBeenCalledTimes(1);
    expect(applyImpl).toHaveBeenCalledTimes(1);
  });

  // ── stage 4: download ─────────────────────────────────────────────────────
  it("exits 4 when download throws", async () => {
    const { DownloadError } =
      await import("../../src/lib/packer/pack-update-downloader.js");
    downloadImpl = vi.fn(async () => {
      throw new DownloadError("sha mismatch", "SHA_MISMATCH");
    });
    await call({ yes: true }, { downloadImpl });
    expect(exit).toHaveBeenCalledWith(4);
    expect(applyImpl).not.toHaveBeenCalled();
  });

  it("--dest overrides the default output path", async () => {
    await call({ yes: true, dest: "/tmp/custom-target" });
    const dlArg = downloadImpl.mock.calls[0][0];
    // path.resolve normalizes; just assert basename to stay platform-agnostic
    expect(dlArg.outputPath).toMatch(/custom-target$/);
  });

  // ── stage 5: apply ────────────────────────────────────────────────────────
  it("apply defaults restart=true (one-shot UX)", async () => {
    await call({ yes: true });
    expect(applyImpl).toHaveBeenCalledTimes(1);
    const applyArg = applyImpl.mock.calls[0][0];
    expect(applyArg.restart).toBe(true);
  });

  it("--no-restart flips restart to false", async () => {
    // commander parses --no-restart as restart:false on the opts object.
    await call({ yes: true, restart: false });
    const applyArg = applyImpl.mock.calls[0][0];
    expect(applyArg.restart).toBe(false);
  });

  it("--target-exe overrides apply target", async () => {
    await call({ yes: true, targetExe: "/opt/cc/cc" });
    const applyArg = applyImpl.mock.calls[0][0];
    expect(applyArg.targetExePath).toBe("/opt/cc/cc");
  });

  it("exits 5 when apply throws", async () => {
    const { ApplyError } =
      await import("../../src/lib/packer/pack-update-applier.js");
    applyImpl = vi.fn(async () => {
      throw new ApplyError("rename failed", "RENAME_FAILED");
    });
    await call({ yes: true }, { applyImpl });
    expect(exit).toHaveBeenCalledWith(5);
  });

  it("Windows sidecar-cmd schedules a deferred exit(0)", async () => {
    applyImpl = vi.fn(async () => ({
      platform: "win32",
      action: "sidecar-cmd",
      targetExePath: "C:\\cc.exe",
      newExePath: "C:\\cc.exe.new",
      sidecarPath: "C:\\Users\\x\\AppData\\Local\\Temp\\cc-pack-apply-1.cmd",
      restartRequested: true,
    }));
    vi.useFakeTimers();
    try {
      const r = await call({ yes: true }, { applyImpl });
      expect(r.action).toBe("applied");
      expect(r.apply.action).toBe("sidecar-cmd");
      // The deferred exit fires on the next 500ms tick
      expect(exit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(500);
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // ── output mode ───────────────────────────────────────────────────────────
  it("--json emits structured success at apply stage", async () => {
    await call({ json: true });
    const calls = log.log.mock.calls.map((c) => c[0]);
    const lastJson = calls
      .filter((c) => typeof c === "string" && c.trim().startsWith("{"))
      .pop();
    expect(lastJson).toBeTruthy();
    const parsed = JSON.parse(lastJson);
    expect(parsed.action).toBe("applied");
    expect(parsed.currentVersion).toBe("0.157.0");
    expect(parsed.latestVersion).toBe("0.158.0");
    expect(parsed.download.sha256).toBe(FAKE_ARTIFACT.sha256);
    expect(parsed.apply.action).toBe("replace-in-place");
  });

  it("--json mode does not emit chalk-styled human strings", async () => {
    await call({ json: true });
    // In JSON mode, every logger.log payload should be valid JSON or empty;
    // no human "Update available:" prose.
    const stdoutLines = log.log.mock.calls.map((c) => String(c[0] || ""));
    for (const line of stdoutLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      expect(() => JSON.parse(trimmed)).not.toThrow();
    }
  });
});
