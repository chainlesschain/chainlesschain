import { describe, it, expect, vi } from "vitest";
import pkg from "../../../../src/main/terminal/confirmation-dialog.js";
const { createTerminalConfirmation } = pkg;

function makeDialog(response) {
  return {
    showMessageBox: vi.fn(async () => ({ response })),
  };
}

describe("createTerminalConfirmation", () => {
  it("returns false when user picks 拒绝 (response 0)", async () => {
    const dialog = makeDialog(0);
    const confirm = createTerminalConfirmation({
      getMainWindow: () => null,
      dialogModule: dialog,
    });
    expect(await confirm("rm -rf /", "s1")).toBe(false);
  });

  it("returns true when user picks 允许一次 (response 1)", async () => {
    const dialog = makeDialog(1);
    const confirm = createTerminalConfirmation({
      getMainWindow: () => null,
      dialogModule: dialog,
    });
    expect(await confirm("rm -rf /", "s1")).toBe(true);
  });

  it("returns true and remembers cmd when user picks 永久信任 (response 2)", async () => {
    const dialog = makeDialog(2);
    const confirm = createTerminalConfirmation({
      getMainWindow: () => null,
      dialogModule: dialog,
    });
    expect(await confirm("rm -rf /", "s1")).toBe(true);

    // Second call should NOT show dialog again.
    dialog.showMessageBox.mockClear();
    const dialog2 = makeDialog(0); // even if dialog would say deny, trust cache wins
    const confirm2 = createTerminalConfirmation({
      getMainWindow: () => null,
      dialogModule: dialog2,
    });
    // Note: each create returns its own closure with its own trust map.
    // Two calls on the SAME confirm closure share the trust set:
    expect(await confirm("rm -rf /", "s1")).toBe(true);
    expect(dialog.showMessageBox).not.toHaveBeenCalled();

    // But a fresh closure has fresh state.
    dialog2.showMessageBox.mockClear();
    expect(await confirm2("rm -rf /", "s1")).toBe(false);
    expect(dialog2.showMessageBox).toHaveBeenCalledTimes(1);
  });

  it("returns false (deny) when dialog throws", async () => {
    const dialog = {
      showMessageBox: vi.fn(async () => {
        throw new Error("display unavailable");
      }),
    };
    const confirm = createTerminalConfirmation({
      getMainWindow: () => null,
      dialogModule: dialog,
    });
    expect(await confirm("rm -rf /", "s1")).toBe(false);
  });

  it("uses different keys per sessionId — trust on one session doesn't leak to another", async () => {
    const dialog = makeDialog(2);
    const confirm = createTerminalConfirmation({
      getMainWindow: () => null,
      dialogModule: dialog,
    });
    expect(await confirm("rm -rf /", "s1")).toBe(true);

    const dialog2 = makeDialog(0);
    // Same closure, different sessionId — should re-prompt.
    // Swap dialogModule via constructing a new closure with the same key
    // semantics; but the test confirm closure is bound to dialog. So
    // we just call the same confirm twice; first cached s1, second
    // queries dialog for s2.
    dialog.showMessageBox.mockResolvedValueOnce({ response: 0 });
    expect(await confirm("rm -rf /", "s2")).toBe(false);
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(2);
  });
});
