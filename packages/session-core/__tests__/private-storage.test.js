import { describe, expect, it } from "vitest";
import { _windowsExtendedPath } from "../lib/private-storage.js";

describe("Windows extended filesystem paths", () => {
  it("adds the extended prefix to absolute drive paths", () => {
    expect(_windowsExtendedPath("C:\\Users\\me\\ledger\\anchor.json")).toBe(
      "\\\\?\\C:\\Users\\me\\ledger\\anchor.json",
    );
  });

  it("normalizes separators before adding the drive prefix", () => {
    expect(_windowsExtendedPath("C:/Users/me/ledger/anchor.json")).toBe(
      "\\\\?\\C:\\Users\\me\\ledger\\anchor.json",
    );
  });

  it("converts UNC paths to the extended UNC form", () => {
    expect(_windowsExtendedPath("\\\\server\\share\\ledger\\anchor.json")).toBe(
      "\\\\?\\UNC\\server\\share\\ledger\\anchor.json",
    );
  });

  it("preserves an existing extended path", () => {
    expect(_windowsExtendedPath("\\\\?\\C:\\ledger\\anchor.json")).toBe(
      "\\\\?\\C:\\ledger\\anchor.json",
    );
  });

  it("leaves POSIX paths untouched", () => {
    expect(_windowsExtendedPath("/var/tmp/ledger/anchor.json")).toBe(
      "/var/tmp/ledger/anchor.json",
    );
  });
});
