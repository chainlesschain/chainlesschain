/**
 * Diff apply guards (P1 hardening) — two failure classes the review pipeline
 * previously had no defense against:
 *
 *  1. Optimistic concurrency: openDiff Accept blind-wrote the whole file, so
 *     any edit the user made ON DISK while the review sat open was silently
 *     destroyed. Now the facade compares the disk against the review baseline
 *     (originalText) before writing and asks before overwriting (default =
 *     cancel). No baseline → legacy byte-identical path, no prompt ever.
 *
 *  2. Binary corruption: everything is written as UTF-8 text, which corrupts
 *     a binary file. openDiff / openMultiDiff now short-circuit binary
 *     baselines/targets as "binary file, skipped" without touching the disk.
 *
 * Pure core: vscode-extension/src/diff-apply-guard.js (JB twin
 * DiffApplyGuard.java). Wiring exercised through the REAL facade on real
 * temp files, same pattern as vscode-ext-apply-text-fallback.test.js.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  checkApplySafety,
  looksBinary,
  REASON_DISK_DRIFTED,
  REASON_BINARY_SKIPPED,
} from "../../../vscode-extension/src/diff-apply-guard.js";
import { createVscodeEditorFacade } from "../../../vscode-extension/src/vscode-facade.js";

const NUL = String.fromCharCode(0);
const tick = () => new Promise((r) => setImmediate(r));

describe("checkApplySafety (pure)", () => {
  it("flags a drifted disk", () => {
    expect(
      checkApplySafety({ baselineText: "a", currentDiskText: "b" }),
    ).toEqual({ safe: false, reason: REASON_DISK_DRIFTED });
  });

  it("identical baseline and disk is safe", () => {
    expect(
      checkApplySafety({ baselineText: "same", currentDiskText: "same" }),
    ).toEqual({ safe: true });
  });

  it("missing baseline is safe (legacy callers keep their old path)", () => {
    expect(checkApplySafety({ currentDiskText: "anything" })).toEqual({
      safe: true,
    });
    expect(checkApplySafety({})).toEqual({ safe: true });
    expect(checkApplySafety()).toEqual({ safe: true });
  });

  it("unreadable/missing current disk is safe (nothing to clobber)", () => {
    expect(checkApplySafety({ baselineText: "a" })).toEqual({ safe: true });
  });
});

describe("looksBinary (pure)", () => {
  it("detects a NUL byte in strings and buffers", () => {
    expect(looksBinary(`PNG${NUL}data`)).toBe(true);
    expect(looksBinary(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]))).toBe(true);
  });

  it("does NOT flag plain or multi-byte UTF-8 text (中文)", () => {
    expect(looksBinary("plain ascii")).toBe(false);
    expect(looksBinary("中文注释：评审期间不误判为二进制 🚀")).toBe(false);
    expect(looksBinary(Buffer.from("中文注释：评审期间不误判", "utf8"))).toBe(
      false,
    );
  });

  it("null/undefined/empty are not binary", () => {
    expect(looksBinary(null)).toBe(false);
    expect(looksBinary(undefined)).toBe(false);
    expect(looksBinary("")).toBe(false);
    expect(looksBinary(Buffer.alloc(0))).toBe(false);
  });
});

/**
 * Fake vscode for wiring tests. applyEdit resolves false so accepted writes
 * take the direct-fs fallback — the assertions then read the REAL temp file.
 */
function fakeVscode() {
  let untitled = 0;
  let infoResolve = null;
  const warnings = []; // { message, resolve }
  const diffCalls = [];
  const v = {
    l10n: {
      t: (m, ...a) =>
        String(m).replace(/\{(\d+)\}/g, (x, i) =>
          a[i] != null ? String(a[i]) : x,
        ),
    },
    Uri: {
      file: (p) => ({
        fsPath: p,
        scheme: "file",
        toString: () => "file://" + p,
      }),
    },
    workspace: {
      openTextDocument: async (arg) => {
        if (arg && typeof arg === "object" && "content" in arg) {
          return {
            uri: { toString: () => "untitled:U" + ++untitled },
            getText: () => arg.content,
            positionAt: (n) => n,
            save: async () => {},
          };
        }
        return {
          uri: arg,
          getText: () => "",
          positionAt: (n) => n,
          save: async () => {},
        };
      },
      applyEdit: async () => false, // force the fs fallback → real disk writes
    },
    commands: {
      executeCommand: async (cmd, ...args) => {
        if (cmd === "vscode.diff" || cmd === "vscode.changes") {
          diffCalls.push({ cmd, args });
        }
      },
    },
    window: {
      showInformationMessage: () =>
        new Promise((resolve) => {
          infoResolve = resolve;
        }),
      showWarningMessage: (message, _opts, ...actions) =>
        new Promise((resolve) => {
          warnings.push({ message, actions, resolve });
        }),
      showQuickPick: async () => null,
    },
    WorkspaceEdit: class {
      replace() {}
    },
    Range: class {},
  };
  return {
    vscode: v,
    diffCalls,
    warnings,
    decide: (choice) => infoResolve(choice),
  };
}

const tmpFile = (name, content) => {
  const p = path.join(os.tmpdir(), `cc-drift-${Date.now()}-${name}`);
  fs.writeFileSync(p, content, "utf8");
  return p;
};

describe("openDiff Accept: optimistic-concurrency drift gate (wiring)", () => {
  it("drifted disk + cancel → rejected(disk-drifted), disk untouched", async () => {
    const file = tmpFile("cancel.txt", "baseline");
    try {
      const fx = fakeVscode();
      const facade = createVscodeEditorFacade(fx.vscode);
      const p = facade.openDiff({
        path: file,
        originalText: "baseline",
        modifiedText: "agent proposal",
      });
      await tick();
      // The user edits the file on disk WHILE the review is open.
      fs.writeFileSync(file, "user concurrent edit", "utf8");
      fx.decide("Accept");
      await tick();
      // Drift detected → confirm prompt; dismissing (undefined) = cancel.
      expect(fx.warnings).toHaveLength(1);
      expect(fx.warnings[0].message).toContain("modified on disk");
      fx.warnings[0].resolve(undefined);
      const res = await p;
      expect(res).toMatchObject({
        outcome: "rejected",
        reason: REASON_DISK_DRIFTED,
      });
      // The user's concurrent edit survives — nothing was blind-written.
      expect(fs.readFileSync(file, "utf8")).toBe("user concurrent edit");
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it("drifted disk + explicit Overwrite → accepted, proposal lands", async () => {
    const file = tmpFile("overwrite.txt", "baseline");
    try {
      const fx = fakeVscode();
      const facade = createVscodeEditorFacade(fx.vscode);
      const p = facade.openDiff({
        path: file,
        originalText: "baseline",
        modifiedText: "agent proposal",
      });
      await tick();
      fs.writeFileSync(file, "user concurrent edit", "utf8");
      fx.decide("Accept");
      await tick();
      expect(fx.warnings).toHaveLength(1);
      fx.warnings[0].resolve("Overwrite"); // the explicit confirm button
      const res = await p;
      expect(res).toMatchObject({ outcome: "accepted" });
      expect(fs.readFileSync(file, "utf8")).toBe("agent proposal");
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it("no drift → no prompt, accepted (default path unchanged)", async () => {
    const file = tmpFile("clean.txt", "baseline");
    try {
      const fx = fakeVscode();
      const facade = createVscodeEditorFacade(fx.vscode);
      const p = facade.openDiff({
        path: file,
        originalText: "baseline",
        modifiedText: "agent proposal",
      });
      await tick();
      fx.decide("Accept");
      const res = await p;
      expect(fx.warnings).toHaveLength(0); // never prompted
      expect(res).toMatchObject({ outcome: "accepted" });
      expect(fs.readFileSync(file, "utf8")).toBe("agent proposal");
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it("no baseline → no prompt even when the disk moved (legacy path)", async () => {
    const file = tmpFile("legacy.txt", "whatever");
    try {
      const fx = fakeVscode();
      const facade = createVscodeEditorFacade(fx.vscode);
      const p = facade.openDiff({ path: file, modifiedText: "proposal" });
      await tick();
      fs.writeFileSync(file, "moved", "utf8");
      fx.decide("Accept");
      const res = await p;
      expect(fx.warnings).toHaveLength(0);
      expect(res).toMatchObject({ outcome: "accepted" });
      expect(fs.readFileSync(file, "utf8")).toBe("proposal");
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
});

describe("openDiff binary guard (wiring)", () => {
  it("binary proposal short-circuits without opening a diff or writing", async () => {
    const file = tmpFile("bin-target.txt", "text");
    try {
      const fx = fakeVscode();
      const facade = createVscodeEditorFacade(fx.vscode);
      const res = await facade.openDiff({
        path: file,
        modifiedText: `BIN${NUL}${NUL}BLOB`,
      });
      expect(res).toMatchObject({
        outcome: "rejected",
        reason: REASON_BINARY_SKIPPED,
      });
      expect(fx.diffCalls).toHaveLength(0); // no UI ever opened
      expect(fs.readFileSync(file, "utf8")).toBe("text"); // untouched
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it("binary ON-DISK target (no baseline given) is skipped, not corrupted", async () => {
    const file = path.join(os.tmpdir(), `cc-drift-${Date.now()}-target.bin`);
    const blob = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]);
    fs.writeFileSync(file, blob);
    try {
      const fx = fakeVscode();
      const facade = createVscodeEditorFacade(fx.vscode);
      const res = await facade.openDiff({
        path: file,
        modifiedText: "plain text replacement",
      });
      expect(res).toMatchObject({
        outcome: "rejected",
        reason: REASON_BINARY_SKIPPED,
      });
      expect(fs.readFileSync(file).equals(blob)).toBe(true); // bytes intact
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it("UTF-8 Chinese content is NOT mistaken for binary", async () => {
    const file = tmpFile("cn.txt", "旧版中文内容");
    try {
      const fx = fakeVscode();
      const facade = createVscodeEditorFacade(fx.vscode);
      const p = facade.openDiff({
        path: file,
        originalText: "旧版中文内容",
        modifiedText: "新版中文内容：评审通过",
      });
      await tick();
      fx.decide("Accept");
      const res = await p;
      expect(res).toMatchObject({ outcome: "accepted" });
      expect(fs.readFileSync(file, "utf8")).toBe("新版中文内容：评审通过");
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
});

describe("openMultiDiff guards (wiring)", () => {
  it("Accept all: drifted file skipped on cancel, clean file still written", async () => {
    const drifted = tmpFile("md-drift.txt", "base-a");
    const clean = tmpFile("md-clean.txt", "base-b");
    try {
      const fx = fakeVscode();
      const facade = createVscodeEditorFacade(fx.vscode);
      const p = facade.openMultiDiff({
        files: [
          { path: drifted, originalText: "base-a", modifiedText: "new-a" },
          { path: clean, originalText: "base-b", modifiedText: "new-b" },
        ],
      });
      await tick();
      fs.writeFileSync(drifted, "user edit during review", "utf8");
      fx.decide("Accept all");
      await tick();
      expect(fx.warnings).toHaveLength(1); // only the drifted file prompts
      fx.warnings[0].resolve(undefined); // cancel → keep the user's edit
      const res = await p;
      expect(res).toMatchObject({
        outcome: "accepted",
        applied: 1,
        total: 2,
        skippedConflicts: [drifted],
      });
      expect(fs.readFileSync(drifted, "utf8")).toBe("user edit during review");
      expect(fs.readFileSync(clean, "utf8")).toBe("new-b");
    } finally {
      fs.rmSync(drifted, { force: true });
      fs.rmSync(clean, { force: true });
    }
  });

  it("every write cancelled → rejected(disk-drifted), nothing written", async () => {
    const drifted = tmpFile("md-all-drift.txt", "base");
    try {
      const fx = fakeVscode();
      const facade = createVscodeEditorFacade(fx.vscode);
      const p = facade.openMultiDiff({
        files: [{ path: drifted, originalText: "base", modifiedText: "new" }],
      });
      await tick();
      fs.writeFileSync(drifted, "user edit", "utf8");
      fx.decide("Accept all");
      await tick();
      fx.warnings[0].resolve(undefined);
      const res = await p;
      expect(res).toMatchObject({
        outcome: "rejected",
        reason: REASON_DISK_DRIFTED,
        applied: 0,
      });
      expect(fs.readFileSync(drifted, "utf8")).toBe("user edit");
    } finally {
      fs.rmSync(drifted, { force: true });
    }
  });

  it("binary changeset entries are skipped; an all-binary set never prompts", async () => {
    const fx = fakeVscode();
    const facade = createVscodeEditorFacade(fx.vscode);
    const res = await facade.openMultiDiff({
      files: [
        {
          path: "/ws/asset.png",
          originalText: `old${NUL}`,
          modifiedText: `new${NUL}`,
        },
      ],
    });
    expect(res).toMatchObject({
      outcome: "rejected",
      reason: REASON_BINARY_SKIPPED,
      skippedBinary: ["/ws/asset.png"],
    });
    expect(fx.diffCalls).toHaveLength(0);
  });

  it("mixed set: binary dropped from review, text file still applied", async () => {
    const textFile = tmpFile("md-mixed.txt", "base");
    try {
      const fx = fakeVscode();
      const facade = createVscodeEditorFacade(fx.vscode);
      const p = facade.openMultiDiff({
        files: [
          { path: textFile, originalText: "base", modifiedText: "new" },
          {
            path: "/ws/blob.bin",
            originalText: `a${NUL}`,
            modifiedText: `b${NUL}`,
          },
        ],
      });
      await tick();
      fx.decide("Accept all");
      const res = await p;
      expect(res).toMatchObject({
        outcome: "accepted",
        applied: 1,
        total: 1,
        skippedBinary: ["/ws/blob.bin"],
      });
      expect(fs.readFileSync(textFile, "utf8")).toBe("new");
    } finally {
      fs.rmSync(textFile, { force: true });
    }
  });
});
